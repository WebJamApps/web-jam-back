import nodemailer, { Transporter } from 'nodemailer';
import { Request, Response } from 'express';
import Debug from 'debug';
import { DEFAULT_ARTIST, normalizeArtist } from '#src/lib/artist.js';
import { isAllowedOrigin, readStaticOrigins } from '#src/lib/cors.js';
import { extractCustomerEmail, formatInquiryEmail } from '#src/model/inquiry/format-inquiry.js';
import {
  extractMessage,
  hasTrapValue,
  hasValidFormLoadTime,
  isBookingForm,
  parseKnownForm,
  UNVERIFIED_ADDRESS_MESSAGE,
  validateBookingFields,
} from '#src/model/inquiry/inquiry-checks.js';
import {
  hasStreetAddress,
  searchVenueAddress,
  type VenuePlaceLookup,
  verifyVenuePlace,
} from '#src/model/inquiry/lookup-venue.js';
import { isSalesPitchMessage } from '#src/model/inquiry/sales-pitch.js';

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

// Kept separate from sender selection: Tim's Places key never falls back to Josh's.
// The later address-verification step consumes this lookup.
export function googlePlacesKeyForArtist(artist: unknown): string | undefined {
  return normalizeArtist(artist) === 'tim'
    ? process.env.TimGooglePlacesApiKey
    : process.env.GOOGLE_PLACES_API_KEY;
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

  async handleInquiry(req: Request, res: Response) {
    debug(req.body);
    const body = (req.body || {}) as Record<string, unknown>;

    // Check 2: Known form and site — missing/unrecognized form, or missing/disallowed Origin, drops silently.
    const form = parseKnownForm(body.form);
    if (!form) return res.status(200).json({ message: 'email sent' });
    if (!isAllowedOrigin(req.headers?.origin, readStaticOrigins(), false)) {
      return res.status(200).json({ message: 'email sent' });
    }

    // Check 3: Hidden trap field — any value in `website` drops silently.
    if (hasTrapValue(body.website)) return res.status(200).json({ message: 'email sent' });

    // Check 4: Speed check — missing, non-number, future, or < 3s drops silently.
    if (!hasValidFormLoadTime(body.formLoadedAt)) return res.status(200).json({ message: 'email sent' });

    const artist = body.artist;
    let venue: VenuePlaceLookup | undefined;

    if (isBookingForm(form)) {
      // Check 5: Required booking fields (jam-bookus and tim-booking only).
      const fieldError = validateBookingFields(body);
      if (fieldError) return res.status(400).json({ message: fieldError });

      // Check 6: Verified venue address (Places details or searchText).
      const apiKey = googlePlacesKeyForArtist(artist);
      const placeId = typeof body.venuePlaceId === 'string' ? body.venuePlaceId.trim() : '';
      const typedAddress = typeof body.venueAddress === 'string' ? body.venueAddress.trim() : '';
      const verification = placeId
        ? await verifyVenuePlace(placeId, apiKey)
        : await searchVenueAddress(typedAddress, apiKey);

      if (
        verification.status === 'not-found'
        || (verification.status === 'resolved' && !hasStreetAddress(verification.addressComponents))
      ) {
        return res.status(400).json({ message: UNVERIFIED_ADDRESS_MESSAGE });
      }
      venue = verification;

      // Check 7: Message wording — two or more distinct sales-pitch entries drops silently.
      if (isSalesPitchMessage(extractMessage(body))) {
        return res.status(200).json({ message: 'email sent' });
      }
    }

    // Check 8: Send.
    const { to, cc } = recipientForArtist(artist);
    const sender = senderForArtist(artist);
    const replyTo = extractCustomerEmail(body) || undefined;
    const { subject, html, text } = formatInquiryEmail(body, req.headers?.origin, venue);
    return this.sendEmail(html, to, subject, res, cc, text, sender, replyTo);
  }
}
export default InquiryController;
