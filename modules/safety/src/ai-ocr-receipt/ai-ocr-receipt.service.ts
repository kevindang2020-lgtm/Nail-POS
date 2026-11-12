// ai-ocr-receipt.service.ts — the facade that orchestrates the pure modules through injected ports. It is where tenant
// context is enforced and where the safety rules compose: uploads are validated before storage, the pipeline only
// advances through review, corrections are audited, and posting is gated on approval. Tenant/branch come from ctx
// (server-derived) — never from the client. Ports are bound to Kysely + the existing services in a later stage.
import { systemContext } from '@aipowersalon/tenant-context';
import { type AiUsageLogger, evaluateAiAccess, accessReasonLabel, type AiAccessSnapshot, type AiProviderTaskGateway } from '@aipowersalon/ai';
import { classifyDocument } from './ai-ocr-receipt-core';
import { buildValidationReport, reconcileDocument, type DocumentFinancials, type ValidationCheck } from './ai-ocr-receipt-validation';
import { detectDuplicates, type DuplicateCandidate, type DedupSubject } from './ai-ocr-receipt-dedup';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS, type SettingsRow, type OcrReceiptConfig } from './ai-ocr-receipt-settings';
import { validateUpload, storageKeyFor, resolveScanDisposition, type UploadInput, type MalwareScanPort, type ScanStatus } from './ai-ocr-receipt-upload';
import { transition, canPost, runOcrWithFallback, type OcrProvider, type OcrInput, type PipelineState, type OcrFieldOut, type OcrLineOut } from './ai-ocr-receipt-pipeline';
import type { ConfidenceState } from './ai-ocr-receipt-core';
import { toFinancials, toDedupSubject } from './ai-ocr-receipt.textract';

/** The tenant's AI entitlement for this package. Same repo the AI assistant and tenant-ai surfaces already use —
 *  one gate, one source of truth, no second opinion about whether a tenant may run AI. */
/** extras OCR #02: a document's money parts (integer cents) as stored on ocr_documents — null when not read / not entered */
export interface OcrDocumentAmounts { subtotalCents: number | null; taxCents: number | null; feesCents: number | null; discountCents: number | null; totalCents: number | null }

export interface OcrAccessRepo { loadSnapshot(tenantId: string, packageCode: string, userId: string | null): Promise<AiAccessSnapshot>; }
import { applyFieldCorrection, evaluateApprovalRequirement, applyDecision, type ReviewDecisionState, type CorrectableField } from './ai-ocr-receipt-review';
import { PostingService, type ApprovedDocument, type PostingCtx } from './ai-ocr-receipt-posting';
import { OcrError, type OcrErrorCode } from './ai-ocr-receipt-errors';
import type { ReceiptEventsPort, ReceiptEventKind } from './ai-ocr-receipt-events';
import { acceptUpload, UploadRejected, UPLOAD_POLICIES, type StorageQuotaPort } from '@aipowersalon/media';
import { analyzeReceiptImage, makeDerivatives, type QualityFlag } from './ai-ocr-receipt-quality';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export interface OcrCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[]; }
const requireTenant = (ctx: OcrCtx) => { if (!ctx?.tenantId) throw new OcrError('TENANT_REQUIRED'); };
/** the validator's reasons → the one error code the client reads (typed — no cast) */
const uploadErrorCode = (errors: string[]): OcrErrorCode => (errors.includes('TOO_LARGE') ? 'FILE_TOO_LARGE' : (errors.includes('UNKNOWN_TYPE') || errors.includes('DISALLOWED_TYPE')) ? 'UNSUPPORTED_TYPE' : 'INVALID_UPLOAD');
const policyErrorCode = (reason: string): OcrErrorCode => (reason === 'TOO_LARGE' ? 'FILE_TOO_LARGE' : reason === 'TYPE_NOT_ALLOWED' ? 'UNSUPPORTED_TYPE' : 'INVALID_UPLOAD');

/** The AI package this module bills under. `ai_usage_logs.package_code` is NOT NULL with no default, and this is
 *  the same code the sidebar gates the screen on (`aiPackageCode: 'ai_ocr_receipt_scanner'`) — one identifier. */
export const OCR_PACKAGE_CODE = 'ai_ocr_receipt_scanner';
/** §30: the registered AI task (modules/ai ai-task-registry.ts) receipt extraction runs as. */
export const OCR_TASK_KEY = 'ocr.receipt_extract';

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
  // migration 700 (Oct 27 2026)
  pageCount?: number;                       // §17: pages under ONE document (page files in ocr_document_pages)
  qualityFlags?: string[];                  // §25: pre-OCR heuristics; advice for "Retake / Process anyway", never a failure
  extractionAttempts?: number;              // §115: the retry ladder
  nextExtractionAt?: string | null;         // §115: when the next automatic try is due; null in extraction_failed = the dead letter
  lastExtractionError?: string | null;
  suggestedExpenseId?: string | null;       // §142: the existing expense this receipt could be the evidence for (a suggestion)
  suggestedMatch?: 'matched' | 'possible_match' | 'unmatched' | null;
  sourceChannel?: string | null;            // §12
  thumbnailKey?: string | null;             // §159: the derived thumbnail's key (signed through preview-url), never bytes
  // Oct 28 2026 (audit F1, §36 / §37 / §200): the money parts a reviewer can correct — the posting reads them from this row
  subtotalCents?: number | null; taxCents?: number | null; feesCents?: number | null; discountCents?: number | null;
}
/** §12: the channels a caller may name; anything else is recorded as plain 'upload' */
export type UploadSource = 'pos_upload' | 'owner_app_upload' | 'mobile_camera' | 'web_upload' | 'api_import';
/** §115: attempts before an extraction is left in extraction_failed for a person (the dead letter) */
export const OCR_MAX_EXTRACTION_ATTEMPTS = 3;
/** §115: 2^n minutes between automatic retries (1, 2, 4 …), capped at an hour */
export function extractionRetryDelayMs(attempts: number): number { return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1)); }
/** §142: the finance module's receipt → existing-expense suggestion (bound by the module; absent → no suggestion is made) */
export interface ExpenseSuggestionPort { suggestExpenseForReceipt(ctx: OcrCtx, documentId: string): Promise<{ verdict: 'matched' | 'possible_match' | 'unmatched'; expenseId: string | null; reason: string | null }> }
/** §113/§114: the durable job queue the upload hands extraction to (bound by the module with a database; absent → inline) */
export interface ExtractionJobPort { enqueue(ctx: OcrCtx, documentId: string): Promise<void> }
/** §74/§75: the salon's receptionist_upload / technician_upload switches (finance expense settings) — a reason when the caller's
 *  role may not upload, null when it may. Bound by the module; absent → not enforced here (the permission key still gates the route). */
