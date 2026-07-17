import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import venueModel from './venue-facade.js';
import userModel from '../user/user-facade.js';
import gigModel from '../gig/gig-facade.js';
import {
  JOSH_GIGS_FILTER, groupGigsByVenue, type LinkableGig, type LinkableVenue,
} from '#src/lib/gig-venue-link.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s.@]+$/;
const VENUE_TYPES = ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'];
const STATUS_OPTIONS = ['active', 'archived'];
const BOOKING_STATUSES = ['booking', 'not-booking', 'booked'];
// Prospect-ranking enums (#867) — drive the AdminVenues "Prospect Score" sort.
const ORIGINALS_FIT = ['none', 'some', 'loves'];
const TRAVEL_BANDS = ['local', 'regional', 'far'];
// Per-venue timeline (#898) — mirrors touchSchema's enums in venue-schema.ts.
const TOUCH_TYPES = ['visit', 'form', 'card', 'call', 'email', 'gig', 'other', 'outcome'];
const TOUCH_OUTCOMES = ['interested', 'not-interested', 'booked', 'target-filled'];

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
  outreachEligible?: boolean;
  bookingStatus?: string;
  interested?: boolean;
  payTier?: string;
  lastVerified?: string;
  contactVerified?: boolean;
  notes?: string;
  relationshipStage?: string;
  templateOverride?: string;
  originalsFit?: string;
  travelBand?: string;
  priority?: number;
  lastContacted?: string;
  // Global outcome standing (#923) — see venue-schema.ts. Written by the
  // outcome-recording endpoint (#898); accepted here via the existing
  // partial-update pass-through like every other venue field.
  doNotContact?: boolean;
  bookedDate?: string;
  actor?: string;
}

interface GigDoc { venue?: string; datetime?: string | Date }

// #898 — wire shape for POST /venue/:id/touch. `targetWeekend` mirrors the
// outreach schema's shape (strings over the wire; parsed to Dates below).
interface RawTargetWeekend { start?: string | Date; end?: string | Date }
interface TouchBody {
  date?: string;
  type?: string;
  note?: string;
  templateType?: string;
  targetWeekend?: RawTargetWeekend;
  outcome?: string;
  bookedDate?: string;
  outreachId?: string;
  actor?: string;
}

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
function resolveActor(req: AuthRequest, body: { actor?: string }): string {
  return (body.actor || '').trim() || req.user || '';
}

// Reject a write body up front. Returns an error message, or '' when valid.
// `partial` (PUT) only validates the fields that are present.
// Enum-validated string fields ('' = unset, allowed). Data-driven so adding a
// field doesn't grow validateBody's cognitive complexity (#867).
type EnumKey = 'venueType' | 'status' | 'bookingStatus' | 'relationshipStage'
  | 'templateOverride' | 'originalsFit' | 'travelBand';
const ENUM_FIELDS: { key: EnumKey; allowed: string[] }[] = [
  { key: 'venueType', allowed: VENUE_TYPES },
  { key: 'status', allowed: STATUS_OPTIONS },
  { key: 'bookingStatus', allowed: BOOKING_STATUSES },
  { key: 'relationshipStage', allowed: ['cold', 'returning'] },
  { key: 'templateOverride', allowed: VENUE_TYPES },
  { key: 'originalsFit', allowed: ORIGINALS_FIT },
  { key: 'travelBand', allowed: TRAVEL_BANDS },
];

function invalidEnum(body: VenueBody): string {
  const bad = ENUM_FIELDS.find((f) => {
    const v = body[f.key];
    return v !== undefined && v !== '' && f.allowed.indexOf(v) === -1;
  });
  return bad ? `${bad.key} not valid` : '';
}

// #898 — parse + validate a wire-shape targetWeekend into real Dates. Returns
// null for anything malformed (missing either bound, unparseable, or an
// inverted range) — mirrors outreach-controller's parseTargetWeekend. Kept as
// a local copy (not shared) so venue-controller has no import dependency on
// outreach-controller.
function parseTargetWeekend(raw: RawTargetWeekend | undefined): { start: Date; end: Date } | null {
  if (!raw || !raw.start || !raw.end) return null;
  const start = new Date(raw.start);
  const end = new Date(raw.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start.getTime() > end.getTime()) return null;
  return { start, end };
}

