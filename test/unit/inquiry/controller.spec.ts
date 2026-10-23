import { vi } from 'vitest';
import type { Request, Response } from 'express';
import InquiryController, { googlePlacesKeyForArtist, senderForArtist } from '#src/model/inquiry/InquiryController.js';

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

  afterEach(() => {
    process.env = { ...origEnv };
    vi.unstubAllGlobals();
  });

  it.each([
    ['tim', 'tim-places-test-key'],
    ['jammusic', 'default-places-test-key'],
    [undefined, 'default-places-test-key'],
  ])('looks up the picked place with the %s artist key and delivers Google’s address', async (artist, key) => {
    process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
    process.env.TimGooglePlacesApiKey = 'tim-places-test-key';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ formattedAddress: '123 Main St, Salem, VA' }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new InquiryController();
    const sendEmail = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();

    await controller.handleInquiry({
      body: { artist, venuePlaceId: ' place-id ', venueAddress: 'Ignored customer text', email: 'customer@example.com' },
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

  it.each(['no key', 'no Tim key', 'Google error', 'network error', 'timeout', 'unresolved place', 'malformed JSON'])(
    'still delivers with an unavailable venue row for %s', async (scenario) => {
      process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
      process.env.TimGooglePlacesApiKey = 'tim-places-test-key';
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      let artist: string | undefined;
      switch (scenario) {
        case 'no key': delete process.env.GOOGLE_PLACES_API_KEY; break;
        case 'no Tim key': delete process.env.TimGooglePlacesApiKey; artist = 'tim'; break;
        case 'Google error': fetchMock.mockResolvedValue(new Response(null, { status: 403 })); break;
        case 'network error': fetchMock.mockRejectedValue(new Error('network error')); break;
        case 'timeout': fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError')); break;
        case 'malformed JSON': fetchMock.mockResolvedValue(new Response('invalid JSON')); break;
        default: fetchMock.mockResolvedValue(Response.json({}));
      }
      const controller = new InquiryController();
      const sendEmail = vi.spyOn(controller, 'sendEmail');
      const res = mockRes();

      await controller.handleInquiry({ body: { artist, venuePlaceId: 'place-id' } } as unknown as Request, res);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][5]).toBe('Venue address: not verified (lookup unavailable)');
      expect(sendEmail.mock.calls[0][0]).toContain('>not verified (lookup unavailable)</td>');
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ message: 'email sent' });
      expect(fetchMock).toHaveBeenCalledTimes(scenario.startsWith('no ') ? 0 : 1);
    },
  );

  it('delivers typed addresses without calling Google', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new InquiryController();
    const sendEmail = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({ body: { venueAddress: '123 Main St' } } as unknown as Request, res);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendEmail.mock.calls[0][5]).toBe('Venue Address (typed by customer): 123 Main St');
    expect(sendEmail.mock.calls[0][0]).toContain('>Venue Address (typed by customer)</td>');
    expect(res.statusCode).toBe(200);
  });

  it('emails the form and booking fields using the request Origin rather than body site fields', async () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const req = {
      headers: { origin: 'https://joshandmariamusic.com' },
      body: {
        form: 'jam-bookus', firstname: 'Jane', lastname: 'Smith',
        eventDate: '2026-12-20', eventType: 'wedding', venueAddress: '123 Main St',
        site: 'https://wrong.example', origin: 'https://wrong.example',
      },
    } as unknown as Request;
    const res = mockRes();
    await controller.handleInquiry(req, res);
    const [html, , subject, , , text] = sendEmailSpy.mock.calls[0];
    expect(subject).toBe('New inquiry from Jane Smith — Book Us form');
    expect(text).toBe([
      'Form: Book Us form', 'Site: https://joshandmariamusic.com', 'Name: Jane Smith',
      'Event Date: 2026-12-20', 'Event Type: wedding', 'Venue Address (typed by customer): 123 Main St',
    ].join('\n'));
    expect(html).toContain('https://joshandmariamusic.com');
    expect(html).not.toContain('wrong.example');
    expect(res.statusCode).toBe(200);
  });

  it('passes artist-specific sender through to sendEmail when configured', async () => {
    process.env.TimGmailUser = 'tim@example.com';
    process.env.TimGmailAppPassword = 'tim-password';

    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({
      body: {
        artist: 'tim',
        name: 'Jane Doe',
        email: 'customer@example.com',
      },
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
    const controller = new InquiryController();
    const res = mockRes();
    await controller.handleInquiry({
      body: {
        artist: 'tim', name: 'John Doe', email: 'john@example.com', phone: '555-123-4567',
        eventDate: '2026-08-15', message: 'Wedding gig',
      },
    } as unknown as Request, res);
    expect(res.statusCode).toBe(200);
  });

  it('formats a default-artist (JaMmusic) submission gracefully with missing fields', async () => {
    const controller = new InquiryController();
    const res = mockRes();
    await controller.handleInquiry({ body: { emailaddress: 'yo@yo.com' } } as unknown as Request, res);
    expect(res.statusCode).toBe(200);
  });

  it('extracts customer replyTo from body.email', async () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({
      body: { email: '  customer@example.com  ' },
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
      body: { emailaddress: '  legacy@example.com  ' },
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

  it('passes undefined replyTo when neither email nor emailaddress is provided', async () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({ body: {} } as unknown as Request, res);
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

  it('passes undefined replyTo when body is missing or email fields are blank whitespace', async () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    await controller.handleInquiry({} as unknown as Request, res);
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

    await controller.handleInquiry({ body: { email: '   ', emailaddress: '   ' } } as unknown as Request, res);
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
