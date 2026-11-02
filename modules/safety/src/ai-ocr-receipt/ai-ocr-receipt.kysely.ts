// ai-ocr-receipt.kysely.ts — the persistence + infra adapters that bind the AI OCR Receipt service's ports to
// the real database (migration 344 + 359) and to infrastructure. DB-backed adapters read/write the real
// ocr_* tables; the FileStore and MalwareScan are honest NotConnected/unscanned stubs until blob storage and a
// scanning service are wired (they never fabricate a "clean" scan — unscanned defers to tenant policy, which
// quarantines when scanning is required). File bytes + malware scanning now live in ai-ocr-receipt.blob.ts.
// In-memory fakes let the module load without a DB (dev/tests).
import { dateColumnYmd } from '@aipowersalon/date-time';
import { sql } from 'kysely';
import { Logger } from '@nestjs/common';
import { getContext } from '@aipowersalon/observability';
import { assertTransition, type AppDatabase } from '@aipowersalon/database';
import { OCR_POSTING } from './ai-ocr-receipt-lifecycles';
import type {
  OcrCtx, DocRecord, DocStorePort, SettingsStorePort, AuditSink, StoredField,
} from './ai-ocr-receipt.service';
import type { OcrFieldOut, OcrLineOut } from './ai-ocr-receipt-pipeline';
import type { DocumentFinancials } from './ai-ocr-receipt-validation';
import { confidenceState } from './ai-ocr-receipt-validation';
import type { CorrectableField } from './ai-ocr-receipt-review';
import type { ConfidenceState } from './ai-ocr-receipt-core';
import type { DedupSubject, DuplicateCandidate } from './ai-ocr-receipt-dedup';
import type { ReviewDecisionState } from './ai-ocr-receipt-review';
import type { SettingsRow } from './ai-ocr-receipt-settings';

const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => {
  try { return (await q.execute(db)).rows as T[]; } catch { return []; }
};
const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => {
  try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; }
};
/** B-93 (Oct 28 2026): a WRITE that fails throws. `exec` used to swallow every error — a document's state transition
 *  (patch), its extraction-retry ladder, its retention mark and a review decision could all be lost while the caller
 *  carried on as if they were saved. Reads (`rows` / `one`) still degrade to empty. */
const exec = async (db: AppDatabase, q: any): Promise<void> => { await q.execute(db); };
const storeLog = new Logger('OcrReceiptStore');
/** History rows written AFTER the fact they record (the audit row, a posting attempt): best effort like the platform's
 *  AuditService — the operation they describe already happened — but never silent. */
const execLogged = async (db: AppDatabase, q: any, what: string): Promise<void> => {
  try { await q.execute(db); } catch (e: unknown) { storeLog.warn(`${what} not written: ${String((e as Error)?.message ?? e).slice(0, 200)}`); }
};
const INITIAL_DECISION: ReviewDecisionState = { status: 'in_review', approvals: [] };

export const ymdOf = dateColumnYmd;   // the shared rule (@aipowersalon/date-time)
/** A user column takes a real user id only — the pipeline sweep acts as 'system:ocr-pipeline' and records NULL (a raw
 *  non-uuid id there failed every audit row of the sweep). The role column still says who acted. */
const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const userColumn = (id: string | null | undefined): string | null => (id && USER_UUID.test(id) ? id : null);
const toDoc = (r: any): DocRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  branchId: r.branch_id ?? null,
  pipelineState: r.pipeline_status,
  documentType: r.document_type ?? 'unknown',
  vendor: r.vendor ?? null,
  totalCents: r.total_cents == null ? null : Number(r.total_cents),
  category: r.category ?? null,
  fileHash: r.file_hash ?? null,
  perceptualHash: r.perceptual_hash ?? null,
  storageKey: r.storage_key ?? null,
  documentNumber: r.document_number ?? null,
  documentDate: ymdOf(r.document_date),
  postingVersion: r.posting_version == null ? 1 : Number(r.posting_version),
  purchaseOrderId: r.purchase_order_id ?? null,
  // migration 700 (Oct 27 2026): pages, quality, the extraction ladder, the suggested existing expense, the thumbnail key
  pageCount: r.page_count == null ? 1 : Number(r.page_count),
  qualityFlags: Array.isArray(r.quality_flags) ? r.quality_flags.map(String) : [],   // jsonb arrives parsed (driver + PGlite)
  extractionAttempts: r.extraction_attempts == null ? 0 : Number(r.extraction_attempts),
  nextExtractionAt: r.next_extraction_at ? new Date(r.next_extraction_at).toISOString() : null,
  lastExtractionError: r.last_extraction_error ?? null,
  suggestedExpenseId: r.suggested_expense_id ?? null,
  suggestedMatch: r.suggested_match ?? null,
  sourceChannel: r.source_channel ?? null,
  thumbnailKey: r.thumbnail_key ?? null,
});

