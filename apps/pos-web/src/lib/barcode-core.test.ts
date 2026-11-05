import { describe, it, expect, afterEach, vi } from 'vitest';
import { extractCardNumber, scannerSupported } from './barcode-core';

describe('extractCardNumber', () => {
  it('returns a plain 16-digit number', () => {
    expect(extractCardNumber('4827193655028411')).toBe('4827193655028411');
  });
  it('tolerates spaces and dashes printed on the card', () => {
    expect(extractCardNumber('4827 1936 5502 8411')).toBe('4827193655028411');
    expect(extractCardNumber('4827-1936-5502-8411')).toBe('4827193655028411');
  });
  it('passes through a card code', () => {
    expect(extractCardNumber('GC-ABC1234')).toBe('GC-ABC1234');
  });
  it('rejects payloads that are not a 16-digit number or a code', () => {
    expect(extractCardNumber('12345')).toBeNull();
    expect(extractCardNumber('https://example.com/promo')).toBeNull();
    expect(extractCardNumber('')).toBeNull();
    expect(extractCardNumber('   ')).toBeNull();
  });
});

describe('scannerSupported', () => {
  const g = globalThis as any;
  afterEach(() => { delete g.BarcodeDetector; vi.unstubAllGlobals(); });

  it('is false without BarcodeDetector', () => {
    delete g.BarcodeDetector;
    expect(scannerSupported()).toBe(false);
  });
  it('is true with BarcodeDetector + getUserMedia', () => {
    g.BarcodeDetector = function () {};
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve({}) } });
    expect(scannerSupported()).toBe(true);
  });
  it('is false when the camera API is missing even if BarcodeDetector exists', () => {
    g.BarcodeDetector = function () {};
    vi.stubGlobal('navigator', {});
    expect(scannerSupported()).toBe(false);
  });
});
