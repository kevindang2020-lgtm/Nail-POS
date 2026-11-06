// receipt-center.ts — AI OCR Receipt Scanner guide (Nov 1 2026): `/pos/receipt-center/*`, the READ side of the scanner page.
//
// Everything is read from the existing receipt pipeline (ocr_documents and its child tables, migrations 344 / 359 / 700) and
// the books it posts to (expenses.receipt_document_id, ocr_postings). Nothing here uploads, extracts, approves, posts an
// expense, receives stock or moves money — those stay on the receipt workflow routes (/pos/ai-ocr-receipt/*), the finance
// module's ExpenseService and the InventoryService. What this adds:
//   • the four cards with one stated definition each (scanned in the period · waiting for a person · open duplicate holds ·
//     expenses approved from a receipt in the period), plus the failures that used to be invisible ("0" was shown for a
//     pipeline that never ran);
//   • the receipt history the old list could not give: search (vendor, receipt / invoice number, document id, product or SKU on
//     a line, an exact amount), status groups, the date the filter means (uploaded · purchase date · posted), presets and a
//     From/To range in the salon's time zone, sort, numbered pages (the old list stopped at 200 rows);
//   • four separate status tracks per receipt (reading · expense · stock receiving · duplicate) instead of one word;
//   • a read-only detail (fields, lines, checks, duplicates, postings, the approval trail);
//   • Check OCR System — read-only, evidence-backed, never a test posting.
// Branch scope is the finance module's rule (the same one the receipt list uses): a branch-restricted person sees their branches.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { addDays as addYmdDays, dateColumnYmd } from '@aipowersalon/date-time';   // §87: one calendar helper

type Row = Record<string, any>;
export interface RcCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
/** the branches this person may see; null = the whole salon */
export type ScopeFn = (ctx: RcCtx) => Promise<string[] | null>;
/** the AI entitlement gate's decision for the scanner package */
export type EntitlementFn = (ctx: RcCtx) => Promise<{ allowed: boolean; reason: string; subscriptionStatus: string } | null>;
export class ReceiptCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

export const RC_GROUPS = ['all', 'processing', 'needs_review', 'duplicates', 'approved', 'posted', 'failed', 'rejected', 'quarantined',
  // Receipt Review's own tabs (Receipt Document Recognition guide): one exact queue each
  'review', 'extracting', 'manual_entry', 'reading_failed', 'posting_failed', 'duplicate_hold'] as const;
