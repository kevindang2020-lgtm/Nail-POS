// adImagePipeline.ts — 23-inch dual-screen spec §68–§71: turn the owner's image into what the server stores.
//
// The browser DECODES the image (so a file that isn't really a picture fails here, with a plain message), applies its
// EXIF orientation, and re-encodes three optimized copies: large ≤1920 px, medium ≤1080 px (what the display's panel
// downloads) and a ≤320 px thumbnail — re-encoding also drops EXIF/GPS metadata from every copy a screen ever shows.
// It also finds the picture's point of interest for SMART_CROP. The original goes up beside them; the server checks
// all four (type by magic bytes, MIME, extension, size, dimensions, same shape) before anything is stored.
import { DISPLAY_AD_RULES } from '@aipowersalon/api-contracts';
// Super Admin is English only: the same pipeline as the POS (copied from apps/pos-web/src/screens/display-ads), its words inline.
const MSG: Record<string, string> = {
  'pos.use_a_jpeg_png_or_webp_1ts2': 'Use a JPEG, PNG or WebP image.',
  'pos.v0_images_are_not_allowed_allowed_6x16': '{v0} images are not allowed. Allowed: {v1}.',
  'pos.that_file_is_empty': 'That file is empty.',
  'pos.that_image_is_larger_than_v0_r46g': 'That image is larger than {v0} MB.',
  'admin.ads.shape.panelLandscape': 'This picture is wider than tall; the half-screen panel will show it with space around it.',
  'admin.ads.shape.panelSize': 'For a sharp panel use at least {width} × {height}.',
  'admin.ads.shape.fullscreenCrop': 'Full-screen pictures should be landscape.',
  'admin.ads.shape.fullscreenSize': 'For a sharp full screen use at least {width} × {height}.',
  'pos.that_file_could_not_be_opened_beyk': 'That file could not be opened as an image.',
  'pos.this_browser_cannot_prepare_images': 'This browser cannot prepare images.',
  'pos.this_browser_could_not_prepare_the_zclr': 'This browser could not prepare the image.',
  'pos.that_image_is_too_large_width_ql50': 'That image is too large ({width} × {height}); the long edge may be at most {maxEdge}.',
  'pos.that_image_is_too_small_width_1kf7': 'That image is too small ({width} × {height}); use at least {minLongEdge} on the long edge.',
  'pos.this_image_could_not_be_compressed_1s79': 'This image could not be compressed enough. Use a smaller picture.',
};
const tx = (k: string, v: Record<string, string> = {}) => (MSG[k] ?? k).replace(/\{(\w+)\}/g, (_m, n) => v[n] ?? '');

type AdImageCopy = 'large' | 'medium' | 'thumb';
export interface PreparedAdImage {
  form: FormData; width: number; height: number; focalX: number; focalY: number;
  /** An object URL of the medium copy, for the preview until the upload returns. Revoke when done. */
  previewUrl: string;
  warnings: string[];
}
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** A derivative's size: the long edge within `longEdge`, the shape kept, never enlarged. */
export function fitWithin(w: number, h: number, longEdge: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= longEdge) return { width: w, height: h };
  const k = longEdge / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * The point of interest of a small grayscale image (row-major, w×h): the centroid of local contrast — edges, faces and
 * lettering are high-contrast, plain backgrounds are not — pulled 30% toward the centre and kept off the very border,
 * so one busy corner cannot drag the crop out of the picture. Returns 0–1 from the left/top.
 */
export function interestPoint(gray: ArrayLike<number>, w: number, h: number): { x: number; y: number } {
  let sum = 0, sx = 0, sy = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const g = gray[y * w + x];
      const e = Math.abs(gray[y * w + x + 1] - g) + Math.abs(gray[(y + 1) * w + x] - g);
      if (e <= 8) continue;              // ignore noise / flat areas
      sum += e; sx += e * (x + 0.5); sy += e * (y + 0.5);
    }
  }
  if (sum === 0) return { x: 0.5, y: 0.5 };
  const clampEdge = (v: number) => Math.min(0.9, Math.max(0.1, v));
  return { x: clampEdge(0.7 * (sx / sum / w) + 0.15), y: clampEdge(0.7 * (sy / sum / h) + 0.15) };
}