const DOC_COLS = sql`d.id, d.tenant_id, d.branch_id, d.pipeline_status, d.document_type, d.vendor, d.total_cents, d.document_number, d.document_date,
  d.page_count, d.quality_flags, d.extraction_attempts, d.next_extraction_at, d.last_extraction_error, d.suggested_expense_id, d.suggested_match, d.source_channel`;
/** the thumbnail derivative's key (§159), when one was made — the list never carries bytes */
const THUMB = sql`left join lateral (select storage_key as thumbnail_key from ocr_document_files where tenant_id = d.tenant_id and document_id = d.id and kind = 'thumbnail' order by created_at desc limit 1) t on true`;
const SOURCE_CHANNELS = new Set(['upload', 'pos_upload', 'owner_app_upload', 'mobile_camera', 'web_upload', 'email', 'mobile', 'api', 'api_import', 'forwarded']);

// ── DB-backed DocStore over ocr_documents (+ ocr_document_files for hashes, ocr_reviews for decision state) ──
export class KyselyDocStore implements DocStorePort {
  constructor(private readonly db: NonNullable<AppDatabase>) {}
  /** the writes that must not degrade silently (pages, the per-field reading, corrections) need a real database */
  private get live(): NonNullable<AppDatabase> { if (!this.db) throw new Error('receipt documents need the database'); return this.db; }

  async create(ctx: OcrCtx, rec: Partial<DocRecord>): Promise<DocRecord> {
    // §12 (Oct 27 2026): the source channel is what the CALLER said (POS upload / Owner App / camera / web / API) — it was 'upload' for all
    const source = rec.sourceChannel && SOURCE_CHANNELS.has(rec.sourceChannel) ? rec.sourceChannel : 'upload';
    const row = await one<any>(this.db, sql`
      insert into ocr_documents (tenant_id, branch_id, uploaded_by_user_id, source_channel, document_type, pipeline_status, quality_flags, page_count)
      values (${ctx.tenantId}, ${ctx.branchId}, ${userColumn(ctx.userId)}, ${source}, ${rec.documentType ?? 'unknown'}, ${rec.pipelineState ?? 'uploaded'}, ${JSON.stringify(rec.qualityFlags ?? [])}::jsonb, ${rec.pageCount ?? 1})
      returning id, tenant_id, branch_id, pipeline_status, document_type, vendor, total_cents, document_number, document_date, page_count, quality_flags, source_channel`, null);
    if (row) return toDoc(row);
    // degraded (no DB): synthesize a record so the caller still gets an id
    return toDoc({ id: cryptoRandom(), tenant_id: ctx.tenantId, branch_id: ctx.branchId, pipeline_status: rec.pipelineState ?? 'uploaded', document_type: rec.documentType ?? 'unknown' });
  }

  async get(ctx: OcrCtx, id: string): Promise<DocRecord | null> {
    const r = await one<any>(this.db, sql`
      select ${DOC_COLS},
             f.file_hash, f.perceptual_hash, f.storage_key, t.thumbnail_key
      from ocr_documents d
      left join lateral (
        select file_hash, perceptual_hash, storage_key from ocr_document_files
        where document_id = d.id and kind = 'original' order by created_at desc limit 1
      ) f on true
      ${THUMB}
      where d.id = ${id} and d.tenant_id = ${ctx.tenantId} and d.deleted_at is null`, null);
    return r ? toDoc(r) : null;
  }

