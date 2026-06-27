import {
  bareMessageId, earliestSince, buildBatchSearch, extractHeader, referencedPitchId,
  isSelfOrPitch, bodyFromSource, snippetFromBody, imapEnabled, findReplies,
} from '#src/lib/imap-replies.js';

const RAW = [
  'Delivered-To: joshua.v.sherman@gmail.com',
  'From: Pat <booking@venue.com>',
  'In-Reply-To: <pitch-1@gmail.com>',
  'References: <pitch-1@gmail.com>',
  'Subject: Re: gig',
  '',
  'Yes we would love to host you!',
  '> On Mon, Josh wrote:',
  '> the original pitch',
].join('\r\n');

describe('imap-replies', () => {
  describe('bareMessageId', () => {
    it('strips surrounding angle brackets and handles bare/empty', () => {
      expect(bareMessageId('<abc@x>')).toBe('abc@x');
      expect(bareMessageId('abc@x')).toBe('abc@x');
      expect(bareMessageId('')).toBe('');
    });
  });

  describe('earliestSince', () => {
    it('returns the earliest pitch date minus a 1-day buffer', () => {
      const refs = [
        { outreachId: 'a', messageId: '<a>', sentAt: new Date('2026-06-10T00:00:00Z') },
        { outreachId: 'b', messageId: '<b>', sentAt: new Date('2026-06-20T00:00:00Z') },
      ];
      expect(earliestSince(refs).toISOString()).toBe('2026-06-09T00:00:00.000Z');
    });
    it('falls back to ~90 days ago when no dates are known', () => {
      const since = earliestSince([{ outreachId: 'a', messageId: '<a>' }]).getTime();
      expect(Math.abs(since - (Date.now() - 90 * 24 * 60 * 60 * 1000))).toBeLessThan(5000);
    });
  });

  describe('buildBatchSearch', () => {
    it('ORs references + in-reply-to for every id, bounded by since', () => {
      const since = new Date('2026-06-01T00:00:00Z');
      expect(buildBatchSearch(['a@x', 'b@x'], since)).toEqual({
        since,
        or: [
          { header: { references: 'a@x' } }, { header: { 'in-reply-to': 'a@x' } },
          { header: { references: 'b@x' } }, { header: { 'in-reply-to': 'b@x' } },
        ],
      });
    });
    it('returns null when there are no ids', () => {
      expect(buildBatchSearch([], new Date())).toBeNull();
    });
  });

  describe('extractHeader', () => {
    it('reads a header case-insensitively from the header block only', () => {
      expect(extractHeader(RAW, 'from')).toBe('Pat <booking@venue.com>');
      expect(extractHeader(RAW, 'In-Reply-To')).toBe('<pitch-1@gmail.com>');
    });
    it('unfolds continuation lines and returns empty when absent', () => {
      const folded = 'References: <a@x>\r\n <b@x>\r\n\r\nbody';
      expect(extractHeader(folded, 'references')).toBe('<a@x> <b@x>');
      expect(extractHeader(RAW, 'x-nope')).toBe('');
    });
  });

  describe('referencedPitchId', () => {
    it('finds the pitch id referenced by the reply', () => {
      expect(referencedPitchId(RAW, ['other@x', 'pitch-1@gmail.com'])).toBe('pitch-1@gmail.com');
    });
    it('returns null when the message references none of our pitches', () => {
      expect(referencedPitchId(RAW, ['nope@x'])).toBeNull();
    });
  });

  describe('isSelfOrPitch', () => {
    it('flags the pitch itself (its own Message-ID is one of ours)', () => {
      expect(isSelfOrPitch('<pitch-1@gmail.com>', 'x@y.com', 'me@gmail.com', ['pitch-1@gmail.com'])).toBe(true);
    });
    it('flags our own copy (From is our address)', () => {
      expect(isSelfOrPitch('<other@x>', 'Me@Gmail.com', 'me@gmail.com', ['pitch-1@gmail.com'])).toBe(true);
    });
    it('passes a genuine venue reply', () => {
      expect(isSelfOrPitch('<reply@venue>', 'booking@venue.com', 'me@gmail.com', ['pitch-1@gmail.com'])).toBe(false);
    });
  });

  describe('bodyFromSource', () => {
    it('drops the header block, keeping the body after the first blank line', () => {
      expect(bodyFromSource(RAW).startsWith('Yes we would love to host you!')).toBe(true);
      expect(bodyFromSource(RAW)).not.toContain('Delivered-To');
    });
    it('returns the input unchanged when there is no header/body split', () => {
      expect(bodyFromSource('just text')).toBe('just text');
    });
  });

  describe('snippetFromBody', () => {
    it('drops quoted lines / attributions and truncates', () => {
      expect(snippetFromBody('Yes!\n> quoted')).toBe('Yes!');
      expect(snippetFromBody('Thanks.\nOn Mon, Jun 1, Josh wrote:\nold')).toBe('Thanks.');
      const out = snippetFromBody('a'.repeat(600), 100);
      expect(out.length).toBe(100);
      expect(out.endsWith('…')).toBe(true);
    });
  });

  describe('imapEnabled / findReplies', () => {
    it('is disabled under test and findReplies is a no-op', async () => {
      expect(imapEnabled()).toBe(false);
      await expect(findReplies([{ outreachId: 'o1', messageId: '<m1@x>' }])).resolves.toEqual([]);
    });
  });
});
