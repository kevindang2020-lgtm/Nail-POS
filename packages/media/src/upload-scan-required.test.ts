// Security Deep Scan E5: in production an unscanned DOCUMENT is refused (never stored as trusted); images may be unscanned.
import { describe, it, expect } from 'vitest';
import { requiresScan } from './upload-policy';
describe('requiresScan', () => {
  it('production: documents need a scan, images do not; dev/test and the explicit opt-out never require it', () => {
    const prod = { NODE_ENV: 'production' } as any;
    for (const k of ['pdf', 'text', 'mp4', 'tiff', 'heic'] as const) expect(requiresScan(k, prod), k).toBe(true);
    for (const k of ['jpeg', 'png', 'webp', 'gif'] as any[]) expect(requiresScan(k, prod), k).toBe(false);
    expect(requiresScan('pdf', { NODE_ENV: 'test' } as any)).toBe(false);
    expect(requiresScan('pdf', { NODE_ENV: 'production', UNSCANNED_DOCUMENTS: 'allow' } as any)).toBe(false);
  });
});

describe('Security Deep Scan §104 / §106: unscanned images', () => {
  const imgs = ['jpeg', 'png', 'webp', 'gif'] as any[];
  it('once a scanner is deployed (CLAMAV_HOST), an image needs a scan too — an AV outage refuses instead of storing it unscanned', () => {
    for (const k of imgs) expect(requiresScan(k, { NODE_ENV: 'production', CLAMAV_HOST: 'clamav.internal' } as any), k).toBe(true);
  });
  it('UNSCANNED_IMAGES=refuse forces it without a scanner; =allow is the explicit opt-out; dev / test never', () => {
    for (const k of imgs) expect(requiresScan(k, { NODE_ENV: 'production', UNSCANNED_IMAGES: 'refuse' } as any), k).toBe(true);
    for (const k of imgs) expect(requiresScan(k, { NODE_ENV: 'production', CLAMAV_HOST: 'clamav.internal', UNSCANNED_IMAGES: 'allow' } as any), k).toBe(false);
    expect(requiresScan('png', { NODE_ENV: 'test', CLAMAV_HOST: 'x' } as any)).toBe(false);
  });
  it('documents are unchanged by the image switches', () => {
    expect(requiresScan('pdf', { NODE_ENV: 'production', UNSCANNED_IMAGES: 'allow' } as any)).toBe(true);
    expect(requiresScan('pdf', { NODE_ENV: 'production', UNSCANNED_DOCUMENTS: 'allow', UNSCANNED_IMAGES: 'refuse' } as any)).toBe(false);
  });
});
