// settlements-screen.repository.ts — Deposits & Settlements mandate (Oct 29 2026): the server side of POS Payments &
// Money → Deposits & Settlements (/tenant/payments/settlements). Raw, parameterised SQL; the tenant is the session's and is
// written in every statement. READ-ONLY except the export audit: nothing here refunds, captures, transfers or records a
// deposit (spec §17 "Do not change money during browsing").
//
// FINANCIAL DEFINITIONS (spec §06–§07; FINANCE_DEFINITIONS in the handoff):
//   Settlement            one payment_settlements row = one processor batch. The webhook ingests it idempotently
//                         (uq_payment_settlements_settlement on tenant + provider settlement id), so a replayed provider
//                         event is one batch, counted once.
//   Gross Settled         Σ gross_cents as the PROCESSOR reported it for the batch — not POS sales.
//   Processor Fees        Σ fee_cents = fees the processor deducted in the batch. Separately billed (monthly) fees are not
//                         in any feed this system receives → reported "Not supplied by processor", never estimated.
//   Net Processor Payout  Σ expected payout = coalesce(expected_net_cents, net_cents) — what the processor says it will
//                         transfer. It is NOT called "deposited": only a bank-confirmed allocation is.
//   Bank Confirmed        Σ active reconciliation_allocations for those batches (a real or clearly-sourced manual bank
//                         deposit, matched by a person) — "Not bank verified" when the salon has no bank account / deposit.
//   Refunds               refund requests in the period by REFUND date, except 'cancelled' (withdrawn before it reached the
//                         processor). Refunds Total = Σ amount of COMPLETED ('refunded') refunds only; requested /
//                         processing / failed / voided are counted by status, never added to the money.
//   Reconciliation strip  gross − fees deducted = provider net when the provider netted nothing else. Refunds / chargebacks
//                         / adjustments the provider reported INSIDE the batch are shown as components of its net — they
//                         are NOT subtracted again (spec §09 double-count rule). Any remainder between the components and
//                         the provider's own net is shown as "provider-defined difference", not silently absorbed.
// Ordering: newest created first (created_at DESC, id DESC) unless the person picks another sort; a search ranks exact
// identifiers first, then exact amounts / linked payment ids, then prefixes, then partial and linked-customer matches.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { logException } from '@aipowersalon/observability';
import {
  FinanceError, isUuid, N, iso, ymd, clampPage, pageReq, resolvePeriod, salonTimeZone, tsInPeriod, dateInPeriod, searchText, digitsOf, likeOf, prefixOf,
  moneyToCents, oneOf, csvDocument, usd, audit, type AuditRecorder, type FinanceCtx, type Period, type Paged,
} from './finance-scope';

export const SETTLEMENT_DATE_BASES = ['settlement_date', 'expected_payout', 'created'] as const;
export type SettlementDateBasis = (typeof SETTLEMENT_DATE_BASES)[number];
export const SETTLEMENT_STATUSES = ['pending', 'settled', 'posted', 'needs_review', 'failed', 'returned'] as const;
export const BANK_STATES = ['unverified', 'partial', 'matched'] as const;
export type BankState = (typeof BANK_STATES)[number];
export const SETTLEMENT_SORTS = ['created_desc', 'created_asc', 'settled_desc', 'settled_asc', 'gross_desc', 'gross_asc', 'net_desc', 'net_asc'] as const;
export const REFUND_STATUSES = ['requested', 'processing', 'completed', 'failed', 'reversed'] as const;
export type RefundStatusGroup = (typeof REFUND_STATUSES)[number];
export const REFUND_SORTS = ['created_desc', 'created_asc', 'amount_desc', 'amount_asc'] as const;
const REFUND_GROUP: Record<RefundStatusGroup, string[]> = { requested: ['reserved', 'pending'], processing: ['processing'], completed: ['refunded'], failed: ['failed'], reversed: ['cancelled', 'voided'] };
export const refundGroupOf = (s: string): RefundStatusGroup => (Object.entries(REFUND_GROUP).find(([, v]) => v.includes(s))?.[0] as RefundStatusGroup) ?? 'requested';

export interface SettlementFilters {
  period: Period; basis: SettlementDateBasis; q: string; processor?: string; status?: string; bank?: BankState; sort: (typeof SETTLEMENT_SORTS)[number];
}
export interface RefundFilters { period: Period; q: string; processor?: string; status?: RefundStatusGroup; sort: (typeof REFUND_SORTS)[number] }

