// ai-ocr-receipt.service.ts — the facade that orchestrates the pure modules through injected ports. It is where tenant
// context is enforced and where the safety rules compose: uploads are validated before storage, the pipeline only
// advances through review, corrections are audited, and posting is gated on approval. Tenant/branch come from ctx
// (server-derived) — never from the client. Ports are bound to Kysely + the existing services in a later stage.
import { type AiUsageLogger, evaluateAiAccess, accessReasonLabel, type AiAccessSnapshot } from '@aipowersalon/ai';
import { classifyDocument } from './ai-ocr-receipt-core';
import { buildValidationReport, type DocumentFinancials } from './ai-ocr-receipt-validation';
import { detectDuplicates, type DuplicateCandidate, type DedupSubject } from './ai-ocr-receipt-dedup';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS, type SettingsRow, type OcrReceiptConfig } from './ai-ocr-receipt-settings';
import { validateUpload, storageKeyFor, resolveScanDisposition, type UploadInput, type MalwareScanPort, type ScanStatus } from './ai-ocr-receipt-upload';
import { transition, canPost, runOcrWithFallback, type OcrProvider, type PipelineState } from './ai-ocr-receipt-pipeline';
import { toFinancials, toDedupSubject } from './ai-ocr-receipt.textract';

/** The tenant's AI entitlement for this package. Same repo the AI assistant and tenant-ai surfaces already use —
 *  one gate, one source of truth, no second opinion about whether a tenant may run AI. */
export interface OcrAccessRepo { loadSnapshot(tenantId: string, packageCode: string, userId: string | null): Promise<AiAccessSnapshot>; }
import { applyFieldCorrection, evaluateApprovalRequirement, applyDecision, isApproved, type ReviewDecisionState, type CorrectableField } from './ai-ocr-receipt-review';
import { PostingService, type ApprovedDocument, type PostingCtx } from './ai-ocr-receipt-posting';
import { OcrError } from './ai-ocr-receipt-errors';
import { acceptUpload, UploadRejected, UPLOAD_POLICIES, type StorageQuotaPort } from '@aipowersalon/media';

export interface OcrCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[]; }
const requireTenant = (ctx: OcrCtx) => { if (!ctx?.tenantId) throw new OcrError('TENANT_REQUIRED'); };

/** The AI package this module bills under. `ai_usage_logs.package_code` is NOT NULL with no default, and this is
 *  the same code the sidebar gates the screen on (`aiPackageCode: 'ai_ocr_receipt_scanner'`) — one identifier. */
export const OCR_PACKAGE_CODE = 'ai_ocr_receipt_scanner';

/**
 * Cost per extracted page, in micro-USD. The column is `cost_estimate_cents` — an ESTIMATE, and it is treated as
 * one: this is AWS's published AnalyzeExpense list price (USD 0.01/page), not a figure read back from a bill. Any
 * tenant on negotiated pricing, or a different provider, overrides it with OCR_COST_MICRO_USD_PER_PAGE rather
 * than silently accruing a number that is wrong. Set it to 0 to record usage without a cost estimate.
 */
export function ocrCostMicroUsdPerPage(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OCR_COST_MICRO_USD_PER_PAGE;
  if (raw == null || raw === '') return 10_000;          // USD 0.01 per page
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10_000;
}

/** The stored object's media type, derived from the key the uploader wrote (…/original.<ext>). */
export function mimeForKey(storageKey: string | null): string {
  const ext = String(storageKey || '').split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'tif': case 'tiff': return 'image/tiff';
    default: return 'application/octet-stream';
  }
}

