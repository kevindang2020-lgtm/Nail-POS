// transactions-screen.repository.ts — Transactions mandate (Oct 29 2026): the read model behind POS Payments & Money →
// Transactions (/tenant/payments/transactions). Raw SQL, tenant + location scoped, ONE ROW PER TENDER (a payments row that is
// a real payment attempt — never a refund / void reversal row), read from the ledger Checkout writes, never a second one.
// Definitions (shown on the screen; the same filters drive the KPIs, the ledger and the export — never the visible page):
//   • TRANSACTIONS  — confirmed tenders (approved / partial / paid / captured …): a declined or pending attempt and a voided
//                     tender are listed with their status but never counted; one ticket paid by two tenders is two;
//   • GROSS         — Σ confirmed tender amounts. A tender's amount INCLUDES the tip collected on it (Checkout charges
//                     subtotal − discount + tax + surcharge + tip as one amount), so Gross is money taken, tips included;
//   • TIPS          — the ticket's one tip (tickets.tip_cents), counted ONCE per ticket that has a counted tender — never
//                     per tender or per technician (a split ticket repeated it before);
//   • NET           — Gross − completed refunds against those tenders (pending refunds reserve, but are not yet out).
//                     With no refunds Net equals Gross — that is correct, not a bug. Net is not the processor payout or
//                     the bank deposit (those are Settlements).
// The old /pos/reports/transactions rendered a UTC DATE as midnight UTC (Oct 22 5:17 AM showed as Oct 21 8:00 PM in New
// York), called every non-refund row "completed" and computed Net as Gross − discount on payment rows that always carry
// discount 0. Writes (refund, void, receipts) stay on the authorised Checkout routes; nothing here moves money.
import { Logger } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';
import {
  type FinanceCtx, type Period, type PageReq, type Paged, FinanceError, resolvePeriod, salonTimeZone, tsInPeriod, clampPage, isUuid, N, iso, likeOf, digitsOf,
  csvDocument, usd, audit, type AuditRecorder, oneOf, moneyToCents,
} from './finance-scope';
import { methodKey } from './split-payments-screen.repository';

export const TX_BASES = ['paid', 'created', 'refunded'] as const;
export const TX_STATUSES = ['completed', 'partially_refunded', 'refunded', 'voided', 'pending', 'failed'] as const;
export const TX_METHODS = ['card', 'cash', 'gift_card', 'other'] as const;
export const TX_KINDS = ['payments', 'refunds', 'voids', 'pending', 'failed'] as const;   // the Payments & Money Overview's six filters (+ All)
export const TX_SORTS = ['created_desc', 'paid_desc', 'created_asc', 'amount_desc', 'amount_asc'] as const;
export interface TxFilters {
  period: Period; basis: (typeof TX_BASES)[number]; q: string; status?: (typeof TX_STATUSES)[number]; method?: (typeof TX_METHODS)[number]; kind?: (typeof TX_KINDS)[number];
  technicianId?: string; minCents?: number; maxCents?: number; sort: (typeof TX_SORTS)[number];
}
const CONFIRMED = [...new Set([...REVENUE_BEARING_STATUSES, 'completed', 'succeeded', 'settled', 'partially_refunded'])];
const VOIDED = ['voided', 'void'];
const REVERSAL_ROWS = ['refunded', 'refund', 'reversed'];
const FAILED = ['declined', 'failed', 'error', 'timeout', 'canceled', 'cancelled', 'rejected', 'expired'];
const COUNTED = ['completed', 'partially_refunded', 'refunded'];
const maskPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : null; };
const showPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p ?? null); };
const METHOD_SQL: Record<string, RawBuilder<boolean>> = {
  cash: sql<boolean>`a.method = 'cash'`, card: sql<boolean>`a.method in ('card', 'credit_card', 'debit_card')`, gift_card: sql<boolean>`a.method in ('gift_card', 'gift')`,
  other: sql<boolean>`coalesce(a.method, '') not in ('cash', 'card', 'credit_card', 'debit_card', 'gift_card', 'gift')`,
};
export const TX_DEFINITIONS = {
  transactions: 'Confirmed payment tenders in the selected period. Declined, pending and voided attempts are listed but not counted; a ticket paid with two tenders counts twice.',
  gross: 'Sum of confirmed tender amounts. Tender amounts include the tip collected on them.',
  tips: 'The tip on each ticket with a counted tender, counted once per ticket (never once per tender or per technician).',
  net: 'Gross minus completed refunds against those tenders. Equal to Gross when nothing was refunded. Not the bank deposit.',
} as const;

