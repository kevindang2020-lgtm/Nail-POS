// ai-ocr-receipt-phash.vitest.spec.ts — §31 (Oct 27 2026): the dependency-free perceptual hash. Fixtures (__fixtures__/phash)
// were made with Pillow from one synthetic receipt `a` and a different document `b`; the expected hash is Pillow's own dHash
// of a.png (grey, BOX-resized to 9 × 8, left > right), so the decoders are checked against an independent implementation.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { perceptualHashOf, perceptualHashDetailed, decodeGrey, dHash } from './ai-ocr-receipt-phash';
import { hammingDistance } from './ai-ocr-receipt-dedup';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', 'phash', n)));
const PILLOW_DHASH_A = 'c0c6868682828280';

describe('perceptualHashOf', () => {
  it('PNG (RGB and 16-colour palette) equals Pillow\'s dHash of the same image', () => {
    expect(perceptualHashOf(fx('a.png'))).toBe(PILLOW_DHASH_A);
    expect(perceptualHashOf(fx('a-palette.png'))).toBe(PILLOW_DHASH_A);
  });
  it('baseline JPEG from the luma DC terms alone: 4:2:0, 4:4:4, greyscale (one component) and with restart markers all give the same hash as the PNG', () => {
    for (const f of ['a.jpg', 'a-444.jpg', 'a-grey.jpg', 'a-restart.jpg']) expect(perceptualHashOf(fx(f)), f).toBe(PILLOW_DHASH_A);
  });
  it('a re-photographed copy (85 % size, 8 % brighter, quality 55) is within the dedup\'s "likely" distance; a different receipt is far', () => {
    expect(hammingDistance(PILLOW_DHASH_A, perceptualHashOf(fx('a-rephoto.jpg')))).toBeLessThanOrEqual(6);
    expect(hammingDistance(PILLOW_DHASH_A, perceptualHashOf(fx('b.jpg')))).toBeGreaterThan(12);
  });
  it('honest null: progressive JPEG, PDF, garbage, truncated files — never a throw', () => {
    expect(perceptualHashOf(fx('a-progressive.jpg'))).toBeNull();
    expect(perceptualHashOf(new TextEncoder().encode('%PDF-1.7 x'))).toBeNull();
    expect(perceptualHashOf(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 2]))).toBeNull();
    expect(perceptualHashOf(fx('a.jpg').slice(0, 300))).toBeNull();
    expect(perceptualHashOf(fx('a.png').slice(0, 60))).toBeNull();
    expect(perceptualHashOf(new Uint8Array(0))).toBeNull();
    expect(perceptualHashDetailed(fx('a-progressive.jpg')).reason).toBe('unsupported');
    expect(perceptualHashDetailed(fx('a.jpg').slice(0, 300)).reason).toMatch(/^undecodable|^unsupported/);
  });
  it('dHash: flat images hash to zero (near-ties are 0), a left-to-right gradient sets every bit, tiny images still hash', () => {
    expect(dHash({ w: 20, h: 20, px: new Float64Array(400).fill(200) })).toBe('0000000000000000');
    const grad = new Float64Array(90); for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) grad[y * 9 + x] = 255 - x * 30;
    expect(dHash({ w: 9, h: 10, px: grad })).toBe('ffffffffffffffff');
    expect(dHash({ w: 2, h: 1, px: new Float64Array([255, 0]) })).toMatch(/^[0-9a-f]{16}$/);
  });
  it('decodeGrey keeps the picture\'s proportions (JPEG: one value per 8 × 8 block)', () => {
    expect(decodeGrey(fx('a.png'))).toMatchObject({ w: 160, h: 260 });
    expect(decodeGrey(fx('a.jpg'))).toMatchObject({ w: 20, h: 33 });
  });
});
