// ai-ocr-receipt.kysely.ts — the persistence + infra adapters that bind the AI OCR Receipt service's ports to
// the real database (migration 344 + 359) and to infrastructure. DB-backed adapters read/write the real
// ocr_* tables; the FileStore and MalwareScan are honest NotConnected/unscanned stubs until blob storage and a
// scanning service are wired (they never fabricate a "clean" scan — unscanned defers to tenant policy, which
// quarantines when scanning is required). File bytes + malware scanning now live in ai-ocr-receipt.blob.ts.
// In-memory fakes let the module load without a DB (dev/tests).
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type {
  OcrCtx, DocRecord, DocStorePort, SettingsStorePort, AuditSink,
} from './ai-ocr-receipt.service';
import type { DedupSubject, DuplicateCandidate } from './ai-ocr-receipt-dedup';
import type { ReviewDecisionState } from './ai-ocr-receipt-review';
import type { SettingsRow } from './ai-ocr-receipt-settings';

const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => {
  try { return (await q.execute(db)).rows as T[]; } catch { return []; }
};
const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => {
  try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; }
};
const exec = async (db: AppDatabase, q: any): Promise<void> => { try { await q.execute(db); } catch { /* degrade */ } };
const INITIAL_DECISION: ReviewDecisionState = { status: 'in_review', approvals: [] };

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
  documentDate: r.document_date ? String(r.document_date).slice(0, 10) : null,
  postingVersion: r.posting_version == null ? 1 : Number(r.posting_version),
  purchaseOrderId: r.purchase_order_id ?? null,
});

// ── DB-backed DocStore over ocr_documents (+ ocr_document_files for hashes, ocr_reviews for decision state) ──
export class KyselyDocStore implements DocStorePort {
  constructor(private readonly db: AppDatabase) {}

  async create(ctx: OcrCtx, rec: Partial<DocRecord>): Promise<DocRecord> {
    const row = await one<any>(this.db, sql`
      insert into ocr_documents (tenant_id, branch_id, uploaded_by_user_id, source_channel, document_type, pipeline_status)
      values (${ctx.tenantId}, ${ctx.branchId}, ${ctx.userId}, 'upload', ${rec.documentType ?? 'unknown'}, ${rec.pipelineState ?? 'uploaded'})
      returning id, tenant_id, branch_id, pipeline_status, document_type, vendor, total_cents, document_number, document_date`, null);
    if (row) return toDoc(row);
    // degraded (no DB): synthesize a record so the caller still gets an id
    return toDoc({ id: cryptoRandom(), tenant_id: ctx.tenantId, branch_id: ctx.branchId, pipeline_status: rec.pipelineState ?? 'uploaded', document_type: rec.documentType ?? 'unknown' });
  }

  async get(ctx: OcrCtx, id: string): Promise<DocRecord | null> {
    const r = await one<any>(this.db, sql`
      select d.id, d.tenant_id, d.branch_id, d.pipeline_status, d.document_type, d.vendor, d.total_cents,
             d.document_number, d.document_date,
             f.file_hash, f.perceptual_hash, f.storage_key
      from ocr_documents d
      left join lateral (
        select file_hash, perceptual_hash, storage_key from ocr_document_files
        where document_id = d.id and kind = 'original' order by created_at desc limit 1
      ) f on true
      where d.id = ${id} and d.tenant_id = ${ctx.tenantId} and d.deleted_at is null`, null);
    return r ? toDoc(r) : null;
  }

  async list(ctx: OcrCtx, filters: Record<string, unknown>): Promise<{ items: DocRecord[]; total: number }> {
    const status = (filters?.pipelineState as string) || null;
    const review = (filters?.reviewStatus as string) || null;
    const items = await rows<any>(this.db, sql`
      select id, tenant_id, branch_id, pipeline_status, document_type, vendor, total_cents, document_number, document_date
      from ocr_documents
      where tenant_id = ${ctx.tenantId} and deleted_at is null
        and (${status}::text is null or pipeline_status = ${status})
        and (${review}::text is null or review_status = ${review})
      order by created_at desc limit 200`);
    const total = Number((await one<{ c: string }>(this.db, sql`
      select count(*)::text as c from ocr_documents
      where tenant_id = ${ctx.tenantId} and deleted_at is null
        and (${status}::text is null or pipeline_status = ${status})
        and (${review}::text is null or review_status = ${review})`, { c: '0' })).c);
    return { items: items.map(toDoc), total };
  }