export class TransactionsScreenRepository {
  private readonly log = new Logger('TransactionsScreen');
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'month', allowAll: true });
  }
  filters(period: Period, q: Record<string, unknown>): TxFilters {
    const cents = (v: unknown, field: string) => { if (v == null || v === '') return undefined; const n = typeof v === 'number' ? v : moneyToCents(String(v)); if (n == null || n < 0) throw new FinanceError('Enter a valid amount.', 'VALIDATION_FAILED', 400, { field }); return n; };
    const f: TxFilters = {
      period, basis: oneOf(q.dateField, TX_BASES, 'dateField') ?? 'paid', q: typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '',
      status: oneOf(q.status, TX_STATUSES, 'status'), method: oneOf(q.method, TX_METHODS, 'method'), kind: oneOf(q.kind, TX_KINDS, 'kind'),
      technicianId: typeof q.technician === 'string' && isUuid(q.technician) ? q.technician : undefined,
      minCents: cents(q.minAmount, 'minAmount'), maxCents: cents(q.maxAmount, 'maxAmount'), sort: oneOf(q.sort, TX_SORTS, 'sort') ?? 'created_desc',
    };
    if (f.minCents != null && f.maxCents != null && f.minCents > f.maxCents) throw new FinanceError('The minimum amount must not be above the maximum.', 'VALIDATION_FAILED', 400, { field: 'minAmount' });
    return f;
  }
  private scope(ctx: FinanceCtx): RawBuilder<boolean> { return ctx.branchId && isUuid(ctx.branchId) ? sql<boolean>`(a.branch_id = ${ctx.branchId}::uuid or a.branch_id is null)` : sql<boolean>`true`; }

  /** One row per tender, with its completed refunds, its ticket, customer and every technician on the ticket. */
  private base(ctx: FinanceCtx): RawBuilder<unknown> {
    const T = ctx.tenantId;
    return sql`select p.id, p.ticket_id, p.branch_id, p.method, p.amount_cents::bigint as amount_cents, coalesce(p.tip_cents, 0)::bigint as tender_tip_cents, coalesce(p.surcharge_cents, 0)::bigint as surcharge_cents,
        p.status as raw_status, p.created_at, (case when p.status in (${sql.join(CONFIRMED)}) or p.status in (${sql.join(VOIDED)}) then coalesce(p.approved_at, p.created_at) end) as paid_at,
        p.processor, p.processor_transaction_id, p.processor_reference_id, p.card_brand, p.card_last4, p.gift_card_last4, p.payment_surface, p.settlement_batch_id,
        coalesce(rf.refunded_cents, 0)::bigint as refunded_cents, coalesce(rf.pending_cents, 0)::bigint as refund_pending_cents, rf.last_refund_at, rf.refund_count,
        (case when p.status in (${sql.join(CONFIRMED)}) then (case when coalesce(rf.refunded_cents, 0) >= p.amount_cents and p.amount_cents > 0 then 'refunded' when coalesce(rf.refunded_cents, 0) > 0 then 'partially_refunded' else 'completed' end)
              when p.status in (${sql.join(VOIDED)}) then 'voided' when p.status in (${sql.join(FAILED)}) then 'failed' else 'pending' end) as state,
        t.ticket_number, t.customer_id, coalesce(t.tip_cents, 0)::bigint as ticket_tip_cents, cx.full_name as customer_name, cx.normalized_phone as customer_phone, cx.email as customer_email,
        tech.ids as technician_ids, tech.names as technician_names, b.name as branch_name
      from payments p
      left join lateral (select sum(r.amount_cents) filter (where r.status = 'refunded') as refunded_cents, sum(r.amount_cents) filter (where r.status in ('reserved', 'pending', 'processing')) as pending_cents,
                                max(coalesce(r.settled_at, r.created_at)) filter (where r.status = 'refunded') as last_refund_at, count(*)::int as refund_count
                           from payment_refunds r where r.tenant_id = p.tenant_id and r.payment_id = p.id) rf on true
      left join tickets t on t.id = p.ticket_id and t.tenant_id = ${T}
      left join customers cx on cx.id = t.customer_id and cx.tenant_id = ${T}
      left join lateral (select array_agg(x.id order by x.name) as ids, string_agg(x.name, ', ' order by x.name) as names from (
          select distinct tc.id, coalesce(nullif(tc.full_name, ''), trim(tc.first_name || ' ' || coalesce(tc.last_name, ''))) as name from technicians tc
           where tc.tenant_id = ${T} and (tc.id = t.primary_technician_id or tc.id in (select l.technician_id from ticket_service_lines l where l.tenant_id = ${T} and l.ticket_id = t.id and l.removed_at is null))) x) tech on true
      left join branches b on b.id = p.branch_id and b.tenant_id = ${T}
      where p.tenant_id = ${T} and not (p.status in (${sql.join(REVERSAL_ROWS)}) or (p.status in (${sql.join(VOIDED)}) and p.amount_cents = 0))`;
  }
  private basisCol(b: TxFilters['basis']): RawBuilder<unknown> { return { paid: sql`coalesce(a.paid_at, a.created_at)`, created: sql`a.created_at`, refunded: sql`a.last_refund_at` }[b]; }
  private where(ctx: FinanceCtx, f: TxFilters, opts: { status?: boolean } = {}): RawBuilder<boolean> {
    const parts: RawBuilder<boolean>[] = [this.scope(ctx), tsInPeriod(this.basisCol(f.basis), f.period)];
    if (f.basis === 'refunded') parts.push(sql<boolean>`a.last_refund_at is not null`);
    if (f.status && opts.status !== false) parts.push(sql<boolean>`a.state = ${f.status}`);
    if (f.kind && opts.status !== false) parts.push(({
      payments: sql<boolean>`a.state in (${sql.join(COUNTED)})`, refunds: sql<boolean>`(a.refunded_cents > 0 or a.refund_pending_cents > 0)`,
      voids: sql<boolean>`a.state = 'voided'`, pending: sql<boolean>`a.state = 'pending'`, failed: sql<boolean>`a.state = 'failed'`,
    } as Record<string, RawBuilder<boolean>>)[f.kind]);
    if (f.method) parts.push(METHOD_SQL[f.method]);
    if (f.technicianId) parts.push(sql<boolean>`${f.technicianId}::uuid = any(a.technician_ids)`);
    if (f.minCents != null) parts.push(sql<boolean>`a.amount_cents >= ${f.minCents}`);
    if (f.maxCents != null) parts.push(sql<boolean>`a.amount_cents <= ${f.maxCents}`);
    if (f.q) parts.push(this.search(ctx, f.q).where);
    return sql<boolean>`${sql.join(parts, sql` and `)}`;
  }
  /** customer name / phone (any format) / email · ticket # · payment / ticket / customer / refund id · processor reference ·
   *  technician · exact amount — exact references rank first, then phone / email, then names. */
  private search(ctx: FinanceCtx, q: string): { where: RawBuilder<boolean>; rank: RawBuilder<number> } {
    const T = ctx.tenantId; const lower = q.toLowerCase(), d = digitsOf(q).replace(/^1(?=\d{10}$)/, ''); const tn = q.replace(/^#/, '').trim();
    const ref: RawBuilder<boolean>[] = []; const contact: RawBuilder<boolean>[] = []; const part: RawBuilder<boolean>[] = [];
    if (isUuid(q)) ref.push(sql<boolean>`(a.id = ${q}::uuid or a.ticket_id = ${q}::uuid or a.customer_id = ${q}::uuid or a.settlement_batch_id = ${q}::uuid
      or exists (select 1 from payment_refunds r where r.tenant_id = ${T} and r.payment_id = a.id and r.id = ${q}::uuid))`);
    if (/^\d{1,8}$/.test(tn)) ref.push(sql<boolean>`a.ticket_number = ${tn}`);
    if (/^[A-Za-z0-9_-]{4,}$/.test(q)) ref.push(sql<boolean>`(a.processor_transaction_id = ${q} or a.processor_reference_id = ${q}
      or exists (select 1 from payment_refunds r where r.tenant_id = ${T} and r.payment_id = a.id and r.processor_refund_id = ${q}))`);
    const amt = /^\$?\d{1,6}(\.\d{1,2})?$/.test(q) && /[.$]/.test(q) ? moneyToCents(q) : null;
    if (amt != null && amt > 0) ref.push(sql<boolean>`a.amount_cents = ${amt}`);
    if (d.length >= 7) { const tail = d.slice(-10); contact.push(sql<boolean>`right(regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g'), ${tail.length}) = ${tail}`); }
    if (q.includes('@')) contact.push(sql<boolean>`lower(coalesce(a.customer_email, '')) = ${lower}`);
    if (q.length >= 2 && !/^[\d\s()+.-]+$/.test(q)) {
      part.push(sql<boolean>`lower(coalesce(a.customer_name, '')) like ${likeOf(lower)}`, sql<boolean>`lower(coalesce(a.technician_names, '')) like ${likeOf(lower)}`);
      if (q.length >= 4) part.push(sql<boolean>`lower(coalesce(a.customer_email, '')) like ${likeOf(lower)}`);
    }
    if (/^\d{2,8}$/.test(tn)) part.push(sql<boolean>`a.ticket_number like ${tn + '%'}`);
    const or = (xs: RawBuilder<boolean>[]) => (xs.length ? sql<boolean>`(${sql.join(xs, sql` or `)})` : sql<boolean>`false`);
    const R = or(ref), C = or(contact), P = or(part);
    return { where: sql<boolean>`(${R} or ${C} or ${P})`, rank: sql<number>`(case when ${R} then 3 when ${C} then 2 when ${P} then 1 else 0 end)` };
  }
  private static readonly ORDER = {
    created_desc: sql`a.created_at desc, a.id desc`, paid_desc: sql`coalesce(a.paid_at, a.created_at) desc, a.id desc`, created_asc: sql`a.created_at asc, a.id asc`,
    amount_desc: sql`a.amount_cents desc, a.created_at desc, a.id desc`, amount_asc: sql`a.amount_cents asc, a.created_at desc, a.id desc`,
  } as const;
  private row(ctx: FinanceCtx, r: any) {
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    const counted = COUNTED.includes(String(r.state));
    return {
      id: String(r.id), ticketId: r.ticket_id ? String(r.ticket_id) : null, ticketNumber: r.ticket_number ?? null, state: String(r.state), rawStatus: String(r.raw_status),
      createdAt: iso(r.created_at), paidAt: iso(r.paid_at), lastRefundAt: iso(r.last_refund_at),
      customer: r.customer_id ? { id: String(r.customer_id), name: r.customer_name ?? null, phone: canContact ? showPhone(r.customer_phone) : maskPhone(r.customer_phone) } : null,
      technicians: r.technician_names ? String(r.technician_names) : null,
      method: methodKey(r.method), rawMethod: String(r.method ?? ''), channel: r.payment_surface ?? null,
      card: r.card_brand || r.card_last4 ? `${r.card_brand ?? ''} ••${r.card_last4 ?? '••'}`.trim() : null, giftCardLast4: r.gift_card_last4 ?? null,
      grossCents: N(r.amount_cents), tipCents: N(r.tender_tip_cents), refundedCents: N(r.refunded_cents), refundPendingCents: N(r.refund_pending_cents),
      netCents: counted ? N(r.amount_cents) - N(r.refunded_cents) : 0, counted,
      processor: r.processor ?? null, processorRef: r.processor_transaction_id ?? r.processor_reference_id ?? null, settlementId: r.settlement_batch_id ? String(r.settlement_batch_id) : null,
      branch: r.branch_name ?? null, ...(r.rank ? { matchedBy: r.rank === 3 ? 'reference' : r.rank === 2 ? 'contact' : 'name' } : {}),
    };
  }

  async list(ctx: FinanceCtx, f: TxFilters, pg: PageReq): Promise<Paged<ReturnType<TransactionsScreenRepository['row']>>> {
    const w = this.where(ctx, f);
    const total = N((await sql<{ n: number }>`select count(*)::int as n from (${this.base(ctx)}) a where ${w}`.execute(this.db)).rows[0]?.n);
    const c = clampPage(pg, total);
    const rank = f.q ? this.search(ctx, f.q).rank : sql<number>`0`;
    // a search ranks exact references first; otherwise (and within a rank) the chosen sort — newest created by default
    const rows = (await sql<any>`select a.*, ${rank} as rank from (${this.base(ctx)}) a where ${w}
      order by ${f.q ? sql`${rank} desc, ` : sql``}${TransactionsScreenRepository.ORDER[f.sort]} limit ${c.pageSize} offset ${c.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.row(ctx, { ...r, rank: N(r.rank) })), total, page: c.page, pageSize: c.pageSize, pageCount: c.pageCount };
  }

  /** The four KPIs (and their context) over EVERY matching tender — the status filter narrows the list, not the money. */
  async summary(ctx: FinanceCtx, f: TxFilters) {
    const w = this.where(ctx, f, { status: false });
    const r = (await sql<any>`select count(*) filter (where a.state in (${sql.join(COUNTED)}))::int as transactions,
        coalesce(sum(a.amount_cents) filter (where a.state in (${sql.join(COUNTED)})), 0)::bigint as gross,
        coalesce(sum(a.refunded_cents) filter (where a.state in (${sql.join(COUNTED)})), 0)::bigint as refunded,
        coalesce(sum(a.refund_pending_cents) filter (where a.state in (${sql.join(COUNTED)})), 0)::bigint as refund_pending,
        count(distinct a.ticket_id) filter (where a.state in (${sql.join(COUNTED)}))::int as tickets,
        count(*) filter (where a.state = 'voided')::int as voided, count(*) filter (where a.state = 'pending')::int as pending, count(*) filter (where a.state = 'failed')::int as failed,
        coalesce(sum(a.amount_cents) filter (where a.state in (${sql.join(COUNTED)}) and a.method = 'cash'), 0)::bigint as cash,
        coalesce(sum(a.amount_cents) filter (where a.state in (${sql.join(COUNTED)}) and a.method in ('card', 'credit_card', 'debit_card')), 0)::bigint as card,
        coalesce(sum(a.amount_cents) filter (where a.state in (${sql.join(COUNTED)}) and a.method in ('gift_card', 'gift')), 0)::bigint as gift
      from (${this.base(ctx)}) a where ${w}`.execute(this.db)).rows[0] ?? {};
    // the tip once per ticket: the distinct tickets behind the counted tenders (a tender with no ticket carries its own)
    const tips = (await sql<{ tips: number }>`select coalesce(sum(x.tip), 0)::bigint as tips from (
        select coalesce(a.ticket_id::text, a.id::text) as k, max(case when a.ticket_id is null then a.tender_tip_cents else a.ticket_tip_cents end) as tip
          from (${this.base(ctx)}) a where ${w} and a.state in (${sql.join(COUNTED)}) group by 1) x`.execute(this.db)).rows[0];
    const gross = N(r.gross), refunded = N(r.refunded);
    return {
      kpis: { transactions: N(r.transactions), grossCents: gross, tipsCents: N(tips?.tips), netCents: gross - refunded },
      context: { tickets: N(r.tickets), refundedCents: refunded, refundPendingCents: N(r.refund_pending), voided: N(r.voided), pending: N(r.pending), failed: N(r.failed), cashCents: N(r.cash), cardCents: N(r.card), giftCardCents: N(r.gift) },
      definitions: TX_DEFINITIONS, period: f.period, dateBasis: f.basis,
      scope: ctx.branchId && isUuid(ctx.branchId) ? 'location' : 'salon',
    };
  }

  /** One tender: its own facts and refunds, its whole ticket (lines, every tender, tip allocations, money), the settlement
   *  only when the tender is actually linked to one. */
  async detail(ctx: FinanceCtx, paymentId: string) {
    if (!isUuid(paymentId)) throw new FinanceError('That payment could not be found.', 'PAYMENT_NOT_FOUND', 404);
    const r = (await sql<any>`select a.*, 0 as rank from (${this.base(ctx)}) a where a.id = ${paymentId}::uuid and ${this.scope(ctx)}`.execute(this.db)).rows[0];
    if (!r) throw new FinanceError('That payment could not be found.', 'PAYMENT_NOT_FOUND', 404);
    const tender = this.row(ctx, r);
    const ticket = r.ticket_id ? await this.ticket(ctx, String(r.ticket_id)) : null;
    const settlement = r.settlement_batch_id ? (await sql<any>`select s.id, s.settlement_id, s.processor_type, s.status, s.settled_at, s.gross_cents, s.net_cents, s.expected_deposit_date, s.actual_deposit_date, s.reconciliation_status
        from payment_settlements s where s.tenant_id = ${ctx.tenantId} and s.id = ${r.settlement_batch_id}::uuid`.execute(this.db)).rows[0] ?? null : null;
    const refunds = (await sql<any>`select r.id, r.amount_cents, r.reason, r.status, r.processor_refund_id, r.created_at, r.settled_at, coalesce(u.full_name, u.email) as actor
        from payment_refunds r left join users u on u.id = r.created_by_user_id where r.tenant_id = ${ctx.tenantId} and r.payment_id = ${paymentId}::uuid order by r.created_at desc, r.id desc`.execute(this.db)).rows;
    const can = (p: string) => hasPermission(ctx as Parameters<typeof hasPermission>[0], p);
    return {
      tender: { ...tender, surchargeCents: N(r.surcharge_cents), refundableCents: tender.counted ? Math.max(0, tender.grossCents - tender.refundedCents - tender.refundPendingCents) : 0 },
      refunds: refunds.map((x: any) => ({ id: String(x.id), amountCents: N(x.amount_cents), reason: x.reason ?? null, status: String(x.status), processorRefundId: x.processor_refund_id ?? null, at: iso(x.created_at), settledAt: iso(x.settled_at), actor: x.actor ?? null })),
      ticket,
      settlement: settlement ? { id: String(settlement.id), reference: settlement.settlement_id ?? null, processor: settlement.processor_type ?? null, status: settlement.status ?? null, settledAt: iso(settlement.settled_at),
        grossCents: N(settlement.gross_cents), netCents: N(settlement.net_cents), expectedDeposit: settlement.expected_deposit_date ? String(settlement.expected_deposit_date).slice(0, 10) : null,
        actualDeposit: settlement.actual_deposit_date ? String(settlement.actual_deposit_date).slice(0, 10) : null, reconciliation: settlement.reconciliation_status ?? null } : null,
      permissions: { refund: can('pos.checkout.refund') && tender.counted && tender.method !== 'gift_card', sendReceipt: can('pos.receipts.send'), customer: can('pos.customers.view') },
      definitions: TX_DEFINITIONS,
    };
  }

  /** The ticket behind a tender — any ticket, a single-tender one included: its lines (with technicians), every tender
   *  attempt (reversal rows excluded), the tip allocations and the money: subtotal · discount · tax · surcharge · tip ·
   *  paid (Σ confirmed tenders) · balance still due (0 once paid). */
  private async ticket(ctx: FinanceCtx, ticketId: string) {
    const T = ctx.tenantId;
    const t = (await sql<any>`select t.id, t.ticket_number, t.status, t.customer_id, t.paid_at, t.created_at, coalesce(t.subtotal_cents, 0)::bigint as subtotal_cents, coalesce(t.discount_cents, 0)::bigint as discount_cents,
        coalesce(t.tax_cents, 0)::bigint as tax_cents, coalesce(t.surcharge_cents, 0)::bigint as surcharge_cents, coalesce(t.tip_cents, 0)::bigint as tip_cents, coalesce(t.total_cents, 0)::bigint as total_cents, t.locked_total_cents
      from tickets t where t.tenant_id = ${T} and t.id = ${ticketId}::uuid`.execute(this.db)).rows[0];
    if (!t) return null;
    const tenders = (await sql<any>`select p.id, p.method, p.amount_cents, coalesce(p.tip_cents, 0) as tip_cents, p.status, p.processor_transaction_id, p.processor_reference_id, p.gift_card_last4, p.payment_surface, p.created_at
      from payments p where p.tenant_id = ${T} and p.ticket_id = ${ticketId}::uuid and not (p.status in (${sql.join(REVERSAL_ROWS)}) or (p.status in (${sql.join(VOIDED)}) and p.amount_cents = 0)) order by p.created_at, p.id`.execute(this.db)).rows;
    const lines = (await sql<any>`select l.id, l.service_name_snapshot as name, l.line_total_cents, l.line_kind, coalesce(nullif(tc.full_name, ''), trim(tc.first_name || ' ' || coalesce(tc.last_name, ''))) as technician
      from ticket_service_lines l left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id where l.tenant_id = ${T} and l.ticket_id = ${ticketId}::uuid and l.removed_at is null order by l.created_at, l.id`.execute(this.db)).rows;
    const tips = (await sql<any>`select x.technician_id, x.tip_cents, coalesce(nullif(tc.full_name, ''), trim(tc.first_name || ' ' || coalesce(tc.last_name, ''))) as name from ticket_tip_allocations x
      left join technicians tc on tc.id = x.technician_id and tc.tenant_id = x.tenant_id where x.tenant_id = ${T} and x.ticket_id = ${ticketId}::uuid order by x.tip_cents desc`.execute(this.db)).rows;
    const state = (st: string) => (CONFIRMED.includes(st) ? 'confirmed' : VOIDED.includes(st) ? 'voided' : FAILED.includes(st) ? 'failed' : 'pending');
    const paid = tenders.filter((p: any) => state(String(p.status)) === 'confirmed').reduce((a: number, p: any) => a + N(p.amount_cents), 0);
    const due = t.locked_total_cents != null ? N(t.locked_total_cents) : N(t.total_cents) + N(t.tip_cents);
    return {
      id: String(t.id), ticketNumber: t.ticket_number ?? null, status: String(t.status), paidAt: iso(t.paid_at), createdAt: iso(t.created_at),
      financials: { subtotalCents: N(t.subtotal_cents), discountCents: N(t.discount_cents), taxCents: N(t.tax_cents), surchargeCents: N(t.surcharge_cents), tipCents: N(t.tip_cents), totalCents: N(t.total_cents),
        paidCents: paid, balanceCents: String(t.status) === 'paid' ? 0 : Math.max(0, due - paid) },
      lines: lines.map((l: any) => ({ id: String(l.id), name: l.name ?? null, cents: N(l.line_total_cents), kind: l.line_kind ?? null, technician: l.technician ?? null })),
      tenders: tenders.map((p: any) => ({ id: String(p.id), method: methodKey(p.method), amountCents: N(p.amount_cents), tipCents: N(p.tip_cents), state: state(String(p.status)), rawStatus: String(p.status),
        processorRef: p.processor_transaction_id ?? p.processor_reference_id ?? null, giftCard: p.gift_card_last4 ? { last4: p.gift_card_last4 } : null, channel: p.payment_surface ?? null, at: iso(p.created_at) })),
      tipAllocations: tips.map((x: any) => ({ technicianId: String(x.technician_id), name: x.name ?? null, cents: N(x.tip_cents) })),
    };
  }

  /** Technicians who appear on a listed ticket (the filter list). */
  async technicians(ctx: FinanceCtx): Promise<{ id: string; name: string }[]> {
    const rows = (await sql<any>`select tc.id, coalesce(nullif(tc.full_name, ''), trim(tc.first_name || ' ' || coalesce(tc.last_name, ''))) as name from technicians tc
      where tc.tenant_id = ${ctx.tenantId} and tc.archived_at is null ${ctx.branchId && isUuid(ctx.branchId) ? sql`and (tc.branch_id is null or tc.branch_id = ${ctx.branchId}::uuid)` : sql``} order by 2, 1 limit 300`.execute(this.db)).rows;
    return rows.map((x: any) => ({ id: String(x.id), name: x.name || 'Technician' }));
  }

  async exportCsv(ctx: FinanceCtx, f: TxFilters): Promise<string> {
    const w = this.where(ctx, f);
    const masked = { ...ctx, permissions: ctx.permissions.filter((p) => p !== 'pos.customers.view') };
    const rows = (await sql<any>`select a.*, 0 as rank from (${this.base(ctx)}) a where ${w} order by ${TransactionsScreenRepository.ORDER[f.sort]} limit 20000`.execute(this.db)).rows.map((r: any) => this.row(masked, r));
    const sum = await this.summary(ctx, f);
    const doc = csvDocument('Transactions', [['Generated', new Date().toISOString()], ['Period', f.period.from ? `${f.period.from} to ${f.period.to} (${f.basis} date, ${f.period.tz})` : 'All time'], ['Search', f.q || '—'], ['Status', f.status ?? 'all'], ['Method', f.method ?? 'all'], ['Currency', 'USD'], ['Contact', 'masked']],
      ['Payment', 'Ticket', 'Status', 'Paid at', 'Created at', 'Customer', 'Technicians', 'Method', 'Card', 'Gross', 'Tip on tender', 'Refunded', 'Net', 'Processor reference'],
      rows.map((x) => [x.id, x.ticketNumber ?? '', x.state, x.paidAt ?? '', x.createdAt ?? '', x.customer?.name ?? '', x.technicians ?? '', x.method, x.card ?? '', usd(x.grossCents), usd(x.tipCents), usd(x.refundedCents), usd(x.netCents), x.processorRef ?? '']),
      [['Rows', String(rows.length)], ['Transactions', String(sum.kpis.transactions)], ['Gross', usd(sum.kpis.grossCents)], ['Tips (once per ticket)', usd(sum.kpis.tipsCents)], ['Net (gross − completed refunds)', usd(sum.kpis.netCents)]]);
    await audit(this.auditor, ctx, 'transactions', 'transactions_exported', 'payment', null, { rows: rows.length, status: f.status ?? 'all', method: f.method ?? 'all', search: f.q ? 'yes' : 'no' }, (e) => this.log.warn(`transactions export audit failed: ${(e as Error).message}`));
    return doc;
  }
}