  /** §17: the appended page files (page 2 …) of a document, in page order — page 1 is the original */
  async pageKeys(ctx: OcrCtx, id: string): Promise<string[]> {
    const list = await rows<any>(this.db, sql`select storage_key from ocr_document_pages where tenant_id = ${ctx.tenantId} and document_id = ${id} and page_number > 1 and storage_key is not null order by page_number`);
    return list.map((r) => String(r.storage_key));
  }
  /** §17/§18: one more page under the SAME document (never a second document); answers the new page number */
  async addPage(ctx: OcrCtx, id: string, page: { storageKey: string; width: number | null; height: number | null }): Promise<number> {
    const r = await one<{ page_count: number } | null>(this.db, sql`
      update ocr_documents set page_count = page_count + 1, updated_at = now() where id = ${id} and tenant_id = ${ctx.tenantId} and deleted_at is null returning page_count`, null);
    const n = Number(r?.page_count ?? 0);
    if (!n) throw new Error('OCR_PAGE_APPEND_FAILED');
    await sql`insert into ocr_document_pages (tenant_id, document_id, page_number, storage_key, width, height) values (${ctx.tenantId}, ${id}, ${n}, ${page.storageKey}, ${page.width}, ${page.height})`.execute(this.live);
    return n;
  }
  /** §115: the extraction ladder — attempts so far, when the next try is due (null = terminal), the last error */
  async recordExtractionAttempt(ctx: OcrCtx, id: string, x: { attempts: number; nextAt: Date | null; error: string | null }): Promise<void> {
    await exec(this.db, sql`update ocr_documents set extraction_attempts = ${x.attempts}, next_extraction_at = ${x.nextAt}, last_extraction_error = ${x.error}, updated_at = now() where id = ${id} and tenant_id = ${ctx.tenantId}`);
  }
  /** §115: failed extractions whose retry is due (every salon; one owner per tick) */
  async retryDue(now: Date, limit: number): Promise<{ id: string; tenantId: string; branchId: string | null; pipelineState: any }[]> {
    const list = await rows<any>(this.db, sql`select id, tenant_id, branch_id, pipeline_status from ocr_documents
      where deleted_at is null and pipeline_status = 'extraction_failed' and next_extraction_at is not null and next_extraction_at <= ${now} order by next_extraction_at asc limit ${limit}`);
    return list.map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, pipelineState: r.pipeline_status }));
  }
  /** §131: documents past the salon's retention window that are not already retention-archived and carry no live expense — reported / archived, never deleted */
  async retentionCandidates(now: Date, limit: number): Promise<{ id: string; tenantId: string; branchId: string | null; createdAt: string; retentionDays: number; liveExpense: boolean }[]> {
    const list = await rows<any>(this.db, sql`
      select d.id, d.tenant_id, d.branch_id, d.created_at,
             coalesce((select (s.config->>'retentionDays')::int from tenant_ocr_ai_settings s where s.tenant_id = d.tenant_id and s.level = 'tenant' and s.config ? 'retentionDays' limit 1), 2555) as retention_days,
             exists (select 1 from expenses e where e.tenant_id = d.tenant_id and e.receipt_document_id = d.id and e.status <> 'voided' and e.archived_at is null) as live_expense
      from ocr_documents d
      where d.deleted_at is null and d.retention_archived_at is null and d.retention_hold = false
        and d.created_at < ${now}::timestamptz - (greatest(30, coalesce((select (s.config->>'retentionDays')::int from tenant_ocr_ai_settings s where s.tenant_id = d.tenant_id and s.level = 'tenant' and s.config ? 'retentionDays' limit 1), 2555)) || ' days')::interval
      -- Oct 28 2026 re-audit: archivable documents first — the kept ones (live expense) are never archived, and ordered by age
      -- alone they filled every nightly batch, so nothing behind the oldest 200 kept receipts was ever reached
      order by live_expense asc, d.created_at asc limit ${limit}`);
    return list.map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, createdAt: new Date(r.created_at).toISOString(), retentionDays: Number(r.retention_days), liveExpense: !!r.live_expense }));
  }
  async markRetentionArchived(ctx: OcrCtx, id: string): Promise<void> {
    await exec(this.db, sql`update ocr_documents set retention_archived_at = now(), updated_at = now() where id = ${id} and tenant_id = ${ctx.tenantId} and retention_archived_at is null`);
  }

  // ── §35–§38: the per-field reading and the line items, persisted ─────────────────────────────────────────────────
  async saveExtraction(ctx: OcrCtx, id: string, x: { fields: OcrFieldOut[]; lineItems: OcrLineOut[]; financials: DocumentFinancials; overallConfidence: number; lowConfidenceThreshold: number }): Promise<void> {
    const db = this.live;
    await sql`delete from ocr_extracted_fields where tenant_id = ${ctx.tenantId} and document_id = ${id}`.execute(db);
    await sql`delete from ocr_line_items where tenant_id = ${ctx.tenantId} and document_id = ${id}`.execute(db);
    for (const f of x.fields) {
      const state = confidenceState(f.confidence, f.text != null && f.text !== '');
      await sql`insert into ocr_extracted_fields (tenant_id, document_id, field_key, value_text, value_cents, confidence, state, source_page)
        values (${ctx.tenantId}, ${id}, ${f.key}, ${f.text ?? null}, ${f.cents ?? null}, ${Math.round(f.confidence * 1000) / 1000}, ${state}, ${f.page ?? null})`.execute(db);
    }
    let n = 0;
    for (const l of x.lineItems) {
      n++;
      await sql`insert into ocr_line_items (tenant_id, document_id, line_number, description, quantity, unit_price_cents, line_total_cents, confidence)
        values (${ctx.tenantId}, ${id}, ${n}, ${l.description ?? null}, ${l.quantity ?? null}, ${l.unitPriceCents ?? null}, ${l.lineTotalCents ?? null}, ${Math.round(l.confidence * 1000) / 1000})`.execute(db);
    }
    const fin = x.financials;
    await sql`update ocr_documents set subtotal_cents = ${fin.subtotalCents}, tax_cents = ${fin.taxCents}, fees_cents = ${fin.feesCents}, discount_cents = ${fin.discountCents},
        overall_confidence = ${Math.round(x.overallConfidence * 1000) / 1000}, date_ambiguous = ${fin.dateAmbiguous}, is_credit_or_refund = ${fin.isCreditOrRefund},
        validation_status = ${x.overallConfidence < x.lowConfidenceThreshold ? 'needs_review' : 'valid'}, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`.execute(db);
  }
  async extraction(ctx: OcrCtx, id: string) {
    const fields = await rows<any>(this.db, sql`select field_key, value_text, value_cents, confidence, state, source_page, corrected_value from ocr_extracted_fields where tenant_id = ${ctx.tenantId} and document_id = ${id} order by created_at`);
    const lines = await rows<any>(this.db, sql`select line_number, description, quantity, unit_price_cents, line_total_cents, confidence from ocr_line_items where tenant_id = ${ctx.tenantId} and document_id = ${id} order by line_number`);
    return {
      fields: fields.map((f): StoredField => ({ key: String(f.field_key), text: f.value_text ?? null, cents: f.value_cents == null ? null : Number(f.value_cents), confidence: Number(f.confidence ?? 0), state: (f.state ?? 'missing') as ConfidenceState, page: f.source_page == null ? null : Number(f.source_page), correctedValue: f.corrected_value ?? null })),
      lineItems: lines.map((l) => ({ lineNumber: Number(l.line_number), description: l.description ?? null, quantity: l.quantity == null ? null : Number(l.quantity), unitPriceCents: l.unit_price_cents == null ? null : Number(l.unit_price_cents), lineTotalCents: l.line_total_cents == null ? null : Number(l.line_total_cents), confidence: Number(l.confidence ?? 0) })),
    };
  }
  async saveFieldCorrection(ctx: OcrCtx, id: string, f: CorrectableField): Promise<void> {
    const db = this.live;
    const upd = await sql<{ id: string }>`update ocr_extracted_fields set corrected_value = ${f.value}, value_cents = ${f.valueCents}, state = ${f.state}, corrected_by_user_id = ${userColumn(f.correctedByUserId)}, corrected_at = now()
      where tenant_id = ${ctx.tenantId} and document_id = ${id} and field_key = ${f.fieldKey} returning id`.execute(db);
    if (!upd.rows.length) {   // a field the provider never read (manual entry): the person's value IS the field
      await sql`insert into ocr_extracted_fields (tenant_id, document_id, field_key, value_text, value_cents, confidence, state, corrected_value, corrected_by_user_id, corrected_at)
        values (${ctx.tenantId}, ${id}, ${f.fieldKey}, ${f.value}, ${f.valueCents}, 1, ${f.state}, ${f.value}, ${userColumn(f.correctedByUserId)}, now())`.execute(db);
    }
  }

  async list(ctx: OcrCtx, filters: Record<string, unknown>): Promise<{ items: DocRecord[]; total: number }> {
    const status = (filters?.pipelineState as string) || null;
    const review = (filters?.reviewStatus as string) || null;
    // Oct 28 2026 (audit F2): a branch-restricted person's list holds their branches' documents only (the service passes them)
    const branchIds = Array.isArray(filters?.branchIds) ? (filters.branchIds as unknown[]).filter((b): b is string => typeof b === 'string') : null;
    const inBranchesD = branchIds ? (branchIds.length ? sql`and d.branch_id in (${sql.join(branchIds)})` : sql`and false`) : sql``;
    const inBranches = branchIds ? (branchIds.length ? sql`and branch_id in (${sql.join(branchIds)})` : sql`and false`) : sql``;
    const items = await rows<any>(this.db, sql`
      select ${DOC_COLS}, t.thumbnail_key
      from ocr_documents d
      ${THUMB}
      where d.tenant_id = ${ctx.tenantId} and d.deleted_at is null
        and (${status}::text is null or d.pipeline_status = ${status})
        and (${review}::text is null or d.review_status = ${review})
        ${inBranchesD}
      order by d.created_at desc limit 200`);
    const total = Number((await one<{ c: string }>(this.db, sql`
      select count(*)::text as c from ocr_documents
      where tenant_id = ${ctx.tenantId} and deleted_at is null
        and (${status}::text is null or pipeline_status = ${status})
        and (${review}::text is null or review_status = ${review})
        ${inBranches}`, { c: '0' })).c);
    return { items: items.map(toDoc), total };
  }

  /** M3 (Oct 23 2026): the background pipeline sweep's population — EVERY salon's documents waiting in these states
   *  (one owner per tick, ocr.pipeline_sweep lease); each row is then handled under its own tenant id. */
  async stalled(states: readonly string[], olderThan: Date, limit: number): Promise<{ id: string; tenantId: string; branchId: string | null; pipelineState: any }[]> {
    const list = await rows<any>(this.db, sql`select id, tenant_id, branch_id, pipeline_status from ocr_documents
      where deleted_at is null and pipeline_status in (${sql.join([...states])}) and updated_at < ${olderThan} order by updated_at asc limit ${limit}`);
    return list.map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, pipelineState: r.pipeline_status }));
  }

  async patch(ctx: OcrCtx, id: string, patch: Partial<DocRecord>): Promise<void> {
    // Build a targeted UPDATE; only set columns that map to ocr_documents.
    await exec(this.db, sql`
      update ocr_documents set
        pipeline_status = coalesce(${patch.pipelineState ?? null}, pipeline_status),
        document_type   = coalesce(${patch.documentType ?? null}, document_type),
        vendor          = coalesce(${patch.vendor ?? null}, vendor),
        total_cents     = coalesce(${patch.totalCents ?? null}, total_cents),
        subtotal_cents  = coalesce(${patch.subtotalCents ?? null}::bigint, subtotal_cents),
        tax_cents       = coalesce(${patch.taxCents ?? null}::bigint, tax_cents),
        fees_cents      = coalesce(${patch.feesCents ?? null}::bigint, fees_cents),
        discount_cents  = coalesce(${patch.discountCents ?? null}::bigint, discount_cents),
        document_number = coalesce(${patch.documentNumber ?? null}, document_number),
        document_date   = coalesce(${patch.documentDate ?? null}::date, document_date),
        quality_flags   = coalesce(${patch.qualityFlags ? JSON.stringify(patch.qualityFlags) : null}::jsonb, quality_flags),
        suggested_expense_id = case when ${patch.suggestedMatch ?? null}::text is null then suggested_expense_id else ${patch.suggestedExpenseId ?? null}::uuid end,
        suggested_match = coalesce(${patch.suggestedMatch ?? null}, suggested_match),
        updated_at      = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`);
  }

  async dedupCandidates(ctx: OcrCtx, subject: DedupSubject, excludeDocumentId?: string): Promise<DuplicateCandidate[]> {
    // Oct 28 2026 (Receipt mandate audit F5, §47): this read used `rows()`, which answers [] on a database error — a failed
    // duplicate check read as "no duplicate". It now throws (the extraction fails loudly and is retried / held). And it
    // looked only at the latest 200 documents: the EXACT signals (same file, same document number, same total on the same
    // day) are now matched across all of the salon's documents; the latest 200 still feed the near-duplicate image check.
    const exclude = excludeDocumentId ?? null;
    const exact = subject.fileHash || subject.documentNumber || (subject.totalCents != null && subject.documentDate);
    const r = await sql<any>`
      select d.id as document_id, d.vendor, d.document_number, d.document_date, d.total_cents, f.file_hash, f.perceptual_hash
      from ocr_documents d
      left join lateral (
        select file_hash, perceptual_hash from ocr_document_files
        where document_id = d.id and kind = 'original' order by created_at desc limit 1
      ) f on true
      where d.tenant_id = ${ctx.tenantId} and d.deleted_at is null and (${exclude}::uuid is null or d.id <> ${exclude}::uuid)
        and (d.id in (select x.id from ocr_documents x where x.tenant_id = ${ctx.tenantId} and x.deleted_at is null order by x.created_at desc limit 200)
          ${exact ? sql`or exists (select 1 from ocr_document_files df where df.tenant_id = d.tenant_id and df.document_id = d.id and df.kind = 'original' and df.file_hash = ${subject.fileHash ?? null})
          or (${subject.documentNumber ?? null}::text is not null and d.document_number = ${subject.documentNumber ?? null})
          or (${subject.totalCents ?? null}::bigint is not null and ${subject.documentDate ? subject.documentDate.slice(0, 10) : null}::date is not null
              and d.total_cents = ${subject.totalCents ?? null} and d.document_date = ${subject.documentDate ? subject.documentDate.slice(0, 10) : null}::date)` : sql``})
      order by d.created_at desc limit 500`.execute(this.db);
    return r.rows.map((row: any) => ({
      documentId: String(row.document_id),
      fileHash: row.file_hash ?? null,
      perceptualHash: row.perceptual_hash ?? null,
      vendor: row.vendor ?? null,
      documentNumber: row.document_number ?? null,
      documentDate: ymdOf(row.document_date),
      totalCents: row.total_cents == null ? null : Number(row.total_cents),
    }));
  }

  async saveDecisionState(ctx: OcrCtx, id: string, state: ReviewDecisionState): Promise<void> {
    const json = JSON.stringify(state);
    const updated = await one<{ id: string } | null>(this.db, sql`
      update ocr_reviews set status = ${state.status}, decision_state = ${json}::jsonb, submitted_at = now()
      where document_id = ${id} and tenant_id = ${ctx.tenantId} returning id`, null);
    if (!updated) {
      await exec(this.db, sql`
        insert into ocr_reviews (tenant_id, document_id, status, started_by_user_id, decision_state)
        values (${ctx.tenantId}, ${id}, ${state.status}, ${userColumn(ctx.userId)}, ${json}::jsonb)`);
    }
  }

  async loadDecisionState(ctx: OcrCtx, id: string): Promise<ReviewDecisionState> {
    const r = await one<{ decision_state: any } | null>(this.db, sql`
      select decision_state from ocr_reviews
      where document_id = ${id} and tenant_id = ${ctx.tenantId}
      order by started_at desc limit 1`, null);
    if (!r || r.decision_state == null) return { ...INITIAL_DECISION };
    const s = typeof r.decision_state === 'string' ? JSON.parse(r.decision_state) : r.decision_state;
    return { status: s.status ?? 'in_review', approvals: Array.isArray(s.approvals) ? s.approvals : [] };
  }
}

