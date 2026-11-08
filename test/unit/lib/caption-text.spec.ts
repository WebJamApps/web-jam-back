// Unit tests for the gig-announce caption HTML->text converter (#962).
import { htmlCaptionToText } from '#src/lib/caption-text.js';

describe('htmlCaptionToText (#962)', () => {
  it('handles empty/missing input', () => {
    expect(htmlCaptionToText('')).toBe('');
    expect(htmlCaptionToText(undefined as unknown as string)).toBe('');
  });

  it('keeps paragraph breaks between <p> blocks', () => {
    const html = '<p>First line.</p><p>Second line.</p>';
    expect(htmlCaptionToText(html)).toBe('First line.\n\nSecond line.');
  });

  it('turns <br> into a single newline within a paragraph', () => {
    const html = '<p>Line one<br>Line two</p>';
    expect(htmlCaptionToText(html)).toBe('Line one\nLine two');
  });

  it('flattens a link down to its raw href, discarding the link text', () => {
    const html = '<p>Tickets at <a href="https://example.com/tix" target="_blank" rel="noopener">this link</a>!</p>';
    expect(htmlCaptionToText(html)).toBe('Tickets at https://example.com/tix!');
  });

  it('drops inline styling tags without losing the text', () => {
    const html = '<p><strong>Bold</strong> and <em>italic</em> and <span style="color:red">colored</span> text.</p>';
    expect(htmlCaptionToText(html)).toBe('Bold and italic and colored text.');
  });

  it('decodes HTML entities (&amp;, numeric, hex)', () => {
    const html = "<p>Josh &amp; Maria play at Tom&#39;s Bar &#x2014; come on out!</p>";
    expect(htmlCaptionToText(html)).toBe("Josh & Maria play at Tom's Bar — come on out!");
  });

  it('collapses 3+ consecutive breaks down to one paragraph break', () => {
    const html = '<p>First</p><br><br><p>Second</p>';
    expect(htmlCaptionToText(html)).toBe('First\n\nSecond');
  });

  it('handles a list, treating each <li> as its own line', () => {
    const html = '<ul><li>One</li><li>Two</li></ul>';
    expect(htmlCaptionToText(html)).toBe('One\n\nTwo');
  });

  it('trims leading/trailing whitespace from the final result', () => {
    const html = '  <p>  Padded  </p>  ';
    expect(htmlCaptionToText(html)).toBe('Padded');
  });

  describe('HTML entity decoding (#1236)', () => {
    it('decodes from 7&ndash;9 PM to from 7–9 PM', () => {
      expect(htmlCaptionToText('<p>from 7&ndash;9 PM</p>')).toBe('from 7–9 PM');
    });

    it('decodes &rsquo;, &eacute;, &mdash;, and &hellip; to their characters', () => {
      expect(htmlCaptionToText('<p>&rsquo; &eacute; &mdash; &hellip;</p>')).toBe('’ é — …');
    });

    it('decodes &#x2013; and &#8211; to –', () => {
      expect(htmlCaptionToText('<p>&#x2013; and &#8211;</p>')).toBe('– and –');
    });

    it('turns &nbsp; and a U+00A0 character into a plain space', () => {
      expect(htmlCaptionToText('<p>A&nbsp;B</p>')).toBe('A B');
      expect(htmlCaptionToText('<p>A\u{A0}B</p>')).toBe('A B');
    });

    it('decodes &amp;lt; to &lt; once without double-decoding', () => {
      expect(htmlCaptionToText('<p>&amp;lt;</p>')).toBe('&lt;');
    });

    it('decodes numeric-encoded ampersands once without double-decoding', () => {
      expect(htmlCaptionToText('<p>&#38;ndash;</p>')).toBe('&ndash;');
      expect(htmlCaptionToText('<p>&#X26;lt;</p>')).toBe('&lt;');
      expect(htmlCaptionToText('<p>&#x26;lt;</p>')).toBe('&lt;');
      expect(htmlCaptionToText('<p>&#38;#8211;</p>')).toBe('&#8211;');
    });

    it('leaves unrecognized entities like &notarealname; as typed', () => {
      expect(htmlCaptionToText('<p>&notarealname;</p>')).toBe('&notarealname;');
    });
  });
});