export interface UploadPolicyPort { refuse(ctx: OcrCtx): Promise<string | null> }
export const uploadRefusalFor = (role: string | null | undefined, s: { receptionistUpload: boolean; technicianUpload: boolean } | null): string | null => {
  const r = String(role ?? '').toUpperCase();
  if ((r === 'FRONT_DESK' || r === 'RECEPTION' || r === 'RECEPTIONIST') && !(s?.receptionistUpload ?? false)) return 'receptionist_upload_off';
  if (r === 'TECHNICIAN' && !(s?.technicianUpload ?? false)) return 'technician_upload_off';
  return null;
};
/** M3: the stricter of the inline scan (upload policy) and the bucket tag: infected anywhere → infected; clean from either
 *  real scanner → clean; otherwise unscanned (never a guessed clean). */
export function combineScanVerdicts(inline: 'clean' | 'infected' | 'unscanned' | undefined, tagged: ScanStatus): ScanStatus {
  if (inline === 'infected' || tagged === 'infected') return 'infected';
  if (tagged === 'error') return inline === 'clean' ? 'clean' : 'error';
  if (inline === 'clean' || tagged === 'clean') return 'clean';
  return 'unscanned';
}
export interface DocStorePort {
  create(ctx: OcrCtx, rec: Partial<DocRecord>): Promise<DocRecord>;
  get(ctx: OcrCtx, id: string): Promise<DocRecord | null>;
  list(ctx: OcrCtx, filters: Record<string, unknown>): Promise<{ items: DocRecord[]; total: number }>;
  patch(ctx: OcrCtx, id: string, patch: Partial<DocRecord>): Promise<void>;
  /** M3 (Oct 23 2026): `excludeDocumentId` — the document being checked is never its own duplicate (an identical file hash
   *  matched ITSELF, so every extracted receipt looked like an exact duplicate of itself). */
  dedupCandidates(ctx: OcrCtx, subject: DedupSubject, excludeDocumentId?: string): Promise<DuplicateCandidate[]>;
  /** M3: the background pipeline sweep's population — every salon's documents in these states, older than the cutoff. */
  stalled?(states: readonly PipelineState[], olderThan: Date, limit: number): Promise<{ id: string; tenantId: string; branchId: string | null; pipelineState: PipelineState }[]>;
  saveDecisionState(ctx: OcrCtx, id: string, state: ReviewDecisionState): Promise<void>;
  loadDecisionState(ctx: OcrCtx, id: string): Promise<ReviewDecisionState>;
  // migration 700 (Oct 27 2026) — optional so the existing in-memory fakes in the specs construct unchanged
  pageKeys?(ctx: OcrCtx, id: string): Promise<string[]>;
  addPage?(ctx: OcrCtx, id: string, page: { storageKey: string; width: number | null; height: number | null }): Promise<number>;
  recordExtractionAttempt?(ctx: OcrCtx, id: string, x: { attempts: number; nextAt: Date | null; error: string | null }): Promise<void>;
  retryDue?(now: Date, limit: number): Promise<{ id: string; tenantId: string; branchId: string | null; pipelineState: PipelineState }[]>;
  retentionCandidates?(now: Date, limit: number): Promise<{ id: string; tenantId: string; branchId: string | null; createdAt: string; retentionDays: number; liveExpense: boolean }[]>;
  markRetentionArchived?(ctx: OcrCtx, id: string): Promise<void>;
  // §35–§38 (Oct 27 2026): the per-field reading is PERSISTED (ocr_extracted_fields / ocr_line_items) — the reviewer's
  // "verify this field" marks and the posting's line items and breakdown read it; a correction is stored, never just audited
  saveExtraction?(ctx: OcrCtx, id: string, x: { fields: OcrFieldOut[]; lineItems: OcrLineOut[]; financials: DocumentFinancials; overallConfidence: number; lowConfidenceThreshold: number }): Promise<void>;
  extraction?(ctx: OcrCtx, id: string): Promise<{ fields: StoredField[]; lineItems: Array<{ lineNumber: number; description: string | null; quantity: number | null; unitPriceCents: number | null; lineTotalCents: number | null; confidence: number }>;
    /** the document row's money parts as they stand now (a person's corrections included) — optional for older stores */
    amounts?: OcrDocumentAmounts }>;
  saveFieldCorrection?(ctx: OcrCtx, id: string, field: CorrectableField): Promise<void>;
}
export interface StoredField { key: string; text: string | null; cents: number | null; confidence: number; state: ConfidenceState; page: number | null; correctedValue: string | null }
export interface SettingsStorePort {
  load(ctx: OcrCtx): Promise<SettingsRow[]>;
  /** Oct 22 2026 (deep-scan): PUT /settings used to answer the effective config without saving anything. Upserts one
   *  tenant- or branch-level row and appends its version to ocr_ai_config_versions; false → the branch is not this tenant's. */
  save?(ctx: OcrCtx, row: SettingsRow): Promise<boolean>;
}
export interface FileStorePort {
  store(ctx: OcrCtx, documentId: string, ext: string, bytes: Uint8Array): Promise<{ storageKey: string }>;
  /** M3: the scan verdict at upload (inline ClamAV / bucket tag) on the file row — optional */
  recordScan?(ctx: OcrCtx, documentId: string, status: ScanStatus): Promise<void>;
  signedPreview(ctx: OcrCtx, storageKey: string): Promise<{ url: string; expiresAt: string }>;
  /** §17 (Oct 27 2026): one more page file of the same document */
  storePage?(ctx: OcrCtx, documentId: string, pageNumber: number, ext: string, bytes: Uint8Array): Promise<{ storageKey: string }>;
  /** §24/§159: a derived copy beside the untouched original; null when nothing could be stored (no bucket) */
  storeDerivative?(ctx: OcrCtx, documentId: string, kind: 'thumbnail' | 'processed', bytes: Uint8Array): Promise<{ storageKey: string } | null>;
}
export interface AuditSink { record(ctx: OcrCtx, action: string, documentId: string, meta: Record<string, unknown>): Promise<void>; }

export class AiOcrReceiptService {
  /** Phase 12 (#34): the salon's storage quota (the API's QuotaService), set by the module; absent → not charged. */
  storageQuota: StorageQuotaPort | null = null;
  /** mandate §150: expense_receipt.* on the outbox (bound by the module; best-effort — an event never fails the receipt) */
  events: ReceiptEventsPort | null = null;
  private async emit(ctx: OcrCtx, kind: ReceiptEventKind, id: string, payload: Record<string, unknown>): Promise<void> {
    try { await this.events?.emit(ctx, kind, id, payload); } catch (e) { await this.audit.record(ctx, 'document.event_failed', id, { kind, error: (e as Error).message }); }   // logged on the receipt's own audit trail; never fails the receipt
  }

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

