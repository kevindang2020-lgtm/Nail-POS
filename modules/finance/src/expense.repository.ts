// expense.repository.ts — Postgres access for the expense domain (mandate §70, §151–152). EVERY query carries the
// caller's tenant_id; branch scope is applied by `scoped()` from the server-resolved allowed set, never from the client.
// Money comes back as integer cents (BIGINT → Number; amounts here stay far below 2^53). Reports SUM in SQL over the
// COUNTED statuses only, so the dashboard, the report and the export read the same authoritative rows (§108).
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { COUNTED_STATUSES } from './expense-lifecycles';

export type Exec = Kysely<DB> | Transaction<DB>;
/** `salonWide`: the caller may also see salon-wide rows (branch_id NULL) alongside their allowed branches — every caller who
 *  may WRITE one (writableBranch lets an owner file to "the whole salon"); never a branch-restricted manager. */
export interface Scope { tenantId: string; branchId: string | null; allowed: string[] | null; salonWide?: boolean }

export interface ExpenseRow {
  id: string; tenantId: string; branchId: string | null; status: string; kind: string;
  category: string; categoryRaw: string | null; categorySource: string;
  amountCents: number; subtotalCents: number | null; taxCents: number | null; tipCents: number | null; feeCents: number | null; discountCents: number | null;
  currency: string; description: string | null; vendor: string | null; vendorId: string | null; vendorName: string | null;
  incurredOn: string; paymentMethod: string | null; cardBrand: string | null; cardLast4: string | null;
  receiptNumber: string | null; invoiceNumber: string | null; referenceNumber: string | null;
  receiptDocumentId: string | null; dueDate: string | null; billStatus: string | null; paidCents: number; paidAt: string | null;
  reimbursementStatus: string; reimburseUserId: string | null; reimbursedAt: string | null; recurring: boolean;
  duplicateStatus: string; duplicateOfId: string | null; duplicateReason: string | null;
  source: string; taxReviewStatus: string; accountantNote: string | null;
  extractionConfidence: number | null; reviewFlags: string[];
  approvedBy: string | null; approvedAt: string | null; rejectedReason: string | null;
  voidedAt: string | null; voidReason: string | null; archivedAt: string | null;
  createdBy: string | null; createdAt: string; updatedAt: string; version: number;
  /** §62/§63: the payment / bank transaction behind the expense — null = never looked for */
  paymentMatchStatus: 'matched' | 'possible_match' | 'unmatched' | null; matchedPaymentRef: string | null; paymentMatchReason: string | null;
}

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nn = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const ymd = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};

// the SELECT list every read uses: e.* plus the vendor's directory name
const COLS = sql`e.id, e.tenant_id, e.branch_id, e.status, e.kind, e.category, e.category_raw, e.category_source, e.amount_cents,
  e.subtotal_cents, e.tax_cents, e.tip_cents, e.fee_cents, e.discount_cents, e.currency, e.description, e.vendor, e.vendor_id,
  v.name AS vendor_name, e.incurred_on::text AS incurred_on, e.payment_method, e.card_brand, e.card_last4, e.receipt_number,
  e.invoice_number, e.reference_number, e.receipt_document_id, e.due_date::text AS due_date, e.bill_status, e.paid_cents, e.paid_at,
  e.reimbursement_status, e.reimburse_user_id, e.reimbursed_at, e.recurring, e.duplicate_status, e.duplicate_of_id, e.duplicate_reason,
  e.source, e.tax_review_status, e.accountant_note, e.extraction_confidence, e.review_flags, e.approved_by, e.approved_at,
  e.rejected_reason, e.voided_at, e.void_reason, e.archived_at, e.created_by, e.created_at, e.updated_at, e.version,
  e.payment_match_status, e.matched_payment_ref, e.payment_match_reason`;

type Raw = Record<string, unknown>;
export function mapExpense(r: Raw): ExpenseRow {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), branchId: (r.branch_id as string) ?? null, status: String(r.status), kind: String(r.kind),
    category: String(r.category), categoryRaw: (r.category_raw as string) ?? null, categorySource: String(r.category_source),
    amountCents: n(r.amount_cents), subtotalCents: nn(r.subtotal_cents), taxCents: nn(r.tax_cents), tipCents: nn(r.tip_cents), feeCents: nn(r.fee_cents), discountCents: nn(r.discount_cents),
    currency: String(r.currency ?? 'USD'), description: (r.description as string) ?? null, vendor: (r.vendor as string) ?? null, vendorId: (r.vendor_id as string) ?? null, vendorName: (r.vendor_name as string) ?? null,
    incurredOn: ymd(r.incurred_on) as string, paymentMethod: (r.payment_method as string) ?? null, cardBrand: (r.card_brand as string) ?? null, cardLast4: (r.card_last4 as string) ?? null,
    receiptNumber: (r.receipt_number as string) ?? null, invoiceNumber: (r.invoice_number as string) ?? null, referenceNumber: (r.reference_number as string) ?? null,
    receiptDocumentId: (r.receipt_document_id as string) ?? null, dueDate: ymd(r.due_date), billStatus: (r.bill_status as string) ?? null, paidCents: n(r.paid_cents), paidAt: iso(r.paid_at),
    reimbursementStatus: String(r.reimbursement_status ?? 'not_required'), reimburseUserId: (r.reimburse_user_id as string) ?? null, reimbursedAt: iso(r.reimbursed_at), recurring: !!r.recurring,
    duplicateStatus: String(r.duplicate_status ?? 'none'), duplicateOfId: (r.duplicate_of_id as string) ?? null, duplicateReason: (r.duplicate_reason as string) ?? null,
    source: String(r.source), taxReviewStatus: String(r.tax_review_status ?? 'not_reviewed'), accountantNote: (r.accountant_note as string) ?? null,
    extractionConfidence: nn(r.extraction_confidence), reviewFlags: Array.isArray(r.review_flags) ? (r.review_flags as string[]) : [],
    approvedBy: (r.approved_by as string) ?? null, approvedAt: iso(r.approved_at), rejectedReason: (r.rejected_reason as string) ?? null,
    voidedAt: iso(r.voided_at), voidReason: (r.void_reason as string) ?? null, archivedAt: iso(r.archived_at),
    createdBy: (r.created_by as string) ?? null, createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string, version: n(r.version),
    paymentMatchStatus: (r.payment_match_status as ExpenseRow['paymentMatchStatus']) ?? null, matchedPaymentRef: (r.matched_payment_ref as string) ?? null, paymentMatchReason: (r.payment_match_reason as string) ?? null,
  };
}