// Outcome-specific validation for a `type: 'outcome'` touch — split out of
// validateTouchBody to keep its cognitive complexity down. Returns an error
// message, or '' when valid. A 'booked' outcome additionally requires a valid
// `bookedDate` (the actual gig date being recorded).
function validateTouchOutcome(body: TouchBody): string {
  if (!body.outcome || TOUCH_OUTCOMES.indexOf(body.outcome) === -1) {
    return `outcome must be one of ${TOUCH_OUTCOMES.join(', ')} for an outcome touch`;
  }
  if (body.outcome === 'booked' && (!body.bookedDate || Number.isNaN(new Date(body.bookedDate).getTime()))) {
    return 'bookedDate (valid date) is required for a booked outcome touch';
  }
  return '';
}

// Validate a POST /venue/:id/touch body. Returns an error message, or '' when
// valid. `type` is always required; `outcome` is required (and enum-checked,
// see validateTouchOutcome) only for an 'outcome' touch.
function validateTouchBody(body: TouchBody): string {
  if (!body.type || TOUCH_TYPES.indexOf(body.type) === -1) return `type must be one of ${TOUCH_TYPES.join(', ')}`;
  if (body.targetWeekend !== undefined && !parseTargetWeekend(body.targetWeekend)) {
    return 'targetWeekend must include valid start and end';
  }
  if (body.type === 'outcome') {
    const outcomeErr = validateTouchOutcome(body);
    if (outcomeErr) return outcomeErr;
  } else if (body.outcome !== undefined) {
    return 'outcome is only valid on an outcome touch';
  }
  if (body.outreachId !== undefined && !mongoose.Types.ObjectId.isValid(body.outreachId)) return 'outreachId is invalid';
  if (body.date !== undefined && Number.isNaN(new Date(body.date).getTime())) return 'date must be a valid date';
  return '';
}

// Build the touch subdocument to append, from a validated body.
function buildTouch(body: TouchBody, actor: string): Record<string, unknown> {
  const tw = parseTargetWeekend(body.targetWeekend);
  return {
    date: body.date ? new Date(body.date) : new Date(),
    type: body.type,
    note: body.note,
    templateType: body.templateType,
    targetWeekend: tw || undefined,
    outcome: body.outcome,
    bookedDate: body.bookedDate ? new Date(body.bookedDate) : undefined,
    outreachId: body.outreachId,
    actor,
  };
}

function invalidPriority(priority: number | undefined): boolean {
  return priority !== undefined && priority !== null
    && (typeof priority !== 'number' || priority < 0 || priority > 5);
}

