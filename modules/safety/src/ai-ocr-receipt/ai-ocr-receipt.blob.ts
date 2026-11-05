// ai-ocr-receipt.blob.ts — real object storage + malware scanning for OCR receipt files.
//
// ── Why there is no new S3 client here ───────────────────────────────────────────────────────────────────
// `common/evidence-blob-store.ts` already exists, and its own header says it is "PRIVATE object storage for
// Safety Community evidence **and OCR receipt files**". It was built for this and OCR was simply never
// connected to it. So this file is an ADAPTER, not a second storage layer: it maps the OCR ports
// (`FileStorePort`, `MalwareScanPort`) onto `EvidenceBlobStore` / `EvidenceScanner`.
//
// That reuse is also the security-correct answer. The other candidate — `MediaStorage` (tech-profile) — writes
// PUBLIC objects under `/media/`, a path explicitly excluded from the session middleware because it serves
// avatars. Receipts are vendor invoices: totals, account numbers, supplier terms. Putting them behind a public
// CDN URL would publish a tenant's payables. Evidence storage is private-by-default with short-lived signed
// reads, which is exactly what a receipt needs.
//
// ── Honest degradation (unchanged contract) ──────────────────────────────────────────────────────────────
// With no bucket configured, `makeEvidenceBlobStore()` returns the NotConnected store. In that case:
//   * bytes are not persisted, but the metadata row still records the key (as before), and
//   * `signedPreview()` returns the `notconnected:<key>` marker rather than a fabricated URL.
// The POS screen already treats that marker as "no preview" and labels it, instead of painting a broken image.
// Nothing here can invent a working-looking link.
//
// Scanning fails CLOSED. `S3TagEvidenceScanner` reads the tag an out-of-band scanner (GuardDuty Malware
// Protection for S3, a ClamAV lambda, …) writes onto the object. No tag, a failed scan, a network error, or no
// SDK all map to `unscanned` — never `clean`. `resolveScanDisposition()` then quarantines when the tenant
// requires scanning. There is no path in this file that can produce a false `clean`.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { EvidenceBlobStore } from '../tenant-safety-community/evidence-blob-store';
import type { EvidenceScanner } from '../tenant-safety-community/community-evidence';
import type { FileStorePort, OcrCtx } from './ai-ocr-receipt.service';
import type { MalwareScanPort, ScanStatus } from './ai-ocr-receipt-upload';
import { storageKeyFor } from './ai-ocr-receipt-upload';
import { sha256Hex } from './ai-ocr-receipt.textract';

/** Content type from the validated extension. Only the types the uploader already allows appear here. */
export function contentTypeFor(ext: string): string {
  switch ((ext || '').toLowerCase()) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'tif':
    case 'tiff': return 'image/tiff';
    default: return 'application/octet-stream';
  }
}

/** A preview URL is only usable if it is a real one. The marker is a signal, not a link. */
export function isNotConnectedUrl(url: string | null | undefined): boolean {
  return !url || url.startsWith('notconnected:');
}

/**
 * FileStorePort over the private evidence bucket.
 *
 * Composition, not replacement: the `ocr_document_files` metadata row is still written exactly as `DbFileStore`
 * wrote it (same table, same columns, same key shape), and the bytes now additionally go to object storage.
 * If the blob write throws, the upload FAILS — we do not record a metadata row pointing at an object that is
 * not there, because a reviewer would then open a document whose original can never be produced.
 */
export class BlobFileStore implements FileStorePort {
  constructor(private readonly db: AppDatabase | null, private readonly blobs: EvidenceBlobStore) {}

  async store(ctx: OcrCtx, documentId: string, ext: string, bytes: Uint8Array): Promise<{ storageKey: string }> {
    const storageKey = storageKeyFor(ctx.tenantId, documentId, 'original', ext);

    // Bytes first. A metadata row whose object does not exist is worse than a failed upload: the tenant would
    // believe the receipt is filed, and the original would be gone.
    if (this.blobs.connected) {
      await this.blobs.put(storageKey, Buffer.from(bytes), contentTypeFor(ext));
    }

    if (this.db) {
      // file_hash is the sha256 of the ORIGINAL BYTES — the exact-duplicate signal the dedup engine leans on
      // hardest. It was never written (the column existed, the insert omitted it), so `fileHash` was always null
      // on read and an identical re-upload of the same receipt could never be caught by hash. It is computed
      // here, at the only point where the bytes exist.
      await sql`
        insert into ocr_document_files (tenant_id, document_id, kind, storage_key, size_bytes, scan_status, file_hash)
        values (${ctx.tenantId}, ${documentId}, 'original', ${storageKey}, ${bytes.length}, 'unscanned', ${sha256Hex(bytes)})
      `.execute(this.db as any);
    }
    return { storageKey };
  }

  async signedPreview(_ctx: OcrCtx, storageKey: string): Promise<{ url: string; expiresAt: string }> {
    if (this.blobs.connected) {
      const signed = await this.blobs.signedUrl(storageKey);
      if (signed) return signed;
    }
    // No storage, or the store declined to sign. Return the honest marker — NEVER a fabricated https:// link,
    // which would be indistinguishable from a working system until a reviewer clicked it.
    return { url: `notconnected:${storageKey}`, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
}

/**
 * MalwareScanPort over the shared evidence scanner.
 *
 * The evidence scanner's status set is `unscanned | clean | infected`; OCR's adds `error`. We deliberately map
 * anything that is not an explicit `clean`/`infected` to `unscanned` rather than `error`, because
 * `resolveScanDisposition()` quarantines `unscanned` when the tenant requires scanning but treats `error` as an
 * always-quarantine. `unscanned` is the truthful state for "the out-of-band scanner has not tagged this yet" —
 * which, right after an upload, is the normal case.
 */
export class EvidenceMalwareScan implements MalwareScanPort {
  constructor(private readonly scanner: EvidenceScanner) {}
  async scan(_tenantId: string, storageKey: string): Promise<{ status: ScanStatus }> {
    const r = await this.scanner.scan(storageKey);
    const s = r?.status;
    if (s === 'clean' || s === 'infected') return { status: s };
    return { status: 'unscanned' };
  }
}
