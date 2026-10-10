// The email replacement (web-jam-tools#1083, web-jam-back#1146), run over every literal input of the
// issue's closed list. Pure functions: nothing here touches a database or the network.
import mongoose from 'mongoose';
import {
  findRealAddresses, scrubDocument, scrubString, newScrubContext,
} from '#src/model/backup/email-scrub.js';

type Doc = Record<string, unknown>;

const ID = '64b000000000000000000001';
const scrub = (text: string, collection = 'venues') => {
  const ctx = newScrubContext(collection, { _id: ID });
  return { text: scrubString(text, ctx), replaced: ctx.replaced };
};
const MADE_UP = `venues-${ID}@example.invalid`;

describe('email-scrub: replacement over the closed list of inputs', () => {
  it('replaces an address in a record that does not hold the top-level admin role', () => {
    const { doc, replaced } = scrubDocument({ _id: ID, email: 'person@example.com', userType: 'Member' }, 'users');
    expect(doc.email).toBe(`users-${ID}@example.invalid`);
    expect(replaced).toBe(1);
  });

  it('keeps the email of a record the caller marks as holding the top-level admin role', () => {
    const { doc, replaced } = scrubDocument({ _id: ID, email: 'person@example.com', userType: 'Developer' }, 'users', { keepEmail: true });
    expect(doc.email).toBe('person@example.com');
    expect(replaced).toBe(0);
  });

  it('still scrubs the other values of a record whose email is kept', () => {
    const { doc } = scrubDocument({ _id: ID, email: 'me@example.com', note: 'cc other@example.com' }, 'users', { keepEmail: true });
    expect(doc.email).toBe('me@example.com');
    expect(doc.note).toBe(`cc ${`users-${ID}@example.invalid`}`);
  });

  it.each([
    ['First.Last+tag@sub.example.co.uk', MADE_UP],
    ['UPPER@EXAMPLE.COM', MADE_UP],
    ['Booking Desk <booking@venue.example>', `Booking Desk <${MADE_UP}>`],
    ['mailto:booking@venue.example', `mailto:${MADE_UP}`],
    ['Call us or write to info@venue.example before Friday.', `Call us or write to ${MADE_UP} before Friday.`],
  ])('replaces the address in %j and keeps the rest', (input, expected) => {
    expect(scrub(input)).toEqual({ text: expected, replaced: 1 });
  });

  it('replaces both addresses of "a@venue.example, b@venue.example" with two different results', () => {
    const { text, replaced } = scrub('a@venue.example, b@venue.example');
    const [first, second] = text.split(', ');
    expect(replaced).toBe(2);
    expect(first).toBe(MADE_UP);
    expect(second).toBe(`venues-${ID}-2@example.invalid`);
    expect(first).not.toBe(second);
  });

  it('gives a repeated address the same result within one record', () => {
    expect(scrub('x@venue.example and X@Venue.Example').text).toBe(`${MADE_UP} and ${MADE_UP}`);
  });

  it.each([
    `users-64b000000000000000000001@example.invalid`,
    '@venuehandle',
    'no at sign here',
    'a@b',
  ])('leaves %j as it is', (input) => {
    expect(scrub(input)).toEqual({ text: input, replaced: 0 });
  });

  it('leaves a number, a boolean, a date, null and an ObjectId as they are', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const oid = new mongoose.Types.ObjectId(ID);
    const input: Doc = { _id: oid, n: 42, b: true, d: date, nothing: null };
    const { doc, replaced } = scrubDocument(input, 'venues');
    expect(doc).toEqual(input);
    expect(doc._id).toBe(oid);
    expect(doc.d).toBe(date);
    expect(replaced).toBe(0);
  });

  it('replaces an address inside an array inside a nested object', () => {
    const { doc, replaced } = scrubDocument({
      _id: ID,
      contacts: { list: [{ people: ['ok', 'real@venue.example'] }] },
    }, 'venues');
    expect(doc.contacts).toEqual({ list: [{ people: ['ok', MADE_UP] }] });
    expect(replaced).toBe(1);
  });

  it('uses the collection name and the record id, and copes with a record that has no id', () => {
    expect(scrubDocument({ e: 'x@y.example' }, 'subscribers').doc.e).toBe('subscribers-no-id@example.invalid');
  });
});

describe('email-scrub: findRealAddresses', () => {
  it('finds real addresses at any depth, lower-cased, and ignores made-up ones and non-text values', () => {
    expect(findRealAddresses({
      a: 'Hello Real@Venue.Example', b: [{ c: MADE_UP }], d: 5, e: new Date(), f: null,
    })).toEqual(['real@venue.example']);
  });
});