function validateBody(body: VenueBody, partial: boolean): string {
  if ((!partial || body.name !== undefined) && (!body.name || !body.name.trim())) return 'Name is required';
  const enumErr = invalidEnum(body);
  if (enumErr) return enumErr;
  if (invalidPriority(body.priority)) return 'priority must be a number 0-5';
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
    // Outreach targeting (#843): ?outreachEligible=true returns only vetted
    // venues — the pool #844's approval flow proposes from. The vetting tags
    // below filter the candidate set further (still booking, interested).
    // (`inScope` filter support was dropped with the field itself — #954.)
    if (query.outreachEligible === 'true') filter.outreachEligible = true;
    else if (query.outreachEligible === 'false') filter.outreachEligible = false;
    if (typeof query.bookingStatus === 'string') filter.bookingStatus = query.bookingStatus;
    if (query.interested === 'true') filter.interested = true;
    else if (query.interested === 'false') filter.interested = false;
    return filter;
  }

  // Drop venues that have a gig within ±2 months of the target date. Gigs live
  // in a different DB (read via gigModel); matching is by venue name against the
  // gig's HTML `venue` text (best-effort, name-based). Outreach is Josh & Maria's:
  // scope to Josh's gigs (or pre-migration docs with no artist field) so Tim's
  // gigs (web-jam-back#922) never gate Josh's venue eligibility.
  static async filterEligible(venues: Record<string, unknown>[], target: Date): Promise<Record<string, unknown>[]> {
    const start = new Date(target); start.setMonth(start.getMonth() - ELIGIBILITY_WINDOW_MONTHS);
    const end = new Date(target); end.setMonth(end.getMonth() + ELIGIBILITY_WINDOW_MONTHS);
    let gigs: GigDoc[];
    try {
      gigs = await gigModel.find({
        $or: [{ artist: 'josh' }, { artist: { $exists: false } }],
      }) as unknown as GigDoc[];
    } catch (e) { return Promise.reject(e); }
    // `booked` entries are already lowercased by stripHtml, matching `name` below.
    const booked = gigs
      .filter((g) => g.datetime && new Date(g.datetime) >= start && new Date(g.datetime) <= end)
      .map((g) => stripHtml(String(g.venue || '')));
    return venues.filter((v) => {
      const name = String(v.name || '').trim().toLowerCase();
      if (!name) return true;
      return !booked.some((bv) => bv.includes(name));
    });
  }

  // #958 — attach computed lastGig/nextGig + locationFallback onto each venue
  // via ONE extra gig query for the whole batch (never a per-venue query — no
  // N+1), scoped to Josh's gigs like filterEligible above. Resolution is the
  // shared venueId-first/exact-normalized-name-fallback rule (never fuzzy —
  // see src/lib/gig-venue-link.ts). lastGig = the most recent linked gig with
  // datetime in the past; nextGig = the earliest linked gig with datetime >=
  // now. locationFallback is display-only (city/usState off whichever of
  // those two gigs is more relevant — lastGig if there is one, else nextGig,
  // so a venue with only a FUTURE booked gig, like Durty Bull's Nov 16, still
  // gets a location — never written back to the venue record).
  static async attachGigLinks(venues: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    let gigs: LinkableGig[];
    try {
      gigs = await gigModel.find(JOSH_GIGS_FILTER) as unknown as LinkableGig[];
    } catch (e) { return Promise.reject(e); }
    const groups = groupGigsByVenue(gigs, venues as unknown as LinkableVenue[]);
    const now = Date.now();
    return venues.map((v) => {
      const linked = (groups.get(String(v._id)) || [])
        .filter((g) => g.datetime && !Number.isNaN(new Date(g.datetime as string).getTime()))
        .slice()
        .sort((a, b) => new Date(a.datetime as string).getTime() - new Date(b.datetime as string).getTime());
      const past = linked.filter((g) => new Date(g.datetime as string).getTime() < now);
      const future = linked.filter((g) => new Date(g.datetime as string).getTime() >= now);
      const lastGig = past.length ? past[past.length - 1] : null;
      const nextGig = future.length ? future[0] : null;
      const fallbackGig = lastGig || nextGig;
      const locationFallback = fallbackGig && (fallbackGig.city || fallbackGig.usState)
        ? { city: fallbackGig.city, usState: fallbackGig.usState }
        : null;
      return {
        ...v, lastGig, nextGig, locationFallback,
      };
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
    try { venues = await VenueController.attachGigLinks(venues); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    return res.status(200).json(venues);
  }

  // GET /venue/:id
  async getVenue(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, VENUE_WRITE_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Find id is invalid' });
    let doc: Record<string, unknown> | null;
    try { doc = await this.model.findById(req.params.id); } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (!doc) return res.status(400).json({ message: 'nothing found with id provided' });
    let withLinks: Record<string, unknown>[];
    try { withLinks = await VenueController.attachGigLinks([doc]); } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    return res.status(200).json(withLinks[0]);
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

  // POST /venue/:id/touch — append one timeline event (#898). Gated by
  // `venue:edit` like every other venue mutation (no dedicated capability —
  // a touch is just another field write on the venue). Used for manual
  // contact events (visit/form/card/call/gig/other) AND, from the outreach
  // side, by the outcome-recording endpoint (#898's recordOutcome in
  // outreach-controller) to log email sends and recorded outcomes.
  async addTouch(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['venue:edit']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Update id is invalid' });
    const body = (req.body || {}) as TouchBody;
    const invalid = validateTouchBody(body);
    if (invalid) return res.status(400).json({ message: invalid });
    const actor = resolveActor(req, body);
    const touch = buildTouch(body, actor);
    let doc;
    try {
      doc = await this.model.findByIdAndUpdate(req.params.id, {
        $push: { touches: touch }, lastModifiedBy: actor,
      } as unknown as Record<string, unknown>);
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (!doc) return res.status(400).json({ message: 'Id Not Found' });
    return res.status(201).json(doc);
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
