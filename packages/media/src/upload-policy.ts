// upload-policy.ts — BUILD_PLAN Phase 12 / Constitution 5 §158–§166 (API_DEFINITION_OF_DONE #34): ONE upload policy for
// every file the API accepts. PURE (no Nest, no global state, no native library).
//
// Every upload route — multipart, base64 body or presigned PUT — passes its bytes (or, for a presigned PUT, its declared
// type and size) through acceptUpload / checkDeclaredUpload with a NAMED policy from UPLOAD_POLICIES. The policy decides:
//   * a size limit (refused before anything else is read),
//   * the content type from the BYTES (magic numbers) — never from the client's Content-Type or file name,
//   * an extension allowlist (a client file name, when sent, must carry one of the policy's extensions: no .html / .svg /
//     .exe renamed into an image field) — the STORED extension always comes from the sniffed type,
//   * images: the header must parse, the pixel count is capped (decompression bombs), and metadata is STRIPPED — EXIF
//     (GPS, camera serials), XMP, IPTC, comments, PNG text chunks, WebP EXIF/XMP — keeping only the orientation, so a
//     customer's phone photo on a public profile no longer carries where it was taken; MP4 / MOV user-data and
//     metadata boxes (Apple's location atom) are blanked in place (offsets stay valid),
//   * a malware-scan hook (MalwareScanner — the evidence store's pattern: no provider is wired, so the honest answer is
//     'unscanned'; an 'infected' verdict refuses the upload),
//   * a tenant-scoped, random object key (uploadObjectKey) — no path segment from the client,
//   * the salon's storage quota (StorageQuotaPort → the Phase 11 QuotaService), unless the multipart StorageQuotaGuard
//     already reserved the request's Content-Length (quotaReserved: true).
import { createHash, randomBytes } from 'node:crypto';
import { imageInfo, orientedSize, sniffImage, type ImageKind } from './image-info';
import { malwareScannerFromEnv } from './clamav-scanner';   // Phase 14: ClamAV when CLAMAV_HOST is set (type-only import back — no runtime cycle)
import { makePrivateStore } from './private-store';

export type UploadKind = ImageKind | 'gif' | 'pdf' | 'mp4' | 'mov' | 'webm' | 'heic' | 'tiff' | 'text';
export const IMAGE_KINDS: readonly UploadKind[] = ['jpeg', 'png', 'webp'];

/** The extensions a client file name may carry, per kind. The stored extension is always STORED_EXT[kind]. */
export const KIND_EXTENSIONS: Readonly<Record<UploadKind, readonly string[]>> = {
  jpeg: ['jpg', 'jpeg', 'jpe', 'jfif'], png: ['png'], webp: ['webp'], pdf: ['pdf'], mp4: ['mp4', 'm4v'], mov: ['mov', 'qt'],
  webm: ['webm'], heic: ['heic', 'heif'], tiff: ['tif', 'tiff'], text: ['txt', 'csv'], gif: ['gif'],
};
export const STORED_EXT: Readonly<Record<UploadKind, string>> = {
  jpeg: 'jpg', png: 'png', webp: 'webp', pdf: 'pdf', mp4: 'mp4', mov: 'mov', webm: 'webm', heic: 'heic', tiff: 'tiff', text: 'txt', gif: 'gif',
};
export const KIND_CONTENT_TYPE: Readonly<Record<UploadKind, string>> = {
  jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', heic: 'image/heic', tiff: 'image/tiff', text: 'text/plain', gif: 'image/gif',
};

export interface UploadPolicy {
  /** Stable name — the gate (check:uploads) and the audit inventory refer to it. */
  readonly name: string;
  readonly maxBytes: number;
  readonly kinds: readonly UploadKind[];
  /** public: served from /media or the CDN; private: signed URLs / streamed through an authorized route only. */
  readonly store: 'public' | 'private';
  /** Images: width × height cap after orientation (default 50 MP). */
  readonly maxPixels?: number;
  /** Images and MP4/MOV: strip metadata (default true — false only where the bytes are evidence that must stay exact). */
  readonly stripMetadata?: boolean;
  /** Files per request (multipart routes). */
  readonly maxFiles?: number;
  /** Images: parse the header and cap the pixels (default true — false where another validator already owns that and
   *  the bytes must be accepted exactly as the established flow accepts them). */
  readonly inspectImages?: boolean;
}

