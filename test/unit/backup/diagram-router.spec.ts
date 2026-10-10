import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#src/lib/utils.js', () => ({
  default: { mongoConnect: vi.fn(() => Promise.resolve()) },
}));

const { default: app } = await import('#src/index.js');
const { default: authUtils } = await import('#src/auth/authUtils.js');
const { default: userModel } = await import('#src/model/user/user-schema.js');
const { default: request } = await import('../../helpers/api.js');

process.env.HashString ||= 'test-jwt-secret';

describe('/admin/backup/diagram routes', () => {
  const devToken = authUtils.createJWT({ _id: 'dev-user-id' });
  const otherToken = authUtils.createJWT({ _id: 'other-user-id' });

  const mockUserRole = (userType: string) => {
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve({ userType }),
      }),
    } as never);
  };

  const mockUserThrow = (err: Error) => {
    const rejected = Promise.reject(err);
    rejected.catch(() => {});
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({
        exec: () => rejected,
      }),
    } as never);
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /admin/backup/diagram/database', () => {
    it('proceeds and serves a caller whose account holds the top-level admin role (Developer)', async () => {
      mockUserRole('Developer');
      const res = await request(app)
        .get('/admin/backup/diagram/database')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(typeof res.body).toBe('string');
      expect((res.body as string).startsWith('erDiagram')).toBe(true);
      expect(res.body).toContain('User {');
      expect(res.body).toContain('Gig {');
    });

    it('refuses a caller with any other role (401)', async () => {
      mockUserRole('User');
      const res = await request(app)
        .get('/admin/backup/diagram/database')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('The user does not have the permission');
    });

    it('refuses a caller who is not logged in (401)', async () => {
      const res = await request(app).get('/admin/backup/diagram/database');
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Authorization header/i);
    });

    it('refuses a caller whose token is invalid (401)', async () => {
      const res = await request(app)
        .get('/admin/backup/diagram/database')
        .set('Authorization', 'Bearer invalid.token.value');
      expect(res.status).toBe(401);
    });

    it('refuses with 500 when the caller account lookup throws, and returns nothing', async () => {
      mockUserThrow(new Error('Mongo connection failure'));
      const res = await request(app)
        .get('/admin/backup/diagram/database')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(/Mongo connection failure/i);
      expect(typeof res.body === 'string' ? res.body : '').not.toContain('erDiagram');
    });
  });

  describe('GET /admin/backup/diagram/system', () => {
    it('proceeds and serves a caller whose account holds the top-level admin role (Developer)', async () => {
      mockUserRole('Developer');
      const res = await request(app)
        .get('/admin/backup/diagram/system')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(typeof res.body).toBe('string');
      expect(res.body).toContain('%% Rule: service names and connections only, never an address, a login or a secret.');
      expect(res.body).toContain('flowchart TD');
    });

    it('refuses a caller with any other role (401)', async () => {
      mockUserRole('User');
      const res = await request(app)
        .get('/admin/backup/diagram/system')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('The user does not have the permission');
    });

    it('refuses a caller who is not logged in (401)', async () => {
      const res = await request(app).get('/admin/backup/diagram/system');
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Authorization header/i);
    });

    it('refuses a caller whose token is invalid (401)', async () => {
      const res = await request(app)
        .get('/admin/backup/diagram/system')
        .set('Authorization', 'Bearer invalid.token.value');
      expect(res.status).toBe(401);
    });

    it('refuses with 500 when the caller account lookup throws, and returns nothing', async () => {
      mockUserThrow(new Error('Mongo lookup crashed'));
      const res = await request(app)
        .get('/admin/backup/diagram/system')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(/Mongo lookup crashed/i);
      expect(typeof res.body === 'string' ? res.body : '').not.toContain('flowchart');
    });

    it('if docs/system-map.mmd cannot be read, refuses with 500 error and returns no content', async () => {
      mockUserRole('Developer');
      const prevPath = process.env.SYSTEM_MAP_PATH;
      try {
        process.env.SYSTEM_MAP_PATH = '/path/to/nonexistent/system-map.mmd';
        const res = await request(app)
          .get('/admin/backup/diagram/system')
          .set('Authorization', `Bearer ${devToken}`);

        expect(res.status).toBe(500);
        expect(res.body.message).toBe('failed to read system map');
        expect(typeof res.body === 'string' ? res.body : '').not.toContain('flowchart');
      } finally {
        if (prevPath) {
          process.env.SYSTEM_MAP_PATH = prevPath;
        } else {
          delete process.env.SYSTEM_MAP_PATH;
        }
      }
    });
  });

  describe('docs/system-map.mmd content rules', () => {
    it('exists, opens with its rule, and contains no address, login or secret', () => {
      const mapPath = path.resolve(import.meta.dirname, '../../../docs/system-map.mmd');
      expect(fs.existsSync(mapPath)).toBe(true);

      const content = fs.readFileSync(mapPath, 'utf8');
      const lines = content.split('\n');

      // Rule check: first line opens with the rule
      expect(lines[0]).toBe('%% Rule: service names and connections only, never an address, a login or a secret.');

      // No IP addresses
      expect(content).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);

      // No web URL addresses / schemes
      expect(content).not.toMatch(/https?:\/\//i);

      // No secrets, tokens, or credentials (verified on body lines, since rule comment quotes them)
      expect(content).not.toMatch(/password/i);
      const nonCommentLines = lines.slice(1).join('\n');
      expect(nonCommentLines).not.toMatch(/secret/i);
      expect(nonCommentLines).not.toMatch(/login/i);
      expect(nonCommentLines).not.toMatch(/token/i);
      expect(nonCommentLines).not.toMatch(/credential/i);

      // Names the required services
      expect(content).toContain('Website');
      expect(content).toContain('Production Backend (web-jam-back)');
      expect(content).toContain('Socket Server (WebJamSocketCluster)');
      expect(content).toContain('MongoDB Atlas');
      expect(content).toContain('Dropbox (webjam-backup)');
      expect(content).toContain('Deno Deploy');
      expect(content).toContain('Heroku Platform');
    });
  });
});
