import app from '#src/index.js';
import request from '../../helpers/api.js';
import { __clearCache } from '#src/model/livestream/LivestreamController.js';

// The test client (request(app)) uses global fetch to hit the app over HTTP, so
// we only intercept calls to the YouTube API and pass everything else through.
const realFetch = globalThis.fetch.bind(globalThis);
const ytBody = (videoId?: string) => ({
  ok: true,
  json: async () => ({ items: videoId ? [{ id: { videoId } }] : [] }),
});

function stubYouTube(...responses: any[]) {
  const yt = vi.fn();
  responses.forEach((r) => yt.mockResolvedValueOnce(r));
  vi.stubGlobal('fetch', (url: any, init: any) => (
    String(url).startsWith('https://www.googleapis.com/youtube')
      ? yt(url)
      : realFetch(url, init)
  ));
  return yt;
}

describe('Livestream Router GET /livestream/current', () => {
  const origKey = process.env.YOUTUBE_API_KEY;
  const origChannel = process.env.YOUTUBE_CHANNEL_ID;

  beforeEach(() => { __clearCache(); });
  afterEach(() => {
    if (origKey === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = origKey;
    if (origChannel === undefined) delete process.env.YOUTUBE_CHANNEL_ID; else process.env.YOUTUBE_CHANNEL_ID = origChannel;
    vi.unstubAllGlobals();
  });

  it('returns none (no API call) when not configured', async () => {
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_CHANNEL_ID;
    const yt = stubYouTube();
    const r = await request(app).get('/livestream/current');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ videoId: null, status: 'none' });
    expect(yt).not.toHaveBeenCalled();
  });

  it('returns the active live stream when the channel is live', async () => {
    process.env.YOUTUBE_API_KEY = 'k';
    process.env.YOUTUBE_CHANNEL_ID = 'c';
    stubYouTube(ytBody('LIVE123'));
    const r = await request(app).get('/livestream/current');
    expect(r.body).toEqual({ videoId: 'LIVE123', status: 'live' });
  });

  it('falls back to the latest completed stream when not live', async () => {
    process.env.YOUTUBE_API_KEY = 'k';
    process.env.YOUTUBE_CHANNEL_ID = 'c';
    const yt = stubYouTube(ytBody(undefined), ytBody('DONE456'));
    const r = await request(app).get('/livestream/current');
    expect(r.body).toEqual({ videoId: 'DONE456', status: 'completed' });
    expect(yt).toHaveBeenCalledTimes(2);
  });

  it('returns none when neither live nor completed is found', async () => {
    process.env.YOUTUBE_API_KEY = 'k';
    process.env.YOUTUBE_CHANNEL_ID = 'c';
    stubYouTube(ytBody(undefined), ytBody(undefined));
    const r = await request(app).get('/livestream/current');
    expect(r.body).toEqual({ videoId: null, status: 'none' });
  });

  it('returns none on YouTube API error (and does not cache it)', async () => {
    process.env.YOUTUBE_API_KEY = 'k';
    process.env.YOUTUBE_CHANNEL_ID = 'c';
    stubYouTube({ ok: false, status: 403, json: async () => ({}) });
    const r = await request(app).get('/livestream/current');
    expect(r.body).toEqual({ videoId: null, status: 'none' });
  });

  it('serves the cached result without calling the API again', async () => {
    process.env.YOUTUBE_API_KEY = 'k';
    process.env.YOUTUBE_CHANNEL_ID = 'c';
    const yt = stubYouTube(ytBody('LIVE123'));
    await request(app).get('/livestream/current'); // populates cache
    const r2 = await request(app).get('/livestream/current'); // served from cache
    expect(r2.body).toEqual({ videoId: 'LIVE123', status: 'live' });
    expect(yt).toHaveBeenCalledTimes(1);
  });
});
