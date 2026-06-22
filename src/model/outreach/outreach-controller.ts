import { Request, Response } from 'express';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import { sendMail } from '#src/lib/mailer.js';
import outreachModel from './outreach-facade.js';
import outreachConfigModel from './outreach-config-facade.js';
import venueModel from '../venue/venue-facade.js';
import templateModel from '../template/template-facade.js';
import userModel from '../user/user-facade.js';
import { MAX_STEP, nextTouchDueAfter } from './cadence.js';

// Every gig pitch CCs Josh + Maria so they see each send land (mirrors the
// InquiryController CC precedent). Maria's address is the same one inquiries CC.
const PITCH_CC = ['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com'];

// An active campaign blocks a new pitch for the same venue + window (no
// double-pitching). sent / replied are active; declined / no-response / booked
// are terminal and don't block.
const ACTIVE_STATUSES = ['sent', 'replied'];

const ALLOWED_ROLES = ['JaM-admin', 'Developer'];
// Read/list endpoints: any outreach capability (incl. a pure approver) gets in.
const OUTREACH_ANY_CAPS = ['outreach:create', 'outreach:edit', 'outreach:delete', 'outreach:approve'];
// Door gate for the send paths: a creator OR an approver may attempt; canSend()
// then decides whether it actually goes out (approver always; creator only when
// auto-approve is on).
const OUTREACH_SEND_CAPS = ['outreach:create', 'outreach:approve'];

interface AuthedUser { userType?: string; privileges?: string[] }
type AuthRequest = Request & { user?: string };
type AuthIdRequest = Request<{ id: string }> & { user?: string };
type AuthzError = { status: number; message: string; outreach?: unknown };
type AuthzResult = AuthzError | null;
interface PitchContext { error?: AuthzError; venue?: VenueDoc; template?: TemplateDoc; type?: string }
interface ResolveOpts { skipDedup?: boolean; requireEligible?: boolean }
type SendResult = { ok: true; record: unknown } | { ok: false; status: number; message: string };

interface SendBody {
  venueId?: string;
  templateType?: string;
  targetDates?: string;
  bookingPeriod?: string;
  actor?: string;
  cc?: string | string[];
}

// #844 — batch target-list approval. The approval gate is the TARGET SELECTION
// (which vetted venues are in the batch), NOT individual emails. A human holding
// outreach:approve sends the approved list; an agent (outreach:create only) can
// send a batch ONLY when auto-approve is configured ON.
interface BatchBody {
  venueIds?: string[];
  templateType?: string;
  targetDates?: string;
  bookingPeriod?: string;
  actor?: string;
  cc?: string | string[];
}

interface ConfigBody { autoApprove?: boolean; actor?: string }
interface UpdateBody { status?: string; gmailThreadId?: string; actor?: string }

interface VenueDoc {
  _id?: unknown; name?: string; email?: string; contactName?: string;
  venueType?: string; status?: string; outreachEligible?: boolean;
  bookingStatus?: string; relationshipStage?: string; templateOverride?: string;
}
interface TemplateDoc { type?: string; subject?: string; bodyHtml?: string; footerPhotoRef?: string }
interface FollowUp { sentAt?: Date; messageId?: string; step?: number }
interface OutreachDoc {
  _id?: unknown; venueId?: unknown; sentAt?: Date; step?: number; targetDates?: string; followUps?: FollowUp[];
  status?: string; templateUsed?: string; bookingPeriod?: string;
}

const OUTREACH_STATUSES = ['sent', 'replied', 'declined', 'booked', 'no-response'];

// An explicit `actor` (stamped by the MCP server / agent) wins; otherwise fall
// back to the authenticated token subject.
function resolveActor(req: AuthRequest, body: { actor?: string }): string {
  return (body.actor || '').trim() || req.user || '';
}

function checkAccess(user: AuthedUser, required: string[]): AuthzResult {
  const privileges = user.privileges || [];
  if (privileges.length) {
    if (!privileges.some((p) => required.indexOf(p) !== -1)) {
      return { status: 403, message: `missing ${required.join('/')} capability` };
    }
    return null;
  }
  if (ALLOWED_ROLES.indexOf(user.userType || '') === -1) {
    return { status: 403, message: 'not authorized for outreach' };
  }
  return null;
}

