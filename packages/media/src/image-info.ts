// image-info.ts — what an uploaded image REALLY is, from its bytes. PURE (no decode, no native library).
//
// The type is sniffed from the leading bytes (JPEG / PNG / WebP — never SVG, which can carry script), and the
// dimensions are read from the image header itself (JPEG SOF + EXIF orientation, PNG IHDR, WebP VP8/VP8L/VP8X), so a
// script renamed .png is refused and a 40,000-pixel "decompression bomb" is refused before anything decodes it.
// Shared by every upload that lands in the public media store: advertising images (modules/marketing) and the salon
// logo (modules/tenants). Moved here from the advertising module (Oct 2026) so the two do not keep two parsers.

export type ImageKind = 'jpeg' | 'png' | 'webp';
export const KIND_MIME: Readonly<Record<ImageKind, string>> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const KIND_EXT: Readonly<Record<ImageKind, string>> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
/** A file-name extension → the image kind it claims. */
export const EXT_KIND: Readonly<Record<string, ImageKind>> = { jpg: 'jpeg', jpeg: 'jpeg', jpe: 'jpeg', jfif: 'jpeg', png: 'png', webp: 'webp' };

const ascii = (b: Uint8Array, at: number, s: string) => b.length >= at + s.length && [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

/** The image type by its leading bytes, or null. */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (!b || b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
  return null;
}

export interface ImageInfo { width: number; height: number; /** EXIF orientation 1–8 (1 when absent). */ orientation: number }

/** EXIF orientation from a JPEG APP1 payload starting at `at` ("Exif\0\0" + TIFF). 1 when absent or unreadable. */
function exifOrientation(b: Uint8Array, at: number, end: number): number {
  if (!ascii(b, at, 'Exif') || b[at + 4] !== 0 || b[at + 5] !== 0) return 1;
  const t = at + 6;
  if (t + 8 > end) return 1;
  const le = ascii(b, t, 'II'); if (!le && !ascii(b, t, 'MM')) return 1;
  const r16 = (i: number) => (le ? u16le(b, i) : u16be(b, i));
  const r32 = (i: number) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000 : u32be(b, i));
  if (r16(t + 2) !== 42) return 1;
  const ifd = t + r32(t + 4);
  if (ifd + 2 > end) return 1;
  const n = r16(ifd);
  for (let k = 0; k < n && ifd + 2 + k * 12 + 12 <= end; k++) {
    const e = ifd + 2 + k * 12;
    if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}

function jpegInfo(b: Uint8Array): ImageInfo | null {
  let i = 2; let orientation = 1;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i < b.length) i++;            // fill bytes
    const marker = b[i]; i++;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;   // no length
    if (marker === 0xd9 || marker === 0xda) return null;   // end / start-of-scan before any frame header
    if (i + 2 > b.length) return null;
    const len = u16be(b, i);
    if (len < 2 || i + len > b.length) return null;
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(b, i + 2, i + len);   // the EXIF APP1 (an XMP APP1 reads as 1)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (len < 7) return null;
      const height = u16be(b, i + 3), width = u16be(b, i + 5);
      return width > 0 && height > 0 ? { width, height, orientation } : null;
    }
    i += len;
  }
  return null;
}

function pngInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
  const width = u32be(b, 16), height = u32be(b, 20);
  return width > 0 && height > 0 ? { width, height, orientation: 1 } : null;
}

function webpInfo(b: Uint8Array): ImageInfo | null {
  if (ascii(b, 12, 'VP8 ')) {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = u16le(b, 26) & 0x3fff, height = u16le(b, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height, orientation: 1 } : null;
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height, orientation: 1 };
  }
  if (ascii(b, 12, 'VP8X')) return b.length < 30 ? null : { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27), orientation: 1 };
  return null;
}

/** Dimensions read from the header (no decode). null when the header is malformed. */
export function imageInfo(b: Uint8Array, kind: ImageKind): ImageInfo | null {
  try { return kind === 'jpeg' ? jpegInfo(b) : kind === 'png' ? pngInfo(b) : webpInfo(b); } catch { return null; }
}
/** As displayed: EXIF orientations 5–8 rotate the picture a quarter turn. */
export const orientedSize = (i: ImageInfo) => (i.orientation >= 5 ? { width: i.height, height: i.width } : { width: i.width, height: i.height });
