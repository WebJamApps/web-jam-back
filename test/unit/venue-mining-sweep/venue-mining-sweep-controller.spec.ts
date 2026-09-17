import {
  describe, it, expect, vi,
} from 'vitest';
import type { Response } from 'express';
import {
  VenueMiningSweepController,
  checkAccess,
  validateSweepBody,
  type AuthRequest,
  type AuthedUser,
} from '#src/model/venue-mining-sweep/venue-mining-sweep-controller.js';
import userModel from '#src/model/user/user-facade.js';
import venueMiningSweepModel from '#src/model/venue-mining-sweep/venue-mining-sweep-schema.js';

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createMockResponse(): { res: Response; mock: MockResponse } {
  const mock: MockResponse = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return { res: mock as unknown as Response, mock };
}

describe('VenueMiningSweepController', () => {
  describe('checkAccess', () => {
    it('returns null when user holds venue-mining:create privilege', () => {
      const user: AuthedUser = { privileges: ['venue-mining:create'] };
      expect(checkAccess(user)).toBeNull();
    });

    it('returns 403 when user has privileges array without venue-mining:create', () => {
      const user: AuthedUser = { privileges: ['venue:create'] };
      const res = checkAccess(user);
      expect(res).toEqual({ status: 403, message: 'missing venue-mining:create capability' });
    });

    it('returns null for JaM-admin role without privileges', () => {
      const user: AuthedUser = { userType: 'JaM-admin' };
      expect(checkAccess(user)).toBeNull();
    });

    it('returns null for Developer role without privileges', () => {
      const user: AuthedUser = { userType: 'Developer' };
      expect(checkAccess(user)).toBeNull();
    });

    it('returns 403 for other roles without privileges', () => {
      const user: AuthedUser = { userType: 'Subscriber' };
      const res = checkAccess(user);
      expect(res).toEqual({ status: 403, message: 'not authorized for venue mining sweeps' });
    });

    it('returns 403 for user with undefined userType and no privileges', () => {
      const user: AuthedUser = { userType: undefined };
      const res = checkAccess(user);
      expect(res).toEqual({ status: 403, message: 'not authorized for venue mining sweeps' });
    });
  });

  describe('validateSweepBody', () => {
    it('returns empty string for valid minimal body', () => {
      const body = {
        metroSlug: 'metro-1',
        sweptAt: '2026-09-16',
        publication: { name: 'Pub', url: 'https://pub.com' },
        venuesCreatedCount: 0,
      };
      expect(validateSweepBody(body)).toBe('');
    });

    it('rejects with error when publication.type is not a string', () => {
      const body = {
        metroSlug: 'metro-1',
        sweptAt: '2026-09-16',
        publication: { name: 'Pub', url: 'https://pub.com', type: 456 },
        venuesCreatedCount: 0,
      };
      expect(validateSweepBody(body)).toBe('publication.type must be a string');
    });
  });

  describe('authorize', () => {
    it('handles undefined req.user', async () => {
      const controller = new VenueMiningSweepController(venueMiningSweepModel);
      vi.spyOn(userModel, 'findById').mockResolvedValueOnce(null);

      const req = {} as unknown as AuthRequest;
      const result = await controller.authorize(req);

      expect(result).toEqual({ status: 401, message: 'user not found' });
      vi.restoreAllMocks();
    });
    it('guard outcome 3: returns 500 when user lookup throws an error', async () => {
      const controller = new VenueMiningSweepController(venueMiningSweepModel);
      vi.spyOn(userModel, 'findById').mockRejectedValueOnce(new Error('DB failure'));

      const req = { user: 'user123' } as unknown as AuthRequest;
      const result = await controller.authorize(req);

      expect(result).toEqual({ status: 500, message: 'DB failure' });
      vi.restoreAllMocks();
    });
  });

  describe('createSweep error branches', () => {
    const validBody = {
      metroSlug: 'metro-1',
      sweptAt: '2026-09-16',
      publication: { name: 'Pub', url: 'https://pub.com' },
      venuesCreatedCount: 1,
    };

    it('returns 500 when pre-check findOne throws', async () => {
      const stubModel = {
        findOne: vi.fn().mockRejectedValueOnce(new Error('Mongo read error')),
        create: vi.fn(),
      } as unknown as typeof venueMiningSweepModel;

      const controller = new VenueMiningSweepController(stubModel);
      vi.spyOn(controller, 'authorize').mockResolvedValueOnce(null);

      const req = { body: validBody } as unknown as AuthRequest;
      const { res, mock } = createMockResponse();

      await controller.createSweep(req, res);

      expect(mock.status).toHaveBeenCalledWith(500);
      expect(mock.json).toHaveBeenCalledWith({ message: 'Mongo read error' });
    });

    it('returns 409 when model.create throws code 11000 duplicate key error', async () => {
      const duplicateErr = new Error('E11000 duplicate key error');
      (duplicateErr as unknown as { code: number }).code = 11000;

      const stubModel = {
        findOne: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn().mockRejectedValueOnce(duplicateErr),
      } as unknown as typeof venueMiningSweepModel;

      const controller = new VenueMiningSweepController(stubModel);
      vi.spyOn(controller, 'authorize').mockResolvedValueOnce(null);

      const req = { body: validBody } as unknown as AuthRequest;
      const { res, mock } = createMockResponse();

      await controller.createSweep(req, res);

      expect(mock.status).toHaveBeenCalledWith(409);
      expect(mock.json).toHaveBeenCalledWith({ message: 'Sweep for this metro and date already exists' });
    });

    it('returns 500 when model.create throws generic error', async () => {
      const stubModel = {
        findOne: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn().mockRejectedValueOnce(new Error('Write failed')),
      } as unknown as typeof venueMiningSweepModel;

      const controller = new VenueMiningSweepController(stubModel);
      vi.spyOn(controller, 'authorize').mockResolvedValueOnce(null);

      const req = { body: validBody } as unknown as AuthRequest;
      const { res, mock } = createMockResponse();

      await controller.createSweep(req, res);

      expect(mock.status).toHaveBeenCalledWith(500);
      expect(mock.json).toHaveBeenCalledWith({ message: 'Write failed' });
    });
  });

  describe('listSweeps error branches', () => {
    it('returns 500 when model.find throws', async () => {
      const stubModel = {
        find: vi.fn().mockReturnValueOnce({
          sort: vi.fn().mockReturnValueOnce({
            lean: vi.fn().mockReturnValueOnce({
              exec: vi.fn().mockRejectedValueOnce(new Error('Query failed')),
            }),
          }),
        }),
      } as unknown as typeof venueMiningSweepModel;

      const controller = new VenueMiningSweepController(stubModel);
      vi.spyOn(controller, 'authorize').mockResolvedValueOnce(null);

      const req = { query: {} } as unknown as AuthRequest;
      const { res, mock } = createMockResponse();

      await controller.listSweeps(req, res);

      expect(mock.status).toHaveBeenCalledWith(500);
      expect(mock.json).toHaveBeenCalledWith({ message: 'Query failed' });
    });
  });
});