/** branch scope as SQL: an explicit branch, else the caller's allowed set, else the whole salon (owner with no limits). */
function scoped(s: Scope, alias = 'e') {
  const col = sql.ref(`${alias}.branch_id`);
  if (s.branchId) return sql`AND ${col} = ${s.branchId}`;
  // deep-scan (Oct 22 2026): an owner with explicit branch grants filed salon-wide expenses she could then never open,
  // approve or report (branch_id IN (her branches) never matches NULL) — salonWide lets them through for her
  if (s.allowed && s.allowed.length) return s.salonWide ? sql`AND (${col} IN (${sql.join(s.allowed)}) OR ${col} IS NULL)` : sql`AND ${col} IN (${sql.join(s.allowed)})`;
  if (s.allowed && !s.allowed.length) return sql`AND false`;
  return sql``;
}
const counted = sql`e.status IN (${sql.join([...COUNTED_STATUSES])})`;

export type InboxTab = 'all' | 'inbox' | 'needs_review' | 'approved' | 'bills' | 'duplicates' | 'archived' | 'reimbursements' | 'voided';
export interface ListFilters {
  tab?: InboxTab; from?: string; to?: string; category?: string; vendorId?: string; status?: string; paymentMethod?: string;
  q?: string; minCents?: number; maxCents?: number; page?: number; pageSize?: number; sort?: 'date' | 'amount' | 'created';
}

export class ExpenseRepository {
  constructor(readonly db: Kysely<DB>) {}

  async get(exec: Exec, s: Scope, id: string, forUpdate = false): Promise<ExpenseRow | null> {
    const r = await sql<Raw>`SELECT ${COLS} FROM expenses e LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${s.tenantId} AND e.id = ${id} ${scoped(s)} ${forUpdate ? sql`FOR UPDATE OF e` : sql``}`.execute(exec);
    return r.rows[0] ? mapExpense(r.rows[0]) : null;
  }

  async byReceipt(exec: Exec, tenantId: string, documentId: string): Promise<ExpenseRow | null> {
    const r = await sql<Raw>`SELECT ${COLS} FROM expenses e LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${tenantId} AND e.receipt_document_id = ${documentId} AND e.status <> 'voided' LIMIT 1`.execute(exec);
    return r.rows[0] ? mapExpense(r.rows[0]) : null;
  }
  async byIdempotency(exec: Exec, tenantId: string, key: string): Promise<ExpenseRow | null> {
    const r = await sql<Raw>`SELECT ${COLS} FROM expenses e LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${tenantId} AND e.idempotency_key = ${key} LIMIT 1`.execute(exec);
    return r.rows[0] ? mapExpense(r.rows[0]) : null;
  }

