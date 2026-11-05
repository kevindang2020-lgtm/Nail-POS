// display-ads-media-core.vitest.spec.ts — §68–§71, §77: the bytes decide what an uploaded ad image is. Real PNGs (pngjs)
// and byte-exact JPEG / WebP headers: type by magic bytes, declared MIME and extension must agree, dimensions read from
// the header (EXIF orientation honoured) before anything decodes, and the three derivatives must be the same picture shape.
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { adMediaKeys, checkAdImageUpload, focalOr, imageInfo, orientedSize, sniffImage, type UploadedPart } from './display-ads-media-core';
import type { DisplayAdError } from './display-ads-core';

const png = (w: number, h: number) => new Uint8Array(PNG.sync.write(new PNG({ width: w, height: h })));
const part = (buffer: Uint8Array, mimetype: string, originalname: string): UploadedPart => ({ buffer, mimetype, originalname, size: buffer.length });
const LIMITS = { maxFileBytes: 8 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] };
const err = (fn: () => unknown) => { try { fn(); } catch (e) { return e as DisplayAdError; } throw new Error('expected a DisplayAdError'); };

/** A minimal JPEG: SOI, an EXIF APP1 carrying `orientation`, an SOF0 frame header with the size, EOI. */
function jpeg(w: number, h: number, orientation = 1): Uint8Array {
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
  const app1 = [0xff, 0xe1, 0, exif.length + 2, ...exif];
  const sof = [0xff, 0xc0, 0, 17, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9]);
}
const riff = (fourcc: string, payload: number[]) => {
  const chunk = [...Buffer.from(fourcc), payload.length & 0xff, (payload.length >> 8) & 0xff, 0, 0, ...payload];
  const size = 4 + chunk.length;
  return new Uint8Array([...Buffer.from('RIFF'), size & 0xff, (size >> 8) & 0xff, 0, 0, ...Buffer.from('WEBP'), ...chunk, 0, 0]);
};
const webpVP8X = (w: number, h: number) => riff('VP8X', [0, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, ((w - 1) >> 16) & 0xff, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, ((h - 1) >> 16) & 0xff]);
const webpVP8 = (w: number, h: number) => riff('VP8 ', [0x10, 0x02, 0, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f]);
function webpVP8L(w: number, h: number) {
  const bits = ((w - 1) | ((h - 1) << 14)) >>> 0;
  return riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]);
}

