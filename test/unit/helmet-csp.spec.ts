import app from '#src/index.js';
import request from '../helpers/api.js';

function directiveSources(csp: string, directive: string): string[] {
  const entry = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === directive || part.startsWith(`${directive} `));
  if (!entry) return [];
  return entry.split(/\s+/).slice(1);
}

describe('Helmet Content Security Policy', () => {
  it('allows the exact script-src and connect-src hosts including Google Maps and Places and adds no other host (#1220)', async () => {
    const res = await request(app).get('/venue/cities');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toBeTruthy();
    expect(directiveSources(csp, 'script-src')).toEqual([
      "'self'",
      'https://accounts.google.com',
      'https://apis.google.com',
      'https://cdn.tiny.cloud',
      'https://w.soundcloud.com',
      'https://www.youtube.com',
      'https://s.ytimg.com',
      'https://cdnjs.cloudflare.com',
      'https://js.stripe.com',
      'https://maps.googleapis.com',
    ]);
    expect(directiveSources(csp, 'connect-src')).toEqual([
      "'self'",
      'ws:',
      'wss:',
      'https://cdn.plyr.io',
      'https://noembed.com',
      'https://maps.googleapis.com',
      'https://places.googleapis.com',
    ]);
  });
});
