import { formatInquiryEmail } from '#src/model/inquiry/format-inquiry.js';

describe('formatInquiryEmail', () => {
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
