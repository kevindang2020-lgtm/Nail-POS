// ai-ocr-receipt.module.ts — mounts the AI OCR Receipt Scanner.
//
// In production every port binds to a REAL backend:
//   * documents / settings / review decision state / dedup / audit → Postgres (migrations 344 + 359)
//   * posting → the finance module's ExpenseService (expenses) and the real InventoryService (PO receiving); a failed
//     write records a FAILED posting, never a fabricated success, and is retried
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
import { OcrPipelineScheduler } from './ai-ocr-receipt-pipeline.scheduler';
/** §113: the job type the upload enqueues (registered once per process below) */
export const OCR_EXTRACT_JOB = 'ocr.receipt_extract';
import { KyselyAiUsageLogger, KyselyAiAccessRepo, AiProviderTaskGateway, platformAiKillSwitchReader, KyselyAiSettingsStore, evaluateAiAccess, type AiUsageLogger } from '@aipowersalon/ai';
import { InventoryModule, InventoryService } from '@aipowersalon/inventory';
import { FinanceModule, ExpenseService } from '@aipowersalon/finance';
import { Module } from '@nestjs/common';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { OutboxReceiptEvents } from './ai-ocr-receipt-events';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, type AppDatabase } from '@aipowersalon/database';
import { systemContext } from '@aipowersalon/tenant-context';
import { makeEvidenceBlobStore } from '../tenant-safety-community/evidence-blob-store';
import { makeEvidenceScanner } from '../tenant-safety-community/evidence-scanner';
import { AiOcrReceiptController } from './ai-ocr-receipt.controller';
import { ReceiptCenter } from './receipt-center';
import { ReceiptCenterController, RECEIPT_CENTER } from './receipt-center.controller';
import { AiOcrReceiptService, uploadRefusalFor, type OcrCtx } from './ai-ocr-receipt.service';
import { STORAGE_QUOTA, type StorageQuotaPort } from '@aipowersalon/media';
import { PostingService } from './ai-ocr-receipt-posting';
import { BlobFileStore, EvidenceMalwareScan } from './ai-ocr-receipt.blob';
import { makeOcrProviders } from './ai-ocr-receipt.textract';
import {
  KyselyDocStore, KyselySettingsStore, KyselyOcrAuditSink,
  KyselyPostingIdempotency,
  InMemoryDocStore, InMemorySettingsStore, InMemoryAuditSink, InMemoryPostingIdempotency,
  InventoryExpensePost, InventoryReceiveAdapter, FinanceExpensePost,
} from './ai-ocr-receipt.kysely';