export class KyselySettingsStore implements SettingsStorePort {
  constructor(private readonly db: AppDatabase) {}
  async load(ctx: OcrCtx): Promise<SettingsRow[]> {
    const list = await rows<any>(this.db, sql`
      select level, branch_id::text as branch_id, enabled, config
      from tenant_ocr_ai_settings where tenant_id = ${ctx.tenantId}`);
    return list.map((r) => ({
      level: r.level === 'branch' ? 'branch' : 'tenant',
      branch_id: r.branch_id ?? null,
      enabled: r.enabled == null ? null : !!r.enabled,
      config: r.config == null ? null : (typeof r.config === 'string' ? JSON.parse(r.config) : r.config),
    }));
  }
  // Not wrapped in exec(): a settings save that fails must fail the request, never "succeed" silently.
  async save(ctx: OcrCtx, row: SettingsRow): Promise<boolean> {
    const db = this.db; if (!db) throw new Error('receipt OCR settings need the database');
    if (row.level === 'branch') {
      const b = await sql<{ ok: number }>`select 1 as ok from branches where id = ${row.branch_id} and tenant_id = ${ctx.tenantId}`.execute(db);
      if (!b.rows.length) return false;
    }
    const cfg = row.config == null ? null : JSON.stringify(row.config);
    const upd = await sql<{ version: number }>`
      update tenant_ocr_ai_settings set enabled = ${row.enabled}, config = ${cfg}::jsonb, version = coalesce(version, 0) + 1,
        updated_by_user_id = ${ctx.userId ?? null}, updated_at = now()
      where tenant_id = ${ctx.tenantId} and level = ${row.level} and branch_id is not distinct from ${row.branch_id}::uuid
      returning version`.execute(db);
    let version = upd.rows[0]?.version;
    if (version == null) {
      const ins = await sql<{ version: number }>`
        insert into tenant_ocr_ai_settings (tenant_id, level, branch_id, enabled, config, version, updated_by_user_id)
        values (${ctx.tenantId}, ${row.level}, ${row.branch_id}::uuid, ${row.enabled}, ${cfg}::jsonb, 1, ${ctx.userId ?? null}) returning version`.execute(db);
      version = ins.rows[0].version;
    }
    await sql`insert into ocr_ai_config_versions (tenant_id, level, branch_id, version, enabled, config, changed_by_user_id)
      values (${ctx.tenantId}, ${row.level}, ${row.branch_id}::uuid, ${version}, ${row.enabled}, ${cfg}::jsonb, ${ctx.userId ?? null})`.execute(db);
    return true;
  }
}

