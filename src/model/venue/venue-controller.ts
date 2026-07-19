import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import { isValidEmail } from '#src/lib/email.js';
import venueModel from './venue-facade.js';
import { normalizeAddress } from './normalize-address.js';
import userModel from '../user/user-facade.js';
import gigModel from '../gig/gig-facade.js';
import {
  JOSH_GIGS_FILTER, groupGigsByVenue, type LinkableGig, type LinkableVenue,
} from '#src/lib/gig-venue-link.js';

// #972 — country is a 2-letter code (ISO 3166-1 alpha-2 style, e.g. 'US',
// 'CA'); case-insensitive here since the schema uppercase-normalizes on save.
const COUNTRY_RE = /^[A-Za-z]{2}$/;
const VENUE_TYPES = ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'];
const STATUS_OPTIONS = ['active', 'archived'];
// #980 — the derived bookingStatus values, returned on every venue payload by
// computeBookingStatus below (no settable BOOKING_STATUSES const anymore —
// bookingStatus is never accepted in a request body).
type DerivedBookingStatus = 'booked' | 'not-booking' | 'booking';
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
  // #983/#987 — street address, the disambiguator for same-name/same-city
  // locations. REQUIRED on every POST /venue (#987 Part B — validated in
  // validateBody below, before any DB write) and normalized on write (#987
  // Part A — see normalize-address.ts), on both POST and PUT. PUT keeps it
  // optional (schema stays required:false — see venue-schema.ts) but an
  // address, once set, cannot be removed; see updateVenue below.
  address?: string;
  usState?: string;
  // #972 — country (2-letter code, default 'US' at the schema level) + region
  // (free-text state/province, for non-US venues). usState is kept as-is for
  // US venues; region is its non-US counterpart.
  country?: string;
  region?: string;
  venueType?: string;
  contactName?: string;
  // #974 — email is the primary/canonical contact address; secondaryEmail is
  // an optional second booking contact (some venues have two — e.g. Slow Play
  // Brewing). Both validated as proper emails (validateBody below).
  email?: string;
  secondaryEmail?: string;
  phone?: string;
  website?: string;
  status?: string;
  outreachEligible?: boolean;
  interested?: boolean;
  payTier?: string;
  lastVerified?: string;
  notes?: string;
  relationshipStage?: string;
  templateOverride?: string;
  originalsFit?: string;
  travelBand?: string;
  priority?: number;
  lastContacted?: string;
  // #980 — minimum gig-spacing (months, 0 = off) and the manual "pause until"
  // cooldown date. See venue-schema.ts. `bookingStatus` is intentionally NOT
  // in this interface anymore — it's derived/read-only (computeBookingStatus
  // below); a stray `bookingStatus` in the request body is stripped, never
  // written (see createVenue/updateVenue).
  gigInterval?: number;
  resumeBooking?: string;
  bookedDate?: string;
  actor?: string;
}

interface GigDoc { venue?: string; datetime?: string | Date }

// #987 — findDuplicate's result: a definite match to upsert onto, no match
// (create fresh), or an ambiguous set of address-less legacy candidates that
// createVenue must 400 on rather than guess between.
type DuplicateResolution =
  | { kind: 'match'; venue: Record<string, unknown> }
  | { kind: 'none' }
  | { kind: 'ambiguous'; ids: string[] };

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
type EnumKey = 'venueType' | 'status' | 'relationshipStage'
  | 'templateOverride' | 'originalsFit' | 'travelBand';
