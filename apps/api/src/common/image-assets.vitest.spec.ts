// image-assets.vitest.spec.ts — every image the UI references must actually exist.
//
// A missing image is a silent failure of the worst kind: the build succeeds, the tests pass, and the only person
// who finds out is a customer looking at a broken-image icon on the sign-in screen. Nothing in the toolchain
// checks that a string in a `src=` corresponds to a file on disk.
//
// So: read the source, collect every `/brand/...` path, and assert the file is there.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const APPS = join(__dirname, '../../..');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    else if (/\.(tsx|ts)$/.test(e) && !/\.(spec|test)\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const WEB_APPS = ['pos-web', 'customer-web', 'admin-web', 'owner-web', 'tech-web', 'manager-pay-web'];

describe('no broken or placeholder image paths', () => {
  for (const app of WEB_APPS) {
    it(`${app}: every /brand/ image referenced in code exists on disk`, () => {
      const src = walk(join(APPS, app, 'src'));
      const missing: string[] = [];

      for (const f of src) {
        const text = readFileSync(f, 'utf8');
        for (const m of text.matchAll(/["'`](\/brand\/[a-z0-9._-]+\.(?:jpg|jpeg|png|webp|avif|svg))["'`]/gi)) {
          const rel = m[1];
          if (!existsSync(join(APPS, app, 'public', rel))) {
            missing.push(`${rel}  (referenced in ${f.replace(APPS, '')})`);
          }
        }
      }

      expect(
        missing,
        `These images are referenced in code but do not exist. The build succeeds, the tests pass, and a ` +
        `customer sees a broken-image icon on the sign-in screen.\n\n${missing.join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('the salon imagery is present and responsive', () => {
  it('pos-web has every srcset variant it advertises', () => {
    for (const w of [700, 1000, 1400]) {
      for (const ext of ['jpg', 'webp']) {
        expect(existsSync(join(APPS, `pos-web/public/brand/salon-interior-${w}.${ext}`)), `salon-interior-${w}.${ext}`).toBe(true);
      }
    }
  });

  it('customer-web has every srcset variant it advertises', () => {
    for (const w of [480, 760, 1080]) {
      for (const ext of ['jpg', 'webp']) {
        expect(existsSync(join(APPS, `customer-web/public/brand/salon-bg-${w}.${ext}`)), `salon-bg-${w}.${ext}`).toBe(true);
      }
    }
  });

  it('WebP is genuinely smaller than the JPEG it replaces — otherwise it is just extra bytes', () => {
    const jpg = statSync(join(APPS, 'pos-web/public/brand/salon-interior-1000.jpg')).size;
    const webp = statSync(join(APPS, 'pos-web/public/brand/salon-interior-1000.webp')).size;
    expect(webp).toBeLessThan(jpg * 0.7);
  });

  it('no single asset is heavy enough to hurt a phone on mobile data', () => {
    for (const p of ['customer-web/public/brand/salon-bg-480.webp', 'customer-web/public/brand/salon-bg-760.webp']) {
      expect(statSync(join(APPS, p)).size, p).toBeLessThan(80 * 1024);
    }
  });
});
