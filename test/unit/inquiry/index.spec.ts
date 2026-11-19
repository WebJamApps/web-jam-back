import { vi } from 'vitest';
import app from '#src/index.js';
import InquiryController from '#src/model/inquiry/InquiryController.js';
import { UNVERIFIED_ADDRESS_MESSAGE } from '#src/model/inquiry/inquiry-checks.js';
import request from '../../helpers/api.js';

const realFetch = globalThis.fetch.bind(globalThis);

describe('Inquiry Router', () => {
  const origEnv = { ...process.env };
  const ALLOWED_ORIGINS = [
    'https://web-jam.com',
    'https://www.web-jam.com',
    'https://joshandmariamusic.com',
    'https://www.joshandmariamusic.com',
  ];

  beforeEach(() => {
    process.env.AllowUrl = JSON.stringify({ urls: ALLOWED_ORIGINS });
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it('sends an email', async () => {
    const r = await request(app)
      .post('/inquiry')
      .set('X-Forwarded-For', '198.51.100.1')
      .send({ email: 'yo@yo.com' });
    expect(r.status).toBe(200);
  });

  it('trusts one proxy hop and returns 429 on the 6th submission per hour from the same client address', async () => {
    expect(app.get('trust proxy')).toBe(1);

    const payload = {
      form: 'webjam-homepage',
      website: '',
      formLoadedAt: Date.now() - 10_000,
      email: 'visitor@example.com',
    };

    for (let i = 1; i <= 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app)
        .post('/inquiry')
        .set('Origin', 'https://web-jam.com')
        .set('X-Forwarded-For', '203.0.113.10')
        .send(payload);
      expect(r.status).toBe(200);
    }

    const r6 = await request(app)
      .post('/inquiry')
      .set('Origin', 'https://web-jam.com')
      .set('X-Forwarded-For', '203.0.113.10')
      .send(payload);
    expect(r6.status).toBe(429);

    const rOtherIp = await request(app)
      .post('/inquiry')
      .set('Origin', 'https://web-jam.com')
      .set('X-Forwarded-For', '203.0.113.11')
      .send(payload);
    expect(rOtherIp.status).toBe(200);
  });

  it('enforces booking checks through POST /inquiry using searchText when venueAddress is typed', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://places.googleapis.com/')) {
        return Promise.resolve(Response.json({
          places: [{
            formattedAddress: '106 Eagle Dr, Salem, VA 24153, USA',
            addressComponents: [
              { longText: '106', types: ['street_number'] },
              { longText: 'Eagle Dr', types: ['route'] },
            ],
          }],
        }));
      }
      return realFetch(input, init);
    });

    const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const rBad = await request(app)
      .post('/inquiry')
      .set('Origin', 'https://web-jam.com')
      .set('X-Forwarded-For', '198.51.100.2')
      .send({
        form: 'jam-bookus',
        website: '',
        formLoadedAt: Date.now() - 10_000,
        firstname: 'Jane',
        lastname: 'Smith',
        emailaddress: 'jane@example.com',
        phonenumber: '555-123-4567',
        eventDate: future,
        eventType: 'invalid-type',
        venueAddress: '106 Eagle Dr, Salem VA',
        comments: 'Checking booking availability.',
      });
    expect(rBad.status).toBe(400);

    const rOk = await request(app)
      .post('/inquiry')
      .set('Origin', 'https://web-jam.com')
      .set('X-Forwarded-For', '198.51.100.3')
      .send({
        form: 'jam-bookus',
        website: '',
        formLoadedAt: Date.now() - 10_000,
        firstname: 'Jane',
        lastname: 'Smith',
        emailaddress: 'jane@example.com',
        phonenumber: '555-123-4567',
        eventDate: future,
        eventType: 'brewery-winery',
        venueAddress: '106 Eagle Dr, Salem VA',
        comments: 'Checking booking availability.',
      });
    expect(rOk.status).toBe(200);
  });

  describe('check 2 (allowed site) on POST /inquiry', () => {
    const validHomepagePayload = () => ({
      form: 'webjam-homepage',
      website: '',
      formLoadedAt: Date.now() - 10_000,
      email: 'visitor@example.com',
    });

    it.each([
      { label: 'absent', origin: undefined, ip: '192.0.2.1' },
      { label: 'empty string', origin: '', ip: '192.0.2.2' },
      { label: 'null', origin: 'null', ip: '192.0.2.3' },
      { label: 'https://evil.example.com', origin: 'https://evil.example.com', ip: '192.0.2.4' },
      { label: 'http://web-jam.com', origin: 'http://web-jam.com', ip: '192.0.2.5' },
      { label: 'https://web-jam.com.evil.example.com', origin: 'https://web-jam.com.evil.example.com', ip: '192.0.2.6' },
    ])('drops Origin $label with HTTP 200 and no email', async ({ origin, ip }) => {
      const sendEmailSpy = vi.spyOn(InquiryController.prototype, 'sendEmail');
      const req = request(app)
        .post('/inquiry')
        .set('X-Forwarded-For', ip);
      if (origin !== undefined) req.set('Origin', origin);

      const r = await req.send(validHomepagePayload());
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ message: 'email sent' });
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it.each([
      { origin: 'https://web-jam.com', ip: '192.0.2.10' },
      { origin: 'https://www.web-jam.com', ip: '192.0.2.11' },
      { origin: 'https://joshandmariamusic.com', ip: '192.0.2.12' },
      { origin: 'https://www.joshandmariamusic.com', ip: '192.0.2.13' },
      { origin: 'https://timshermanmusic.com', ip: '192.0.2.14' },
      { origin: 'https://www.timshermanmusic.com', ip: '192.0.2.15' },
      { origin: 'https://abc123.timshermanmusic.pages.dev', ip: '192.0.2.16' },
    ])('sends inquiry when Origin is $origin', async ({ origin, ip }) => {
      const sendEmailSpy = vi.spyOn(InquiryController.prototype, 'sendEmail');
      const r = await request(app)
        .post('/inquiry')
        .set('Origin', origin)
        .set('X-Forwarded-For', ip)
        .send(validHomepagePayload());
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ message: 'email sent' });
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps allowing GET /gig with no Origin header', async () => {
      const r = await request(app).get('/gig');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
    });
  });

  it.each([
    { form: 'jam-bookus', artist: undefined, ip: '198.51.100.10' },
    { form: 'tim-booking', artist: 'tim', ip: '198.51.100.11' },
  ])('returns 400 with the address message on POST /inquiry for a not-found place ID on $form', async ({ form, artist, ip }) => {
    process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
    process.env.TimGooglePlacesApiKey = 'tim-places-test-key';
    const sendEmailSpy = vi.spyOn(InquiryController.prototype, 'sendEmail');
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://places.googleapis.com/')) {
        return Promise.resolve(Response.json({
          error: { code: 400, message: 'The provided Place ID: abc is not valid.', status: 'INVALID_ARGUMENT' },
        }, { status: 400 }));
      }
      return realFetch(input, init);
    });

    const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const r = await request(app)
      .post('/inquiry')
      .set('Origin', 'https://web-jam.com')
      .set('X-Forwarded-For', ip)
      .send({
        form,
        artist,
        website: '',
        formLoadedAt: Date.now() - 10_000,
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '555-123-4567',
        eventDate: future,
        eventType: 'brewery-winery',
        venuePlaceId: 'abc',
        message: 'Checking booking availability.',
      });

    expect(r.status).toBe(400);
    expect(r.body).toEqual({ message: UNVERIFIED_ADDRESS_MESSAGE });
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('still delivers on POST /inquiry when Google Places returns HTTP 400 with reason API_KEY_INVALID', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'default-places-test-key';
    const sendEmailSpy = vi.spyOn(InquiryController.prototype, 'sendEmail');
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://places.googleapis.com/')) {
        return Promise.resolve(Response.json({
          error: {
            code: 400,
            message: 'API key not valid.',
            status: 'INVALID_ARGUMENT',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
          },
        }, { status: 400 }));
      }
      return realFetch(input, init);
    });

    const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const r = await request(app)
      .post('/inquiry')
      .set('Origin', 'https://web-jam.com')
      .set('X-Forwarded-For', '198.51.100.12')
      .send({
        form: 'jam-bookus',
        website: '',
        formLoadedAt: Date.now() - 10_000,
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '555-123-4567',
        eventDate: future,
        eventType: 'brewery-winery',
        venuePlaceId: 'valid-place-id',
        message: 'Checking booking availability.',
      });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ message: 'email sent' });
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0][5]).toContain('Venue address: not verified (lookup unavailable)');
  });

  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: unknown) => new Promise((resolve) => setTimeout(() => resolve(true), ms as number));
    await delay(3000);
  });
});
