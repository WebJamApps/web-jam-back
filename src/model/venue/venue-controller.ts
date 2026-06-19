import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import venueModel from './venue-facade.js';
import userModel from '../user/user-facade.js';
import gigModel from '../gig/gig-facade.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s.@]+$/;
const VENUE_TYPES = ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'];
const STATUS_OPTIONS = ['active', 'archived'];

// Role fallback for human admins who authorize by role (no privileges array).
// AI agents pass via the venue:* capabilities on the shared web-jam-llm identity.
const ALLOWED_ROLES = ['JaM-admin', 'Developer'];

// Write capabilities. Reads are gated by holding ANY of these (or the admin
// role) — this repo has no `:read` capabilities by convention.
const VENUE_WRITE_CAPS = ['venue:create', 'venue:edit', 'venue:delete'];

// ±2-month clear-window for the eligibility filter (web-jam-back#819).
const ELIGIBILITY_WINDOW_MONTHS = 2;

interface AuthedUser { userType?: string; privileges?: string[] }
type AuthRequest = Request & { user?: string };
type AuthIdRequest = Request<{ id: string }> & { user?: string };
type AuthzError = { status: number; message: string };
type AuthzResult = AuthzError | null;

interface VenueBody {
  _id?: string;
  name?: string;
  city?: string;
  usState?: string;
  venueType?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  status?: string;
  notes?: string;
  lastContacted?: string;
  actor?: string;
}

interface GigDoc { venue?: string; datetime?: string | Date }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtml(value: string): string {
  // `<[^>]*>` is linear (negated class, no nested quantifier) — safe from
  // catastrophic backtracking despite the generic slow-regex warning.
  // eslint-disable-next-line sonarjs/slow-regex
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// The actor that performed a write: an explicit `actor` (stamped by the MCP
// server / agent) wins; otherwise fall back to the authenticated token subject.
function resolveActor(req: AuthRequest, body: VenueBody): string {
  return (body.actor || '').trim() || req.user || '';
}

// Reject a write body up front. Returns an error message, or '' when valid.
// `partial` (PUT) only validates the fields that are present.
function validateBody(body: VenueBody, partial: boolean): string {
  if (!partial || body.name !== undefined) {
    if (!body.name || !body.name.trim()) return 'Name is required';
  }
  if (body.venueType !== undefined && VENUE_TYPES.indexOf(body.venueType) === -1) return 'venueType not valid';
  if (body.status !== undefined && STATUS_OPTIONS.indexOf(body.status) === -1) return 'status not valid';
  if (body.email !== undefined && body.email !== '' && !EMAIL_RE.test(String(body.email).trim().toLowerCase())) {
    return 'A valid email is required';
  }
  return '';
}

// Privilege-first, role-fallback gate (mirrors PromoController). Reused for both
// writes (a specific capability) and reads (any venue write capability).
function checkAccess(user: AuthedUser, required: string[]): AuthzResult {
  const privileges = user.privileges || [];
  if (privileges.length) {
    if (!privileges.some((p) => required.indexOf(p) !== -1)) {
      return { status: 403, message: `missing ${required.join('/')} capability` };
    }
    return null;
  }
  if (ALLOWED_ROLES.indexOf(user.userType || '') === -1) {
    return { status: 403, message: 'not authorized for venue management' };
  }
  return null;
}

class VenueController extends Controller {
  // Load the token's user, then apply the access gate. Every venue route runs
  // ensureAuthenticated first (valid token → req.user); this adds authorization.
  async authorize(req: AuthRequest, required: string[]): Promise<AuthzResult> { // eslint-disable-line class-methods-use-this
    let user: AuthedUser | null;
    try { user = await userModel.findById(req.user || '') as unknown as AuthedUser | null; } catch (e) {
      return { status: 500, message: (e as Error).message };
    }
    if (!user) return { status: 401, message: 'user not found' };
    return checkAccess(user, required);
  }

  // Build the Mongo filter for GET /venue from whitelisted query params. By
  // default archived venues are hidden unless an explicit `status` is requested.
  static buildListFilter(query: Record<string, unknown>): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (typeof query.status === 'string') filter.status = query.status;
    else filter.status = { $ne: 'archived' };
    if (typeof query.venueType === 'string') filter.venueType = query.venueType;
    return filter;
  }