  /** §86–87 + §109: one paginated query for every inbox tab, search and filter (never the whole table in memory, §205). */
  async list(s: Scope, f: ListFilters): Promise<{ items: ExpenseRow[]; total: number }> {
    const where: ReturnType<typeof sql>[] = [];
    switch (f.tab ?? 'all') {
      case 'inbox': where.push(sql`e.status IN ('draft', 'pending_review') AND e.archived_at IS NULL`); break;
      case 'needs_review': where.push(sql`e.status = 'pending_review' AND e.archived_at IS NULL`); break;
      case 'approved': where.push(sql`e.status = 'approved' AND e.archived_at IS NULL`); break;
      case 'bills': where.push(sql`e.kind = 'bill' AND e.status <> 'voided' AND e.archived_at IS NULL`); break;
      case 'duplicates': where.push(sql`e.duplicate_status IN ('possible', 'exact') AND e.status <> 'voided'`); break;
      case 'archived': where.push(sql`e.archived_at IS NOT NULL`); break;
      case 'reimbursements': where.push(sql`e.reimbursement_status IN ('pending', 'approved')`); break;
      case 'voided': where.push(sql`e.status = 'voided'`); break;
      default: where.push(sql`e.archived_at IS NULL`);
    }
    if (f.from) where.push(sql`e.incurred_on >= ${f.from}`);
    if (f.to) where.push(sql`e.incurred_on <= ${f.to}`);
    if (f.category) where.push(sql`e.category = ${f.category}`);
    if (f.vendorId) where.push(sql`e.vendor_id = ${f.vendorId}`);
    if (f.status) where.push(sql`e.status = ${f.status}`);
    if (f.paymentMethod) where.push(sql`e.payment_method = ${f.paymentMethod}`);
    if (f.minCents != null) where.push(sql`e.amount_cents >= ${f.minCents}`);
    if (f.maxCents != null) where.push(sql`e.amount_cents <= ${f.maxCents}`);
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      const cents = /^\$?\d+(\.\d{1,2})?$/.test(f.q.trim()) ? Math.round(Number(f.q.trim().replace('$', '')) * 100) : null;
      // VietnamesePOS §41 (Oct 28 2026 audit): vendor names and descriptions match without accents (vi_fold, migration 694)
      const fold = f.q.replace(/[\\%_]/g, (c) => '\\' + c);
      where.push(sql`(vi_fold(e.vendor) LIKE '%' || vi_fold(${fold}) || '%' OR vi_fold(v.name) LIKE '%' || vi_fold(${fold}) || '%'
        OR vi_fold(e.description) LIKE '%' || vi_fold(${fold}) || '%' OR e.invoice_number ILIKE ${like}
        OR e.receipt_number ILIKE ${like} OR e.reference_number ILIKE ${like} ${cents != null ? sql`OR e.amount_cents = ${cents}` : sql``})`);
    }
    const cond = sql.join(where, sql` AND `);
    const pageSize = Math.min(Math.max(1, f.pageSize ?? 50), 200);
    const page = Math.max(1, f.page ?? 1);
    const order = f.sort === 'amount' ? sql`e.amount_cents DESC, e.id` : f.sort === 'created' ? sql`e.created_at DESC, e.id` : sql`e.incurred_on DESC, e.created_at DESC, e.id`;
    const base = sql`FROM expenses e LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id WHERE e.tenant_id = ${s.tenantId} ${scoped(s)} AND ${cond}`;
    const [rows, tot] = await Promise.all([
      sql<Raw>`SELECT ${COLS} ${base} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.execute(this.db),
      sql<{ c: string }>`SELECT count(*)::text AS c ${base}`.execute(this.db),
    ]);
    return { items: rows.rows.map(mapExpense), total: n(tot.rows[0]?.c) };
  }

  /** duplicate candidates: the tenant's non-voided expenses near this one (same total ±0, dates ±3 days) or same refs */
  /** Receipt mandate §96 (Oct 28 2026): other live charges from the SAME vendor on the SAME day (any amount — an equal amount
   *  is the duplicate check's job). Matched by vendor id, else by the vendor name folded (vi_fold: case, accents, surrounding / repeated spaces). */
  async sameVendorSameDay(exec: Exec, tenantId: string, x: { vendorId?: string | null; vendor?: string | null; incurredOn: string }): Promise<number> {
    const name = String(x.vendor ?? '').trim();
    if (!x.vendorId && !name) return 0;
    const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM expenses e
      WHERE e.tenant_id = ${tenantId} AND e.status <> 'voided' AND e.incurred_on = ${x.incurredOn}::date AND (
        ${x.vendorId ? sql`e.vendor_id = ${x.vendorId}` : sql`false`}
        ${name ? sql`OR vi_fold(coalesce(e.vendor, '')) = vi_fold(${name})` : sql``})`.execute(exec);
    return n(r.rows[0]?.n);
  }

  async dupCandidates(exec: Exec, tenantId: string, x: { totalCents: number; incurredOn: string; invoiceNumber?: string | null; receiptNumber?: string | null; fileHash?: string | null }) {
    const r = await sql<Raw>`SELECT e.id, e.vendor, e.vendor_id, e.incurred_on::text AS incurred_on, e.amount_cents, e.invoice_number, e.receipt_number, e.status,
        f.file_hash, f.perceptual_hash
      FROM expenses e
      LEFT JOIN LATERAL (SELECT file_hash, perceptual_hash FROM ocr_document_files df WHERE df.tenant_id = e.tenant_id AND df.document_id = e.receipt_document_id AND df.kind = 'original' ORDER BY df.created_at LIMIT 1) f ON true
      WHERE e.tenant_id = ${tenantId} AND e.status <> 'voided' AND (
        (e.amount_cents = ${x.totalCents} AND e.incurred_on BETWEEN (${x.incurredOn}::date - 3) AND (${x.incurredOn}::date + 3))
        ${x.invoiceNumber ? sql`OR e.invoice_number IS NOT NULL AND upper(regexp_replace(e.invoice_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(${x.invoiceNumber}, '[^A-Za-z0-9]', '', 'g'))` : sql``}
        ${x.receiptNumber ? sql`OR e.receipt_number = ${x.receiptNumber}` : sql``}
        ${x.fileHash ? sql`OR f.file_hash = ${x.fileHash}` : sql``}
      ) ORDER BY e.incurred_on DESC LIMIT 50`.execute(exec);
    return r.rows.map((c) => ({ id: String(c.id), vendorRaw: (c.vendor as string) ?? null, vendorId: (c.vendor_id as string) ?? null, incurredOn: String(c.incurred_on), totalCents: n(c.amount_cents),
      invoiceNumber: (c.invoice_number as string) ?? null, receiptNumber: (c.receipt_number as string) ?? null, status: String(c.status), fileHash: (c.file_hash as string) ?? null, perceptualHash: (c.perceptual_hash as string) ?? null }));
  }

  async insert(exec: Exec, values: Record<string, unknown>): Promise<string> {
    const r = await exec.insertInto('expenses').values(values as never).returning('id').executeTakeFirstOrThrow();
    return r.id;
  }

  /** optimistic update: lands only at the version the caller read; bumps the version. false = someone else changed it. */
  async updateAtVersion(exec: Exec, tenantId: string, id: string, version: number, set: Record<string, unknown>): Promise<boolean> {
    const r = await exec.updateTable('expenses').set({ ...set, version: sql`version + 1`, updated_at: new Date() } as never)
      .where('tenant_id', '=', tenantId).where('id', '=', id).where('version', '=', version).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) === 1;
  }

  async history(exec: Exec, tenantId: string, e: { expenseId: string; action: string; actor: string | null; reason?: string | null; before?: unknown; after?: unknown; version?: number | null }) {
    await exec.insertInto('expense_history').values({ tenant_id: tenantId, expense_id: e.expenseId, action: e.action, actor_user_id: e.actor, reason: e.reason ?? null,
      before_state: e.before == null ? null : JSON.stringify(e.before), after_state: e.after == null ? null : JSON.stringify(e.after), version: e.version ?? null } as never).execute();
  }
  async listHistory(tenantId: string, id: string) {
    const rows = await this.db.selectFrom('expense_history').select(['id', 'action', 'actor_user_id', 'reason', 'before_state', 'after_state', 'version', 'created_at'])
      .where('tenant_id', '=', tenantId).where('expense_id', '=', id).orderBy('created_at', 'asc').execute();
    return rows.map((h) => ({ id: h.id, action: h.action, actorUserId: h.actor_user_id, reason: h.reason, before: h.before_state, after: h.after_state, version: h.version, at: iso(h.created_at) }));
  }

  // ── line items / allocations / documents / bill payments ──────────────────────────────────────────────────────────
  async replaceLines(exec: Exec, tenantId: string, expenseId: string, lines: Array<{ description: string; quantity?: number | null; unitPriceCents?: number | null; totalCents: number; suggestedCategoryKey?: string | null; finalCategoryKey?: string | null; confidence?: number | null }>) {
    await exec.deleteFrom('expense_line_items').where('tenant_id', '=', tenantId).where('expense_id', '=', expenseId).execute();
    if (!lines.length) return;
    await exec.insertInto('expense_line_items').values(lines.map((l, i) => ({ tenant_id: tenantId, expense_id: expenseId, line_number: i + 1, description: l.description.slice(0, 300),
      quantity: l.quantity ?? null, unit_price_cents: l.unitPriceCents ?? null, total_cents: l.totalCents, suggested_category_key: l.suggestedCategoryKey ?? null,
      final_category_key: l.finalCategoryKey ?? null, confidence: l.confidence ?? null })) as never).execute();
  }
  async lines(tenantId: string, expenseId: string) {
    const rows = await this.db.selectFrom('expense_line_items').select(['line_number', 'description', 'quantity', 'unit_price_cents', 'total_cents', 'suggested_category_key', 'final_category_key', 'confidence']).where('tenant_id', '=', tenantId).where('expense_id', '=', expenseId).orderBy('line_number').execute();
    return rows.map((l) => ({ lineNumber: l.line_number, description: l.description, quantity: nn(l.quantity), unitPriceCents: nn(l.unit_price_cents), totalCents: n(l.total_cents),
      suggestedCategoryKey: l.suggested_category_key, finalCategoryKey: l.final_category_key, confidence: nn(l.confidence) }));
  }
  async replaceAllocations(exec: Exec, tenantId: string, expenseId: string, rows: Array<{ branchId: string; amountCents: number; basisPoints: number | null }>) {
    await exec.deleteFrom('expense_allocations').where('tenant_id', '=', tenantId).where('expense_id', '=', expenseId).execute();
    if (rows.length) await exec.insertInto('expense_allocations').values(rows.map((a) => ({ tenant_id: tenantId, expense_id: expenseId, branch_id: a.branchId, amount_cents: a.amountCents, basis_points: a.basisPoints })) as never).execute();
  }
  async allocations(tenantId: string, expenseId: string) {
    const rows = await this.db.selectFrom('expense_allocations').select(['branch_id', 'amount_cents', 'basis_points']).where('tenant_id', '=', tenantId).where('expense_id', '=', expenseId).execute();
    return rows.map((a) => ({ branchId: a.branch_id, amountCents: n(a.amount_cents), basisPoints: a.basis_points }));
  }
  async attachDocument(exec: Exec, tenantId: string, expenseId: string, documentId: string, role: string, actor: string | null) {
    await exec.insertInto('expense_documents').values({ tenant_id: tenantId, expense_id: expenseId, document_id: documentId, role, attached_by: actor } as never)
      .onConflict((oc) => oc.columns(['tenant_id', 'expense_id', 'document_id']).doNothing()).execute();
  }
  async documents(tenantId: string, expenseId: string) {
    const r = await sql<Raw>`SELECT d.document_id, d.role, d.created_at, o.pipeline_status, o.document_type, f.storage_key, f.mime_type, f.page_count
      FROM expense_documents d JOIN ocr_documents o ON o.id = d.document_id AND o.tenant_id = d.tenant_id
      LEFT JOIN LATERAL (SELECT storage_key, mime_type, page_count FROM ocr_document_files df WHERE df.tenant_id = d.tenant_id AND df.document_id = d.document_id AND df.kind = 'original' ORDER BY df.created_at LIMIT 1) f ON true
      WHERE d.tenant_id = ${tenantId} AND d.expense_id = ${expenseId} ORDER BY d.created_at`.execute(this.db);
    // the storage key is the reviewer's handle for a SIGNED preview (POST-free, short-lived) — never a URL (§128)
    return r.rows.map((d) => ({ documentId: String(d.document_id), role: String(d.role), attachedAt: iso(d.created_at), pipelineState: (d.pipeline_status as string) ?? null,
      documentType: (d.document_type as string) ?? null, storageKey: (d.storage_key as string) ?? null, mimeType: (d.mime_type as string) ?? null, pageCount: nn(d.page_count) }));
  }
  async insertBillPayment(exec: Exec, tenantId: string, p: { expenseId: string; amountCents: number; paidOn: string; method: string | null; reference: string | null; actor: string; idempotencyKey: string | null }) {
    const r = await exec.insertInto('expense_bill_payments').values({ tenant_id: tenantId, expense_id: p.expenseId, amount_cents: p.amountCents, paid_on: p.paidOn, payment_method: p.method,
      reference: p.reference, recorded_by: p.actor, idempotency_key: p.idempotencyKey } as never).onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing()).returning('id').executeTakeFirst();
    return r?.id ?? null;
  }
  async billPayments(tenantId: string, expenseId: string) {
    const rows = await this.db.selectFrom('expense_bill_payments').select(['id', 'amount_cents', 'paid_on', 'payment_method', 'reference', 'recorded_by', 'created_at'])
      .where('tenant_id', '=', tenantId).where('expense_id', '=', expenseId).orderBy('created_at').execute();
    return rows.map((p) => ({ id: p.id, amountCents: n(p.amount_cents), paidOn: ymd(p.paid_on), paymentMethod: p.payment_method, reference: p.reference, recordedBy: p.recorded_by, at: iso(p.created_at) }));
  }

