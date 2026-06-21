import { Request, Response } from 'express';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import { sendMail } from '#src/lib/mailer.js';
import outreachModel from './outreach-facade.js';
import venueModel from '../venue/venue-facade.js';
import templateModel from '../template/template-facade.js';
import userModel from '../user/user-facade.js';

// Every gig pitch CCs Josh + Maria so they see each send land (mirrors the
// InquiryController CC precedent). Maria's address is the same one inquiries CC.
const PITCH_CC = ['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com'];

// An active campaign — a pitch already out for this venue + window — must not be
// re-sent (no double-pitching). Declined / no-response / booked are terminal, so
// only these two block a new send.
const ACTIVE_STATUSES = ['sent', 'replied'];

const ALLOWED_ROLES = ['JaM-admin', 'Developer'];
const OUTREACH_WRITE_CAPS = ['outreach:create', 'outreach:edit', 'outreach:delete'];

interface AuthedUser { userType?: string; privileges?: string[] }
type AuthRequest = Request & { user?: string };
type AuthIdRequest = Request<{ id: string }> & { user?: string };
type AuthzError = { status: number; message: string; outreach?: unknown };
type AuthzResult = AuthzError | null;
interface PitchContext { error?: AuthzError; venue?: VenueDoc; template?: TemplateDoc; type?: string }

interface SendBody {
  venueId?: string;
  templateType?: string;
  targetDates?: string;
  bookingPeriod?: string;
  actor?: string;
  cc?: string | string[];
}

interface UpdateBody { status?: string; gmailThreadId?: string; actor?: string }

interface VenueDoc { _id?: unknown; name?: string; email?: string; contactName?: string; venueType?: string; status?: string }
interface TemplateDoc { type?: string; subject?: string; bodyHtml?: string; footerPhotoRef?: string }

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

class OutreachController extends Controller {
  async authorize(req: AuthRequest, required: string[]): Promise<AuthzResult> { // eslint-disable-line class-methods-use-this
    let user: AuthedUser | null;
    try { user = await userModel.findById(req.user || '') as unknown as AuthedUser | null; } catch (e) {
      return { status: 500, message: (e as Error).message };
    }
    if (!user) return { status: 401, message: 'user not found' };
    return checkAccess(user, required);
  }

  static buildListFilter(query: Record<string, unknown>): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (typeof query.venueId === 'string') filter.venueId = query.venueId;
    if (typeof query.status === 'string') filter.status = query.status;
    return filter;
  }

  // GET /outreach — list outreach records (filters: venueId, status).
  async listOutreach(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, OUTREACH_WRITE_CAPS);
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
    const guardErr = await this.authorize(req, OUTREACH_WRITE_CAPS);
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
    if (body.gmailThreadId !== undefined) update.gmailThreadId = body.gmailThreadId;
    let doc;
    try { doc = await this.model.findByIdAndUpdate(req.params.id, update); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    if (!doc) return res.status(400).json({ message: 'Id Not Found' });
    return res.status(200).json(doc);
  }

  // Load + validate the venue and template for a send and run the dedup guard.
  // Returns a ready context, or an error envelope for sendPitch to relay. Pulls
  // the bulk of the branching out of sendPitch.
  async resolvePitch(body: SendBody): Promise<PitchContext> {
    let venue: VenueDoc | null;
    try { venue = await venueModel.findById(body.venueId || '') as unknown as VenueDoc | null; } catch (e) {
      return { error: { status: 500, message: (e as Error).message } };
    }
    if (!venue) return { error: { status: 400, message: 'venue not found' } };
    if (venue.status === 'archived') return { error: { status: 400, message: 'venue is archived' } };
    if (!venue.email) return { error: { status: 400, message: 'venue has no email to pitch' } };

    const type = (body.templateType || venue.venueType || '').trim();
    if (!type) return { error: { status: 400, message: 'no templateType and venue has no venueType' } };

    let template: TemplateDoc | null;
    try { template = await templateModel.findOne({ type, active: true }) as unknown as TemplateDoc | null; } catch (e) {
      return { error: { status: 500, message: (e as Error).message } };
    }
    if (!template) return { error: { status: 400, message: `no active template for type ${type}` } };

    // Dedup guard — refuse if a pitch is already live for this venue + window.
    let dupe;
    try {
      dupe = await this.model.findOne({ venueId: body.venueId, targetDates: body.targetDates, status: { $in: ACTIVE_STATUSES } });
    } catch (e) { return { error: { status: 500, message: (e as Error).message } }; }
    if (dupe) {
      return { error: { status: 409, message: 'an active outreach already exists for this venue and target dates', outreach: dupe } };
    }
    return { venue, template, type };
  }

  // POST /outreach/send — render a template for a venue, email the pitch
  // (CC Josh + Maria, footer photo inline), and write the outreach record.
  async sendPitch(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['outreach:create']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const body = (req.body || {}) as SendBody;
    if (!body.venueId || !mongoose.Types.ObjectId.isValid(body.venueId)) {
      return res.status(400).json({ message: 'valid venueId is required' });
    }
    if (!body.targetDates || !body.targetDates.trim()) {
      return res.status(400).json({ message: 'targetDates is required' });
    }

    const ctx = await this.resolvePitch(body);
    if (ctx.error) return res.status(ctx.error.status).json({ message: ctx.error.message, outreach: ctx.error.outreach });
    const { venue, template, type } = ctx as Required<PitchContext>;

    const { subject, html, attachments } = buildPitchEmail(venue, template, body);
    const actor = resolveActor(req, body);
    let sent: { messageId: string };
    try {
      sent = await sendMail({
        to: venue.email || '', cc: body.cc || PITCH_CC, subject, html, attachments,
      });
    } catch (e) { return res.status(502).json({ message: `email send failed: ${(e as Error).message}` }); }

    let record;
    try {
      record = await this.model.create({
        venueId: body.venueId,
        templateUsed: type,
        targetDates: body.targetDates,
        sentAt: new Date(),
        status: 'sent',
        messageId: sent.messageId,
        sentBy: actor,
        lastModifiedBy: actor,
      });
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }

    // Best-effort: stamp the venue's lastContacted so the UI/cadence can sort by
    // it. A failure here must not undo a successful send, so it is swallowed.
    try {
      await venueModel.findByIdAndUpdate(String(body.venueId), { lastContacted: new Date(), lastModifiedBy: actor });
    } catch { /* best-effort: lastContacted is non-critical */ }

    return res.status(201).json(record);
  }
}

export default new OutreachController(outreachModel) as unknown as Icontroller;
