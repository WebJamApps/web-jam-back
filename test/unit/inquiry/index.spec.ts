import { vi } from 'vitest';
import app from '#src/index.js';
import request from '../../helpers/api.js';

const realFetch = globalThis.fetch.bind(globalThis);

describe('Inquiry Router', () => {
  const origEnv = { ...process.env };

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
        .set('X-Forwarded-For', '203.0.113.10')
        .send(payload);
      expect(r.status).toBe(200);
    }

    const r6 = await request(app)
      .post('/inquiry')
      .set('X-Forwarded-For', '203.0.113.10')
      .send(payload);
    expect(r6.status).toBe(429);

    const rOtherIp = await request(app)
      .post('/inquiry')
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

  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: unknown) => new Promise((resolve) => setTimeout(() => resolve(true), ms as number));
    await delay(3000);
  });
});
