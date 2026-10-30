import type { InstagramKey } from '#src/lib/instagram-key-schema.js';
const db = vi.hoisted(() => ({ read: vi.fn(), seed: vi.fn(), updateOne: vi.fn() }));
const mail = vi.hoisted(() => vi.fn());
vi.mock('#src/lib/instagram-key-schema.js', () => ({ default: {
  findById: () => ({ select: db.read }),
  findOneAndUpdate: (...args: unknown[]) => { db.seed(...args); return { select: db.read }; },
  updateOne: db.updateOne,
} }));
vi.mock('#src/lib/mailer.js', () => ({ sendMail: mail }));
const DAY = 86_400_000;
const oldKey: InstagramKey = { userId: 'account', accessToken: 'fixture-old-key', issuedAt: new Date('2026-01-01') };

describe('Instagram key storage and renewal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-08'));
    vi.stubEnv('META_IG_USER_ID', '');
    vi.stubEnv('META_IG_ACCESS_TOKEN', '');
    vi.stubEnv('GMAIL_USER', 'site@example.com');
    db.read.mockResolvedValue(oldKey);
    db.updateOne.mockResolvedValue({ matchedCount: 1 });
    mail.mockResolvedValue({ messageId: 'fixture' });
    vi.spyOn(global, 'fetch').mockResolvedValue(Response.json({ access_token: 'fixture-new-key' }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('uses the stored key regardless of obsolete environment settings', async () => {
    vi.stubEnv('META_IG_ACCESS_TOKEN', 'obsolete-fixture-key');
    expect(await (await import('#src/lib/instagram-key.js')).getInstagramKey()).toEqual(oldKey);
    expect(db.seed).not.toHaveBeenCalled();
  });
  it('seeds only a missing record and never overwrites a concurrent seed', async () => {
    vi.stubEnv('META_IG_USER_ID', 'account');
    vi.stubEnv('META_IG_ACCESS_TOKEN', 'fixture-seed-key');
    db.read.mockResolvedValueOnce(null).mockResolvedValueOnce(oldKey);
    expect(await (await import('#src/lib/instagram-key.js')).getInstagramKey()).toEqual(oldKey);
    expect(db.seed).toHaveBeenCalledWith({ _id: 'instagram' }, {
      $setOnInsert: { userId: 'account', accessToken: 'fixture-seed-key', issuedAt: new Date() },
    }, { upsert: true, returnDocument: 'after' });
  });
  it.each([['', ''], ['account', ''], ['', 'fixture']])('returns unconfigured for incomplete seed settings', async (user, token) => {
    vi.stubEnv('META_IG_USER_ID', user);
    vi.stubEnv('META_IG_ACCESS_TOKEN', token);
    db.read.mockResolvedValue(null);
    expect(await (await import('#src/lib/instagram-key.js')).getInstagramKey()).toBeNull();
    expect(db.seed).not.toHaveBeenCalled();
  });
  it('renews at exactly seven days and saves the new key and issue time', async () => {
    await (await import('#src/lib/instagram-key.js')).checkInstagramKey();
    const [input] = vi.mocked(fetch).mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://graph.instagram.com/refresh_access_token');
    expect(url.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(url.searchParams.get('access_token')).toBe(oldKey.accessToken);
    expect(db.updateOne).toHaveBeenCalledWith({ _id: 'instagram', accessToken: oldKey.accessToken }, {
      $set: { accessToken: 'fixture-new-key', issuedAt: new Date() },
    });
    expect(mail).not.toHaveBeenCalled();
  });
  it.each([null, { ...oldKey, issuedAt: new Date('2026-01-01T00:00:00.001Z') }])('does not renew absent or younger keys', async (key) => {
    db.read.mockResolvedValue(key);
    await (await import('#src/lib/instagram-key.js')).checkInstagramKey();
    expect(fetch).not.toHaveBeenCalled();
    expect(mail).not.toHaveBeenCalled();
  });
  it('alerts once per outage, re-arming only after successful renewal', async () => {
    const { checkInstagramKey } = await import('#src/lib/instagram-key.js');
    vi.mocked(fetch).mockRejectedValue(new Error('private request details'));
    await checkInstagramKey(); await checkInstagramKey();
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: 'site@example.com' }));
    expect(JSON.stringify(mail.mock.calls)).not.toContain('private request details');
    vi.mocked(fetch).mockResolvedValue(Response.json({ access_token: 'fixture-new-key' }));
    await checkInstagramKey();
    vi.mocked(fetch).mockRejectedValue(new Error('down again'));
    await checkInstagramKey();
    expect(mail).toHaveBeenCalledTimes(2);
  });
  it.each([Response.json({}), Response.json({ access_token: 4 }), Response.json({ access_token: 'fixture' }, { status: 500 })])('refuses unsuccessful or malformed renewal', async (response) => {
    vi.mocked(fetch).mockResolvedValue(response);
    await (await import('#src/lib/instagram-key.js')).checkInstagramKey();
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(mail).toHaveBeenCalledTimes(1);
  });
  it('treats a replaced record as failed renewal', async () => {
    db.updateOne.mockResolvedValue({ matchedCount: 0 });
    await (await import('#src/lib/instagram-key.js')).checkInstagramKey();
    expect(mail).toHaveBeenCalledTimes(1);
  });
  it('catches database and mail failures without leaking them or retrying mail in the same outage', async () => {
    db.read.mockRejectedValue(new Error('db down'));
    mail.mockRejectedValue(new Error('mail down'));
    const { checkInstagramKey } = await import('#src/lib/instagram-key.js');
    await checkInstagramKey(); await checkInstagramKey();
    expect(mail).toHaveBeenCalledTimes(1);
  });
  it('does not overlap checks', async () => {
    let resolve!: (key: InstagramKey) => void;
    db.read.mockReturnValue(new Promise<InstagramKey>((r) => { resolve = r; }));
    const { checkInstagramKey } = await import('#src/lib/instagram-key.js');
    const first = checkInstagramKey();
    await checkInstagramKey();
    expect(db.read).toHaveBeenCalledTimes(1);
    resolve(oldKey);
    await first;
  });
  it('checks at startup and daily, starts once, and can stop', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const module = await import('#src/lib/instagram-key.js');
    module.startInstagramRefresh(); module.startInstagramRefresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(db.read).toHaveBeenCalledTimes(2);
    module.stopInstagramRefresh();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(db.read).toHaveBeenCalledTimes(2);
  });
  it('does not schedule anything under test mode', async () => {
    const module = await import('#src/lib/instagram-key.js');
    module.startInstagramRefresh(); module.stopInstagramRefresh();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(db.read).not.toHaveBeenCalled();
  });
});
