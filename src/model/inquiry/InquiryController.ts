import nodemailer, { Transporter } from 'nodemailer';
import { Request, Response } from 'express';
import Debug from 'debug';
import { DEFAULT_ARTIST, normalizeArtist } from '#src/lib/artist.js';
import { formatInquiryEmail } from '#src/model/inquiry/format-inquiry.js';

const debug = Debug('web-jam-back:InquiryController');

const RECIPIENT_EMAIL = 'joshua.v.sherman@gmail.com';
// CC Maria on every inquiry so she sees booking requests in real time
// (Josh's preference 2026-05-18). Comma-separated string per nodemailer spec.
const INQUIRY_CC = 'chemmariasherman@gmail.com';

// Contact/booking submissions are artist-scoped (#885): a submission carries an
// `artist` slug and is emailed to that artist's booking contact. The default
// (JaMmusic) artist keeps the original Josh + Maria-CC behaviour. Other artists'
// recipients come from the InquiryRecipients env map ({"tim":"tim@example.com"});
// an unmapped artist falls back to the default so no inquiry is ever dropped.
export function recipientForArtist(artist: unknown): { to: string; cc?: string } {
  const slug = normalizeArtist(artist);
  if (slug === DEFAULT_ARTIST) return { to: RECIPIENT_EMAIL, cc: INQUIRY_CC };
  let map: Record<string, string>;
  try { map = JSON.parse(process.env.InquiryRecipients || '{}') as Record<string, string>; } catch { map = {}; }
  // eslint-disable-next-line security/detect-object-injection
  const to = map[slug];
  return typeof to === 'string' && to ? { to } : { to: RECIPIENT_EMAIL, cc: INQUIRY_CC };
}

class InquiryController {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    /* istanbul ignore else */
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      secure: true,
      auth: {
        user: process.env.GMAIL_USER || /* istanbul ignore next */ '',
        pass: process.env.GMAIL_APP_PASSWORD || /* istanbul ignore next */ '',
      },
    });
    return this.transporter;
  }

  async sendEmail(
    bodyhtml: string,
    toemail: string,
    subjectline: string,
    res: Response,
    ccemail?: string,
    bodytext?: string,
  ) {
    const msg: Record<string, string> = {
      to: toemail,
      from: process.env.GMAIL_USER || /* istanbul ignore next */ '',
      subject: subjectline,
      text: bodytext || bodyhtml,
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
    const { to, cc } = recipientForArtist((req.body as { artist?: unknown })?.artist);
    const { subject, html, text } = formatInquiryEmail(req.body as Record<string, unknown>);
    return this.sendEmail(html, to, subject, res, cc, text);
  }
}
export default InquiryController;