// Platform audit: every OCR action lands in the shared audit_logs table (tenant/branch/user/action scoped).
/** R-5 (§191, Oct 28 2026): which request / job wrote an OCR audit row. The extraction job runs under contextForJob, so its
 *  correlationId is the uploading request's and its requestId is `job_<jobId>`; a request's row carries its own ids. */
export function auditTraceIds(t = getContext()): { correlationId?: string; requestId?: string; jobId?: string } {
  if (!t) return {};
  return { correlationId: t.correlationId, requestId: t.requestId, ...(t.service === 'job' && t.requestId?.startsWith('job_') ? { jobId: t.requestId.slice(4) } : {}) };
}

export class KyselyOcrAuditSink implements AuditSink {
  constructor(private readonly db: AppDatabase) {}
  async record(ctx: OcrCtx, action: string, documentId: string, meta: Record<string, unknown>): Promise<void> {
    await execLogged(this.db, sql`
      insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${ctx.tenantId}, ${userColumn(ctx.branchId)}, ${userColumn(ctx.userId)}, ${ctx.role}, ${action}, 'ocr_document', ${documentId}, ${JSON.stringify({ ...(meta ?? {}), ...auditTraceIds() })}::jsonb)`, `OCR audit row ${action} for ${documentId}`);   // a system context's branch may be '' (no branch) → NULL
  }
}