  /** §30 (Oct 27 2026): the central AI gateway's door for non-LLM providers (modules/ai AiProviderTaskGateway). Bound by the
   *  module with a database: extraction is then admitted as the registered task 'ocr.receipt_extract' (task registry,
   *  entitlement / quota, tenant + platform safety switches) and every provider attempt goes through the shared circuit
   *  breakers, the task's timeout and the ai_usage_logs ledger — the module's own entitlement check and usage row are
   *  then not used. Unbound (dev / tests) → the module's own checks, as before. */
  gateway: Pick<AiProviderTaskGateway, 'admit' | 'call'> | null = null;
  /**
   * Oct 28 2026 (Receipt mandate audit F2, §72 / §196): the branches this person may see — the finance module's bound branch
   * rule (ExpenseService.visibleBranches → the Owner App's resolveBranchScope; ONE rule, bound in the module). null = all.
   * Receipt documents were tenant-scoped only: a branch-A user could list, preview, correct, approve and post branch B's.
   */
  visibleBranches: ((ctx: OcrCtx) => Promise<string[] | null>) | null = null;
  private async scopeFor(ctx: OcrCtx): Promise<string[] | null> {
    if (!this.visibleBranches || String(ctx.userId ?? '').startsWith('system:')) return null;   // the pipeline acts salon-wide
    return this.visibleBranches(ctx);
  }
  /** a document outside the person's branches answers exactly like a missing one */
  private async scopedDoc(ctx: OcrCtx, id: string): Promise<DocRecord | null> {
    const doc = await this.docs.get(ctx, id);
    if (!doc) return null;
    const scope = await this.scopeFor(ctx);
    if (scope && !(doc.branchId && scope.includes(doc.branchId))) return null;
    return doc;
  }
  /** the documents list, within the person's branches (filtered in the query, so the totals stay right) */
  async listDocuments(ctx: OcrCtx, filters: Record<string, unknown>) {
    requireTenant(ctx);
    const scope = await this.scopeFor(ctx);
    return this.docs.list(ctx, { ...(filters ?? {}), branchIds: scope });
  }
  /** §142 (Oct 27 2026): the finance module's suggestion of an EXISTING expense for a receipt that reaches review; bound by the module */
  expenseSuggestions: ExpenseSuggestionPort | null = null;
  /** §113/§114 (Oct 27 2026): extraction leaves the request thread — the upload enqueues a durable job (class 'ai') and answers;
   *  unbound (no database / the existing specs) the upload still extracts inline, exactly as before */
  extractionJobs: ExtractionJobPort | null = null;
  /** §74/§75 (Oct 27 2026): the owner's receptionist / technician upload switches, enforced at upload (they were stored and read by nothing) */
  uploadPolicy: UploadPolicyPort | null = null;
  private async requireUploadAllowed(ctx: OcrCtx): Promise<void> {
    const why = this.uploadPolicy ? await this.uploadPolicy.refuse(ctx) : null;
    if (why) throw new OcrError('FORBIDDEN', why === 'technician_upload_off' ? 'Technicians cannot upload receipts at this salon (the owner can turn it on under Expenses → Settings).' : 'The front desk cannot upload receipts at this salon (the owner can turn it on under Expenses → Settings).', { reason: why });
  }
  /** The providers, each attempt through the gateway when one is bound. */
  private async gatedProviders(ctx: OcrCtx): Promise<OcrProvider[]> {
    const g = this.gateway;
    if (!g) { await this.requireAiEntitlement(ctx); return this.providers; }
    const req = { taskKey: OCR_TASK_KEY, tenantId: ctx.tenantId, userId: ctx.userId ?? null, branchId: ctx.branchId ?? null };
    let admitted: Awaited<ReturnType<AiProviderTaskGateway['admit']>>;
    try { admitted = await g.admit(req); }
    catch (e: any) {
      if (e?.decision) throw new OcrError(e.decision.limitExceeded ? 'AI_USAGE_LIMIT_REACHED' : 'MODULE_DISABLED', accessReasonLabel(e.decision.reason),
        { reason: e.decision.reason, subscriptionStatus: e.decision.subscriptionStatus, upgradeRequired: e.decision.upgradeRequired, remainingUsage: e.decision.remainingUsage });
      if (e?.code === 'AI_TASK_DISABLED') throw new OcrError('MODULE_DISABLED', String(e.message), { reason: 'ai_task_disabled' });
      throw e;
    }
    return this.providers.map((p) => ({
      key: p.key, connected: p.connected, costRank: p.costRank, supports: (m: string) => p.supports(m),
      extract: (input: OcrInput) => g.call({ ...req, provider: p.key, model: p.key === 'aws-textract' ? 'textract-analyze-expense' : null }, admitted, () => p.extract(input),
        // tenant unit: ONE scan per extraction (ai-catalog sells scans); platform cost: per page, as AWS bills it
        (r) => (r.unavailable ? null : { usageAmount: 1, costMicroUsd: Math.max(1, r.pages || 1) * ocrCostMicroUsdPerPage() })),
    }));
  }

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

  /** PUT /settings: store one layer (tenant, or a branch of this tenant), then answer the new effective config. Only the
   *  known config keys are kept; the read side still clamps every number and forces piiMasking + humanReviewRequired. */
  async saveSettings(ctx: OcrCtx, body: { level?: string; branchId?: string | null; enabled?: boolean | null; config?: Record<string, unknown> | null }): Promise<{ enabled: boolean; config: OcrReceiptConfig }> {
    requireTenant(ctx);
    if (!this.settings.save) throw new OcrError('MODULE_DISABLED', 'Receipt OCR settings cannot be saved without the database.');
    const level = body?.level === 'branch' ? 'branch' : body?.level === 'tenant' ? 'tenant' : null;
    if (!level) throw new OcrError('INVALID_UPLOAD', "level must be 'tenant' or 'branch'");
    const branchId = level === 'branch' ? (body.branchId || ctx.branchId || null) : null;
    if (level === 'branch' && !branchId) throw new OcrError('INVALID_UPLOAD', 'branch-level settings need a branchId');
    const known = new Set(Object.keys(PLATFORM_DEFAULTS));
    const config = body?.config && typeof body.config === 'object'
      ? Object.fromEntries(Object.entries(body.config).filter(([k]) => known.has(k) && k !== 'piiMasking' && k !== 'humanReviewRequired')) as Partial<OcrReceiptConfig>
      : null;
    const ok = await this.settings.save(ctx, { level, branch_id: branchId, enabled: typeof body?.enabled === 'boolean' ? body.enabled : null, config });
    if (!ok) throw new OcrError('NOT_FOUND', 'Branch not found');
    await this.audit.record(ctx, 'settings.saved', branchId ?? ctx.tenantId, { level, branchId, enabled: body?.enabled ?? null, keys: Object.keys(config ?? {}) });
    return this.effectiveConfig(level === 'branch' ? { ...ctx, branchId } : ctx);
  }