const ENUM_FIELDS: { key: EnumKey; allowed: string[] }[] = [
  { key: 'venueType', allowed: VENUE_TYPES },
  { key: 'status', allowed: STATUS_OPTIONS },
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

// #980 — gigInterval is a non-negative integer count of months (0 = spacing
// check off).
function invalidGigInterval(gigInterval: number | undefined): boolean {
  return gigInterval !== undefined && gigInterval !== null
    && (typeof gigInterval !== 'number' || !Number.isInteger(gigInterval) || gigInterval < 0);
}

function validateBody(body: VenueBody, partial: boolean): string {
  if ((!partial || body.name !== undefined) && (!body.name || !body.name.trim())) return 'Name is required';
  const enumErr = invalidEnum(body);
  if (enumErr) return enumErr;
  if (invalidPriority(body.priority)) return 'priority must be a number 0-5';
  if (invalidGigInterval(body.gigInterval)) return 'gigInterval must be a non-negative whole number of months';
  if (body.resumeBooking !== undefined && body.resumeBooking !== '' && Number.isNaN(new Date(body.resumeBooking).getTime())) {
    return 'resumeBooking must be a valid date';
  }
  if (body.email !== undefined && body.email !== '' && !isValidEmail(body.email)) {
    return 'A valid email is required';
  }
  // #974 — secondaryEmail is optional, but when present must be a proper
  // email too (same rule as the primary).
  if (body.secondaryEmail !== undefined && body.secondaryEmail !== '' && !isValidEmail(body.secondaryEmail)) {
    return 'A valid secondary email is required';
  }
  if (body.country !== undefined && body.country !== '' && !COUNTRY_RE.test(String(body.country).trim())) {
    return 'country must be a 2-letter code';
  }
  // #987 Part B — address is required on every POST /venue (partial=false),
  // validated here before any DB write. Checked last so any other body error
  // (a bad enum, an invalid email, etc.) still reports its own specific
  // message first — this only fires when nothing else is already wrong.
  // PUT (partial=true) stays optional; see updateVenue for its own
  // immutable-once-set address rule.
  if (!partial && (!body.address || !String(body.address).trim())) {
    return 'address is required to create a venue';
  }
  return '';
}

// #980 — `bookingStatus` is derived/read-only (computeBookingStatus below)
// and `doNotContact` was deleted entirely (folded into `outreachEligible`).
// Neither is in the VenueBody type anymore, but an older/stale client could
// still send them in the raw JSON body — silently drop both here (mirrors
// the existing `delete body._id` pattern) rather than erroring, so a
// round-tripped venue-edit form that still includes the old value is a
// harmless no-op instead of a 400.
function stripReadOnlyFields(body: Record<string, unknown>): void {
  delete body.bookingStatus;
  delete body.doNotContact;
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
    // venues — the pool #844's approval flow proposes from. The vetting tag
    // below filters the candidate set further (interested).
    // (`inScope` filter support was dropped with the field itself — #954.)
    // #980 — `bookingStatus` filter support was dropped with the field's
    // settable meaning: it's now derived/computed on read (see
    // computeBookingStatus), so the RAW stored value a Mongo query would
    // filter on is no longer reliably maintained. Filter on the computed
    // `bookingStatus` client-side after the list comes back instead.
    if (query.outreachEligible === 'true') filter.outreachEligible = true;
    else if (query.outreachEligible === 'false') filter.outreachEligible = false;
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

  // #980 — the derived, read-only bookingStatus readout (see venue-schema.ts).
  // Display precedence when multiple conditions could apply, as decided
  // during build: `booked` (has an upcoming linked gig) beats `not-booking`
  // (an active resumeBooking cooldown) beats `booking` (the open/default
  // state) — a venue can't be actively paused from booking AND already have
  // a confirmed upcoming gig in any way that matters for the badge; the
  // confirmed gig is the more useful signal to show. `resumeBooking` is
  // "active" when set to a date strictly in the future, relative to `now` —
  // the same instant the caller resolves everything else against (mirrors
  // the exact wording of #980: "unset or in the past" = no active cooldown).
  static computeBookingStatus(venue: Record<string, unknown>, hasUpcomingGig: boolean, now: number): DerivedBookingStatus {
    if (hasUpcomingGig) return 'booked';
    const resumeBooking = venue.resumeBooking ? new Date(venue.resumeBooking as string) : null;
    if (resumeBooking && !Number.isNaN(resumeBooking.getTime()) && resumeBooking.getTime() > now) return 'not-booking';
    return 'booking';
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
  //
  // #980 — also attaches the derived `bookingStatus` (computeBookingStatus
  // above), computed fresh here and OVERWRITING whatever stale value is
  // still stored on the raw venue doc, so bookingStatus can never go stale on
  // any read (GET /venue and GET /venue/:id both go through this).
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
      const bookingStatus = VenueController.computeBookingStatus(v, future.length > 0, now);
      return {
        ...v, lastGig, nextGig, locationFallback, bookingStatus,
      };
    });
  }

  // GET /venue/cities — distinct non-empty `city` values (#980), so the
  // AdminVenues city-targeting multi-select (JaMmusic#1238) can offer exactly
  // the cities that exist in the DB rather than a hardcoded list. Chose a
  // dedicated endpoint over "derive it client-side from the venues the page
  // already loaded" because AdminVenues' venue list can be filtered
  // (status/venueType/etc, see buildListFilter) — a distinct-cities source
  // that only reflects whatever's currently on screen would silently drop
  // options depending on which filter happens to be active; this endpoint
  // always reflects every venue, independent of any list-page filter state.
  async listCities(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, VENUE_WRITE_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    let cities: unknown[];
    try {
      cities = await venueModel.Schema.distinct('city', { city: { $nin: [null, ''] } });
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    const distinctCities = (cities as string[])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return res.status(200).json(distinctCities);
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

  // Find an existing venue for dedupe (#983, refined by #987). Email is NOT
  // part of this match — a shared chain inbox (e.g. Starr Hill's
  // info@starrhill.com) is not unique per location, and matching on it
  // silently overwrote a different venue's record (the Starr Hill incident
  // #983 fixed).
  //
  // Match key is name + city (case-insensitive), refined by `address`
  // compared NORMALIZED-to-normalized (#987 Part A's normalizeAddress) so an
  // incoming un-normalized address still matches an already-stored
  // (normalized, or pre-#987 legacy raw) one:
  //   - a candidate with the SAME normalized address wins outright — that's
  //     the venue, upsert onto it (two Macado's in Roanoke, disambiguated).
  //   - a candidate with a DIFFERENT non-empty address is not a match.
  //   - a legacy candidate with NO address on file (everything predating
  //     #983) is a fallback match ONLY when there is exactly one such
  //     candidate; two or more is reported back as 'ambiguous' so the caller
  //     (createVenue) can 400 rather than guess.
  async findDuplicate(body: VenueBody): Promise<DuplicateResolution> {
    const name = (body.name || '').trim();
    if (!name) return { kind: 'none' };
    const query: Record<string, unknown> = { name: new RegExp(`^${escapeRegExp(name)}$`, 'i') };
    const city = (body.city || '').trim();
    if (city) query.city = new RegExp(`^${escapeRegExp(city)}$`, 'i');
    const candidates = await this.model.find(query) as unknown as Record<string, unknown>[];
    if (!candidates.length) return { kind: 'none' };
    const incomingNormalized = normalizeAddress(body.address).toLowerCase();
    if (incomingNormalized) {
      const addressMatch = candidates.find(
        (c) => normalizeAddress(String(c.address || '')).toLowerCase() === incomingNormalized,
      );
      if (addressMatch) return { kind: 'match', venue: addressMatch };
    }
    const legacyCandidates = candidates.filter((c) => !String(c.address || '').trim());
    if (legacyCandidates.length === 1) return { kind: 'match', venue: legacyCandidates[0] };
    if (legacyCandidates.length > 1) {
      return { kind: 'ambiguous', ids: legacyCandidates.map((c) => String(c._id)) };
    }
    return { kind: 'none' };
  }

  // #983 — email is plain contact data now: the same address (a shared chain
  // inbox) may legitimately exist on multiple venues, and finding it
  // elsewhere must never block or overwrite a create. This is a cheap,
  // best-effort, non-blocking lookup purely to surface an informational
  // notice; any failure here is swallowed so it can never fail the actual
  // write. #985 — when more than one other venue shares the email, only the
  // FIRST match found is named (kept simple, per #985's own call-it-your-way
  // acceptance criterion) rather than enumerating every match.
  async findEmailElsewhere(email: string, excludeId?: string): Promise<Record<string, unknown> | null> {
    const query: Record<string, unknown> = { email };
    if (excludeId) query._id = { $ne: excludeId };
    return this.model.findOne(query);
  }

  // #985 — build the dated notice line persisted to a newly-created venue's
  // `notes` when its email is already on another venue (e.g. Starr Hill's
  // shared info@starrhill.com). Same `[YYYY-MM-DD] ...` dated-line format as
  // the not-interested outcome handler / #980 migration notes.
  static buildEmailElsewhereNote(email: string, otherName: unknown): string {
    const dateStr = new Date().toISOString().slice(0, 10);
    return `[${dateStr}] Email ${email} also used by venue '${String(otherName || '')}'.`;
  }

  // #985 — append (never overwrite) a note line onto a create payload's own
  // `notes` value. Only used on the fresh-insert path (findDuplicate found no
  // match) — an upsert onto an existing venue is intentionally left alone,
  // since #985 only annotates the NEWLY CREATED record, never another venue.
  static appendNote(existingNotes: unknown, line: string): string {
    const trimmed = typeof existingNotes === 'string' ? existingNotes.trim() : '';
    return trimmed ? `${trimmed}\n${line}` : line;
  }

  // #987 — resolve findDuplicate's result for createVenue: an error tuple
  // when a 500 (the lookup itself threw) or a 400 (ambiguous legacy
  // candidates, Part B) should short-circuit the create, or the existing doc
  // to upsert onto (null = create fresh). Split out of createVenue to keep
  // its cognitive complexity down.
  async resolveExistingForCreate(
    body: VenueBody,
  ): Promise<{ error: { status: number; message: string } } | { existing: Record<string, unknown> | null }> {
    let resolution: DuplicateResolution;
    try { resolution = await this.findDuplicate(body); } catch (e) {
      return { error: { status: 500, message: (e as Error).message } };
    }
    if (resolution.kind === 'ambiguous') {
      return {
        error: {
          status: 400,
          message: `multiple existing venues without an address match this name/city; specify which to update: ${resolution.ids.join(', ')}`,
        },
      };
    }
    return { existing: resolution.kind === 'match' ? resolution.venue : null };
  }

  // POST /venue — create a venue, or upsert onto an existing match (dedupe), so
  // an agent that re-adds a known venue updates it instead of duplicating. A
  // matched venue is also un-archived.
  async createVenue(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['venue:create']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const body = (req.body || {}) as VenueBody;
    delete body._id;
    stripReadOnlyFields(body as unknown as Record<string, unknown>);
    const invalid = validateBody(body, false);
    if (invalid) return res.status(400).json({ message: invalid });
    // #987 Part A — normalize the (now-guaranteed-present, per validateBody
    // above) address on write, identically to the PUT path (updateVenue).
    body.address = normalizeAddress(body.address);

    const actor = resolveActor(req, body);
    const resolved = await this.resolveExistingForCreate(body);
    if ('error' in resolved) return res.status(resolved.error.status).json({ message: resolved.error.message });
    const { existing } = resolved;

    // #983/#985 — non-blocking "email also on '<venueName>'" notice: never
    // awaited in a way that could fail the create, and never used to
    // find/overwrite a record (that's findDuplicate's job, above, and it
    // never looks at email). #985 — only a fresh insert (no name+city match)
    // gets the notice persisted to ITS OWN `notes`; an upsert onto an
    // existing venue is untouched (not a "newly created" record), and the
    // OTHER venue that shares the email is never modified either way.
    const email = (body.email || '').trim().toLowerCase();
    let emailNote = '';
    if (email) {
      try {
        const elsewhere = await this.findEmailElsewhere(email, existing ? String(existing._id) : undefined);
        if (elsewhere) {
          emailNote = VenueController.buildEmailElsewhereNote(email, elsewhere.name);
          console.log(`[venue] ${emailNote}`); // eslint-disable-line no-console
        }
      } catch { /* notice lookup is best-effort only — never blocks the write */ }
    }

    if (existing) {
      let updated;
      try {
        updated = await this.model.findByIdAndUpdate(String(existing._id), {
          ...body, status: body.status || 'active', lastModifiedBy: actor,
        });
      } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
      return res.status(200).json(updated);
    }
    const createBody: Record<string, unknown> = { ...body, status: body.status || 'active', lastModifiedBy: actor };
    if (emailNote) createBody.notes = VenueController.appendNote(body.notes, emailNote);
    let doc;
    try {
      doc = await this.model.create(createBody);
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    return res.status(201).json(doc);
  }

  // #987 — validates/normalizes a PUT body's `address` in place (mutates
  // `body.address`) per the once-set-cannot-be-removed rule, returning an
  // error tuple to short-circuit on, or null when fine to proceed:
  //   - `address` key absent from the body entirely -> null immediately
  //     (normal partial-merge behavior; nothing below runs, body untouched).
  //   - present and non-empty -> normalized identically to POST (Part A) —
  //     this is how you correct a wrong address.
  //   - present but empty/whitespace/null -> allowed ONLY as a no-op when the
  //     venue currently has no address on file (legacy records must stay
  //     editable); an error tuple (400, nothing written) when it does have
  //     one. Split out of updateVenue to keep its cognitive complexity down.
  async applyAddressUpdate(id: string, body: VenueBody): Promise<{ status: number; message: string } | null> {
    if (!Object.prototype.hasOwnProperty.call(body, 'address')) return null;
    const trimmedAddress = typeof body.address === 'string' ? body.address.trim() : '';
    if (trimmedAddress) {
      body.address = normalizeAddress(trimmedAddress);
      return null;
    }
    let currentDoc: Record<string, unknown> | null;
    try { currentDoc = await this.model.findById(id); } catch (e) { return { status: 500, message: (e as Error).message }; }
    if (!currentDoc) return { status: 400, message: 'Id Not Found' };
    if (String(currentDoc.address || '').trim()) {
      return { status: 400, message: 'address cannot be removed; supply a corrected address instead' };
    }
    // No address on file — allowed no-op; write a definite '' rather than
    // whatever falsy shape (e.g. null) the caller sent.
    body.address = '';
    return null;
  }

  // PUT /venue/:id — partial update. See applyAddressUpdate above for the
  // #987 address-immutability rule this enforces.
  async updateVenue(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['venue:edit']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Update id is invalid' });
    const body = (req.body || {}) as VenueBody;
    delete body._id;
    stripReadOnlyFields(body as unknown as Record<string, unknown>);
    const invalid = validateBody(body, true);
    if (invalid) return res.status(400).json({ message: invalid });
    const addressErr = await this.applyAddressUpdate(req.params.id, body);
    if (addressErr) return res.status(addressErr.status).json({ message: addressErr.message });
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
