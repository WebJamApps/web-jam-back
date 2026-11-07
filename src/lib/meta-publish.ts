const GRAPH = 'https://graph.facebook.com/v25.0';

export interface LegResult { ok: boolean; id?: string; error?: string }
export interface InstagramTag { username: string; x: number; y: number }
export interface InstagramKey { userId: string; accessToken: string }
interface GraphResponse { id?: string; status_code?: string; status?: string; error?: { message?: string } }

export const CONTAINER_POLL_MS = 1_000;
export const CONTAINER_MAX_POLLS = 15;

export function getInstagramKey(): InstagramKey | null {
  const userId = process.env.META_IG_USER_ID;
  const accessToken = process.env.META_IG_ACCESS_TOKEN;
  if (!userId || !accessToken) return null;
  return { userId, accessToken };
}

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

async function getJson(url: string, params: Record<string, string>): Promise<GraphResponse> {
  const response = await fetch(`${url}?${new URLSearchParams(params).toString()}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json() as GraphResponse;
  if (!response.ok && !result.error) return { error: { message: 'Instagram request failed' } };
  return result;
}

const wait = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Instagram processes a new container before it can be published; publishing early answers
// "Media ID is not available". Poll the container's status_code until it is FINISHED.
// Kept under Heroku's 30-second request limit.
async function waitForContainer(containerId: string, key: InstagramKey): Promise<string | null> {
  for (let poll = 0; poll < CONTAINER_MAX_POLLS; poll += 1) {
    const container = await getJson(`${GRAPH}/${encodeURIComponent(containerId)}`, {
      fields: 'status_code,status', access_token: key.accessToken,
    });
    if (container.error) return container.error.message || 'Instagram container status check failed';
    if (container.status_code === 'FINISHED') return null;
    if (container.status_code === 'ERROR' || container.status_code === 'EXPIRED') {
      const detail = container.status ? `: ${container.status}` : '';
      return `Instagram could not process the image (${container.status_code}${detail})`;
    }
    await wait(CONTAINER_POLL_MS);
  }
  return 'Instagram did not finish processing the image in time';
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
    const notReady = await waitForContainer(container.id, key);
    if (notReady) return { ok: false, error: notReady };
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
