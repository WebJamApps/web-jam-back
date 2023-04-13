import moment from 'moment';
import jwt from 'jwt-simple';
import Debug from 'debug';
import dotenv from 'dotenv';
import userModel from '../model/user/user-schema';

dotenv.config();
const debug = Debug('web-jam-back:authUtils');

const findUserById = async (
  req: { user: any; userType: string; baseUrl:string },
):Promise<any> => {
  let myUser:any;
  try { myUser = await userModel.findById(req.user).lean().exec(); } catch (e) {
    throw new Error(`token does not match any existing user, ${(e as Error).message}`);
  }
  req.userType = myUser ? myUser.userType : 'none';
  debug(req.userType);
  debug(req.baseUrl);
  const authRoles:any = JSON.parse(process.env.AUTH_ROLES || /* istanbul ignore next */'{}');
  const route = req.baseUrl.split('/')[1];
  // eslint-disable-next-line security/detect-object-injection
  const rolesArr: any[] = authRoles[route] || /* istanbul ignore next */[];
  if (rolesArr.length && rolesArr.indexOf(req.userType) === -1) {
    throw new Error('The user does not have the permission');
  }
};

const createJWT = (user: { _id:string }): string => {
  const payload = {
    sub: user._id,
    iat: moment().unix(),
    exp: moment().add(14, 'days').unix(),
  };
  return jwt.encode(payload, process.env.HashString || /* istanbul ignore next */'');
};

const ensureAuthenticated = (req: any): Promise<any> => {
  if (!req.headers.authorization && !req.headers.Authorization) {
    throw new Error('The request does not have an Authorization header');
  }
  let payload = { sub: '' }, token:string = req.headers.authorization || /* istanbul ignore next */req.headers.Authorization;
  // eslint-disable-next-line prefer-destructuring
  token = token.split(' ')[1];
  payload = jwt.decode(token, process.env.HashString || /* istanbul ignore next */'');
  req.user = payload.sub;// this is the userId
  return findUserById(req);
};

const checkEmailSyntax = (req: any): Promise<boolean> => { // eslint-disable-next-line security/detect-unsafe-regex
  if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(req.body.changeemail)) {
    return Promise.resolve(true);
  }
  return Promise.reject(new Error('email address is not a valid format'));
};

export default {
  checkEmailSyntax, ensureAuthenticated, createJWT, findUserById,
};
