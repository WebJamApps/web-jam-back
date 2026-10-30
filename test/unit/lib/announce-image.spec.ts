import sharp from 'sharp';
import fs from 'fs';
import {
  padAndConvertToJpeg,
  fetchAndProcessAnnounceImage,
  MIN_INSTAGRAM_ASPECT,
  MAX_INSTAGRAM_ASPECT,
} from '#src/lib/announce-image.js';

describe('announce-image lib', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('padAndConvertToJpeg', () => {
    it('converts a square PNG source to JPEG with unchanged dimensions', async () => {
      const input = await sharp({
        create: {
          width: 120, height: 120, channels: 3, background: { r: 10, g: 20, b: 30 },
        },
      }).png().toBuffer();

      const output = await padAndConvertToJpeg(input);
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(120);
      expect(meta.height).toBe(120);
    });

    it('flattens transparent PNG images to a white background', async () => {
      const input = await sharp({
        create: {
          width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).png().toBuffer();

      const output = await padAndConvertToJpeg(input);
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('jpeg');
      expect(meta.channels).toBe(3);
    });

    it('pads a too-tall image with white bars to reach minimum 4:5 aspect ratio without cropping', async () => {
      // 100x300 -> aspect is 0.33 < 0.8
      const input = await sharp({
        create: {
          width: 100, height: 300, channels: 3, background: { r: 0, g: 0, b: 255 },
        },
      }).png().toBuffer();

      const output = await padAndConvertToJpeg(input);
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('jpeg');
      expect(meta.height).toBe(300);
      // Math.ceil(300 * 0.8) = 240
      expect(meta.width).toBe(240);
      expect((meta.width ?? 0) / (meta.height ?? 1)).toBeGreaterThanOrEqual(MIN_INSTAGRAM_ASPECT);
    });

    it('pads a too-wide image with white bars to reach maximum 1.91:1 aspect ratio without cropping', async () => {
      // 300x100 -> aspect is 3.0 > 1.91
      const input = await sharp({
        create: {
          width: 300, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 },
        },
      }).png().toBuffer();

      const output = await padAndConvertToJpeg(input);
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(300);
      // Math.ceil(300 / 1.91) = 158
      expect(meta.height).toBe(158);
      expect((meta.width ?? 0) / (meta.height ?? 1)).toBeLessThanOrEqual(MAX_INSTAGRAM_ASPECT);
    });

    it('throws when input buffer is invalid or corrupt', async () => {
      await expect(padAndConvertToJpeg(Buffer.from('corrupt non-image data'))).rejects.toThrow();
    });
  });

  describe('fetchAndProcessAnnounceImage', () => {
    it('fetches an image over HTTP and returns converted JPEG', async () => {
      const sourceImage = await sharp({
        create: {
          width: 100, height: 100, channels: 3, background: { r: 50, g: 60, b: 70 },
        },
      }).png().toBuffer();

      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(sourceImage));

      const output = await fetchAndProcessAnnounceImage('https://example.com/promo.png');
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(100);
    });

    it('throws when fetch returns non-2xx status code', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

      await expect(fetchAndProcessAnnounceImage('https://example.com/missing.png')).rejects.toThrow('HTTP 404');
    });

    it('falls back to default promo asset file when fetch fails and URL is promo-default.jpg', async () => {
      const fallbackImage = await sharp({
        create: {
          width: 150, height: 150, channels: 3, background: { r: 120, g: 130, b: 140 },
        },
      }).png().toBuffer();

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Connection refused'));
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(fallbackImage);

      const output = await fetchAndProcessAnnounceImage('http://localhost:7000/gig/promo-default.jpg', '/fake/path/promo.jpg');
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(150);
      expect(meta.height).toBe(150);
    });

    it('rethrows fetch error when default asset cannot be read', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network down'));
      vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('File not found'));

      await expect(fetchAndProcessAnnounceImage('http://localhost:7000/gig/promo-default.jpg', '/bad/path.jpg'))
        .rejects.toThrow('Network down');
    });
  });
});