describe('magic bytes and header dimensions (§70)', () => {
  it('PNG', () => { const b = png(640, 960); expect(sniffImage(b)).toBe('png'); expect(imageInfo(b, 'png')).toEqual({ width: 640, height: 960, orientation: 1 }); });
  it('JPEG with EXIF orientation 6 — displayed sideways', () => {
    const b = jpeg(4032, 3024, 6);
    expect(sniffImage(b)).toBe('jpeg');
    expect(imageInfo(b, 'jpeg')).toEqual({ width: 4032, height: 3024, orientation: 6 });
    expect(orientedSize(imageInfo(b, 'jpeg')!)).toEqual({ width: 3024, height: 4032 });
    expect(imageInfo(jpeg(800, 600), 'jpeg')).toEqual({ width: 800, height: 600, orientation: 1 });
  });
  it('WebP: lossy (VP8), lossless (VP8L) and extended (VP8X)', () => {
    for (const [b, w, h] of [[webpVP8(1080, 1620), 1080, 1620], [webpVP8L(720, 1080), 720, 1080], [webpVP8X(1920, 1080), 1920, 1080]] as const) {
      expect(sniffImage(b)).toBe('webp');
      expect(imageInfo(b, 'webp')).toMatchObject({ width: w, height: h });
    }
  });
  it('anything else is not an image', () => {
    for (const s of ['<!doctype html><html><script>alert(1)</script>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'GIF89a............', '%PDF-1.7 ...............', 'MZ\x90\x00 an exe ..........']) {
      expect(sniffImage(new Uint8Array(Buffer.from(s)))).toBeNull();
    }
  });
  it('a truncated header is unreadable, not a crash', () => {
    expect(imageInfo(jpeg(800, 600).slice(0, 12), 'jpeg')).toBeNull();
    expect(imageInfo(png(10, 10).slice(0, 20), 'png')).toBeNull();
  });
});

describe('checkAdImageUpload — original + three derivatives (§70–§71)', () => {
  const good = () => ({
    original: part(png(1080, 1620), 'image/png', 'fall-promo.png'),
    large: part(png(1080, 1620), 'image/png', 'large.png'),
    medium: part(png(720, 1080), 'image/png', 'medium.png'),
    thumb: part(png(213, 320), 'image/png', 'thumb.png'),
  });
  it('accepts a real image and its copies, and reports the displayed size and total bytes', () => {
    const g = good();
    const u = checkAdImageUpload(g, LIMITS);
    expect(u.original).toMatchObject({ kind: 'png', mime: 'image/png', ext: 'png', width: 1080, height: 1620 });
    expect(u.medium).toMatchObject({ width: 720, height: 1080 });
    expect(u.totalBytes).toBe(g.original.buffer.length + g.large.buffer.length + g.medium.buffer.length + g.thumb.buffer.length);
  });
  it('§77: an HTML page or SVG named .png is refused by its bytes', () => {
    const g = good();
    g.original = part(new Uint8Array(Buffer.from('<!doctype html><script>alert(1)</script>'.padEnd(64, ' '))), 'image/png', 'promo.png');
    expect(err(() => checkAdImageUpload(g, LIMITS))).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'UNSUPPORTED_TYPE', part: 'original' } });
  });
  it('the declared MIME and the extension must agree with the bytes', () => {
    const a = good(); a.original = part(png(1080, 1620), 'image/jpeg', 'x.png');
    expect(err(() => checkAdImageUpload(a, LIMITS)).details).toMatchObject({ reason: 'MIME_MISMATCH' });
    const b = good(); b.original = part(png(1080, 1620), 'image/png', 'x.html');
    expect(err(() => checkAdImageUpload(b, LIMITS)).details).toMatchObject({ reason: 'EXTENSION_MISMATCH' });
    const c = good(); c.original = part(png(1080, 1620), 'image/png', 'no-extension');
    expect(() => checkAdImageUpload(c, LIMITS)).not.toThrow();
  });
  it('size: over the platform limit is 413; types the platform does not allow are refused', () => {
    const g = good();
    expect(err(() => checkAdImageUpload(g, { ...LIMITS, maxFileBytes: g.original.buffer.length - 1 }))).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', details: { reason: 'FILE_TOO_LARGE' } });
    expect(err(() => checkAdImageUpload(good(), { ...LIMITS, allowedMimeTypes: ['image/jpeg'] })).details).toMatchObject({ reason: 'TYPE_NOT_ALLOWED' });
    expect(err(() => checkAdImageUpload(good(), { ...LIMITS, allowedMimeTypes: [] })).details).toMatchObject({ reason: 'NO_TYPES_ALLOWED' });
  });
  it('dimensions: too small refused; a decompression bomb is refused from its header alone', () => {
    const small = good(); small.original = part(png(500, 400), 'image/png', 's.png');
    expect(err(() => checkAdImageUpload(small, LIMITS)).details).toMatchObject({ reason: 'TOO_SMALL' });
    const bomb = good(); bomb.original = part(jpeg(30000, 30000), 'image/jpeg', 'bomb.jpg');   // 900 MP declared in 60 bytes
    expect(err(() => checkAdImageUpload(bomb, LIMITS)).details).toMatchObject({ reason: 'DIMENSIONS_TOO_LARGE' });
  });
  it('each derivative: present, a real image, within its bound and byte cap, and the same picture', () => {
    const missing = good(); delete (missing as any).thumb;
    expect(err(() => checkAdImageUpload(missing, LIMITS)).details).toMatchObject({ reason: 'MISSING', part: 'thumb' });
    const big = good(); big.medium = part(png(1400, 2100), 'image/png', 'medium.png');   // medium must be ≤ 1080 px
    expect(err(() => checkAdImageUpload(big, LIMITS)).details).toMatchObject({ reason: 'DERIVATIVE_SIZE', part: 'medium' });
    const other = good(); other.large = part(png(1620, 1080), 'image/png', 'large.png');   // the same pixels count, but landscape…
    expect(() => checkAdImageUpload(other, LIMITS)).not.toThrow();                         // …is allowed: it is the rotated picture
    const wrong = good(); wrong.medium = part(png(1080, 1080), 'image/png', 'medium.png');   // a square is not this picture
    expect(err(() => checkAdImageUpload(wrong, LIMITS)).details).toMatchObject({ reason: 'DERIVATIVE_MISMATCH', part: 'medium' });
    const order = good(); order.thumb = part(png(320, 480), 'image/png', 'thumb.png');   // 480 > the 320 px thumbnail bound
    expect(err(() => checkAdImageUpload(order, LIMITS)).details).toMatchObject({ part: 'thumb' });
  });
  it('an EXIF-rotated phone photo: the copies (made upright by the browser) set the displayed shape', () => {
    const u = checkAdImageUpload({
      original: part(jpeg(4032, 3024, 6), 'image/jpeg', 'IMG_0001.JPG'),
      large: part(png(1440, 1920), 'image/png', 'large.png'), medium: part(png(810, 1080), 'image/png', 'medium.png'), thumb: part(png(240, 320), 'image/png', 'thumb.png'),
    }, LIMITS);
    expect(u.original).toMatchObject({ mime: 'image/jpeg', width: 3024, height: 4032 });
  });
});

describe('storage keys', () => {
  it('the original\'s key carries a token no public URL reveals; the copies are named for what they are', () => {
    const u = checkAdImageUpload({
      original: part(png(1080, 1620), 'image/png', 'a.png'), large: part(png(1080, 1620), 'image/png', 'l.png'),
      medium: part(png(720, 1080), 'image/png', 'm.png'), thumb: part(png(213, 320), 'image/png', 't.png'),
    }, LIMITS);
    const k = adMediaKeys('m-1', 'f00dfeed', u);
    expect(k).toEqual({ original: 'display-ads/m-1/original-f00dfeed.png', large: 'display-ads/m-1/large.png', medium: 'display-ads/m-1/medium.png', thumb: 'display-ads/m-1/thumb.png' });
    // Phase 12 (#34): a new upload's keys sit under its salon
    expect(adMediaKeys('m-1', 'f00dfeed', u, 't-9').thumb).toBe('tenants/t-9/display-ads/m-1/thumb.png');
    expect(Object.values(k).filter((x) => x.includes('f00dfeed'))).toHaveLength(1);
  });
  it('a suggested focus point is a number 0–1, else the centre', () => {
    expect([focalOr('0.25'), focalOr(0.3333), focalOr('x'), focalOr(-1), focalOr(undefined)]).toEqual([0.25, 0.333, 0.5, 0.5, 0.5]);
  });
});
