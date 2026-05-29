import jwt from 'jwt-simple';
import Debug from 'debug';
import dotenv from 'dotenv';
import type { Request } from 'express';
import userModel from '../model/user/user-schema.js';

dotenv.config({ quiet: true });
const debug = Debug('web-jam-back:authUtils');

export interface AuthRequest extends Request {
  user?: string;
  userType?: string;
}

export interface EmailCheckRequest {
  body: {
    changeemail: string;
  };
}

interface UserDoc {
  userType?: string;
}

interface JwtPayload {
  sub: string;
  iat: number;
  exp?: number;
}

const authRoles = JSON.parse(process.env.AUTH_ROLES || /* istanbul ignore next */'{}') as Record<string, string[]>;

const findUserById = async (req: AuthRequest): Promise<void> => {
  let myUser: UserDoc | null;
  try { myUser = await userModel.findById(req.user || '').lean().exec() as UserDoc | null; } catch (err) {
    const e = err as Error;
    throw new Error(`token does not match any existing user, ${e.message}`);
  }
  req.userType = myUser ? myUser.userType : 'none';
  debug(req.userType);
  debug(req.baseUrl);
  const route = req.baseUrl.split('/')[1] || '';
  // eslint-disable-next-line security/detect-object-injection
  const rolesArr: string[] = authRoles[route] || /* istanbul ignore next */[];
  if (rolesArr.length && rolesArr.indexOf(req.userType ?? '') === -1) {
    throw new Error('The user does not have the permission');
  }
};

const createJWT = (user: { _id: string }): string => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: user._id,
    iat: nowSeconds,
    exp: nowSeconds + 14 * 24 * 60 * 60,
  };
  return jwt.encode(payload, process.env.HashString || /* istanbul ignore next */'');
};

const createServiceJWT = (user: { _id: string }): string => {
  const payload: JwtPayload = {
    sub: user._id,
    iat: Math.floor(Date.now() / 1000),
  };
  return jwt.encode(payload, process.env.HashString || /* istanbul ignore next */'');
};

const ensureAuthenticated = (req: AuthRequest): Promise<void> => {
  if (!req.headers.authorization && !req.headers.Authorization) {
    throw new Error('The request does not have an Authorization header');
  }
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const tokenStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;

  const parts = tokenStr.split(' ');
  const token = parts.length > 1 ? parts[1] : parts[0];
  const payload = jwt.decode(token, process.env.HashString || /* istanbul ignore next */'') as JwtPayload;
  req.user = payload.sub;
  return findUserById(req);
};

const checkEmailSyntax = async (req: EmailCheckRequest): Promise<boolean> => {
  if (/^[^\s@]+@[^\s@]+\.[^\s.@]+$/.test(req.body.changeemail)) {
    return true;
  }
  throw new Error('email address is not a valid format');
};

export default {
  checkEmailSyntax, ensureAuthenticated, createJWT, createServiceJWT, findUserById,
};
