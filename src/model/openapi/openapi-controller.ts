import type { Request, Response } from 'express';
import jwt from 'jwt-simple';
import fs from 'fs';
import path from 'path';
import authUtils from '../../auth/authUtils.js';
import userModel from '../user/user-schema.js';

interface JwtPayload {
  sub: string;
  iat: number;
  exp?: number;
}

export function resolveOpenApiPath(customPath?: string, dir: string = import.meta.dirname): string {
  if (customPath) return customPath;
  const candidates = [
    path.resolve(process.cwd(), 'openapi.json'),
    path.resolve(process.cwd(), 'build/openapi.json'),
    path.resolve(dir, '../../../openapi.json'),
    path.resolve(dir, '../../openapi.json'),
    path.resolve(dir, '../openapi.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

export async function getOpenApiSpec(req: Request, res: Response, customPath?: string): Promise<Response> {
  const token = authUtils.extractToken(req);
  if (!token) {
    return res.status(401).json({ message: 'The request does not have an Authorization header' });
  }

  let payload: JwtPayload;
  try {
    payload = jwt.decode(token, process.env.HashString || '') as JwtPayload;
    if (!payload || !payload.sub || typeof payload.sub !== 'string') {
      return res.status(401).json({ message: 'Invalid token' });
    }
  } catch (err) {
    return res.status(401).json({ message: (err as Error).message });
  }

  let userDoc: { userType?: string; privileges?: string[] } | null;
  try {
    userDoc = await userModel.findById(payload.sub).lean().exec() as { userType?: string; privileges?: string[] } | null;
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }

  if (!userDoc) {
    return res.status(401).json({ message: 'User not found' });
  }

  const isAllowedRole = userDoc.userType === 'JaM-admin' || userDoc.userType === 'Developer';
  const hasCapability = Array.isArray(userDoc.privileges) && userDoc.privileges.length > 0;
  if (!isAllowedRole && !hasCapability) {
    return res.status(403).json({ message: 'not authorized to access the API specification' });
  }

  try {
    const specPath = resolveOpenApiPath(customPath);
    const content = await fs.promises.readFile(specPath, 'utf8');
    return res.status(200).json(JSON.parse(content));
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
}

export default { getOpenApiSpec, resolveOpenApiPath };
