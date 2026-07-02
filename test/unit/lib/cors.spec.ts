import {
  TIM_ORIGINS, readStaticOrigins, isAllowedOrigin, makeCorsOptions,
} from '#src/lib/cors.js';

describe('lib/cors', () => {
  const orig = process.env.AllowUrl;
  afterEach(() => { process.env.AllowUrl = orig; });

  it('readStaticOrigins parses the AllowUrl env', () => {
    process.env.AllowUrl = JSON.stringify({ urls: ['https://a.com', 'https://b.com'] });
    expect(readStaticOrigins()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('readStaticOrigins returns [] on missing/invalid config', () => {
    delete process.env.AllowUrl;
    expect(readStaticOrigins()).toEqual([]);
    process.env.AllowUrl = 'not-json';
    expect(readStaticOrigins()).toEqual([]);
  });

  it('allows requests with no Origin header', () => {
    expect(isAllowedOrigin(undefined, [])).toBe(true);
  });

  it('allows configured static origins', () => {
    expect(isAllowedOrigin('https://jammusic.com', ['https://jammusic.com'])).toBe(true);
  });

  it('allows the timshermanmusic production origins', () => {
    for (const o of TIM_ORIGINS) expect(isAllowedOrigin(o, [])).toBe(true);
  });

  it('allows Cloudflare Pages preview origins', () => {
    expect(isAllowedOrigin('https://abc123.timshermanmusic.pages.dev', [])).toBe(true);
    expect(isAllowedOrigin('https://timshermanmusic.pages.dev', [])).toBe(true);
  });

  it('rejects an unknown origin', () => {
    expect(isAllowedOrigin('https://evil.com', [])).toBe(false);
    expect(isAllowedOrigin('https://evil.pages.dev.attacker.com', [])).toBe(false);
  });

  it('makeCorsOptions wires an origin callback that reflects the allow-list', () => {
    process.env.AllowUrl = JSON.stringify({ urls: ['https://ok.com'] });
    const opts = makeCorsOptions();
    const originFn = opts.origin as (o: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => void;
    let allowed: boolean | undefined;
    originFn('https://ok.com', (_e, ok) => { allowed = ok; });
    expect(allowed).toBe(true);
    originFn('https://nope.com', (_e, ok) => { allowed = ok; });
    expect(allowed).toBe(false);
  });
});
