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

// One inline image embedded by Content-ID (cid:) — used for the gig-pitch footer
// photo, which has to ride along in the message because Gmail's image proxy
// rejects hot-linked Dropbox/hosted URLs (gig-outreach #823).
export interface MailAttachment {
  filename: string;
  path: string;
  cid: string;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  // CC recipients — gig pitches CC Josh + Maria so they see every send.
  cc?: string | string[];
  attachments?: MailAttachment[];
}

// Sends one email and returns the RFC Message-ID Gmail assigned it (used by the
// outreach log to later match replies, #823). No-ops under NODE_ENV=test so unit
// tests never hit Gmail — returns a stub id so callers can persist a value.
export async function sendMail(input: MailInput): Promise<{ messageId: string }> {
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'test') {
    try {
      const info = await getTransporter().sendMail({
        from: process.env.GMAIL_USER || '',
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.text || input.html,
        html: input.html,
        attachments: input.attachments,
      });
      return { messageId: info.messageId };
    } catch (err) {
      debug('email send failed: %o', err);
      throw err;
    }
  }
  return { messageId: 'test-message-id' };
}

export default { sendMail };
