import { htmlToText, sendMail } from '#src/lib/mailer.js';

const createTransport = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({ default: { createTransport } }));

// #909 — Gmail's inbox LIST/preview reads the text/plain part of a message,
// not text/html. mailer.sendMail falls back to htmlToText(html) whenever a
// caller (outreach-controller's buildPitchEmail/buildFollowUpEmail) sends only
// an `html` body — so that fallback must strip tags AND decode entities, not
// just reuse the raw HTML string.
describe('mailer.ts — htmlToText', () => {
  it('decodes an apostrophe entity produced by an assembled outreach email, not the raw entity', () => {
    // Mirrors outreach-controller's renderCustomHtml/escapeHtml output for a
    // customIntro of "It's wonderful to e-meet you!" wrapped into a <p>, plus
    // a template bodyHtml paragraph — i.e. a realistic buildPitchEmail html.
    const html = [
      "<p>Hi there,</p>\n<p>It&#39;s wonderful to e-meet you!</p>",
      '<p>Josh &amp; Maria play acoustic sets &mdash; here&#8217;s our clip: '
        + '<a href="https://example.com">link</a></p>',
    ].join('\n');

    const text = htmlToText(html);

    expect(text).toContain("It's wonderful to e-meet you!");
    expect(text).not.toContain('&#39;');
    expect(text).toContain('Josh & Maria');
    expect(text).not.toContain('&amp;');
    expect(text).toContain('here’s');
    expect(text).not.toContain('&#8217;');
    expect(text.includes('<') || text.includes('>')).toBe(false);
  });

  it('decodes the other four HTML-significant entities outreach-controller escapes', () => {
    const html = '<p>&lt;script&gt; &amp; &quot;quoted&quot; &amp; it&#39;s fine</p>';
    const text = htmlToText(html);
    expect(text).toBe('<script> & "quoted" & it\'s fine');
  });

  it('turns <br> and block-closing tags into newlines instead of running text together', () => {
    const html = '<p>Line one<br>Line two</p><p>Second paragraph</p>';
    const text = htmlToText(html);
    expect(text).toBe('Line one\nLine two\nSecond paragraph');
  });

  it('leaves plain text with no markup or entities untouched (aside from trimming)', () => {
    expect(htmlToText('  Hello there  ')).toBe('Hello there');
  });
});

describe('mailer.ts — sendMail', () => {
  it('no-ops under NODE_ENV=test and returns a stub message id', async () => {
    const result = await sendMail({ to: 'venue@example.com', subject: 'Hi', html: '<p>It&#39;s us</p>' });
    expect(result).toEqual({ messageId: 'test-message-id' });
  });
});

describe('mailer.ts — getTransporter', () => {
  // The transport is a module-level singleton, so each test loads a fresh copy of the module.
  async function freshGetTransporter() {
    vi.resetModules();
    const mod = await import('#src/lib/mailer.js');
    return mod.getTransporter;
  }

  it('creates the transport with pooling on and the existing gmail options', async () => {
    createTransport.mockReturnValue({ sendMail: vi.fn() });
    const getTransporter = await freshGetTransporter();
    getTransporter();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      pool: true, maxConnections: 3, maxMessages: 50, service: 'gmail', secure: true,
    }));
  });

  it('builds the transport once and returns the same object afterwards', async () => {
    createTransport.mockReturnValue({ sendMail: vi.fn() });
    const getTransporter = await freshGetTransporter();
    const first = getTransporter();
    const second = getTransporter();
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('sendMail under NODE_ENV=test returns the stub id and never creates a transport', async () => {
    vi.resetModules();
    const mod = await import('#src/lib/mailer.js');
    const result = await mod.sendMail({ to: 'venue@example.com', subject: 'Hi', html: '<p>x</p>' });
    expect(result).toEqual({ messageId: 'test-message-id' });
    expect(createTransport).not.toHaveBeenCalled();
  });
});
