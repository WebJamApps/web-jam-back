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

const EMPTY: FeedCache = { posts: [], lastUpdated: null };

// The registered pages, as a pageId -> display-name map from FB_PAGES (one Meta
// app, many pages: CollegeLutheran + WebJamLLC). During the env rollout, if
// FB_PAGES is unset we fall back to the legacy single FB_PAGE_ID so the service
// keeps serving CollegeLutheran until FB_PAGES is deployed.
function getPages(): Record<string, string> {
  let pages: Record<string, string> = {};
  try {
    const parsed = JSON.parse(process.env.FB_PAGES || '{}') as Record<string, string>;
    if (parsed && typeof parsed === 'object') pages = parsed;
  } catch { /* malformed FB_PAGES — fall through to the FB_PAGE_ID fallback */ }
  if (Object.keys(pages).length === 0 && process.env.FB_PAGE_ID) {
    pages[process.env.FB_PAGE_ID] = 'CollegeLutheran';
  }
  return pages;
}

// Back-compat default for callers that omit pageId (the already-deployed CLC
// frontend): the CollegeLutheran page id in FB_PAGE_ID, else the first
// registered page.
function defaultPageId(): string {
  return process.env.FB_PAGE_ID || Object.keys(getPages())[0] || '';
}

// Module-level state, keyed by pageId. `alertSent` keeps the token-death email
// to one per page per outage; it resets on that page's next healthy refresh.
// Heroku's ~daily dyno restart resets it too, so a dead token re-nags about
// once a day until fixed (intentional).
const caches = new Map<string, FeedCache>();
const alertSent = new Map<string, boolean>();
let timer: ReturnType<typeof setInterval> | null = null;

// test-only hooks. __getState defaults to the back-compat (CLC) page.
export const __reset = (): void => {
  caches.clear();
  alertSent.clear();
  /* istanbul ignore if */
  if (timer) { clearInterval(timer); timer = null; }
};
export const __getState = (pageId = defaultPageId()): { cache: FeedCache; alertSent: boolean } => ({
  cache: caches.get(pageId) || EMPTY,
  alertSent: alertSent.get(pageId) || false,
});

async function readToken(pageId: string): Promise<string> {
  const doc = await FacebookToken.findOne({ pageId }).lean().exec() as { value?: string } | null;
  return doc?.value || '';
}

async function writeToken(pageId: string, value: string): Promise<void> {
  await FacebookToken.findOneAndUpdate(
    { pageId },
    { pageId, value, updatedAt: new Date() },
    { upsert: true },
  ).exec();
}

// One-time migration of the single-page era doc (keyed `key: 'pageToken'`,
// web-jam-back#797) to the new pageId keying, so CollegeLutheran survives the
// multi-page deploy without a manual reconnect. Also drops the stale unique
// `key_1` index, which would otherwise reject a second page's doc (both null
// `key`). Idempotent.
export async function migrateLegacyToken(): Promise<void> {
  const coll = FacebookToken.collection;
  /* istanbul ignore next */
  try { await coll.dropIndex('key_1'); } catch { /* already dropped */ }
  const legacy = await coll.findOne({ key: 'pageToken' }) as { value?: string } | null;
  if (!legacy?.value) return;
  const pageId = defaultPageId();
  await coll.updateOne(
    { pageId },
    { $set: { pageId, value: legacy.value, updatedAt: new Date() } },
    { upsert: true },
  );
  await coll.deleteOne({ key: 'pageToken' });
  debug('migrated legacy pageToken doc to pageId %s', pageId);
}

// Email Josh once per outage when a page token is dead (Graph OAuth code 190).
// The alert names the page so he knows which one to reconnect.
async function handleDeadToken(pageId: string): Promise<void> {
  debug('facebook page token is dead (code 190) for %s', pageId);
  if (alertSent.get(pageId)) return;
  alertSent.set(pageId, true);
  const name = getPages()[pageId] || pageId;
  try {
    await sendMail({
      to: process.env.GMAIL_USER || /* istanbul ignore next */ '',
      subject: `${name}: Facebook feed token is dead`,
      html: `The ${name} Facebook feed page token has expired or been invalidated. `
        + `Log into the ${name} admin page and click <b>Reconnect Facebook</b> to restore it.`,
    });
  } catch (err) /* istanbul ignore next */ {
    debug('alert email failed: %s', (err as Error).message);
  }
}