const MB = 1024 * 1024;
const policy = (p: UploadPolicy): UploadPolicy => Object.freeze(p);
/** Every upload the API accepts, by name. A route may narrow a policy ({ ...UPLOAD_POLICIES.x, maxBytes }) — never widen the kinds. */
export const UPLOAD_POLICIES = Object.freeze({
  /** A person's own picture: staff (/auth/avatar, /me/avatar), technician profile, owner, customer, customer social
   *  profile. GIF is accepted because /me/avatar always took it (size-capped and pixel-capped; its metadata is not
   *  stripped — GIF carries no EXIF / GPS block). */
  avatar: policy({ name: 'avatar', maxBytes: 10 * MB, kinds: [...IMAGE_KINDS, 'gif'], store: 'public', maxFiles: 1 }),
  /** Technician portfolio photos, cover banner, before / after pairs. */
  profilePhoto: policy({ name: 'profilePhoto', maxBytes: 10 * MB, kinds: IMAGE_KINDS, store: 'public', maxFiles: 10 }),
  /** Customer nail-showcase posts: photos and short videos (public feed). */
  showcaseMedia: policy({ name: 'showcaseMedia', maxBytes: 50 * MB, kinds: [...IMAGE_KINDS, 'mp4', 'mov', 'webm'], store: 'public', maxFiles: 10 }),
  /** A technician's certificate / licence for a skill change request (a photo or a PDF). */
  skillDocument: policy({ name: 'skillDocument', maxBytes: 10 * MB, kinds: [...IMAGE_KINDS, 'pdf'], store: 'public', maxFiles: 1 }),
  /** Customer-display advertising images (the original and the three browser-made variants). */
  displayAdImage: policy({ name: 'displayAdImage', maxBytes: 25 * MB, kinds: IMAGE_KINDS, store: 'public', maxFiles: 4 }),
  /** The salon logo (receipts, the customer display) — a data: URL body. */
  salonLogo: policy({ name: 'salonLogo', maxBytes: 2 * MB, kinds: IMAGE_KINDS, store: 'public', maxFiles: 1 }),
  /** Help-desk ticket attachments — private store, streamed back through the ticket's authorization. */
  supportAttachment: policy({ name: 'supportAttachment', maxBytes: 5 * MB, kinds: [...IMAGE_KINDS, 'pdf', 'text'], store: 'private', maxFiles: 1 }),
  /** AI OCR receipts — private evidence store, signed previews; the original is kept EXACT (it is the evidence). */
  ocrReceipt: policy({ name: 'ocrReceipt', maxBytes: 15 * MB, kinds: [...IMAGE_KINDS, 'gif', 'pdf', 'heic', 'tiff'], store: 'private', stripMetadata: false, inspectImages: false, maxFiles: 1 }),
  /** Safety-community evidence — presigned PUT straight to the private store; scanned before anyone else can open it. */
  safetyEvidence: policy({ name: 'safetyEvidence', maxBytes: 15 * MB, kinds: [...IMAGE_KINDS, 'pdf'], store: 'private', stripMetadata: false, inspectImages: false, maxFiles: 1 }),
});
export type UploadPolicyName = keyof typeof UPLOAD_POLICIES;

/** A refused upload. `status` is the HTTP status the route should answer with; `reason` goes in the error details. */
export class UploadRejected extends Error {
  constructor(
    readonly reason: 'EMPTY' | 'TOO_LARGE' | 'TOO_MANY_FILES' | 'TYPE_NOT_ALLOWED' | 'EXTENSION_NOT_ALLOWED' | 'MIME_MISMATCH' | 'UNREADABLE' | 'DIMENSIONS_TOO_LARGE' | 'MALWARE' | 'SCAN_UNAVAILABLE',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) { super(message); this.name = 'UploadRejected'; }
  /** http-errors convention: the API's exception filter answers an exposed 4xx with its status, code, message and details. */
  readonly expose = true;
  /** PAYLOAD_TOO_LARGE (413) for size, VALIDATION_FAILED (400) for everything else — both already registered codes. */
  get status(): number { return this.reason === 'TOO_LARGE' ? 413 : this.reason === 'SCAN_UNAVAILABLE' ? 503 : 400; }
  get code(): 'PAYLOAD_TOO_LARGE' | 'VALIDATION_FAILED' { return this.reason === 'TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED'; }
}

