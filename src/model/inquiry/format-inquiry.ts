// Turns a raw /inquiry POST body into a readable email (web-jam-back#916).
//
// Two live front-ends feed this one endpoint with different field names —
// JaMmusic's original contact form (firstname/lastname/emailaddress/
// phonenumber/comments/country/uSAstate/zipcode) and TimShermanMusic's newer
// booking form (name/email/phone/eventDate/message, #885's artist:'tim').
// Both spellings are recognized here so neither route regresses; any field
// that's missing is simply omitted rather than producing an empty/undefined
// line.
//
// The HTML and plaintext parts are built independently from the same field
// list rather than deriving one from the other, so the plaintext part is
// entity-free by construction (same lesson as #909's mailer.ts fix, but this
// controller has its own transporter and doesn't go through mailer.ts).

export type InquiryBody = Record<string, unknown>;

export interface FormattedInquiry {
  subject: string;
  html: string;
  text: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayName(body: InquiryBody): string {
  const name = str(body.name);
  if (name) return name;
  return [str(body.firstname), str(body.lastname)].filter(Boolean).join(' ');
}

function escapeHtml(text: string): string {
  return text
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

// Order fields should appear in the email body.
function buildFields(body: InquiryBody): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  const name = displayName(body);
  if (name) fields.push(['Name', name]);
  const email = str(body.email) || str(body.emailaddress);
  if (email) fields.push(['Email', email]);
  const phone = str(body.phone) || str(body.phonenumber);
  if (phone) fields.push(['Phone', phone]);
  const eventDate = str(body.eventDate);
  if (eventDate) fields.push(['Event Date', eventDate]);
  const country = str(body.country);
  if (country) fields.push(['Country', country]);
  const state = str(body.uSAstate);
  if (state) fields.push(['State', state]);
  const zip = str(body.zipcode);
  if (zip) fields.push(['Zip Code', zip]);
  const message = str(body.message) || str(body.comments);
  if (message) fields.push(['Message', message]);
  return fields;
}

function fieldHtml([label, value]: [string, string]): string {
  const safeValue = escapeHtml(value).split('\n').join('<br>');
  return `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;vertical-align:top;">${escapeHtml(label)}</td>`
    + `<td style="padding:4px 0;">${safeValue}</td></tr>`;
}

export function formatInquiryEmail(body: InquiryBody): FormattedInquiry {
  const fields = buildFields(body);
  const name = displayName(body);
  const subject = name ? `New booking inquiry from ${name}` : 'New booking inquiry';

  const html = fields.length
    ? `<table cellpadding="0" cellspacing="0">${fields.map(fieldHtml).join('')}</table>`
    : '<p>No inquiry details were provided.</p>';

  const text = fields.length
    ? fields.map(([label, value]) => `${label}: ${value}`).join('\n')
    : 'No inquiry details were provided.';

  return { subject, html, text };
}

export default { formatInquiryEmail };
