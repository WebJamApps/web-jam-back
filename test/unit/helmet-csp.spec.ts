import path from 'node:path';
import { rmSync } from 'node:fs';
import app, { makeCspDirectives, resolveFrontendDistDir } from '#src/index.js';
import request from '../helpers/api.js';

// Point the app at a throwaway built bundle before src/index.ts loads, as the e2e stack does.
const distDir = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'wjb-frontend-dist-'));
  fs.writeFileSync(nodePath.join(dir, 'index.html'), '<!doctype html><title>e2e-dist-index</title>');
  fs.mkdirSync(nodePath.join(dir, 'assets'));
  fs.writeFileSync(nodePath.join(dir, 'assets', 'app.js'), 'console.log("e2e-dist-asset");');
  process.env.FRONTEND_DIST_DIR = dir;
  return dir;
});

afterAll(() => {
  delete process.env.FRONTEND_DIST_DIR;
  rmSync(distDir, { recursive: true, force: true });
});

function directiveSources(csp: string, directive: string): string[] {
  const entry = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === directive || part.startsWith(`${directive} `));
  if (!entry) return [];
  return entry.split(/\s+/).slice(1);
}

function hasDirective(csp: string, directive: string): boolean {
  return csp.split(';').map((part) => part.trim().split(/\s+/)[0]).includes(directive);
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
      'blob:',
      'ws:',
      'wss:',
      'https://cdn.plyr.io',
      'https://noembed.com',
      'https://maps.googleapis.com',
      'https://places.googleapis.com',
    ]);
  });

  it('allows blob: images for the self-hosted TinyMCE editor', async () => {
    const res = await request(app).get('/venue/cities');
    expect(directiveSources(res.headers['content-security-policy'] || '', 'img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https:',
      'https://dl.dropboxusercontent.com',
    ]);
  });

  it('sends the same security headers on /, a static asset, and the /music deep route (Helmet runs before express.static)', async () => {
    const root = await request(app).get('/');
    const asset = await request(app).get('/assets/app.js');
    const music = await request(app).get('/music');

    expect(root.status).toBe(200);
    expect(root.body).toContain('e2e-dist-index');
    expect(asset.status).toBe(200);
    expect(asset.body).toContain('e2e-dist-asset');
    expect(music.status).toBe(200);
    expect(music.body).toContain('e2e-dist-index');

    const rootCsp = root.headers['content-security-policy'];
    expect(rootCsp).toBeTruthy();
    expect(asset.headers['content-security-policy']).toBe(rootCsp);
    expect(music.headers['content-security-policy']).toBe(rootCsp);
    for (const header of ['x-content-type-options', 'x-frame-options', 'strict-transport-security', 'referrer-policy']) {
      expect(root.headers[header]).toBeTruthy();
      expect(asset.headers[header]).toBe(root.headers[header]);
      expect(music.headers[header]).toBe(root.headers[header]);
    }
  });

  it('omits upgrade-insecure-requests outside production so local HTTP serving works', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toBeTruthy();
    expect(hasDirective(csp, 'upgrade-insecure-requests')).toBe(false);
  });

  it('sends upgrade-insecure-requests only when NODE_ENV is production', () => {
    expect(makeCspDirectives({ NODE_ENV: 'production' })['upgrade-insecure-requests']).toEqual([]);
    expect(makeCspDirectives({ NODE_ENV: 'test' })['upgrade-insecure-requests']).toBeNull();
    expect(makeCspDirectives({ NODE_ENV: 'development' })['upgrade-insecure-requests']).toBeNull();
    expect(makeCspDirectives({})['upgrade-insecure-requests']).toBeNull();
  });

  it('keeps every other directive identical in production and test', () => {
    const { 'upgrade-insecure-requests': _prodUpgrade, ...prod } = makeCspDirectives({ NODE_ENV: 'production' });
    const { 'upgrade-insecure-requests': _testUpgrade, ...test } = makeCspDirectives({ NODE_ENV: 'test' });
    expect(test).toEqual(prod);
  });
});

describe('resolveFrontendDistDir', () => {
  it('uses FRONTEND_DIST_DIR when set', () => {
    expect(resolveFrontendDistDir({ FRONTEND_DIST_DIR: '/tmp/jammusic-e2e-stack-run/dist' })).toBe('/tmp/jammusic-e2e-stack-run/dist');
  });

  it('falls back to the sibling JaMmusic build when FRONTEND_DIST_DIR is unset or blank', () => {
    const expected = path.normalize(path.join(path.resolve('src'), '../../JaMmusic/dist'));
    expect(resolveFrontendDistDir({})).toBe(expected);
    expect(resolveFrontendDistDir({ FRONTEND_DIST_DIR: '   ' })).toBe(expected);
  });
});
