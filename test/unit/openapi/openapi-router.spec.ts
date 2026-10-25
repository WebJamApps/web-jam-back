import fs from 'fs';
import path from 'path';
import app from '#src/index.js';
import authUtils from '#src/auth/authUtils.js';
import userModel from '#src/model/user/user-schema.js';
import request, { type ApiResponse } from '../../helpers/api.js';
import { resolveOpenApiPath } from '#src/model/openapi/openapi-controller.js';

describe('OpenAPI Specification Router (GET /openapi.json)', () => {
  const adminToken = authUtils.createJWT({ _id: 'admin-user-id' });
  const devToken = authUtils.createJWT({ _id: 'dev-user-id' });
  const capableToken = authUtils.createJWT({ _id: 'capable-user-id' });
  const emptyPrivsToken = authUtils.createJWT({ _id: 'empty-privs-user-id' });
  const unprivilegedToken = authUtils.createJWT({ _id: 'unprivileged-user-id' });

  const mockUser = (userType: string, privileges?: string[]) => {
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve({ userType, privileges }),
      }),
    } as never);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authorization Rules', () => {
    it('answers 200 with the specification for JaM-admin', async () => {
      mockUser('JaM-admin');
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.info.title).toBe('web-jam-back API');
      expect(res.body.paths['/gig']).toBeDefined();
      expect(res.body.paths['/setlist']).toBeDefined();
    });

    it('answers 200 with the specification for Developer', async () => {
      mockUser('Developer');
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.paths['/gig']).toBeDefined();
    });

    it('answers 200 for a caller holding any capability (even with userType User)', async () => {
      mockUser('User', ['venue:create']);
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${capableToken}`);

      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
    });

    it('answers 200 for a caller holding multiple capabilities', async () => {
      mockUser('User', ['gig:create', 'tour:create']);
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${capableToken}`);

      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
    });

    it('answers 403 for a signed-in caller holding none (empty privileges array)', async () => {
      mockUser('User', []);
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${emptyPrivsToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not authorized/i);
    });

    it('answers 403 for a signed-in caller holding none (no privileges field)', async () => {
      mockUser('User', undefined);
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${unprivilegedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not authorized/i);
    });

    it('answers 401 when no token is provided', async () => {
      const res: ApiResponse = await request(app).get('/openapi.json');
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Authorization header/i);
    });

    it('answers 401 when Authorization header is malformed or invalid', async () => {
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', 'Bearer invalid-token-string');

      expect(res.status).toBe(401);
    });

    it('answers 401 when user is not found in database', async () => {
      vi.spyOn(userModel, 'findById').mockReturnValue({
        lean: () => ({
          exec: () => Promise.resolve(null),
        }),
      } as never);

      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/User not found/i);
    });

    it('answers 500 when database lookup throws an error (Outcome 3)', async () => {
      vi.spyOn(userModel, 'findById').mockReturnValue({
        lean: () => ({
          exec: () => Promise.reject(new Error('MongoDB connection timeout')),
        }),
      } as never);

      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('MongoDB connection timeout');
    });

    it('answers 500 when reading specification file fails', async () => {
      mockUser('JaM-admin');
      vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('Disk read error'));

      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Disk read error');
    });

    it('answers 200 even when AUTH_ROLES is empty (decoupled from multi-role infrastructure)', async () => {
      const originalAuthRoles = process.env.AUTH_ROLES;
      process.env.AUTH_ROLES = '{}';
      try {
        mockUser('JaM-admin');
        const res: ApiResponse = await request(app)
          .get('/openapi.json')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
      } finally {
        process.env.AUTH_ROLES = originalAuthRoles;
      }
    });
  });

  describe('OpenAPI Specification Content Verification', () => {
    it('describes gig and setlist routes accurately and excludes delete-many routes', async () => {
      mockUser('Developer');
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      const spec = res.body;

      // Gig routes
      expect(spec.paths['/gig']).toBeDefined();
      expect(spec.paths['/gig'].get).toBeDefined();
      expect(spec.paths['/gig'].post).toBeDefined();
      expect(spec.paths['/gig'].delete).toBeUndefined(); // DELETE /gig removed
      expect(spec.paths['/gig'].post['x-required-capabilities']).toEqual(['gig:create', 'tour:create']);

      expect(spec.paths['/gig/promo-default.jpg']).toBeDefined();
      expect(spec.paths['/gig/{id}']).toBeDefined();
      expect(spec.paths['/gig/{id}'].get).toBeDefined();
      expect(spec.paths['/gig/{id}'].put).toBeDefined();
      expect(spec.paths['/gig/{id}'].delete).toBeDefined();
      expect(spec.paths['/gig/{id}'].delete['x-required-capabilities']).toEqual(['gig:delete', 'tour:delete']);

      expect(spec.paths['/gig/{id}/announce']).toBeDefined();
      expect(spec.paths['/gig/{id}/announce'].post['x-required-capabilities']).toEqual(['gig:announce']);

      // Setlist routes
      expect(spec.paths['/setlist']).toBeDefined();
      expect(spec.paths['/setlist'].get).toBeDefined();
      expect(spec.paths['/setlist'].post).toBeDefined();
      expect(spec.paths['/setlist'].delete).toBeUndefined(); // DELETE /setlist removed

      expect(spec.paths['/setlist/{id}']).toBeDefined();
      expect(spec.paths['/setlist/{id}'].get).toBeDefined();
      expect(spec.paths['/setlist/{id}'].put).toBeDefined();
      expect(spec.paths['/setlist/{id}'].delete).toBeDefined();

      // Setlist update schema permits partial updates (e.g. items-only) without required name
      expect(spec.paths['/setlist'].post.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/SetlistInput');
      expect(spec.paths['/setlist/{id}'].put.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/SetlistUpdateInput');
      expect(spec.components.schemas.SetlistInput.required).toEqual(['name']);
      expect(spec.components.schemas.SetlistUpdateInput.required).toBeUndefined();

      // Does not leak private Dropbox paths
      expect(JSON.stringify(spec)).not.toContain('~/Dropbox');
      expect(JSON.stringify(spec)).not.toContain('/home/joshua/Dropbox');
    });

    it('accepts partial setlist updates without name while creation requires name', async () => {
      mockUser('Developer');
      const res: ApiResponse = await request(app)
        .get('/openapi.json')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      const spec = res.body;

      const creationSchemaRef = spec.paths['/setlist'].post.requestBody.content['application/json'].schema.$ref;
      const updateSchemaRef = spec.paths['/setlist/{id}'].put.requestBody.content['application/json'].schema.$ref;

      expect(creationSchemaRef).toBe('#/components/schemas/SetlistInput');
      expect(updateSchemaRef).toBe('#/components/schemas/SetlistUpdateInput');

      const creationSchema = spec.components.schemas.SetlistInput;
      const updateSchema = spec.components.schemas.SetlistUpdateInput;

      expect(creationSchema.required).toContain('name');
      expect(updateSchema.required).toBeUndefined();
      // An items-only update payload conforms to the update schema
      expect(updateSchema.properties.items).toBeDefined();
      expect(updateSchema.properties.name).toBeDefined();
      expect(updateSchema.properties.description).toBeDefined();
    });
  });

  describe('Path Resolution (Rule 57)', () => {
    it('resolves the specification path to an existing openapi.json file', () => {
      const resolved = resolveOpenApiPath();
      expect(fs.existsSync(resolved)).toBe(true);
      expect(resolved.endsWith('openapi.json')).toBe(true);
    });

    it('resolves cleanly when simulated from compiled build layout', () => {
      const simulatedDir = path.resolve(process.cwd(), 'build/src/model/openapi');
      const resolved = resolveOpenApiPath(undefined, simulatedDir);
      expect(fs.existsSync(resolved)).toBe(true);
    });

    it('returns customPath directly when provided', () => {
      const custom = '/some/custom/path/openapi.json';
      expect(resolveOpenApiPath(custom)).toBe(custom);
    });
  });
});