// ── sniffing ────────────────────────────────────────────────────────────────────────────────────────────────────
const ascii = (b: Uint8Array, at: number, s: string) => b.length >= at + s.length && [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));
const HEIC_BRANDS = /^(heic|heix|heif|hevc|hevx|heim|heis|mif1|msf1|avif)$/;

/** Plain text: valid UTF-8, no NUL, and not markup (an .html / .svg / .xml renamed .txt is refused). */
function isPlainText(b: Uint8Array): boolean {
  const head = b.subarray(0, Math.min(b.length, 64 * 1024));
  if (head.includes(0)) return false;
  let s: string;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(head.length < b.length ? head.subarray(0, lastUtf8Boundary(head)) : head); } catch { return false; }
  return !/^﻿?\s*</.test(s);
}
/** Cut a prefix at a UTF-8 character boundary (a fatal decode of a truncated prefix must not fail on the cut). */
function lastUtf8Boundary(b: Uint8Array): number {
  let i = b.length;
  for (let k = 0; k < 4 && i > 0; k++) { const c = b[i - 1]; if ((c & 0xc0) !== 0x80) { if (c >= 0xc0) i--; break; } i--; }
  return i === 0 ? b.length : i;
}

/** The upload's real type from its leading bytes — or null when it is none the platform accepts anywhere. */
export function sniffUpload(b: Uint8Array): UploadKind | null {
  if (!b || b.length < 4) return null;
  const img = sniffImage(b);
  if (img) return img;
  if (ascii(b, 0, '%PDF-')) return 'pdf';
  if (ascii(b, 0, 'GIF8')) return 'gif';
  if (b.length >= 12 && ascii(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (HEIC_BRANDS.test(brand)) return 'heic';
    return brand.startsWith('qt') ? 'mov' : 'mp4';
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if ((ascii(b, 0, 'II') && b[2] === 0x2a && b[3] === 0) || (ascii(b, 0, 'MM') && b[2] === 0 && b[3] === 0x2a)) return 'tiff';
  if (isPlainText(b)) return 'text';
  return null;
}

// ── metadata stripping (byte-level; no decode) ───────────────────────────────────────────────────────────────────
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000;
const u32be = (b: Uint8Array, i: number) => b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** A minimal EXIF APP1 that carries ONLY the orientation (big-endian TIFF, one IFD entry). */
function orientationApp1(orientation: number): Uint8Array {
  const seg = new Uint8Array(36);
  seg.set([0xff, 0xe1, 0x00, 0x22]);                                   // APP1, length 34
  seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);                          // "Exif\0\0"
  seg.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8], 10);                   // "MM", 42, IFD at 8
  seg.set([0x00, 0x01], 18);                                           // one entry
  seg.set([0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, orientation, 0, 0], 20); // Orientation, SHORT, 1, value
  seg.set([0, 0, 0, 0], 32);                                           // no next IFD
  return seg;
}

/** JPEG: drop APP1 (EXIF / XMP), APP3–APP13, APP15 and COM before the scan; keep JFIF (APP0), the ICC profile (APP2) and
 *  Adobe (APP14, needed to decode CMYK); re-insert the orientation alone. null when the stream is not walkable. */
function stripJpeg(b: Uint8Array): Uint8Array | null {
  const info = imageInfo(b, 'jpeg');
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2; let insertedOrientation = false;
  const addOrientation = () => { if (!insertedOrientation && info && info.orientation !== 1) keep.push(orientationApp1(info.orientation)); insertedOrientation = true; };
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    let j = i; while (b[j] === 0xff && j < b.length) j++;
    const marker = b[j];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { keep.push(b.subarray(i, j + 1)); i = j + 1; continue; }
    if (marker === 0xd9) { addOrientation(); keep.push(b.subarray(i)); return concat(keep); }
    if (j + 3 > b.length) return null;
    const len = u16be(b, j + 1);
    if (len < 2 || j + 1 + len > b.length) return null;
    const end = j + 1 + len;
    if (marker !== 0xe0) addOrientation();   // the orientation goes right after SOI, or after JFIF when there is one
    if (marker === 0xda) { keep.push(b.subarray(i)); return concat(keep); }   // start of scan: the rest is image data
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isIcc = marker === 0xe2 && ascii(b, j + 3, 'ICC_PROFILE');
    const drop = marker === 0xfe || (isApp && marker !== 0xe0 && marker !== 0xee && !isIcc);
    if (!drop) keep.push(b.subarray(i, end));
    i = end;
  }
  return null;
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
/** PNG: drop the text, EXIF and time chunks; every other chunk (and its CRC) is copied as it is. */
function stripPng(b: Uint8Array): Uint8Array | null {
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32be(b, i); const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!PNG_DROP.has(type)) keep.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(keep);
  }
  return null;
}

