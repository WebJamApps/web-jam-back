import { ImapFlow } from 'imapflow';
import Debug from 'debug';

// Gmail reply-detection (gig-outreach #825 Half B). Finds venue replies to our
// pitches by matching the sent email's RFC Message-ID against the `In-Reply-To`
// / `References` headers of incoming mail — an unambiguous link to that exact
// pitch (no sender-guessing). Uses Gmail IMAP with an app password, deliberately
// NOT the Gmail API: `gmail.metadata`/`readonly` are Google *restricted* scopes
// that would force a CASA security assessment on the published OAuth app; IMAP +
// app password is a separate auth path that sidesteps scope verification.
const debug = Debug('web-jam-back:imap-replies');

const IMAP_HOST = 'imap.gmail.com';
// All Mail, so a reply that's been read/archived/deleted-from-inbox still matches.
const MAILBOX = '[Gmail]/All Mail';

export interface OutreachRef { outreachId: string; messageId: string }
export interface ReplyMatch {
  outreachId: string;
  fromAddress: string;
  repliedAt: Date;
  snippet: string;
  gmailThreadId?: string;
}

// IMAP HEADER search does a substring match, so strip the angle brackets the
// Message-ID is stored/sent with (`<abc@mail>` → `abc@mail`) for a clean match.
export function bareMessageId(messageId: string): string {
  return (messageId || '').replace(/^<|>$/g, '').trim();
}

// A reply carries the original Message-ID in References (preferred) or
// In-Reply-To. Match either header containing the bare id.
export function buildReplySearch(messageId: string): Record<string, unknown> {
  const id = bareMessageId(messageId);
  return { or: [{ header: { references: id } }, { header: { 'in-reply-to': id } }] };
}

// Reduce a reply body to a short, readable snippet for the review queue: drop the
// quoted original (everything from the first quote marker — a `>` line or an
// "On … wrote:" attribution), collapse whitespace, and cap the length.
export function snippetFromBody(body: string, max = 500): string {
  const text = (body || '').replace(/\r\n/g, '\n');
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .+ wrote:\s*$/.test(line)) break;
    lines.push(line);
  }
  const cleaned = lines.join(' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

// Should the IMAP job actually run? Off under test (never hit Gmail in CI) and
// when the app password isn't provisioned (the feature is dormant until Josh
// sets the env vars).
export function imapEnabled(): boolean {
  return process.env.NODE_ENV !== 'test'
    && !!process.env.GMAIL_IMAP_USER
    && !!process.env.GMAIL_IMAP_APP_PASSWORD;
}

// Connect to Gmail over IMAP and return one ReplyMatch per outreach record that
// has a genuine reply. Returns [] (never throws to the caller) when disabled or
// on a connection failure, so a bad credential degrades the cron tick to a no-op
// rather than crashing it. The connection/fetch I/O is excluded from coverage;
// the matching + snippet logic above is unit-tested.
/* istanbul ignore next */
export async function findReplies(refs: OutreachRef[]): Promise<ReplyMatch[]> {
  if (!imapEnabled() || refs.length === 0) return [];
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_IMAP_USER || '', pass: process.env.GMAIL_IMAP_APP_PASSWORD || '' },
    logger: false,
  });
  const matches: ReplyMatch[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock(MAILBOX);
    try {
      for (const ref of refs) {
        if (!ref.messageId) continue;
        // eslint-disable-next-line no-await-in-loop
        const uids = await client.search(buildReplySearch(ref.messageId), { uid: true });
        if (!uids || uids.length === 0) continue;
        // eslint-disable-next-line no-await-in-loop
        const msg = await client.fetchOne(String(uids[uids.length - 1]), { envelope: true, source: true }, { uid: true });
        if (!msg) continue;
        const from = msg.envelope?.from?.[0];
        const body = msg.source ? msg.source.toString() : '';
        matches.push({
          outreachId: ref.outreachId,
          fromAddress: from ? `${from.address}` : '',
          repliedAt: msg.envelope?.date || new Date(),
          snippet: snippetFromBody(body),
          gmailThreadId: msg.threadId ? String(msg.threadId) : undefined,
        });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    debug('imap reply check failed: %s', (e as Error).message);
  }
  return matches;
}

export default {
  bareMessageId, buildReplySearch, snippetFromBody, imapEnabled, findReplies,
};