  // Drop venues that have a gig within ±2 months of the target date. Gigs live
  // in a different DB (read via gigModel); matching is by venue name against the
  // gig's HTML `venue` text (best-effort, name-based).
  static async filterEligible(venues: Record<string, unknown>[], target: Date): Promise<Record<string, unknown>[]> {
    const start = new Date(target); start.setMonth(start.getMonth() - ELIGIBILITY_WINDOW_MONTHS);
    const end = new Date(target); end.setMonth(end.getMonth() + ELIGIBILITY_WINDOW_MONTHS);
    let gigs: GigDoc[];
    try { gigs = await gigModel.find({}) as unknown as GigDoc[]; } catch (e) { return Promise.reject(e); }
    const booked = gigs
      .filter((g) => g.datetime && new Date(g.datetime) >= start && new Date(g.datetime) <= end)
      .map((g) => stripHtml(String(g.venue || '')));
    return venues.filter((v) => {
      const name = String(v.name || '').trim().toLowerCase();
      if (!name) return true;
      return !booked.some((bv) => bv.includes(name));
    });
  }

  // GET /venue — list venues (filters: status, venueType, eligibleFor=<date>).
  async listVenues(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, VENUE_WRITE_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const query = (req.query || {}) as Record<string, unknown>;
    let venues: Record<string, unknown>[];
    try { venues = await this.model.find(VenueController.buildListFilter(query)); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    if (typeof query.eligibleFor === 'string') {
      const target = new Date(query.eligibleFor);
      if (Number.isNaN(target.getTime())) return res.status(400).json({ message: 'eligibleFor must be a valid date' });
      try { venues = await VenueController.filterEligible(venues, target); } catch (e) {
        return res.status(500).json({ message: (e as Error).message });
      }
    }
    return res.status(200).json(venues);
  }

  // GET /venue/:id
  async getVenue(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, VENUE_WRITE_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Find id is invalid' });
    let doc;
    try { doc = await this.model.findById(req.params.id); } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (!doc) return res.status(400).json({ message: 'nothing found with id provided' });
    return res.status(200).json(doc);
  }

  // Find an existing venue for dedupe: by email when given (strongest key),
  // otherwise by case-insensitive name (+ city when present).
  async findDuplicate(body: VenueBody): Promise<Record<string, unknown> | null> {
    const email = (body.email || '').trim().toLowerCase();
    if (email) return this.model.findOne({ email });
    const query: Record<string, unknown> = { name: new RegExp(`^${escapeRegExp((body.name || '').trim())}$`, 'i') };
    const city = (body.city || '').trim();
    if (city) query.city = new RegExp(`^${escapeRegExp(city)}$`, 'i');
    return this.model.findOne(query);
  }

  // POST /venue — create a venue, or upsert onto an existing match (dedupe), so
  // an agent that re-adds a known venue updates it instead of duplicating. A
  // matched venue is also un-archived.
  async createVenue(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['venue:create']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const body = (req.body || {}) as VenueBody;
    delete body._id;
    const invalid = validateBody(body, false);
    if (invalid) return res.status(400).json({ message: invalid });

    const actor = resolveActor(req, body);
    let existing: Record<string, unknown> | null;
    try { existing = await this.findDuplicate(body); } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (existing) {
      let updated;
      try {
        updated = await this.model.findByIdAndUpdate(String(existing._id), {
          ...body, status: body.status || 'active', lastModifiedBy: actor,
        });
      } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
      return res.status(200).json(updated);
    }
    let doc;
    try {
      doc = await this.model.create({ ...body, status: body.status || 'active', lastModifiedBy: actor });
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    return res.status(201).json(doc);
  }

  // PUT /venue/:id — partial update.
  async updateVenue(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['venue:edit']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Update id is invalid' });
    const body = (req.body || {}) as VenueBody;
    delete body._id;
    const invalid = validateBody(body, true);
    if (invalid) return res.status(400).json({ message: invalid });
    let doc;
    try {
      doc = await this.model.findByIdAndUpdate(req.params.id, { ...body, lastModifiedBy: resolveActor(req, body) });
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (!doc) return res.status(400).json({ message: 'Id Not Found' });
    return res.status(200).json(doc);
  }

  // DELETE /venue/:id — soft-delete (archive), never a hard remove, so history
  // survives. Hard purge is an admin-only action outside this API (#819).
  async deleteVenue(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['venue:delete']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Delete id is invalid' });
    const actor = resolveActor(req, (req.body || {}) as VenueBody);
    let doc;
    try {
      doc = await this.model.findByIdAndUpdate(req.params.id, { status: 'archived', lastModifiedBy: actor });
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (!doc) return res.status(400).json({ message: 'Delete id is invalid' });
    return res.status(200).json({ message: 'Venue was archived successfully', venue: doc });
  }
}

export default new VenueController(venueModel) as unknown as Icontroller;