export interface DocRecord {
  id: string; tenantId: string; branchId: string | null; pipelineState: PipelineState;
  documentType: string; vendor: string | null; totalCents: number | null; category: string | null;
  fileHash: string | null; perceptualHash: string | null; documentNumber: string | null; documentDate: string | null;
  postingVersion: number; purchaseOrderId?: string | null;
  // The object key of the stored original. Needed to request a signed preview; without it the reviewer's
  // preview call could never even be made (the screen guards on `doc.storageKey`). Never a URL.
  storageKey?: string | null;
}
export interface DocStorePort {
  create(ctx: OcrCtx, rec: Partial<DocRecord>): Promise<DocRecord>;
  get(ctx: OcrCtx, id: string): Promise<DocRecord | null>;
  list(ctx: OcrCtx, filters: Record<string, unknown>): Promise<{ items: DocRecord[]; total: number }>;
  patch(ctx: OcrCtx, id: string, patch: Partial<DocRecord>): Promise<void>;
  dedupCandidates(ctx: OcrCtx, subject: DedupSubject): Promise<DuplicateCandidate[]>;
  saveDecisionState(ctx: OcrCtx, id: string, state: ReviewDecisionState): Promise<void>;
  loadDecisionState(ctx: OcrCtx, id: string): Promise<ReviewDecisionState>;
}
export interface SettingsStorePort { load(ctx: OcrCtx): Promise<SettingsRow[]>; }
export interface FileStorePort { store(ctx: OcrCtx, documentId: string, ext: string, bytes: Uint8Array): Promise<{ storageKey: string }>; signedPreview(ctx: OcrCtx, storageKey: string): Promise<{ url: string; expiresAt: string }>; }
export interface AuditSink { record(ctx: OcrCtx, action: string, documentId: string, meta: Record<string, unknown>): Promise<void>; }

export class AiOcrReceiptService {
  /** Phase 12 (#34): the salon's storage quota (the API's QuotaService), set by the module; absent → not charged. */
  storageQuota: StorageQuotaPort | null = null;

  constructor(
    private readonly docs: DocStorePort,
    private readonly settings: SettingsStorePort,
    private readonly files: FileStorePort,
    private readonly scanner: MalwareScanPort,
    private readonly posting: PostingService,
    private readonly audit: AuditSink,
    // OCR providers, cheapest-first. Defaults to NONE — with no provider bound, extraction honestly reports
    // `unavailable` and the document routes to manual entry. It is optional so the existing specs (and any
    // deployment that has not bound a provider) construct unchanged.
    private readonly providers: OcrProvider[] = [],
    // The PLATFORM usage logger (ai_usage_logs) — the same one voice transcription uses. Textract bills PER
    // PAGE, so an extraction is a real cost event and it belongs in the existing tenant + Super Admin AI Usage
    // surfaces, not in a parallel table nobody looks at. Optional and no-op by default so the existing specs
    // (and any deployment without a DB) construct unchanged.
    private readonly usage: AiUsageLogger = { async log() { /* not bound */ } },
    // The AI entitlement gate. Extraction is the one BILLABLE step in this module (Textract charges per page,
    // and the catalog sells 500 scans + 8c overage), and it was running with no subscription check at all — an
    // expired trial, a cancelled package, or a tenant 400 scans past their limit would all have kept scanning.
    // `evaluateAiAccess` is the platform's existing enforcement heart; this module simply stopped calling it.
    // Optional: with no repo bound, access is not gated (dev/tests), and that is stated rather than assumed.
    private readonly access?: OcrAccessRepo,
  ) {}

  /** Deny extraction unless the tenant's AI package actually entitles them to it. */
  private async requireAiEntitlement(ctx: OcrCtx): Promise<void> {
    if (!this.access) return;                                    // not bound → not enforced (dev/tests)
    const snapshot = await this.access.loadSnapshot(ctx.tenantId, OCR_PACKAGE_CODE, ctx.userId ?? null);
    const decision = evaluateAiAccess(snapshot);
    if (decision.allowed) return;
    // A usage-limit denial is a different remedy from an unpaid/expired one, so it gets its own code (429 vs 403)
    // and the reason is passed through verbatim — the tenant is told what is actually wrong, not just "no".
    throw new OcrError(
      decision.limitExceeded ? 'AI_USAGE_LIMIT_REACHED' : 'MODULE_DISABLED',
      accessReasonLabel(decision.reason),
      { reason: decision.reason, subscriptionStatus: decision.subscriptionStatus, upgradeRequired: decision.upgradeRequired, remainingUsage: decision.remainingUsage },
    );
  }