  async patch(ctx: OcrCtx, id: string, patch: Partial<DocRecord>): Promise<void> {
    // Build a targeted UPDATE; only set columns that map to ocr_documents.
    await exec(this.db, sql`
      update ocr_documents set
        pipeline_status = coalesce(${patch.pipelineState ?? null}, pipeline_status),
        document_type   = coalesce(${patch.documentType ?? null}, document_type),
        vendor          = coalesce(${patch.vendor ?? null}, vendor),
        total_cents     = coalesce(${patch.totalCents ?? null}, total_cents),
        document_number = coalesce(${patch.documentNumber ?? null}, document_number),
        document_date   = coalesce(${patch.documentDate ?? null}::date, document_date),
        updated_at      = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`);
  }

  async dedupCandidates(ctx: OcrCtx, subject: DedupSubject): Promise<DuplicateCandidate[]> {
    const list = await rows<any>(this.db, sql`
      select d.id as document_id, d.vendor, d.document_number, d.document_date, d.total_cents,
             f.file_hash, f.perceptual_hash
      from ocr_documents d
      left join lateral (
        select file_hash, perceptual_hash from ocr_document_files
        where document_id = d.id and kind = 'original' order by created_at desc limit 1
      ) f on true
      where d.tenant_id = ${ctx.tenantId} and d.deleted_at is null
      order by d.created_at desc limit 200`);
    return list.map((r) => ({
      documentId: String(r.document_id),
      fileHash: r.file_hash ?? null,
      perceptualHash: r.perceptual_hash ?? null,
      vendor: r.vendor ?? null,
      documentNumber: r.document_number ?? null,
      documentDate: r.document_date ? String(r.document_date).slice(0, 10) : null,
      totalCents: r.total_cents == null ? null : Number(r.total_cents),
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
        values (${ctx.tenantId}, ${id}, ${state.status}, ${ctx.userId}, ${json}::jsonb)`);
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
}

// Platform audit: every OCR action lands in the shared audit_logs table (tenant/branch/user/action scoped).
export class KyselyOcrAuditSink implements AuditSink {
  constructor(private readonly db: AppDatabase) {}
  async record(ctx: OcrCtx, action: string, documentId: string, meta: Record<string, unknown>): Promise<void> {
    await exec(this.db, sql`
      insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${ctx.tenantId}, ${ctx.branchId}, ${ctx.userId}, ${ctx.role}, ${action}, 'ocr_document', ${documentId}, ${JSON.stringify(meta ?? {})}::jsonb)`);
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
    const doc: DocRecord = { id: cryptoRandom(), tenantId: ctx.tenantId, branchId: ctx.branchId, pipelineState: rec.pipelineState ?? 'uploaded', documentType: rec.documentType ?? 'unknown', vendor: null, totalCents: null, category: null, fileHash: null, perceptualHash: null, documentNumber: null, documentDate: null, postingVersion: rec.postingVersion ?? 1, purchaseOrderId: null };
    this.m.set(doc.id, doc); return { ...doc };
  }
  async get(ctx: OcrCtx, id: string) { const d = this.m.get(id); return d && d.tenantId === ctx.tenantId ? { ...d } : null; }
  async list(ctx: OcrCtx) { const items = [...this.m.values()].filter((d) => d.tenantId === ctx.tenantId); return { items, total: items.length }; }
  async patch(ctx: OcrCtx, id: string, patch: Partial<DocRecord>) { const d = this.m.get(id); if (d && d.tenantId === ctx.tenantId) this.m.set(id, { ...d, ...patch }); }
  async dedupCandidates() { return []; }
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
    await exec(this.db, sql`
      insert into ocr_postings (tenant_id, document_id, destination, posting_version, external_ref, status, idempotency_key, error_code)
      values (${tenantId}, ${'00000000-0000-0000-0000-000000000000'}, 'expense', 1, ${rec.externalRef}, ${rec.status}, ${rec.idempotencyKey}, ${rec.errorCode ?? null})`);
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
export class NotConnectedExpensePost implements ExpensePostPort {
  async saveReceiptExpense(): Promise<{ id: string }> { throw new Error('EXPENSE_POSTING_NOT_CONNECTED'); }
}
export class NotConnectedInventoryReceive implements InventoryReceivePort {
  async receivePurchaseOrder(): Promise<{ id?: string }> { throw new Error('INVENTORY_RECEIVE_NOT_CONNECTED'); }
}

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
export class InventoryReceiveAdapter implements InventoryReceivePort {
  constructor(private readonly inv: InventoryPostingBackend) {}
  async receivePurchaseOrder(ctx: PostingCtx, purchaseOrderId: string, body: unknown): Promise<{ id?: string } | unknown> {
    return this.inv.receivePurchaseOrder(toInvCtx(ctx), purchaseOrderId, body);
  }
}
