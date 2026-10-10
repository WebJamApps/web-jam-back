import type { Request, Response, NextFunction } from 'express';
import { topAdminGuard, TOP_ADMIN_ROLE } from '#src/model/backup/top-admin-guard.js';
import userModel from '#src/model/user/user-schema.js';
import authUtils, { type AuthRequest } from '#src/auth/authUtils.js';

describe('topAdminGuard', () => {
  let req: Partial<AuthRequest>;
  let res: Partial<Response>;
  let next: NextFunction;
  let statusMock: ReturnType<typeof vi.fn>;
  let jsonMock: ReturnType<typeof vi.fn>;

  const devToken = authUtils.createJWT({ _id: 'user-developer-id' });
  const otherToken = authUtils.createJWT({ _id: 'user-jam-admin-id' });

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    res = {
      status: statusMock as unknown as Response['status'],
    };
    next = vi.fn();
    req = {
      headers: {},
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports Developer as the TOP_ADMIN_ROLE', () => {
    expect(TOP_ADMIN_ROLE).toBe('Developer');
  });

  it('serves a caller whose account holds the Developer role (calls next)', async () => {
    req.user = 'user-developer-id';
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve({ userType: 'Developer' }),
      }),
    } as unknown as ReturnType<typeof userModel.findById>);

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(statusMock).not.toHaveBeenCalled();
    expect(req.userType).toBe('Developer');
  });

  it('serves a caller with a valid authorization header token and Developer role', async () => {
    req.headers = { authorization: `Bearer ${devToken}` };
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve({ userType: 'Developer' }),
      }),
    } as unknown as ReturnType<typeof userModel.findById>);

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(statusMock).not.toHaveBeenCalled();
    expect(req.user).toBe('user-developer-id');
    expect(req.userType).toBe('Developer');
  });

  it('serves a caller when findById returns a direct promise rather than query object', async () => {
    req.user = 'user-developer-id';
    vi.spyOn(userModel, 'findById').mockResolvedValue({ userType: 'Developer' } as unknown as never);

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(statusMock).not.toHaveBeenCalled();
  });

  it('refuses with 401 when caller holds another role (e.g. JaM-admin)', async () => {
    req.user = 'user-jam-admin-id';
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve({ userType: 'JaM-admin' }),
      }),
    } as unknown as ReturnType<typeof userModel.findById>);

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/permission/i) }));
  });

  it('refuses with 401 when caller holds role none or has no userType', async () => {
    req.user = 'user-none-id';
    vi.spyOn(userModel, 'findById').mockResolvedValue({ userType: '' } as unknown as never);

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(401);
  });

  it('refuses with 401 when user document is not found', async () => {
    req.user = 'missing-id';
    vi.spyOn(userModel, 'findById').mockResolvedValue(null as unknown as never);

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(401);
  });

  it('refuses with 401 when caller is not logged in (no authorization header)', async () => {
    req.user = undefined;
    req.headers = {};

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Authorization/i) }));
  });

  it('refuses with 401 when token is invalid or malformed', async () => {
    req.user = undefined;
    req.headers = { authorization: 'Bearer invalid.token' };

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(401);
  });

  it('refuses with 500 when account lookup throws in findById', async () => {
    req.user = 'user-db-error-id';
    vi.spyOn(userModel, 'findById').mockRejectedValueOnce(new Error('Database connectivity error'));

    await topAdminGuard(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ message: 'Database connectivity error' }));
  });

  it('serves and refuses correctly with AUTH_ROLES unset', async () => {
    const originalAuthRoles = process.env.AUTH_ROLES;
    try {
      delete process.env.AUTH_ROLES;

      // 1. Developer caller is served
      req.user = 'user-dev';
      vi.spyOn(userModel, 'findById').mockResolvedValue({ userType: 'Developer' } as unknown as never);
      await topAdminGuard(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // 2. Non-developer caller is refused
      next = vi.fn();
      statusMock.mockClear();
      jsonMock.mockClear();
      req.user = 'user-other';
      vi.spyOn(userModel, 'findById').mockResolvedValue({ userType: 'editor' } as unknown as never);
      await topAdminGuard(req as Request, res as Response, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
    } finally {
      if (originalAuthRoles !== undefined) {
        process.env.AUTH_ROLES = originalAuthRoles;
      }
    }
  });

  it('serves Developer and refuses JaM-admin when AUTH_ROLES.admin excludes Developer', async () => {
    const originalAuthRoles = process.env.AUTH_ROLES;
    try {
      process.env.AUTH_ROLES = JSON.stringify({ admin: ['JaM-admin'] });

      // 1. Developer caller with token is served
      req.headers = { authorization: `Bearer ${devToken}` };
      req.user = undefined;
      vi.spyOn(userModel, 'findById').mockResolvedValue({ userType: 'Developer' } as unknown as never);
      await topAdminGuard(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.userType).toBe('Developer');

      // 2. JaM-admin caller is refused
      next = vi.fn();
      statusMock.mockClear();
      jsonMock.mockClear();
      req.headers = { authorization: `Bearer ${otherToken}` };
      req.user = undefined;
      vi.spyOn(userModel, 'findById').mockResolvedValue({ userType: 'JaM-admin' } as unknown as never);
      await topAdminGuard(req as Request, res as Response, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(401);
    } finally {
      if (originalAuthRoles !== undefined) {
        process.env.AUTH_ROLES = originalAuthRoles;
      }
    }
  });
});
