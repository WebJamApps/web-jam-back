import sgMail, { MailService } from '@sendgrid/mail';
import { Request, Response } from 'express';
import Debug from 'debug';

const debug = Debug('web-jam-back:InquiryController');

class InquiryController {
  sgMail: MailService;

  constructor() {
    this.sgMail = sgMail;
  }

  async sendGridEmail(bodyhtml: string, toemail: string, subjectline: string, res: Response) {
    this.sgMail.setApiKey(process.env.SENDGRID_API_KEY || /* istanbul ignore next */'');
    const msg = {
      to: toemail,
      from: 'user-service@web-jam.com',
      subject: subjectline,
      text: bodyhtml,
      html: bodyhtml,
    };
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'test') await sgMail.send(msg);
    return res.status(200).json({ message: 'email sent' });
  }

  handleInquiry(req: Request, res: Response) {
    debug(req.body);
    return this.sendGridEmail(JSON.stringify(req.body), 'web.jam.adm@gmail.com', 'inquiry', res);
  }
}
export default InquiryController;