  // ── categories / rules / settings ─────────────────────────────────────────────────────────────────────────────────
  async categoryRows(tenantId: string) {
    const rows = await this.db.selectFrom('expense_categories').select(['key', 'label', 'is_system', 'accounting_code', 'active', 'sort_order']).where('tenant_id', '=', tenantId).orderBy('sort_order').orderBy('label').execute();
    return rows.map((c) => ({ key: c.key, label: c.label, isSystem: !!c.is_system, accountingCode: c.accounting_code, active: !!c.active, sortOrder: n(c.sort_order) }));
  }
  async upsertCategory(exec: Exec, tenantId: string, c: { key: string; label: string; isSystem: boolean; accountingCode?: string | null; active?: boolean; actor: string }) {
    await exec.insertInto('expense_categories').values({ tenant_id: tenantId, key: c.key, label: c.label, is_system: c.isSystem, accounting_code: c.accountingCode ?? null, active: c.active ?? true, created_by: c.actor, updated_by: c.actor } as never)
      .onConflict((oc) => oc.columns(['tenant_id', 'key']).doUpdateSet({ label: c.label, ...(c.accountingCode !== undefined ? { accounting_code: c.accountingCode } : {}), ...(c.active !== undefined ? { active: c.active } : {}), updated_at: new Date(), updated_by: c.actor } as never)).execute();
  }
  async rules(tenantId: string, activeOnly = true) {
    let q = this.db.selectFrom('expense_category_rules').select(['id', 'vendor_norm', 'vendor_id', 'keyword', 'category_key', 'kind', 'hit_count', 'active', 'created_at']).where('tenant_id', '=', tenantId);
    if (activeOnly) q = q.where('active', '=', true);
    const rows = await q.orderBy('created_at', 'desc').execute();
    return rows.map((r) => ({ id: r.id, vendorNorm: r.vendor_norm, vendorId: r.vendor_id, keyword: r.keyword, categoryKey: r.category_key, kind: r.kind as 'owner_lock' | 'learned', hitCount: n(r.hit_count), active: !!r.active, createdAt: iso(r.created_at) }));
  }
  async upsertRule(exec: Exec, tenantId: string, r: { vendorNorm: string; vendorId?: string | null; keyword?: string | null; categoryKey: string; kind: 'owner_lock' | 'learned'; actor: string }): Promise<string> {
    // one active rule per (vendor, keyword): deactivate the old one, keep its history, write the new one
    await exec.updateTable('expense_category_rules').set({ active: false, updated_at: new Date(), updated_by: r.actor } as never)
      .where('tenant_id', '=', tenantId).where('vendor_norm', '=', r.vendorNorm).where('active', '=', true)
      .where(sql<boolean>`coalesce(keyword, '') = ${r.keyword ?? ''}`).execute();
    const row = await exec.insertInto('expense_category_rules').values({ tenant_id: tenantId, vendor_norm: r.vendorNorm, vendor_id: r.vendorId ?? null, keyword: r.keyword ?? null,
      category_key: r.categoryKey, kind: r.kind, created_by: r.actor, updated_by: r.actor } as never).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }
  async deactivateRule(exec: Exec, tenantId: string, id: string, actor: string): Promise<boolean> {
    const r = await exec.updateTable('expense_category_rules').set({ active: false, updated_at: new Date(), updated_by: actor } as never).where('tenant_id', '=', tenantId).where('id', '=', id).where('active', '=', true).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) === 1;
  }
  async bumpRule(exec: Exec, tenantId: string, vendorNorm: string) {
    await exec.updateTable('expense_category_rules').set({ hit_count: sql`hit_count + 1` } as never).where('tenant_id', '=', tenantId).where('vendor_norm', '=', vendorNorm).where('active', '=', true).execute();
  }
  /** how many times this salon already moved this vendor to `key` (the learning threshold, §41) */
  async priorCorrections(tenantId: string, expenseIdsVendorNorm: string, key: string): Promise<number> {
    const r = await sql<{ c: string }>`SELECT count(*)::text AS c FROM expense_history h JOIN expenses e ON e.id = h.expense_id AND e.tenant_id = h.tenant_id
      WHERE h.tenant_id = ${tenantId} AND h.action = 'category_corrected' AND h.after_state->>'category' = ${key} AND h.after_state->>'vendorNorm' = ${expenseIdsVendorNorm}`.execute(this.db);
    return n(r.rows[0]?.c);
  }
  async settings(tenantId: string) {
    const r = await this.db.selectFrom('expense_settings').select(['tenant_id', 'require_approval', 'auto_ready', 'auto_category', 'learn_from_corrections', 'duplicate_detection', 'bill_reminder_days', 'default_branch_id', 'receptionist_upload', 'technician_upload', 'shared_cost_policy', 'shared_cost_shares', 'version', 'updated_at', 'updated_by',
      'notify_needs_review', 'notify_bill_due', 'notify_duplicate', 'notify_weekly_summary', 'notify_monthly_summary', 'weekly_summary_sent_for', 'monthly_summary_sent_for', 'auto_approval_rules']).where('tenant_id', '=', tenantId).executeTakeFirst();
    return r ?? null;
  }
  async saveSettings(exec: Exec, tenantId: string, expectedVersion: number | null, set: Record<string, unknown>, actor: string): Promise<boolean> {
    if (expectedVersion == null) {
      const ins = await exec.insertInto('expense_settings').values({ tenant_id: tenantId, ...set, updated_by: actor } as never).onConflict((oc) => oc.column('tenant_id').doNothing()).returning('tenant_id').executeTakeFirst();
      return !!ins;
    }
    const r = await exec.updateTable('expense_settings').set({ ...set, version: sql`version + 1`, updated_at: new Date(), updated_by: actor } as never).where('tenant_id', '=', tenantId).where('version', '=', expectedVersion).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) === 1;
  }

  /** P2-3 (Oct 23 2026): the salon-wide (branch_id NULL) counted expenses of a window, and the own split of each that has
   *  one — the inputs of branchShareOfSalonWide (the share is computed, never stored). Tenant-scoped; integer cents. */
  async salonWideExpenses(tenantId: string, from: string, to: string): Promise<{ expenses: { id: string; amountCents: number }[]; splits: Map<string, { branchId: string; amountCents: number }[]> }> {
    const ex = await sql<{ id: string; amount_cents: string }>`SELECT e.id, e.amount_cents::text AS amount_cents FROM expenses e
      WHERE e.tenant_id = ${tenantId} AND ${counted} AND e.incurred_on BETWEEN ${from} AND ${to} AND e.branch_id IS NULL`.execute(this.db);
    const expenses = ex.rows.map((r) => ({ id: String(r.id), amountCents: n(r.amount_cents) }));
    const splits = new Map<string, { branchId: string; amountCents: number }[]>();
    if (expenses.length) {
      const al = await sql<{ expense_id: string; branch_id: string; amount_cents: string }>`SELECT a.expense_id, a.branch_id, a.amount_cents::text AS amount_cents FROM expense_allocations a
        WHERE a.tenant_id = ${tenantId} AND a.expense_id IN (${sql.join(expenses.map((e) => e.id))})`.execute(this.db);
      for (const r of al.rows) (splits.get(String(r.expense_id)) ?? splits.set(String(r.expense_id), []).get(String(r.expense_id))!).push({ branchId: String(r.branch_id), amountCents: n(r.amount_cents) });
    }
    return { expenses, splits };
  }
  async branchNames(tenantId: string): Promise<Map<string, string>> {
    const r = await sql<{ id: string; name: string }>`SELECT id, name FROM branches WHERE tenant_id = ${tenantId}`.execute(this.db);
    return new Map(r.rows.map((x) => [String(x.id), String(x.name)]));
  }

  // ── reports: SUM in SQL over the counted statuses only (§108, §151) ────────────────────────────────────────────────
  async totals(s: Scope, from: string, to: string) {
    const r = await sql<{ total: string; c: string }>`SELECT COALESCE(SUM(e.amount_cents), 0)::text AS total, count(*)::text AS c FROM expenses e
      WHERE e.tenant_id = ${s.tenantId} AND ${counted} AND e.incurred_on BETWEEN ${from} AND ${to} ${scoped(s)}`.execute(this.db);
    return { totalCents: n(r.rows[0]?.total), count: n(r.rows[0]?.c) };
  }
  async groupBy(s: Scope, from: string, to: string, by: 'category' | 'vendor' | 'branch' | 'day' | 'month' | 'payment_method'): Promise<Array<{ key: string; label: string | null; totalCents: number; count: number }>> {
    const keyExpr = by === 'category' ? sql`e.category` : by === 'vendor' ? sql`COALESCE(e.vendor_id::text, 'raw:' || lower(COALESCE(e.vendor, '')))` : by === 'branch' ? sql`COALESCE(e.branch_id::text, 'tenant')`
      : by === 'day' ? sql`e.incurred_on::text` : by === 'month' ? sql`to_char(e.incurred_on, 'YYYY-MM')` : sql`COALESCE(e.payment_method, 'unspecified')`;
    const labelExpr = by === 'vendor' ? sql`MAX(COALESCE(v.name, e.vendor))` : by === 'branch' ? sql`MAX(b.name)` : sql`NULL`;
    const r = await sql<{ k: string; label: string | null; total: string; c: string }>`SELECT ${keyExpr} AS k, ${labelExpr} AS label, SUM(e.amount_cents)::text AS total, count(*)::text AS c
      FROM expenses e LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${s.tenantId} AND ${counted} AND e.incurred_on BETWEEN ${from} AND ${to} ${scoped(s)}
      GROUP BY 1 ORDER BY ${by === 'day' || by === 'month' ? sql`1` : sql`SUM(e.amount_cents) DESC`}`.execute(this.db);
    return r.rows.map((x) => ({ key: x.k, label: x.label, totalCents: n(x.total), count: n(x.c) }));
  }
  /** §88: the counts an owner's dashboard shows (open work, not money) */
  async counts(s: Scope, today: string, reminderDays: number, tz = 'UTC') {
    const r = await sql<Raw>`SELECT
        count(*) FILTER (WHERE e.status = 'pending_review' AND e.archived_at IS NULL)::text AS needs_review,
        count(*) FILTER (WHERE e.status = 'draft' AND e.archived_at IS NULL)::text AS drafts,
        count(*) FILTER (WHERE e.duplicate_status IN ('possible', 'exact') AND e.status <> 'voided')::text AS duplicates,
        count(*) FILTER (WHERE e.kind = 'bill' AND e.bill_status IN ('open', 'partially_paid') AND e.status <> 'voided' AND e.due_date IS NOT NULL AND e.due_date >= ${today}::date AND e.due_date <= ${today}::date + ${reminderDays}::int)::text AS bills_due,
        count(*) FILTER (WHERE e.kind = 'bill' AND e.bill_status IN ('open', 'partially_paid') AND e.status <> 'voided' AND e.due_date < ${today}::date)::text AS bills_overdue,
        COALESCE(SUM(e.amount_cents - e.paid_cents) FILTER (WHERE e.kind = 'bill' AND e.bill_status IN ('open', 'partially_paid') AND e.status <> 'voided'), 0)::text AS bills_open_cents,
        count(*) FILTER (WHERE e.reimbursement_status IN ('pending', 'approved'))::text AS reimbursements_open,
        count(*) FILTER (WHERE (e.created_at AT TIME ZONE ${tz})::date = ${today}::date)::text AS created_today
      FROM expenses e WHERE e.tenant_id = ${s.tenantId} ${scoped(s)}`.execute(this.db);
    const x = r.rows[0] ?? {};
    return { needsReview: n(x.needs_review), drafts: n(x.drafts), possibleDuplicates: n(x.duplicates), billsDue: n(x.bills_due), billsOverdue: n(x.bills_overdue), billsOpenCents: n(x.bills_open_cents), reimbursementsOpen: n(x.reimbursements_open), createdToday: n(x.created_today) };
  }
  async receiptsUploadedOn(tenantId: string, day: string, tz = 'UTC'): Promise<number> {
    const r = await sql<{ c: string }>`SELECT count(*)::text AS c FROM ocr_documents WHERE tenant_id = ${tenantId} AND (created_at AT TIME ZONE ${tz})::date = ${day}::date AND deleted_at IS NULL`.execute(this.db);
    return n(r.rows[0]?.c);
  }
  /** charges per vendor over the last 7 months — the recurring detector's input (§57–58) */
  async chargeSeries(s: Scope, from: string, to: string) {
    const r = await sql<Raw>`SELECT COALESCE(e.vendor_id::text, lower(COALESCE(e.vendor, ''))) AS vk, MAX(COALESCE(v.name, e.vendor)) OVER (PARTITION BY COALESCE(e.vendor_id::text, lower(COALESCE(e.vendor, '')))) AS vl,
        e.incurred_on::text AS d, e.amount_cents, e.category
      FROM expenses e LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${s.tenantId} AND ${counted} AND e.incurred_on BETWEEN ${from} AND ${to} ${scoped(s)} AND (e.vendor_id IS NOT NULL OR COALESCE(e.vendor, '') <> '')
      ORDER BY e.incurred_on`.execute(this.db);
    return r.rows.map((x) => ({ vendorKey: String(x.vk), vendorLabel: String(x.vl ?? ''), incurredOn: String(x.d), amountCents: n(x.amount_cents), categoryKey: String(x.category) }));
  }
  async newVendorCount(s: Scope, from: string, to: string): Promise<number> {
    const r = await sql<{ c: string }>`SELECT count(DISTINCT e.vendor_id)::text AS c FROM expenses e WHERE e.tenant_id = ${s.tenantId} AND ${counted} AND e.vendor_id IS NOT NULL
      AND e.incurred_on BETWEEN ${from} AND ${to} ${scoped(s)}
      AND NOT EXISTS (SELECT 1 FROM expenses p WHERE p.tenant_id = e.tenant_id AND p.vendor_id = e.vendor_id AND p.status = 'approved' AND p.incurred_on < ${from})`.execute(this.db);
    return n(r.rows[0]?.c);
  }
  /** the rows the accountant export writes — the SAME filter as the report total (§202) */
  async exportRows(s: Scope, from: string, to: string, includeAllStatuses: boolean) {
    const r = await sql<Raw>`SELECT ${COLS}, b.name AS branch_name, EXISTS (SELECT 1 FROM expense_documents d WHERE d.tenant_id = e.tenant_id AND d.expense_id = e.id) OR e.receipt_document_id IS NOT NULL AS has_receipt
      FROM expenses e LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${s.tenantId} AND ${includeAllStatuses ? sql`e.status <> 'voided'` : counted} AND e.incurred_on BETWEEN ${from} AND ${to} ${scoped(s)}
      ORDER BY e.incurred_on, e.created_at, e.id LIMIT 100000`.execute(this.db);
    return r.rows.map((x) => ({ ...mapExpense(x), branchName: (x.branch_name as string) ?? null, hasReceipt: !!x.has_receipt }));
  }
  /** bills whose reminder is due today (§56) — across tenants, for the sweep */
  async billsToRemind(today: string, limit = 500) {
    const r = await sql<Raw>`SELECT e.id, e.tenant_id, e.branch_id, e.due_date::text AS due_date, e.amount_cents, e.paid_cents, e.bill_reminder_kind, e.bill_reminded_on::text AS reminded_on,
        COALESCE(s.bill_reminder_days, 7) AS days, COALESCE(v.name, e.vendor) AS vendor
      FROM expenses e LEFT JOIN expense_settings s ON s.tenant_id = e.tenant_id LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id
      WHERE e.kind = 'bill' AND e.bill_status IN ('open', 'partially_paid') AND e.status <> 'voided' AND e.due_date IS NOT NULL
        AND e.due_date <= ${today}::date + COALESCE(s.bill_reminder_days, 7)
        AND (e.bill_reminded_on IS NULL OR e.bill_reminded_on < ${today}::date)
      ORDER BY e.due_date LIMIT ${limit}`.execute(this.db);
    return r.rows.map((x) => ({ id: String(x.id), tenantId: String(x.tenant_id), branchId: (x.branch_id as string) ?? null, dueDate: String(x.due_date), openCents: n(x.amount_cents) - n(x.paid_cents),
      lastKind: (x.bill_reminder_kind as string) ?? null, remindedOn: (x.reminded_on as string) ?? null, reminderDays: n(x.days), vendor: (x.vendor as string) ?? null }));
  }
  async markReminded(exec: Exec, tenantId: string, id: string, kind: string, today: string): Promise<boolean> {
    const r = await exec.updateTable('expenses').set({ bill_reminder_kind: kind, bill_reminded_on: today } as never).where('tenant_id', '=', tenantId).where('id', '=', id)
      .where(sql<boolean>`(bill_reminded_on IS NULL OR bill_reminded_on < ${today}::date)`).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) === 1;
  }

  // ── receipt evidence (read-only view of the OCR document this expense came from) ─────────────────────────────────
  async receiptEvidence(exec: Exec, tenantId: string, documentId: string) {
    const r = await sql<Raw>`SELECT o.id, o.branch_id, o.pipeline_status, o.document_type, o.vendor, o.vendor_id, o.document_number, o.document_date::text AS document_date,
        o.subtotal_cents, o.tax_cents, o.fees_cents, o.discount_cents, o.total_cents, o.overall_confidence, o.currency, f.file_hash, f.perceptual_hash
      FROM ocr_documents o LEFT JOIN LATERAL (SELECT file_hash, perceptual_hash FROM ocr_document_files df WHERE df.tenant_id = o.tenant_id AND df.document_id = o.id AND df.kind = 'original' ORDER BY df.created_at LIMIT 1) f ON true
      WHERE o.tenant_id = ${tenantId} AND o.id = ${documentId} AND o.deleted_at IS NULL`.execute(exec);
    const d = r.rows[0]; if (!d) return null;
    const fields = await sql<Raw>`SELECT field_key, value_text, value_cents, confidence, state, corrected_value FROM ocr_extracted_fields WHERE tenant_id = ${tenantId} AND document_id = ${documentId}`.execute(exec);
    const lines = await sql<Raw>`SELECT line_number, description, quantity, unit_price_cents, line_total_cents, confidence FROM ocr_line_items WHERE tenant_id = ${tenantId} AND document_id = ${documentId} ORDER BY line_number`.execute(exec);
    return {
      id: String(d.id), branchId: (d.branch_id as string) ?? null, pipelineState: String(d.pipeline_status), documentType: String(d.document_type ?? 'unknown'),
      vendor: (d.vendor as string) ?? null, vendorId: (d.vendor_id as string) ?? null, documentNumber: (d.document_number as string) ?? null, documentDate: (d.document_date as string) ?? null,
      subtotalCents: nn(d.subtotal_cents), taxCents: nn(d.tax_cents), feeCents: nn(d.fees_cents), discountCents: nn(d.discount_cents), totalCents: nn(d.total_cents),
      confidence: nn(d.overall_confidence), currency: String(d.currency ?? 'USD'), fileHash: (d.file_hash as string) ?? null, perceptualHash: (d.perceptual_hash as string) ?? null,
      fields: fields.rows.map((f) => ({ key: String(f.field_key), text: (f.corrected_value as string) ?? (f.value_text as string) ?? null, cents: nn(f.value_cents), confidence: nn(f.confidence), state: String(f.state) })),
      lines: lines.rows.map((l) => ({ lineNumber: n(l.line_number), description: String(l.description ?? ''), quantity: nn(l.quantity), unitPriceCents: nn(l.unit_price_cents), totalCents: nn(l.line_total_cents), confidence: nn(l.confidence) })),
    };
  }

  // ── §142 receipt → existing expense: the candidates a receipt could be the evidence for ────────────────────────────
  async receiptMatchCandidates(tenantId: string, x: { totalCents: number | null; documentDate: string | null; documentNumber: string | null; excludeDocumentId?: string | null }) {
    if (x.totalCents == null && !x.documentNumber) return [];
    const ref = x.documentNumber ? x.documentNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null;
    const r = await sql<Raw>`SELECT e.id, e.branch_id, e.vendor, v.name AS vendor_name, e.incurred_on::text AS incurred_on, e.amount_cents, e.invoice_number, e.receipt_number, e.reference_number, e.receipt_document_id, e.status
      FROM expenses e LEFT JOIN inventory_vendors v ON v.id = e.vendor_id AND v.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${tenantId} AND e.status IN ('draft', 'pending_review', 'approved') AND e.archived_at IS NULL
        AND (${x.excludeDocumentId ?? null}::uuid IS NULL OR e.receipt_document_id IS DISTINCT FROM ${x.excludeDocumentId ?? null}::uuid)
        AND (
          ${x.totalCents != null && x.documentDate ? sql`(e.amount_cents = ${x.totalCents} AND e.incurred_on BETWEEN (${x.documentDate}::date - 2) AND (${x.documentDate}::date + 2))` : x.totalCents != null ? sql`e.amount_cents = ${x.totalCents}` : sql`false`}
          ${ref ? sql`OR upper(regexp_replace(COALESCE(e.invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = ${ref} OR upper(regexp_replace(COALESCE(e.receipt_number, ''), '[^A-Za-z0-9]', '', 'g')) = ${ref} OR upper(regexp_replace(COALESCE(e.reference_number, ''), '[^A-Za-z0-9]', '', 'g')) = ${ref}` : sql``}
        ) ORDER BY e.incurred_on DESC LIMIT 25`.execute(this.db);
    return r.rows.map((c) => ({ id: String(c.id), branchId: (c.branch_id as string) ?? null, vendor: (c.vendor as string) ?? null, vendorName: (c.vendor_name as string) ?? null, incurredOn: String(c.incurred_on), amountCents: n(c.amount_cents),
      invoiceNumber: (c.invoice_number as string) ?? null, receiptNumber: (c.receipt_number as string) ?? null, referenceNumber: (c.reference_number as string) ?? null, receiptDocumentId: (c.receipt_document_id as string) ?? null, status: String(c.status) }));
  }

  // ── §177–§179 digests ─────────────────────────────────────────────────────────────────────────────────────────────
  /** every salon with an expense or a settings row, with its digest preferences (defaults when no row exists) */
  async digestTenants(limit = 2000) {
    const r = await sql<Raw>`SELECT t.tenant_id, COALESCE(s.notify_weekly_summary, true) AS weekly, COALESCE(s.notify_monthly_summary, true) AS monthly, s.weekly_summary_sent_for, s.monthly_summary_sent_for
      FROM (SELECT tenant_id FROM expense_settings UNION SELECT DISTINCT tenant_id FROM expenses) t LEFT JOIN expense_settings s ON s.tenant_id = t.tenant_id ORDER BY t.tenant_id LIMIT ${limit}`.execute(this.db);
    return r.rows.map((x) => ({ tenantId: String(x.tenant_id), weekly: !!x.weekly, monthly: !!x.monthly, weeklySentFor: (x.weekly_summary_sent_for as string) ?? null, monthlySentFor: (x.monthly_summary_sent_for as string) ?? null }));
  }
  async receiptsUploadedBetween(tenantId: string, from: string, to: string, tz = 'UTC'): Promise<number> {
    const r = await sql<{ c: string }>`SELECT count(*)::text AS c FROM ocr_documents WHERE tenant_id = ${tenantId} AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date AND deleted_at IS NULL`.execute(this.db);
    return n(r.rows[0]?.c);
  }
  /** marks the period sent — inserts the settings row (defaults) when the salon never saved one; false = already sent */
  async markDigestSent(exec: Exec, tenantId: string, kind: 'weekly' | 'monthly', period: string): Promise<boolean> {
    const r = kind === 'weekly'
      ? await sql<{ tenant_id: string }>`INSERT INTO expense_settings (tenant_id, weekly_summary_sent_for) VALUES (${tenantId}, ${period})
          ON CONFLICT (tenant_id) DO UPDATE SET weekly_summary_sent_for = EXCLUDED.weekly_summary_sent_for, updated_at = now()
          WHERE expense_settings.weekly_summary_sent_for IS DISTINCT FROM EXCLUDED.weekly_summary_sent_for RETURNING tenant_id`.execute(exec)
      : await sql<{ tenant_id: string }>`INSERT INTO expense_settings (tenant_id, monthly_summary_sent_for) VALUES (${tenantId}, ${period})
          ON CONFLICT (tenant_id) DO UPDATE SET monthly_summary_sent_for = EXCLUDED.monthly_summary_sent_for, updated_at = now()
          WHERE expense_settings.monthly_summary_sent_for IS DISTINCT FROM EXCLUDED.monthly_summary_sent_for RETURNING tenant_id`.execute(exec);
    return r.rows.length === 1;
  }
}
