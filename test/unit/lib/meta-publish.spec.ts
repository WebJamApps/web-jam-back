// Unit tests for the gig-announce Meta Graph API clients (#962). Every test
// mocks global.fetch — NEVER a real network call to Meta, per the repo's hard
// safety rule for this feature.
import {
  publishToInstagram, publishToFacebookPage, isMetaFullyUnconfigured,
} from '#src/lib/meta-publish.js';

const ENV_KEYS = ['META_IG_USER_ID', 'META_IG_ACCESS_TOKEN', 'META_FB_PAGE_ID', 'META_FB_PAGE_ACCESS_TOKEN'] as const;

describe('meta-publish (#962)', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {};
    for (const k of ENV_KEYS) { original[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    vi.restoreAllMocks();
  });

  describe('isMetaFullyUnconfigured', () => {
    it('is true when no env var is set', () => {
      expect(isMetaFullyUnconfigured()).toBe(true);
    });

    it('is false when only the Instagram pair is set', () => {
      process.env.META_IG_USER_ID = 'ig-user';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
      expect(isMetaFullyUnconfigured()).toBe(false);
    });

    it('is false when only the Facebook pair is set', () => {
      process.env.META_FB_PAGE_ID = 'page-id';
      process.env.META_FB_PAGE_ACCESS_TOKEN = 'page-token';
      expect(isMetaFullyUnconfigured()).toBe(false);
    });
  });

  describe('publishToInstagram', () => {
    it('errors clearly when not configured, without calling fetch', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const result = await publishToInstagram('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: expect.stringContaining('META_IG_USER_ID') });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('creates a media container then publishes it (two calls)', async () => {
      process.env.META_IG_USER_ID = 'ig-user';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: 'container-1' }) } as Response)
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: 'media-1' }) } as Response);

      const result = await publishToInstagram('Great show tonight!', 'https://example.com/img.jpg');

      expect(result).toEqual({ ok: true, id: 'media-1' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const firstUrl = fetchSpy.mock.calls[0][0] as string;
      expect(firstUrl).toContain('/ig-user/media');
      const secondUrl = fetchSpy.mock.calls[1][0] as string;
      expect(secondUrl).toContain('/ig-user/media_publish');
    });

    it('surfaces a Graph error on container creation without attempting publish', async () => {
      process.env.META_IG_USER_ID = 'ig-user';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ json: () => Promise.resolve({ error: { message: 'bad image url' } }) } as Response);

      const result = await publishToInstagram('caption', 'not-a-real-url');

      expect(result).toEqual({ ok: false, error: 'bad image url' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('surfaces a Graph error on the publish step', async () => {
      process.env.META_IG_USER_ID = 'ig-user';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: 'container-1' }) } as Response)
        .mockResolvedValueOnce({ json: () => Promise.resolve({ error: { message: 'token expired' } }) } as Response);

      const result = await publishToInstagram('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: 'token expired' });
    });

    it('catches a network exception as a leg failure, never throwing', async () => {
      process.env.META_IG_USER_ID = 'ig-user';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

      const result = await publishToInstagram('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: 'network down' });
    });

    it('falls back to a generic message when the container response has neither error nor id', async () => {
      process.env.META_IG_USER_ID = 'ig-user';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({ json: () => Promise.resolve({}) } as Response);

      const result = await publishToInstagram('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: 'Instagram media container creation failed' });
    });

    it('falls back to a generic message when the publish response has neither error nor id', async () => {
      process.env.META_IG_USER_ID = 'ig-user';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: 'container-1' }) } as Response)
        .mockResolvedValueOnce({ json: () => Promise.resolve({}) } as Response);

      const result = await publishToInstagram('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: 'Instagram publish failed' });
    });
  });

  describe('publishToFacebookPage', () => {
    it('errors clearly when not configured, without calling fetch', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const result = await publishToFacebookPage('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: expect.stringContaining('META_FB_PAGE_ID') });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('posts the image + caption to the page photos edge', async () => {
      process.env.META_FB_PAGE_ID = 'page-id';
      process.env.META_FB_PAGE_ACCESS_TOKEN = 'page-token';
      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: 'photo-1' }) } as Response);

      const result = await publishToFacebookPage('Great show tonight!', 'https://example.com/img.jpg');

      expect(result).toEqual({ ok: true, id: 'photo-1' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/page-id/photos');
    });

    it('surfaces a Graph error', async () => {
      process.env.META_FB_PAGE_ID = 'page-id';
      process.env.META_FB_PAGE_ACCESS_TOKEN = 'page-token';
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ json: () => Promise.resolve({ error: { message: 'permission denied' } }) } as Response);

      const result = await publishToFacebookPage('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: 'permission denied' });
    });

    it('catches a network exception as a leg failure, never throwing', async () => {
      process.env.META_FB_PAGE_ID = 'page-id';
      process.env.META_FB_PAGE_ACCESS_TOKEN = 'page-token';
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

      const result = await publishToFacebookPage('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: 'network down' });
    });

    it('falls back to a generic message when the response has neither error nor id', async () => {
      process.env.META_FB_PAGE_ID = 'page-id';
      process.env.META_FB_PAGE_ACCESS_TOKEN = 'page-token';
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({ json: () => Promise.resolve({}) } as Response);

      const result = await publishToFacebookPage('caption', 'https://example.com/img.jpg');
      expect(result).toEqual({ ok: false, error: 'Facebook post failed' });
    });
  });
});
