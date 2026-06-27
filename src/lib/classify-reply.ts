import Anthropic from '@anthropic-ai/sdk';
import Debug from 'debug';

// AI reply-classification (gig-outreach #825 Half B). Claude Haiku reads a venue's
// reply to our gig pitch and SUGGESTS a venue update — sentiment + a proposed
// bookingStatus/interested change. The suggestion is advisory only: it's surfaced
// in the AdminVenues review queue and never written to a venue until Josh approves
// (the mis-send-incident guardrail — AI never auto-writes booking data). Haiku is
// the cheapest capable model and this is a short, bounded classification.
const debug = Debug('web-jam-back:classify-reply');

const MODEL = 'claude-haiku-4-5';
const SENTIMENTS = ['positive', 'negative', 'needs-info'] as const;
const BOOKING_STATUSES = ['booking', 'not-booking', 'booked'] as const;

export interface ReplySuggestion {
  sentiment?: string;
  proposedBookingStatus?: string;
  proposedInterested?: boolean;
  rationale?: string;
  model?: string;
}

// The classification prompt. Kept pure + exported so the wording is unit-tested.
export function buildPrompt(replyText: string, venueName: string): string {
  return [
    `A music venue ("${venueName || 'the venue'}") replied to a booking pitch from the acoustic duo Josh & Maria.`,
    'Read the reply and classify it. Respond with ONLY a JSON object, no prose, with these keys:',
    '- "sentiment": one of "positive" (interested/booking), "negative" (declined/not a fit), '
      + '"needs-info" (asking questions / not yet decided)',
    '- "proposedBookingStatus": one of "booking" (still an open prospect), "booked" (confirmed a gig), '
      + '"not-booking" (ruled out) — or omit if unclear',
    '- "proposedInterested": true or false — or omit if unclear',
    '- "rationale": one short sentence citing the reply',
    '',
    'Reply:',
    '"""',
    (replyText || '').slice(0, 4000),
    '"""',
  ].join('\n');
}

// Parse the model's text into a validated suggestion, or null if it's unusable.
// Defensive: pulls the first JSON object out of the text and drops any field that
// isn't a recognized enum value, so a malformed/hallucinated response can't write
// junk into the queue.
export function parseSuggestion(raw: string): ReplySuggestion | null {
  const text = raw || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { return null; }
  const out: ReplySuggestion = {};
  if (typeof obj.sentiment === 'string' && SENTIMENTS.indexOf(obj.sentiment as typeof SENTIMENTS[number]) !== -1) {
    out.sentiment = obj.sentiment;
  }
  if (typeof obj.proposedBookingStatus === 'string'
    && BOOKING_STATUSES.indexOf(obj.proposedBookingStatus as typeof BOOKING_STATUSES[number]) !== -1) {
    out.proposedBookingStatus = obj.proposedBookingStatus;
  }
  if (typeof obj.proposedInterested === 'boolean') out.proposedInterested = obj.proposedInterested;
  if (typeof obj.rationale === 'string') out.rationale = obj.rationale.trim();
  // Nothing recognized → not worth surfacing.
  if (out.sentiment === undefined && out.proposedBookingStatus === undefined && out.proposedInterested === undefined) {
    return null;
  }
  return out;
}

// Classify a reply via Haiku. No-ops (returns null) under test or when
// ANTHROPIC_API_KEY isn't set, so the feature is dormant until provisioned and CI
// never hits the API. The network call is excluded from coverage; buildPrompt +
// parseSuggestion carry the tested logic.
/* istanbul ignore next */
export async function classifyReply(replyText: string, venueName: string): Promise<ReplySuggestion | null> {
  if (process.env.NODE_ENV === 'test' || !process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: buildPrompt(replyText, venueName) }],
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const parsed = parseSuggestion(text);
    return parsed ? { ...parsed, model: MODEL } : null;
  } catch (e) {
    debug('haiku classify failed: %s', (e as Error).message);
    return null;
  }
}

export default { buildPrompt, parseSuggestion, classifyReply };
