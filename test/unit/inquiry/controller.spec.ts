import { vi } from 'vitest';
import type { Request, Response } from 'express';
import InquiryController, { googlePlacesKeyForArtist, senderForArtist } from '#src/model/inquiry/InquiryController.js';
import { hasValidFormLoadTime, MIN_FORM_FILL_MS } from '#src/model/inquiry/inquiry-checks.js';

// NODE_ENV is 'test' for the whole suite (see test/setup), so sendEmail never
// hits the real Gmail transporter — it always short-circuits to the 200
// response. These tests exercise handleInquiry's wiring into
// formatInquiryEmail (subject/html/text) and sendEmail's text-vs-html
// fallback, using a minimal Response stub.
function mockRes() {
  const res = {} as Response & { body?: unknown };
  res.status = (s: number) => { res.statusCode = s; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

describe('googlePlacesKeyForArtist', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, null, '', ' ', 'jammusic', 'other-artist', 123])(
    'uses the default Places key for artist %s', (artist) => {
      vi.stubEnv('GOOGLE_PLACES_API_KEY', 'default-places-test-key');
      vi.stubEnv('TimGooglePlacesApiKey', 'tim-places-test-key');
      expect(googlePlacesKeyForArtist(artist)).toBe('default-places-test-key');
    },
  );

  it.each(['tim', ' tim '])('uses TimGooglePlacesApiKey for %s', (artist) => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'default-places-test-key');
    vi.stubEnv('TimGooglePlacesApiKey', 'tim-places-test-key');
    expect(googlePlacesKeyForArtist(artist)).toBe('tim-places-test-key');
  });

  it('never substitutes the other artist\'s key when a key is missing', () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'default-places-test-key');
    vi.stubEnv('TimGooglePlacesApiKey', undefined);
    expect(googlePlacesKeyForArtist('tim')).toBeUndefined();
    vi.stubEnv('GOOGLE_PLACES_API_KEY', undefined);
    vi.stubEnv('TimGooglePlacesApiKey', 'tim-places-test-key');
    expect(googlePlacesKeyForArtist(undefined)).toBeUndefined();
  });
});

describe('senderForArtist', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('uses GMAIL_USER and GMAIL_APP_PASSWORD for default artist or when unmapped', () => {
    process.env.GMAIL_USER = 'josh@example.com';
    process.env.GMAIL_APP_PASSWORD = 'josh-password';
    expect(senderForArtist(undefined)).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });
    expect(senderForArtist('jammusic')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });
    expect(senderForArtist('other-artist')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });
  });

  it('falls back to empty strings if GMAIL_USER / GMAIL_APP_PASSWORD are unset', () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    expect(senderForArtist(undefined)).toEqual({
      user: '',
      pass: '',
      from: '',
    });
  });

  it('uses Tim credentials when artist is tim and both env vars are present', () => {
    process.env.GMAIL_USER = 'josh@example.com';
    process.env.GMAIL_APP_PASSWORD = 'josh-password';
    process.env.TimGmailUser = 'tim@example.com';
    process.env.TimGmailAppPassword = 'tim-password';
    expect(senderForArtist('tim')).toEqual({
      user: 'tim@example.com',
      pass: 'tim-password',
      from: 'tim@example.com',
    });
  });

  it('falls back to default credentials if either Tim env var is missing', () => {
    process.env.GMAIL_USER = 'josh@example.com';
    process.env.GMAIL_APP_PASSWORD = 'josh-password';

    process.env.TimGmailUser = 'tim@example.com';
    delete process.env.TimGmailAppPassword;
    expect(senderForArtist('tim')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });

    delete process.env.TimGmailUser;
    process.env.TimGmailAppPassword = 'tim-password';
    expect(senderForArtist('tim')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });

    delete process.env.TimGmailUser;
    delete process.env.TimGmailAppPassword;
    expect(senderForArtist('tim')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });
  });
});

