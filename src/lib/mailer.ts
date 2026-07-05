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

// Named entities the outreach templates/senders actually produce (outreach-
// controller's escapeHtml covers the same five characters, plus &nbsp; from
// pasted copy). Numeric entities (&#39;, &#8217;, &#x27; ...) are decoded
// generically below, not listed here.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X';
      const codePoint = parseInt(isHex ? code.slice(2) : code.slice(1), isHex ? 16 : 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    const key = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
  });
}

// Derive a readable text/plain alternative from a rendered HTML body. Used as
// the fallback whenever a caller doesn't supply its own `text` — without this,
// nodemailer would ship the raw HTML string (tags AND entities like &#39;) as
// the text/plain part, and Gmail's inbox list/preview — which reads text/plain,
// not text/html — showed raw markup and escaped entities instead of readable
// copy (e.g. "It&#39;s" instead of "It's", gig-outreach #909).
export function htmlToText(html: string): string {
  const withBreaks = html.replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, '\n');
  // `<[^>]+>` is linear (negated class, no nested quantifier) — safe from
  // catastrophic backtracking despite the generic slow-regex warning (same
  // false positive already noted at venue-controller.ts's stripHtml).
  // eslint-disable-next-line sonarjs/slow-regex
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  // Trailing-whitespace/blank-line cleanup below: both patterns are a single
  // bounded class, no nested quantifier — safe from catastrophic backtracking.
  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, '\n') // eslint-disable-line sonarjs/slow-regex
    .replace(/\n{3,}/g, '\n\n') // eslint-disable-line sonarjs/slow-regex
    .trim();
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
        text: input.text || htmlToText(input.html),
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

export default { sendMail, htmlToText };