/** WebP: drop the EXIF and XMP chunks, clear their VP8X flags, rewrite the RIFF size. */
function stripWebp(b: Uint8Array): Uint8Array | null {
  const keep: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const size = u32le(b, i + 4); const end = i + 8 + size + (size & 1);
    if (i + 8 + size > b.length) return null;
    if (fourcc === 'VP8X') { const c = b.slice(i, Math.min(end, b.length)); c[8] &= ~0x0c; keep.push(c); }
    else if (fourcc !== 'EXIF' && fourcc !== 'XMP ') keep.push(b.subarray(i, Math.min(end, b.length)));
    i = end;
  }
  const body = concat(keep);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12)); out.set(body, 12);
  const riff = out.length - 8; out[4] = riff & 0xff; out[5] = (riff >> 8) & 0xff; out[6] = (riff >> 16) & 0xff; out[7] = (riff >>> 24) & 0xff;
  return out;
}

const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'edts']);
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
/** MP4 / MOV: every `udta` / `meta` box (and the XMP `uuid` box) inside moov / trak / … becomes a `free` box of the SAME
 *  size with zeroed content — sizes and chunk offsets stay valid, players skip `free`. Works on a copy. */
function stripIsoBmff(src: Uint8Array): Uint8Array | null {
  const b = src.slice();
  const walk = (start: number, end: number, depth: number): boolean => {
    let i = start;
    while (i + 8 <= end) {
      let size = u32be(b, i); const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      let header = 8;
      if (size === 1) { if (i + 16 > end) return false; size = u32be(b, i + 8) * 0x100000000 + u32be(b, i + 12); header = 16; }
      else if (size === 0) size = end - i;
      if (size < header || i + size > end) return false;
      const isXmp = type === 'uuid' && Buffer.from(b.subarray(i + header, i + header + 16)).toString('hex') === XMP_UUID;
      if (type === 'udta' || type === 'meta' || isXmp) {
        b.set([0x66, 0x72, 0x65, 0x65], i + 4);                             // 'free'
        b.fill(0, i + header, i + size);
      } else if (MP4_CONTAINERS.has(type) && depth < 8 && !walk(i + header, i + size, depth + 1)) return false;
      i += size;
    }
    return true;
  };
  return walk(0, b.length, 0) ? b : null;
}

/** The bytes with their metadata removed (images, MP4 / MOV). Other kinds, and streams that cannot be walked, are returned
 *  as they are — the second element says which happened. */
export function stripUploadMetadata(b: Uint8Array, kind: UploadKind): { bytes: Uint8Array; stripped: boolean } {
  let out: Uint8Array | null = null;
  try {
    out = kind === 'jpeg' ? stripJpeg(b) : kind === 'png' ? stripPng(b) : kind === 'webp' ? stripWebp(b) : kind === 'mp4' || kind === 'mov' ? stripIsoBmff(b) : null;
  } catch { out = null; }
  return out ? { bytes: out, stripped: true } : { bytes: b, stripped: false };
}

// ── hooks ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type ScanStatus = 'clean' | 'infected' | 'unscanned';
/** The malware-scan hook (the evidence store's pattern). A real scanner plugs in here; until then the honest verdict is
 *  'unscanned' — NEVER a fabricated 'clean'. An 'infected' verdict refuses the upload. */
export interface MalwareScanner { scan(input: { bytes: Uint8Array; kind: UploadKind; policy: string; tenantId: string | null }): Promise<{ status: ScanStatus; detail?: string }>; }
export const NO_MALWARE_SCANNER: MalwareScanner = { async scan() { return { status: 'unscanned' }; } };
// BUILD_PLAN Phase 14: the process-wide scanner acceptUpload uses when its caller passes none — ClamAV (clamd over TCP,
// behind the quarantine) when CLAMAV_HOST is set (clamav-scanner.ts), else the honest no-scanner. Resolved once, lazily;
// installMalwareScanner() replaces it (tests, or the API wiring a detection hook).
let processScanner: MalwareScanner | null | undefined;
export function installMalwareScanner(s: MalwareScanner | null | undefined): void { processScanner = s; }
export function defaultMalwareScanner(): MalwareScanner {
  if (processScanner === undefined) processScanner = process.env.CLAMAV_HOST ? malwareScannerFromEnv(process.env, makePrivateStore(process.env)) : null;
  return processScanner ?? NO_MALWARE_SCANNER;
}
/** The salon's storage quota (the Phase 11 QuotaService implements it). reserve() throws its own 429 over the limit. */
export interface StorageQuotaPort { reserveStorage(tenantId: string, bytes: number): Promise<void>; releaseStorage(tenantId: string, bytes: number): Promise<void>; }
/** DI token for the StorageQuotaPort (a plain string — this package has no Nest). */
export const STORAGE_QUOTA = 'STORAGE_QUOTA';

