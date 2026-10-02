import { mustStopDispatch } from '#src/lib/mail-failure.js';

describe('mail-failure.ts — mustStopDispatch', () => {
  it.each(['EAUTH', 'ENOAUTH', 'EOAUTH2', 'ECONNECTION', 'EDNS', 'ETLS', 'ETIMEDOUT', 'ESOCKET', 'EPROTOCOL'])(
    'stops for an account or connection code %s',
    (code) => {
      expect(mustStopDispatch({ code })).toBe(true);
    },
  );

  it('stops for the Gmail login rejection (EAUTH with 454)', () => {
    expect(mustStopDispatch({ code: 'EAUTH', responseCode: 454 })).toBe(true);
  });

  it('stops for a 454 responseCode', () => {
    expect(mustStopDispatch({ responseCode: 454 })).toBe(true);
  });

  it('stops for a 421 responseCode with no code', () => {
    expect(mustStopDispatch({ responseCode: 421 })).toBe(true);
  });

  it('does not stop for EENVELOPE with a 550 reply', () => {
    expect(mustStopDispatch({ code: 'EENVELOPE', responseCode: 550 })).toBe(false);
  });

  it('does not stop for EMESSAGE with a 552 reply', () => {
    expect(mustStopDispatch({ code: 'EMESSAGE', responseCode: 552 })).toBe(false);
  });

  it('does not stop for an unlisted code with no responseCode', () => {
    expect(mustStopDispatch({ code: 'EENVELOPE' })).toBe(false);
  });

  it('stops (fails closed) for a plain Error with no code or responseCode', () => {
    expect(mustStopDispatch(new Error('x'))).toBe(true);
  });

  it('stops (fails closed) for undefined, null and a string', () => {
    expect(mustStopDispatch(undefined)).toBe(true);
    expect(mustStopDispatch(null)).toBe(true);
    expect(mustStopDispatch('x')).toBe(true);
  });
});
