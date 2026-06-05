import { Request, Response } from 'express';
import Debug from 'debug';
import { sendMail } from '#src/lib/mailer.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import subscriberModel from '../subscriber/subscriber-facade.js';
import userModel from '../user/user-facade.js';

// Shared gig-promotion send core. All three clients (admin UI, Claude, gemma)
// POST finished content here; the backend fans it out to the subscriber list.
const debug = Debug('web-jam-back:promo');

// Role fallback for callers with no privileges array (e.g. the human admin who
// passes on role today). Bots/agents pass via the promo:email capability.
const ALLOWED_ROLES = ['JaM-admin', 'Developer'];
const REQUIRED_CAPABILITY = 'promo:email';

interface AuthedUser { userType?: string; privileges?: string[] }
interface SubDoc { email: string; unsubscribeToken?: string }
type AuthRequest = Request & { user?: string };

// Backend's own public base URL for the per-recipient unsubscribe links.
function selfBaseUrl(req: Request): string {
  const proto = process.env.NODE_ENV === 'production' ? /* istanbul ignore next */ 'https' : req.protocol;
  return `${proto}://${req.get('host') ?? ''}`;
}

function unsubscribeFooter(link: string): string {
  return '<hr><p style="font-size:12px;color:#888">'
    + 'You are receiving this because you subscribed to Josh &amp; Maria Music gig updates. '
    + `<a href="${link}">Unsubscribe</a>.</p>`;
}

class PromoController {
  // Privilege-first, role-fallback authorization. Returns an error to send, or
  // null when the caller may send.
  async authorize(req: AuthRequest): Promise<{ status: number; message: string } | null> { // eslint-disable-line class-methods-use-this
    let user: AuthedUser | null;
    try {
      user = await userModel.findById(req.user || '') as unknown as AuthedUser | null;
    } catch (e) { return { status: 500, message: (e as Error).message }; }
    if (!user) return { status: 401, message: 'user not found' };
    const privileges = user.privileges || [];
    if (privileges.length) {
      if (privileges.indexOf(REQUIRED_CAPABILITY) === -1) {
        return { status: 403, message: `missing ${REQUIRED_CAPABILITY} capability` };
      }
      return null;
    }
    if (ALLOWED_ROLES.indexOf(user.userType || '') === -1) {
      return { status: 403, message: 'not authorized to send promo email' };
    }
    return null;
  }

  // POST /promo/gig/email — body: { subject, bodyHtml }. Sends to every active
  // email subscriber, appending their unsubscribe link. Sequential to stay
  // within Gmail rate limits; per-recipient failures are counted, not fatal.
  async sendGigEmail(req: AuthRequest, res: Response): Promise<unknown> {
    const guardErr = await this.authorize(req);
    if (guardErr) return res.status(guardErr.status).json({ message: guardErr.message });

    const { subject, bodyHtml } = (req.body || {}) as { subject?: string; bodyHtml?: string };
    if (!subject || !bodyHtml) return res.status(400).json({ message: 'subject and bodyHtml are required' });

    let subs: SubDoc[];
    try {
      subs = await subscriberModel.find({ status: 'active', 'channels.email': true }) as unknown as SubDoc[];
    } catch (e) { return res.status(500).json({ message: (e as Error).message }); }

    const base = selfBaseUrl(req);
    let sent = 0;
    let failed = 0;
    for (const s of subs) {
      const link = `${base}/subscriber/unsubscribe?token=${s.unsubscribeToken ?? ''}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendMail({ to: s.email, subject, html: bodyHtml + unsubscribeFooter(link) });
        sent += 1;
      } catch (e) { debug('send failed for %s: %o', s.email, e); failed += 1; }
    }
    return res.status(200).json({ sent, failed, total: subs.length });
  }
}

export default new PromoController() as unknown as Icontroller;
