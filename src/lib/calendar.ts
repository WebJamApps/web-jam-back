import Debug from 'debug';

// Server-side Google Calendar integration (gig-outreach #825). Lets the cadence
// engine drop a "call task" onto Josh's calendar when a CALL touch comes due — a
// phone call can't be auto-dialed like an email, so it lands as a dated, all-day
// task carrying the phone script. Uses a long-lived OAuth refresh token (Calendar-
// write scope only) Josh provisioned once and set on Heroku as the env vars
// below; mirrors auth/google.ts's plain-fetch style (no googleapis SDK).
const debug = Debug('web-jam-back:calendar');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// 'primary' = the authorising account's main calendar (Josh's).
const CALENDAR_ID = 'primary';
const eventsUrl = (calId: string): string => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CallTaskInput {
  date: Date; // the day the all-day task lands on
  title: string; // event summary, e.g. "Call The Bridge re: August"
  scriptBody: string; // the phone script — stored as the event description
}
export interface CalendarEventResult { id: string; htmlLink?: string }

interface TokenResponse { access_token?: string }

// Exchange the stored refresh token for a short-lived access token. The refresh
// token never expires (the OAuth app is published, not in testing), so this is
// the only network step needed before every calendar write.
async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: params,
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status} ${res.statusText}`);
  const body = await res.json() as TokenResponse;
  if (!body || !body.access_token) throw new Error('google token exchange returned no access_token');
  return body.access_token;
}

// YYYY-MM-DD (UTC) for an all-day Calendar event. All-day events take a bare
// `date` (no time/zone), so a call task is a whole-day to-do rather than a timed
// meeting — and there's no timezone math to get wrong (tests pin TZ=UTC).
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

// Create an all-day call-task event on Josh's primary calendar, with the phone
// script as the event description. Returns the created event's id + link. Throws
// on any failure so the caller (cadence processDue) can swallow it into a
// 'skipped' outcome rather than crash the cron tick.
export async function createCallTaskEvent(input: CallTaskInput): Promise<CalendarEventResult> {
  const accessToken = await getAccessToken();
  // All-day events are half-open: `end.date` is exclusive, so it's the next day.
  const event = {
    summary: input.title,
    description: input.scriptBody,
    start: { date: ymd(input.date) },
    end: { date: ymd(new Date(input.date.getTime() + DAY_MS)) },
    reminders: { useDefault: true },
  };
  const res = await fetch(eventsUrl(CALENDAR_ID), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`google calendar insert failed: ${res.status} ${res.statusText}`);
  const body = await res.json() as { id?: string; htmlLink?: string };
  if (!body || !body.id) throw new Error('google calendar insert returned no event id');
  debug('created call-task event %s', body.id);
  return { id: body.id, htmlLink: body.htmlLink };
}

export default { createCallTaskEvent };
