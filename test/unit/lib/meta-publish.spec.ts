import { CONTAINER_MAX_POLLS, CONTAINER_POLL_MS, getInstagramKey, publishToInstagram } from '#src/lib/meta-publish.js';

const key = { userId: 'account', accessToken: 'fixture-key' };
const finished = () => Response.json({ status_code: 'FINISHED' });
const tags = [{ username: 'chemmariasherman', x: 0.25, y: 0.85 }, { username: 'venue', x: 0.75, y: 0.85 }];

describe('Instagram publishing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('publishToInstagram', () => {
    it('creates, waits for the container to finish, then publishes a v25.0 container with both tag positions', async () => {
      const http = vi.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({ id: 'container' }))
        .mockResolvedValueOnce(finished()).mockResolvedValueOnce(Response.json({ id: 'post' }));
      expect(await publishToInstagram('Caption', 'https://example.com/image.jpg', tags, key)).toEqual({ ok: true, id: 'post' });
      const urls = http.mock.calls.map(([url]) => String(url));
      expect(urls).toHaveLength(3);
      expect(urls[0]).toBe('https://graph.facebook.com/v25.0/account/media');
      expect(urls[1].startsWith('https://graph.facebook.com/v25.0/container?')).toBe(true);
      const query = new URL(urls[1]).searchParams;
      expect(query.get('fields')).toBe('status_code,status');
      expect(query.get('access_token')).toBe(key.accessToken);
      expect(urls[2]).toBe('https://graph.facebook.com/v25.0/account/media_publish');
      const form = new URLSearchParams(http.mock.calls[0][1]?.body as string);
      expect(form.get('image_url')).toBe('https://example.com/image.jpg');
      expect(form.get('caption')).toBe('Caption');
      expect(JSON.parse(form.get('user_tags')!)).toEqual(tags);
      expect(form.get('access_token')).toBe(key.accessToken);
      expect(new URLSearchParams(http.mock.calls[2][1]?.body as string).get('creation_id')).toBe('container');
    });

    it('keeps polling while the container is IN_PROGRESS, then publishes once it is FINISHED', async () => {
      vi.useFakeTimers();
      const http = vi.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({ id: 'container' }))
        .mockResolvedValueOnce(Response.json({ status_code: 'IN_PROGRESS' }))
        .mockResolvedValueOnce(Response.json({ status_code: 'IN_PROGRESS' }))
        .mockResolvedValueOnce(finished()).mockResolvedValueOnce(Response.json({ id: 'post' }));
      const result = publishToInstagram('Caption', 'https://example.com/image.jpg', [], key);
      await vi.advanceTimersByTimeAsync(CONTAINER_POLL_MS * 2);
      expect(await result).toEqual({ ok: true, id: 'post' });
      expect(http.mock.calls.map(([url]) => String(url).split('?')[0])).toEqual([
        'https://graph.facebook.com/v25.0/account/media',
        'https://graph.facebook.com/v25.0/container', 'https://graph.facebook.com/v25.0/container', 'https://graph.facebook.com/v25.0/container',
        'https://graph.facebook.com/v25.0/account/media_publish',
      ]);
    });

    it.each([
      [{ status_code: 'ERROR', status: 'Error: Media upload has failed' }, 'Instagram could not process the image (ERROR: Error: Media upload has failed)'],
      [{ status_code: 'EXPIRED' }, 'Instagram could not process the image (EXPIRED)'],
      [{ error: { message: 'status denied' } }, 'status denied'],
      [{ error: {} }, 'Instagram container status check failed'],
    ])('does not publish when the container status check answers %j', async (status, error) => {
      const http = vi.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({ id: 'container' }))
        .mockResolvedValueOnce(Response.json(status));
      expect(await publishToInstagram('Caption', 'https://example.com/image.jpg', [], key)).toEqual({ ok: false, error });
      expect(http).toHaveBeenCalledTimes(2);
      expect(http.mock.calls.some(([url]) => String(url).endsWith('/media_publish'))).toBe(false);
    });

    it('gives up without publishing when the container is still IN_PROGRESS after the maximum polls', async () => {
      vi.useFakeTimers();
      const http = vi.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({ id: 'container' }))
        .mockImplementation(() => Promise.resolve(Response.json({ status_code: 'IN_PROGRESS' })));
      const result = publishToInstagram('Caption', 'https://example.com/image.jpg', [], key);
      await vi.advanceTimersByTimeAsync(CONTAINER_POLL_MS * CONTAINER_MAX_POLLS);
      expect(await result).toEqual({ ok: false, error: 'Instagram did not finish processing the image in time' });
      expect(http).toHaveBeenCalledTimes(1 + CONTAINER_MAX_POLLS);
      expect(http.mock.calls.some(([url]) => String(url).endsWith('/media_publish'))).toBe(false);
    });

    it.each([
      [{ error: { message: 'tag refused' } }, 'tag refused'],
      [{}, 'Instagram media container creation failed'],
    ])('refuses a failed container', async (response, error) => {
      const http = vi.spyOn(global, 'fetch').mockResolvedValue(Response.json(response));
      expect(await publishToInstagram('Caption', 'https://example.com/image.jpg', [], key)).toEqual({ ok: false, error });
      expect(http).toHaveBeenCalledTimes(1);
    });

    it.each([
      [{ error: { message: 'expired key' } }, 'expired key'],
      [{}, 'Instagram publish failed'],
    ])('passes through a publish refusal', async (response, error) => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({ id: 'container' })).mockResolvedValueOnce(finished())
        .mockResolvedValueOnce(Response.json(response));
      expect(await publishToInstagram('Caption', 'https://example.com/image.jpg', [], key)).toEqual({ ok: false, error });
    });

    it('refuses unsuccessful HTTP responses even when they contain an id', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(Response.json({ id: 'bad' }, { status: 500 }));
      expect((await publishToInstagram('Caption', 'https://example.com/image.jpg', [], key)).error).toBe('Instagram request failed');
    });

    it('does not expose request details from network exceptions', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('private request details'));
      expect((await publishToInstagram('Caption', 'https://example.com/image.jpg', [], key)).error).toBe('Instagram request could not be completed');
    });
  });

  describe('getInstagramKey', () => {
    it('reads the two Instagram settings when both are present', () => {
      vi.stubEnv('META_IG_USER_ID', 'ig-user-123');
      vi.stubEnv('META_IG_ACCESS_TOKEN', 'token-abc');
      expect(getInstagramKey()).toEqual({ userId: 'ig-user-123', accessToken: 'token-abc' });
    });

    it.each([
      ['', 'token-abc'],
      ['ig-user-123', ''],
      ['', ''],
    ])('returns null when either setting is empty string: userId="%s", token="%s"', (userId, token) => {
      vi.stubEnv('META_IG_USER_ID', userId);
      vi.stubEnv('META_IG_ACCESS_TOKEN', token);
      expect(getInstagramKey()).toBeNull();
    });

    it.each([
      ['META_IG_USER_ID', 'META_IG_ACCESS_TOKEN'],
      ['META_IG_ACCESS_TOKEN', 'META_IG_USER_ID'],
    ])('returns null when %s is absent', (absentKey, presentKey) => {
      vi.stubEnv(presentKey, 'val');
      delete process.env[absentKey];
      expect(getInstagramKey()).toBeNull();
    });
  });
});
