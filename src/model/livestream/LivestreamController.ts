import { Request, Response } from 'express';
import Debug from 'debug';

const debug = Debug('web-jam-back:LivestreamController');

// Each search.list call costs 100 of the 10,000/day free quota units, so we
// cache the resolved result for 15 minutes to avoid exhausting the quota.
const CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

export interface LivestreamResult {
  videoId: string | null;
  status: 'live' | 'completed' | 'none';
}

let cache: { value: LivestreamResult; at: number } | null = null;

// test-only hook to reset the module-level cache between cases
export const __clearCache = (): void => { cache = null; };

class LivestreamController {
  private async search(eventType: 'live' | 'completed'): Promise<string | null> {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      eventType,
      order: 'date',
      maxResults: '1',
      channelId: process.env.YOUTUBE_CHANNEL_ID || /* istanbul ignore next */ '',
      key: process.env.YOUTUBE_API_KEY || /* istanbul ignore next */ '',
    });
    const res = await fetch(`${SEARCH_URL}?${params.toString()}`);
    if (!res.ok) throw new Error(`YouTube API responded ${res.status}`);
    const body = await res.json() as { items?: Array<{ id?: { videoId?: string } }> };
    return body.items?.[0]?.id?.videoId || null;
  }

  async getCurrent(_req: Request, res: Response): Promise<void> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      res.json(cache.value);
      return;
    }
    // Not configured yet → let the UI fall back to plain links (no API call).
    if (!process.env.YOUTUBE_API_KEY || !process.env.YOUTUBE_CHANNEL_ID) {
      res.json({ videoId: null, status: 'none' });
      return;
    }
    let result: LivestreamResult = { videoId: null, status: 'none' };
    try {
      const live = await this.search('live');
      if (live) result = { videoId: live, status: 'live' };
      else {
        const completed = await this.search('completed');
        if (completed) result = { videoId: completed, status: 'completed' };
      }
      cache = { value: result, at: Date.now() }; // cache only successful lookups
    } catch (err) {
      // Don't cache failures; return 'none' so the UI falls back gracefully.
      debug('livestream lookup failed: %s', (err as Error).message);
    }
    res.json(result);
  }
}

export default LivestreamController;
