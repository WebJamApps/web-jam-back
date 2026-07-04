import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import templateModel from './template-facade.js';
import userModel from '../user/user-facade.js';

const TEMPLATE_TYPES = ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar', 'OnlineForm'];
const TEMPLATE_STAGES = ['cold', 'returning'];

// Role fallback for human admins who authorize by role (no privileges array).
// AI agents pass via the template:* capabilities on the shared web-jam-llm
// identity. Mirrors VenueController (#819).
const ALLOWED_ROLES = ['JaM-admin', 'Developer'];

// Write capabilities. Reads are gated by holding ANY of these (or the admin
// role) — this repo has no `:read` capabilities by convention.
const TEMPLATE_WRITE_CAPS = ['template:create', 'template:edit', 'template:delete'];

interface AuthedUser { userType?: string; privileges?: string[] }
type AuthRequest = Request & { user?: string };
type AuthIdRequest = Request<{ id: string }> & { user?: string };
type AuthzError = { status: number; message: string };
type AuthzResult = AuthzError | null;

interface TemplateBody {
  _id?: string;
  type?: string;
  stage?: string;
  subject?: string;
  // introHtml (#903) — the addressable intro (greeting + opening line),
  // split out from bodyHtml so a per-send customIntro can replace it.
  introHtml?: string;
  bodyHtml?: string;
  footerPhotoRef?: string;
  active?: boolean;
  actor?: string;
}

// The actor that performed a write: an explicit `actor` (stamped by the MCP
// server / agent) wins; otherwise fall back to the authenticated token subject.
function resolveActor(req: AuthRequest, body: TemplateBody): string {
  return (body.actor || '').trim() || req.user || '';
}

// Reject a write body up front. Returns an error message, or '' when valid.
// `partial` (PUT) only validates the fields that are present. `type` is required
// on create and must be one of the known types.
function validateBody(body: TemplateBody, partial: boolean): string {
  if (!partial || body.type !== undefined) {
    if (!body.type || !body.type.trim()) return 'type is required';
  }
  if (body.type !== undefined && TEMPLATE_TYPES.indexOf(body.type) === -1) return 'type not valid';
  if (body.stage !== undefined && TEMPLATE_STAGES.indexOf(body.stage) === -1) return 'stage not valid';
  return '';
}

// The pre-#848 schema had a unique index on `type` alone; #848 moved uniqueness
// to (type, stage). Mongoose never drops a replaced index, so the legacy
// `type_1` would still reject a second template for the same type (e.g. a
// `returning` variant). Drop it once, lazily, on the first create — idempotent,
// connection-guarded so unit tests (no live DB) skip it. Mirrors
// FacebookController's key_1 drop.
interface IndexDroppable { Schema: { collection: { dropIndex(name: string): Promise<unknown> } } }
let legacyTypeIndexDropped = false;
async function dropLegacyTypeIndex(model: IndexDroppable): Promise<void> {
  if (legacyTypeIndexDropped) return;
  legacyTypeIndexDropped = true;
  /* istanbul ignore next */
  if (mongoose.connection.readyState !== 1) return;
  /* istanbul ignore next */
  try { await model.Schema.collection.dropIndex('type_1'); } catch { /* already dropped */ }
}

// Privilege-first, role-fallback gate (mirrors VenueController/PromoController).
function checkAccess(user: AuthedUser, required: string[]): AuthzResult {
  const privileges = user.privileges || [];
  if (privileges.length) {
    if (!privileges.some((p) => required.indexOf(p) !== -1)) {
      return { status: 403, message: `missing ${required.join('/')} capability` };
    }
    return null;
  }
  if (ALLOWED_ROLES.indexOf(user.userType || '') === -1) {
    return { status: 403, message: 'not authorized for template management' };
  }
  return null;
}

class TemplateController extends Controller {
  // Load the token's user, then apply the access gate. Every template route runs
  // ensureAuthenticated first (valid token → req.user); this adds authorization.
  async authorize(req: AuthRequest, required: string[]): Promise<AuthzResult> { // eslint-disable-line class-methods-use-this
    let user: AuthedUser | null;
    try { user = await userModel.findById(req.user || '') as unknown as AuthedUser | null; } catch (e) {
      return { status: 500, message: (e as Error).message };
    }
    if (!user) return { status: 401, message: 'user not found' };
    return checkAccess(user, required);
  }

  // Build the Mongo filter for GET /template from whitelisted query params.
  static buildListFilter(query: Record<string, unknown>): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (typeof query.type === 'string') filter.type = query.type;
    if (typeof query.stage === 'string') filter.stage = query.stage;
    if (query.active === 'true') filter.active = true;
    if (query.active === 'false') filter.active = false;
    return filter;
  }

  // GET /template — list templates (filters: type, active).
  async listTemplates(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, TEMPLATE_WRITE_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    const query = (req.query || {}) as Record<string, unknown>;
    let templates: Record<string, unknown>[];
    try { templates = await this.model.find(TemplateController.buildListFilter(query)); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    return res.status(200).json(templates);
  }

  // GET /template/:id
  async getTemplate(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, TEMPLATE_WRITE_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Find id is invalid' });
    let doc;
    try { doc = await this.model.findById(req.params.id); } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (!doc) return res.status(400).json({ message: 'nothing found with id provided' });
    return res.status(200).json(doc);
  }

  // One template per (type, stage) — dedupe on both so re-creating a known
  // type+stage updates it instead of duplicating (#848). A body without a stage
  // defaults to `cold`, matching the schema default.
  async findDuplicate(body: TemplateBody): Promise<Record<string, unknown> | null> {
    return this.model.findOne({ type: body.type, stage: body.stage || 'cold' });
  }

  // POST /template — create a template, or upsert onto the existing one for that
  // type (dedupe). A matched template is re-activated.
  async createTemplate(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['template:create']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    await dropLegacyTypeIndex(this.model as unknown as IndexDroppable);
    const body = (req.body || {}) as TemplateBody;
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
          ...body, active: body.active === undefined ? true : body.active, lastModifiedBy: actor,
        });
      } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
      return res.status(200).json(updated);
    }
    let doc;
    try {
      doc = await this.model.create({ ...body, active: body.active === undefined ? true : body.active, lastModifiedBy: actor });
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    return res.status(201).json(doc);
  }

  // PUT /template/:id — partial update.
  async updateTemplate(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['template:edit']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Update id is invalid' });
    const body = (req.body || {}) as TemplateBody;
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

  // DELETE /template/:id — soft-delete (active:false), never a hard remove, so a
  // template's history survives a fat-fingered delete. Mirrors VenueController.
  async deleteTemplate(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, ['template:delete']);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Delete id is invalid' });
    const actor = resolveActor(req, (req.body || {}) as TemplateBody);
    let doc;
    try {
      doc = await this.model.findByIdAndUpdate(req.params.id, { active: false, lastModifiedBy: actor });
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }
    if (!doc) return res.status(400).json({ message: 'Delete id is invalid' });
    return res.status(200).json({ message: 'Template was deactivated successfully', template: doc });
  }
}

export default new TemplateController(templateModel) as unknown as Icontroller;