// Fill the pitch tokens. Missing contact name degrades to "there" so a pitch
// never goes out addressed to "[Contact Name]".
function personalize(text: string, venue: VenueDoc, body: SendBody): string {
  return (text || '')
    .split('[Contact Name]').join(venue.contactName || 'there')
    .split('[Venue Name]').join(venue.name || 'your venue')
    .split('[Booking Period]').join(body.bookingPeriod || 'upcoming')
    .split('[Target Dates]').join(body.targetDates || 'flexible dates');
}

// Resolve a template's footerPhotoRef key to the bundled asset on disk. The
// compiled controller runs from build/, where copy:assets places the jpg; fall
// back to the source tree so an un-copied dev build (or a forgotten copy step)
// still finds it.
function resolveFooterAsset(ref: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../template/assets', `${ref}.jpg`),
    path.resolve(process.cwd(), 'src/model/template/assets', `${ref}.jpg`),
  ];
  return candidates.find((p) => fs.existsSync(p)) || /* istanbul ignore next */ null;
}

// The inline-CID footer photo block appended after the pitch body (the seed
// templates carry no <img>, so the footer photo is added here at send).
function footerHtml(): string {
  return '\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin-top:16px;">'
    + '<tr><td style="text-align:center;">'
    + '<img src="cid:footerphoto" width="320" alt="Josh and Maria performing" '
    + 'style="width:320px;max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto;"></td></tr></table>';
}

