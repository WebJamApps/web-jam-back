import nodemailer, { Transporter } from 'nodemailer';
import { Request, Response } from 'express';
import Debug from 'debug';
import { DEFAULT_ARTIST, normalizeArtist } from '#src/lib/artist.js';
import { extractCustomerEmail, formatInquiryEmail } from '#src/model/inquiry/format-inquiry.js';

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

export function senderForArtist(artist: unknown): { user: string; pass: string; from: string } {
  const slug = normalizeArtist(artist);
  if (slug === 'tim' && process.env.TimGmailUser && process.env.TimGmailAppPassword) {
    return {
      user: process.env.TimGmailUser,
      pass: process.env.TimGmailAppPassword,
      from: process.env.TimGmailUser,
    };
  }
  return {
    user: process.env.GMAIL_USER || '',
    pass: process.env.GMAIL_APP_PASSWORD || '',
    from: process.env.GMAIL_USER || '',
  };
}

class InquiryController {
  private transporters = new Map<string, Transporter>();

  private getTransporter(user: string, pass: string): Transporter {
    const existing = this.transporters.get(user);
    if (existing) return existing;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      secure: true,
      auth: { user, pass },
    });
    this.transporters.set(user, transporter);
    return transporter;
  }

  async sendEmail(
    bodyhtml: string,
    toemail: string,
    subjectline: string,
    res: Response,
    ccemail?: string,
    bodytext?: string,
    sender?: { user: string; pass: string; from: string },
    replyTo?: string,
  ) {
    const activeSender = sender || senderForArtist(undefined);
    const msg: Record<string, string> = {
      to: toemail,
      from: activeSender.from,
      subject: subjectline,
      text: bodytext || bodyhtml,
      html: bodyhtml,
    };
    if (ccemail) msg.cc = ccemail;
    if (replyTo) msg.replyTo = replyTo;
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'test') {
      try {
        await this.getTransporter(activeSender.user, activeSender.pass).sendMail(msg);
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
    const artist = (req.body as { artist?: unknown })?.artist;
    const { to, cc } = recipientForArtist(artist);
    const sender = senderForArtist(artist);
    const body = (req.body || {}) as Record<string, unknown>;
    const replyTo = extractCustomerEmail(body) || undefined;
    const { subject, html, text } = formatInquiryEmail(body);
    return this.sendEmail(html, to, subject, res, cc, text, sender, replyTo);
  }
}
export default InquiryController;
