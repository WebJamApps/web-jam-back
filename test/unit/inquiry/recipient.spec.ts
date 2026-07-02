import { recipientForArtist } from '#src/model/inquiry/InquiryController.js';

describe('inquiry recipientForArtist', () => {
  const orig = process.env.InquiryRecipients;
  afterEach(() => { process.env.InquiryRecipients = orig; });

  it('routes the default (JaMmusic) artist to Josh + Maria CC', () => {
    expect(recipientForArtist(undefined)).toEqual({
      to: 'joshua.v.sherman@gmail.com',
      cc: 'chemmariasherman@gmail.com',
    });
    expect(recipientForArtist('jammusic').cc).toBe('chemmariasherman@gmail.com');
  });

  it('routes a mapped artist to its own contact (no CC)', () => {
    process.env.InquiryRecipients = JSON.stringify({ tim: 'tim@example.com' });
    expect(recipientForArtist('tim')).toEqual({ to: 'tim@example.com' });
  });

  it('falls back to the default when the artist is unmapped or config is bad', () => {
    process.env.InquiryRecipients = JSON.stringify({ tim: 'tim@example.com' });
    expect(recipientForArtist('nobody').to).toBe('joshua.v.sherman@gmail.com');
    process.env.InquiryRecipients = 'not-json';
    expect(recipientForArtist('tim').to).toBe('joshua.v.sherman@gmail.com');
  });
});