// ── keys ────────────────────────────────────────────────────────────────────────────────────────────────────────
const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
/**
 * The object key for an accepted upload: `tenants/<tenantId>/<area>/<owner…>/<random>.<ext>` (or `global/<area>/…` for a
 * principal with no salon). Every segment is server-chosen and validated; the file name is 24 random hex characters and
 * the extension is the SNIFFED type's — nothing of the client's path or name ever reaches the key.
 */
export function uploadObjectKey(input: { tenantId: string | null | undefined; area: string; owner?: Array<string | null | undefined>; ext: string }): string {
  const segs = [input.area, ...(input.owner ?? []).map((s) => (s == null || s === '' ? 'none' : String(s)))];
  for (const s of segs) if (!KEY_SEGMENT.test(s)) throw new Error(`uploadObjectKey: invalid segment ${JSON.stringify(s)}`);
  if (!/^[a-z0-9]{2,5}$/.test(input.ext)) throw new Error(`uploadObjectKey: invalid extension ${JSON.stringify(input.ext)}`);
  const root = input.tenantId ? ['tenants', input.tenantId] : ['global'];
  if (input.tenantId && !KEY_SEGMENT.test(input.tenantId)) throw new Error('uploadObjectKey: invalid tenant id');
  return [...root, ...segs, `${randomBytes(12).toString('hex')}.${input.ext}`].join('/');
}

// ── the policy check ────────────────────────────────────────────────────────────────────────────────────────────
export interface UploadInput {
  bytes: Uint8Array | null | undefined;
  /** The client's file name, if any — checked against the extension allowlist, never used for storage. */
  filename?: string | null;
  /** The client's declared content type, if any — must agree with the bytes' family. */
  declaredType?: string | null;
  tenantId?: string | null;
  /** true when the multipart StorageQuotaGuard already reserved this request's Content-Length. */
  quotaReserved?: boolean;
}
export interface AcceptedUpload {
  bytes: Buffer; kind: UploadKind; ext: string; contentType: string; size: number; sha256: string;
  width?: number; height?: number; metadataStripped: boolean; scanStatus: ScanStatus;
  /** Bytes reserved against the salon's quota by THIS call (release them if the store write fails). */
  quotaReservedBytes: number;
}
export interface UploadDeps { scanner?: MalwareScanner; quota?: StorageQuotaPort | null }

const extOf = (name: string | null | undefined) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name ?? '').trim()); return m ? m[1].toLowerCase() : null; };
const family = (ct: string) => ct.split('/')[0];
const normType = (t: string | null | undefined) => String(t ?? '').toLowerCase().split(';')[0].trim().replace(/^image\/(jpg|pjpeg)$/, 'image/jpeg');
const label = (kinds: readonly UploadKind[]) => kinds.map((k) => (k === 'text' ? 'TXT, CSV' : k === 'jpeg' ? 'JPG' : k.toUpperCase())).join(', ');

/** The rules that need no bytes: the policy's size and the client's file name / declared type. Presigned PUTs use this
 *  before signing (the scan runs on the stored object), and acceptUpload runs it first. */
