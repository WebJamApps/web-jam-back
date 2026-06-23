import { createCallTaskEvent } from '#src/lib/calendar.js';

// Exercises the real fetch path (token exchange -> event insert) by stubbing the
// global fetch, the same way google.spec.ts does — the lib does NOT no-op under
// test, so this is genuine coverage of the Google calls.
const okJson = (body: unknown) => ({ ok: true, json: async () => body });

const validInput = () => ({
  date: new Date('2026-07-15T00:00:00.000Z'),
  title: 'Call The Bridge re: August',
  scriptBody: 'Ask for Pat. Phone: 555-1212.',
});

describe('calendar.ts createCallTaskEvent', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('exchanges the refresh token then inserts an all-day event', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(okJson({ access_token: 'at-123' }))
      .mockResolvedValueOnce(okJson({ id: 'evt-1', htmlLink: 'https://cal/evt-1' }));
    vi.stubGlobal('fetch', fetch);

    const res = await createCallTaskEvent(validInput());
    expect(res).toEqual({ id: 'evt-1', htmlLink: 'https://cal/evt-1' });

    // Token call first, calendar insert second (with the bearer token).
    expect(fetch.mock.calls[0][0]).toContain('oauth2.googleapis.com/token');
    const insert = fetch.mock.calls[1];
    expect(insert[0]).toContain('/calendars/primary/events');
    expect((insert[1] as any).headers.Authorization).toBe('Bearer at-123');
    const body = JSON.parse((insert[1] as any).body);
    expect(body.summary).toBe('Call The Bridge re: August');
    expect(body.description).toContain('Ask for Pat');
    // All-day, half-open range: end.date is the day AFTER start.date.
    expect(body.start.date).toBe('2026-07-15');
    expect(body.end.date).toBe('2026-07-16');
  });

  it('throws when the token exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' }));
    await expect(createCallTaskEvent(validInput())).rejects.toThrow(/token exchange failed/);
  });

  it('throws when the token response carries no access_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({})));
    await expect(createCallTaskEvent(validInput())).rejects.toThrow(/no access_token/);
  });

  it('throws when the calendar insert fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson({ access_token: 'at-123' }))
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' }));
    await expect(createCallTaskEvent(validInput())).rejects.toThrow(/calendar insert failed/);
  });

  it('throws when the insert returns no event id', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson({ access_token: 'at-123' }))
      .mockResolvedValueOnce(okJson({})));
    await expect(createCallTaskEvent(validInput())).rejects.toThrow(/no event id/);
  });
});
