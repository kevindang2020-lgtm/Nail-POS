// display-ads-media-core.ts — 23-inch dual-screen spec §68–§71, §77: what an uploaded advertising image must be. PURE.
//
// The BYTES decide (§70: "file type, MIME, magic bytes, file size, image dimensions"): the type is sniffed from the
// header, the client's declared MIME and the file name's extension must agree with it, and the dimensions are read from
// the image header itself (JPEG SOF / EXIF orientation, PNG IHDR, WebP VP8/VP8L/VP8X) — so an HTML page, an SVG or a
// script renamed .png is refused, and a 40,000-pixel "decompression bomb" is refused before anything decodes it.
//
// §71 derivatives (≤1920 / ≤1080 / ≤320 px on the long edge) are produced by the POS from the decoded image (the owner's
// browser decodes and re-encodes, which also drops EXIF/GPS from every copy the display ever downloads). The server
// cannot decode, so it verifies what it can: each copy is a real image, within its byte cap and long-edge bound, no larger
// than the original, and the SAME SHAPE as the original (aspect within tolerance, either orientation).
import { DISPLAY_AD_RULES } from '@aipowersalon/api-contracts';
import { DisplayAdError } from './display-ads-core';

// The byte-level parsers (sniff + header dimensions) are shared with the salon logo upload: @aipowersalon/media.
import { EXT_KIND, KIND_EXT, KIND_MIME, imageInfo, orientedSize, sniffImage, type ImageKind } from '@aipowersalon/media';
export { KIND_EXT, KIND_MIME, imageInfo, orientedSize, sniffImage, type ImageInfo, type ImageKind } from '@aipowersalon/media';

export interface UploadedPart { buffer: Uint8Array; mimetype?: string; originalname?: string; size?: number }
export interface CheckedImage { kind: ImageKind; mime: string; ext: string; width: number; height: number; bytes: number; buffer: Uint8Array }
export interface CheckedUpload { original: CheckedImage; large: CheckedImage; medium: CheckedImage; thumb: CheckedImage; totalBytes: number }
export const VARIANTS = ['large', 'medium', 'thumb'] as const;
export type Variant = typeof VARIANTS[number];

