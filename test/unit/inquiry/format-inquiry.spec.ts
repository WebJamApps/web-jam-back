import { extractCustomerEmail, formatInquiryEmail } from '#src/model/inquiry/format-inquiry.js';

describe('formatInquiryEmail', () => {
  it('renders only the looked-up address when a picked place also carries customer text', () => {
    const { html, text } = formatInquiryEmail({ venuePlaceId: 'place-id', venueAddress: 'Untrusted address' }, undefined, {
      status: 'resolved', formattedAddress: '123 Main & Oak <venue>', addressComponents: [],
    });
    expect(text).toBe('Venue Address: 123 Main & Oak <venue>');
    expect(html).toContain('>Venue Address</td>');
    expect(html).toContain('123 Main &amp; Oak &lt;venue&gt;');
    expect(html).not.toContain('Untrusted address');
  });

  it.each([undefined, { status: 'unavailable' } as const])('labels an unavailable picked place (%j)', (venue) => {
    const { html, text } = formatInquiryEmail({ venuePlaceId: 'place-id', venueAddress: 'Untrusted address' }, undefined, venue);
    expect(text).toBe('Venue address: not verified (lookup unavailable)');
    expect(html).toContain('>Venue address</td>');
    expect(html).toContain('>not verified (lookup unavailable)</td>');
    expect(text).not.toContain('Untrusted address');
  });

  it('trims typed addresses and ignores blank or non-string place IDs', () => {
    for (const venuePlaceId of ['  ', 123, null]) {
      const { html, text } = formatInquiryEmail({ venuePlaceId, venueAddress: ' 123 Main St ' });
      expect(text).toBe('Venue Address (typed by customer): 123 Main St');
      expect(html).toContain('>Venue Address (typed by customer)</td>');
    }
  });

  it.each([
    ['webjam-homepage', 'Web Jam homepage form'],
    ['jam-bookus', 'Book Us form'],
    ['tim-booking', 'Tim Sherman booking form'],
  ])('labels %s in the subject and the first body row', (form, label) => {
    const { subject, html, text } = formatInquiryEmail({
      form, firstname: 'Jane', lastname: 'Smith',
    }, 'https://web-jam.com');

    expect(subject).toBe(`New inquiry from Jane Smith — ${label}`);
    expect(text).toBe(`Form: ${label}\nSite: https://web-jam.com\nName: Jane Smith`);
    const rows = html.match(/<tr>.*?<\/tr>/g);
    expect(rows).toHaveLength(3);
    expect(rows?.[0]).toContain(`>${label}</td>`);
    expect(rows?.[1]).toContain('>https://web-jam.com</td>');
  });

  it('includes optional booking fields in both email parts without enforcing their values', () => {
    const { html, text } = formatInquiryEmail({
      form: 'jam-bookus', name: 'Jane', eventDate: '2026-12-20',
      eventType: 'private-party', venueAddress: '123 Main St, Salem, VA',
    });
    expect(text).toBe([
      'Form: Book Us form', 'Name: Jane', 'Event Date: 2026-12-20',
      'Event Type: private-party', 'Venue Address (typed by customer): 123 Main St, Salem, VA',
    ].join('\n'));
    expect(html).toContain('2026-12-20');
    expect(html).toContain('private-party');
    expect(html).toContain('123 Main St, Salem, VA');
    expect(text).not.toContain('verified');
  });

  it.each([undefined, 'unknown', '__proto__', { value: 'jam-bookus' }])(
    'keeps legacy delivery formatting for an absent or unknown form (%s)', (form) => {
      const { subject, text } = formatInquiryEmail({ form, name: 'Jane' });
      expect(subject).toBe('New booking inquiry from Jane');
      expect(text).toBe('Name: Jane');
    },
  );

  it('handles a known form without a name or Origin', () => {
    const { subject, text } = formatInquiryEmail({ form: 'tim-booking' });
    expect(subject).toBe('New inquiry — Tim Sherman booking form');
    expect(text).toBe('Form: Tim Sherman booking form');
  });

  it('omits blank or non-string booking fields', () => {
    const { text } = formatInquiryEmail({ eventDate: 123, eventType: '  ', venueAddress: {} });
    expect(text).toBe('No inquiry details were provided.');
  });

  it('escapes new rows in HTML while retaining their plaintext values', () => {
    const { html, text } = formatInquiryEmail({
      eventType: '<party>', venueAddress: '123 Main & Oak\n<script>alert(1)</script>',
    }, 'https://example.com/<site>');
    expect(html).toContain('https://example.com/&lt;site&gt;');
    expect(html).toContain('&lt;party&gt;');
    expect(html).toContain('123 Main &amp; Oak<br>&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(text).toContain('Site: https://example.com/<site>');
    expect(text).toContain('Event Type: <party>');
    expect(text).toContain('Venue Address (typed by customer): 123 Main & Oak\n<script>alert(1)</script>');
  });

  it('formats a TimShermanMusic booking submission (name/email/phone/eventDate/message)', () => {
    const { subject, html, text } = formatInquiryEmail({
      artist: 'tim',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '555-123-4567',
      eventDate: '2026-08-15',
      message: 'Looking to book a 3-hour set for a wedding.',
    });

    expect(subject).toBe('New booking inquiry from John Doe');
    expect(html).toContain('John Doe');
    expect(html).toContain('john@example.com');
    expect(html).toContain('555-123-4567');
    expect(html).toContain('2026-08-15');
    expect(html).toContain('Looking to book a 3-hour set for a wedding.');
    expect(html).toContain('<table');

    expect(text).toBe([
      'Name: John Doe',
      'Email: john@example.com',
      'Phone: 555-123-4567',
      'Event Date: 2026-08-15',
      'Message: Looking to book a 3-hour set for a wedding.',
    ].join('\n'));
  });

  it('formats a JaMmusic contact submission (firstname/lastname/emailaddress/phonenumber/comments + location)', () => {
    const { subject, html, text } = formatInquiryEmail({
      firstname: 'Jane',
      lastname: 'Smith',
      emailaddress: 'jane@example.com',
      phonenumber: '555-987-6543',
      country: 'United States',
      uSAstate: 'Oregon',
      zipcode: '97201',
      comments: 'Interested in a private party booking.',
    });

    expect(subject).toBe('New booking inquiry from Jane Smith');
    expect(text).toBe([
      'Name: Jane Smith',
      'Email: jane@example.com',
      'Phone: 555-987-6543',
      'Country: United States',
      'State: Oregon',
      'Zip Code: 97201',
      'Message: Interested in a private party booking.',
    ].join('\n'));
    expect(html).toContain('Jane Smith');
    expect(html).toContain('Oregon');
  });

  it('handles missing/optional fields gracefully — only present fields are listed', () => {
    const { subject, html, text } = formatInquiryEmail({ email: 'onlyemail@example.com' });

    expect(subject).toBe('New booking inquiry');
    expect(text).toBe('Email: onlyemail@example.com');
    expect(html).not.toContain('Name');
    expect(html).not.toContain('Phone');
    expect(html).not.toContain('Message');
  });

  it('handles a completely empty body without throwing', () => {
    const { subject, html, text } = formatInquiryEmail({});

    expect(subject).toBe('New booking inquiry');
    expect(text).toBe('No inquiry details were provided.');
    expect(html).toContain('No inquiry details were provided.');
  });

  it('escapes HTML-significant characters in the html part but keeps the text part entity-free', () => {
    const { html, text } = formatInquiryEmail({
      name: 'Tom & Jerry <band>',
      email: 'tom@example.com',
      message: "It's a \"great\" show\nSecond line",
    });

    // html part must escape the dangerous characters
    expect(html).toContain('Tom &amp; Jerry &lt;band&gt;');
    expect(html).toContain('It&#39;s a &quot;great&quot; show<br>Second line');
    expect(html).not.toContain('<band>');

    // text part must read naturally and contain zero HTML entities
    expect(text).toContain("Tom & Jerry <band>");
    expect(text).toContain('It\'s a "great" show\nSecond line');
    expect(text).not.toMatch(/&[a-z#0-9]+;/i);
  });

  it('prefers name over firstname/lastname when both are present', () => {
    const { text } = formatInquiryEmail({ name: 'Preferred Name', firstname: 'Ignored', lastname: 'Also Ignored' });
    expect(text).toBe('Name: Preferred Name');
  });

  it('ignores non-string values for a field instead of rendering them', () => {
    const { text } = formatInquiryEmail({ name: 12345, email: null, phone: undefined });
    expect(text).toBe('No inquiry details were provided.');
  });
});

describe('extractCustomerEmail', () => {
  it('extracts email from email field', () => {
    expect(extractCustomerEmail({ email: '  john@example.com  ' })).toBe('john@example.com');
  });

  it('extracts email from emailaddress field when email is absent', () => {
    expect(extractCustomerEmail({ emailaddress: '  jane@example.com  ' })).toBe('jane@example.com');
  });

  it('prefers email over emailaddress when both are present', () => {
    expect(extractCustomerEmail({ email: 'first@example.com', emailaddress: 'second@example.com' })).toBe('first@example.com');
  });

  it('returns empty string when neither field is present or fields are empty/whitespace', () => {
    expect(extractCustomerEmail({})).toBe('');
    expect(extractCustomerEmail({ email: '   ', emailaddress: '   ' })).toBe('');
    expect(extractCustomerEmail(null)).toBe('');
    expect(extractCustomerEmail(undefined)).toBe('');
  });
});