@Module({
  imports: [InventoryModule, FinanceModule, EventsCoreModule],
  controllers: [AiOcrReceiptController, ReceiptCenterController],
  providers: [
    {
      provide: AiOcrReceiptService,
      useFactory: (db: AppDatabase, inv: InventoryService, quota: StorageQuotaPort | undefined, finance: ExpenseService | undefined, outbox: OutboxWriter) => {
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

        // Posting: an approved receipt becomes ONE expense through the finance module (Oct 21 2026 — the one expense
        // authority: receipt link, line items, vendor, category engine, duplicate check, idempotent per document);
        // PO receiving through the real InventoryService. Without the finance module (a stripped build) the older
        // inventory raw insert stays the fallback. If a write throws, PostingService records a FAILED posting — never a
        // fabricated success — and the next attempt retries it.
        const posting = new PostingService(finance ? new FinanceExpensePost(finance) : new InventoryExpensePost(inv), new InventoryReceiveAdapter(inv), idem);

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
        // §30 (Oct 27 2026): with a database, extraction runs through the central AI gateway's non-LLM door — the registered
        // task 'ocr.receipt_extract', entitlement / quota, the tenant + platform safety switches (Super Admin kill switch),
        // the shared provider circuit breakers, the task timeout and the same ai_usage_logs ledger.
        // N-4 / SD-23: the salon's saved AI settings ("turn off all AI", disabled tasks) reach receipt OCR too
        const aiSettings = db ? new KyselyAiSettingsStore(db as never) : null;
        svc.gateway = db && aiSettings ? new AiProviderTaskGateway({
          accessRepo: access ?? null, usage, platformSafety: platformAiKillSwitchReader(db),
          tenantSafety: (tenantId, branchId) => aiSettings.get(tenantId, branchId),
        }) : null;
        svc.storageQuota = quota ?? null;   // Phase 12 (#34): uploads count against the salon's storage quota
        // mandate §150: expense_receipt.uploaded / extracted / review_required / processing_failed on the outbox
        svc.events = db && outbox ? new OutboxReceiptEvents(db as never, outbox) : null;
        // §74/§75 (Oct 27 2026): the owner's receptionist / technician upload switches (expense settings) decide whether a front-desk
        // or technician caller may upload at all — the permission key gates the route, the setting gates the role
        svc.uploadPolicy = finance ? { refuse: async (c) => { const s = await finance.repo.settings(c.tenantId); return uploadRefusalFor(c.role, s ? { receptionistUpload: !!s.receptionist_upload, technicianUpload: !!s.technician_upload } : null); } } : null;
        // §142 (Oct 27 2026): the finance module suggests the EXISTING expense a receipt could be the evidence for
        // Oct 28 2026 (audit F2): the finance module's bound branch rule decides which receipts a person sees
        svc.visibleBranches = finance ? (c) => finance.visibleBranches({ tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: c.permissions, selectedBranchId: c.branchId }) : null;
        svc.expenseSuggestions = finance ? { suggestExpenseForReceipt: (c, documentId) => finance.suggestExpenseForReceipt({ tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: c.permissions, selectedBranchId: c.branchId }, documentId) } : null;
        // §113/§114 (Oct 27 2026): extraction is a durable job (the ONE job queue, class 'ai'); the upload answers at once. The
        // handler is the service's own runExtraction under the system context; the document's own ladder (§115) owns retries,
        // so the job itself is not retried for a provider failure — only for an unexpected error (the database away).
        if (db) {
          svc.extractionJobs = { enqueue: async (c, documentId) => { await enqueueJob(db, { jobClass: 'ai', jobType: OCR_EXTRACT_JOB, tenantId: c.tenantId, payload: { documentId, branchId: c.branchId ?? null }, priority: 1, maxAttempts: 3, idempotencyKey: `${documentId}:${Date.now()}` }); } };
          if (!jobHandlerFor(OCR_EXTRACT_JOB)) registerJobHandler(OCR_EXTRACT_JOB, async (payload, jctx) => {
            const documentId = String(payload?.documentId ?? '');
            if (!jctx.tenantId || !/^[0-9a-f-]{36}$/i.test(documentId)) throw new PermanentJobError('ocr.receipt_extract needs a tenant and a document id');
            const c = systemContext({ tenantId: jctx.tenantId, branchId: (payload?.branchId as string | null) ?? null, actor: 'ocr-extract-job' }) as unknown as OcrCtx;
            const doc = await svc['docs'].get(c, documentId);
            if (!doc) throw new PermanentJobError(`document ${documentId} is gone`);
            if (doc.pipelineState !== 'extracting') return { skipped: doc.pipelineState };   // already read (a person pressed Run), or quarantined
            const r = await svc.runExtraction(c, documentId);
            return { pipelineState: r.pipelineState, providerKey: r.providerKey, unavailable: r.unavailable, attempt: jctx.attempt };
          });
        }
        return svc;
      },
      inject: [DATABASE, InventoryService, { token: STORAGE_QUOTA, optional: true }, { token: ExpenseService, optional: true }, OutboxWriter],
    },
    // AI OCR Receipt Scanner guide (Nov 2026): the scanner page's read side — the same branch rule as the receipt list
    { provide: RECEIPT_CENTER, useFactory: (db: AppDatabase, svc: AiOcrReceiptService) => {
        if (!db) return null;
        const access = new KyselyAiAccessRepo(db as never);
        return new ReceiptCenter(db as never, async (c) => (svc.visibleBranches && !String(c.userId ?? '').startsWith('system:') ? svc.visibleBranches(c as OcrCtx) : null),
          async (c) => { const d = evaluateAiAccess(await access.loadSnapshot(c.tenantId, 'ai_ocr_receipt_scanner', c.userId ?? null, { branchId: c.branchId || null }));
            return { allowed: d.allowed, reason: d.reason, subscriptionStatus: String(d.subscriptionStatus) }; },
          () => makeOcrProviders().map((p) => p.key));
      }, inject: [DATABASE, AiOcrReceiptService] },
    OcrPipelineScheduler,   // M3 (Oct 23 2026): quarantined → rescan, stuck extracting → extract, every 5 min (OCR_PIPELINE_SWEEP=off stops it)
  ],
  exports: [AiOcrReceiptService],
})
export class AiOcrReceiptModule {}
