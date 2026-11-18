// CORS allow-list (web-jam-back#885).
//
// Historically the allow-list was a static array parsed from the `AllowUrl` env
// var (`{"urls":[...]}`). That still holds the JaMmusic + CollegeLutheran
// origins. To onboard timshermanmusic.com (hosted on Cloudflare Pages) we also
// allow its production origins and, because a static array can't express a
// wildcard, its `*.pages.dev` preview deployments — hence an origin FUNCTION
// rather than a bare array.

import type { CorsOptions } from 'cors';

// timshermanmusic.com production origins (Cloudflare Pages custom domain).
export const TIM_ORIGINS = [
  'https://timshermanmusic.com',
  'https://www.timshermanmusic.com',
];

// Cloudflare Pages preview deployments: https://<hash>.<project>.pages.dev
const PAGES_DEV = /^https:\/\/([a-z0-9-]+\.)*pages\.dev$/i;

export function readStaticOrigins(): string[] {
  try {
    const parsed = JSON.parse(process.env.AllowUrl || '{}') as { urls?: string[] };
    return Array.isArray(parsed.urls) ? parsed.urls : [];
  } catch { return []; }
}

// True when the given request Origin is permitted.
// By default (`allowMissing = true`), requests with no Origin header
// (server-to-server, curl, same-origin navigations) are allowed; callers that
// require a browser Origin (e.g. POST /inquiry) pass `allowMissing = false`.
export function isAllowedOrigin(
  origin: string | null | undefined,
  staticOrigins: string[],
  allowMissing = true,
): boolean {
  const normalized = typeof origin === 'string' ? origin.trim() : '';
  if (!normalized) return allowMissing;
  if (staticOrigins.includes(normalized)) return true;
  if (TIM_ORIGINS.includes(normalized)) return true;
  return PAGES_DEV.test(normalized);
}

export function makeCorsOptions(): CorsOptions {
  const staticOrigins = readStaticOrigins();
  return {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin || undefined, staticOrigins)),
    credentials: true,
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  };
}

export default { TIM_ORIGINS, readStaticOrigins, isAllowedOrigin, makeCorsOptions };
