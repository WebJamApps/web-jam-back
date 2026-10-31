import type { InstagramKey } from './instagram-key-schema.js';

const GRAPH = 'https://graph.instagram.com/v25.0';
export interface LegResult { ok: boolean; id?: string; error?: string }
export interface InstagramTag { username: string; x: number; y: number }
interface GraphResponse { id?: string; error?: { message?: string } }

async function postForm(url: string, params: Record<string, string>): Promise<GraphResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json() as GraphResponse;
  if (!response.ok && !result.error) return { error: { message: 'Instagram request failed' } };
  return result;
}

export async function publishToInstagram(
  caption: string, imageUrl: string, tags: InstagramTag[], key: InstagramKey,
): Promise<LegResult> {
  try {
    const container = await postForm(`${GRAPH}/${encodeURIComponent(key.userId)}/media`, {
      image_url: imageUrl, caption, access_token: key.accessToken, user_tags: JSON.stringify(tags),
    });
    if (container.error || !container.id) {
      return { ok: false, error: container.error?.message || 'Instagram media container creation failed' };
    }
    const published = await postForm(`${GRAPH}/${encodeURIComponent(key.userId)}/media_publish`, {
      creation_id: container.id, access_token: key.accessToken,
    });
    if (published.error || !published.id) {
      return { ok: false, error: published.error?.message || 'Instagram publish failed' };
    }
    return { ok: true, id: published.id };
  } catch {
    return { ok: false, error: 'Instagram request could not be completed' };
  }
}
