import {
  bareMessageId, earliestSince, buildBatchSearch, extractHeader, referencedPitchId,
  isSelfOrPitch, isAutoOrBounce, bodyFromSource, snippetFromBody, imapEnabled, findReplies,
  type ImapClientLike,
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

// ---------------------------------------------------------------------------
// Fixture messages for FakeImapClient
// ---------------------------------------------------------------------------

// Fixture 1 — genuine venue reply: should match outreach o1.
const FIXTURE_REPLY_SOURCE = [
  'From: booking@thevenue.com',
  'Message-ID: <reply-1@thevenue.com>',
  'In-Reply-To: <pitch-1@gmail.com>',
  'References: <pitch-1@gmail.com>',
  'Subject: Re: gig inquiry',
  '',
  "Yes we'd love to host you!",
].join('\r\n');

// Fixture 2 — bounce: mailer-daemon + multipart/report. Must NOT match.
const FIXTURE_BOUNCE_SOURCE = [
  'From: mailer-daemon@googlemail.com',
  'Message-ID: <6a3afcb1.fcfc1c8a.266c68.5881.GMR@mx.google.com>',
  'Subject: Delivery Status Notification (Failure)',
  'In-Reply-To: <pitch-1@gmail.com>',
  'Content-Type: multipart/report; report-type=delivery-status',
  '',
  'Delivery failure notice.',
].join('\r\n');

// Fixture 3 — self/pitch copy: Message-ID equals the pitch id. Must NOT match.
const FIXTURE_SELF_SOURCE = [
  'From: joshua.v.sherman@gmail.com',
  'Message-ID: <pitch-1@gmail.com>',
  'Subject: gig inquiry',
  '',
  'Original pitch text.',
].join('\r\n');

type FakeMsg = {
  uid: number;
  envelope: { messageId?: string; from?: { address?: string }[]; date?: Date };
  source: string;
  threadId?: string | number;
};

class FakeImapClient implements ImapClientLike {
  constructor(private readonly msgs: FakeMsg[]) {}
  async connect() { return undefined; }
  async getMailboxLock(_mailbox: string) { return { release() {} }; }
  async search(_query: unknown, _opts: { uid: boolean }) {
    return this.msgs.map((m) => m.uid);
  }
  async fetchOne(uid: string, _query: unknown, _opts: { uid: boolean }) {
    const msg = this.msgs.find((m) => m.uid === Number(uid));
    return msg ?? false;
  }
  async logout() { return undefined; }
  close() { return undefined; }
}

function makeFake(msgs: FakeMsg[]): FakeImapClient {
  return new FakeImapClient(msgs);
}

const FAKE_MSGS: FakeMsg[] = [
  {
    uid: 1,
    envelope: {
      messageId: '<reply-1@thevenue.com>',
      from: [{ address: 'booking@thevenue.com' }],
      date: new Date('2026-06-21T10:00:00Z'),
    },
    source: FIXTURE_REPLY_SOURCE,
    threadId: 'thread-abc',
  },
  {
    uid: 2,
    envelope: {
      messageId: '<6a3afcb1.fcfc1c8a.266c68.5881.GMR@mx.google.com>',
      from: [{ address: 'mailer-daemon@googlemail.com' }],
      date: new Date('2026-06-21T11:00:00Z'),
    },
    source: FIXTURE_BOUNCE_SOURCE,
  },
  {
    uid: 3,
    envelope: {
      messageId: '<pitch-1@gmail.com>',
      from: [{ address: 'joshua.v.sherman@gmail.com' }],
      date: new Date('2026-06-20T09:00:00Z'),
    },
    source: FIXTURE_SELF_SOURCE,
  },
];

const PITCH_REFS = [{ outreachId: 'o1', messageId: '<pitch-1@gmail.com>', sentAt: new Date('2026-06-20') }];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  describe('isAutoOrBounce', () => {
    it('detects mailer-daemon sender', () => {
      expect(isAutoOrBounce('mailer-daemon@googlemail.com', '')).toBe(true);
    });
    it('detects postmaster sender', () => {
      expect(isAutoOrBounce('postmaster@example.com', '')).toBe(true);
    });
    it('detects no-reply local-part', () => {
      expect(isAutoOrBounce('no-reply@domain.com', '')).toBe(true);
    });
    it('detects noreply local-part', () => {
      expect(isAutoOrBounce('noreply@domain.com', '')).toBe(true);
    });
    it('detects Auto-Submitted: auto-generated header', () => {
      const raw = 'Auto-Submitted: auto-generated\r\n\r\nbody';
      expect(isAutoOrBounce('system@domain.com', raw)).toBe(true);
    });
    it('detects Auto-Submitted: auto-replied header', () => {
      const raw = 'Auto-Submitted: auto-replied\r\n\r\nbody';
      expect(isAutoOrBounce('system@domain.com', raw)).toBe(true);
    });
    it('does not flag Auto-Submitted: no', () => {
      const raw = 'Auto-Submitted: no\r\n\r\nbody';
      expect(isAutoOrBounce('booking@venue.com', raw)).toBe(false);
    });
    it('detects multipart/report content-type (delivery-status report)', () => {
      const raw = 'Content-Type: multipart/report; report-type=delivery-status\r\n\r\nbody';
      expect(isAutoOrBounce('system@domain.com', raw)).toBe(true);
    });
    it('returns false for a normal human reply', () => {
      const raw = 'Content-Type: text/plain\r\n\r\nHey, we would love to book you!';
      expect(isAutoOrBounce('booking@venue.com', raw)).toBe(false);
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

  describe('imapEnabled / findReplies (no client)', () => {
    it('is disabled under test and findReplies is a no-op', async () => {
      expect(imapEnabled()).toBe(false);
      await expect(findReplies([{ outreachId: 'o1', messageId: '<m1@x>' }])).resolves.toEqual([]);
    });
  });

  describe('findReplies (via FakeImapClient)', () => {
    it('returns only the genuine reply, filtering out bounce and self-copy', async () => {
      const fake = makeFake(FAKE_MSGS);
      const result = await findReplies(PITCH_REFS, () => fake);
      expect(result).toHaveLength(1);
      expect(result[0].outreachId).toBe('o1');
      expect(result[0].fromAddress).toBe('booking@thevenue.com');
      expect(result[0].snippet).toContain("Yes we'd love to host you");
      expect(result[0].gmailThreadId).toBe('thread-abc');
    });

    it('returns [] when refs is empty (even with injected client)', async () => {
      await expect(findReplies([], () => makeFake([]))).resolves.toEqual([]);
    });

    it('returns [] when all pitch messageIds are empty (no searchable ids)', async () => {
      const refs = [{ outreachId: 'o1', messageId: '' }];
      await expect(findReplies(refs, () => makeFake([]))).resolves.toEqual([]);
    });

    it('skips messages that have no source', async () => {
      const noSource: FakeMsg = {
        uid: 10,
        envelope: {
          messageId: '<no-source@x>',
          from: [{ address: 'booking@thevenue.com' }],
        },
        source: '',
      };
      const result = await findReplies(PITCH_REFS, () => makeFake([noSource]));
      expect(result).toEqual([]);
    });

    it('collapses multiple replies from same outreach to the latest (highest uid)', async () => {
      const first: FakeMsg = {
        uid: 1,
        envelope: {
          messageId: '<first-reply@thevenue.com>',
          from: [{ address: 'booking@thevenue.com' }],
          date: new Date('2026-06-21T10:00:00Z'),
        },
        source: FIXTURE_REPLY_SOURCE,
      };
      const second: FakeMsg = {
        uid: 2,
        envelope: {
          messageId: '<second-reply@thevenue.com>',
          from: [{ address: 'booking@thevenue.com' }],
          date: new Date('2026-06-22T10:00:00Z'),
        },
        source: [
          'From: booking@thevenue.com',
          'Message-ID: <second-reply@thevenue.com>',
          'In-Reply-To: <pitch-1@gmail.com>',
          '',
          'Following up — still interested!',
        ].join('\r\n'),
      };
      const result = await findReplies(PITCH_REFS, () => makeFake([first, second]));
      expect(result).toHaveLength(1);
      expect(result[0].snippet).toContain('Following up');
    });
  });
});
