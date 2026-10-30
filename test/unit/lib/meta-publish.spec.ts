import { publishToInstagram } from '#src/lib/meta-publish.js';
const key = { userId: 'account', accessToken: 'fixture-key', issuedAt: new Date() };
const tags = [{ username: 'chemmariasherman', x: 0.25, y: 0.85 }, { username: 'venue', x: 0.75, y: 0.85 }];
describe('Instagram publishing', () => {
  afterEach(() => vi.restoreAllMocks());
  it('creates and publishes a v25.0 container with both tag positions', async () => {
    const http = vi.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({ id: 'container' }))
      .mockResolvedValueOnce(Response.json({ id: 'post' }));
    expect(await publishToInstagram('Caption', 'https://example.com/image.jpg', tags, key)).toEqual({ ok: true, id: 'post' });
    expect(http.mock.calls.map(([url]) => url)).toEqual([
      'https://graph.instagram.com/v25.0/account/media', 'https://graph.instagram.com/v25.0/account/media_publish',
    ]);
    const form = new URLSearchParams(http.mock.calls[0][1]?.body as string);
    expect(form.get('image_url')).toBe('https://example.com/image.jpg');
    expect(form.get('caption')).toBe('Caption');
    expect(JSON.parse(form.get('user_tags')!)).toEqual(tags);
    expect(form.get('access_token')).toBe(key.accessToken);
    expect(new URLSearchParams(http.mock.calls[1][1]?.body as string).get('creation_id')).toBe('container');
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
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({ id: 'container' })).mockResolvedValueOnce(Response.json(response));
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