  /** Upload: validate BEFORE storage; store original; run malware disposition; create the document row.
   *  Oct 27 2026: `source` (§12) names the channel; `deferExtraction` (§17/§18) holds a multi-page document in `extracting`
   *  until the caller has appended its pages and calls extract; the answer carries the §25 quality flags and the §159 thumbnail key. */
  async upload(ctx: OcrCtx, input: UploadInput & { bytes: Uint8Array; source?: UploadSource | null; deferExtraction?: boolean | null }): Promise<{ documentId: string; pipelineState: PipelineState; quality: { flags: QualityFlag[]; difficult: boolean }; thumbnailKey: string | null; pageCount: number }> {
    requireTenant(ctx);
    await this.requireUploadAllowed(ctx);
    const { enabled, config } = await this.effectiveConfig(ctx);
    if (!enabled) throw new OcrError('MODULE_DISABLED');
    const v = validateUpload(input, config);
    if (!v.ok) throw withCode(new OcrError(uploadErrorCode(v.errors), `upload rejected: ${v.errors.join(',')}`, { errors: v.errors }), 'UPLOAD_REJECTED');
    // §22/§25: the server measures the image itself (dimensions from the header, luminance / contrast / sharpness from the
    // decoded pixels) — the client's width / height were the only measurement before. A flag is advice, never a rejection.
    const quality = analyzeReceiptImage(input.bytes, v.detected.mime);
    if (quality.width != null && quality.height != null && quality.width * quality.height > 100_000_000) throw new OcrError('INVALID_UPLOAD', 'upload rejected: DECOMPRESSION_BOMB', { errors: ['DECOMPRESSION_BOMB'] });
    // Phase 12 (#34): the one upload policy on top of the OCR checks — the client's file name must carry an allowed
    // extension, and the bytes are charged to the salon's storage quota (a JSON body: the multipart guard never saw it).
    // The original is kept EXACT (ocrReceipt.stripMetadata = false): it is the evidence a reviewer compares against.
    let up;
    try { up = await acceptUpload({ ...UPLOAD_POLICIES.ocrReceipt, maxBytes: config.maxFileSizeBytes }, { bytes: input.bytes, filename: input.filename, tenantId: ctx.tenantId }, { quota: this.storageQuota }); }
    catch (e) { if (e instanceof UploadRejected) throw withCode(new OcrError(policyErrorCode(e.reason), `upload rejected: ${e.reason}`, { errors: [e.reason] }), 'UPLOAD_REJECTED'); throw e; }
    const doc = await this.docs.create(ctx, { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1, sourceChannel: input.source ?? 'upload', qualityFlags: quality.flags, pageCount: 1 });
    try { await this.files.store(ctx, doc.id, v.ext, input.bytes); }
    catch (e) { if (up.quotaReservedBytes) await this.storageQuota?.releaseStorage(ctx.tenantId, up.quotaReservedBytes).catch(() => undefined); throw e; }
    // §24/§159: the derived copies (thumbnail for lists; a review / OCR copy for a big photo) — best-effort beside the original,
    // which is never touched; a derivative that cannot be made or stored costs nothing but the thumbnail
    let thumbnailKey: string | null = null;
    if (this.files.storeDerivative) {
      try { for (const d of makeDerivatives(input.bytes, v.detected.mime)) { const r = await this.files.storeDerivative(ctx, doc.id, d.kind, d.png); if (d.kind === 'thumbnail' && r) thumbnailKey = r.storageKey; } }
      catch (e) { await this.audit.record(ctx, 'document.derivative_failed', doc.id, { error: (e as Error).message }); }
    }
    // malware disposition (honest: unscanned + required → quarantine)
    // M3 (Oct 23 2026): TWO honest verdicts — the inline scanner the upload policy ran on the bytes (ClamAV when CLAMAV_HOST
    // is set; 'clean' only from a real scan) and the bucket's out-of-band tag (GuardDuty-style). A ClamAV-only salon used
    // to quarantine every receipt forever: the inline 'clean' was thrown away and the tag never comes.
    const tagged: ScanStatus = (await this.scanner.scan(ctx.tenantId, storageKeyFor(ctx.tenantId, doc.id, 'original', v.ext))).status;
    const scan: ScanStatus = combineScanVerdicts(up.scanStatus, tagged);
    if (scan !== 'unscanned') await this.files.recordScan?.(ctx, doc.id, scan);
    const disposition = resolveScanDisposition(scan, config);
    const next = disposition === 'reject' ? transition('uploaded', 'scan_infected') : disposition === 'quarantine' ? transition('uploaded', 'scan_quarantine') : transition('uploaded', 'scan_clean');
    await this.docs.patch(ctx, doc.id, { pipelineState: next.state });
    await this.audit.record(ctx, 'document.uploaded', doc.id, { disposition, scan, inline: up.scanStatus, tagged, source: input.source ?? 'upload', quality: quality.flags, pages: 1 });
    await this.emit(ctx, disposition === 'reject' ? 'processing_failed' : 'uploaded', doc.id, disposition === 'reject' ? { pipelineState: next.state, reason: 'malware_detected' } : { pipelineState: next.state, scan, qualityFlags: quality.flags });

    const answer = (pipelineState: PipelineState) => ({ documentId: doc.id, pipelineState, quality: { flags: quality.flags, difficult: quality.difficult }, thumbnailKey, pageCount: 1 });
    // Auto-run OCR when the tenant asked for it AND the file actually cleared scanning. This NEVER auto-posts —
    // extraction lands the document at review_required (or manual_entry_required), and only a human approval can
    // move it toward the books. A failure here must not fail the upload: the bytes are safely stored, so we leave
    // the document in `extracting` and let the reviewer press Run extraction.
    // §17/§18: a caller that will append pages asks for extraction to wait (deferExtraction) and calls extract itself.
    if (config.autoPipeline && next.state === 'extracting' && !input.deferExtraction) {
      // §113/§114 (Oct 27 2026): with the job queue bound the upload ANSWERS NOW and the worker extracts (the 5-minute sweep
      // is the net under the queue); without it (no database, the existing specs) extraction runs inline as before
      if (this.extractionJobs) {
        try { await this.extractionJobs.enqueue(ctx, doc.id); } catch (e) { await this.audit.record(ctx, 'document.extraction_enqueue_failed', doc.id, { error: (e as Error).message }); }
        return answer(next.state);
      }
      try {
        const ex = await this.runExtraction(ctx, doc.id);
        return answer(ex.pipelineState);
      } catch {
        return answer(next.state);
      }
    }
    return answer(next.state);
  }