export function checkDeclaredUpload(policy: UploadPolicy, d: { sizeBytes: number; filename?: string | null; declaredType?: string | null }): void {
  if (!(d.sizeBytes > 0)) throw new UploadRejected('EMPTY', 'The file is empty.');
  if (d.sizeBytes > policy.maxBytes) throw new UploadRejected('TOO_LARGE', `The file is larger than ${Math.round(policy.maxBytes / MB)} MB.`, { maxBytes: policy.maxBytes });
  const ext = extOf(d.filename);
  if (ext && !policy.kinds.some((k) => KIND_EXTENSIONS[k].includes(ext))) throw new UploadRejected('EXTENSION_NOT_ALLOWED', `Only ${label(policy.kinds)} files can be uploaded here.`, { extension: ext });
  const t = normType(d.declaredType);
  if (t && t !== 'application/octet-stream' && !policy.kinds.some((k) => KIND_CONTENT_TYPE[k] === t || (k === 'text' && t === 'text/csv'))) {
    throw new UploadRejected('TYPE_NOT_ALLOWED', `Only ${label(policy.kinds)} files can be uploaded here.`, { declared: t });
  }
}

/** The whole policy over real bytes. Throws UploadRejected (or the quota port's own error); returns what to store. */
export async function acceptUpload(policy: UploadPolicy, input: UploadInput, deps: UploadDeps = {}): Promise<AcceptedUpload> {
  const raw = input.bytes;
  if (!raw || raw.length === 0) throw new UploadRejected('EMPTY', 'No file was received.');
  checkDeclaredUpload(policy, { sizeBytes: raw.length, filename: input.filename, declaredType: input.declaredType });
  const kind = sniffUpload(raw);
  if (!kind || !policy.kinds.includes(kind)) throw new UploadRejected('TYPE_NOT_ALLOWED', `Only ${label(policy.kinds)} files can be uploaded here.`, { detected: kind });
  const declared = normType(input.declaredType);
  if (declared && declared !== 'application/octet-stream' && family(declared) !== family(KIND_CONTENT_TYPE[kind]) && !(kind === 'text' && declared === 'text/csv')) {
    throw new UploadRejected('MIME_MISMATCH', 'The file type does not match the file contents.', { declared, detected: KIND_CONTENT_TYPE[kind] });
  }
  let width: number | undefined, height: number | undefined;
  if (((IMAGE_KINDS as readonly string[]).includes(kind) || kind === 'gif') && policy.inspectImages !== false) {
    const info = kind === 'gif' ? (raw.length >= 10 ? { width: raw[6] | (raw[7] << 8), height: raw[8] | (raw[9] << 8), orientation: 1 } : null) : imageInfo(raw, kind as ImageKind);
    if (!info || !(info.width > 0 && info.height > 0)) throw new UploadRejected('UNREADABLE', 'The image could not be read.');
    ({ width, height } = orientedSize(info));
    if (width * height > (policy.maxPixels ?? 50_000_000)) throw new UploadRejected('DIMENSIONS_TOO_LARGE', `The image is too large (${width}×${height}).`, { width, height });
  }
  const { bytes, stripped } = policy.stripMetadata === false ? { bytes: raw, stripped: false } : stripUploadMetadata(raw, kind);
  const scan: { status: ScanStatus; detail?: string } = await (deps.scanner ?? defaultMalwareScanner()).scan({ bytes, kind, policy: policy.name, tenantId: input.tenantId ?? null }).catch(() => ({ status: 'unscanned' as ScanStatus }));
  if (scan.status === 'infected' && scan.detail === 'SCAN_UNAVAILABLE') throw new UploadRejected('SCAN_UNAVAILABLE', 'The file could not be scanned right now — try again in a minute.');
  if (scan.status === 'infected') throw new UploadRejected('MALWARE', 'The file was refused by the malware scan.');
  let reserved = 0;
  if (deps.quota && input.tenantId && !input.quotaReserved) { await deps.quota.reserveStorage(input.tenantId, bytes.length); reserved = bytes.length; }
  const textExt = kind === 'text' && (declared === 'text/csv' || extOf(input.filename) === 'csv') ? 'csv' : null;
  return {
    bytes: Buffer.from(bytes), kind, ext: textExt ?? STORED_EXT[kind], contentType: textExt ? 'text/csv' : KIND_CONTENT_TYPE[kind], size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), width, height, metadataStripped: stripped, scanStatus: scan.status, quotaReservedBytes: reserved,
  };
}

/** Multipart: the file count against the policy (the interceptor's maxCount is the first line; this is the policy's). */
export function checkFileCount(policy: UploadPolicy, n: number): void {
  if (n > (policy.maxFiles ?? 1)) throw new UploadRejected('TOO_MANY_FILES', `Upload at most ${policy.maxFiles ?? 1} file${(policy.maxFiles ?? 1) === 1 ? '' : 's'} at a time.`, { maxFiles: policy.maxFiles ?? 1 });
}