// ── Honest infrastructure adapters (no fabrication) ──
// FileStore records the file row metadata but cannot upload bytes to a CDN here; previews report NotConnected.
// REMOVED: DbFileStore + NotConnectedMalwareScan + InMemoryFileStore.
//
// DbFileStore recorded file METADATA only (no bytes anywhere) and hardcoded the key `tenants/{t}/ocr/{id}/…`,
// while ai-ocr-receipt.service.ts hands the scanner `storageKeyFor()` = `tenants/{t}/documents/{id}/…`. The two
// disagreed, so the scanner was always asked about a key that had never been written — invisible only because
// the scanner was a no-op that ignored its argument.
//
// Both concerns now live in ai-ocr-receipt.blob.ts: BlobFileStore (bytes → the private evidence bucket, metadata
// row unchanged, keyed with storageKeyFor) and EvidenceMalwareScan (the shared fail-closed S3-tag scanner).
// They are deleted rather than deprecated so the broken key shape cannot be re-wired by mistake.

// ── In-memory fakes so the module loads without a DB (dev/tests). Non-persistent. ──
function cryptoRandom(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
  });
}
export class InMemoryDocStore implements DocStorePort {
  private readonly m = new Map<string, DocRecord>();
  private readonly d = new Map<string, ReviewDecisionState>();
  async create(ctx: OcrCtx, rec: Partial<DocRecord>): Promise<DocRecord> {
    const doc: DocRecord = { id: cryptoRandom(), tenantId: ctx.tenantId, branchId: ctx.branchId, pipelineState: rec.pipelineState ?? 'uploaded', documentType: rec.documentType ?? 'unknown', vendor: null, totalCents: null, category: null, fileHash: null, perceptualHash: null, documentNumber: null, documentDate: null, postingVersion: rec.postingVersion ?? 1, purchaseOrderId: null,
      pageCount: rec.pageCount ?? 1, qualityFlags: rec.qualityFlags ?? [], extractionAttempts: 0, nextExtractionAt: null, lastExtractionError: null, suggestedExpenseId: null, suggestedMatch: null, sourceChannel: rec.sourceChannel ?? 'upload', thumbnailKey: null };
    this.m.set(doc.id, doc); return { ...doc };
  }
  async get(ctx: OcrCtx, id: string) { const d = this.m.get(id); return d && d.tenantId === ctx.tenantId ? { ...d } : null; }
  async list(ctx: OcrCtx, filters: Record<string, unknown> = {}) { const b = Array.isArray(filters.branchIds) ? (filters.branchIds as string[]) : null; const items = [...this.m.values()].filter((d) => d.tenantId === ctx.tenantId && (!b || (!!d.branchId && b.includes(d.branchId)))); return { items, total: items.length }; }
  async patch(ctx: OcrCtx, id: string, patch: Partial<DocRecord>) { const d = this.m.get(id); if (d && d.tenantId === ctx.tenantId) this.m.set(id, { ...d, ...patch }); }
  async dedupCandidates() { return []; }
  private readonly pages = new Map<string, string[]>();
  async pageKeys(_ctx: OcrCtx, id: string) { return [...(this.pages.get(id) ?? [])]; }
  async addPage(ctx: OcrCtx, id: string, page: { storageKey: string }) { const d = this.m.get(id); if (!d || d.tenantId !== ctx.tenantId) throw new Error('OCR_PAGE_APPEND_FAILED'); const n = (d.pageCount ?? 1) + 1; this.m.set(id, { ...d, pageCount: n }); this.pages.set(id, [...(this.pages.get(id) ?? []), page.storageKey]); return n; }
  async recordExtractionAttempt(ctx: OcrCtx, id: string, x: { attempts: number; nextAt: Date | null; error: string | null }) { const d = this.m.get(id); if (d && d.tenantId === ctx.tenantId) this.m.set(id, { ...d, extractionAttempts: x.attempts, nextExtractionAt: x.nextAt?.toISOString() ?? null, lastExtractionError: x.error }); }
  async retryDue(now: Date) { return [...this.m.values()].filter((d) => d.pipelineState === 'extraction_failed' && d.nextExtractionAt && new Date(d.nextExtractionAt) <= now).map((d) => ({ id: d.id, tenantId: d.tenantId, branchId: d.branchId, pipelineState: d.pipelineState })); }
  async retentionCandidates() { return []; }
  async markRetentionArchived() { /* no-op in dev */ }
  async saveDecisionState(_ctx: OcrCtx, id: string, state: ReviewDecisionState) { this.d.set(id, state); }
  async loadDecisionState(_ctx: OcrCtx, id: string) { return this.d.get(id) ?? { ...INITIAL_DECISION }; }
}
export class InMemorySettingsStore implements SettingsStorePort { async load() { return [] as SettingsRow[]; } }
export class InMemoryAuditSink implements AuditSink { async record() { /* no-op in dev */ } }

