export type KnownInquiryForm = 'webjam-homepage' | 'jam-bookus' | 'tim-booking';

export const KNOWN_FORMS: ReadonlySet<string> = new Set<KnownInquiryForm>([
  'webjam-homepage',
  'jam-bookus',
  'tim-booking',
]);

export const BOOKING_FORMS: ReadonlySet<string> = new Set<KnownInquiryForm>([
  'jam-bookus',
  'tim-booking',
]);

export const VALID_EVENT_TYPES: ReadonlySet<string> = new Set([
  'brewery-winery',
  'restaurant-bar',
  'wedding',
  'private-party',
  'festival-fair',
  'church',
  'corporate',
  'other',
]);

export const UNVERIFIED_ADDRESS_MESSAGE =
  "We couldn't verify that address — please check the street address, or choose it from the suggestions.";

export const MIN_FORM_FILL_MS = 3000;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseKnownForm(form: unknown): KnownInquiryForm | null {
  const normalized = str(form);
  return KNOWN_FORMS.has(normalized) ? (normalized as KnownInquiryForm) : null;
}

export function isBookingForm(form: KnownInquiryForm): boolean {
  return BOOKING_FORMS.has(form);
}

export function hasTrapValue(website: unknown): boolean {
  if (typeof website === 'string') return website.length > 0;
  return website !== undefined && website !== null;
}

export function hasValidFormLoadTime(raw: unknown, nowMs = Date.now()): boolean {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return false;
  if (raw > nowMs) return false;
  return nowMs - raw >= MIN_FORM_FILL_MS;
}

export function isValidEventDate(value: unknown, now = new Date()): boolean {
  const dateStr = str(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateStr) return false;

  const nyToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  const localToday = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const minToday = nyToday.localeCompare(localToday) <= 0 ? nyToday : localToday;
  return dateStr >= minToday;
}

export function extractName(body: Record<string, unknown>): string {
  const name = str(body.name);
  if (name) return name;
  return [str(body.firstname), str(body.lastname)].filter(Boolean).join(' ');
}

export function extractPhone(body: Record<string, unknown>): string {
  return str(body.phone) || str(body.phonenumber);
}

export function extractMessage(body: Record<string, unknown>): string {
  return str(body.message) || str(body.comments);
}

export function validateBookingFields(body: Record<string, unknown>, now = new Date()): string | null {
  if (!extractName(body)) return 'Missing required field: name';
  if (!(str(body.email) || str(body.emailaddress))) return 'Missing required field: email';
  if (!extractPhone(body)) return 'Missing required field: phone';
  if (!extractMessage(body)) return 'Missing required field: message';
  if (!isValidEventDate(body.eventDate, now)) return 'Missing or invalid required field: eventDate';
  if (!VALID_EVENT_TYPES.has(str(body.eventType))) return 'Missing or invalid required field: eventType';
  if (!(str(body.venuePlaceId) || str(body.venueAddress))) {
    return 'Missing required field: venue (venuePlaceId or venueAddress)';
  }
  return null;
}