const reject = (reason: string, message: string, extra: Record<string, unknown> = {}): never => { throw new DisplayAdError('VALIDATION_FAILED', message, { reason, ...extra }); };
const normMime = (m: string | undefined) => (m ?? '').trim().toLowerCase().replace(/^image\/jpg$/, 'image/jpeg').replace(/^image\/pjpeg$/, 'image/jpeg');
function extensionOf(name: string | undefined): string | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec((name ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** One part: real image bytes whose declared type and extension agree with them. */
function checkPart(part: UploadedPart | undefined, which: string): CheckedImage {
  if (!part || !part.buffer || part.buffer.length === 0) return reject('MISSING', which === 'original' ? 'Choose an image to upload.' : `The ${which} copy of the image is missing.`, { part: which });
  const buf = part.buffer;
  const kind = sniffImage(buf);
  if (!kind) return reject('UNSUPPORTED_TYPE', 'Only JPEG, PNG or WebP images can be used.', { part: which });
  const mime = KIND_MIME[kind];
  const declared = normMime(part.mimetype);
  if (declared && declared !== mime) return reject('MIME_MISMATCH', 'The file type does not match the file contents.', { part: which, declared, detected: mime });
  const ext = extensionOf(part.originalname);
  if (ext && EXT_KIND[ext] !== kind) return reject('EXTENSION_MISMATCH', 'The file name does not match the file contents.', { part: which, extension: ext, detected: mime });
  const info = imageInfo(buf, kind);
  if (!info) return reject('UNREADABLE', 'The image could not be read.', { part: which });
  const o = orientedSize(info);
  return { kind, mime, ext: KIND_EXT[kind], width: o.width, height: o.height, bytes: buf.length, buffer: buf };
}

/**
 * §70–§71: validate the original against the platform limits and each derivative against the original. Throws a
 * VALIDATION_FAILED (reason in details) or PAYLOAD_TOO_LARGE DisplayAdError; returns the checked parts.
 */
export function checkAdImageUpload(parts: Partial<Record<'original' | Variant, UploadedPart>>, limits: { maxFileBytes: number; allowedMimeTypes: readonly string[] }): CheckedUpload {
  const R = DISPLAY_AD_RULES;
  if (limits.allowedMimeTypes.length === 0) reject('NO_TYPES_ALLOWED', 'Image uploads are turned off for advertising right now.');
  const rawOriginal = parts.original;
  if (rawOriginal?.buffer && rawOriginal.buffer.length > limits.maxFileBytes) {
    throw new DisplayAdError('PAYLOAD_TOO_LARGE', `The image is larger than ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB.`, { reason: 'FILE_TOO_LARGE', maxBytes: limits.maxFileBytes });
  }
  const original = checkPart(rawOriginal, 'original');
  if (!limits.allowedMimeTypes.includes(original.mime)) reject('TYPE_NOT_ALLOWED', `${original.mime.replace('image/', '').toUpperCase()} images are not allowed. Allowed: ${limits.allowedMimeTypes.map((m) => m.replace('image/', '').toUpperCase()).join(', ')}.`);
  const long = Math.max(original.width, original.height), short = Math.min(original.width, original.height);
  if (long > R.image.maxEdge || original.width * original.height > R.image.maxPixels) reject('DIMENSIONS_TOO_LARGE', `The image is too large (${original.width}×${original.height}). Keep it under ${R.image.maxEdge} pixels per side.`);
  if (long < R.image.minLongEdge || short < R.image.minShortEdge) reject('TOO_SMALL', `The image is too small (${original.width}×${original.height}). Use at least ${R.image.minLongEdge} pixels on the long side.`);

  const ratio = original.width / original.height;
  const out: Partial<Record<Variant, CheckedImage>> = {};
  let prevLong = Infinity;
  for (const v of VARIANTS) {
    const c = checkPart(parts[v], v);
    const bound = R.derivatives[v];
    const cLong = Math.max(c.width, c.height);
    if (c.bytes > bound.maxBytes) reject('DERIVATIVE_TOO_LARGE', `The ${v} copy is larger than allowed.`, { part: v });
    if (cLong > bound.longEdge || cLong > long + 1 || cLong > prevLong) reject('DERIVATIVE_SIZE', `The ${v} copy has the wrong size.`, { part: v });
    // same shape as the original (either orientation: an EXIF-rotated original may be stored sideways); a 1 px rounding
    // allowance on the short side keeps tiny thumbnails of very wide images honest
    const r = c.width / c.height;
    const tol = 0.02 + 1 / Math.min(c.width, c.height);
    if (Math.abs(r - ratio) / ratio > tol && Math.abs(r - 1 / ratio) * ratio > tol) reject('DERIVATIVE_MISMATCH', `The ${v} copy is not the same picture shape as the original.`, { part: v });
    out[v] = c; prevLong = cLong;
  }
  // the displayed shape is the derivatives' (the browser applied EXIF orientation when it made them)
  const shown = out.large!;
  const sideways = Math.abs(shown.width / shown.height - ratio) / ratio > 0.02 + 1 / Math.min(shown.width, shown.height);
  const oriented = sideways ? { ...original, width: original.height, height: original.width } : original;
  const totalBytes = oriented.bytes + out.large!.bytes + out.medium!.bytes + out.thumb!.bytes;
  return { original: oriented, large: out.large!, medium: out.medium!, thumb: out.thumb!, totalBytes };
}

/** Storage keys. The original's key carries a random token so it cannot be derived from a derivative's public URL
 *  (the derivatives are the only copies a screen is ever given). */
export function adMediaKeys(mediaId: string, originalToken: string, u: CheckedUpload, tenantId?: string): Record<'original' | Variant, string> {
  // Phase 12 (#34): under the salon (`tenants/<id>/display-ads/…`) when the caller names it — older rows keep their keys
  const base = tenantId ? `tenants/${tenantId}/display-ads/${mediaId}` : `display-ads/${mediaId}`;
  return {
    original: `${base}/original-${originalToken}.${u.original.ext}`,
    large: `${base}/large.${u.large.ext}`,
    medium: `${base}/medium.${u.medium.ext}`,
    thumb: `${base}/thumb.${u.thumb.ext}`,
  };
}

/** A client-suggested point of interest (smart crop): any number 0–1, else the centre. */
export function focalOr(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 1000) / 1000 : 0.5;
}