// ── Posting adapters ──
import type { ExpensePostPort, InventoryReceivePort, IdempotencyStore, PostingCtx, PostingRecord } from './ai-ocr-receipt-posting';

// Real idempotency store over ocr_postings (prevents double-posting the same approved document).
export class KyselyPostingIdempotency implements IdempotencyStore {
  constructor(private readonly db: AppDatabase) {}
  async find(tenantId: string, key: string): Promise<PostingRecord | null> {
    const r = await one<any>(this.db, sql`
      select idempotency_key, status, external_ref, error_code from ocr_postings
      where tenant_id = ${tenantId} and idempotency_key = ${key} limit 1`, null);
    return r ? { idempotencyKey: r.idempotency_key, status: r.status === 'posted' ? 'posted' : 'failed', externalRef: r.external_ref ?? null, errorCode: r.error_code ?? null } : null;
  }
  async record(tenantId: string, rec: PostingRecord): Promise<void> {
    // the key is tenant:document:destination:version (buildIdempotencyKey) — the row records the REAL document, destination
    // and version (Oct 21 2026: every row used to say document 00000000-…, destination 'expense', version 1). A retry of a
    // failed posting updates the same row (one row per key), and each attempt is kept in ocr_posting_attempts.
    const [, documentId, destination, version] = rec.idempotencyKey.split(':');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId ?? '') ? documentId : '00000000-0000-0000-0000-000000000000';
    // the posting's lifecycle: a posted row never changes; a failed one may be retried
    const prior = await this.find(tenantId, rec.idempotencyKey);
    if (prior) assertTransition(OCR_POSTING, prior.status, rec.status);
    const row = await one<{ id: string } | null>(this.db, sql`
      insert into ocr_postings (tenant_id, document_id, destination, posting_version, external_ref, status, idempotency_key, error_code, posted_at)
      values (${tenantId}, ${uuid}, ${destination === 'inventory_receipt' ? 'inventory_receipt' : 'expense'}, ${Number(version) || 1}, ${rec.externalRef}, ${rec.status}, ${rec.idempotencyKey}, ${rec.errorCode ?? null}, ${rec.status === 'posted' ? new Date() : null})
      on conflict (idempotency_key) do update set status = excluded.status, external_ref = excluded.external_ref, error_code = excluded.error_code, posted_at = excluded.posted_at
      returning id`, null);
    if (row?.id) await execLogged(this.db, sql`insert into ocr_posting_attempts (tenant_id, posting_id, outcome, detail) values (${tenantId}, ${row.id}, ${rec.status === 'posted' ? 'succeeded' : 'failed'}, ${JSON.stringify({ errorCode: rec.errorCode ?? null, externalRef: rec.externalRef })})`, `OCR posting attempt for ${rec.idempotencyKey}`);
  }
}
export class InMemoryPostingIdempotency implements IdempotencyStore {
  private readonly m = new Map<string, PostingRecord>();
  async find(tenantId: string, key: string) { return this.m.get(`${tenantId}:${key}`) ?? null; }
  async record(tenantId: string, rec: PostingRecord) { this.m.set(`${tenantId}:${rec.idempotencyKey}`, rec); }
}
// Honest "not connected" posting targets: they THROW, so PostingService records a failed posting and the
// service surfaces POSTING_FAILED. They NEVER fabricate a successful post. Bind to the real tenant
// expense/inventory services when that integration is wired.

