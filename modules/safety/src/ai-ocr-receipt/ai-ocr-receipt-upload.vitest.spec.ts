// ai-ocr-receipt-upload.vitest.spec.ts — secure upload validation. File type is validated by magic bytes (not the
// extension), filenames are sanitized, storage keys are tenant-scoped, and an absent malware scanner yields 'unscanned'
// (quarantined when the tenant requires scanning) — never a false 'clean'.
import { describe, it, expect } from 'vitest';
import { detectFileType, sanitizeFilename, validateUpload, storageKeyFor, resolveScanDisposition, DisconnectedMalwareScanner } from './ai-ocr-receipt-upload';
import { PLATFORM_DEFAULTS } from './ai-ocr-receipt-settings';

const bytes = (...a: number[]) => Uint8Array.from(a);
const ascii = (s: string) => Uint8Array.from(s.split('').map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0, 0, 0]));

describe('magic-byte detection + filename sanitization', () => {
  it('detects types by content', () => {
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0)).kind).toBe('jpeg');
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47)).kind).toBe('png');
    expect(detectFileType(ascii('%PDF-1.7')).kind).toBe('pdf');
    expect(detectFileType(Uint8Array.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])).kind).toBe('heic');
    expect(detectFileType(bytes(0, 1, 2, 3)).kind).toBe('unknown');
  });
  it('sanitizes filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('re\u0000ceipt<>.jpg')).toBe('receipt.jpg');
    expect(sanitizeFilename('')).toBe('upload');
  });
});

describe('upload validation + storage keys', () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0);
  it('accepts valid files and rejects unsafe ones', () => {
    expect(validateUpload({ filename: 'r.png', declaredMime: 'image/png', sizeBytes: 5000, headerBytes: png }, PLATFORM_DEFAULTS).ok).toBe(true);
    expect(validateUpload({ filename: 'r.png', sizeBytes: 0, headerBytes: png }, PLATFORM_DEFAULTS).errors).toContain('EMPTY_FILE');
    expect(validateUpload({ filename: 'x.exe', sizeBytes: 100, headerBytes: bytes(0x4d, 0x5a, 0, 0) }, PLATFORM_DEFAULTS).errors).toContain('UNKNOWN_TYPE');
    expect(validateUpload({ filename: 'r.png', declaredMime: 'image/png', sizeBytes: 100, headerBytes: bytes(0xff, 0xd8, 0xff, 0xe0) }, PLATFORM_DEFAULTS).errors).toContain('MIME_MISMATCH');
    expect(validateUpload({ filename: 'r.pdf', sizeBytes: 100, headerBytes: ascii('%PDF'), pageCount: 9999 }, PLATFORM_DEFAULTS).errors).toContain('TOO_MANY_PAGES');
    expect(validateUpload({ filename: 'r.png', sizeBytes: 100, headerBytes: png, width: 50000, height: 50000 }, PLATFORM_DEFAULTS).errors).toContain('DECOMPRESSION_BOMB');
  });
  it('builds tenant-scoped keys', () => {
    expect(storageKeyFor('T1', 'D1', 'original', 'pdf')).toBe('tenants/T1/documents/D1/original.pdf');
    expect(storageKeyFor('T1', 'D1', 'page', 'png', 3)).toBe('tenants/T1/documents/D1/page-3.png');
  });
});

describe('malware scan disposition', () => {
  it('never treats an unscanned file as clean when scanning is required', async () => {
    expect((await DisconnectedMalwareScanner.scan('T1', 'k')).status).toBe('unscanned');
    expect(resolveScanDisposition('unscanned', PLATFORM_DEFAULTS)).toBe('quarantine');
    expect(resolveScanDisposition('infected', PLATFORM_DEFAULTS)).toBe('reject');
    expect(resolveScanDisposition('clean', PLATFORM_DEFAULTS)).toBe('accept');
    expect(resolveScanDisposition('unscanned', { ...PLATFORM_DEFAULTS, malwareScanRequired: false })).toBe('accept');
  });
});
