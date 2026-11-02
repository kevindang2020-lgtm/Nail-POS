// ai-ocr-receipt-upload.ts — secure upload validation (PURE) + tenant-scoped storage keys + the two ports the gap-analysis
// flagged (a URL signer and a malware scanner). File type is validated by MAGIC BYTES, not the filename extension.
// Filenames are sanitized (no path traversal). Storage keys always carry tenant + document scope. When no malware scanner
// is connected the outcome is honestly 'unscanned' — and if the tenant requires scanning, the document is QUARANTINED
// rather than treated as clean. Nothing here trusts client-declared MIME/size.
import type { OcrReceiptConfig } from './ai-ocr-receipt-settings';

export type DetectedKind = 'jpeg' | 'png' | 'pdf' | 'gif' | 'webp' | 'heic' | 'tiff' | 'unknown';
export interface DetectedType { kind: DetectedKind; mime: string; }

const KIND_MIME: Record<Exclude<DetectedKind, 'unknown'>, string> = {
  jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', tiff: 'image/tiff',
};
const EXT: Record<DetectedKind, string> = { jpeg: 'jpg', png: 'png', pdf: 'pdf', gif: 'gif', webp: 'webp', heic: 'heic', tiff: 'tiff', unknown: 'bin' };

/** Identify a file by its leading bytes. Accepts a Uint8Array/Buffer of at least the header. */
export function detectFileType(bytes: Uint8Array | number[]): DetectedType {
  const b = Array.from(bytes.slice(0, 16));
  const at = (i: number, ...vals: number[]) => vals.every((v, k) => b[i + k] === v);
  const ascii = (i: number, s: string) => s.split('').every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: 'jpeg', mime: KIND_MIME.jpeg };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { kind: 'png', mime: KIND_MIME.png };
  if (ascii(0, '%PDF')) return { kind: 'pdf', mime: KIND_MIME.pdf };
  if (ascii(0, 'GIF8')) return { kind: 'gif', mime: KIND_MIME.gif };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'webp', mime: KIND_MIME.webp };
  if (ascii(4, 'ftyp') && (ascii(8, 'heic') || ascii(8, 'heix') || ascii(8, 'mif1') || ascii(8, 'heif'))) return { kind: 'heic', mime: KIND_MIME.heic };
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return { kind: 'tiff', mime: KIND_MIME.tiff };
  return { kind: 'unknown', mime: 'application/octet-stream' };
}

/** Strip any path components, control chars, and traversal; cap length. Never returns an empty string. */
export function sanitizeFilename(name: string | null): string {
  // eslint-disable-next-line no-control-regex -- deliberate: strip control chars from OCR output
  const base = String(name ?? '').replace(/[\\/]/g, '_').replace(/\.\.+/g, '_').replace(/[\u0000-\u001f<>:"|?*]+/g, '').trim();
  const safe = base.replace(/^\.+/, '').slice(0, 180);
  return safe || 'upload';
}

export type UploadError = 'EMPTY_FILE' | 'TOO_LARGE' | 'UNKNOWN_TYPE' | 'DISALLOWED_TYPE' | 'MIME_MISMATCH' | 'TOO_MANY_PAGES' | 'DECOMPRESSION_BOMB';
export interface UploadInput { filename: string | null; declaredMime?: string | null; sizeBytes: number; headerBytes: Uint8Array | number[]; pageCount?: number | null; width?: number | null; height?: number | null; }
export interface UploadValidation { ok: boolean; errors: UploadError[]; detected: DetectedType; ext: string; safeName: string; }

const MAX_PIXELS = 100_000_000;   // ~100MP decompression-bomb ceiling

export function validateUpload(input: UploadInput, config: OcrReceiptConfig): UploadValidation {
  const errors: UploadError[] = [];
  const detected = detectFileType(input.headerBytes);
  if (!input.sizeBytes || input.sizeBytes <= 0) errors.push('EMPTY_FILE');
  if (input.sizeBytes > config.maxFileSizeBytes) errors.push('TOO_LARGE');
  if (detected.kind === 'unknown') errors.push('UNKNOWN_TYPE');
  else if (!config.allowedMimeTypes.includes(detected.mime)) errors.push('DISALLOWED_TYPE');
  // client-declared MIME must not contradict the real bytes (bytes win; a mismatch is suspicious)
  if (input.declaredMime && detected.kind !== 'unknown' && input.declaredMime !== detected.mime) errors.push('MIME_MISMATCH');
  if (input.pageCount != null && input.pageCount > config.maxPages) errors.push('TOO_MANY_PAGES');
  if (input.width != null && input.height != null && input.width * input.height > MAX_PIXELS) errors.push('DECOMPRESSION_BOMB');
  return { ok: errors.length === 0, errors, detected, ext: EXT[detected.kind], safeName: sanitizeFilename(input.filename) };
}

/** Tenant + document scoped storage key. Never a public URL; resolved to a signed URL only for authorized preview. */
export function storageKeyFor(tenantId: string, documentId: string, kind: 'original' | 'processed' | 'thumbnail' | 'page', ext: string, page?: number): string {
  const leaf = kind === 'page' ? `page-${page ?? 0}.${ext}` : `${kind}.${ext}`;
  return `tenants/${tenantId}/documents/${documentId}/${leaf}`;
}

// ── ports (wired in later stages) ────────────────────────────────────────────
export type ScanStatus = 'clean' | 'infected' | 'unscanned' | 'error';
export interface MalwareScanPort { scan(tenantId: string, storageKey: string): Promise<{ status: ScanStatus }>; }
/** Honest default: no scanner connected → 'unscanned' (never a false 'clean'). */
export const DisconnectedMalwareScanner: MalwareScanPort = { async scan() { return { status: 'unscanned' }; } };

/** Decide the file's disposition from a scan result + tenant policy. Unscanned + required → quarantine (not clean). */
export function resolveScanDisposition(status: ScanStatus, config: OcrReceiptConfig): 'accept' | 'quarantine' | 'reject' {
  if (status === 'infected') return 'reject';
  if (status === 'error') return 'quarantine';
  if (status === 'unscanned') return config.malwareScanRequired ? 'quarantine' : 'accept';
  return 'accept';
}

export interface SignedUrl { url: string; expiresAt: string; }

/** Deep-scan (Oct 22 2026): the POS and the Owner App send a receipt's bytes in the JSON body as a number array
 *  (`Array.from(buffer)`; a raw Uint8Array arrives as an index-keyed object). Nothing converted them — the controller's
 *  comment named "an upstream interceptor" that never existed — so the upload policy's hash got an Array and every
 *  receipt upload answered 500. This is the one conversion: whole numbers 0–255 only; anything else is null (→ 400). */
export function bytesFromBody(v: unknown): Uint8Array | null {
  if (v == null) return new Uint8Array();
  if (v instanceof Uint8Array) return v;
  const list: unknown[] | null = Array.isArray(v) ? v
    : typeof v === 'object' ? Object.keys(v as object).every((k) => /^\d+$/.test(k)) ? Object.keys(v as object).sort((a, b) => Number(a) - Number(b)).map((k) => (v as Record<string, unknown>)[k]) : null
    : null;
  if (!list) return null;
  const out = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++) { const n = list[i]; if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 255) return null; out[i] = n; }
  return out;
}

