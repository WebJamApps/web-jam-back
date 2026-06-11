import { Request, Response } from 'express';
import Debug from 'debug';
import { sendMail } from '../../lib/mailer.js';
import FacebookToken from './facebook-schema.js';

const debug = Debug('web-jam-back:FacebookController');

// Pinned Graph API version. Meta supports each version for >=2 years; expired
// versions don't hard-fail (calls auto-forward to the oldest still-supported
// one), and the four fields below are stable core fields. Bump when convenient.
// See README "Facebook feed" section.
export const FB_GRAPH_VERSION = 'v20.0';
const GRAPH = `https://graph.facebook.com/${FB_GRAPH_VERSION}`;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // hourly
const PAGE_FIELDS = 'message,full_picture,permalink_url,created_time';

export interface FbPost {
  id?: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  created_time?: string;
}

interface FeedCache { posts: FbPost[]; lastUpdated: string | null }
interface GraphError { code?: number; message?: string }

// Module-level state. `alertSent` keeps the token-death email to one per process
// per outage; it resets on the next healthy refresh. Heroku's ~daily dyno
// restart resets it too, so a dead token re-nags about once a day until fixed
// (intentional).
let cache: FeedCache = { posts: [], lastUpdated: null };
let alertSent = false;
let timer: ReturnType<typeof setInterval> | null = null;

// test-only hooks
export const __reset = (): void => {
  cache = { posts: [], lastUpdated: null };
  alertSent = false;
  /* istanbul ignore if */
  if (timer) { clearInterval(timer); timer = null; }
};
export const __getState = (): { cache: FeedCache; alertSent: boolean } => ({ cache, alertSent });

async function readToken(): Promise<string> {
  const doc = await FacebookToken.findOne({ key: 'pageToken' }).lean().exec() as { value?: string } | null;
  return doc?.value || '';
}

async function writeToken(value: string): Promise<void> {
  await FacebookToken.findOneAndUpdate(
    { key: 'pageToken' },
    { value, updatedAt: new Date() },
    { upsert: true },
  ).exec();
}

// Email Josh once per outage when the page token is dead (Graph OAuth code 190).
async function handleDeadToken(): Promise<void> {
  debug('facebook page token is dead (code 190)');
  if (alertSent) return;
  alertSent = true;
  try {
    await sendMail({
      to: process.env.GMAIL_USER || /* istanbul ignore next */ '',
      subject: 'CollegeLutheran: Facebook feed token is dead',
      html: 'The CollegeLutheran Facebook feed page token has expired or been invalidated. '
        + 'Log into the CollegeLutheran admin page and click <b>Reconnect Facebook</b> to restore it.',
    });
  } catch (err) /* istanbul ignore next */ {
    debug('alert email failed: %s', (err as Error).message);
  }
}

// Refresh the in-memory feed cache from the page's published posts. On any
// failure the last good cache keeps serving; a 190 also triggers the alert.
export async function updateFacebookCache(): Promise<void> {
  const token = await readToken();
  if (!token) { debug('no page token stored yet; skipping refresh'); return; }
  const params = new URLSearchParams({
    fields: PAGE_FIELDS,
    limit: '5',
    access_token: token,
  });
  try {
    // `/posts` (not `/feed`) → page-published posts only, no visitor-post perms.
    const res = await fetch(`${GRAPH}/${process.env.FB_PAGE_ID || ''}/posts?${params.toString()}`);
    const body = await res.json() as { data?: FbPost[]; error?: GraphError };
    if (body.error) {
      if (body.error.code === 190) await handleDeadToken();
      else debug('graph error: %o', body.error);
      return; // keep last good cache
    }
    cache = { posts: body.data || [], lastUpdated: new Date().toISOString() };
    alertSent = false; // healthy again — re-arm the alert
  } catch (err) {
    debug('facebook refresh failed: %s', (err as Error).message);
  }
}

// short-lived user token -> long-lived user token -> never-expiring page token.
// The app secret stays server-side, which is why this can't happen in-browser.
async function exchangeForPageToken(userToken: string): Promise<string> {
  const llParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.FB_APP_ID || '',
    client_secret: process.env.FB_APP_SECRET || '',
    fb_exchange_token: userToken,
  });
  const llRes = await fetch(`${GRAPH}/oauth/access_token?${llParams.toString()}`);
  const llBody = await llRes.json() as { access_token?: string; error?: GraphError };
  if (llBody.error || !llBody.access_token) throw new Error(llBody.error?.message || 'long-lived token exchange failed');

  const accRes = await fetch(`${GRAPH}/me/accounts?access_token=${encodeURIComponent(llBody.access_token)}`);
  const accBody = await accRes.json() as { data?: Array<{ id: string; access_token: string }>; error?: GraphError };
  if (accBody.error) throw new Error(accBody.error.message || 'failed to list pages');
  const page = (accBody.data || []).find((p) => p.id === process.env.FB_PAGE_ID);
  if (!page) throw new Error('CollegeLutheran page not found in /me/accounts');
  return page.access_token;
}

// Kick off the startup refresh + hourly interval. No-ops under test so unit
// tests never hit the network or leave a timer running.
export function startFacebookRefresh(): void {
  /* istanbul ignore if */
  if (process.env.NODE_ENV === 'test') return;
  /* istanbul ignore next */
  void updateFacebookCache();
  /* istanbul ignore next */
  timer = setInterval(() => { void updateFacebookCache(); }, REFRESH_INTERVAL_MS);
}

class FacebookController {
  // Public, no auth. Serves the cached posts; empty until a token is set.
  async getFeed(_req: Request, res: Response): Promise<void> {
    res.json(cache);
  }

  // Admin-only (guarded by routeUtils.makeAction + AUTH_ROLES.facebook). Takes a
  // short-lived FB user token from the admin page, derives + stores the page
  // token, and refreshes the cache immediately.
  async updateToken(req: Request, res: Response): Promise<void> {
    const userToken = (req.body as { userToken?: string } | undefined)?.userToken;
    if (!userToken) { res.status(400).json({ message: 'userToken is required' }); return; }
    try {
      const pageToken = await exchangeForPageToken(userToken);
      await writeToken(pageToken);
      await updateFacebookCache();
      res.json({ lastUpdated: cache.lastUpdated });
    } catch (err) {
      res.status(400).json({ message: (err as Error).message });
    }
  }
}

export default FacebookController;
