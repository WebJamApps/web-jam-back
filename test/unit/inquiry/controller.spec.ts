/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import InquiryController, { senderForArtist } from '#src/model/inquiry/InquiryController.js';

// NODE_ENV is 'test' for the whole suite (see test/setup), so sendEmail never
// hits the real Gmail transporter — it always short-circuits to the 200
// response. These tests exercise handleInquiry's wiring into
// formatInquiryEmail (subject/html/text) and sendEmail's text-vs-html
// fallback, using a minimal Response stub.
function mockRes() {
  const res: any = {};
  res.status = (s: number) => { res.statusCode = s; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

describe('senderForArtist', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('uses GMAIL_USER and GMAIL_APP_PASSWORD for default artist or when unmapped', () => {
    process.env.GMAIL_USER = 'josh@example.com';
    process.env.GMAIL_APP_PASSWORD = 'josh-password';
    expect(senderForArtist(undefined)).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });
    expect(senderForArtist('jammusic')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });
    expect(senderForArtist('other-artist')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });
  });

  it('falls back to empty strings if GMAIL_USER / GMAIL_APP_PASSWORD are unset', () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    expect(senderForArtist(undefined)).toEqual({
      user: '',
      pass: '',
      from: '',
    });
  });

  it('uses Tim credentials when artist is tim and both env vars are present', () => {
    process.env.GMAIL_USER = 'josh@example.com';
    process.env.GMAIL_APP_PASSWORD = 'josh-password';
    process.env.TimGmailUser = 'tim@example.com';
    process.env.TimGmailAppPassword = 'tim-password';
    expect(senderForArtist('tim')).toEqual({
      user: 'tim@example.com',
      pass: 'tim-password',
      from: 'tim@example.com',
    });
  });

  it('falls back to default credentials if either Tim env var is missing', () => {
    process.env.GMAIL_USER = 'josh@example.com';
    process.env.GMAIL_APP_PASSWORD = 'josh-password';

    process.env.TimGmailUser = 'tim@example.com';
    delete process.env.TimGmailAppPassword;
    expect(senderForArtist('tim')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });

    delete process.env.TimGmailUser;
    process.env.TimGmailAppPassword = 'tim-password';
    expect(senderForArtist('tim')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });

    delete process.env.TimGmailUser;
    delete process.env.TimGmailAppPassword;
    expect(senderForArtist('tim')).toEqual({
      user: 'josh@example.com',
      pass: 'josh-password',
      from: 'josh@example.com',
    });
  });
});

describe('InquiryController.handleInquiry', () => {
  it('formats a Tim Sherman booking submission into a descriptive subject', () => {
    const controller = new InquiryController();
    const res = mockRes();
    controller.handleInquiry({
      body: {
        artist: 'tim', name: 'John Doe', email: 'john@example.com', phone: '555-123-4567',
        eventDate: '2026-08-15', message: 'Wedding gig',
      },
    } as any, res);
    expect(res.statusCode).toBe(200);
  });

  it('formats a default-artist (JaMmusic) submission gracefully with missing fields', () => {
    const controller = new InquiryController();
    const res = mockRes();
    controller.handleInquiry({ body: { emailaddress: 'yo@yo.com' } } as any, res);
    expect(res.statusCode).toBe(200);
  });

  it('extracts customer replyTo from body.email', () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    controller.handleInquiry({
      body: { email: '  customer@example.com  ' },
    } as any, res);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      'customer@example.com',
    );
  });

  it('extracts customer replyTo from body.emailaddress when email is not provided', () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    controller.handleInquiry({
      body: { emailaddress: '  legacy@example.com  ' },
    } as any, res);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      'legacy@example.com',
    );
  });

  it('passes undefined replyTo when neither email nor emailaddress is provided', () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    controller.handleInquiry({ body: {} } as any, res);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      undefined,
    );
  });

  it('passes undefined replyTo when body is missing or email fields are blank whitespace', () => {
    const controller = new InquiryController();
    const sendEmailSpy = vi.spyOn(controller, 'sendEmail');
    const res = mockRes();
    controller.handleInquiry({} as any, res);
    expect(sendEmailSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      undefined,
    );

    controller.handleInquiry({ body: { email: '   ', emailaddress: '   ' } } as any, res);
    expect(sendEmailSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      res,
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      undefined,
    );
  });
});

describe('InquiryController.sendEmail', () => {
  it('uses the supplied plaintext body when provided', async () => {
    const controller = new InquiryController();
    const res = mockRes();
    await controller.sendEmail('<p>html</p>', 'to@example.com', 'subject', res, undefined, 'plain text');
    expect(res.statusCode).toBe(200);
  });

  it('falls back to the html body when no plaintext is supplied', async () => {
    const controller = new InquiryController();
    const res = mockRes();
    await controller.sendEmail('<p>html only</p>', 'to@example.com', 'subject', res);
    expect(res.statusCode).toBe(200);
  });

  it('supports explicit sender and replyTo', async () => {
    const controller = new InquiryController();
    const res = mockRes();
    await controller.sendEmail(
      '<p>html</p>',
      'to@example.com',
      'subject',
      res,
      'cc@example.com',
      'plain text',
      { user: 'tim@example.com', pass: 'secret', from: 'tim@example.com' },
      'customer@example.com',
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('InquiryController transporters', () => {
  it('reuses transporters for the same user and creates distinct ones for different users', () => {
    const controller = new InquiryController();
    const t1 = (controller as any).getTransporter('user1@example.com', 'pass1');
    const t2 = (controller as any).getTransporter('user1@example.com', 'pass1');
    const t3 = (controller as any).getTransporter('user2@example.com', 'pass2');

    expect(t1).toBeDefined();
    expect(t1).toBe(t2);
    expect(t3).toBeDefined();
    expect(t3).not.toBe(t1);
  });
});
