import moment from 'moment';
import jwt from 'jwt-simple';
import Debug from 'debug';
import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';
import userModel from '../model/user/user-schema';

dotenv.config();
const debug = Debug('web-jam-back:authUtils');

const findUserById = async (req: { user: any; userType: string; baseUrl:string },
  res: { status: (arg0: number) => { (): any; new(): any; json: { (arg0: { message: string; }): any; new(): any; }; }; },
  next: () => any):Promise<any> => {
  let myUser:any;
  try { myUser = await userModel.findById(req.user).lean().exec(); } catch (e) {
    return res.status(500).json({ message: `token does not match any existing user, ${e.message}` });
  }
  req.userType = myUser ? myUser.userType : 'none';
  debug(req.userType);
  debug(req.baseUrl);
  const authRoles:any = JSON.parse(process.env.AUTH_ROLES || /* istanbul ignore next */'{}');
  const route = req.baseUrl.split('/')[1];
  // eslint-disable-next-line security/detect-object-injection
  const rolesArr: any[] = authRoles[route] || /* istanbul ignore next */[];
  if (rolesArr.length && rolesArr.indexOf(req.userType) === -1) return res.status(401).json({ message: 'The user does not have the permission' });
  return next();
};

const createJWT = (user: {_id:string}): string => {
  const payload = {
    sub: user._id,
    iat: moment().unix(),
    exp: moment().add(14, 'days').unix(),
  };
  return jwt.encode(payload, process.env.HashString || /* istanbul ignore next */'');
};

const ensureAuthenticated = (req: any, res: any, next: any): Promise<any> => {
  if (!req.headers.authorization && !req.headers.Authorization) {
    return res.status(401).send({ message: 'The request does not have an Authorization header' });
  }
  let payload = { sub: '' }, token:string = req.headers.authorization || /* istanbul ignore next */req.headers.Authorization;
  // eslint-disable-next-line prefer-destructuring
  token = token.split(' ')[1];
  try {
    payload = jwt.decode(token, process.env.HashString || /* istanbul ignore next */'');
  } catch (err) {
    return res.status(401).send({ message: err.message });
  }
  req.user = payload.sub;// this is the userId
  return findUserById(req, res, next);
  // if (process.env.NODE_ENV !== 'test') return findUserById(req, res, next);
  // return next();
};

const sendGridEmail = (bodyhtml: string, toemail: string, subjectline: string): void => {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY || /* istanbul ignore next */'');
  const msg = {
    to: toemail,
    from: 'user-service@web-jam.com',
    subject: subjectline,
    text: bodyhtml,
    html: bodyhtml,
  };
    /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'test') sgMail.send(msg);
};

const generateCode = (hi: number, low: number): number => {
  const min = Math.ceil(low);
  const max = Math.floor(hi);
  return Math.floor(Math.random() * (max - min)) + min;
};

const checkEmailSyntax = (req: any): Promise<boolean> => { // eslint-disable-next-line security/detect-unsafe-regex
  if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(req.body.changeemail)) {
    return Promise.resolve(true);
  }
  return Promise.reject(new Error('email address is not a valid format'));
};

const setIfExists = (item: string | null | undefined): string => {
  if (item !== '' && item !== null && item !== undefined) {
    return item;
  }
  return '';
};

export default {
  setIfExists, checkEmailSyntax, generateCode, sendGridEmail, ensureAuthenticated, createJWT, findUserById,
};