// Refresh one page's in-memory feed cache from its published posts. On any
// failure the last good cache keeps serving; a 190 also triggers the alert.
async function refreshPage(pageId: string): Promise<void> {
  const token = await readToken(pageId);
  if (!token) { debug('no page token stored for %s; skipping refresh', pageId); return; }
  const params = new URLSearchParams({
    fields: PAGE_FIELDS,
    limit: '5',
    access_token: token,
  });
  try {
    // `/posts` (not `/feed`) → page-published posts only, no visitor-post perms.
    const res = await fetch(`${GRAPH}/${pageId}/posts?${params.toString()}`);
    const body = await res.json() as { data?: FbPost[]; error?: GraphError };
    if (body.error) {
      if (body.error.code === 190) await handleDeadToken(pageId);
      else debug('graph error for %s: %o', pageId, body.error);
      return; // keep last good cache
    }
    caches.set(pageId, { posts: body.data || [], lastUpdated: new Date().toISOString() });
    alertSent.set(pageId, false); // healthy again — re-arm the alert
  } catch (err) {
    debug('facebook refresh failed for %s: %s', pageId, (err as Error).message);
  }
}

// Refresh every registered page. Called on startup and hourly.
export async function updateFacebookCache(): Promise<void> {
  await Promise.all(Object.keys(getPages()).map((pageId) => refreshPage(pageId)));
}

// short-lived user token -> long-lived user token -> never-expiring page token,
// for the given page. The app secret stays server-side, which is why this can't
// happen in-browser.
async function exchangeForPageToken(userToken: string, pageId: string): Promise<string> {
  const llParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.FB_APP_ID || '',
    client_secret: process.env.FB_APP_SECRET || '',
    fb_exchange_token: userToken,
  });
  const llRes = await fetch(`${GRAPH}/oauth/access_token?${llParams.toString()}`);
  const llBody = await llRes.json() as { access_token?: string; error?: GraphError };
  if (llBody.error || !llBody.access_token) throw new Error(llBody.error?.message || 'long-lived token exchange failed');

  // Read the page token straight from the page node. We deliberately do NOT use
  // /me/accounts: "New Pages Experience" pages (e.g. WebJamLLC) don't appear
  // there even when the user is an admin, which 400'd the reconnect. The page
  // node works for both classic and new pages and returns the same page token.
  const name = getPages()[pageId] || pageId;
  const pageRes = await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${encodeURIComponent(llBody.access_token)}`);
  const pageBody = await pageRes.json() as { access_token?: string; error?: GraphError };
  if (pageBody.error || !pageBody.access_token) {
    throw new Error(pageBody.error?.message || `${name} page token not available — are you an admin of this page?`);
  }
  return pageBody.access_token;
}

// Kick off the legacy-token migration, startup refresh, and hourly interval.
// No-ops under test so unit tests never hit the network or leave a timer running.
export function startFacebookRefresh(): void {
  /* istanbul ignore if */
  if (process.env.NODE_ENV === 'test') return;
  /* istanbul ignore next */
  migrateLegacyToken()
    .then(() => { void updateFacebookCache(); })
    .catch(() => { /* startup migration failed; the hourly refresh still runs */ });
  /* istanbul ignore next */
  timer = setInterval(() => { void updateFacebookCache(); }, REFRESH_INTERVAL_MS);
}

class FacebookController {
  // Public, no auth. Serves the cached posts for ?pageId (default: CollegeLutheran
  // for back-compat); empty until that page's token is set.
  async getFeed(req: Request, res: Response): Promise<void> {
    const pageId = (req.query.pageId as string) || defaultPageId();
    res.json(caches.get(pageId) || EMPTY);
  }

  // Admin-only (guarded by routeUtils.makeAction + AUTH_ROLES.facebook). Takes a
  // short-lived FB user token + pageId from the admin page, derives + stores that
  // page's token, and refreshes its cache immediately. pageId defaults to the CLC
  // page so the existing CLC reconnect flow keeps working before it sends one.
  async updateToken(req: Request, res: Response): Promise<void> {
    const body = req.body as { userToken?: string; pageId?: string } | undefined;
    const userToken = body?.userToken;
    if (!userToken) { res.status(400).json({ message: 'userToken is required' }); return; }
    const pageId = body?.pageId || defaultPageId();
    try {
      const pageToken = await exchangeForPageToken(userToken, pageId);
      await writeToken(pageId, pageToken);
      await refreshPage(pageId);
      res.json({ pageId, lastUpdated: caches.get(pageId)?.lastUpdated ?? null });
    } catch (err) {
      res.status(400).json({ message: (err as Error).message });
    }
  }
}

export default FacebookController;
