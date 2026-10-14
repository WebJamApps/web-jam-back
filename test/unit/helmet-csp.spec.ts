import app from '#src/index.js';
import request from '../helpers/api.js';

describe('Helmet Content Security Policy', () => {
  it('does not include https://maps.googleapis.com in script-src (#1159)', async () => {
    const res = await request(app).get('/venue/cities');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toBeTruthy();
    expect(csp).toContain('script-src');
    expect(csp).not.toContain('https://maps.googleapis.com');
  });
});