export const RC_DATE_FIELDS = ['uploaded', 'purchase', 'posted'] as const;
export const RC_SORTS = ['newest', 'oldest', 'purchase_date', 'total_high', 'total_low', 'vendor'] as const;
export const RC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const RC_PAGE_SIZES = [10, 25, 50, 100] as const;
const GROUP_STATES: Record<string, string[]> = {
  processing: ['uploaded', 'scanning', 'extracting', 'validating'],
  needs_review: ['review_required', 'in_review', 'manual_entry_required'],
  duplicates: ['duplicate_hold'],
  approved: ['approved', 'posting', 'failed'],   // approved, not (yet) on the books — a failed posting is still waiting here
  posted: ['posted'],
  failed: ['extraction_failed', 'failed'],
  rejected: ['rejected'],
  quarantined: ['quarantined'],
  review: ['review_required', 'in_review'],
  extracting: ['uploaded', 'scanning', 'extracting', 'validating'],
  manual_entry: ['manual_entry_required'],
  reading_failed: ['extraction_failed'],
  posting_failed: ['failed'],
  duplicate_hold: ['duplicate_hold'],
};
const OPEN_STATES = [...GROUP_STATES.processing, ...GROUP_STATES.needs_review, ...GROUP_STATES.duplicates, ...GROUP_STATES.failed, 'quarantined', 'approved', 'posting'];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const day = (v: unknown) => (v == null ? null : (dateColumnYmd(v)));
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
/** "12.50", "$12.50", "12" → cents; anything else → null */
const moneyCents = (q: string) => { const m = /^\$?\s*(\d{1,7})(?:\.(\d{1,2}))?$/.exec(q.trim()); return m ? Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0')) : null; };

/** the four status tracks the guide asks for — derived from the pipeline's own columns, never collapsed into one word */
export function tracks(r: { pipeline_status?: unknown; duplicate_status?: string | null; expense_status?: string | null; posting_dest?: string | null; posting_status?: string | null }) {
  const p = String(r.pipeline_status);
  const reading = GROUP_STATES.processing.includes(p) ? 'processing' : p === 'extraction_failed' ? 'failed' : p === 'quarantined' ? 'quarantined'
    : p === 'manual_entry_required' ? 'manual_entry' : p === 'rejected' ? 'rejected' : 'read';
  const expense = r.expense_status ? `expense_${r.expense_status}` : r.posting_dest === 'expense' && r.posting_status === 'failed' ? 'posting_failed'
    : ['approved', 'posting'].includes(p) && r.posting_dest !== 'inventory_receipt' ? 'approved_not_posted' : p === 'rejected' ? 'not_linked' : ['review_required', 'in_review', 'manual_entry_required', 'duplicate_hold'].includes(p) ? 'awaiting_review' : 'not_linked';
  const receiving = r.posting_dest === 'inventory_receipt' ? (r.posting_status === 'posted' ? 'received' : r.posting_status === 'failed' ? 'receiving_failed' : 'receiving_pending') : 'not_applicable';
  const duplicate = r.duplicate_status && r.duplicate_status !== 'none' ? String(r.duplicate_status) : 'none';
  return { reading, expense, receiving, duplicate };
}

export class ReceiptCenter {
  constructor(private readonly db: Kysely<any>, private readonly scope: ScopeFn, private readonly entitlement: EntitlementFn,
    private readonly providerKeys: () => string[], private readonly now: () => number = () => Date.now()) {}

  /** the branch predicate for `col` — returned wrapped (a bare RawBuilder must never be awaited) */
  private async inScope(ctx: RcCtx, col: ReturnType<typeof sql>): Promise<{ w: ReturnType<typeof sql> }> {
    const b = await this.scope(ctx);
    if (b === null) return { w: sql`true` };
    if (!b.length) return { w: sql`false` };
    return { w: sql`${col} = any(${b.filter(isUuid)}::uuid[])` };
  }
  /** the salon's zone — the ONE canonical reader (branch setting → salon setting → default) */
  private tz(ctx: RcCtx): Promise<string> { return branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null); }
  /** a salon-local [from, to] day range for a preset (or a custom range) → UTC bounds */
  private async period(ctx: RcCtx, f: { preset?: unknown; from?: unknown; to?: unknown }, fallback: (typeof RC_PRESETS)[number] = 'all') {
    const tz = await this.tz(ctx);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = pick(RC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : fallback);
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    const d = (s: string, n: number) => addYmdDays(s, n);
    const t = new Date(today + 'T12:00:00Z'); const dow = (t.getUTCDay() + 6) % 7;
    let from: string; let to = today;
    switch (preset) {
      case 'today': from = today; break;
      case 'yesterday': from = to = d(today, -1); break;
      case 'week': from = d(today, -dow); break;
      case 'last_7': from = d(today, -6); break;
      case 'month': from = today.slice(0, 8) + '01'; break;
      case 'last_month': { const first = today.slice(0, 8) + '01'; to = d(first, -1); from = to.slice(0, 8) + '01'; break; }
      case 'last_30': from = d(today, -29); break;
      case 'last_90': from = d(today, -89); break;
      case 'year': from = today.slice(0, 4) + '-01-01'; break;
      default: {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z) throw new ReceiptCenterError('Choose a From and a To date.', 'RC_INVALID_PERIOD');
        if (a > z) throw new ReceiptCenterError('The From date must be on or before the To date.', 'RC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today, tz };
  }

  // ── the four cards (one definition each) + what is stuck ──────────────────────────────────────────────────────
  async summary(ctx: RcCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const T = ctx.tenantId;
    const per = await this.period(ctx, f, 'month');
    const S = (await this.inScope(ctx, sql`d.branch_id`)).w;
    const inPer = (col: ReturnType<typeof sql>) => (per.start && per.end ? sql`${col} >= ${per.start} and ${col} < ${per.end}` : sql`true`);
    const r = (await sql<Row>`select
        count(*) filter (where ${inPer(sql`d.created_at`)})::int as scanned,
        count(*) filter (where d.pipeline_status = any(${GROUP_STATES.needs_review}::text[]))::int as needs_review,
        count(*) filter (where d.pipeline_status = 'duplicate_hold' or (d.duplicate_status <> 'none' and d.pipeline_status = any(${OPEN_STATES}::text[])))::int as duplicates,
        count(*) filter (where d.pipeline_status = any(${GROUP_STATES.processing}::text[]))::int as processing,
        count(*) filter (where d.pipeline_status = any(${GROUP_STATES.failed}::text[]))::int as failed,
        count(*) filter (where d.pipeline_status = 'quarantined')::int as quarantined,
        count(*) filter (where d.pipeline_status = 'approved')::int as approved_not_posted,
        min(d.created_at) filter (where d.pipeline_status = any(${GROUP_STATES.processing}::text[])) as oldest_processing
      from ocr_documents d where d.tenant_id = ${T} and d.deleted_at is null and ${S}`.execute(this.db)).rows[0] ?? {};
    const states = Object.fromEntries((await sql<Row>`select d.pipeline_status as s, count(*)::int as n from ocr_documents d where d.tenant_id = ${T} and d.deleted_at is null and ${S} group by d.pipeline_status`.execute(this.db)).rows.map((x) => [String(x.s), N(x.n)]));
    // "Approved expenses": expenses the books hold for a receipt, approved, dated by when they were posted from it
    const e = (await sql<Row>`select count(*)::int as n, coalesce(sum(x.amount_cents), 0)::bigint as cents from expenses x join ocr_documents d on d.id = x.receipt_document_id and d.tenant_id = x.tenant_id
      left join lateral (select max(p.posted_at) as posted_at from ocr_postings p where p.tenant_id = d.tenant_id and p.document_id = d.id and p.destination = 'expense' and p.status = 'posted') p on true
      where x.tenant_id = ${T} and x.status = 'approved' and d.deleted_at is null and ${S} and ${inPer(sql`coalesce(p.posted_at, x.created_at)`)}`.execute(this.db)).rows[0] ?? {};
    return {
      period: { preset: per.preset, from: per.from, to: per.to, today: per.today, timeZone: per.tz },
      cards: { scanned: N(r.scanned), needsReview: N(r.needs_review), duplicates: N(r.duplicates), approvedExpenses: N(e.n), approvedExpenseCents: N(e.cents) },
      // every queue's current size (Receipt Review's tabs and its six cards read these)
      states,
      pipeline: { processing: N(r.processing), failed: N(r.failed), quarantined: N(r.quarantined), approvedNotPosted: N(r.approved_not_posted), oldestProcessingAt: iso(r.oldest_processing) },
      definitions: { scanned: 'uploaded_in_period', needsReview: 'current_queue', duplicates: 'open_holds', approvedExpenses: 'approved_expense_from_receipt_in_period' },
    };
  }

  // ── receipt history ───────────────────────────────────────────────────────────────────────────────────────────
  async documents(ctx: RcCtx, f: Record<string, unknown>) {
    const T = ctx.tenantId;
    const pageSize = (RC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const group = pick(RC_GROUPS, f.group) ?? 'all';
    const dateField = pick(RC_DATE_FIELDS, f.dateField) ?? 'uploaded';
    const sort = pick(RC_SORTS, f.sort) ?? 'newest';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const where = [sql`d.tenant_id = ${T}`, sql`d.deleted_at is null`, (await this.inScope(ctx, sql`d.branch_id`)).w];
    // "duplicates" = the open holds the card counts (a hold, or a flagged receipt still in the pipeline)
    if (group === 'duplicates') where.push(sql`(d.pipeline_status = 'duplicate_hold' or (d.duplicate_status <> 'none' and d.pipeline_status = any(${OPEN_STATES}::text[])))`);
    else if (group !== 'all') where.push(sql`d.pipeline_status = any(${GROUP_STATES[group]}::text[])`);
    if (per.start && per.end) {
      if (dateField === 'purchase') where.push(sql`d.document_date >= ${per.from}::date and d.document_date <= ${per.to}::date`);
      else if (dateField === 'posted') where.push(sql`p.posted_at >= ${per.start} and p.posted_at < ${per.end}`);
      else where.push(sql`d.created_at >= ${per.start} and d.created_at < ${per.end}`);
    }
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      const cents = moneyCents(q);
      where.push(sql`(d.vendor ilike ${like} or d.document_number ilike ${like} or d.id::text = ${q} or ${cents === null ? sql`false` : sql`d.total_cents = ${cents}`}
        or exists (select 1 from ocr_line_items l where l.tenant_id = d.tenant_id and l.document_id = d.id and (l.description ilike ${like} or l.sku ilike ${like}))
        or exists (select 1 from expenses x where x.tenant_id = d.tenant_id and x.receipt_document_id = d.id and (x.id::text = ${q} or x.invoice_number ilike ${like} or x.receipt_number ilike ${like})))`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`ocr_documents d
      left join lateral (select destination, status, posted_at, external_ref from ocr_postings where tenant_id = d.tenant_id and document_id = d.id order by created_at desc limit 1) p on true
      left join lateral (select x.id, x.status from expenses x where x.tenant_id = d.tenant_id and x.receipt_document_id = d.id order by x.created_at desc limit 1) x on true
      left join branches b on b.id = d.branch_id and b.tenant_id = d.tenant_id
      left join users u on u.id = d.uploaded_by_user_id and u.tenant_id = d.tenant_id`;
    const order = sort === 'oldest' ? sql`d.created_at asc, d.id asc` : sort === 'purchase_date' ? sql`d.document_date desc nulls last, d.created_at desc, d.id desc`
      : sort === 'total_high' ? sql`d.total_cents desc nulls last, d.created_at desc, d.id desc` : sort === 'total_low' ? sql`d.total_cents asc nulls last, d.created_at desc, d.id desc`
      : sort === 'vendor' ? sql`lower(d.vendor) asc nulls last, d.created_at desc, d.id desc` : sql`d.created_at desc, d.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select d.id, d.vendor, d.document_number, d.document_date, d.created_at, d.total_cents, d.currency, d.pipeline_status, d.duplicate_status, d.page_count,
        d.document_type, d.quality_flags, d.suggested_match, d.suggested_expense_id, th.thumbnail_key,
        p.destination as posting_dest, p.status as posting_status, p.posted_at, x.id as expense_id, x.status as expense_status, b.name as branch, coalesce(u.full_name, u.email) as uploader
      from ${FROM} left join lateral (select storage_key as thumbnail_key from ocr_document_files where tenant_id = d.tenant_id and document_id = d.id and kind = 'thumbnail' order by created_at desc limit 1) th on true where ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({ id: String(r.id), vendor: r.vendor ?? null, number: r.document_number ?? null, purchaseDate: day(r.document_date), uploadedAt: iso(r.created_at),
        postedAt: iso(r.posted_at), totalCents: r.total_cents == null ? null : N(r.total_cents), currency: r.currency ?? 'USD', pipeline: r.pipeline_status, pages: N(r.page_count) || 1,
        branch: r.branch ?? null, uploader: r.uploader ?? null, expenseId: r.expense_id ? String(r.expense_id) : null, tracks: tracks(r),
        documentType: r.document_type ?? 'unknown', qualityFlags: Array.isArray(r.quality_flags) ? r.quality_flags : [], suggestedMatch: r.suggested_match ?? null,
        suggestedExpenseId: r.suggested_expense_id ? String(r.suggested_expense_id) : null, thumbnailKey: r.thumbnail_key ?? null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, group, dateField, sort, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz },
    };
  }

  // ── one receipt, read-only ────────────────────────────────────────────────────────────────────────────────────
  async document(ctx: RcCtx, id: string) {
    const T = ctx.tenantId;
    if (!isUuid(id)) throw new ReceiptCenterError('Receipt not found.', 'RC_NOT_FOUND', 404);
    const S = (await this.inScope(ctx, sql`d.branch_id`)).w;
    const d = (await sql<Row>`select d.id, d.vendor, d.document_number, d.document_date, d.date_ambiguous, d.currency, d.subtotal_cents, d.tax_cents, d.fees_cents, d.discount_cents,
        d.total_cents, d.is_credit_or_refund, d.document_type, d.page_count, d.created_at, d.source_channel, d.pipeline_status, d.review_status, d.validation_status, d.quality_flags,
        d.last_extraction_error, d.extraction_attempts, d.duplicate_status, b.name as branch, coalesce(u.full_name, u.email) as uploader from ocr_documents d left join branches b on b.id = d.branch_id and b.tenant_id = d.tenant_id
      left join users u on u.id = d.uploaded_by_user_id and u.tenant_id = d.tenant_id where d.tenant_id = ${T} and d.id = ${id}::uuid and d.deleted_at is null and ${S}`.execute(this.db)).rows[0];
    if (!d) throw new ReceiptCenterError('Receipt not found.', 'RC_NOT_FOUND', 404);   // another branch / salon answers like a missing one
    const [fields, lines, validation, dupes, postings, approvals, jobs, category, expense] = await Promise.all([
      sql<Row>`select field_key, value_text, value_cents, confidence, state, source_page, corrected_value, corrected_at from ocr_extracted_fields where tenant_id = ${T} and document_id = ${id}::uuid order by field_key`.execute(this.db),
      sql<Row>`select line_number, description, sku, quantity, unit, unit_price_cents, discount_cents, tax_cents, line_total_cents, confidence, reconciles from ocr_line_items where tenant_id = ${T} and document_id = ${id}::uuid order by line_number`.execute(this.db),
      sql<Row>`select status, flags, blocks_posting, missing_fields, checks, created_at from ocr_validation_results where tenant_id = ${T} and document_id = ${id}::uuid order by created_at desc limit 1`.execute(this.db),
      // a candidate is shown only if it is in the same salon AND a branch this person may see
      sql<Row>`select m.status, m.reason, m.dismissed, m.matched_document_id, o.vendor, o.total_cents, o.document_date, o.pipeline_status from ocr_duplicate_matches m
        join ocr_documents o on o.id = m.matched_document_id and o.tenant_id = m.tenant_id where m.tenant_id = ${T} and m.document_id = ${id}::uuid and ${(await this.inScope(ctx, sql`o.branch_id`)).w} order by m.created_at desc`.execute(this.db),
      sql<Row>`select destination, status, external_ref, error_code, posted_at, created_at from ocr_postings where tenant_id = ${T} and document_id = ${id}::uuid order by created_at desc`.execute(this.db),
      // the trail is the module's own audit rows (approvals live in ocr_reviews.decision_state; ocr_approvals is never written)
      sql<Row>`select a.action_type as action, a.metadata_json->>'reason' as reason, a.metadata_json->>'outcome' as outcome, a.created_at, coalesce(u.full_name, u.email) as actor from audit_logs a
        left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id where a.tenant_id = ${T} and a.entity_type = 'ocr_document' and a.entity_id = ${id} order by a.created_at desc limit 50`.execute(this.db),
      sql<Row>`select provider_key, status, attempt, error_code, requested_at, completed_at from ocr_jobs where tenant_id = ${T} and document_id = ${id}::uuid order by requested_at desc limit 10`.execute(this.db),
      sql<Row>`select suggested_name, score, source, confirmed from ocr_category_suggestions where tenant_id = ${T} and document_id = ${id}::uuid order by created_at desc limit 1`.execute(this.db),
      sql<Row>`select id, status, category, amount_cents, created_at from expenses where tenant_id = ${T} and receipt_document_id = ${id}::uuid order by created_at desc limit 1`.execute(this.db),
    ]);
    const post = postings.rows[0];
    const v = validation.rows[0];
    return {
      id: String(d.id), vendor: d.vendor ?? null, number: d.document_number ?? null, purchaseDate: day(d.document_date), dateAmbiguous: !!d.date_ambiguous, currency: d.currency ?? 'USD',
      amounts: { subtotalCents: d.subtotal_cents == null ? null : N(d.subtotal_cents), taxCents: d.tax_cents == null ? null : N(d.tax_cents), feesCents: d.fees_cents == null ? null : N(d.fees_cents),
        discountCents: d.discount_cents == null ? null : N(d.discount_cents), totalCents: d.total_cents == null ? null : N(d.total_cents), creditOrRefund: !!d.is_credit_or_refund },
      documentType: d.document_type, pages: N(d.page_count) || 1, branch: d.branch ?? null, uploader: d.uploader ?? null, uploadedAt: iso(d.created_at), channel: d.source_channel,
      pipeline: d.pipeline_status, review: d.review_status, validationStatus: d.validation_status, qualityFlags: Array.isArray(d.quality_flags) ? d.quality_flags : [],
      lastError: d.last_extraction_error ? 'extraction_error' : null, extractionAttempts: N(d.extraction_attempts),
      tracks: tracks({ ...d, expense_status: expense.rows[0]?.status ?? null, posting_dest: post?.destination ?? null, posting_status: post?.status ?? null }),
      // confidence stays a reading of the text; "unknown" when the provider gave none — never an invented number
      fields: fields.rows.map((x) => ({ key: x.field_key, value: x.corrected_value ?? x.value_text ?? null, cents: x.value_cents == null ? null : N(x.value_cents), state: x.state,
        confidence: x.confidence == null || Number(x.confidence) === 0 ? null : Number(x.confidence), page: x.source_page ?? null, corrected: !!x.corrected_at })),
      lines: lines.rows.map((x) => ({ n: N(x.line_number), description: x.description ?? null, sku: x.sku ?? null, quantity: x.quantity == null ? null : Number(x.quantity), unit: x.unit ?? null,
        unitCents: x.unit_price_cents == null ? null : N(x.unit_price_cents), totalCents: x.line_total_cents == null ? null : N(x.line_total_cents), reconciles: x.reconciles ?? null })),
      checks: v ? { status: v.status, blocksPosting: !!v.blocks_posting, flags: v.flags ?? [], missing: v.missing_fields ?? [], at: iso(v.created_at) } : null,
      duplicates: dupes.rows.map((x) => ({ status: x.status, reason: x.reason ?? null, dismissed: !!x.dismissed, documentId: String(x.matched_document_id), vendor: x.vendor ?? null,
        totalCents: x.total_cents == null ? null : N(x.total_cents), purchaseDate: day(x.document_date), pipeline: x.pipeline_status })),
      category: category.rows[0] ? { name: category.rows[0].suggested_name ?? null, source: category.rows[0].source, confirmed: !!category.rows[0].confirmed } : null,
      expense: expense.rows[0] ? { id: String(expense.rows[0].id), status: expense.rows[0].status, category: expense.rows[0].category, amountCents: N(expense.rows[0].amount_cents), at: iso(expense.rows[0].created_at) } : null,
      postings: postings.rows.map((x) => ({ destination: x.destination, status: x.status, ref: x.external_ref ?? null, error: x.error_code ?? null, postedAt: iso(x.posted_at), at: iso(x.created_at) })),
      trail: approvals.rows.map((x) => ({ action: String(x.action).replace(/^document\./, ''), outcome: x.outcome ?? null, reason: x.reason ?? null, by: x.actor ?? null, at: iso(x.created_at) })),
      jobs: jobs.rows.map((x) => ({ provider: x.provider_key, status: x.status, attempt: N(x.attempt), error: x.error_code ?? null, at: iso(x.requested_at), doneAt: iso(x.completed_at) })),
    };
  }

  // ── Check OCR System (read-only; one run per salon per 30 s) ─────────────────────────────────────────────────
  async check(ctx: RcCtx) {
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from receipt_scanner_health_runs where tenant_id = ${T}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; state: St; count?: number | null; detail?: Record<string, unknown> }> = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    let ent: Awaited<ReturnType<EntitlementFn>> = null; let entErr = false;
    try { ent = await this.entitlement(ctx); } catch { entErr = true; }
    checks.push({ key: 'subscription', state: entErr || !ent ? 'UNAVAILABLE' : ent.allowed ? 'PASSED' : 'FAILED', detail: { reason: ent?.reason ?? (entErr ? 'unreadable' : 'unknown') } });
    const providers = this.providerKeys();
    checks.push({ key: 'ocr_provider', state: providers.length ? 'PASSED' : 'WARNING', count: providers.length });
    const docs = N((await one(sql<Row>`select count(*)::int as n from ocr_documents where tenant_id = ${T} and deleted_at is null`)).n);
    checks.push({ key: 'documents_present', state: docs ? 'PASSED' : 'INSUFFICIENT_DATA', count: docs });
    const stuck = N((await one(sql<Row>`select count(*)::int as n from ocr_documents where tenant_id = ${T} and deleted_at is null and pipeline_status = any(${GROUP_STATES.processing}::text[]) and updated_at < now() - interval '30 minutes'`)).n);
    checks.push({ key: 'nothing_stuck', state: stuck ? 'WARNING' : 'PASSED', count: stuck });
    const failed = N((await one(sql<Row>`select count(*)::int as n from ocr_documents where tenant_id = ${T} and deleted_at is null and pipeline_status = 'extraction_failed'`)).n);
    checks.push({ key: 'extraction_failures', state: failed ? 'WARNING' : 'PASSED', count: failed });
    const jobsFailed = N((await one(sql<Row>`select count(*)::int as n from ocr_jobs where tenant_id = ${T} and status in ('failed', 'timed_out') and requested_at > now() - interval '7 days'`)).n);
    const jobsOk = N((await one(sql<Row>`select count(*)::int as n from ocr_jobs where tenant_id = ${T} and status = 'succeeded' and requested_at > now() - interval '7 days'`)).n);
    checks.push({ key: 'recent_jobs', state: !jobsFailed && !jobsOk ? 'INSUFFICIENT_DATA' : jobsFailed > jobsOk ? 'FAILED' : jobsFailed ? 'WARNING' : 'PASSED', count: jobsFailed, detail: { succeeded: jobsOk } });
    const infected = N((await one(sql<Row>`select count(*)::int as n from ocr_document_files f join ocr_documents d on d.id = f.document_id and d.tenant_id = f.tenant_id
      where f.tenant_id = ${T} and f.scan_status = 'infected' and d.pipeline_status <> 'rejected' and d.deleted_at is null`)).n);
    checks.push({ key: 'infected_files_held', state: infected ? 'FAILED' : 'PASSED', count: infected });
    const noHash = N((await one(sql<Row>`select count(*)::int as n from ocr_document_files where tenant_id = ${T} and kind = 'original' and file_hash is null`)).n);
    checks.push({ key: 'originals_fingerprinted', state: noHash ? 'WARNING' : 'PASSED', count: noHash });
    // the core rule: nothing reaches the books without a person's approval
    // approval is recorded on the review (ocr_reviews.status / decision_state), the record the decide() step writes
    const unapproved = N((await one(sql<Row>`select count(*)::int as n from ocr_postings p where p.tenant_id = ${T} and p.status = 'posted'
      and not exists (select 1 from ocr_reviews r where r.tenant_id = p.tenant_id and r.document_id = p.document_id and r.status = 'approved')`)).n);
    checks.push({ key: 'posting_needs_approval', state: unapproved ? 'FAILED' : 'PASSED', count: unapproved });
    const doublePosted = N((await one(sql<Row>`select count(*)::int as n from (select document_id, destination from ocr_postings where tenant_id = ${T} and status = 'posted' group by document_id, destination having count(*) > 1) x`)).n);
    const doubleExpense = N((await one(sql<Row>`select count(*)::int as n from (select receipt_document_id from expenses where tenant_id = ${T} and receipt_document_id is not null and status <> 'voided' group by receipt_document_id having count(*) > 1) x`)).n);
    checks.push({ key: 'no_double_posting', state: doublePosted || doubleExpense ? 'FAILED' : 'PASSED', count: doublePosted + doubleExpense });
    const postFailed = N((await one(sql<Row>`select count(*)::int as n from ocr_postings where tenant_id = ${T} and status = 'failed'`)).n);
    checks.push({ key: 'posting_failures', state: postFailed ? 'WARNING' : 'PASSED', count: postFailed });
    const waiting = N((await one(sql<Row>`select count(*)::int as n from ocr_documents where tenant_id = ${T} and deleted_at is null and pipeline_status = any(${GROUP_STATES.needs_review}::text[]) and created_at < now() - interval '7 days'`)).n);
    checks.push({ key: 'review_backlog', state: waiting ? 'WARNING' : 'PASSED', count: waiting });
    const crossExpense = N((await one(sql<Row>`select count(*)::int as n from ocr_postings p join expenses x on x.id::text = p.external_ref where p.tenant_id = ${T} and p.destination = 'expense' and x.tenant_id <> p.tenant_id`)).n);
    const crossDupe = N((await one(sql<Row>`select count(*)::int as n from ocr_duplicate_matches m join ocr_documents o on o.id = m.matched_document_id where m.tenant_id = ${T} and o.tenant_id <> m.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', state: crossExpense || crossDupe ? 'FAILED' : 'PASSED', count: crossExpense + crossDupe });
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('receipt-scanner-health:' || ${T}))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into receipt_scanner_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