  /**
   * §17/§18 (Oct 27 2026): one more PAGE of an existing document — "page 2, page 3 under one receipt", never a second
   * document and never a second expense. Allowed while the document is still waiting to be read (uploaded / quarantined /
   * extracting); the same validation and scan rules as the first page apply (an infected page rejects the whole document).
   * The caller then runs extract (deferExtraction on the first upload holds the automatic run until the pages are in).
   */
  async appendPage(ctx: OcrCtx, id: string, input: UploadInput & { bytes: Uint8Array }): Promise<{ documentId: string; pageCount: number; pipelineState: PipelineState; quality: { flags: QualityFlag[]; difficult: boolean } }> {
    requireTenant(ctx);
    await this.requireUploadAllowed(ctx);
    const doc = await this.scopedDoc(ctx, id);
    if (!doc) throw new OcrError('NOT_FOUND');
    if (!['uploaded', 'quarantined', 'extracting', 'manual_entry_required', 'extraction_failed'].includes(doc.pipelineState)) throw new OcrError('INVALID_STATE', `pages can be added while a document waits to be read, not in '${doc.pipelineState}'`);
    if (!this.docs.addPage || !this.files.storePage) throw new OcrError('MODULE_DISABLED', 'Multi-page receipts need the database.');
    const { config } = await this.effectiveConfig(ctx);
    if ((doc.pageCount ?? 1) >= config.maxPages) throw new OcrError('INVALID_UPLOAD', `upload rejected: TOO_MANY_PAGES (this salon allows ${config.maxPages})`, { errors: ['TOO_MANY_PAGES'] });
    const v = validateUpload(input, config);
    if (!v.ok) throw withCode(new OcrError(uploadErrorCode(v.errors), `upload rejected: ${v.errors.join(',')}`, { errors: v.errors }), 'UPLOAD_REJECTED');
    let up;
    try { up = await acceptUpload({ ...UPLOAD_POLICIES.ocrReceipt, maxBytes: config.maxFileSizeBytes }, { bytes: input.bytes, filename: input.filename, tenantId: ctx.tenantId }, { quota: this.storageQuota }); }
    catch (e) { if (e instanceof UploadRejected) throw withCode(new OcrError(policyErrorCode(e.reason), `upload rejected: ${e.reason}`, { errors: [e.reason] }), 'UPLOAD_REJECTED'); throw e; }
    const quality = analyzeReceiptImage(input.bytes, v.detected.mime);
    const pageNumber = (doc.pageCount ?? 1) + 1;
    let stored: { storageKey: string };
    try { stored = await this.files.storePage(ctx, doc.id, pageNumber, v.ext, input.bytes); }
    catch (e) {
      // the page was not stored: give the quota back (a failure to release is audited, never hidden) and surface the store error
      if (up.quotaReservedBytes) await this.storageQuota?.releaseStorage(ctx.tenantId, up.quotaReservedBytes).catch((x: unknown) => this.audit.record(ctx, 'document.quota_release_failed', doc.id, { error: (x as Error).message }));
      throw e;
    }
    const pageCount = await this.docs.addPage(ctx, doc.id, { storageKey: stored.storageKey, width: quality.width, height: quality.height });
    const tagged: ScanStatus = (await this.scanner.scan(ctx.tenantId, stored.storageKey)).status;
    const scan = combineScanVerdicts(up.scanStatus, tagged);
    let state = doc.pipelineState;
    if (scan === 'infected') { state = 'rejected'; await this.docs.patch(ctx, doc.id, { pipelineState: state }); await this.emit(ctx, 'processing_failed', doc.id, { pipelineState: state, reason: 'malware_detected', page: pageCount }); }   // one infected page rejects the whole document
    const flags = [...new Set([...(doc.qualityFlags ?? []), ...quality.flags])];
    await this.docs.patch(ctx, doc.id, { qualityFlags: flags });
    await this.audit.record(ctx, 'document.page_added', doc.id, { page: pageCount, scan, quality: quality.flags });
    return { documentId: doc.id, pageCount, pipelineState: state, quality: { flags: quality.flags, difficult: quality.difficult } };
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
    const doc = await this.scopedDoc(ctx, id);
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
    const doc = await this.scopedDoc(ctx, id);
    if (!doc) throw new OcrError('NOT_FOUND');
    if (doc.pipelineState !== 'extracting')
      throw new OcrError('INVALID_STATE', `extraction applies to documents in 'extracting', not '${doc.pipelineState}'`);

    // Checked BEFORE the provider is called — an unentitled tenant must not incur a Textract charge, and the
    // document stays exactly where it is so it can be extracted once the subscription is sorted out. Nothing is
    // lost: the bytes are stored and the reviewer can still key the values in by hand.
    const providers = await this.gatedProviders(ctx);   // §30: admitted through the central AI gateway when bound

    const storageKey = doc.storageKey || null;
    const mime = mimeForKey(storageKey);

    const pageKeys = this.docs.pageKeys ? await this.docs.pageKeys(ctx, id) : [];   // §17: page 2 … under this document
    const result = storageKey
      ? await runOcrWithFallback(providers, {
          tenantId: ctx.tenantId, documentId: id, storageKey, mime, pageCount: 1 + pageKeys.length, pageKeys,
        })
      // No stored object → nothing to read. Honest: manual entry, not a fabricated extraction.
      : { unavailable: true as const, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 };

    if (result.unavailable) {
      // §115 (Oct 27 2026): a provider that IS connected and failed gets the retry ladder — attempts 1, 2 wait in
      // extraction_failed with a due time (1 min, 2 min; the sweep retries them); the 3rd failure is terminal:
      // extraction_failed with no due time = the dead letter a person sees (Retry / Enter manually; counted on the
      // Super Admin overview). No provider at all → manual entry at once (there is nothing to retry).
      const attempts = (doc.extractionAttempts ?? 0) + 1;
      const retryable = this.providers.length > 0 && !!this.docs.recordExtractionAttempt;
      if (retryable) {
        const next = transition('extracting', 'extract_failed');
        if (!next.ok) throw new OcrError('INVALID_STATE', next.error);
        const terminal = attempts >= OCR_MAX_EXTRACTION_ATTEMPTS;
        const nextAt = terminal ? null : new Date(Date.now() + extractionRetryDelayMs(attempts));
        await this.docs.patch(ctx, id, { pipelineState: next.state });
        await this.docs.recordExtractionAttempt!(ctx, id, { attempts, nextAt, error: 'extraction_unavailable' });
        await this.audit.record(ctx, terminal ? 'document.extraction_dead_letter' : 'document.extraction_retry_scheduled', id, { attempt: attempts, nextAt: nextAt?.toISOString() ?? null, mime });
        if (terminal) await this.emit(ctx, 'processing_failed', id, { pipelineState: next.state, reason: 'max_attempts', attempts, manualEntry: false });
        if (!this.gateway) await this.logOcrUsage(ctx, { action: 'extract', provider: this.providers[0]?.key ?? null, pages: 0, status: 'provider_error', error: 'extraction_unavailable' });
        return { pipelineState: next.state, providerKey: null, unavailable: true };
      }
      const next = transition('extracting', 'extract_unavailable');
      if (!next.ok) throw new OcrError('INVALID_STATE', next.error);
      await this.docs.patch(ctx, id, { pipelineState: next.state });
      await this.docs.recordExtractionAttempt?.(ctx, id, { attempts, nextAt: null, error: this.providers.length ? 'extraction_unavailable' : 'no_provider' });
      await this.audit.record(ctx, 'document.extraction_unavailable', id, { providers: this.providers.length, mime });
      await this.emit(ctx, 'processing_failed', id, { pipelineState: next.state, reason: this.providers.length ? 'provider_failed' : 'no_provider', manualEntry: true });

      // Usage is recorded ONLY when a provider was actually attempted. With no provider bound (the default
      // deployment) nothing was called, nothing was billed, and writing a zero-cost row would put phantom OCR
      // activity on the tenant's AI Usage screen for work that never happened. A provider that WAS tried and
      // failed is a different thing — it may well have been billed — so that one is logged, with 0 pages and
      // `provider_error`, which is exactly what the status column is for.
      if (this.providers.length > 0 && !this.gateway) {   // the gateway already ledgered each failed attempt
        await this.logOcrUsage(ctx, { action: 'extract', provider: this.providers[0]?.key ?? null, pages: 0, status: 'provider_error', error: 'extraction_unavailable' });
      }
      return { pipelineState: next.state, providerKey: null, unavailable: true };
    }

    await this.docs.recordExtractionAttempt?.(ctx, id, { attempts: (doc.extractionAttempts ?? 0) + 1, nextAt: null, error: null });
    const financials = toFinancials(result);
    // §35–§38: the per-field reading, its confidences and the line items are stored with the document (they were only ever
    // summarised onto the document row — the reviewer could not see WHICH field was weak, and the posting had no lines)
    if (this.docs.saveExtraction) {
      const { config } = await this.effectiveConfig(ctx);
      await this.docs.saveExtraction(ctx, id, { fields: result.fields, lineItems: result.lineItems, financials, overallConfidence: result.overallConfidence, lowConfidenceThreshold: config.lowConfidenceThreshold });
    }
    // fileHash comes from the STORED BYTES (written at upload), not from extraction — it is the exact-duplicate
    // signal, and an OCR result can never be trusted to identify a file.
    const dedup = toDedupSubject(result, financials, doc.fileHash ?? null, doc.perceptualHash ?? null);   // §31: both hashes from the stored bytes
    const done = await this.finalizeExtraction(ctx, id, { text: result.textRedacted, financials, dedup });

    await this.audit.record(ctx, 'document.extracted_by_provider', id, {
      providerKey: result.providerKey, confidence: result.overallConfidence, fields: result.fields.length, lineItems: result.lineItems.length,
    });
    // Billed per PAGE. `pages` is what the provider reported, never a guess — a page count we invented would be
    // a number on a tenant's invoice that nothing in the system can justify.
    if (!this.gateway) await this.logOcrUsage(ctx, { action: 'extract', provider: result.providerKey, pages: Math.max(1, result.pages || 1), status: 'success' });   // gateway: ledgered by the call
    return { pipelineState: done.pipelineState, providerKey: result.providerKey, unavailable: false };
  }

