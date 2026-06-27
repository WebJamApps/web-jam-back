import {
  bareMessageId, buildReplySearch, snippetFromBody, imapEnabled, findReplies,
} from '#src/lib/imap-replies.js';

describe('imap-replies', () => {
  describe('bareMessageId', () => {
    it('strips surrounding angle brackets', () => {
      expect(bareMessageId('<abc123@mail.gmail.com>')).toBe('abc123@mail.gmail.com');
    });
    it('handles an already-bare id and empty input', () => {
      expect(bareMessageId('abc@x')).toBe('abc@x');
      expect(bareMessageId('')).toBe('');
    });
  });

  describe('buildReplySearch', () => {
    it('matches the bare id in References OR In-Reply-To', () => {
      expect(buildReplySearch('<id@x>')).toEqual({
        or: [{ header: { references: 'id@x' } }, { header: { 'in-reply-to': 'id@x' } }],
      });
    });
  });

  describe('snippetFromBody', () => {
    it('drops everything from a quoted (>) line', () => {
      expect(snippetFromBody('Yes we would love to host you!\n> On the original pitch\n> more quote')).toBe('Yes we would love to host you!');
    });
    it('drops an "On ... wrote:" attribution block', () => {
      expect(snippetFromBody('Thanks for reaching out.\nOn Mon, Jun 1, Josh wrote:\nold body')).toBe('Thanks for reaching out.');
    });
    it('collapses whitespace and truncates with an ellipsis', () => {
      const long = `${'a'.repeat(600)}`;
      const out = snippetFromBody(long, 100);
      expect(out.length).toBe(100);
      expect(out.endsWith('…')).toBe(true);
    });
    it('returns empty for empty input', () => {
      expect(snippetFromBody('')).toBe('');
    });
  });

  describe('imapEnabled', () => {
    it('is false under test (no live Gmail in CI)', () => {
      expect(imapEnabled()).toBe(false);
    });
  });

  describe('findReplies', () => {
    it('returns [] when disabled (test env) without touching the network', async () => {
      await expect(findReplies([{ outreachId: 'o1', messageId: '<m1@x>' }])).resolves.toEqual([]);
    });
  });
});
