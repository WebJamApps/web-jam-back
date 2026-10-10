import type { Request, Response, NextFunction } from 'express';
import jwt from 'jwt-simple';
import userModel from '../user/user-schema.js';
import type { AuthRequest } from '../../auth/authUtils.js';

export const TOP_ADMIN_ROLE = 'Developer';

interface JwtPayload {
  sub: string;
  iat: number;
  exp?: number;
}

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

  // 1. Authenticate token without going through authUtils.ensureAuthenticated / AUTH_ROLES.
  // The top-level admin role (Developer) is the sole gate for /admin/backup.
  if (!authReq.user) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'The request does not have an Authorization header' });
    }
    const tokenStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const parts = tokenStr.split(' ');
    const token = parts.length > 1 ? parts[1] : parts[0];

    try {
      const payload = jwt.decode(token, process.env.HashString || '') as JwtPayload;
      if (!payload || !payload.sub) {
        return res.status(401).json({ message: 'Invalid token' });
      }
      authReq.user = payload.sub;
    } catch (err) {
      return res.status(401).json({ message: (err as Error).message });
    }
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
