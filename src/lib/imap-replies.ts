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
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OutreachRef { outreachId: string; messageId: string; sentAt?: Date }
export interface ReplyMatch {
  outreachId: string;
  fromAddress: string;
  repliedAt: Date;
  snippet: string;
  gmailThreadId?: string;
}

// Minimal interface covering the ImapFlow methods findReplies actually uses.
// Allows injection of a fake client in tests without pulling in the real network.
export interface ImapClientLike {
  connect(): Promise<unknown>;
  getMailboxLock(mailbox: string): Promise<{ release: () => void }>;
  search(query: unknown, opts: { uid: boolean }): Promise<number[] | false>;
  fetchOne(uid: string, query: unknown, opts: { uid: boolean }): Promise<{
    envelope?: { messageId?: string; from?: { address?: string }[]; date?: Date };
    source?: Buffer | string; threadId?: string | number;
  } | false>;
  logout(): Promise<unknown>;
  close(): void | Promise<unknown>;
}

// IMAP HEADER search does a substring match, so strip the angle brackets the
// Message-ID is stored/sent with (`<abc@mail>` → `abc@mail`) for a clean match.
export function bareMessageId(messageId: string): string {
  return (messageId || '').replace(/^<|>$/g, '').trim();
}

// The IMAP search is bounded with a SINCE date so Gmail only scans recent mail
// (a reply can only post-date its pitch) instead of all-time over All Mail.
// Use the earliest pitch date minus a 1-day buffer, or 90 days back if unknown.
export function earliestSince(refs: OutreachRef[]): Date {
  const times = refs.map((r) => r.sentAt).filter(Boolean).map((d) => new Date(d as Date).getTime());
  if (times.length === 0) return new Date(Date.now() - 90 * DAY_MS);
  return new Date(Math.min(...times) - DAY_MS);
}

// ONE search covering replies to ANY of our pitches: SINCE date AND
// (references/in-reply-to contains id1 OR id2 OR …). A single server-side search
// instead of one per pitch — this is what keeps the scan fast as the active set
// grows. Null when there are no ids to search for.
export function buildBatchSearch(bareIds: string[], since: Date): Record<string, unknown> | null {
  const ids = bareIds.filter(Boolean);
  if (ids.length === 0) return null;
  const or: Record<string, unknown>[] = [];
  for (const id of ids) {
    or.push({ header: { references: id } });
    or.push({ header: { 'in-reply-to': id } });
  }
  return { since, or };
}