  /** Classify + validate + dedup an extracted document, then move it to review_required (never past review). */
  async finalizeExtraction(ctx: OcrCtx, id: string, extracted: { text: string | null; financials: DocumentFinancials; dedup: DedupSubject }): Promise<{ pipelineState: PipelineState; validation: ReturnType<typeof buildValidationReport>; duplicateStatus: string; suggestion?: { verdict: 'matched' | 'possible_match' | 'unmatched'; expenseId: string | null; reason: string | null } | null }> {
    requireTenant(ctx);
    const doc = await this.scopedDoc(ctx, id);
    if (!doc) throw new OcrError('NOT_FOUND');
    const { config } = await this.effectiveConfig(ctx);
    const classification = classifyDocument(extracted.text);
    const validation = buildValidationReport(extracted.financials, { tolerance: config.tolerance, highAmountCents: config.highAmountCents, lowConfidenceThreshold: config.lowConfidenceThreshold });
    const candidates = await this.docs.dedupCandidates(ctx, extracted.dedup, id);
    const dup = detectDuplicates(extracted.dedup, candidates);
    // validating → duplicate_hold if a blocking duplicate, else review_required (always review)
    const ev = dup.blocksAutoProcessing ? 'duplicate_detected' : 'validate_ok';
    const next = transition('validating', ev);
    // M3 (Oct 23 2026): the extracted document number and date are kept (they were read, validated and dedup-checked, then
    // dropped — the reviewer re-typed them and the posting had no date)
    await this.docs.patch(ctx, id, { pipelineState: next.state, documentType: classification.type, vendor: extracted.financials.vendor, totalCents: extracted.financials.totalCents,
      documentNumber: extracted.dedup.documentNumber ?? null, documentDate: extracted.financials.documentDate && !extracted.financials.dateAmbiguous ? extracted.financials.documentDate.slice(0, 10) : null });
    // §142 (Oct 27 2026): is this receipt the evidence for an expense the salon ALREADY recorded? Suggested to the reviewer
    // (MATCHED / POSSIBLE_MATCH / UNMATCHED) — the reviewer links it instead of posting a second expense; never auto-linked.
    let suggestion: { verdict: 'matched' | 'possible_match' | 'unmatched'; expenseId: string | null; reason: string | null } | null = null;
    if (this.expenseSuggestions) {
      try { suggestion = await this.expenseSuggestions.suggestExpenseForReceipt(ctx, id); await this.docs.patch(ctx, id, { suggestedExpenseId: suggestion.expenseId, suggestedMatch: suggestion.verdict }); }
      catch (e) { await this.audit.record(ctx, 'document.suggestion_failed', id, { error: (e as Error).message }); suggestion = null; }
    }
    await this.audit.record(ctx, 'document.extracted', id, { type: classification.type, validation: validation.status, duplicate: dup.status, suggestedMatch: suggestion?.verdict ?? null });
    await this.emit(ctx, 'extracted', id, { pipelineState: next.state, documentType: classification.type, totalCents: extracted.financials.totalCents ?? null, validation: validation.status, duplicate: dup.status });
    await this.emit(ctx, 'review_required', id, { pipelineState: next.state, duplicate: dup.status, validation: validation.status, suggestedMatch: suggestion?.verdict ?? null, suggestedExpenseId: suggestion?.expenseId ?? null });
    return { pipelineState: next.state, validation, duplicateStatus: dup.status, suggestion };
  }

