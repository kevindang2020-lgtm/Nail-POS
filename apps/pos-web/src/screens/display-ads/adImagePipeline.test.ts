// adImagePipeline.test.ts — the browser half of §68–§71: the optimized copies' sizes, smart crop's point of interest, and
// the pre-checks that mirror the server (the server still re-checks everything — these only save a long upload).
import { describe, it, expect } from 'vitest';
import { fitWithin, interestPoint, precheck, shapeWarnings } from './adImagePipeline';

describe('fitWithin — a copy keeps the shape and is never enlarged', () => {
  it.each([
    [4000, 6000, 1920, { width: 1280, height: 1920 }], [4000, 6000, 1080, { width: 720, height: 1080 }], [4000, 6000, 320, { width: 213, height: 320 }],
    [1920, 1080, 1080, { width: 1080, height: 608 }], [800, 1200, 1920, { width: 800, height: 1200 }], [3000, 3, 320, { width: 320, height: 1 }],
  ])('%i×%i within %i', (w, h, edge, out) => { expect(fitWithin(w, h, edge)).toEqual(out); });
});

describe('interestPoint — where smart crop centres', () => {
  const grid = (w: number, h: number, paint: (x: number, y: number) => number) => { const g: number[] = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.push(paint(x, y)); return g; };
  it('a plain image → the centre', () => { expect(interestPoint(grid(40, 40, () => 128), 40, 40)).toEqual({ x: 0.5, y: 0.5 }); });
  it('detail in the lower right pulls the point there (but not to the very edge)', () => {
    const p = interestPoint(grid(40, 40, (x, y) => (x > 26 && y > 26 && (x + y) % 2 ? 255 : 0)), 40, 40);
    expect(p.x).toBeGreaterThan(0.6); expect(p.y).toBeGreaterThan(0.6);
    expect(p.x).toBeLessThanOrEqual(0.9); expect(p.y).toBeLessThanOrEqual(0.9);
  });
  it('detail in the upper left pulls it up-left', () => {
    const p = interestPoint(grid(40, 40, (x, y) => (x < 10 && y < 10 && (x + y) % 2 ? 255 : 0)), 40, 40);
    expect(p.x).toBeLessThan(0.4); expect(p.y).toBeLessThan(0.4);
  });
});

describe('precheck — the server\'s rules, asked first', () => {
  const L = { maxFileBytes: 8 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] };
  it('accepts the three formats', () => { for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(precheck({ type, size: 1000, name: 'a' }, L)).toBeNull(); });
  it('refuses others, empty and oversized files, and types the platform disallows', () => {
    expect(precheck({ type: 'image/heic', size: 1000, name: 'IMG.HEIC' }, L)).toMatch(/JPEG, PNG or WebP/);
    expect(precheck({ type: 'image/svg+xml', size: 1000, name: 'a.svg' }, L)).toMatch(/JPEG, PNG or WebP/);
    expect(precheck({ type: 'text/html', size: 1000, name: 'a.html' }, L)).toMatch(/JPEG, PNG or WebP/);
    expect(precheck({ type: 'image/png', size: 0, name: 'a.png' }, L)).toMatch(/empty/);
    expect(precheck({ type: 'image/png', size: 9 * 1024 * 1024, name: 'a.png' }, L)).toMatch(/8 MB/);
    expect(precheck({ type: 'image/webp', size: 10, name: 'a.webp' }, { ...L, allowedMimeTypes: ['image/jpeg'] })).toMatch(/not allowed/);
  });
});

describe('shapeWarnings — §55–§56 template guidance', () => {
  it('a landscape image for the tall panel, or a small one, gets advice; a 2:3 portrait gets none', () => {
    expect(shapeWarnings(1080, 1620, 'panel')).toEqual([]);
    expect(shapeWarnings(1920, 1080, 'panel')[0]).toMatch(/landscape/);
    expect(shapeWarnings(600, 900, 'panel')[0]).toMatch(/1080 × 1620/);
    expect(shapeWarnings(1920, 1080, 'fullscreen')).toEqual([]);
    expect(shapeWarnings(1080, 1620, 'fullscreen')[0]).toMatch(/16:9/);
  });
});
