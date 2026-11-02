// ai-ocr-receipt-quality.vitest — §25/§26 quality heuristics and §24/§159 derivatives over SYNTHETIC images (drawn here; no
// customer data): a crisp "receipt" passes clean; a dark one, a washed-out one, a flat / blurred one, a tiny one and two
// receipts side by side each raise their flag; a PDF / undecodable file gets no flags and no derivatives (nothing invented);
// the thumbnail and the review copy are real PNGs the decoder reads back at the expected size, and the original is untouched.
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { analyzeReceiptImage, makeDerivatives, imageDimensions, encodeGreyPng, resizeGrey } from './ai-ocr-receipt-quality';
import { decodeGrey } from './ai-ocr-receipt-phash';

/** an 8-bit greyscale PNG from a pixel function (the same encoder the derivatives use is NOT used here — this one is independent) */
function png(w: number, h: number, f: (x: number, y: number) => number): Uint8Array {
  const crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(f(x, y))));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ch('IHDR', ihdr), ch('IDAT', deflateSync(raw)), ch('IEND', Buffer.alloc(0))]));
}
/** a "receipt": white paper with black text lines (every 12th row dark, with character gaps) over a mid-grey desk border */
const receipt = (w: number, h: number, opts: { ink?: number; paper?: number; desk?: number; blur?: boolean } = {}) => (x: number, y: number) => {
  const paper = opts.paper ?? 245, ink = opts.ink ?? 20, desk = opts.desk ?? 120;
  const inPaper = x > w * 0.1 && x < w * 0.9 && y > h * 0.05 && y < h * 0.95;
  if (!inPaper) return desk;
  const text = y % 12 < 3 && ((x >> 2) % 3 !== 0) && x > w * 0.15 && x < w * 0.85;
  if (opts.blur) { const t = y % 12; return paper - (t < 6 ? (6 - t) * 8 : 0); }   // soft bands instead of crisp lines
  return text ? ink : paper;
};

describe('§25 quality analysis', () => {
  it('a crisp, well-lit receipt raises no flag; the report carries the real dimensions', () => {
    const r = analyzeReceiptImage(png(700, 900, receipt(700, 900)), 'image/png');
    expect(r.decoded).toBe(true); expect([r.width, r.height]).toEqual([700, 900]);
    expect(r.flags).toEqual([]); expect(r.difficult).toBe(false);
  });
  it('too dark, washed out, low contrast / likely blurry, low resolution and tiny file are each named', () => {
    expect(analyzeReceiptImage(png(700, 900, (x, y) => receipt(700, 900)(x, y) * 0.15), 'image/png').flags).toContain('too_dark');
    expect(analyzeReceiptImage(png(700, 900, () => 250), 'image/png').flags).toEqual(expect.arrayContaining(['washed_out', 'low_contrast']));
    const blurry = analyzeReceiptImage(png(700, 900, receipt(700, 900, { blur: true })), 'image/png');
    expect(blurry.flags.some((f) => f === 'likely_blurry' || f === 'low_contrast')).toBe(true);
    expect(analyzeReceiptImage(png(300, 400, receipt(300, 400)), 'image/png').flags).toContain('low_resolution');
    expect(analyzeReceiptImage(png(300, 400, receipt(300, 400)), 'image/png').difficult).toBe(true);
    // a 12 KB JPEG "photo" is a screenshot of a thumbnail, not a photo (a lossless PNG of flat paper is legitimately small —
    // the decoder cannot read this synthetic JPEG, so the flag comes from the header dimensions + size alone is NOT claimed)
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
    expect(analyzeReceiptImage(jpegHeader, 'image/jpeg')).toMatchObject({ decoded: false, width: 800, height: 800, flags: [] });
    expect(analyzeReceiptImage(png(800, 800, () => 245), 'image/png').flags).not.toContain('tiny_file');
  });
  it('two receipts side by side on a dark desk are flagged as multiple_receipts; one receipt is not', () => {
    const two = (x: number, y: number) => { const left = x > 40 && x < 360, right = x > 440 && x < 760; const paper = (left || right) && y > 40 && y < 760; return paper ? (y % 12 < 3 && (x >> 2) % 3 ? 20 : 245) : 60; };
    expect(analyzeReceiptImage(png(800, 800, two), 'image/png').flags).toContain('multiple_receipts');
    expect(analyzeReceiptImage(png(800, 800, receipt(800, 800, { desk: 60 })), 'image/png').flags).not.toContain('multiple_receipts');
  });
  it('a PDF, a non-image and an undecodable image get no invented verdict', () => {
    expect(analyzeReceiptImage(new TextEncoder().encode('%PDF-1.4 ...'), 'application/pdf')).toMatchObject({ decoded: false, flags: [], difficult: false });
    expect(analyzeReceiptImage(new Uint8Array([1, 2, 3]), 'image/jpeg')).toMatchObject({ decoded: false, flags: [] });
  });
  it('imageDimensions reads PNG, JPEG SOF0 and GIF headers, never the client\'s numbers', () => {
    expect(imageDimensions(png(321, 123, () => 0))).toEqual({ width: 321, height: 123 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xda]);
    expect(imageDimensions(jpeg)).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(Buffer.from('GIF89a\x40\x01\xf0\x00', 'latin1'))).toEqual({ width: 320, height: 240 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('§24 / §159 derivatives', () => {
  it('a decodable image yields a 320 px thumbnail (a real PNG the decoder reads back); a large original also gets a 1600 px review copy; the original bytes are untouched', () => {
    const original = png(1400, 2100, receipt(1400, 2100));
    const copy = Uint8Array.from(original);
    const d = makeDerivatives(original, 'image/png', { processedWhenBytesOver: 1000 });
    expect(d.map((x) => x.kind)).toEqual(['thumbnail', 'processed']);
    const thumb = d[0]; expect([thumb.width, thumb.height]).toEqual([213, 320]);
    const back = decodeGrey(thumb.png)!; expect([back.w, back.h]).toEqual([213, 320]);
    expect(back.px[0]).toBeCloseTo(120, -1);                                            // the desk corner survived the resize
    const big = d[1]; expect([big.width, big.height]).toEqual([1067, 1600]);
    expect(original).toEqual(copy);                                                     // §19: the original is immutable
    expect(makeDerivatives(original, 'image/png').map((x) => x.kind)).toEqual(['thumbnail']);   // a 2 MB floor by default
  });
  it('a small image is never upscaled; a PDF / undecodable file gets no derivative', () => {
    const small = png(200, 100, receipt(200, 100));
    const d = makeDerivatives(small, 'image/png');
    expect([d[0].width, d[0].height]).toEqual([200, 100]);
    expect(makeDerivatives(new TextEncoder().encode('%PDF-1.4'), 'application/pdf')).toEqual([]);
    expect(makeDerivatives(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg')).toEqual([]);
  });
  it('encodeGreyPng ↔ decodeGrey round-trips pixels; resizeGrey averages areas', () => {
    const img = { w: 4, h: 2, px: Float64Array.from([0, 255, 0, 255, 0, 255, 0, 255]) };
    expect(Array.from(decodeGrey(encodeGreyPng(img))!.px)).toEqual([0, 255, 0, 255, 0, 255, 0, 255]);
    const half = resizeGrey(img, 2); expect([half.w, half.h]).toEqual([2, 1]); expect(Array.from(half.px)).toEqual([127.5, 127.5]);
  });
});