// Render a template into a ready-to-send email: token-filled subject + body,
// with the footer photo appended as an inline-CID attachment when the template
// names one (and the asset is on disk).
function buildPitchEmail(venue: VenueDoc, template: TemplateDoc, body: SendBody): {
  subject: string; html: string; attachments: { filename: string; path: string; cid: string }[];
} {
  const subject = personalize(template.subject || 'Performance Inquiry: Josh and Maria', venue, body);
  let html = personalize(template.bodyHtml || '', venue, body);
  const attachments = [];
  const assetPath = template.footerPhotoRef ? resolveFooterAsset(template.footerPhotoRef) : null;
  /* istanbul ignore else */
  if (assetPath) {
    html += footerHtml();
    attachments.push({ filename: 'josh-maria.jpg', path: assetPath, cid: 'footerphoto' });
  }
  return { subject, html, attachments };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(d: Date): string { return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; }

// Build a cadence follow-up email (#824) for an outreach record: a short,
// personalized nudge referencing the original pitch date + target window, with
// the same inline-CID footer photo as the pitch.
function buildFollowUpEmail(venue: VenueDoc, outreach: OutreachDoc): {
  subject: string; html: string; attachments: { filename: string; path: string; cid: string }[];
} {
  const contact = venue.contactName || 'there';
  const venueName = venue.name || 'your venue';
  const dates = outreach.targetDates || 'an upcoming date';
  const orig = outreach.sentAt ? fmtDate(new Date(outreach.sentAt)) : 'earlier this season';
  const subject = `Following up — Josh & Maria at ${venueName}`;
  let html = [
    `<p>Hi ${contact},</p>`,
    `<p>Just following up on my note from ${orig} about Josh &amp; Maria — my wife and I are a husband-wife `
      + `acoustic duo here in Salem, VA. We'd still love to be considered for a slot at ${venueName} around ${dates}.</p>`,
    "<p>Completely understand if the calendar's full; even a later window would be great. "
      + 'Happy to send more live samples or work around your schedule.</p>',
    '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br><a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
  ].join('\n');
  const attachments = [];
  const assetPath = resolveFooterAsset('footer-josh-maria');
  /* istanbul ignore else */
  if (assetPath) {
    html += footerHtml();
    attachments.push({ filename: 'josh-maria.jpg', path: assetPath, cid: 'footerphoto' });
  }
  return { subject, html, attachments };
}

class OutreachController extends Controller {
  async authorize(req: AuthRequest, required: string[]): Promise<AuthzResult> { // eslint-disable-line class-methods-use-this
    let user: AuthedUser | null;
    try { user = await userModel.findById(req.user || '') as unknown as AuthedUser | null; } catch (e) {
      return { status: 500, message: (e as Error).message };
    }
    if (!user) return { status: 401, message: 'user not found' };
    return checkAccess(user, required);
  }

  // Read the singleton auto-approve config (#844). Absent doc => auto-approve OFF
  // (the safe default — every batch needs a human until Josh turns it on).
  async getConfig(): Promise<{ autoApprove: boolean }> {
    const cfg = await outreachConfigModel.findOne({ key: 'outreach' }) as { autoApprove?: boolean } | null;
    return { autoApprove: !!(cfg && cfg.autoApprove) };
  }

  // Send authorization (#844): a human holding outreach:approve may always send;
  // anyone else (an agent with only outreach:create, already checked by the
  // caller) may send ONLY when auto-approve is configured ON. Returns null when
  // sending is allowed, else the error to relay.
  async canSend(req: AuthRequest): Promise<AuthzResult> {
    const approveErr = await this.authorize(req, ['outreach:approve']);
    if (!approveErr) return null;
    if (approveErr.status !== 403) return approveErr;
    let cfg: { autoApprove: boolean };
    try { cfg = await this.getConfig(); } catch (e) { return { status: 500, message: (e as Error).message }; }
    if (!cfg.autoApprove) return { status: 403, message: 'sending requires approval — auto-approve is off' };
    return null;
  }

  static buildListFilter(query: Record<string, unknown>): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (typeof query.venueId === 'string') filter.venueId = query.venueId;
    if (typeof query.status === 'string') filter.status = query.status;
    return filter;
  }

  // GET /outreach — list outreach records (filters: venueId, status).
  async listOutreach(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, OUTREACH_ANY_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const query = (req.query || {}) as Record<string, unknown>;
    let records: Record<string, unknown>[];
    try { records = await this.model.find(OutreachController.buildListFilter(query)); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    return res.status(200).json(records);
  }

  // GET /outreach/:id
  async getOutreach(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, OUTREACH_ANY_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Find id is invalid' });
    let doc;
    try { doc = await this.model.findById(req.params.id); } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (!doc) return res.status(400).json({ message: 'nothing found with id provided' });
    return res.status(200).json(doc);
  }

  // PUT /outreach/:id — update campaign lifecycle (status) or backfill the
  // gmailThreadId. Used to mark replied/declined/booked by hand or by the
  // reply-detection job (#825).
  async updateOutreach(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['outreach:edit']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Update id is invalid' });
    }
    const body = (req.body || {}) as UpdateBody;
    if (body.status !== undefined && OUTREACH_STATUSES.indexOf(body.status) === -1) {
      return res.status(400).json({ message: 'status not valid' });
    }
    const update: Record<string, unknown> = { lastModifiedBy: resolveActor(req, body) };
    if (body.status !== undefined) update.status = body.status;
    // Halting a campaign must clear any pending cadence touch so a halted record
    // can NEVER fire a follow-up (#850). The cadence engine only advances `sent`
    // records, so moving to any other status (replied/declined/booked/no-response)
    // means there is no next touch — null it out rather than leave a stale date.
    if (body.status !== undefined && body.status !== 'sent') update.nextTouchDue = null;
    if (body.gmailThreadId !== undefined) update.gmailThreadId = body.gmailThreadId;
    let doc;
    try { doc = await this.model.findByIdAndUpdate(req.params.id, update); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    if (!doc) return res.status(400).json({ message: 'Id Not Found' });
    return res.status(200).json(doc);
  }

  // DELETE /outreach/:id — hard-delete an outreach record (#857). Outreach is a
  // log, not a venue, so a bad / test / mis-sent record is removed outright
  // rather than archived. Requires outreach:delete.
  async deleteOutreach(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['outreach:delete']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Delete id is invalid' });
    }
    let doc;
    try { doc = await this.model.findByIdAndDelete(req.params.id); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    if (!doc) return res.status(400).json({ message: 'Id Not Found' });
    return res.status(200).json(doc);
  }

  // Resolve a venue's relationship stage (#848). An explicit venue.relationshipStage
  // wins; otherwise auto-derive: a currently-booked venue, or one with a prior
  // outreach that got a reply or a booking, is `returning`; everything else is `cold`.
  async resolveStage(venue: VenueDoc): Promise<'cold' | 'returning'> {
    if (venue.relationshipStage === 'cold' || venue.relationshipStage === 'returning') return venue.relationshipStage;
    if (venue.bookingStatus === 'booked') return 'returning';
    const prior = await this.model.findOne({ venueId: String(venue._id), status: { $in: ['replied', 'booked'] } });
    return prior ? 'returning' : 'cold';
  }

  // Pick the active template for a type + stage (#848). Cold also matches legacy
  // templates with no stage set. A `returning` request with no returning variant
  // yet falls back to the cold template, so sends never break before the
  // returning copy is authored.
  async findTemplate(type: string, stage: 'cold' | 'returning'): Promise<TemplateDoc | null> { // eslint-disable-line class-methods-use-this
    const coldMatch = { type, active: true, $or: [{ stage: 'cold' }, { stage: { $exists: false } }, { stage: null }] };
    if (stage === 'returning') {
      const returning = await templateModel.findOne({ type, active: true, stage: 'returning' }) as unknown as TemplateDoc | null;
      if (returning) return returning;
    }
    return await templateModel.findOne(coldMatch) as unknown as TemplateDoc | null;
  }

  // Load + validate the venue and template for a send and run the dedup guard.
  // Returns a ready context, or an error envelope for the caller to relay.
  // requireEligible (default true): the venue must be VETTED (outreachEligible) —
  // the core #844 safety guard. Turned off for preview, which is read-only.
  // skipDedup (default false): suppress the "already-pitched" check (preview).
  async resolvePitch(body: SendBody, opts: ResolveOpts = {}): Promise<PitchContext> {
    const { skipDedup = false, requireEligible = true } = opts;
    let venue: VenueDoc | null;
    try { venue = await venueModel.findById(body.venueId || '') as unknown as VenueDoc | null; } catch (e) {
      return { error: { status: 500, message: (e as Error).message } };
    }
    if (!venue) return { error: { status: 400, message: 'venue not found' } };
    if (venue.status === 'archived') return { error: { status: 400, message: 'venue is archived' } };
    if (requireEligible && !venue.outreachEligible) {
      return { error: { status: 400, message: 'venue is not outreach-eligible (not vetted)' } };
    }
    if (!venue.email) return { error: { status: 400, message: 'venue has no email to pitch' } };

    // Dedup guard first — refuse a duplicate before doing template work.
    if (!skipDedup) {
      let dupe;
      try {
        dupe = await this.model.findOne({ venueId: body.venueId, targetDates: body.targetDates, status: { $in: ACTIVE_STATUSES } });
      } catch (e) { return { error: { status: 500, message: (e as Error).message } }; }
      if (dupe) {
        return { error: { status: 409, message: 'an active outreach already exists for this venue and target dates', outreach: dupe } };
      }
    }

    // Template type: explicit caller value > per-venue override > venue's type (#848).
    const type = (body.templateType || venue.templateOverride || venue.venueType || '').trim();
    if (!type) return { error: { status: 400, message: 'no templateType and venue has no venueType' } };

    let template: TemplateDoc | null;
    try {
      const stage = await this.resolveStage(venue);
      template = await this.findTemplate(type, stage);
    } catch (e) {
      return { error: { status: 500, message: (e as Error).message } };
    }
    if (!template) return { error: { status: 400, message: `no active template for type ${type}` } };

    return { venue, template, type };
  }

  // The single place an email actually leaves: render + send + write the outreach
  // record as `sent` with cadence touch 1. Returns a result envelope so both the
  // single-send and batch paths can relay/aggregate it.
  async performSend(venue: VenueDoc, template: TemplateDoc, type: string, body: SendBody, actor: string): Promise<SendResult> {
    const { subject, html, attachments } = buildPitchEmail(venue, template, body);
    let sent: { messageId: string };
    try {
      sent = await sendMail({ to: venue.email || '', cc: body.cc || PITCH_CC, subject, html, attachments });
    } catch (e) { return { ok: false, status: 502, message: `email send failed: ${(e as Error).message}` }; }

    const sentAt = new Date();
    const fields = {
      venueId: String(venue._id), templateUsed: type, targetDates: body.targetDates, bookingPeriod: body.bookingPeriod,
      sentAt, status: 'sent', messageId: sent.messageId, sentBy: actor, lastModifiedBy: actor,
      step: 1, nextTouchDue: nextTouchDueAfter(1, sentAt),
    };
    let record;
    try { record = await this.model.create(fields); } catch (e) { return { ok: false, status: 500, message: (e as Error).message }; }

    // Best-effort: stamp the venue's lastContacted (non-critical, swallow errors).
    try {
      await venueModel.findByIdAndUpdate(String(venue._id), { lastContacted: new Date(), lastModifiedBy: actor });
    } catch { /* best-effort */ }
    return { ok: true, record };
  }

  // POST /outreach/send — send ONE pitch immediately to a vetted venue (#844). No
  // draft step: the venue being outreachEligible is the approval. Authz: a human
  // (outreach:approve) always; an agent (outreach:create) only when auto-approve
  // is ON. Use /outreach/batch for a whole approved target list.
  async sendPitch(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, OUTREACH_SEND_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const body = (req.body || {}) as SendBody;
    if (!body.venueId || !mongoose.Types.ObjectId.isValid(body.venueId)) {
      return res.status(400).json({ message: 'valid venueId is required' });
    }
    if (!body.targetDates || !body.targetDates.trim()) {
      return res.status(400).json({ message: 'targetDates is required' });
    }
    const sendErr = await this.canSend(req);
    if (sendErr) return res.status(sendErr.status).json({ message: sendErr.message });

    const ctx = await this.resolvePitch(body);
    if (ctx.error) return res.status(ctx.error.status).json({ message: ctx.error.message, outreach: ctx.error.outreach });
    const { venue, template, type } = ctx as Required<PitchContext>;
    const result = await this.performSend(venue, template, type, body, resolveActor(req, body));
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    return res.status(201).json(result.record);
  }

  // POST /outreach/batch — send the approved target list (#844). Body:
  // { venueIds[], targetDates, bookingPeriod?, templateType? }. Same authz as
  // /send. Each venue is independently resolved (eligibility + dedup) and sent;
  // failures are collected in `skipped` rather than aborting the batch.
  async sendBatch(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, OUTREACH_SEND_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const body = (req.body || {}) as BatchBody;
    if (!Array.isArray(body.venueIds) || body.venueIds.length === 0) {
      return res.status(400).json({ message: 'venueIds (non-empty array) is required' });
    }
    if (!body.targetDates || !body.targetDates.trim()) {
      return res.status(400).json({ message: 'targetDates is required' });
    }
    const sendErr = await this.canSend(req);
    if (sendErr) return res.status(sendErr.status).json({ message: sendErr.message });

    const actor = resolveActor(req, body);
    const result: { requested: number; sent: number; skipped: { venueId: string; reason: string }[]; records: unknown[] } = {
      requested: body.venueIds.length, sent: 0, skipped: [], records: [],
    };
    for (const venueId of body.venueIds) {
      if (!mongoose.Types.ObjectId.isValid(venueId)) { result.skipped.push({ venueId, reason: 'invalid id' }); continue; }
      const sendBody = { targetDates: body.targetDates, bookingPeriod: body.bookingPeriod, cc: body.cc };
      // eslint-disable-next-line no-await-in-loop
      const ctx = await this.resolvePitch({ venueId, templateType: body.templateType, ...sendBody });
      if (ctx.error) { result.skipped.push({ venueId, reason: ctx.error.message }); continue; }
      const { venue, template, type } = ctx as Required<PitchContext>;
      // eslint-disable-next-line no-await-in-loop
      const r = await this.performSend(venue, template, type, sendBody, actor);
      if (!r.ok) { result.skipped.push({ venueId, reason: r.message }); continue; }
      result.sent += 1; result.records.push(r.record);
    }
    return res.status(200).json(result);
  }

  // GET /outreach/candidates — propose the target list (#844): vetted
  // (outreachEligible), non-archived venues with an email, minus any that already
  // have an active outreach for the given targetDates. Read-only. Optional query:
  // targetDates (to exclude already-pitched venues for that window).
  async getCandidates(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, OUTREACH_ANY_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    let venues: { _id?: unknown }[];
    try {
      venues = await venueModel.find({ outreachEligible: true, status: { $ne: 'archived' }, email: { $nin: [null, ''] } });
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }

    const targetDates = typeof (req.query || {}).targetDates === 'string' ? (req.query as { targetDates: string }).targetDates : undefined;
    let handled = new Set<string>();
    if (targetDates) {
      let active: { venueId?: unknown }[];
      try { active = await this.model.find({ targetDates, status: { $in: ACTIVE_STATUSES } }); } catch (e) {
        return res.status(500).json({ message: (e as Error).message });
      }
      handled = new Set(active.map((a) => String(a.venueId)));
    }
    const candidates = venues.filter((v) => !handled.has(String(v._id)));
    return res.status(200).json(candidates);
  }

  // GET /outreach/preview — render the exact email a venue would get, WITHOUT
  // sending and WITHOUT requiring eligibility, so the approval UI (#1133) can
  // show Josh the real copy while he curates the list. Query: venueId (required),
  // templateType?, targetDates?, bookingPeriod?.
  async previewByVenue(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, OUTREACH_ANY_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const q = (req.query || {}) as { venueId?: string; templateType?: string; targetDates?: string; bookingPeriod?: string };
    if (!q.venueId || !mongoose.Types.ObjectId.isValid(q.venueId)) return res.status(400).json({ message: 'valid venueId is required' });
    const ctx = await this.resolvePitch(
      { venueId: q.venueId, templateType: q.templateType, targetDates: q.targetDates, bookingPeriod: q.bookingPeriod },
      { skipDedup: true, requireEligible: false },
    );
    if (ctx.error) return res.status(ctx.error.status).json({ message: ctx.error.message });
    const { venue, template } = ctx as Required<PitchContext>;
    const { subject, html } = buildPitchEmail(venue, template, { targetDates: q.targetDates, bookingPeriod: q.bookingPeriod } as SendBody);
    return res.status(200).json({ to: venue.email, cc: PITCH_CC, subject, html });
  }

  // GET /outreach/config — read the auto-approve setting (#844).
  async getOutreachConfig(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, OUTREACH_ANY_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    let cfg: { autoApprove: boolean };
    try { cfg = await this.getConfig(); } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    return res.status(200).json(cfg);
  }

  // PUT /outreach/config — toggle auto-approve (#844). Only the human approver
  // (outreach:approve) may change the trust setting; an agent cannot self-grant.
  async setOutreachConfig(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['outreach:approve']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const body = (req.body || {}) as ConfigBody;
    if (typeof body.autoApprove !== 'boolean') return res.status(400).json({ message: 'autoApprove (boolean) is required' });
    const actor = resolveActor(req, body);
    const doc = { key: 'outreach', autoApprove: body.autoApprove, lastModifiedBy: actor };
    let cfg: { autoApprove?: boolean } | null;
    try {
      cfg = await outreachConfigModel.findOneAndUpdate({ key: 'outreach' }, doc);
      if (!cfg) cfg = await outreachConfigModel.create(doc) as { autoApprove?: boolean };
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    return res.status(200).json({ autoApprove: !!(cfg && cfg.autoApprove) });
  }

  // Send one due email follow-up for an outreach record and reschedule it, or
  // park it as no-response once the sequence is exhausted. Returns the per-record
  // outcome ('sent' | 'parked' | 'skipped'). Helper for advanceCadence.
  async processDue(o: OutreachDoc): Promise<'sent' | 'parked' | 'skipped'> {
    if ((o.step || 1) >= MAX_STEP) {
      try {
        await this.model.findByIdAndUpdate(String(o._id), { status: 'no-response', nextTouchDue: null, lastModifiedBy: 'cadence-engine' });
        return 'parked';
      } catch { return 'skipped'; }
    }
    let venue: VenueDoc | null;
    try { venue = await venueModel.findById(String(o.venueId)) as unknown as VenueDoc | null; } catch { return 'skipped'; }
    if (!venue || venue.status === 'archived' || !venue.email) return 'skipped';

    const touchNum = (o.step || 1) + 1;
    const { subject, html, attachments } = buildFollowUpEmail(venue, o);
    let sent: { messageId: string };
    try { sent = await sendMail({ to: venue.email, cc: PITCH_CC, subject, html, attachments }); } catch { return 'skipped'; }

    const followUps = [...(o.followUps || []), { sentAt: new Date(), messageId: sent.messageId, step: touchNum }];
    try {
      await this.model.findByIdAndUpdate(String(o._id), {
        step: touchNum,
        nextTouchDue: nextTouchDueAfter(touchNum, new Date(o.sentAt || Date.now())),
        followUps,
        lastModifiedBy: 'cadence-engine',
      });
      return 'sent';
    } catch { return 'skipped'; }
  }

  // POST /outreach/advance — cadence tick. Sends every email follow-up that's due
  // (status 'sent', nextTouchDue <= now), reschedules it, and parks exhausted
  // sequences as no-response. Meant to be hit on a schedule (Deno Cron, #100).
  // Reply-detection + call touches arrive with the Google integration (#825); for
  // now a venue reply is marked by hand via PUT /outreach/:id, which halts it.
  async advanceCadence(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['outreach:edit']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const now = new Date();
    let due: OutreachDoc[];
    try { due = await this.model.find({ status: 'sent', nextTouchDue: { $ne: null, $lte: now } }) as unknown as OutreachDoc[]; } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    const result = { processed: due.length, sent: 0, parked: 0, skipped: 0 };
    for (const o of due) {
      const outcome = await this.processDue(o); // eslint-disable-line no-await-in-loop
      result[outcome] += 1;
    }
    return res.status(200).json(result);
  }
}

export default new OutreachController(outreachModel) as unknown as Icontroller;