describe('InquiryController.handleInquiry', () => {
  const origEnv = { ...process.env };
  const ALLOWED_ORIGINS = [
    'https://web-jam.com',
    'https://www.web-jam.com',
    'https://joshandmariamusic.com',
    'https://www.joshandmariamusic.com',
  ];
  const DEFAULT_HEADERS = { origin: 'https://web-jam.com' };
  const STREET_COMPONENTS = [
    { longText: '123', types: ['street_number'] },
    { longText: 'Main St', types: ['route'] },
  ];

  beforeEach(() => {
    process.env.AllowUrl = JSON.stringify({ urls: ALLOWED_ORIGINS });
  });

  function futureDate(): string {
    const d = new Date(Date.now() + 30 * 86_400_000);
    return d.toISOString().slice(0, 10);
  }

  function validHomepageBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      form: 'webjam-homepage',
      website: '',
      formLoadedAt: Date.now() - 10_000,
      email: 'customer@example.com',
      ...overrides,
    };
  }

  function validBookingBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      form: 'jam-bookus',
      website: '',
      formLoadedAt: Date.now() - 10_000,
      firstname: 'Jane',
      lastname: 'Smith',
      emailaddress: 'jane@example.com',
      phonenumber: '555-123-4567',
      eventDate: futureDate(),
      eventType: 'wedding',
      venuePlaceId: 'place-id',
      comments: 'Would love to book you for our autumn wedding reception.',
      ...overrides,
    };
  }

  afterEach(() => {
    process.env = { ...origEnv };
    vi.unstubAllGlobals();
  });

  it.each([
    ['tim', 'tim-booking', 'tim-places-test-key'],
    ['jammusic', 'jam-bookus', 'default-places-test-key'],
    [undefined, 'jam-bookus', 'default-places-test-key'],
  ])('looks up the picked place with the %s artist key and delivers Google’s address', async (artist, form, key) => {
    process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
    process.env.TimGooglePlacesApiKey = 'tim-places-test-key';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      formattedAddress: '123 Main St, Salem, VA',
      addressComponents: STREET_COMPONENTS,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new InquiryController();
    const sendEmail = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();

    await controller.handleInquiry({
      headers: DEFAULT_HEADERS,
      body: validBookingBody({
        artist,
        form,
        venuePlaceId: ' place-id ',
        venueAddress: 'Ignored customer text',
        email: 'customer@example.com',
      }),
    } as unknown as Request, res);

    expect(fetchMock).toHaveBeenCalledWith('https://places.googleapis.com/v1/places/place-id', expect.objectContaining({
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'formattedAddress,addressComponents' },
    }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [html, , , , , text, , replyTo] = sendEmail.mock.calls[0];
    expect(text).toContain('Venue Address: 123 Main St, Salem, VA');
    expect(html).toContain('>123 Main St, Salem, VA</td>');
    expect(text).not.toContain('Ignored customer text');
    expect(replyTo).toBe('customer@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: 'email sent' });
  });

  it.each(['no key', 'no Tim key', 'Google error', 'network error', 'timeout', 'malformed JSON'])(
    'still delivers with an unavailable venue row for %s', async (scenario) => {
      process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
      process.env.TimGooglePlacesApiKey = 'tim-places-test-key';
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      let artist: string | undefined;
      let form = 'jam-bookus';
      switch (scenario) {
        case 'no key': delete process.env.GOOGLE_PLACES_API_KEY; break;
        case 'no Tim key': delete process.env.TimGooglePlacesApiKey; artist = 'tim'; form = 'tim-booking'; break;
        case 'Google error': fetchMock.mockResolvedValue(new Response(null, { status: 403 })); break;
        case 'network error': fetchMock.mockRejectedValue(new Error('network error')); break;
        case 'timeout': fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError')); break;
        default: fetchMock.mockResolvedValue(new Response('invalid JSON')); break;
      }
      const controller = new InquiryController();
      const sendEmail = vi.spyOn(controller, 'sendEmail');
      const res = mockRes();

      await controller.handleInquiry({
        headers: DEFAULT_HEADERS,
        body: validBookingBody({ artist, form, venuePlaceId: 'place-id' }),
      } as unknown as Request, res);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][5]).toContain('Venue address: not verified (lookup unavailable)');
      expect(sendEmail.mock.calls[0][0]).toContain('>not verified (lookup unavailable)</td>');
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ message: 'email sent' });
      expect(fetchMock).toHaveBeenCalledTimes(scenario.startsWith('no ') ? 0 : 1);
    },
  );

  it('verifies typed venueAddress via Google searchText and delivers both formatted and typed addresses', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      places: [{
        formattedAddress: '123 Main St, Salem, VA 24153, USA',
        addressComponents: STREET_COMPONENTS,
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new InquiryController();
    const sendEmail = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();

    await controller.handleInquiry({
      headers: DEFAULT_HEADERS,
      body: validBookingBody({ venuePlaceId: '', venueAddress: '123 Main St, Salem VA' }),
    } as unknown as Request, res);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places:searchText',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sendEmail.mock.calls[0][5]).toContain('Venue Address: 123 Main St, Salem, VA 24153, USA');
    expect(sendEmail.mock.calls[0][5]).toContain('Venue Address (typed by customer): 123 Main St, Salem VA');
    expect(res.statusCode).toBe(200);
  });

  it('emails the form and booking fields using the request Origin rather than body site fields', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const eventDate = futureDate();
    const req = {
      headers: { origin: 'https://joshandmariamusic.com' },
      body: validBookingBody({
        form: 'jam-bookus', firstname: 'Jane', lastname: 'Smith',
        emailaddress: 'jane@example.com', phonenumber: '555-123-4567',
        eventDate, eventType: 'wedding', venuePlaceId: '', venueAddress: '123 Main St',
        comments: 'Music inquiry', site: 'https://wrong.example', origin: 'https://wrong.example',
      }),
    } as unknown as Request;
    const res = mockRes();
    await controller.handleInquiry(req, res);
    const [html, , subject, , , text] = sendEmailSpy.mock.calls[0];
    expect(subject).toBe('New inquiry from Jane Smith — Book Us form');
    expect(text).toContain(`Form: Book Us form\nSite: https://joshandmariamusic.com\nName: Jane Smith`);
    expect(text).toContain(`Event Date: ${eventDate}\nEvent Type: wedding`);
    expect(text).toContain('Venue Address (typed by customer): 123 Main St');
    expect(html).toContain('https://joshandmariamusic.com');
    expect(html).not.toContain('wrong.example');
    expect(res.statusCode).toBe(200);
  });

  it('passes artist-specific sender through to sendEmail when configured', async () => {
    process.env.TimGmailUser = 'tim@example.com';
    process.env.TimGmailAppPassword = 'tim-password';
    delete process.env.TimGooglePlacesApiKey;

    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({
      headers: { origin: 'https://timshermanmusic.com' },
      body: validBookingBody({
        artist: 'tim',
        form: 'tim-booking',
        name: 'Jane Doe',
        email: 'customer@example.com',
        phone: '555-123-4567',
        message: 'Looking to book you for a fall party.',
      }),
    } as unknown as Request, res);

    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.anything(),
      expect.any(String),
      { user: 'tim@example.com', pass: 'tim-password', from: 'tim@example.com' },
      'customer@example.com',
    );
    expect(sendEmailSpy.mock.calls[0][6]).toEqual({
      user: 'tim@example.com',
      pass: 'tim-password',
      from: 'tim@example.com',
    });
  });

  it('formats a Tim Sherman booking submission into a descriptive subject', async () => {
    delete process.env.TimGooglePlacesApiKey;
    const controller = new InquiryController();
    const res = mockRes();
    await controller.handleInquiry({
      headers: { origin: 'https://timshermanmusic.com' },
      body: validBookingBody({
        artist: 'tim', form: 'tim-booking', name: 'John Doe', email: 'john@example.com',
        phone: '555-123-4567', eventDate: futureDate(), message: 'Wedding gig',
      }),
    } as unknown as Request, res);
    expect(res.statusCode).toBe(200);
  });

  it('formats a default-artist (JaMmusic) homepage submission gracefully without booking fields', async () => {
    const controller = new InquiryController();
    const res = mockRes();
    await controller.handleInquiry({
      headers: DEFAULT_HEADERS,
      body: validHomepageBody({ emailaddress: 'yo@yo.com' }),
    } as unknown as Request, res);
    expect(res.statusCode).toBe(200);
  });

  it('extracts customer replyTo from body.email', async () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({
      headers: DEFAULT_HEADERS,
      body: validHomepageBody({ email: '  customer@example.com  ' }),
    } as unknown as Request, res);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      'customer@example.com',
    );
  });

  it('extracts customer replyTo from body.emailaddress when email is not provided', async () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({
      headers: DEFAULT_HEADERS,
      body: validHomepageBody({ email: undefined, emailaddress: '  legacy@example.com  ' }),
    } as unknown as Request, res);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      'legacy@example.com',
    );
  });

  it('passes undefined replyTo when neither email nor emailaddress is provided on homepage form', async () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({
      headers: DEFAULT_HEADERS,
      body: validHomepageBody({ email: undefined }),
    } as unknown as Request, res);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      undefined,
    );
  });

  it('passes undefined replyTo when email fields are blank whitespace on homepage form', async () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({
      headers: DEFAULT_HEADERS,
      body: validHomepageBody({ email: '   ', emailaddress: '   ' }),
    } as unknown as Request, res);
    expect(sendEmailSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      undefined,
    );
  });

  describe('spam checks in order and per-form rules (#973)', () => {
    it.each([undefined, '', 'unknown-form', 123])(
      'check 2 (known form): silently drops missing/unknown form (%s) with 200 without emailing', async (form) => {
        const controller = new InquiryController();
        const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
        const res = mockRes();
        await controller.handleInquiry({
          headers: DEFAULT_HEADERS,
          body: validHomepageBody({ form }),
        } as unknown as Request, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ message: 'email sent' });
        expect(sendEmailSpy).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, '', null, 'null', 'https://evil.example.com', 'http://web-jam.com', 'https://web-jam.com.evil.example.com'])(
      'check 2 (allowed site): silently drops missing or disallowed Origin (%j) with 200 without emailing', async (origin) => {
        const controller = new InquiryController();
        const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
        const res = mockRes();
        await controller.handleInquiry({
          headers: origin === undefined ? {} : { origin },
          body: validHomepageBody(),
        } as unknown as Request, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ message: 'email sent' });
        expect(sendEmailSpy).not.toHaveBeenCalled();
      },
    );

    it.each([
      'https://web-jam.com',
      'https://www.web-jam.com',
      'https://joshandmariamusic.com',
      'https://www.joshandmariamusic.com',
      'https://timshermanmusic.com',
      'https://www.timshermanmusic.com',
      'https://abc123.timshermanmusic.pages.dev',
    ])('check 2 (allowed site): sends inquiry when Origin is %s', async (origin) => {
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
      const res = mockRes();
      await controller.handleInquiry({
        headers: { origin },
        body: validHomepageBody(),
      } as unknown as Request, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ message: 'email sent' });
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });

    it.each(['https://spam.example', 'x', ' ', 1, true])(
      'check 3 (hidden trap): silently drops when website holds %j', async (website) => {
        const controller = new InquiryController();
        const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
        const res = mockRes();
        await controller.handleInquiry({
          headers: DEFAULT_HEADERS,
          body: validHomepageBody({ website }),
        } as unknown as Request, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ message: 'email sent' });
        expect(sendEmailSpy).not.toHaveBeenCalled();
      },
    );

    it('check 4 (speed check): drops missing, non-number, future, negative, or <3s submissions and allows >=3s', async () => {
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
      const now = Date.now();

      // 2000 ms, not MIN_FORM_FILL_MS - 1: the handler reads the clock after this line, so a
      // value one millisecond under the limit would drift over it and the test would flake.
      for (const bad of [undefined, '1000', Number.NaN, -1, now + 1000, now - 2000]) {
        const res = mockRes();
        // eslint-disable-next-line no-await-in-loop
        await controller.handleInquiry({
          headers: DEFAULT_HEADERS,
          body: validHomepageBody({ formLoadedAt: bad }),
        } as unknown as Request, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ message: 'email sent' });
      }
      expect(sendEmailSpy).not.toHaveBeenCalled();

      const okRes = mockRes();
      await controller.handleInquiry({
        headers: DEFAULT_HEADERS,
        body: validHomepageBody({ formLoadedAt: now - 3000 }),
      } as unknown as Request, okRes);
      expect(okRes.statusCode).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });

    it('check 4 (speed check): the limit is exactly 3 seconds, judged against a fixed clock', () => {
      const nowMs = 1_800_000_000_000;
      expect(MIN_FORM_FILL_MS).toBe(3000);
      expect(hasValidFormLoadTime(nowMs - 2999, nowMs)).toBe(false);
      expect(hasValidFormLoadTime(nowMs - 3000, nowMs)).toBe(true);
      expect(hasValidFormLoadTime(nowMs, nowMs)).toBe(false);
      expect(hasValidFormLoadTime(nowMs + 1, nowMs)).toBe(false);
    });

    it('per-form rule: webjam-homepage skips booking fields, venue check, and sales-pitch check', async () => {
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
      const res = mockRes();

      await controller.handleInquiry({
        headers: DEFAULT_HEADERS,
        body: validHomepageBody({
          comments: 'We offer virtual assistants and lead generation. Open for discussion?',
          venuePlaceId: 'should-not-lookup',
        }),
      } as unknown as Request, res);

      expect(res.statusCode).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });

    it('runs checks 2-4 before check 5 so bot traps on a booking form drop silently (200) even with missing booking fields', async () => {
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
      const res = mockRes();

      await controller.handleInquiry({
        headers: DEFAULT_HEADERS,
        body: { form: 'jam-bookus', website: 'bot-filled', formLoadedAt: Date.now() - 10_000 },
      } as unknown as Request, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ message: 'email sent' });
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it('runs check 2 (allowed site) before check 5 so missing/disallowed Origin on a booking form drops silently (200) even with missing booking fields', async () => {
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');

      for (const headers of [{}, { origin: 'https://evil.example.com' }]) {
        const res = mockRes();
        // eslint-disable-next-line no-await-in-loop
        await controller.handleInquiry({
          headers,
          body: { form: 'jam-bookus', website: '', formLoadedAt: Date.now() - 10_000 },
        } as unknown as Request, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ message: 'email sent' });
      }
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['name', { firstname: '', lastname: '', name: '' }],
      ['email', { email: '', emailaddress: '' }],
      ['phone', { phone: '', phonenumber: '' }],
      ['message', { comments: '', message: '' }],
      ['eventDate', { eventDate: '' }],
      ['eventDate', { eventDate: '2026/12/20' }],
      ['eventDate', { eventDate: '2026-02-30' }],
      ['eventDate', { eventDate: '2020-01-01' }],
      ['eventType', { eventType: '' }],
      ['eventType', { eventType: 'stadium-tour' }],
      ['venue', { venuePlaceId: '', venueAddress: '' }],
    ])('check 5 (booking fields): returns 400 naming %s when %j is invalid', async (expectedField, overrides) => {
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
      const res = mockRes();

      await controller.handleInquiry({
        headers: DEFAULT_HEADERS,
        body: validBookingBody(overrides),
      } as unknown as Request, res);

      expect(res.statusCode).toBe(400);
      expect((res.body as { message: string }).message.toLowerCase()).toContain(expectedField.toLowerCase());
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it.each(['jam-bookus', 'tim-booking'])('check 6 (address verification): returns 400 for unresolved or city-only address on %s', async (form) => {
      process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
      process.env.TimGooglePlacesApiKey = 'tim-places-test-key';
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({
          formattedAddress: 'Salem, VA',
          addressComponents: [{ longText: 'Salem', types: ['locality'] }],
        }))
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(Response.json({ places: [] }));
      vi.stubGlobal('fetch', fetchMock);
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');

      for (const venueOverride of [
        { venuePlaceId: 'city-only' },
        { venuePlaceId: 'missing-id' },
        { venuePlaceId: '', venueAddress: 'Nonexistent venue' },
      ]) {
        const res = mockRes();
        // eslint-disable-next-line no-await-in-loop
        await controller.handleInquiry({
          headers: DEFAULT_HEADERS,
          body: validBookingBody({ form, artist: form === 'tim-booking' ? 'tim' : undefined, ...venueOverride }),
        } as unknown as Request, res);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          message: "We couldn't verify that address — please check the street address, or choose it from the suggestions.",
        });
      }
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it('check 6 (lookup-unavailable typed address): delivers with unavailable notice and customer text', async () => {
      delete process.env.GOOGLE_PLACES_API_KEY;
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
      const res = mockRes();

      await controller.handleInquiry({
        headers: DEFAULT_HEADERS,
        body: validBookingBody({ venuePlaceId: '', venueAddress: '106 Eagle Dr, Salem VA' }),
      } as unknown as Request, res);

      expect(res.statusCode).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy.mock.calls[0][5]).toContain('Venue address: not verified (lookup unavailable)');
      expect(sendEmailSpy.mock.calls[0][5]).toContain('Venue Address (typed by customer): 106 Eagle Dr, Salem VA');
    });

    it('check 7 (message wording): drops spam sample (4 entries) and delivers single-entry winery example', async () => {
      process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
      process.env.TimGooglePlacesApiKey = 'tim-places-test-key';
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        formattedAddress: '123 Main St, Salem, VA',
        addressComponents: STREET_COMPONENTS,
      }));
      vi.stubGlobal('fetch', fetchMock);
      const controller = new InquiryController();
      const sendEmailSpy = vi.spyOn(controller, 'sendEmail');

      const spamRes = mockRes();
      await controller.handleInquiry({
        headers: DEFAULT_HEADERS,
        body: validBookingBody({
          comments: 'We offer trained human Virtual Assistants and Lead Generation. Open for discussion?',
        }),
      } as unknown as Request, spamRes);
      expect(spamRes.statusCode).toBe(200);
      expect(spamRes.body).toEqual({ message: 'email sent' });
      expect(sendEmailSpy).not.toHaveBeenCalled();

      const wineryRes = mockRes();
      await controller.handleInquiry({
        headers: { origin: 'https://timshermanmusic.com' },
        body: validBookingBody({
          form: 'tim-booking',
          artist: 'tim',
          name: 'Sarah',
          email: 'sarah@example.com',
          phone: '555-555-1212',
          comments: undefined,
          message: "I'm the marketing coordinator at a winery, here's our site www.example.com, can you play our fall festival?",
        }),
      } as unknown as Request, wineryRes);
      expect(wineryRes.statusCode).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('InquiryController.sendEmail', () => {
  it('uses the supplied plaintext body when provided', async () => {
    const controller = new InquiryController();
    const res = mockRes();
    await controller.sendEmail('<p>html</p>', 'to@example.com', 'subject', res, undefined, 'plain text');
    expect(res.statusCode).toBe(200);
  });

  it('falls back to the html body when no plaintext is supplied', async () => {
    const controller = new InquiryController();
    const res = mockRes();
    await controller.sendEmail('<p>html only</p>', 'to@example.com', 'subject', res);
    expect(res.statusCode).toBe(200);
  });

  it('supports explicit sender and replyTo', async () => {
    const controller = new InquiryController();
    const res = mockRes();
    await controller.sendEmail(
      '<p>html</p>',
      'to@example.com',
      'subject',
      res,
      'cc@example.com',
      'plain text',
      { user: 'tim@example.com', pass: 'secret', from: 'tim@example.com' },
      'customer@example.com',
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('InquiryController transporters', () => {
  it('reuses transporters for the same user and creates distinct ones for different users', () => {
    const controller = new InquiryController();
    const transporters = controller as unknown as { getTransporter(user: string, pass: string): unknown };
    const t1 = transporters.getTransporter('user1@example.com', 'pass1');
    const t2 = transporters.getTransporter('user1@example.com', 'pass1');
    const t3 = transporters.getTransporter('user2@example.com', 'pass2');

    expect(t1).toBeDefined();
    expect(t1).toBe(t2);
    expect(t3).toBeDefined();
    expect(t3).not.toBe(t1);
  });
});
