import jwt from 'jwt-simple';
import Debug from 'debug';
import dotenv from 'dotenv';
import type { Request } from 'express';
import userModel from '../model/user/user-schema.js';

dotenv.config({ quiet: true });
const debug = Debug('web-jam-back:authUtils');

interface AuthRequest extends Request {
  user?: string;
  userType?: string;
}

interface UserDoc {
  userType?: string;
}

const findUserById = async (req: AuthRequest): Promise<void> => {
  let myUser: UserDoc | null;
  try { myUser = await userModel.findById(req.user).lean().exec() as UserDoc | null; } catch (e) {
    throw new Error(`token does not match any existing user, ${(e as Error).message}`);
  }
  req.userType = myUser ? myUser.userType : 'none';
  debug(req.userType);
  debug(req.baseUrl);
  const authRoles: Record<string, string[]> = JSON.parse(process.env.AUTH_ROLES || /* istanbul ignore next */'{}');
  const route = req.baseUrl.split('/')[1];
  // eslint-disable-next-line security/detect-object-injection
  const rolesArr: string[] = authRoles[route] || /* istanbul ignore next */[];
  if (rolesArr.length && rolesArr.indexOf(req.userType ?? '') === -1) {
    throw new Error('The user does not have the permission');
  }
};

const createJWT = (user: { _id: string }): string => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user._id,
    iat: nowSeconds,
    exp: nowSeconds + 14 * 24 * 60 * 60,
  };
  return jwt.encode(payload, process.env.HashString || /* istanbul ignore next */'');
};

const ensureAuthenticated = (req: AuthRequest): Promise<void> => {
  if (!req.headers.authorization && !req.headers.Authorization) {
    throw new Error('The request does not have an Authorization header');
  }
  let payload = { sub: '' };
  let token: string = (req.headers.authorization || /* istanbul ignore next */req.headers.Authorization) as string;
  // eslint-disable-next-line prefer-destructuring
  token = token.split(' ')[1];
  payload = jwt.decode(token, process.env.HashString || /* istanbul ignore next */'');
  req.user = payload.sub;
  return findUserById(req);
};

const checkEmailSyntax = (req: { body: { changeemail: string } }): Promise<boolean> => { // eslint-disable-next-line security/detect-unsafe-regex
  if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(req.body.changeemail)) {
    return Promise.resolve(true);
  }
  return Promise.reject(new Error('email address is not a valid format'));
};

export default {
  checkEmailSyntax, ensureAuthenticated, createJWT, findUserById,
};
