import nodemailer, { Transporter } from 'nodemailer';
import Debug from 'debug';

// Shared Gmail mailer, reused across promotion channels (subscriber confirm /
// unsubscribe now; gig blasts next). Mirrors the InquiryController transport so
// both rely on the same GMAIL_USER / GMAIL_APP_PASSWORD credentials.
const debug = Debug('web-jam-back:mailer');

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  /* istanbul ignore else */
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    secure: true,
    auth: {
      user: process.env.GMAIL_USER || /* istanbul ignore next */ '',
      pass: process.env.GMAIL_APP_PASSWORD || /* istanbul ignore next */ '',
    },
  });
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Sends one email. No-ops under NODE_ENV=test so unit tests never hit Gmail.
export async function sendMail(input: MailInput): Promise<void> {
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'test') {
    try {
      await getTransporter().sendMail({
        from: process.env.GMAIL_USER || '',
        to: input.to,
        subject: input.subject,
        text: input.text || input.html,
        html: input.html,
      });
    } catch (err) {
      debug('email send failed: %o', err);
      throw err;
    }
  }
}

export default { sendMail };
