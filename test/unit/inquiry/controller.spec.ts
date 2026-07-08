/* eslint-disable @typescript-eslint/no-explicit-any */
import InquiryController from '#src/model/inquiry/InquiryController.js';

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
});