  /**
   * §36/§37 a reviewer edits (or confirms) ONE field. Oct 27 2026: the correction is now STORED — the field row keeps the
   * corrected value and its state (manually_corrected / manually_confirmed, which the low-confidence rule then skips), and a
   * correction of the vendor / total / date / number / subtotal / tax / fees / discount also updates the document row the posting reads. Before, the route
   * received the field's NAME where the pure function expected the field object, audited a before/after of nothing, and
   * persisted nothing — every "tap to edit" was lost.
   */
  async correctField(ctx: OcrCtx, id: string, fieldKey: string | CorrectableField, patch: { value?: string | null; valueCents?: number | null; confirmOnly?: boolean }) {
    requireTenant(ctx);
    const doc = await this.scopedDoc(ctx, id);
    if (!doc) throw new OcrError('NOT_FOUND');
    if (!['review_required', 'in_review', 'duplicate_hold', 'manual_entry_required', 'extraction_failed'].includes(doc.pipelineState)) throw new OcrError('INVALID_STATE', `fields are corrected during review, not in '${doc.pipelineState}'`);
    const key = typeof fieldKey === 'string' ? fieldKey : fieldKey.fieldKey;
    if (!/^[a-z_]{1,64}$/.test(key)) throw new OcrError('INVALID_UPLOAD', 'field must be a field key');
    const stored = this.docs.extraction ? (await this.docs.extraction(ctx, id)).fields.find((f) => f.key === key) : null;
    const field: CorrectableField = typeof fieldKey === 'string'
      ? { fieldKey: key, value: stored?.correctedValue ?? stored?.text ?? null, valueCents: stored?.cents ?? null, state: stored?.state ?? 'missing' }
      : fieldKey;
    if (patch.valueCents != null && (!Number.isInteger(patch.valueCents) || Math.abs(patch.valueCents) > 100_000_000_00)) throw new OcrError('INVALID_UPLOAD', 'valueCents must be whole cents');
    // the money parts are never negative: posting copies them onto expenses, whose columns CHECK >= 0 (672) — refuse here, by name
    if (['subtotal', 'tax', 'fees', 'discount'].includes(key) && patch.valueCents != null && patch.valueCents < 0) throw new OcrError('INVALID_UPLOAD', `${key} cannot be negative`);
    const result = applyFieldCorrection(field, { ...patch, userId: ctx.userId });
    await this.docs.saveFieldCorrection?.(ctx, id, result.field);
    // the document row is what the posting reads (vendor, total, date, number) — a corrected value replaces the reading
    const rowPatch: Partial<DocRecord> = {};
    if (key === 'vendor') rowPatch.vendor = result.field.value;
    if (key === 'total' && result.field.valueCents != null) rowPatch.totalCents = result.field.valueCents;
    // Oct 28 2026 (audit F1): a corrected — or, on a manual-entry receipt, typed — subtotal / tax / fees / discount was saved
    // on the field only; postFromReceipt reads them from the DOCUMENT ROW, so the expense was posted with the old (or no) tax
    if (key === 'subtotal' && result.field.valueCents != null) rowPatch.subtotalCents = result.field.valueCents;
    if (key === 'tax' && result.field.valueCents != null) rowPatch.taxCents = result.field.valueCents;
    if (key === 'fees' && result.field.valueCents != null) rowPatch.feesCents = result.field.valueCents;
    if (key === 'discount' && result.field.valueCents != null) rowPatch.discountCents = result.field.valueCents;
    if (key === 'document_number') rowPatch.documentNumber = result.field.value;
    if (key === 'document_date' && result.field.value && /^\d{4}-\d{2}-\d{2}$/.test(result.field.value)) rowPatch.documentDate = result.field.value;
    if (Object.keys(rowPatch).length) await this.docs.patch(ctx, id, rowPatch);
    await this.audit.record(ctx, 'document.field_corrected', id, { field: result.audit.fieldKey, before: result.audit.before, after: result.audit.after });
    return result.field;
  }

  /** the per-field reading + line items for the review screen (§37/§38): which field is weak, which a person confirmed */
  async extraction(ctx: OcrCtx, id: string) {
    requireTenant(ctx);
    const doc = await this.scopedDoc(ctx, id);
    if (!doc) throw new OcrError('NOT_FOUND');
    const x = this.docs.extraction ? await this.docs.extraction(ctx, id) : { fields: [], lineItems: [] };
    // extras (OCR Receipt Scanner #02 / Receipt Document Recognition #05): the arithmetic evidence for the review workspace —
    // the SAME reconcileDocument rule (and the salon's tolerance) the extraction used, run on the amounts as they stand now,
    // so a person sees whether the lines add up to the subtotal and the parts to the total. Read-only: it changes nothing.
    const amounts = x.amounts ?? null;
    let arithmetic: ValidationCheck[] = [];
    if (amounts) {
      const { config } = await this.effectiveConfig(ctx);
      arithmetic = reconcileDocument({ type: (doc.documentType ?? 'unknown') as DocumentFinancials['type'], vendor: doc.vendor ?? null, documentDate: doc.documentDate ?? null, dateAmbiguous: false,
        subtotalCents: amounts.subtotalCents, taxCents: amounts.taxCents, feesCents: amounts.feesCents, discountCents: amounts.discountCents, totalCents: amounts.totalCents,
        isCreditOrRefund: false, lineItems: x.lineItems.map((l) => ({ lineTotalCents: l.lineTotalCents })), fieldConfidences: [] }, config.tolerance);
    }
    return { fields: x.fields, lineItems: x.lineItems, amounts, arithmetic };
  }

  async startReview(ctx: OcrCtx, id: string) {
    requireTenant(ctx);
    const doc = await this.scopedDoc(ctx, id); if (!doc) throw new OcrError('NOT_FOUND');
    const next = transition(doc.pipelineState, 'start_review');
    if (!next.ok) throw new OcrError('INVALID_STATE', next.error);
    await this.docs.patch(ctx, id, { pipelineState: next.state });
    return next.state;
  }

  /** Approve/reject/return. Evaluates the tenant approval requirement; advances to 'approved' only when satisfied. */
  async decide(ctx: OcrCtx, id: string, action: 'approve' | 'reject' | 'return', reason?: string) {
    requireTenant(ctx);
    const doc = await this.scopedDoc(ctx, id); if (!doc) throw new OcrError('NOT_FOUND');
    if (doc.pipelineState !== 'in_review') throw new OcrError('INVALID_STATE', `cannot decide in state ${doc.pipelineState}`);
    const { config } = await this.effectiveConfig(ctx);
    const requirement = evaluateApprovalRequirement({ totalCents: doc.totalCents, category: doc.category }, config.approvalRules);
    const state = await this.docs.loadDecisionState(ctx, id);
    const result = applyDecision(state, { userId: ctx.userId, action, reason, at: new Date().toISOString() }, requirement);
    await this.docs.saveDecisionState(ctx, id, result.state);
    // map decision → pipeline
    const evt = result.state.status === 'approved' ? 'approve' : result.state.status === 'rejected' ? 'reject' : result.state.status === 'returned' ? 'return' : null;
    if (evt) { const next = transition('in_review', evt); if (next.ok) await this.docs.patch(ctx, id, { pipelineState: next.state }); }
    await this.audit.record(ctx, `document.${action}`, id, { outcome: result.state.status, approvers: result.state.approvals.length, required: requirement.approversRequired, reason: reason ? String(reason).slice(0, 500) : null });   // the reason was lost (Nov 2 2026)
    return { outcome: result.state.status, requirement };
  }

