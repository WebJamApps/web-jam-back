import fs from 'fs';
import sharp from 'sharp';

// Instagram publishing API requires aspect ratio between 4:5 (0.80) portrait
// and 1.91:1 (1.91) landscape. Images falling outside this range must be padded
// with white bars to the nearest allowed shape without cropping.
export const MIN_INSTAGRAM_ASPECT = 0.8; // 4:5
export const MAX_INSTAGRAM_ASPECT = 1.91; // 1.91:1

export async function padAndConvertToJpeg(input: Buffer | Uint8Array): Promise<Buffer> {
  const image = sharp(input);
  const meta = await image.metadata();

  if (!meta.width || !meta.height) {
    throw new Error('Image metadata missing width or height');
  }

  const { width, height } = meta;
  const aspect = width / height;

  let pipeline = sharp(input);

  // If source has alpha channel, flatten transparent pixels to white background
  if (meta.hasAlpha) {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
  }

  if (aspect < MIN_INSTAGRAM_ASPECT) {
    // Too tall / narrow: pad width to reach 4:5 (0.8) aspect ratio with white bars
    const targetWidth = Math.ceil(height * MIN_INSTAGRAM_ASPECT);
    const pad = targetWidth - width;
    const left = Math.floor(pad / 2);
    const right = pad - left;
    pipeline = pipeline.extend({
      top: 0,
      bottom: 0,
      left,
      right,
      background: { r: 255, g: 255, b: 255 },
    });
  } else if (aspect > MAX_INSTAGRAM_ASPECT) {
    // Too wide / short: pad height to reach 1.91:1 aspect ratio with white bars
    const targetHeight = Math.ceil(width / MAX_INSTAGRAM_ASPECT);
    const pad = targetHeight - height;
    const top = Math.floor(pad / 2);
    const bottom = pad - top;
    pipeline = pipeline.extend({
      top,
      bottom,
      left: 0,
      right: 0,
      background: { r: 255, g: 255, b: 255 },
    });
  }

  return pipeline.jpeg().toBuffer();
}

export async function fetchAndProcessAnnounceImage(
  sourceUrl: string,
  defaultPromoAssetPath?: string | null,
): Promise<Buffer> {
  let sourceBuffer: Buffer;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch image: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    sourceBuffer = Buffer.from(arrayBuffer);
  } catch (fetchErr) {
    if (defaultPromoAssetPath && sourceUrl.endsWith('/gig/promo-default.jpg')) {
      try {
        sourceBuffer = await fs.promises.readFile(defaultPromoAssetPath);
      } catch {
        throw fetchErr;
      }
    } else {
      throw fetchErr;
    }
  }

  return padAndConvertToJpeg(sourceBuffer);
}
