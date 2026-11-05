// ai-ocr-receipt.module.ts — mounts the AI OCR Receipt Scanner.
//
// In production every port binds to a REAL backend:
//   * documents / settings / review decision state / dedup / audit → Postgres (migrations 344 + 359)
//   * posting → the real tenant InventoryService (expenses / PO receiving); a failed write records a FAILED
//     posting, never a fabricated success
//   * file bytes → the PRIVATE evidence bucket (common/evidence-blob-store.ts), whose own header names OCR
//     receipt files as one of its two purposes. Reads are short-lived signed URLs; there is no public object.
//   * malware scan → the shared S3-tag scanner (common/evidence-scanner.ts). It FAILS CLOSED: no tag, a failed
//     scan, an S3 error, or a missing SDK all read as `unscanned` — never `clean` — and the service then
//     quarantines when the tenant requires scanning.
//
// Honest degradation, unchanged: with EVIDENCE_S3_BUCKET unset the blob store and scanner are NotConnected.
// Bytes are not persisted, `signedPreview()` returns the `notconnected:<key>` marker instead of a fabricated
// URL (the POS screen renders that as "no preview", not a broken image), and nothing is ever reported clean.
// With no database at all (dev/tests) the stores fall back to in-memory fakes so the module still loads.
import { KyselyAiUsageLogger, KyselyAiAccessRepo, type AiUsageLogger } from '@aipowersalon/ai';
import { InventoryModule, InventoryService } from '@aipowersalon/inventory';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { makeEvidenceBlobStore } from '../tenant-safety-community/evidence-blob-store';
import { makeEvidenceScanner } from '../tenant-safety-community/evidence-scanner';
import { AiOcrReceiptController } from './ai-ocr-receipt.controller';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';
import { STORAGE_QUOTA, type StorageQuotaPort } from '@aipowersalon/media';
import { PostingService } from './ai-ocr-receipt-posting';
import { BlobFileStore, EvidenceMalwareScan } from './ai-ocr-receipt.blob';
import { makeOcrProviders } from './ai-ocr-receipt.textract';
import {
  KyselyDocStore, KyselySettingsStore, KyselyOcrAuditSink,
  KyselyPostingIdempotency,
  InMemoryDocStore, InMemorySettingsStore, InMemoryAuditSink, InMemoryPostingIdempotency,
  InventoryExpensePost, InventoryReceiveAdapter,
} from './ai-ocr-receipt.kysely';

@Module({
  imports: [InventoryModule],
  controllers: [AiOcrReceiptController],
  providers: [
    {
      provide: AiOcrReceiptService,
      useFactory: (db: AppDatabase, inv: InventoryService, quota?: StorageQuotaPort) => {
        const docs = db ? new KyselyDocStore(db) : new InMemoryDocStore();
        const settings = db ? new KyselySettingsStore(db) : new InMemorySettingsStore();
        const audit = db ? new KyselyOcrAuditSink(db) : new InMemoryAuditSink();
        const idem = db ? new KyselyPostingIdempotency(db) : new InMemoryPostingIdempotency();

        // Bytes now go to the PRIVATE evidence bucket; the ocr_document_files metadata row is still written
        // exactly as before. NOTE: this store keys objects with storageKeyFor() — the SAME helper the service
        // already hands to the scanner. The previous DbFileStore hardcoded a DIFFERENT key shape
        // (`tenants/{t}/ocr/…` vs storageKeyFor's `tenants/{t}/documents/…`), so the scanner was being asked
        // about a key that had never been written. Harmless only while the scanner was a no-op — and it is not
        // a no-op any more.
        const files = new BlobFileStore(db ?? null, makeEvidenceBlobStore());

        // Posting writes through the real tenant InventoryService (expenses / PO receiving). If the write throws
        // (e.g. no DB), PostingService records a FAILED posting — never a fabricated success.
        const posting = new PostingService(new InventoryExpensePost(inv), new InventoryReceiveAdapter(inv), idem);

        // Reads the malware-scan result an out-of-band S3 scanner (e.g. GuardDuty Malware Protection for S3)
        // wrote onto the object as a tag. Fails closed — see evidence-scanner.ts.
        const scanner = new EvidenceMalwareScan(makeEvidenceScanner());

        // OCR providers, cheapest-first. Textract AnalyzeExpense reads the object straight out of the SAME
        // bucket the blob store wrote it to. With no bucket (or OCR_TEXTRACT_ENABLED=0) the list is EMPTY, and
        // extraction honestly reports `unavailable` → manual entry. Nothing is fabricated in a provider's absence.
        const providers = makeOcrProviders();

        // The PLATFORM usage logger — the same KyselyAiUsageLogger voice transcription binds. Textract bills
        // per page, so OCR pages land in `ai_usage_logs` and show up on the EXISTING tenant + Super Admin AI
        // Usage screens. No parallel usage table. With no DB it is a no-op rather than a fabricated write.
        const usage: AiUsageLogger = db ? new KyselyAiUsageLogger(db as any) : { async log() { /* no DB */ } };

        // The AI entitlement gate. Extraction is the billable step (Textract charges per page; the catalog sells
        // 500 scans + 8c overage) and it was running with NO subscription check — an expired trial or a tenant
        // far past their limit would have kept scanning, uncharged and unblocked. Same repo the AI assistant
        // uses. With no DB it is left unbound and simply not enforced, rather than silently allowing or denying.
        const access = db ? new KyselyAiAccessRepo(db as any) : undefined;

        const svc = new AiOcrReceiptService(docs, settings, files, scanner, posting, audit, providers, usage, access);
        svc.storageQuota = quota ?? null;   // Phase 12 (#34): uploads count against the salon's storage quota
        return svc;
      },
      inject: [DATABASE, InventoryService, { token: STORAGE_QUOTA, optional: true }],
    },
  ],
  exports: [AiOcrReceiptService],
})
export class AiOcrReceiptModule {}