/** The checks the server will make anyway, made first so the owner hears "too large" before a long upload. */
export function precheck(file: { type: string; size: number; name: string }, limits: { maxFileBytes: number; allowedMimeTypes: readonly string[] }): string | null {
  const type = (file.type || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return tx('pos.use_a_jpeg_png_or_webp_1ts2');
  if (!limits.allowedMimeTypes.includes(type)) return tx('pos.v0_images_are_not_allowed_allowed_6x16', { v0: String(type.replace('image/', '').toUpperCase()), v1: String(limits.allowedMimeTypes.map((t) => t.replace('image/', '').toUpperCase()).join(', ')) });
  if (file.size <= 0) return tx('pos.that_file_is_empty');
  if (file.size > limits.maxFileBytes) return tx('pos.that_image_is_larger_than_v0_r46g', { v0: String(Math.round(limits.maxFileBytes / 1024 / 1024)) });
  return null;
}

/** Shape advice for the right panel (portrait ~2:3) or the full screen (16:9). */
export function shapeWarnings(width: number, height: number, purpose: 'panel' | 'fullscreen'): string[] {
  const out: string[] = []; const r = width / height;
  const R = DISPLAY_AD_RULES.recommended;
  if (purpose === 'panel') {
    if (r > 1.05) out.push(tx('admin.ads.shape.panelLandscape'));
    if (Math.max(width, height) < R.panel.height) out.push(tx('admin.ads.shape.panelSize', { width: String(R.panel.width), height: String(R.panel.height) }));
  } else {
    if (r < 1.5) out.push(tx('admin.ads.shape.fullscreenCrop'));
    if (width < R.fullscreen.width) out.push(tx('admin.ads.shape.fullscreenSize', { width: String(R.fullscreen.width), height: String(R.fullscreen.height) }));
  }
  return out;
}

/** Decode a picture the owner chose, EXIF orientation applied (shared with the salon logo upload). */
export async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async'; img.src = url;
    await img.decode();
    return img;
  } catch { throw new Error(tx('pos.that_file_could_not_be_opened_beyk')); }
  finally { URL.revokeObjectURL(url); }
}
export const sizeOf = (s: ImageBitmap | HTMLImageElement) => ('naturalWidth' in s ? { width: s.naturalWidth, height: s.naturalHeight } : { width: s.width, height: s.height });

function canvasOf(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));

/** One optimized copy: WebP where the browser can encode it, else JPEG on white (transparent PNG areas must not go black). */
async function derive(src: ImageBitmap | HTMLImageElement, w: number, h: number, longEdge: number): Promise<Blob> {
  const t = fitWithin(w, h, longEdge);
  const c = canvasOf(t.width, t.height);
  const g = c.getContext('2d'); if (!g) throw new Error(tx('pos.this_browser_cannot_prepare_images'));
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src as CanvasImageSource, 0, 0, t.width, t.height);
  const webp = await toBlob(c, 'image/webp', 0.86);
  if (webp && webp.type === 'image/webp') return webp;
  g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, t.width, t.height);
  const jpeg = await toBlob(c, 'image/jpeg', 0.88);
  if (!jpeg) throw new Error(tx('pos.this_browser_could_not_prepare_the_zclr'));
  return jpeg;
}

function focalOf(src: ImageBitmap | HTMLImageElement, w: number, h: number): { x: number; y: number } {
  const t = fitWithin(w, h, 48);
  const c = canvasOf(t.width, t.height); const g = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!g) return { x: 0.5, y: 0.5 };
  g.drawImage(src as CanvasImageSource, 0, 0, t.width, t.height);
  const px = g.getImageData(0, 0, t.width, t.height).data;
  const gray = new Uint8ClampedArray(t.width * t.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  return interestPoint(gray, t.width, t.height);
}

/** Decode, check, derive, analyse — and build the multipart body for POST /pos/marketing/display-ads/media. */
export async function prepareAdImage(file: File, limits: { maxFileBytes: number; allowedMimeTypes: readonly string[] }, purpose: 'panel' | 'fullscreen' = 'panel'): Promise<PreparedAdImage> {
  const problem = precheck(file, limits);
  if (problem) throw new Error(problem);
  const src = await decodeImage(file);
  try {
    const { width, height } = sizeOf(src);
    const I = DISPLAY_AD_RULES.image;
    const long = Math.max(width, height), short = Math.min(width, height);
    if (long > I.maxEdge || width * height > I.maxPixels) throw new Error(tx('pos.that_image_is_too_large_width_ql50', { width: String(width), height: String(height), maxEdge: String(I.maxEdge) }));
    if (long < I.minLongEdge || short < I.minShortEdge) throw new Error(tx('pos.that_image_is_too_small_width_1kf7', { width: String(width), height: String(height), minLongEdge: String(I.minLongEdge) }));
    const D = DISPLAY_AD_RULES.derivatives;
    const copies: Record<AdImageCopy, Blob> = {
      large: await derive(src, width, height, D.large.longEdge),
      medium: await derive(src, width, height, D.medium.longEdge),
      thumb: await derive(src, width, height, D.thumb.longEdge),
    };
    for (const v of ['large', 'medium', 'thumb'] as AdImageCopy[]) if (copies[v].size > D[v].maxBytes) throw new Error(tx('pos.this_image_could_not_be_compressed_1s79'));
    const focal = focalOf(src, width, height);
    const form = new FormData();
    form.append('original', file, file.name || `original.${EXT[file.type] ?? 'jpg'}`);
    for (const v of ['large', 'medium', 'thumb'] as AdImageCopy[]) form.append(v, copies[v], `${v}.${EXT[copies[v].type] ?? 'jpg'}`);
    form.append('focalX', String(Math.round(focal.x * 1000) / 1000));
    form.append('focalY', String(Math.round(focal.y * 1000) / 1000));
    return { form, width, height, focalX: focal.x, focalY: focal.y, previewUrl: URL.createObjectURL(copies.medium), warnings: shapeWarnings(width, height, purpose) };
  } finally {
    if ('close' in src && typeof src.close === 'function') src.close();
  }
}