// ── Real posting integration: bind the OCR posting ports to the EXISTING tenant InventoryService ──
// (inventory.saveReceiptExpense → expenses, inventory.receivePurchaseOrder → PO receiving), exactly as the
// posting module intends. PostingCtx → InvCtx (branchId defaults to '' for tenant-level receipts); the expense
// result { ok, expense:{id} } maps to the port's { id }. If the write throws, PostingService records a failed
// posting and the service surfaces POSTING_FAILED — never a fabricated success.
export interface InventoryPostingBackend {
  saveReceiptExpense(ctx: { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }, body: { vendor?: string | null; amountCents?: number; incurredOn?: string | null; category?: string | null; description?: string | null }): Promise<any>;
  receivePurchaseOrder(ctx: { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }, id: string, body: unknown): Promise<any>;
}
const toInvCtx = (c: PostingCtx) => ({ tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions });

export class InventoryExpensePost implements ExpensePostPort {
  constructor(private readonly inv: InventoryPostingBackend) {}
  async saveReceiptExpense(ctx: PostingCtx, body: { vendor?: string | null; amountCents?: number; incurredOn?: string | null; category?: string | null; description?: string | null }): Promise<{ id: string }> {
    const res = await this.inv.saveReceiptExpense(toInvCtx(ctx), body);
    const id = res?.expense?.id ?? res?.id;
    if (!id) throw new Error('EXPENSE_POST_NO_ID');
    return { id: String(id) };
  }
}
/**
 * Oct 21 2026 (Receipt / Expense / OCR / Accounting mandate): an approved receipt becomes ONE expense through the finance
 * module — linked to this receipt document, its line items, vendor and category engine, idempotent per document. This
 * replaces InventoryExpensePost's raw insert (kept above, unbound, for deployments without the finance module).
 */
export interface FinanceReceiptBackend {
  postFromReceipt(ctx: { tenantId: string; userId: string; role: string; permissions: string[]; selectedBranchId?: string | null }, documentId: string, x: { category?: string | null; description?: string | null; idempotencyKey: string }): Promise<{ expense: { id: string } }>;
}
export class FinanceExpensePost implements ExpensePostPort {
  constructor(private readonly finance: FinanceReceiptBackend) {}
  async saveReceiptExpense(ctx: PostingCtx, body: { category?: string | null; description?: string | null; documentId?: string; idempotencyKey?: string }): Promise<{ id: string }> {
    if (!body.documentId || !body.idempotencyKey) throw new Error('EXPENSE_POST_NO_DOCUMENT');
    const r = await this.finance.postFromReceipt({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, selectedBranchId: ctx.branchId }, body.documentId, { category: body.category ?? null, description: body.description ?? null, idempotencyKey: body.idempotencyKey });
    if (!r?.expense?.id) throw new Error('EXPENSE_POST_NO_ID');
    return { id: r.expense.id };
  }
}
export class InventoryReceiveAdapter implements InventoryReceivePort {
  constructor(private readonly inv: InventoryPostingBackend) {}
  async receivePurchaseOrder(ctx: PostingCtx, purchaseOrderId: string, body: unknown): Promise<{ id?: string } | unknown> {
    return this.inv.receivePurchaseOrder(toInvCtx(ctx), purchaseOrderId, body);
  }
}
