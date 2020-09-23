import moment from 'moment';
import jwt from 'jwt-simple';
import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';

dotenv.config();
class AuthUtils {
  static createJWT(user: any): any {
    const payload = {
      sub: user._id,
      iat: moment().unix(),
      exp: moment().add(14, 'days').unix(),
    };
    return jwt.encode(payload, process.env.HashString || /* istanbul ignore next */'');
  }

  static ensureAuthenticated(req: any, res: any, next: any): any {
    if (!req.headers.authorization) {
      return res.status(401).send({ message: 'Please make sure your request has an Authorization header' });
    }
    const token = req.headers.authorization.split(' ')[1];
    let payload = { sub: '' };
    try {
      payload = jwt.decode(token, process.env.HashString || /* istanbul ignore next */'');
    } catch (err) {
      return res.status(401).send({ message: err.message });
    }
    req.user = payload.sub;// this is the userId
    // set the userType by fetching the user by id
    return next();
  }

  static sendGridEmail(bodyhtml: string, toemail: string, subjectline: string): void {
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
  }

  static generateCode(hi: number, low: number): number {
    const min = Math.ceil(low);
    const max = Math.floor(hi);
    return Math.floor(Math.random() * (max - min)) + min;
  }

  static checkEmailSyntax(req: any): Promise<boolean> { // eslint-disable-next-line security/detect-unsafe-regex
    if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(req.body.changeemail)) {
      return Promise.resolve(true);
    }
    return Promise.reject(new Error('email address is not a valid format'));
  }

  static setIfExists(item: string | null | undefined): string {
    if (item !== '' && item !== null && item !== undefined) {
      return item;
    }
    return '';
  }
}

export default AuthUtils;