const maskLast4 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 4 ? `••••${d.slice(-4)}` : null; };
const phoneLast4 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 4 ? `•••-${d.slice(-4)}` : null; };
const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export class SettlementsScreenRepository {
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'month' });
  }

  settlementFilters(period: Period, q: Record<string, unknown>): SettlementFilters {
    return {
      period, basis: oneOf(q.dateField, SETTLEMENT_DATE_BASES, 'dateField') ?? 'settlement_date', q: searchText(q.search),
      processor: typeof q.processor === 'string' && q.processor && q.processor !== 'all' ? q.processor.slice(0, 40) : undefined,
      status: oneOf(q.status, SETTLEMENT_STATUSES, 'status'), bank: oneOf(q.bank, BANK_STATES, 'bank'),
      sort: oneOf(q.sort, SETTLEMENT_SORTS, 'sort') ?? 'created_desc',
    };
  }
  refundFilters(period: Period, q: Record<string, unknown>): RefundFilters {
    return {
      period, q: searchText(q.search), processor: typeof q.processor === 'string' && q.processor && q.processor !== 'all' ? q.processor.slice(0, 40) : undefined,
      status: oneOf(q.status, REFUND_STATUSES, 'status'), sort: oneOf(q.sort, REFUND_SORTS, 'sort') ?? 'created_desc',
    };
  }

  // ── settlements ────────────────────────────────────────────────────────────────────────────────────────────────
  /** Every settlement of the tenant with its expected payout, bank-confirmed (allocated) amount and linked deposit count. */
  private base(ctx: FinanceCtx) {
    const T = ctx.tenantId;
    return sql`with al as (
        select a.settlement_id, coalesce(sum(a.amount_cents), 0)::bigint as allocated, count(distinct a.deposit_id)::int as deposits
        from reconciliation_allocations a where a.tenant_id = ${T} and a.unmatched_at is null group by a.settlement_id),
      sb as (
        select s.id, s.tenant_id, s.branch_id, s.processor_type, s.settlement_id as ref, s.gross_cents, s.fee_cents, s.net_cents,
               coalesce(s.expected_net_cents, s.net_cents)::bigint as expected_cents, s.refunds_cents, s.chargebacks_cents, s.adjustments_cents,
               s.transaction_count, s.currency, s.status, s.settled_at, s.created_at, s.expected_deposit_date, to_char(s.expected_deposit_date, 'YYYY-MM-DD') as expected_ymd, s.funding_account_last4,
               s.merchant_account_id, s.event_id,
               coalesce(al.allocated, 0)::bigint as allocated_cents, coalesce(al.deposits, 0)::int as deposit_count,
               (select count(*)::int from payments p where p.tenant_id = ${T} and p.settlement_batch_id = s.id) as linked_payments
        from payment_settlements s left join al on al.settlement_id = s.id
        where s.tenant_id = ${T})`;
  }
  private bankStateSql(): RawBuilder<string> {
    return sql<string>`case when sb.allocated_cents <= 0 then 'unverified' when sb.allocated_cents < sb.expected_cents then 'partial' else 'matched' end`;
  }
  /** The search: which record matched and how well (0 = exact identifier … 4 = linked customer). NULL = no match. */
  private settlementSearch(ctx: FinanceCtx, raw: string): { where: RawBuilder<boolean>; rank: RawBuilder<number>; by: RawBuilder<string> } {
    if (!raw) return { where: sql<boolean>`true`, rank: sql<number>`0`, by: sql<string>`null` };
    const T = ctx.tenantId;
    const lower = raw.toLowerCase(), digits = digitsOf(raw), cents = moneyToCents(raw), ref = normRef(raw);
    const hasLetters = /[a-z]/i.test(raw);
    const idExact = isUuid(raw) ? sql<boolean>`sb.id = ${raw}::uuid` : sql<boolean>`false`;
    const refExact = sql<boolean>`lower(coalesce(sb.ref, '')) = ${lower}`;
    const refPrefix = sql<boolean>`lower(coalesce(sb.ref, '')) like ${prefixOf(lower)}`;
    const refLike = raw.length >= 3 ? sql<boolean>`lower(coalesce(sb.ref, '')) like ${likeOf(lower)}` : sql<boolean>`false`;
    const amount = cents != null ? sql<boolean>`(sb.gross_cents = ${cents} or sb.net_cents = ${cents} or sb.expected_cents = ${cents} or sb.fee_cents = ${cents})` : sql<boolean>`false`;
    const proc = hasLetters && raw.length >= 3 ? sql<boolean>`lower(coalesce(sb.processor_type, '')) like ${likeOf(lower)}` : sql<boolean>`false`;
    const last4 = /^\d{4}$/.test(raw) ? sql<boolean>`sb.funding_account_last4 = ${raw}` : sql<boolean>`false`;
    // a payment in the batch: its id / processor transaction / reference (exact), or its POS ticket number
    const payment = sql<boolean>`exists (select 1 from payments p where p.tenant_id = ${T} and p.settlement_batch_id = sb.id and (
        ${isUuid(raw) ? sql`p.id = ${raw}::uuid or` : sql``} lower(coalesce(p.processor_transaction_id, '')) = ${lower} or lower(coalesce(p.processor_reference_id, '')) = ${lower}
        or exists (select 1 from tickets t where t.tenant_id = ${T} and t.id = p.ticket_id and lower(coalesce(t.ticket_number::text, '')) = ${lower})))`;
    // a bank deposit matched to the batch (only through an allocation — never by look-alike amounts)
    const deposit = ref.length >= 3 ? sql<boolean>`exists (select 1 from reconciliation_allocations a join bank_deposits d on d.id = a.deposit_id and d.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and a.settlement_id = sb.id and a.unmatched_at is null and (d.reference_normalized = ${ref} or d.reference_normalized like ${likeOf(ref)}))` : sql<boolean>`false`;
    // a customer — ONLY through a payment of this salon that is in the batch (payment → ticket → customer)
    const custConds: RawBuilder<boolean>[] = [];
    if (hasLetters && raw.length >= 2 && !raw.includes('@')) custConds.push(sql<boolean>`c.full_name ilike ${likeOf(raw)}`);
    if (raw.includes('@')) custConds.push(sql<boolean>`lower(coalesce(c.email, '')) = ${lower}`);
    if (!hasLetters && digits.length >= 7) custConds.push(sql<boolean>`regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${likeOf(digits)}`);
    const customer = custConds.length ? sql<boolean>`exists (select 1 from payments p join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
        join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
        where p.tenant_id = ${T} and p.settlement_batch_id = sb.id and (${sql.join(custConds, sql` or `)}))` : sql<boolean>`false`;
    return {
      where: sql<boolean>`(${idExact} or ${refExact} or ${refPrefix} or ${refLike} or ${amount} or ${proc} or ${last4} or ${payment} or ${deposit} or ${customer})`,
      rank: sql<number>`case when ${idExact} or ${refExact} then 0 when ${payment} then 1 when ${amount} then 1 when ${refPrefix} then 2 when ${deposit} then 2 when ${refLike} or ${last4} or ${proc} then 3 else 4 end`,
      by: sql<string>`case when ${idExact} or ${refExact} or ${refPrefix} or ${refLike} then 'settlement' when ${payment} then 'payment' when ${amount} then 'amount'
        when ${deposit} then 'bank_deposit' when ${last4} then 'funding_account' when ${proc} then 'processor' else 'customer' end`,
    };
  }
  private settlementWhere(ctx: FinanceCtx, f: SettlementFilters): { where: RawBuilder<boolean>; rank: RawBuilder<number>; by: RawBuilder<string> } {
    const p = f.period;
    const date = f.basis === 'expected_payout' ? dateInPeriod(sql`sb.expected_deposit_date`, p)
      : f.basis === 'created' ? tsInPeriod(sql`sb.created_at`, p) : tsInPeriod(sql`coalesce(sb.settled_at, sb.created_at)`, p);
    const s = this.settlementSearch(ctx, f.q);
    const parts: RawBuilder<boolean>[] = [date, s.where];
    if (f.processor) parts.push(sql<boolean>`lower(coalesce(sb.processor_type, '')) = ${f.processor.toLowerCase()}`);
    if (f.status) parts.push(sql<boolean>`sb.status = ${f.status}`);
    if (f.bank) parts.push(sql<boolean>`${this.bankStateSql()} = ${f.bank}`);
    return { where: sql<boolean>`${sql.join(parts, sql` and `)}`, rank: s.rank, by: s.by };
  }
  private settlementOrder(f: SettlementFilters) {
    const o = {
      created_desc: sql`sb.created_at desc, sb.id desc`, created_asc: sql`sb.created_at asc, sb.id asc`,
      settled_desc: sql`coalesce(sb.settled_at, sb.created_at) desc, sb.id desc`, settled_asc: sql`coalesce(sb.settled_at, sb.created_at) asc, sb.id asc`,
      gross_desc: sql`sb.gross_cents desc, sb.id desc`, gross_asc: sql`sb.gross_cents asc, sb.id asc`,
      net_desc: sql`sb.expected_cents desc, sb.id desc`, net_asc: sql`sb.expected_cents asc, sb.id asc`,
    }[f.sort];
    return o;
  }
  private settlementRow(r: any) {
    const expected = N(r.expected_cents), allocated = N(r.allocated_cents);
    return {
      id: String(r.id), settlementRef: r.ref ?? null, processor: r.processor_type ?? null, merchantAccountId: r.merchant_account_id ?? null,
      fundingAccount: maskLast4(r.funding_account_last4), settledAt: iso(r.settled_at), createdAt: iso(r.created_at), expectedPayoutDate: ymd(r.expected_ymd),
      transactionCount: N(r.transaction_count), linkedPayments: N(r.linked_payments),
      grossCents: N(r.gross_cents), feeCents: N(r.fee_cents), netCents: N(r.net_cents), expectedPayoutCents: expected,
      refundsInBatchCents: N(r.refunds_cents), chargebacksInBatchCents: N(r.chargebacks_cents), adjustmentsCents: N(r.adjustments_cents), currency: String(r.currency || 'USD'),
      providerStatus: String(r.status || 'settled'),
      bankState: (allocated <= 0 ? 'unverified' : allocated < expected ? 'partial' : 'matched') as BankState,
      bankConfirmedCents: allocated, linkedDeposits: N(r.deposit_count),
      matchedBy: r.matched_by ?? null,
    };
  }

  async listSettlements(ctx: FinanceCtx, f: SettlementFilters, pr: { page: number; pageSize: number }): Promise<Paged<ReturnType<SettlementsScreenRepository['settlementRow']>>> {
    const w = this.settlementWhere(ctx, f);
    const total = N((await sql<any>`${this.base(ctx)} select count(*)::int as n from sb where ${w.where}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const order = f.q ? sql`${w.rank} asc, ${this.settlementOrder(f)}` : this.settlementOrder(f);
    const rows = (await sql<any>`${this.base(ctx)} select sb.*, ${w.by} as matched_by from sb where ${w.where} order by ${order} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.settlementRow(r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  // ── refunds ────────────────────────────────────────────────────────────────────────────────────────────────────
  private refundBase(ctx: FinanceCtx) {
    const T = ctx.tenantId;
    return sql`with rb as (
        select r.id, r.payment_id, r.processor_type, r.amount_cents, r.reason, r.status, r.processor_refund_id, r.created_at, r.settled_at,
               p.processor_transaction_id, p.processor_reference_id, p.amount_cents as payment_amount_cents, p.method as payment_method, p.card_brand, p.card_last4,
               p.created_at as payment_created_at, p.settlement_batch_id,
               t.id as ticket_id, t.ticket_number, c.id as customer_id, c.full_name as customer_name, c.normalized_phone as customer_phone, c.email as customer_email,
               s.settlement_id as sale_settlement_ref,
               (select count(*)::int from payment_refunds r2 where r2.tenant_id = ${T} and r2.payment_id = r.payment_id) as refunds_on_payment
        from payment_refunds r
        left join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id
        left join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
        left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
        left join payment_settlements s on s.id = p.settlement_batch_id and s.tenant_id = p.tenant_id
        where r.tenant_id = ${T})`;
  }
  private refundSearch(raw: string): { where: RawBuilder<boolean>; rank: RawBuilder<number>; by: RawBuilder<string> } {
    if (!raw) return { where: sql<boolean>`true`, rank: sql<number>`0`, by: sql<string>`null` };
    const lower = raw.toLowerCase(), digits = digitsOf(raw), cents = moneyToCents(raw), hasLetters = /[a-z]/i.test(raw);
    const idExact = isUuid(raw) ? sql<boolean>`(rb.id = ${raw}::uuid or rb.payment_id = ${raw}::uuid)` : sql<boolean>`false`;
    const refExact = sql<boolean>`(lower(coalesce(rb.processor_refund_id, '')) = ${lower} or lower(coalesce(rb.processor_transaction_id, '')) = ${lower} or lower(coalesce(rb.processor_reference_id, '')) = ${lower} or lower(coalesce(rb.ticket_number::text, '')) = ${lower})`;
    const refLike = raw.length >= 3 ? sql<boolean>`(lower(coalesce(rb.processor_refund_id, '')) like ${likeOf(lower)} or lower(coalesce(rb.processor_transaction_id, '')) like ${likeOf(lower)})` : sql<boolean>`false`;
    const amount = cents != null ? sql<boolean>`rb.amount_cents = ${cents}` : sql<boolean>`false`;
    const cust: RawBuilder<boolean>[] = [];
    if (hasLetters && raw.length >= 2 && !raw.includes('@')) cust.push(sql<boolean>`coalesce(rb.customer_name, '') ilike ${likeOf(raw)}`);
    if (raw.includes('@')) cust.push(sql<boolean>`lower(coalesce(rb.customer_email, '')) = ${lower}`);
    if (!hasLetters && digits.length >= 7) cust.push(sql<boolean>`regexp_replace(coalesce(rb.customer_phone, ''), '\\D', '', 'g') like ${likeOf(digits)}`);
    const customer = cust.length ? sql<boolean>`(rb.customer_id is not null and (${sql.join(cust, sql` or `)}))` : sql<boolean>`false`;
    return {
      where: sql<boolean>`(${idExact} or ${refExact} or ${refLike} or ${amount} or ${customer})`,
      rank: sql<number>`case when ${idExact} or ${refExact} then 0 when ${amount} then 1 when ${refLike} then 3 else 4 end`,
      by: sql<string>`case when ${idExact} or ${refExact} or ${refLike} then 'refund' when ${amount} then 'amount' else 'customer' end`,
    };
  }
  private refundWhere(f: RefundFilters) {
    const s = this.refundSearch(f.q);
    const parts: RawBuilder<boolean>[] = [tsInPeriod(sql`rb.created_at`, f.period), s.where];
    if (f.processor) parts.push(sql<boolean>`lower(coalesce(rb.processor_type, '')) = ${f.processor.toLowerCase()}`);
    if (f.status) parts.push(sql<boolean>`rb.status = any(${REFUND_GROUP[f.status]}::text[])`);
    return { where: sql<boolean>`${sql.join(parts, sql` and `)}`, rank: s.rank, by: s.by };
  }
  private refundRow(r: any) {
    return {
      id: String(r.id), refundRef: r.processor_refund_id ?? null, processor: r.processor_type ?? null, amountCents: N(r.amount_cents), reason: r.reason ?? null,
      status: refundGroupOf(String(r.status)), rawStatus: String(r.status), createdAt: iso(r.created_at), completedAt: iso(r.settled_at),
      payment: r.payment_id ? { id: String(r.payment_id), processorTransactionId: r.processor_transaction_id ?? null, amountCents: N(r.payment_amount_cents), method: r.payment_method ?? null,
        card: r.card_last4 ? `${r.card_brand ?? 'Card'} ••${String(r.card_last4).slice(-4)}` : null, createdAt: iso(r.payment_created_at), refundsOnPayment: N(r.refunds_on_payment) } : null,
      ticket: r.ticket_id ? { id: String(r.ticket_id), number: r.ticket_number != null ? String(r.ticket_number) : null } : null,
      customer: r.customer_id ? { id: String(r.customer_id), name: String(r.customer_name || ''), phone: phoneLast4(r.customer_phone) } : null,
      // the batch of the ORIGINAL sale. Which later payout netted the refund is not in any feed this system receives.
      saleSettlement: r.settlement_batch_id ? { id: String(r.settlement_batch_id), ref: r.sale_settlement_ref ?? null } : null,
      matchedBy: r.matched_by ?? null,
    };
  }
  async listRefunds(ctx: FinanceCtx, f: RefundFilters, pr: { page: number; pageSize: number }): Promise<Paged<ReturnType<SettlementsScreenRepository['refundRow']>>> {
    const w = this.refundWhere(f);
    const total = N((await sql<any>`${this.refundBase(ctx)} select count(*)::int as n from rb where ${w.where}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const ord = { created_desc: sql`rb.created_at desc, rb.id desc`, created_asc: sql`rb.created_at asc, rb.id asc`, amount_desc: sql`rb.amount_cents desc, rb.id desc`, amount_asc: sql`rb.amount_cents asc, rb.id asc` }[f.sort];
    const rows = (await sql<any>`${this.refundBase(ctx)} select rb.*, ${w.by} as matched_by from rb where ${w.where} order by ${f.q ? sql`${w.rank} asc, ${ord}` : ord} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.refundRow(r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  // ── summary: six KPIs + reconciliation strip + provenance ─────────────────────────────────────────────────────────
  async summary(ctx: FinanceCtx, sf: SettlementFilters, rf: RefundFilters) {
    const T = ctx.tenantId;
    const w = this.settlementWhere(ctx, sf);
    const s = (await sql<any>`${this.base(ctx)} select count(*)::int as n, count(distinct coalesce(sb.ref, sb.id::text))::int as batches,
        coalesce(sum(sb.gross_cents), 0)::bigint as gross, coalesce(sum(sb.fee_cents), 0)::bigint as fees, coalesce(sum(sb.net_cents), 0)::bigint as net,
        coalesce(sum(sb.expected_cents), 0)::bigint as expected, coalesce(sum(sb.refunds_cents), 0)::bigint as refunds_in, coalesce(sum(sb.chargebacks_cents), 0)::bigint as chargebacks_in,
        coalesce(sum(sb.adjustments_cents), 0)::bigint as adjustments, coalesce(sum(least(sb.allocated_cents, sb.expected_cents)), 0)::bigint as confirmed,
        coalesce(sum(sb.expected_cents) filter (where sb.allocated_cents > 0), 0)::bigint as expected_matched_set,
        count(*) filter (where sb.allocated_cents <= 0)::int as unverified_n, count(*) filter (where sb.allocated_cents > 0 and sb.allocated_cents < sb.expected_cents)::int as partial_n,
        count(*) filter (where sb.allocated_cents > 0 and sb.allocated_cents >= sb.expected_cents)::int as matched_n,
        count(distinct sb.currency)::int as currencies, min(sb.currency) as currency
      from sb where ${w.where}`.execute(this.db)).rows[0] || {};
    const rw = this.refundWhere(rf);
    const r = (await sql<any>`${this.refundBase(ctx)} select count(*) filter (where rb.status <> 'cancelled')::int as n,
        count(*) filter (where rb.status = 'refunded')::int as completed, count(*) filter (where rb.status in ('reserved', 'pending', 'processing'))::int as open_n,
        count(*) filter (where rb.status = 'failed')::int as failed, count(*) filter (where rb.status in ('voided', 'cancelled'))::int as reversed,
        coalesce(sum(rb.amount_cents) filter (where rb.status = 'refunded'), 0)::bigint as completed_cents,
        coalesce(sum(rb.amount_cents) filter (where rb.status in ('reserved', 'pending', 'processing')), 0)::bigint as open_cents
      from rb where ${rw.where}`.execute(this.db)).rows[0] || {};
    const banks = (await sql<any>`select count(*) filter (where status = 'active')::int as active,
        (select count(*)::int from bank_deposits d where d.tenant_id = ${T}) as deposits,
        (select count(*)::int from bank_webhook_endpoints e where e.tenant_id = ${T}) as feeds
      from bank_accounts where tenant_id = ${T}`.execute(this.db)).rows[0] || {};
    const source = await this.sourceStatus(ctx);
    // the newest record of each dataset and whether the current filters include it (spec §12: a new record appears first on
    // Page 1 when it qualifies; when the filters exclude it the page offers View Record / Clear Filters instead)
    const ns = (await sql<any>`${this.base(ctx)} select sb.id, sb.created_at, (${w.where}) as in_scope from sb order by sb.created_at desc, sb.id desc limit 1`.execute(this.db)).rows[0];
    const nr = (await sql<any>`${this.refundBase(ctx)} select rb.id, rb.created_at, (${rw.where}) as in_scope from rb order by rb.created_at desc, rb.id desc limit 1`.execute(this.db)).rows[0];
    const gross = N(s.gross), fees = N(s.fees), net = N(s.net), expected = N(s.expected), confirmed = N(s.confirmed);
    const refundsIn = N(s.refunds_in), cbIn = N(s.chargebacks_in), adj = N(s.adjustments);
    const bankConfigured = N(banks.active) > 0 || N(banks.deposits) > 0;
    return {
      period: sf.period, dateBasis: sf.basis, refundDateBasis: 'refund_date' as const, dataAsOf: new Date().toISOString(), sourceStatus: source,
      newest: {
        settlement: ns ? { id: String(ns.id), createdAt: iso(ns.created_at), inScope: ns.in_scope === true } : null,
        refund: nr ? { id: String(nr.id), createdAt: iso(nr.created_at), inScope: nr.in_scope === true } : null,
      },
      currency: String(s.currency || 'USD'), multiCurrency: N(s.currencies) > 1,
      kpis: {
        settlements: N(s.n), uniqueBatches: N(s.batches), grossSettledCents: gross, processorFeesCents: fees,
        separatelyBilledFees: 'not_supplied' as const, netProcessorPayoutCents: expected,
        refunds: N(r.n), refundsCompleted: N(r.completed), refundsOpen: N(r.open_n), refundsFailed: N(r.failed), refundsReversed: N(r.reversed),
        refundsTotalCents: N(r.completed_cents), refundsOpenCents: N(r.open_cents),
      },
      reconciliation: {
        grossCents: gross, feesDeductedCents: fees, refundsInBatchCents: refundsIn, chargebacksInBatchCents: cbIn, adjustmentsCents: adj,
        providerNetCents: net, expectedPayoutCents: expected,
        // what the provider's own net leaves unexplained by the components it reported (shown, never absorbed)
        providerDefinedDifferenceCents: net - (gross - fees - refundsIn - cbIn + adj),
        bankVerified: bankConfigured, bankConfirmedCents: bankConfigured ? confirmed : null,
        expectedForConfirmedSetCents: N(s.expected_matched_set),
        // the same allocation set: bank-confirmed vs the expected payouts of the batches that HAVE a bank match (an unmatched
        // batch is "not verified", counted in `unverified`, never a negative difference)
        differenceCents: bankConfigured ? confirmed - N(s.expected_matched_set) : null,
        unverified: N(s.unverified_n), partial: N(s.partial_n), matched: N(s.matched_n),
        bankFeedConnected: N(banks.feeds) > 0, bankAccounts: N(banks.active), bankDeposits: N(banks.deposits),
      },
    };
  }

  /** Where the data comes from and how fresh it is (spec §14): the processor configuration and the last batch received. */
  async sourceStatus(ctx: FinanceCtx) {
    const T = ctx.tenantId;
    const cfg = (await sql<any>`select processor, status, configured_at from tenant_payment_config where tenant_id = ${T} limit 1`.execute(this.db)).rows[0];
    const last = (await sql<any>`select max(created_at) as last_at, count(*)::int as n from payment_settlements where tenant_id = ${T}`.execute(this.db)).rows[0] || {};
    const lastEvent = (await sql<any>`select max(created_at) as at from payment_gateway_events where tenant_id = ${T}`.execute(this.db)).rows[0] || {};
    const state = !cfg ? 'not_configured' : String(cfg.status) !== 'active' ? 'inactive' : N(last.n) === 0 ? 'awaiting_first_settlement' : 'connected';
    return {
      state: state as 'not_configured' | 'inactive' | 'awaiting_first_settlement' | 'connected', processor: cfg?.processor ?? null,
      lastSettlementReceivedAt: iso(last.last_at), lastProviderEventAt: iso(lastEvent.at), ingestion: 'processor_webhook' as const,
      // what the processor feed does NOT carry today (spec §14 boundary — listed, never invented)
      notSupplied: ['fee_components', 'separately_billed_fees', 'expected_payout_date', 'refund_netting_batch', 'reserves'],
    };
  }

  /** Filter options from the tenant's own data (spec §13: only source-confirmed processors). */
  async options(ctx: FinanceCtx) {
    const T = ctx.tenantId;
    const rows = (await sql<any>`select distinct lower(processor_type) as p from payment_settlements where tenant_id = ${T} and processor_type is not null
      union select distinct lower(processor_type) from payment_refunds where tenant_id = ${T} and processor_type is not null
      union select lower(processor) from tenant_payment_config where tenant_id = ${T} and processor is not null order by 1`.execute(this.db)).rows;
    return { processors: rows.map((x: any) => String(x.p)).filter(Boolean) };
  }

  // ── detail ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async detail(ctx: FinanceCtx, id: string) {
    if (!isUuid(id)) return null;
    const T = ctx.tenantId;
    const row = (await sql<any>`${this.base(ctx)} select sb.* from sb where sb.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!row) return null;
    const allocations = (await sql<any>`select a.id, a.amount_cents, a.source, a.evidence_json, a.note, a.created_at, a.created_by_user_id, a.unmatched_at, a.unmatch_reason,
        d.id as deposit_id, d.reference, to_char(d.deposit_date, 'YYYY-MM-DD') as deposit_date, d.amount_cents as deposit_amount_cents, d.source as deposit_source, b.nickname, b.bank_name, b.account_last4,
        coalesce(u.full_name, u.email) as created_by
      from reconciliation_allocations a join bank_deposits d on d.id = a.deposit_id and d.tenant_id = a.tenant_id
      left join bank_accounts b on b.id = d.bank_account_id and b.tenant_id = d.tenant_id
      left join users u on u.id = a.created_by_user_id and u.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.settlement_id = ${id}::uuid order by a.created_at desc, a.id desc`.execute(this.db)).rows;
    const notes = (await sql<any>`select n.id, n.body, n.created_at, n.author_role, coalesce(u.full_name, u.email) as author from reconciliation_notes n left join users u on u.id = n.author_user_id and u.tenant_id = n.tenant_id
      where n.tenant_id = ${T} and n.target_type = 'settlement' and n.target_id = ${id}::uuid order by n.created_at desc limit 20`.execute(this.db)).rows;
    return {
      settlement: this.settlementRow(row),
      provenance: { source: 'processor_webhook', providerEventId: row.event_id ?? null, retrievedAt: iso(row.created_at), settledAt: iso(row.settled_at), currency: String(row.currency || 'USD') },
      allocations: allocations.map((a: any) => ({
        id: String(a.id), amountCents: N(a.amount_cents), source: String(a.source), evidence: a.evidence_json ?? {}, note: a.note ?? null, createdAt: iso(a.created_at), createdBy: a.created_by ?? null,
        active: a.unmatched_at == null, unmatchedAt: iso(a.unmatched_at), unmatchReason: a.unmatch_reason ?? null,
        deposit: { id: String(a.deposit_id), reference: a.reference ?? null, depositDate: ymd(a.deposit_date), amountCents: N(a.deposit_amount_cents), source: String(a.deposit_source || 'manual'),
          account: a.nickname ? `${a.nickname}${a.account_last4 ? ` ••••${a.account_last4}` : ''}` : null, bankName: a.bank_name ?? null },
      })),
      notes: notes.map((n: any) => ({ id: String(n.id), body: String(n.body), createdAt: iso(n.created_at), author: n.author ?? null, authorRole: n.author_role ?? null })),
    };
  }

  /** The batch's payments — searchable and paged; a customer is shown only through the payment's own ticket. */
  async transactions(ctx: FinanceCtx, id: string, q: Record<string, unknown>) {
    if (!isUuid(id)) return null;
    const T = ctx.tenantId;
    const exists = (await sql<any>`select 1 from payment_settlements where tenant_id = ${T} and id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!exists) return null;
    const raw = searchText(q.search), lower = raw.toLowerCase(), digits = digitsOf(raw), cents = moneyToCents(raw);
    const conds: RawBuilder<boolean>[] = [];
    if (raw) {
      conds.push(sql<boolean>`lower(coalesce(p.processor_transaction_id, '')) like ${likeOf(lower)}`, sql<boolean>`lower(coalesce(t.ticket_number::text, '')) = ${lower}`);
      if (isUuid(raw)) conds.push(sql<boolean>`p.id = ${raw}::uuid`);
      if (cents != null) conds.push(sql<boolean>`p.amount_cents = ${cents}`);
      if (/[a-z]/i.test(raw)) conds.push(sql<boolean>`coalesce(c.full_name, '') ilike ${likeOf(raw)}`);
      if (digits.length >= 7) conds.push(sql<boolean>`regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${likeOf(digits)}`);
    }
    const where = raw ? sql<boolean>`(${sql.join(conds, sql` or `)})` : sql<boolean>`true`;
    const from = sql`from payments p left join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
      where p.tenant_id = ${T} and p.settlement_batch_id = ${id}::uuid and ${where}`;
    const total = N((await sql<any>`select count(*)::int as n ${from}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pageReq(q), total);
    const rows = (await sql<any>`select p.id, p.processor_transaction_id, p.method, p.card_brand, p.card_last4, p.amount_cents, p.tip_cents, p.status, p.created_at,
        t.id as ticket_id, t.ticket_number, c.id as customer_id, c.full_name, c.normalized_phone ${from} order by p.created_at desc, p.id desc limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => ({ id: String(r.id), processorTransactionId: r.processor_transaction_id ?? null, method: r.method ?? null, card: r.card_last4 ? `${r.card_brand ?? 'Card'} ••${String(r.card_last4).slice(-4)}` : null,
        amountCents: N(r.amount_cents), tipCents: N(r.tip_cents), status: String(r.status), createdAt: iso(r.created_at),
        ticket: r.ticket_id ? { id: String(r.ticket_id), number: r.ticket_number != null ? String(r.ticket_number) : null } : null,
        customer: r.customer_id ? { id: String(r.customer_id), name: String(r.full_name || ''), phone: phoneLast4(r.normalized_phone) } : null })),
      total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount,
    };
  }

  async auditExport(ctx: FinanceCtx, action: string, resourceId: string | null, metadata: Record<string, unknown>) {
    await audit(this.auditor, ctx, 'payments', action, 'settlement', resourceId, metadata, (e) => logException(e, { where: 'settlements-screen.audit', tenantId: ctx.tenantId }));
  }

  // ── export (authorized, audited; totals over every filtered record) ───────────────────────────────────────────────
  async exportCsv(ctx: FinanceCtx, tab: 'settlements' | 'refunds', sf: SettlementFilters, rf: RefundFilters): Promise<string> {
    const LIMIT = 20_000;
    const p = sf.period;
    const scope: Array<[string, string]> = [['Generated', new Date().toISOString()], ['Period', p.from && p.to ? `${p.from} to ${p.to} (${p.tz})` : 'All time'], ['Currency', 'USD (amounts in dollars)']];
    let doc: string; let count = 0;
    if (tab === 'refunds') {
      const w = this.refundWhere(rf);
      const rows = (await sql<any>`${this.refundBase(ctx)} select rb.* from rb where ${w.where} order by rb.created_at desc, rb.id desc limit ${LIMIT}`.execute(this.db)).rows.map((r: any) => this.refundRow(r));
      const sum = await this.summary(ctx, sf, rf); count = rows.length;
      doc = csvDocument('Refunds', [...scope, ['Date basis', 'Refund date'], ['Search', rf.q || '—'], ['Status', rf.status ?? 'All'], ['Processor', rf.processor ?? 'All'],
        ['Definition', 'Refunds Total counts completed refunds only; requested / processing / failed / reversed are listed by status.']],
        ['Refund reference', 'Refund ID', 'Date', 'Status', 'Amount', 'Original payment', 'Ticket', 'Customer', 'Original sale settlement', 'Processor'],
        rows.map((r) => [r.refundRef ?? '', r.id, r.createdAt ?? '', r.status, usd(r.amountCents), r.payment?.processorTransactionId ?? r.payment?.id ?? '', r.ticket?.number ?? '', r.customer?.name ?? '', r.saleSettlement?.ref ?? '', r.processor ?? '']),
        [['Refund events', String(sum.kpis.refunds)], ['Completed refunds total', usd(sum.kpis.refundsTotalCents)], ['Rows exported', String(rows.length)]]);
    } else {
      const w = this.settlementWhere(ctx, sf);
      const rows = (await sql<any>`${this.base(ctx)} select sb.* from sb where ${w.where} order by ${this.settlementOrder(sf)} limit ${LIMIT}`.execute(this.db)).rows.map((r: any) => this.settlementRow(r));
      const sum = await this.summary(ctx, sf, rf); count = rows.length;
      doc = csvDocument('Settlements', [...scope, ['Date basis', sf.basis.replace(/_/g, ' ')], ['Search', sf.q || '—'], ['Provider status', sf.status ?? 'All'], ['Bank state', sf.bank ?? 'All'], ['Processor', sf.processor ?? 'All'],
        ['Definition', 'Net processor payout is what the processor reports it will transfer; Bank confirmed is matched bank deposits only.']],
        ['Settlement ID', 'Processor', 'Settled at', 'Transactions', 'Gross', 'Fees', 'Net processor payout', 'Bank confirmed', 'Bank state', 'Provider status'],
        rows.map((r) => [r.settlementRef ?? r.id, r.processor ?? '', r.settledAt ?? '', r.transactionCount, usd(r.grossCents), usd(r.feeCents), usd(r.expectedPayoutCents), r.bankConfirmedCents > 0 ? usd(r.bankConfirmedCents) : 'Not verified', r.bankState, r.providerStatus]),
        [['Settlements', String(sum.kpis.settlements)], ['Gross settled', usd(sum.kpis.grossSettledCents)], ['Processor fees', usd(sum.kpis.processorFeesCents)], ['Net processor payout', usd(sum.kpis.netProcessorPayoutCents)],
         ['Bank confirmed', sum.reconciliation.bankConfirmedCents == null ? 'Not bank verified' : usd(sum.reconciliation.bankConfirmedCents)], ['Rows exported', String(rows.length)]]);
    }
    await audit(this.auditor, ctx, 'payments', 'settlements_exported', 'settlement_report', null, { tab, rows: count, from: p.from, to: p.to, search: (tab === 'refunds' ? rf.q : sf.q) ? 'yes' : 'no' },
      (e) => logException(e, { where: 'settlements-screen.audit', tenantId: ctx.tenantId }));
    return doc;
  }
}

/** One settlement's authorized detail as CSV (Settlements §08 "Export authorized detail"): its figures, its bank matches
 *  and every payment in the batch (customer name only where the payment's ticket links one; phone as last four). Audited. */
export async function settlementDetailCsv(repo: SettlementsScreenRepository, ctx: FinanceCtx, id: string): Promise<string | null> {
  const d = await repo.detail(ctx, id); if (!d) return null;
  const s = d.settlement;
  const all: Array<{ id: string; processorTransactionId: string | null; amountCents: number; status: string; createdAt: string | null; ticket: { number: string | null } | null; customer: { name: string; phone: string | null } | null }> = [];
  for (let page = 1; page <= 200; page++) {
    const t = await repo.transactions(ctx, id, { page, pageSize: 50 });
    if (!t) break; all.push(...t.items); if (page >= t.pageCount) break;
  }
  const doc = csvDocument(`Settlement ${s.settlementRef ?? s.id}`,
    [['Generated', new Date().toISOString()], ['Processor', s.processor ?? ''], ['Settled at', s.settledAt ?? ''], ['Provider status', s.providerStatus], ['Bank state', s.bankState],
     ['Gross', usd(s.grossCents)], ['Fees deducted', usd(s.feeCents)], ['Refunds in batch', usd(s.refundsInBatchCents)], ['Chargebacks in batch', usd(s.chargebacksInBatchCents)], ['Adjustments', usd(s.adjustmentsCents)],
     ['Net processor payout', usd(s.expectedPayoutCents)], ['Bank confirmed', s.bankConfirmedCents > 0 ? usd(s.bankConfirmedCents) : 'Not verified'], ['Currency', s.currency]],
    ['Payment ID', 'Processor transaction', 'Date', 'Status', 'Amount', 'Ticket', 'Customer', 'Phone'],
    all.map((p) => [p.id, p.processorTransactionId ?? '', p.createdAt ?? '', p.status, usd(p.amountCents), p.ticket?.number ?? '', p.customer?.name ?? '', p.customer?.phone ?? '']),
    [['Payments', String(all.length)], ['Payments total', usd(all.reduce((a, p) => a + p.amountCents, 0))]]);
  await repo.auditExport(ctx, 'settlement_detail_exported', id, { payments: all.length });
  return doc;
}

export function assertTab(v: unknown): 'settlements' | 'refunds' {
  if (v == null || v === '' || v === 'settlements') return 'settlements';
  if (v === 'refunds') return 'refunds';
  throw new FinanceError('Some fields are invalid.', 'VALIDATION_FAILED', 400, { field: 'tab' });
}