  /** Record an OCR page charge against the tenant's AI usage. Never throws — billing telemetry must not be able
   *  to fail an extraction that already succeeded, and a lost usage row is better than a lost receipt. */
  private async logOcrUsage(ctx: OcrCtx, e: { action: string; provider: string | null; pages: number; status: 'success' | 'provider_error'; error?: string | null }): Promise<void> {
    try {
      await this.usage.log({
        tenantId: ctx.tenantId,
        userId: ctx.userId ?? null,
        packageCode: OCR_PACKAGE_CODE,
        action: e.action,
        modelProvider: e.provider,
        modelName: e.provider === 'aws-textract' ? 'textract-analyze-expense' : null,
        // Textract is not a token model. Tokens stay 0 rather than being invented.
        inputTokens: 0,
        outputTokens: 0,
        // The TENANT's billing unit, taken from ai-catalog.ts: this package sells `scans`, 500 included, 8c
        // overage. So ONE EXTRACTION = ONE SCAN. It is emphatically NOT pages: the entitlement counter counts
        // ROWS of successful usage against `includedUsageLimit`, so logging a 3-page receipt as `3` would burn
        // a tenant's 500-scan allowance three times faster than the plan they bought.
        usageUnit: 'scans',
        usageAmount: e.status === 'success' ? 1 : 0,
        // The PLATFORM's cost, which genuinely is per page — that is how AWS bills AnalyzeExpense. Tenant unit
        // and platform cost unit are different things, and conflating them is what would have gone wrong here.
        costMicroUsd: e.pages * ocrCostMicroUsdPerPage(),
        status: e.status,
        errorMessage: e.error ?? null,
        createdAt: new Date().toISOString(),
      });
    } catch { /* telemetry is best-effort; a lost usage row must never fail a successful extraction */ }
  }

