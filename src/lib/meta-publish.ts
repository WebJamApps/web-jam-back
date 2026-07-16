// src/lib/meta-publish.ts — web-jam-back#962
//
// Thin Graph API clients for the two POST /gig/:id/announce legs. Both use
// plain `fetch` (Node 24 native), the same convention FacebookController
// already uses for the read-only CollegeLutheran/WebJamLLC feed — trivially
// mockable in tests via vi.spyOn(global, 'fetch'). Kept decoupled from
// FacebookController's GRAPH constant/token-refresh machinery on purpose:
// that flow reads via OAuth-refreshed page tokens stored in Mongo for
// `pages_show_list`-style access; this is a one-time-per-announce WRITE using
// its own long-lived tokens (see the two-config-per-leg env vars below),
// Josh's deliberate simpler setup for this feature (#962 issue body).
//
// Config (Heroku config vars on webjamsalem, never committed):
//   META_IG_USER_ID           — Instagram business/creator account id
//   META_IG_ACCESS_TOKEN      — long-lived token w/ instagram_content_publish
//   META_FB_PAGE_ID           — the Web Jam LLC Facebook Page id
//   META_FB_PAGE_ACCESS_TOKEN — long-lived Page token w/ pages_manage_posts

// Pinned Graph API version — mirrors FacebookController's FB_GRAPH_VERSION
// choice (Meta supports each version 2+ years; bump when convenient).
const GRAPH_VERSION = 'v20.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface LegResult { ok: boolean; id?: string; error?: string }

interface GraphError { message?: string }
interface GraphResponse { id?: string; error?: GraphError }

async function postForm(url: string, params: Record<string, string>): Promise<GraphResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return res.json() as Promise<GraphResponse>;
}

// Leg 1 — Instagram Content Publishing API: create a media container from the
// public image URL + caption, then publish it (two Graph calls against the
// IG-linked business/creator account). Never throws — every failure mode
// (missing config, a Graph error, a network error) resolves to
// `{ ok: false, error }` so a caller can run both legs with Promise.all and
// have one leg's failure never affect the other.
export async function publishToInstagram(caption: string, imageUrl: string): Promise<LegResult> {
  const igUserId = process.env.META_IG_USER_ID;
  const token = process.env.META_IG_ACCESS_TOKEN;
  if (!igUserId || !token) {
    return { ok: false, error: 'Instagram not configured: set META_IG_USER_ID and META_IG_ACCESS_TOKEN' };
  }
  try {
    const container = await postForm(`${GRAPH}/${igUserId}/media`, {
      image_url: imageUrl, caption, access_token: token,
    });
    if (container.error || !container.id) {
      return { ok: false, error: container.error?.message || 'Instagram media container creation failed' };
    }
    const published = await postForm(`${GRAPH}/${igUserId}/media_publish`, {
      creation_id: container.id, access_token: token,
    });
    if (published.error || !published.id) {
      return { ok: false, error: published.error?.message || 'Instagram publish failed' };
    }
    return { ok: true, id: published.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Leg 2 — Facebook Pages API: post the image + caption straight to the Web Jam
// LLC Page's feed via the `/photos` edge (the caption becomes the post
// message). Same never-throws contract as publishToInstagram.
export async function publishToFacebookPage(caption: string, imageUrl: string): Promise<LegResult> {
  const pageId = process.env.META_FB_PAGE_ID;
  const token = process.env.META_FB_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) {
    return { ok: false, error: 'Facebook not configured: set META_FB_PAGE_ID and META_FB_PAGE_ACCESS_TOKEN' };
  }
  try {
    const result = await postForm(`${GRAPH}/${pageId}/photos`, {
      url: imageUrl, caption, access_token: token,
    });
    if (result.error || !result.id) return { ok: false, error: result.error?.message || 'Facebook post failed' };
    return { ok: true, id: result.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// True when NEITHER leg has ANY of its env vars set — the fresh-deploy case
// where Josh hasn't done the manual Meta app/token setup yet (issue #962's
// manual setup steps). The announce endpoint 500s outright in that case
// (a clear "not configured" response) rather than returning two
// per-leg "not configured" errors that read like a bug instead of a
// not-yet-set-up feature. Partial configuration (one leg set, one not) is NOT
// this case — it proceeds and lets the unconfigured leg fail on its own, same
// as any other single-leg failure.
export function isMetaFullyUnconfigured(): boolean {
  return !process.env.META_IG_USER_ID && !process.env.META_IG_ACCESS_TOKEN
    && !process.env.META_FB_PAGE_ID && !process.env.META_FB_PAGE_ACCESS_TOKEN;
}
