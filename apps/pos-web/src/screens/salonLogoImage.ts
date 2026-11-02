// salonLogoImage.ts — Settings → Receipts & Branding → Salon logo (23-inch dual-screen spec §13).
//
// The browser DECODES the owner's picture (a file that isn't really an image fails here, with a plain message), applies
// its EXIF orientation, shrinks it to fit 800 px and re-encodes it — PNG first, so a transparent background stays
// transparent on the receipt and on the display's header; WebP (which keeps transparency too) when the PNG is too heavy.
// Re-encoding also drops any EXIF/GPS metadata. The result goes up as a data URL; the server checks the bytes again
// (type by magic bytes, declared type, size, dimensions) before anything is stored.
import { decodeImage, fitWithin, sizeOf } from './display-ads/adImagePipeline';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

/** maxBytes / minEdge / maxEdge are the server's limits (modules/tenants salon-logo.ts SALON_LOGO_RULES). */
export const LOGO_RULES = Object.freeze({ maxSourceBytes: 20 * 1024 * 1024, longEdge: 800, minEdge: 32, maxEdge: 2048, maxBytes: 1_000_000 });
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** The checks that need no decoding, made first so the owner hears "not an image" / "too large" at once. */
export function logoPrecheck(file: { type: string; size: number }): string | null {
  const type = (file.type || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!TYPES.includes(type)) return tx('pos.use_a_png_jpeg_or_webp_pob0');
  if (file.size <= 0) return tx('pos.that_file_is_empty');
  if (file.size > LOGO_RULES.maxSourceBytes) return tx('pos.that_image_is_larger_than_v0_r46g', { v0: String(Math.round(LOGO_RULES.maxSourceBytes / 1024 / 1024)) });
  return null;
}

/**
 * The size the logo is stored at: within 800 px on the long side, never enlarged. A very long, thin logo keeps a
 * readable 32 px short side instead (up to the server's 2048 px). Throws a plain message when it cannot be shown.
 */
export function logoTargetSize(w: number, h: number): { width: number; height: number } {
  const { minEdge, maxEdge, longEdge } = LOGO_RULES;
  const short = Math.min(w, h);
  if (!(short >= minEdge)) throw new Error(tx('pos.that_image_is_too_small_w_24q1', { w: String(w), h: String(h), minEdge: String(minEdge) }));
  const t = fitWithin(w, h, longEdge);
  if (Math.min(t.width, t.height) >= minEdge) return t;
  const k = minEdge / short;
  const out = w <= h
    ? { width: minEdge, height: Math.round(h * k) }
    : { width: Math.round(w * k), height: minEdge };
  if (Math.max(out.width, out.height) > maxEdge) throw new Error(tx('pos.that_logo_is_too_long_and_9maw'));
  return out;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));
const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(new Error(tx('pos.the_logo_could_not_be_read')));
  r.readAsDataURL(b);
});

export interface PreparedLogo { dataUrl: string; width: number; height: number; bytes: number; type: string }

/** Decode → size → re-encode → data URL, ready for POST /pos/settings/receipts-branding/logo. */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  const problem = logoPrecheck(file);
  if (problem) throw new Error(problem);
  const src = await decodeImage(file);
  try {
    const { width, height } = sizeOf(src);
    const t = logoTargetSize(width, height);
    const c = document.createElement('canvas'); c.width = t.width; c.height = t.height;
    const g = c.getContext('2d');
    if (!g) throw new Error(tx('pos.this_browser_cannot_prepare_images'));
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src as CanvasImageSource, 0, 0, t.width, t.height);
    let blob = await toBlob(c, 'image/png');
    if (!blob || blob.type !== 'image/png' || blob.size > LOGO_RULES.maxBytes) {
      const webp = await toBlob(c, 'image/webp', 0.92);
      blob = webp && webp.type === 'image/webp' && webp.size <= LOGO_RULES.maxBytes ? webp : null;
    }
    if (!blob) throw new Error(tx('pos.this_logo_could_not_be_made_whem'));
    return { dataUrl: await toDataUrl(blob), width: t.width, height: t.height, bytes: blob.size, type: blob.type };
  } finally {
    if ('close' in src && typeof src.close === 'function') src.close();
  }
}