  async effectiveConfig(ctx: OcrCtx): Promise<{ enabled: boolean; config: OcrReceiptConfig }> {
    const rows = await this.settings.load(ctx);
    const { tenant, branch } = rowsToLayers(rows, { branchId: ctx.branchId ?? undefined });
    const r = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant, branch });
    return { enabled: r.enabled, config: r.config };
  }

  /** Upload: validate BEFORE storage; store original; run malware disposition; create the document row. */
  async upload(ctx: OcrCtx, input: UploadInput & { bytes: Uint8Array }): Promise<{ documentId: string; pipelineState: PipelineState }> {
    requireTenant(ctx);
    const { enabled, config } = await this.effectiveConfig(ctx);
    if (!enabled) throw new OcrError('MODULE_DISABLED');
    const v = validateUpload(input, config);
    if (!v.ok) {
      const code = v.errors.includes('TOO_LARGE') ? 'FILE_TOO_LARGE' : (v.errors.includes('UNKNOWN_TYPE') || v.errors.includes('DISALLOWED_TYPE')) ? 'UNSUPPORTED_TYPE' : 'INVALID_UPLOAD';
      throw new OcrError(code as any, `upload rejected: ${v.errors.join(',')}`, { errors: v.errors });
    }
    // Phase 12 (#34): the one upload policy on top of the OCR checks — the client's file name must carry an allowed
    // extension, and the bytes are charged to the salon's storage quota (a JSON body: the multipart guard never saw it).
    // The original is kept EXACT (ocrReceipt.stripMetadata = false): it is the evidence a reviewer compares against.
    let up;
    try { up = await acceptUpload({ ...UPLOAD_POLICIES.ocrReceipt, maxBytes: config.maxFileSizeBytes }, { bytes: input.bytes, filename: input.filename, tenantId: ctx.tenantId }, { quota: this.storageQuota }); }
    catch (e) { if (e instanceof UploadRejected) throw new OcrError(e.reason === 'TOO_LARGE' ? 'FILE_TOO_LARGE' : e.reason === 'TYPE_NOT_ALLOWED' ? 'UNSUPPORTED_TYPE' : 'INVALID_UPLOAD' as any, `upload rejected: ${e.reason}`, { errors: [e.reason] }); throw e; }
    const doc = await this.docs.create(ctx, { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 });
    try { await this.files.store(ctx, doc.id, v.ext, input.bytes); }
    catch (e) { if (up.quotaReservedBytes) await this.storageQuota?.releaseStorage(ctx.tenantId, up.quotaReservedBytes).catch(() => undefined); throw e; }
    // malware disposition (honest: unscanned + required → quarantine)
    const scan: ScanStatus = (await this.scanner.scan(ctx.tenantId, storageKeyFor(ctx.tenantId, doc.id, 'original', v.ext))).status;
    const disposition = resolveScanDisposition(scan, config);
    const next = disposition === 'reject' ? transition('uploaded', 'scan_infected') : disposition === 'quarantine' ? transition('uploaded', 'scan_quarantine') : transition('uploaded', 'scan_clean');
    await this.docs.patch(ctx, doc.id, { pipelineState: next.state });
    await this.audit.record(ctx, 'document.uploaded', doc.id, { disposition, scan });

    // Auto-run OCR when the tenant asked for it AND the file actually cleared scanning. This NEVER auto-posts —
    // extraction lands the document at review_required (or manual_entry_required), and only a human approval can
    // move it toward the books. A failure here must not fail the upload: the bytes are safely stored, so we leave
    // the document in `extracting` and let the reviewer press Run extraction.
    if (config.autoPipeline && next.state === 'extracting') {
      try {
        const ex = await this.runExtraction(ctx, doc.id);
        return { documentId: doc.id, pipelineState: ex.pipelineState };
      } catch {
        return { documentId: doc.id, pipelineState: next.state };
      }
    }
    return { documentId: doc.id, pipelineState: next.state };
  }

  /**
   * Re-read the malware verdict for a quarantined document and apply it.
   *
   * This is not optional plumbing — without it the feature deadlocks. Every credible S3 scanner (GuardDuty
   * Malware Protection, a ClamAV lambda) tags the object **out of band**, seconds to minutes after the upload.
   * So the scan at upload time almost always returns `unscanned`, and `malwareScanRequired` defaults to TRUE →
   * the document is quarantined. With no way to re-ask, every receipt would sit in quarantine forever.
   *
   * The state machine already anticipated this: `quarantined --scan_clean--> extracting` is a defined edge.
   * This method is what walks it. It re-asks the scanner and applies ONLY what the scanner actually said:
   *   clean    → released to extraction
   *   infected → rejected (and it stays rejected)
   *   anything else → still quarantined; we report the honest status and change nothing.
   * There is no argument, and no caller, that can talk this method into releasing an unscanned file.
   */
  async rescan(ctx: OcrCtx, id: string): Promise<{ pipelineState: PipelineState; scan: ScanStatus; released: boolean }> {
    requireTenant(ctx);
    const doc = await this.docs.get(ctx, id);
    if (!doc) throw new OcrError('NOT_FOUND');
    if (doc.pipelineState !== 'quarantined' && doc.pipelineState !== 'scanning')
      throw new OcrError('INVALID_STATE', `rescan applies to quarantined documents, not '${doc.pipelineState}'`);

    const key = doc.storageKey || null;
    if (!key) {
      // No stored object → there is nothing to scan. Say so; do not release.
      await this.audit.record(ctx, 'document.rescanned', id, { scan: 'unscanned', released: false, reason: 'no_storage_key' });
      return { pipelineState: doc.pipelineState, scan: 'unscanned', released: false };
    }

    const scan: ScanStatus = (await this.scanner.scan(ctx.tenantId, key)).status;
    if (scan !== 'clean' && scan !== 'infected') {
      // Still no verdict. Unchanged — an unscanned file is not a clean one.
      await this.audit.record(ctx, 'document.rescanned', id, { scan, released: false });
      return { pipelineState: doc.pipelineState, scan, released: false };
    }

    const next = transition(doc.pipelineState, scan === 'clean' ? 'scan_clean' : 'scan_infected');
    if (!next.ok) throw new OcrError('INVALID_STATE', next.error);
    await this.docs.patch(ctx, id, { pipelineState: next.state });
    await this.audit.record(ctx, 'document.rescanned', id, { scan, released: scan === 'clean', from: doc.pipelineState, to: next.state });
    return { pipelineState: next.state, scan, released: scan === 'clean' };
  }

  /**
   * Run OCR on a document sitting in `extracting`, and route it on.
   *
   * Nothing called this before. `runOcrWithFallback()` existed and was only ever exercised by a unit test, and
   * no controller route reached `finalizeExtraction()` — so a receipt that passed its malware scan moved to
   * `extracting` and STOPPED THERE, permanently. The whole middle of the pipeline was unreachable.
   *
   * Two outcomes, both honest:
   *   * no provider connected, an unsupported media type, or a provider failure → `manual_entry_required`.
   *     A person keys the values in and reviews them. We do NOT fabricate a vendor or a total.
   *   * a real extraction → validated, deduped, and parked at `review_required` (or `duplicate_hold`).
   *     Never past review — `finalizeExtraction` cannot reach `approved`, and only `approved` can post.
   */
  async runExtraction(ctx: OcrCtx, id: string): Promise<{ pipelineState: PipelineState; providerKey: string | null; unavailable: boolean }> {
    requireTenant(ctx);
    const doc = await this.docs.get(ctx, id);
    if (!doc) throw new OcrError('NOT_FOUND');
    if (doc.pipelineState !== 'extracting')
      throw new OcrError('INVALID_STATE', `extraction applies to documents in 'extracting', not '${doc.pipelineState}'`);

    // Checked BEFORE the provider is called — an unentitled tenant must not incur a Textract charge, and the
    // document stays exactly where it is so it can be extracted once the subscription is sorted out. Nothing is
    // lost: the bytes are stored and the reviewer can still key the values in by hand.
    await this.requireAiEntitlement(ctx);

    const storageKey = doc.storageKey || null;
    const mime = mimeForKey(storageKey);

    const result = storageKey
      ? await runOcrWithFallback(this.providers, {
          tenantId: ctx.tenantId, documentId: id, storageKey, mime, pageCount: 1,
        })
      // No stored object → nothing to read. Honest: manual entry, not a fabricated extraction.
      : { unavailable: true as const, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 };

    if (result.unavailable) {
      const next = transition('extracting', 'extract_unavailable');
      if (!next.ok) throw new OcrError('INVALID_STATE', next.error);
      await this.docs.patch(ctx, id, { pipelineState: next.state });
      await this.audit.record(ctx, 'document.extraction_unavailable', id, { providers: this.providers.length, mime });

      // Usage is recorded ONLY when a provider was actually attempted. With no provider bound (the default
      // deployment) nothing was called, nothing was billed, and writing a zero-cost row would put phantom OCR
      // activity on the tenant's AI Usage screen for work that never happened. A provider that WAS tried and
      // failed is a different thing — it may well have been billed — so that one is logged, with 0 pages and
      // `provider_error`, which is exactly what the status column is for.
      if (this.providers.length > 0) {
        await this.logOcrUsage(ctx, { action: 'extract', provider: this.providers[0]?.key ?? null, pages: 0, status: 'provider_error', error: 'extraction_unavailable' });
      }
      return { pipelineState: next.state, providerKey: null, unavailable: true };
    }

    const financials = toFinancials(result);
    // fileHash comes from the STORED BYTES (written at upload), not from extraction — it is the exact-duplicate
    // signal, and an OCR result can never be trusted to identify a file.
    const dedup = toDedupSubject(result, financials, doc.fileHash ?? null);
    const done = await this.finalizeExtraction(ctx, id, { text: result.textRedacted, financials, dedup });

    await this.audit.record(ctx, 'document.extracted_by_provider', id, {
      providerKey: result.providerKey, confidence: result.overallConfidence, fields: result.fields.length, lineItems: result.lineItems.length,
    });
    // Billed per PAGE. `pages` is what the provider reported, never a guess — a page count we invented would be
    // a number on a tenant's invoice that nothing in the system can justify.
    await this.logOcrUsage(ctx, { action: 'extract', provider: result.providerKey, pages: Math.max(1, result.pages || 1), status: 'success' });
    return { pipelineState: done.pipelineState, providerKey: result.providerKey, unavailable: false };
  }

  /** Classify + validate + dedup an extracted document, then move it to review_required (never past review). */
  async finalizeExtraction(ctx: OcrCtx, id: string, extracted: { text: string | null; financials: DocumentFinancials; dedup: DedupSubject }): Promise<{ pipelineState: PipelineState; validation: ReturnType<typeof buildValidationReport>; duplicateStatus: string }> {
    requireTenant(ctx);
    const doc = await this.docs.get(ctx, id);
    if (!doc) throw new OcrError('NOT_FOUND');
    const { config } = await this.effectiveConfig(ctx);
    const classification = classifyDocument(extracted.text);
    const validation = buildValidationReport(extracted.financials, { tolerance: config.tolerance, highAmountCents: config.highAmountCents, lowConfidenceThreshold: config.lowConfidenceThreshold });
    const candidates = await this.docs.dedupCandidates(ctx, extracted.dedup);
    const dup = detectDuplicates(extracted.dedup, candidates);
    // validating → duplicate_hold if a blocking duplicate, else review_required (always review)
    const ev = dup.blocksAutoProcessing ? 'duplicate_detected' : 'validate_ok';
    const next = transition('validating', ev);
    await this.docs.patch(ctx, id, { pipelineState: next.state, documentType: classification.type, vendor: extracted.financials.vendor, totalCents: extracted.financials.totalCents });
    await this.audit.record(ctx, 'document.extracted', id, { type: classification.type, validation: validation.status, duplicate: dup.status });
    return { pipelineState: next.state, validation, duplicateStatus: dup.status };
  }

  async correctField(ctx: OcrCtx, id: string, field: CorrectableField, patch: { value?: string | null; valueCents?: number | null; confirmOnly?: boolean }) {
    requireTenant(ctx);
    if (!(await this.docs.get(ctx, id))) throw new OcrError('NOT_FOUND');
    const result = applyFieldCorrection(field, { ...patch, userId: ctx.userId });
    await this.audit.record(ctx, 'document.field_corrected', id, { field: result.audit.fieldKey, before: result.audit.before, after: result.audit.after });
    return result.field;
  }

  async startReview(ctx: OcrCtx, id: string) {
    requireTenant(ctx);
    const doc = await this.docs.get(ctx, id); if (!doc) throw new OcrError('NOT_FOUND');
    const next = transition(doc.pipelineState, 'start_review');
    if (!next.ok) throw new OcrError('INVALID_STATE', next.error);
    await this.docs.patch(ctx, id, { pipelineState: next.state });
    return next.state;
  }

  /** Approve/reject/return. Evaluates the tenant approval requirement; advances to 'approved' only when satisfied. */
  async decide(ctx: OcrCtx, id: string, action: 'approve' | 'reject' | 'return', reason?: string) {
    requireTenant(ctx);
    const doc = await this.docs.get(ctx, id); if (!doc) throw new OcrError('NOT_FOUND');
    if (doc.pipelineState !== 'in_review') throw new OcrError('INVALID_STATE', `cannot decide in state ${doc.pipelineState}`);
    const { config } = await this.effectiveConfig(ctx);
    const requirement = evaluateApprovalRequirement({ totalCents: doc.totalCents, category: doc.category }, config.approvalRules);
    const state = await this.docs.loadDecisionState(ctx, id);
    const result = applyDecision(state, { userId: ctx.userId, action, reason, at: new Date().toISOString() }, requirement);
    await this.docs.saveDecisionState(ctx, id, result.state);
    // map decision → pipeline
    const evt = result.state.status === 'approved' ? 'approve' : result.state.status === 'rejected' ? 'reject' : result.state.status === 'returned' ? 'return' : null;
    if (evt) { const next = transition('in_review', evt); if (next.ok) await this.docs.patch(ctx, id, { pipelineState: next.state }); }
    await this.audit.record(ctx, `document.${action}`, id, { outcome: result.state.status, approvers: result.state.approvals.length, required: requirement.approversRequired });
    return { outcome: result.state.status, requirement };
  }

  /** Post an approved document. Hard-gated: refuses unless the pipeline is 'approved'. */
  async post(ctx: OcrCtx, id: string, destination: 'expense' | 'inventory_receipt') {
    requireTenant(ctx);
    const doc = await this.docs.get(ctx, id); if (!doc) throw new OcrError('NOT_FOUND');
    if (!canPost(doc.pipelineState)) throw new OcrError('NOT_APPROVED', `document is ${doc.pipelineState}, not approved`);
    const pctx: PostingCtx = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    const approved: ApprovedDocument = { documentId: doc.id, isApproved: true, postingVersion: doc.postingVersion, vendor: doc.vendor, totalCents: doc.totalCents, incurredOn: doc.documentDate, category: doc.category, description: null, purchaseOrderId: doc.purchaseOrderId ?? null };
    const rec = destination === 'expense' ? await this.posting.postExpense(pctx, approved) : await this.posting.postInventoryReceipt(pctx, approved);
    const next = rec.status === 'posted' ? transition('approved', 'post_ok') : transition('approved', 'post_failed');
    await this.docs.patch(ctx, id, { pipelineState: next.state });
    await this.audit.record(ctx, rec.status === 'posted' ? 'document.posted' : 'document.posting_failed', id, { destination, ref: rec.externalRef, error: rec.errorCode });
    if (rec.status !== 'posted') throw new OcrError('POSTING_FAILED', rec.errorCode || 'posting failed', { ref: rec.externalRef });
    return rec;
  }

  async previewUrl(ctx: OcrCtx, id: string, storageKey: string) {
    requireTenant(ctx);
    if (!(await this.docs.get(ctx, id))) throw new OcrError('NOT_FOUND');
    // a missing / non-string key is outside the namespace too (Phase 14: `?key=` absent crashed with a TypeError → 500)
    if (typeof storageKey !== 'string' || !storageKey.startsWith(`tenants/${ctx.tenantId}/`)) throw new OcrError('FORBIDDEN');   // key must be within this tenant's namespace
    return this.files.signedPreview(ctx, storageKey);
  }
}
