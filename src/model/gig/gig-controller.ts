import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Request, Response } from 'express';
import ArtistController from '../../lib/artist-controller.js';
import gigModel from './gig-facade.js';
import { Icontroller } from '../../lib/routeUtils.js';
import userModel from '../user/user-facade.js';
import { htmlCaptionToText } from '#src/lib/caption-text.js';
import { publishToInstagram, publishToFacebookPage, isMetaFullyUnconfigured } from '#src/lib/meta-publish.js';

// Role fallback for human admins who authorize by role (no privileges array).
// Mirrors TemplateController/VenueController/PromoController (#819/#822).
const ALLOWED_ROLES = ['JaM-admin', 'Developer'];
const GIG_ANNOUNCE_CAPS = ['gig:announce'];

interface AuthedUser { userType?: string; privileges?: string[] }
type AuthRequest = Request & { user?: string };
type AuthIdRequest = Request<{ id: string }> & { user?: string };
type AuthzError = { status: number; message: string };
type AuthzResult = AuthzError | null;

interface AnnounceBody {
  caption?: string;
  imageUrl?: string;
}

interface GigDoc {
  _id?: unknown;
  promoImageUrl?: string;
}

// Privilege-first, role-fallback gate (mirrors VenueController/TemplateController).
function checkAccess(user: AuthedUser, required: string[]): AuthzResult {
  const privileges = user.privileges || [];
  if (privileges.length) {
    if (!privileges.some((p) => required.indexOf(p) !== -1)) {
      return { status: 403, message: `missing ${required.join('/')} capability` };
    }
    return null;
  }
  if (ALLOWED_ROLES.indexOf(user.userType || '') === -1) {
    return { status: 403, message: 'not authorized for gig announce' };
  }
  return null;
}

// Backend's own public base URL (mirrors subscriber-controller's/promo-
// controller's selfBaseUrl) — used to build the default promo image's public
// URL, since Meta's Graph API needs an absolute, publicly-fetchable one.
function selfBaseUrl(req: Request): string {
  const proto = process.env.NODE_ENV === 'production' ? /* istanbul ignore next */ 'https' : req.protocol;
  return `${proto}://${req.get('host') ?? ''}`;
}

// Resolve the bundled default promo image (Josh & Maria's template footer
// photo, reused here as the announce-endpoint's image-of-last-resort) on
// disk. Mirrors template-controller's/outreach-controller's
// resolveFooterAsset — the compiled controller runs from build/, where
// copy:assets places the jpg; fall back to the source tree so an un-copied
// dev build still finds it.
function resolveDefaultPromoAsset(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../template/assets', 'footer-josh-maria.jpg'),
    path.resolve(process.cwd(), 'src/model/template/assets', 'footer-josh-maria.jpg'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || /* istanbul ignore next */ null;
}

// Gigs are shared across artists (#885): reads scope by ?artist=, writes stamp
// the artist and respect artist-scoped admins.
class GigController extends ArtistController {
  // Load the token's user, then apply the access gate. announce() runs
  // ensureAuthenticated first (valid token -> req.user); this adds
  // authorization on top, same pattern as TemplateController/VenueController.
  async authorize(req: AuthRequest, required: string[]): Promise<AuthzResult> { // eslint-disable-line class-methods-use-this
    let user: AuthedUser | null;
    try { user = await userModel.findById(req.user || '') as unknown as AuthedUser | null; } catch (e) {
      return { status: 500, message: (e as Error).message };
    }
    if (!user) return { status: 401, message: 'user not found' };
    return checkAccess(user, required);
  }

  // GET /gig/promo-default.jpg — public, no auth (#962). Serves the bundled
  // default promo image so Meta's Graph API can fetch a public URL for it
  // when a gig has neither an explicit imageUrl nor its own promoImageUrl.
  async getDefaultPromoImage(_req: Request, res: Response): Promise<unknown> { // eslint-disable-line class-methods-use-this
    const assetPath = resolveDefaultPromoAsset();
    if (!assetPath) return res.status(404).json({ message: 'default promo image not found' });
    return res.sendFile(assetPath);
  }

  // POST /gig/:id/announce (#962) — publish an approved caption + image to
  // Instagram and the Web Jam LLC Facebook Page. Body: { caption (TinyMCE
  // HTML, required), imageUrl (optional) }. One leg failing never blocks the
  // other (see meta-publish.ts's never-throws contract); on any leg success
  // the gig's announcedAt is stamped/updated.
  async announce(req: AuthIdRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req, GIG_ANNOUNCE_CAPS);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Find id is invalid' });

    const body = (req.body || {}) as AnnounceBody;
    if (!body.caption || !body.caption.trim()) return res.status(400).json({ message: 'caption is required' });

    if (isMetaFullyUnconfigured()) {
      return res.status(500).json({
        message: 'Meta announce is not configured: set META_IG_USER_ID, META_IG_ACCESS_TOKEN, META_FB_PAGE_ID, META_FB_PAGE_ACCESS_TOKEN',
      });
    }

    let gig: GigDoc | null;
    try { gig = await this.model.findById(req.params.id) as unknown as GigDoc | null; } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    if (!gig) return res.status(400).json({ message: 'nothing found with id provided' });

    const imageUrl = body.imageUrl || gig.promoImageUrl || `${selfBaseUrl(req)}/gig/promo-default.jpg`;
    const captionText = htmlCaptionToText(body.caption);

    const [instagram, facebook] = await Promise.all([
      publishToInstagram(captionText, imageUrl),
      publishToFacebookPage(captionText, imageUrl),
    ]);

    if (instagram.ok || facebook.ok) {
      // Stamping failure shouldn't mask the publish result the caller cares about.
      try { await this.model.findByIdAndUpdate(req.params.id, { announcedAt: new Date() }); } catch { /* ignore */ }
    }

    return res.status(200).json({ instagram, facebook });
  }
}

export default new GigController(gigModel) as unknown as Icontroller;