// Pull a header value out of a raw RFC822 message (header block = everything
// before the first blank line), case-insensitive, unfolding continuation lines.
export function extractHeader(rawSource: string, name: string): string {
  const headerBlock = (rawSource || '').split(/\r?\n\r?\n/)[0] || '';
  const lower = name.toLowerCase();
  const parts: string[] = [];
  let capturing = false;
  for (const line of headerBlock.split(/\r?\n/)) {
    if (capturing) {
      if (/^\s/.test(line)) { parts.push(line.trim()); continue; }
      break;
    }
    const idx = line.indexOf(':');
    if (idx > 0 && line.slice(0, idx).toLowerCase() === lower) {
      parts.push(line.slice(idx + 1).trim());
      capturing = true;
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Which of our pitches does this message reply to? The reply's References /
// In-Reply-To headers carry the original pitch's Message-ID. Returns the matched
// bare id (caller maps it to an outreach record), or null if it references none.
export function referencedPitchId(rawSource: string, bareIds: string[]): string | null {
  const refs = `${extractHeader(rawSource, 'references')} ${extractHeader(rawSource, 'in-reply-to')}`;
  return bareIds.find((id) => id && refs.indexOf(id) !== -1) || null;
}

// Guard against matching our OWN mail rather than a venue reply. Every pitch CCs
// Josh, so a copy lands in the IMAP mailbox; that copy's Message-ID IS one of our
// pitch ids, and it's From our sending address. Either signal means "not a reply".
export function isSelfOrPitch(
  messageId: string | undefined,
  fromAddress: string,
  selfAddress: string,
  bareIds: string[],
): boolean {
  const bare = bareMessageId(messageId || '');
  if (bare && bareIds.indexOf(bare) !== -1) return true;
  if (fromAddress && selfAddress && fromAddress.toLowerCase() === selfAddress.toLowerCase()) return true;
  return false;
}

// True if a message is an automated bounce / auto-reply rather than a human venue
// reply — these legitimately reference our pitch but must NOT count as replies.
export function isAutoOrBounce(fromAddress: string, rawSource: string): boolean {
  const from = (fromAddress || '').toLowerCase();
  if (from.includes('mailer-daemon@') || from.includes('postmaster@')) return true;
  const localPart = from.split('@')[0];
  if (localPart.startsWith('no-reply') || localPart.startsWith('noreply')) return true;
  const autoSubmitted = extractHeader(rawSource, 'auto-submitted').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (extractHeader(rawSource, 'content-type').toLowerCase().includes('multipart/report')) return true;
  return false;
}

// The message body = everything after the first blank line (drop the RFC822
// header block, which would otherwise be classified as the "reply" text).
export function bodyFromSource(rawSource: string): string {
  const parts = (rawSource || '').split(/\r?\n\r?\n/);
  return parts.length > 1 ? parts.slice(1).join('\n\n') : (rawSource || '');
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

// Hard ceiling for the whole IMAP scan, comfortably under Heroku's 30s router
// limit. If Gmail is slow, we return whatever matched so far rather than let the
// request time out (H12) — the next tick re-scans the rest.
const SCAN_DEADLINE_MS = 25000;

// Connect to Gmail over IMAP and return one ReplyMatch per outreach record that
// has a GENUINE venue reply. One bounded batched search finds candidate replies
// to any pitch; each candidate is then verified — not our own pitch/CC copy
// (isSelfOrPitch), not a bounce/auto-reply (isAutoOrBounce), and actually
// referencing one of our pitches (referencedPitchId) — before its body snippet
// is taken. The whole scan is raced against a 25s deadline. Returns [] / partial
// (never throws) when disabled, on a connection failure, or on the deadline.
// An optional makeClient factory injects a fake IMAP client in tests; when
// present the imapEnabled() env gate is skipped so tests never hit Gmail.
export async function findReplies(refs: OutreachRef[], makeClient?: () => ImapClientLike): Promise<ReplyMatch[]> {
  const injected = makeClient !== undefined;
  if ((!injected && !imapEnabled()) || refs.length === 0) return [];
  const idToOutreach = new Map<string, string>();
  for (const r of refs) { const b = bareMessageId(r.messageId); if (b) idToOutreach.set(b, r.outreachId); }
  const bareIds = [...idToOutreach.keys()];
  const search = buildBatchSearch(bareIds, earliestSince(refs));
  if (!search) return [];
  const selfAddress = (process.env.GMAIL_IMAP_USER || '').toLowerCase();
  const client = makeClient ? makeClient() : (new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_IMAP_USER || '', pass: process.env.GMAIL_IMAP_APP_PASSWORD || '' },
    logger: false,
  }) as unknown as ImapClientLike);
  // Keyed by outreachId so a venue that replied more than once collapses to its
  // latest reply (UIDs ascend, so a later one overwrites).
  const byOutreach = new Map<string, ReplyMatch>();

  const scan = async (): Promise<void> => {
    await client.connect();
    const lock = await client.getMailboxLock(MAILBOX);
    try {
      const uids = await client.search(search, { uid: true });
      for (const uid of uids || []) {
        // eslint-disable-next-line no-await-in-loop
        const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const raw = msg.source.toString();
        const from = msg.envelope?.from?.[0]?.address || '';
        if (isSelfOrPitch(msg.envelope?.messageId, from, selfAddress, bareIds)) continue;
        if (isAutoOrBounce(from, raw)) continue;
        const pitchId = referencedPitchId(raw, bareIds);
        const outreachId = pitchId ? idToOutreach.get(pitchId) : undefined;
        if (!outreachId) continue;
        byOutreach.set(outreachId, {
          outreachId,
          fromAddress: from,
          repliedAt: msg.envelope?.date || new Date(),
          snippet: snippetFromBody(bodyFromSource(raw)),
          gmailThreadId: msg.threadId ? String(msg.threadId) : undefined,
        });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  };

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`imap scan exceeded ${SCAN_DEADLINE_MS}ms`)), SCAN_DEADLINE_MS);
  });
  try {
    await Promise.race([scan(), deadline]);
  } catch (e) {
    debug('imap reply check stopped: %s', (e as Error).message);
    try { await client.close(); } catch { /* already closing */ }
  } finally {
    if (timer) clearTimeout(timer);
  }
  return [...byOutreach.values()];
}

export default {
  bareMessageId, earliestSince, buildBatchSearch, extractHeader, referencedPitchId,
  isSelfOrPitch, isAutoOrBounce, bodyFromSource, snippetFromBody, imapEnabled, findReplies,
};