  /** Post an approved document. Hard-gated: refuses unless the pipeline is 'approved'. */
  async post(ctx: OcrCtx, id: string, destination: 'expense' | 'inventory_receipt') {
    requireTenant(ctx);
    const doc = await this.scopedDoc(ctx, id); if (!doc) throw new OcrError('NOT_FOUND');
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

  /** M3 (Oct 23 2026): a posting that FAILED (the finance / inventory write refused) can be tried again — the state machine
   *  always had `failed → approved (retry)`, nothing walked it, so the document was stuck. The posting is idempotent per
   *  document + posting version, so a retry never books a second expense. */
  async retryPost(ctx: OcrCtx, id: string, destination: 'expense' | 'inventory_receipt') {
    requireTenant(ctx);
    const doc = await this.scopedDoc(ctx, id); if (!doc) throw new OcrError('NOT_FOUND');
    const next = transition(doc.pipelineState, 'retry');
    if (!next.ok || next.state !== 'approved') throw new OcrError('INVALID_STATE', `retry posting applies to a failed posting, not '${doc.pipelineState}'`);
    await this.docs.patch(ctx, id, { pipelineState: next.state });
    await this.audit.record(ctx, 'document.posting_retried', id, { destination });
    return this.post(ctx, id, destination);
  }

  /**
   * M3 (Oct 23 2026): the background step of the pipeline (OcrPipelineScheduler, single owner). Out-of-band scanners tag
   * minutes after an upload and an auto-extraction can fail transiently — both used to wait for a person to press a
   * button. Each pass: quarantined / scanning documents are re-asked for their verdict (rescan — never releases an
   * unscanned file); documents left in `extracting` are extracted. Never approves, never posts.
   */
  async sweepPipeline(now: Date = new Date(), opts: { minAgeMs?: number; limit?: number } = {}): Promise<{ rescanned: number; released: number; extracted: number; retried: number; errors: number }> {
    const r = { rescanned: 0, released: 0, extracted: 0, retried: 0, errors: 0 };
    if (!this.docs.stalled) return r;
    const docs = await this.docs.stalled(['quarantined', 'scanning', 'extracting'], new Date(now.getTime() - (opts.minAgeMs ?? 5 * 60_000)), opts.limit ?? 100);
    for (const d of docs) {
      const ctx = systemContext({ tenantId: d.tenantId, branchId: d.branchId, actor: 'ocr-pipeline' }) as unknown as OcrCtx;   // §72: the system acting
      try {
        if (d.pipelineState === 'extracting') {
          if ((await this.effectiveConfig(ctx)).config.autoPipeline) { await this.runExtraction(ctx, d.id); r.extracted++; }
        } else { r.rescanned++; if ((await this.rescan(ctx, d.id)).released) r.released++; }
      } catch { r.errors++; }   // counted and reported by the scheduler; the next pass tries again
    }
    // §115 (Oct 27 2026): failed extractions whose backoff has elapsed are tried again (extraction_failed → extracting → read);
    // a document that has used its attempts has no due time and is never picked up here — it waits for a person
    for (const d of this.docs.retryDue ? await this.docs.retryDue(now, opts.limit ?? 100) : []) {
      const ctx = systemContext({ tenantId: d.tenantId, branchId: d.branchId, actor: 'ocr-pipeline' }) as unknown as OcrCtx;
      try {
        const next = transition('extraction_failed', 'retry');
        if (!next.ok) continue;
        await this.docs.patch(ctx, d.id, { pipelineState: next.state });
        await this.docs.recordExtractionAttempt?.(ctx, d.id, { attempts: (await this.docs.get(ctx, d.id))?.extractionAttempts ?? 0, nextAt: null, error: null });
        await this.runExtraction(ctx, d.id); r.retried++;
      } catch { r.errors++; }
    }
    return r;
  }

  /** A person retries a dead-lettered extraction (extraction_failed with its attempts used): the ladder starts again. */
  async retryExtraction(ctx: OcrCtx, id: string): Promise<{ pipelineState: PipelineState; providerKey: string | null; unavailable: boolean }> {
    requireTenant(ctx);
    const doc = await this.scopedDoc(ctx, id); if (!doc) throw new OcrError('NOT_FOUND');
    const next = transition(doc.pipelineState, 'retry');
    if (!next.ok || next.state !== 'extracting') throw new OcrError('INVALID_STATE', `retry applies to a failed extraction, not '${doc.pipelineState}'`);
    await this.docs.patch(ctx, id, { pipelineState: next.state });
    await this.docs.recordExtractionAttempt?.(ctx, id, { attempts: 0, nextAt: null, error: null });
    await this.audit.record(ctx, 'document.extraction_retried', id, { by: ctx.userId });
    return this.runExtraction(ctx, id);
  }

  /**
   * §131 (Oct 27 2026): retention. Nightly, every salon's documents older than its retentionDays (default 7 years, floor 30
   * days) are marked retention-archived — NEVER deleted, and a document whose expense is still live is reported, not touched
   * (financial records are kept). Returns what it archived and what it would have touched; one owner per tick.
   */
  async sweepRetention(now: Date = new Date(), opts: { limit?: number } = {}): Promise<{ archived: number; keptLiveExpense: number; errors: number }> {
    const r = { archived: 0, keptLiveExpense: 0, errors: 0 };
    if (!this.docs.retentionCandidates || !this.docs.markRetentionArchived) return r;
    for (const d of await this.docs.retentionCandidates(now, opts.limit ?? 200)) {
      const ctx = systemContext({ tenantId: d.tenantId, branchId: d.branchId, actor: 'ocr-retention' }) as unknown as OcrCtx;
      try {
        if (d.liveExpense) { r.keptLiveExpense++; await this.audit.record(ctx, 'document.retention_kept', d.id, { reason: 'live_expense', retentionDays: d.retentionDays }); continue; }
        await this.docs.markRetentionArchived(ctx, d.id); r.archived++;
        await this.audit.record(ctx, 'document.retention_archived', d.id, { retentionDays: d.retentionDays, createdAt: d.createdAt });
      } catch { r.errors++; }
    }
    return r;
  }

  async previewUrl(ctx: OcrCtx, id: string, storageKey: string) {
    requireTenant(ctx);
    if (!(await this.scopedDoc(ctx, id))) throw new OcrError('NOT_FOUND');
    // a missing / non-string key is outside the namespace too (Phase 14: `?key=` absent crashed with a TypeError → 500)
    // Security Deep Scan E8: the key must belong to THIS document (its own folder) — a key from another of the salon's
    // documents (another branch's receipt) was accepted because only the tenant prefix was checked. No path tricks.
    if (typeof storageKey !== 'string' || !storageKey.startsWith(`tenants/${ctx.tenantId}/documents/${id}/`) || storageKey.includes('..') || storageKey.includes('//')) throw new OcrError('FORBIDDEN');
    return this.files.signedPreview(ctx, storageKey);
  }
}
