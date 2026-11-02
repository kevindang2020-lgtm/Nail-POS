// upload-fixtures.ts — BUILD_PLAN Phase 12 (#34): files for the upload-route tests. A walkable JPEG whose EXIF carries a
// "GPS" marker (the thing the upload policy must strip from a public picture), and markup disguised as an image.
const B = (...parts: Array<number[] | string | Uint8Array>) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p as any))));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

/** The marker the EXIF block carries — a stored file must not contain it. */
export const EXIF_GPS_MARKER = 'GPS-SECRET-40.7128N';

/** A small, header-valid JPEG (SOI, EXIF APP1 with orientation + the GPS marker, SOF0 w×h, SOS, data, EOI). */
export function exifJpeg(w = 64, h = 48, orientation = 1): Buffer {
  const tiff = B('MM', [0, 0x2a], be32(8), be16(1), be16(0x0112), be16(3), be32(1), be16(orientation), [0, 0], be32(0), EXIF_GPS_MARKER);
  const app1 = B([0xff, 0xe1], be16(2 + 6 + tiff.length), 'Exif', [0, 0], tiff);
  const sof = B([0xff, 0xc0], be16(11), [8], be16(h), be16(w), [1, 1, 0x11, 0]);
  const sos = B([0xff, 0xda], be16(8), [1, 1, 0, 0, 0x3f, 0]);
  return B([0xff, 0xd8], app1, sof, sos, Buffer.alloc(32, 7), [0xff, 0xd9]);
}

/** An HTML page — what a hostile client uploads as "photo.jpg" / image/jpeg. */
export const htmlAsImage = (): Buffer => Buffer.from('<!doctype html><script>alert(document.cookie)</script>'.padEnd(96, ' '));

/** A valid w×h RGB PNG (signature, IHDR, one zlib IDAT, IEND, real CRCs) — decodable, so the upload policy's dimension
 *  read accepts it. Oct 20 2026: the harnesses used "magic bytes + zero padding", which the policy now refuses
 *  ("The image could not be read.") — correctly. */
export function tinyPng(w = 8, h = 8): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { deflateSync } = require('node:zlib') as typeof import('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x7f); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;   // filter byte 0 per row
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
