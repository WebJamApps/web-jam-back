import { Request, Response } from 'express';
import { Icontroller } from '#src/lib/routeUtils.js';
import userModel from '../user/user-facade.js';
import venueMiningSweepModel from './venue-mining-sweep-schema.js';

// Role fallback for human admins who authorize by role (no privileges array).
// AI agents pass via the venue-mining:create capability on the shared web-jam-llm identity.
const ALLOWED_ROLES = new Set(['JaM-admin', 'Developer']);
const REQUIRED_CAPABILITY = 'venue-mining:create';

export interface AuthedUser {
  userType?: string;
  privileges?: string[];
}

export type AuthRequest = Request & { user?: string };
export type AuthzError = { status: number; message: string };
export type AuthzResult = AuthzError | null;

export interface PublicationBody {
  name: string;
  url: string;
  api?: string;
  type?: string;
}

export interface SweepBody {
  metroSlug: string;
  sweptAt: string | Date;
  publication: PublicationBody;
  coverageArea?: string[];
  excludeKeywords?: string[];
  venuesCreatedCount: number;
  notes?: string;
}

// Privilege-first, role-fallback authorization gate.
export function toUtcMidnight(dateInput: string | Date | number): Date {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return d;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function checkAccess(user: AuthedUser): AuthzResult {
  const privileges = user.privileges || [];
  if (privileges.length) {
    if (!privileges.includes(REQUIRED_CAPABILITY)) {
      return { status: 403, message: `missing ${REQUIRED_CAPABILITY} capability` };
    }
    return null;
  }
  if (!ALLOWED_ROLES.has(user.userType || '')) {
    return { status: 403, message: 'not authorized for venue mining sweeps' };
  }
  return null;
}

function validatePublication(pub: unknown): string {
  if (!pub || typeof pub !== 'object' || Array.isArray(pub)) {
    return 'publication is required and must be an object';
  }
  const p = pub as Record<string, unknown>;
  if (typeof p.name !== 'string' || !p.name.trim()) return 'publication.name is required';
  if (typeof p.url !== 'string' || !p.url.trim()) return 'publication.url is required';
  if (p.api !== undefined && typeof p.api !== 'string') return 'publication.api must be a string';
  if (p.type !== undefined && typeof p.type !== 'string') return 'publication.type must be a string';
  return '';
}

function validateStringArray(arr: unknown, name: string): string {
  if (arr !== undefined && (!Array.isArray(arr) || !arr.every((item) => typeof item === 'string'))) {
    return `${name} must be an array of strings`;
  }
  return '';
}

// Validate POST body fields according to issue specifications.
export function validateSweepBody(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'request body must be an object';
  }
  const b = body as Record<string, unknown>;
  if (typeof b.metroSlug !== 'string' || !b.metroSlug.trim()) {
    return 'metroSlug is required';
  }
  if (
    !b.sweptAt
    || typeof b.sweptAt === 'boolean'
    || Number.isNaN(new Date(b.sweptAt as string | number | Date).getTime())
  ) {
    return 'sweptAt must be a valid date';
  }
  const pubErr = validatePublication(b.publication);
  if (pubErr) return pubErr;
  if (
    b.venuesCreatedCount === undefined
    || typeof b.venuesCreatedCount !== 'number'
    || !Number.isInteger(b.venuesCreatedCount)
    || b.venuesCreatedCount < 0
  ) {
    return 'venuesCreatedCount must be an integer >= 0';
  }
  const covErr = validateStringArray(b.coverageArea, 'coverageArea');
  if (covErr) return covErr;
  const exclErr = validateStringArray(b.excludeKeywords, 'excludeKeywords');
  if (exclErr) return exclErr;
  if (b.notes !== undefined && typeof b.notes !== 'string') {
    return 'notes must be a string';
  }
  return '';
}

export class VenueMiningSweepController {
  model: typeof venueMiningSweepModel;

  constructor(model: typeof venueMiningSweepModel = venueMiningSweepModel) {
    this.model = model;
  }

  // Load the authenticated user and verify privileges/roles.
  async authorize(req: AuthRequest): Promise<AuthzResult> { // eslint-disable-line class-methods-use-this
    let user: AuthedUser | null;
    try {
      user = await userModel.findById(req.user || '') as unknown as AuthedUser | null;
    } catch (e) {
      return { status: 500, message: (e as Error).message };
    }
    if (!user) return { status: 401, message: 'user not found' };
    return checkAccess(user);
  }

  // POST /venue-mining/sweep — record one completed metro sweep.
  async createSweep(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });

    const invalid = validateSweepBody(req.body);
    if (invalid) return res.status(400).json({ message: invalid });

    const body = req.body as SweepBody;
    const sweptDate = toUtcMidnight(body.sweptAt);

    try {
      const existing = await this.model.findOne({
        metroSlug: body.metroSlug.trim(),
        sweptAt: sweptDate,
      });
      if (existing) {
        return res.status(409).json({ message: 'Sweep for this metro and date already exists' });
      }
    } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }

    const pub: PublicationBody = {
      name: body.publication.name.trim(),
      url: body.publication.url.trim(),
    };
    if (typeof body.publication.api === 'string') pub.api = body.publication.api.trim();
    if (typeof body.publication.type === 'string') pub.type = body.publication.type.trim();

    const createPayload: Record<string, unknown> = {
      metroSlug: body.metroSlug.trim(),
      sweptAt: sweptDate,
      publication: pub,
      venuesCreatedCount: body.venuesCreatedCount,
      createdAt: new Date(),
    };
    if (body.coverageArea !== undefined) createPayload.coverageArea = body.coverageArea;
    if (body.excludeKeywords !== undefined) createPayload.excludeKeywords = body.excludeKeywords;
    if (typeof body.notes === 'string') createPayload.notes = body.notes.trim();

    let doc;
    try {
      doc = await this.model.create(createPayload);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        return res.status(409).json({ message: 'Sweep for this metro and date already exists' });
      }
      return res.status(500).json({ message: (e as Error).message });
    }
    return res.status(201).json(doc);
  }

  // GET /venue-mining/sweep — return sweep history (newest first, optional ?metroSlug=<slug>).
  async listSweeps(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });

    const filter: Record<string, unknown> = {};
    if (typeof req.query.metroSlug === 'string' && req.query.metroSlug.trim()) {
      filter.metroSlug = req.query.metroSlug.trim();
    }

    let sweeps;
    try {
      sweeps = await this.model.find(filter).sort({ sweptAt: -1, createdAt: -1 }).lean().exec();
    } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    return res.status(200).json(sweeps);
  }
}

export default new VenueMiningSweepController(venueMiningSweepModel) as unknown as Icontroller;
