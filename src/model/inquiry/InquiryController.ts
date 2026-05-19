import nodemailer, { Transporter } from 'nodemailer';
import { Request, Response } from 'express';
import Debug from 'debug';

const debug = Debug('web-jam-back:InquiryController');

const RECIPIENT_EMAIL = 'joshua.v.sherman@gmail.com';
// CC Maria on every inquiry so she sees booking requests in real time
// (Josh's preference 2026-05-18). Comma-separated string per nodemailer spec.
const INQUIRY_CC = 'chemmariasherman@gmail.com';

class InquiryController {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    /* istanbul ignore else */
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER || /* istanbul ignore next */ '',
        pass: process.env.GMAIL_APP_PASSWORD || /* istanbul ignore next */ '',
      },
    });
    return this.transporter;
  }

  async sendEmail(bodyhtml: string, toemail: string, subjectline: string, res: Response, ccemail?: string) {
    const msg: Record<string, string> = {
      to: toemail,
      from: process.env.GMAIL_USER || /* istanbul ignore next */ '',
      subject: subjectline,
      text: bodyhtml,
      html: bodyhtml,
    };
    if (ccemail) msg.cc = ccemail;
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'test') {
      try {
        await this.getTransporter().sendMail(msg);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        debug('Email send failed: %o', e);
        return res.status(502).json({ message: 'email provider error', code: e.code, error: e.message });
      }
    }
    return res.status(200).json({ message: 'email sent' });
  }

  handleInquiry(req: Request, res: Response) {
    debug(req.body);
    return this.sendEmail(JSON.stringify(req.body), RECIPIENT_EMAIL, 'inquiry', res, INQUIRY_CC);
  }
}
export default InquiryController;
