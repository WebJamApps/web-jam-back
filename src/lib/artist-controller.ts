import { Request, Response } from 'express';
import Controller from './controller.js';
import type { AuthRequest } from '../auth/authUtils.js';
import { DEFAULT_ARTIST, normalizeArtist, artistListFilter } from './artist.js';

// Base controller for collections shared across artists/tenants (#885): gigs and
// the `book` collection (JaMmusic slideshow photos + per-artist bio/page-content).
// It layers artist scoping onto the generic CRUD controller:
//   - reads are filtered by the `?artist=` query (legacy field-less records read
//     as the default artist), so nothing an existing front-end sees changes;
//   - writes stamp the record's artist and stop an artist-SCOPED admin from
//     touching another artist's records.
//
// Who is "scoped": any user whose account carries an `artist` slug (set at login
// from the ArtistAdmins config, e.g. Tim). Josh and every legacy account have no
// artist slug, so they are UNSCOPED — their pre-#885 write behaviour is
// unchanged. Coarse route access is still governed by the existing AUTH_ROLES
// guard; this only adds per-record ownership on top.
type AnyDoc = Record<string, unknown>;

class ArtistController extends Controller {
  // The single artist the caller is scoped to, or null (unscoped: Josh / ordinary
  // accounts). Public GETs run without auth, so this is null there too.
  scopedArtist(req: Request): string | null { // eslint-disable-line class-methods-use-this
    const artist = (req as AuthRequest).userArtist;
    return typeof artist === 'string' && artist ? artist : null;
  }

  // 403 (returns false) when a scoped admin targets a record outside their
  // artist, or tries to move a record to another artist. Otherwise true.
  // eslint-disable-next-line class-methods-use-this
  private guardScopedArtist(req: Request, res: Response, scope: string, recordArtist: unknown): boolean {
    const owns = normalizeArtist(recordArtist) === scope;
    const bodyArtist = (req.body as AnyDoc)?.artist;
    const keepsArtist = bodyArtist === undefined || normalizeArtist(bodyArtist) === scope;
    if (owns && keepsArtist) return true;
    res.status(403).json({ message: 'not authorized for this artist' });
    return false;
  }

  // Public list, scoped by ?artist=.
  async find(req: Request, res: Response): Promise<unknown> {
    let collection;
    try { collection = await this.model.find(artistListFilter(req.query as AnyDoc)); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    return res.status(200).json(collection);
  }

  // Public single fetch (e.g. GET /book/one for a bio doc), scoped by ?artist=.
  async findOne(req: Request, res: Response): Promise<unknown> {
    let doc;
    try { doc = await this.model.findOne(artistListFilter(req.query as AnyDoc)); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    if (!doc || doc._id === null || doc._id === undefined) return res.status(400).json({ message: 'invalid request' });
    return res.status(200).json(doc);
  }

  // Stamp the record's artist: forced to a scoped admin's artist, otherwise the
  // (unscoped) caller may pass one, defaulting to the original artist.
  async create(req: Request, res: Response): Promise<unknown> {
    const scope = this.scopedArtist(req);
    (req.body as AnyDoc).artist = scope || normalizeArtist((req.body as AnyDoc).artist);
    return super.create(req, res);
  }

  async findByIdAndUpdate(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    const scope = this.scopedArtist(req);
    if (scope) {
      const existing = await this.model.findById(req.params.id).catch(() => null);
      if (!this.guardScopedArtist(req, res, scope, existing?.artist)) return undefined;
    }
    return super.findByIdAndUpdate(req, res);
  }

  async findByIdAndDelete(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    const scope = this.scopedArtist(req);
    if (scope) {
      const existing = await this.model.findById(req.params.id).catch(() => null);
      if (!this.guardScopedArtist(req, res, scope, existing?.artist)) return undefined;
    }
    return super.findByIdAndDelete(req, res);
  }

  // Update-by-query (e.g. PUT /book/one). Scope the match to the caller's artist
  // and stamp it on the write so a scoped admin can only edit their own doc.
  async findOneAndUpdate(req: Request, res: Response): Promise<unknown> {
    const scope = this.scopedArtist(req);
    const query = scope
      ? { ...(req.query as AnyDoc), artist: scope }
      : artistListFilter(req.query as AnyDoc);
    if (scope) (req.body as AnyDoc).artist = scope;
    else if ((req.body as AnyDoc).artist !== undefined) (req.body as AnyDoc).artist = normalizeArtist((req.body as AnyDoc).artist);
    let updated;
    try { updated = await this.model.findOneAndUpdate(query, req.body); } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    if (updated === null || updated === undefined) return res.status(400).json({ message: 'invalid request' });
    return res.status(200).json(updated);
  }
}

export { DEFAULT_ARTIST };
export default ArtistController;
