import type { Request, Response, NextFunction } from 'express';
import userModel from '../user/user-schema.js';
import authUtils, { type AuthRequest } from '../../auth/authUtils.js';

export const TOP_ADMIN_ROLE = 'Developer';

async function resolveUserDoc(userId: string): Promise<{ userType?: string } | null> {
  const query = userModel.findById(userId);
  let resolved: unknown = query;
  if (resolved && typeof (resolved as { lean?: unknown }).lean === 'function') {
    resolved = (resolved as { lean: () => unknown }).lean();
  }
  if (resolved && typeof (resolved as { exec?: unknown }).exec === 'function') {
    return (await (resolved as { exec: () => Promise<unknown> }).exec()) as { userType?: string } | null;
  }
  return (await resolved) as { userType?: string } | null;
}

export async function topAdminGuard(req: Request, res: Response, next: NextFunction): Promise<unknown> {
  const authReq = req as AuthRequest;

  // 1. Authenticate token if caller identity not already populated on req
  if (!authReq.user) {
    try {
      await authUtils.ensureAuthenticated(authReq);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('token does not match any existing user') || msg.includes('user lookup')) {
        return res.status(500).json({ message: msg });
      }
      return res.status(401).json({ message: msg });
    }
  }

  if (!authReq.user) {
    return res.status(401).json({ message: 'The user does not have the permission' });
  }

  // 2. Read caller's account through user-schema to verify top-level admin role
  let userDoc: { userType?: string } | null;
  try {
    userDoc = await resolveUserDoc(authReq.user);
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }

  if (!userDoc || userDoc.userType !== TOP_ADMIN_ROLE) {
    return res.status(401).json({ message: 'The user does not have the permission' });
  }

  authReq.userType = userDoc.userType;
  return next();
}

export default topAdminGuard;
