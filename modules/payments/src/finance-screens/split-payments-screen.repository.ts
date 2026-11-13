// split-payments-screen.repository.ts — Split Payments mandate (Oct 29 2026): the read model behind POS Payments & Money →
// Split Payments (/tenant/payments/split-payments). Raw SQL, tenant + location scoped, ONE ROW PER TICKET:
//   • a TENDER is a payments row that is not a refund / void / reversal row; its STATE is the row's own status —
//     confirmed (revenue-bearing), pending, or failed — a channel (terminal, Tap to Pay) is never another tender;
//   • a ticket is LISTED when it carries two or more tender attempts, or one confirmed tender and a balance still due;
//     it QUALIFIES as a split (the KPIs) when two or more tenders are CONFIRMED — a declined attempt never counts;
//   • TOTAL is the ticket's own amount, once (the paid ticket's final total; else the locked checkout total, else the
//     ticket total + tip); PAID is Σ confirmed tenders; REFUNDED is Σ settled refunds against those tenders;
//     BALANCE is total − paid, never below zero; the per-method BREAKDOWN is the confirmed amount by method;
//   • the ticket TIP is the ticket's one tip (never summed per tender); a gift-card tender is linked to its ledger entry,
//     never to a redeemable code.
// The old /state answered zero when the read failed (emptyOnReadError) and grouped only the newest 2,000 payment rows
// in memory; a read error here throws, and the list, KPIs and export run over the whole scope on the server.
import { openTicketDues, duesRelation } from './ticket-money';
import { Logger } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { REVENUE_BEARING_STATUSES, REFUND_STATUSES } from '@aipowersalon/api-contracts';
import {
  type FinanceCtx, type Period, type PageReq, type Paged, FinanceError, resolvePeriod, salonTimeZone, tsInPeriod, clampPage, isUuid, N, iso, likeOf, digitsOf,
  csvDocument, usd, audit, type AuditRecorder, oneOf, moneyToCents,
} from './finance-scope';

export const SP_BASES = ['completed', 'created', 'tender', 'refund', 'activity'] as const;
export const SP_STATUSES = ['pending', 'partially_paid', 'completed', 'failed', 'partially_refunded', 'refunded', 'void'] as const;
export const SP_COMBOS = ['card_cash', 'gift_card', 'cash_gift', 'card_card', 'three_plus', 'any_gift', 'any_cash'] as const;
export const SP_SORTS = ['created_desc', 'created_asc', 'completed_desc', 'total_desc', 'total_asc', 'tenders_desc', 'due_desc'] as const;
export interface SpFilters {
  period: Period; basis: (typeof SP_BASES)[number]; q: string; status?: (typeof SP_STATUSES)[number]; combo?: (typeof SP_COMBOS)[number]; registerId?: string;
  minCents?: number; maxCents?: number; dueOnly?: boolean; sort: (typeof SP_SORTS)[number];
}
// a tender whose money came in — the payments lifecycle's authorised states + settled (+ partially_refunded: the refund is
// its own row and payment_refunds entry; the original tender keeps its amount)
const CONFIRMED = [...new Set([...REVENUE_BEARING_STATUSES, 'completed', 'succeeded', 'settled', 'partially_refunded'])];
const REFUNDS = [...REFUND_STATUSES];
const FAILED = ['declined', 'failed', 'error', 'timeout', 'canceled', 'cancelled', 'rejected', 'expired'];
// a refund counts as refunded only once it HAS settled (status 'refunded') — the same rule as Transactions; a reserved,
// pending or processing refund has not given anything back yet (guide audit Nov 3 2026)
const REFUND_DONE = ['refunded'];
const maskPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : null; };
const showPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p ?? null); };
const METHOD_KEY: Record<string, string> = { card: 'card', credit_card: 'card', debit_card: 'card', tap_to_pay: 'card', cash: 'cash', gift_card: 'gift_card', gift: 'gift_card', check: 'check', deposit: 'deposit', loyalty: 'loyalty', other: 'other' };
export const methodKey = (m: string | null | undefined) => METHOD_KEY[String(m ?? '').toLowerCase()] ?? (String(m ?? '') || 'other');

export class SplitPaymentsScreenRepository {
  private readonly log = new Logger('SplitPaymentsScreen');
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'month', allowAll: true });
  }
  filters(period: Period, q: Record<string, unknown>): SpFilters {
    const cents = (v: unknown, field: string) => { if (v == null || v === '') return undefined; const n = typeof v === 'number' ? v : moneyToCents(String(v)); if (n == null || n < 0) throw new FinanceError('Enter a valid amount.', 'VALIDATION_FAILED', 400, { field }); return n; };
    const f: SpFilters = {
      period, basis: oneOf(q.dateField, SP_BASES, 'dateField') ?? 'completed', q: typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '',
      status: oneOf(q.status, SP_STATUSES, 'status'), combo: oneOf(q.methods, SP_COMBOS, 'methods'), registerId: typeof q.register === 'string' && isUuid(q.register) ? q.register : undefined,
      minCents: cents(q.minAmount, 'minAmount'), maxCents: cents(q.maxAmount, 'maxAmount'), dueOnly: q.due === '1' || q.due === 'true', sort: oneOf(q.sort, SP_SORTS, 'sort') ?? 'created_desc',
    };
    if (f.minCents != null && f.maxCents != null && f.minCents > f.maxCents) throw new FinanceError('The minimum total must not be above the maximum.', 'VALIDATION_FAILED', 400, { field: 'minAmount' });
    return f;
  }
  private scope(ctx: FinanceCtx): RawBuilder<boolean> { return ctx.branchId && isUuid(ctx.branchId) ? sql<boolean>`t.branch_id = ${ctx.branchId}::uuid` : sql<boolean>`true`; }

  /** One row per ticket with its tender facts pre-aggregated (no many-to-many row multiplication). */
  // (returns a plain wrapper — an async function cannot resolve to a RawBuilder: Kysely makes it un-awaitable)
  private async dues(ctx: FinanceCtx): Promise<{ rel: RawBuilder<unknown> }> {
    return { rel: duesRelation(await openTicketDues(this.db, ctx.tenantId, CONFIRMED, ctx.branchId && isUuid(ctx.branchId) ? ctx.branchId : null)) };
  }
  private base(ctx: FinanceCtx, dues: RawBuilder<unknown>): RawBuilder<unknown> {
    const T = ctx.tenantId;
    return sql`select t.id, t.tenant_id, t.branch_id, t.ticket_number, t.customer_id, t.status as ticket_status, t.created_at, t.paid_at, t.removed_at, t.checkout_register_id, t.primary_technician_id,
        coalesce(t.tip_cents, 0)::bigint as tip_cents, coalesce(t.surcharge_cents, 0)::bigint as surcharge_cents, coalesce(t.tax_cents, 0)::bigint as tax_cents, coalesce(t.discount_cents, 0)::bigint as discount_cents, coalesce(t.subtotal_cents, 0)::bigint as subtotal_cents,
        (case when t.status = 'paid' and coalesce(t.total_cents, 0) > 0 then t.total_cents when t.status = 'paid' then pay.paid_cents else coalesce(od.total_cents, pay.paid_cents) end)::bigint as total_cents,
        (case when t.status = 'paid' then 0 else coalesce(od.due_cents, 0) end)::bigint as owed_cents,
        pay.attempts, pay.confirmed, pay.pending, pay.failed, pay.paid_cents, pay.methods, pay.method_set, pay.refs, pay.first_at, pay.last_at, pay.last_confirmed_at, pay.cash_cents, pay.card_cents, pay.gift_cents, pay.other_cents,
        coalesce(rfd.refunded_cents, 0)::bigint as refunded_cents, rfd.last_refund_at,
        c.full_name as customer_name, c.normalized_phone as customer_phone, c.email as customer_email, b.name as branch_name, st.name as register_name, tc.full_name as technician_name
      from tickets t
      join lateral (select count(*)::int as attempts,
          count(*) filter (where p.status in (${sql.join(CONFIRMED)}))::int as confirmed,
          count(*) filter (where p.status not in (${sql.join([...CONFIRMED, ...FAILED])}))::int as pending,
          count(*) filter (where p.status in (${sql.join(FAILED)}))::int as failed,
          coalesce(sum(p.amount_cents) filter (where p.status in (${sql.join(CONFIRMED)})), 0)::bigint as paid_cents,
          string_agg(distinct p.method, ',') filter (where p.status in (${sql.join(CONFIRMED)})) as methods,
          count(distinct p.method) filter (where p.status in (${sql.join(CONFIRMED)}))::int as method_set,
          string_agg(p.processor_transaction_id, ',') filter (where p.processor_transaction_id is not null) as refs,
          min(p.created_at) as first_at, max(p.created_at) as last_at, max(p.created_at) filter (where p.status in (${sql.join(CONFIRMED)})) as last_confirmed_at,
          coalesce(sum(p.amount_cents) filter (where p.status in (${sql.join(CONFIRMED)}) and p.method = 'cash'), 0)::bigint as cash_cents,
          coalesce(sum(p.amount_cents) filter (where p.status in (${sql.join(CONFIRMED)}) and p.method in ('card', 'credit_card', 'debit_card')), 0)::bigint as card_cents,
          coalesce(sum(p.amount_cents) filter (where p.status in (${sql.join(CONFIRMED)}) and p.method in ('gift_card', 'gift')), 0)::bigint as gift_cents,
          coalesce(sum(p.amount_cents) filter (where p.status in (${sql.join(CONFIRMED)}) and p.method not in ('cash', 'card', 'credit_card', 'debit_card', 'gift_card', 'gift')), 0)::bigint as other_cents
        from payments p where p.tenant_id = t.tenant_id and p.ticket_id = t.id and p.status not in (${sql.join(REFUNDS)})) pay on true
      left join lateral (select sum(r.amount_cents) as refunded_cents, max(r.created_at) as last_refund_at from payment_refunds r join payments p0 on p0.id = r.payment_id and p0.tenant_id = r.tenant_id
        where r.tenant_id = t.tenant_id and p0.ticket_id = t.id and r.status in (${sql.join(REFUND_DONE)})) rfd on true
      left join ${dues} od(id, total_cents, due_cents) on od.id = t.id
      left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
      left join branches b on b.id = t.branch_id and b.tenant_id = t.tenant_id
      left join pos_stations st on st.id = t.checkout_register_id and st.tenant_id = t.tenant_id
      left join technicians tc on tc.id = t.primary_technician_id and tc.tenant_id = t.tenant_id
      where t.tenant_id = ${T} and ${this.scope(ctx)} and (pay.attempts >= 2 or (pay.confirmed >= 1 and t.status <> 'paid'))`;
  }
  private static readonly DUE = sql`a.owed_cents`;
  private static readonly STATUS = sql`(case when a.removed_at is not null or a.ticket_status in ('void', 'voided', 'canceled', 'cancelled') then 'void'
      when a.refunded_cents > 0 and a.refunded_cents >= a.paid_cents then 'refunded' when a.refunded_cents > 0 then 'partially_refunded'
      when a.confirmed = 0 and a.failed > 0 and a.pending = 0 then 'failed' when a.confirmed = 0 then 'pending'
      when a.ticket_status = 'paid' then 'completed' else 'partially_paid' end)`;
  private static readonly QUALIFIES = sql`(a.confirmed >= 2)`;
  private basisCol(b: SpFilters['basis']): RawBuilder<unknown> {
    return { completed: sql`coalesce(a.paid_at, a.last_confirmed_at)`, created: sql`a.created_at`, tender: sql`a.last_at`, refund: sql`a.last_refund_at`, activity: sql`greatest(a.last_at, coalesce(a.last_refund_at, a.last_at), a.created_at)` }[b];
  }
  private combo(c: SpFilters['combo']): RawBuilder<boolean> {
    const has = (m: string) => sql<boolean>`(',' || coalesce(a.methods, '') || ',') like ${'%,' + m + ',%'}`;
    const card = sql<boolean>`a.card_cents > 0`, cash = has('cash'), gift = sql<boolean>`a.gift_cents > 0`;
    switch (c) {
      case 'card_cash': return sql<boolean>`(${card} and ${cash})`;
      case 'gift_card': return sql<boolean>`(${gift} and ${card})`;
      case 'cash_gift': return sql<boolean>`(${gift} and ${cash})`;
      case 'card_card': return sql<boolean>`(a.card_cents > 0 and a.confirmed >= 2 and a.method_set = 1)`;
      case 'three_plus': return sql<boolean>`(a.confirmed >= 3)`;
      case 'any_gift': return gift;
      case 'any_cash': return cash;
      default: return sql<boolean>`true`;
    }
  }
  private where(f: SpFilters): RawBuilder<boolean> {
    const parts: RawBuilder<boolean>[] = [tsInPeriod(this.basisCol(f.basis), f.period)];
    if (f.status) parts.push(sql<boolean>`${SplitPaymentsScreenRepository.STATUS} = ${f.status}`);
    if (f.combo) parts.push(this.combo(f.combo));
    if (f.registerId) parts.push(sql<boolean>`a.checkout_register_id = ${f.registerId}::uuid`);
    if (f.minCents != null) parts.push(sql<boolean>`a.total_cents >= ${f.minCents}`);
    if (f.maxCents != null) parts.push(sql<boolean>`a.total_cents <= ${f.maxCents}`);
    if (f.dueOnly) parts.push(sql<boolean>`${SplitPaymentsScreenRepository.DUE} > 0`);
    if (f.q) parts.push(this.search(f.q).where);
    return sql<boolean>`${sql.join(parts, sql` and `)}`;
  }
  /** customer name / email / phone (any format) / ticket # / payment reference / exact amount — exact references first */
  private search(q: string): { where: RawBuilder<boolean>; rank: RawBuilder<number> } {
    const lower = q.toLowerCase(), d = digitsOf(q).replace(/^1(?=\d{10}$)/, ''); const tn = q.replace(/^#/, '').trim();
    const exact: RawBuilder<boolean>[] = []; const part: RawBuilder<boolean>[] = [];
    if (isUuid(q)) exact.push(sql<boolean>`(a.id = ${q}::uuid or a.customer_id = ${q}::uuid or exists (select 1 from payments px where px.tenant_id = a.tenant_id and px.ticket_id = a.id and px.id = ${q}::uuid))`);
    if (/^\d{1,8}$/.test(tn)) exact.push(sql<boolean>`a.ticket_number = ${tn}`);
    if (/^[A-Za-z0-9_-]{4,}$/.test(q)) exact.push(sql<boolean>`(',' || coalesce(a.refs, '') || ',') like ${'%,' + q + ',%'}`);
    const amt = /^\$?\d{1,6}(\.\d{1,2})?$/.test(q) ? moneyToCents(q) : null;   // an amount, not a phone number
    if (amt != null && amt > 0) exact.push(sql<boolean>`(a.total_cents = ${amt} or a.paid_cents = ${amt} or exists (select 1 from payments px where px.tenant_id = a.tenant_id and px.ticket_id = a.id and px.amount_cents = ${amt}))`);
    if (d.length >= 7) exact.push(sql<boolean>`right(regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g'), ${d.slice(-10).length}) = ${d.slice(-10)}`);
    if (q.includes('@')) exact.push(sql<boolean>`lower(coalesce(a.customer_email, '')) = ${lower}`);
    if (q.length >= 2 && !/^\d+$/.test(q)) { part.push(sql<boolean>`lower(coalesce(a.customer_name, '')) like ${likeOf(lower)}`); if (q.length >= 4) part.push(sql<boolean>`lower(coalesce(a.customer_email, '')) like ${likeOf(lower)}`); }
    if (/^\d{2,8}$/.test(tn)) part.push(sql<boolean>`a.ticket_number like ${tn + '%'}`);
    const ex = exact.length ? sql<boolean>`(${sql.join(exact, sql` or `)})` : sql<boolean>`false`;
    const pa = part.length ? sql<boolean>`(${sql.join(part, sql` or `)})` : sql<boolean>`false`;
    return { where: sql<boolean>`(${ex} or ${pa})`, rank: sql<number>`(case when ${ex} then 2 when ${pa} then 1 else 0 end)` };
  }
  private static readonly ROW_COLS = sql`a.*, ${SplitPaymentsScreenRepository.DUE} as due_cents, ${SplitPaymentsScreenRepository.STATUS} as pay_status, ${SplitPaymentsScreenRepository.QUALIFIES} as qualifies`;

  /** the mandate's breakdown, per ticket: Total · each method's confirmed amount · Remaining balance */
  static breakdown(r: { total_cents: unknown; cash_cents: unknown; card_cents: unknown; gift_cents: unknown; other_cents: unknown; paid_cents: unknown; due_cents: unknown; refunded_cents: unknown }) {
    const lines = [['cash', N(r.cash_cents)], ['card', N(r.card_cents)], ['gift_card', N(r.gift_cents)], ['other', N(r.other_cents)]].filter(([, v]) => (v as number) > 0) as [string, number][];
    return { totalCents: N(r.total_cents), lines: lines.map(([method, cents]) => ({ method, cents })), paidCents: N(r.paid_cents), refundedCents: N(r.refunded_cents), balanceCents: N(r.due_cents) };
  }
  private row(ctx: FinanceCtx, r: any) {
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    const methods = String(r.methods ?? '').split(',').filter(Boolean).map(methodKey);
    return {
      ticketId: String(r.id), ticketNumber: r.ticket_number ?? null, createdAt: iso(r.created_at), completedAt: iso(r.paid_at ?? r.last_confirmed_at), lastTenderAt: iso(r.last_at), branch: r.branch_name ?? null, register: r.register_name ?? null, technician: r.technician_name ?? null,
      customer: r.customer_id ? { id: String(r.customer_id), name: r.customer_name ?? null, phone: canContact ? showPhone(r.customer_phone) : maskPhone(r.customer_phone) } : null,
      methods: [...new Set(methods)], tenders: N(r.confirmed), attempts: N(r.attempts), failedAttempts: N(r.failed), pendingAttempts: N(r.pending), qualifies: !!r.qualifies,
      totalCents: N(r.total_cents), paidCents: N(r.paid_cents), refundedCents: N(r.refunded_cents), balanceCents: N(r.due_cents), tipCents: N(r.tip_cents), status: String(r.pay_status),
      breakdown: SplitPaymentsScreenRepository.breakdown(r), paymentRefs: String(r.refs ?? '').split(',').filter(Boolean),
      ...(r.rank !== undefined && r.rank !== 0 ? { matchedBy: r.rank === 2 ? 'reference' : 'name' } : {}),
    };
  }

  async list(ctx: FinanceCtx, f: SpFilters, pr: PageReq): Promise<Paged<ReturnType<SplitPaymentsScreenRepository['row']>>> {
    const w = this.where(f); const s = this.search(f.q);
    const total = N((await sql<any>`select count(*)::int as n from (${this.base(ctx, (await this.dues(ctx)).rel)}) a where ${w}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const order = { created_desc: sql`a.created_at desc, a.id desc`, created_asc: sql`a.created_at asc, a.id asc`, completed_desc: sql`coalesce(a.paid_at, a.last_confirmed_at) desc nulls last, a.id desc`,
      total_desc: sql`a.total_cents desc, a.id desc`, total_asc: sql`a.total_cents asc, a.id desc`, tenders_desc: sql`a.confirmed desc, a.created_at desc, a.id desc`, due_desc: sql`${SplitPaymentsScreenRepository.DUE} desc, a.created_at desc, a.id desc` }[f.sort];
    const rows = (await sql<any>`select ${SplitPaymentsScreenRepository.ROW_COLS}, ${f.q ? s.rank : sql`0`} as rank from (${this.base(ctx, (await this.dues(ctx)).rel)}) a where ${w}
      order by ${f.q ? sql`rank desc, ` : sql``}${order} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.row(ctx, r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  /** Split Tickets · Split Total · Avg Tenders (qualifying splits) + Completed · Outstanding, over the scope (never the page). */
  async summary(ctx: FinanceCtx, f: SpFilters) {
    const w = this.where({ ...f, q: '', status: undefined, combo: undefined, minCents: undefined, maxCents: undefined, dueOnly: false });
    const r = (await sql<any>`select count(*) filter (where a.confirmed >= 2)::int as split_tickets, coalesce(sum(a.total_cents) filter (where a.confirmed >= 2), 0)::bigint as split_total,
        coalesce(sum(a.confirmed) filter (where a.confirmed >= 2), 0)::int as split_tenders,
        count(*) filter (where a.confirmed >= 2 and ${SplitPaymentsScreenRepository.STATUS} = 'completed')::int as completed,
        count(*) filter (where ${SplitPaymentsScreenRepository.STATUS} = 'partially_paid')::int as partial, coalesce(sum(${SplitPaymentsScreenRepository.DUE}) filter (where ${SplitPaymentsScreenRepository.STATUS} = 'partially_paid'), 0)::bigint as outstanding,
        count(*) filter (where ${SplitPaymentsScreenRepository.STATUS} in ('refunded', 'partially_refunded'))::int as refunded, count(*) filter (where ${SplitPaymentsScreenRepository.STATUS} = 'failed')::int as failed,
        coalesce(sum(a.tip_cents) filter (where a.confirmed >= 2), 0)::bigint as tips, coalesce(sum(a.cash_cents) filter (where a.confirmed >= 2), 0)::bigint as cash, coalesce(sum(a.card_cents) filter (where a.confirmed >= 2), 0)::bigint as card, coalesce(sum(a.gift_cents) filter (where a.confirmed >= 2), 0)::bigint as gift,
        count(*) filter (where a.pending > 0)::int as pending_attempt_tickets,
        count(*)::int as listed
      from (${this.base(ctx, (await this.dues(ctx)).rel)}) a where ${w}`.execute(this.db)).rows[0] ?? {};
    const n = N(r.split_tickets);
    return {
      kpis: { splitTickets: n, splitTotalCents: N(r.split_total), avgTenders: n ? Math.round((N(r.split_tenders) / n) * 10) / 10 : 0, completedTickets: N(r.completed), outstandingTickets: N(r.partial), outstandingCents: N(r.outstanding),
        refundedTickets: N(r.refunded), failedTickets: N(r.failed), listedTickets: N(r.listed), pendingAttemptTickets: N(r.pending_attempt_tickets), tipsCents: N(r.tips), byMethod: { cashCents: N(r.cash), cardCents: N(r.card), giftCardCents: N(r.gift) } },
      definitions: { splitTicket: 'a ticket with two or more CONFIRMED tenders; a declined attempt never counts; pending splits are counted apart as partially paid', splitTotal: 'each qualifying ticket total once (its final total, tip and surcharge included; refunds shown separately)',
        avgTenders: 'confirmed tenders ÷ qualifying tickets', completed: 'qualifying tickets fully paid', outstanding: 'remaining due on partially paid tickets — not processor settlement' },
      period: f.period, basis: f.basis, asOf: new Date().toISOString(),
      permissions: { export: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.reports.export') },
    };
  }

  /** The ticket with every tender attempt, its refunds, the breakdown, the tip and gift-card / drawer links. */
  async detail(ctx: FinanceCtx, ticketId: string) {
    if (!isUuid(ticketId)) throw new FinanceError('That ticket could not be found.', 'TICKET_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const r = (await sql<any>`select ${SplitPaymentsScreenRepository.ROW_COLS}, 0 as rank from (${this.base(ctx, (await this.dues(ctx)).rel)}) a where a.id = ${ticketId}::uuid`.execute(this.db)).rows[0];
    if (!r) throw new FinanceError('That ticket could not be found.', 'TICKET_NOT_FOUND', 404);
    const ticket = this.row(ctx, r);
    const tenders = (await sql<any>`select p.id, p.method, p.amount_cents, coalesce(p.tip_cents, 0) as tip_cents, coalesce(p.surcharge_cents, 0) as surcharge_cents, p.status, p.processor_transaction_id, p.processor_reference_id, p.payment_surface, p.device_id, p.card_brand, p.card_last4, p.gift_card_last4, p.created_at, p.approved_at, p.failed_at, p.idempotency_key,
        (select coalesce(sum(r.amount_cents), 0) from payment_refunds r where r.tenant_id = p.tenant_id and r.payment_id = p.id and r.status in (${sql.join(REFUND_DONE)})) as refunded_cents,
        (select count(*)::int from payment_refunds r where r.tenant_id = p.tenant_id and r.payment_id = p.id) as refund_count,
        g.id as gift_ledger_id, g.gift_card_id, gc.card_number_last4 as gift_last4,
        d.id as drawer_movement_id, d.direction as drawer_direction
      from payments p
      left join lateral (select x.id, x.gift_card_id from gift_card_transactions x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.type in ('redeem', 'redemption') order by x.created_at limit 1) g on true
      left join gift_cards gc on gc.id = g.gift_card_id and gc.tenant_id = p.tenant_id
      left join lateral (select m.id, m.direction from cash_drawer_movements m where m.tenant_id = p.tenant_id and m.source_type = 'payment' and m.source_id = p.id and m.voided_at is null order by m.created_at limit 1) d on true
      where p.tenant_id = ${T} and p.ticket_id = ${ticketId}::uuid order by p.created_at, p.id`.execute(this.db)).rows;
    const refunds = (await sql<any>`select r.id, r.payment_id, r.amount_cents, r.reason, r.status, r.processor_refund_id, r.created_at, coalesce(u.full_name, u.email) as actor
      from payment_refunds r join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id left join users u on u.id = r.created_by_user_id and u.tenant_id = r.tenant_id where r.tenant_id = ${T} and p.ticket_id = ${ticketId}::uuid order by r.created_at desc`.execute(this.db)).rows;
    const lines = (await sql<any>`select l.id, l.service_name_snapshot as name, l.line_total_cents, l.line_kind, tc.full_name as technician from ticket_service_lines l left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.ticket_id = ${ticketId}::uuid and l.removed_at is null order by l.created_at, l.id`.execute(this.db)).rows;
    const tipAlloc = (await sql<any>`select x.technician_id, x.tip_cents, tc.full_name from ticket_tip_allocations x left join technicians tc on tc.id = x.technician_id and tc.tenant_id = x.tenant_id where x.tenant_id = ${T} and x.ticket_id = ${ticketId}::uuid order by x.tip_cents desc`.execute(this.db)).rows;
    const auditRows = (await sql<any>`select a.action_type, a.created_at, a.role, coalesce(u.full_name, u.email) as actor from audit_logs a left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.entity_id = ${ticketId} and (a.action_type like '%pay%' or a.action_type like '%refund%' or a.action_type like '%void%' or a.action_type like '%split%') order by a.created_at desc limit 20`.execute(this.db)).rows;
    const state = (st: string) => (CONFIRMED as readonly string[]).includes(st) ? 'confirmed' : (REFUNDS as readonly string[]).includes(st) ? 'reversal' : FAILED.includes(st) ? 'failed' : 'pending';
    const duplicateEvents = await this.duplicateEvents(ctx, ticketId);
    // a paid ticket owes nothing by its own record: what its confirmed tenders still leave of its total is the check
    const crossModule = await this.crossModule(ctx, ticketId, N(r.tip_cents), r.ticket_status === 'paid' ? Math.max(0, N(r.total_cents) - N(r.paid_cents)) : N(r.due_cents));
    return {
      duplicateEvents, crossModule,
      ticket,
      tenders: tenders.filter((p: any) => !(REFUNDS as readonly string[]).includes(String(p.status))).map((p: any) => ({ id: String(p.id), method: methodKey(p.method), rawMethod: String(p.method ?? ''), channel: p.payment_surface ?? null, deviceId: p.device_id ?? null, amountCents: N(p.amount_cents), tipCents: N(p.tip_cents), surchargeCents: N(p.surcharge_cents),
        state: state(String(p.status)), rawStatus: String(p.status), processorRef: p.processor_transaction_id ?? p.processor_reference_id ?? null, card: p.card_brand || p.card_last4 ? `${p.card_brand ?? ''} ••${p.card_last4 ?? '••'}`.trim() : null,
        giftCard: p.gift_card_last4 || p.gift_last4 ? { last4: p.gift_last4 ?? p.gift_card_last4, cardId: p.gift_card_id ? String(p.gift_card_id) : null, ledgerEntryId: p.gift_ledger_id ? String(p.gift_ledger_id) : null } : null,
        drawerMovementId: p.drawer_movement_id ? String(p.drawer_movement_id) : null, refundedCents: N(p.refunded_cents), refundableCents: state(String(p.status)) === 'confirmed' ? Math.max(0, N(p.amount_cents) - N(p.refunded_cents)) : 0, refunds: N(p.refund_count),
        at: iso(p.created_at), approvedAt: iso(p.approved_at), failedAt: iso(p.failed_at), idempotent: !!p.idempotency_key })),
      reversalRows: tenders.filter((p: any) => (REFUNDS as readonly string[]).includes(String(p.status))).map((p: any) => ({ id: String(p.id), method: methodKey(p.method), amountCents: N(p.amount_cents), rawStatus: String(p.status), at: iso(p.created_at) })),
      refunds: refunds.map((x: any) => ({ id: String(x.id), paymentId: String(x.payment_id), amountCents: N(x.amount_cents), reason: x.reason ?? null, status: String(x.status), processorRefundId: x.processor_refund_id ?? null, at: iso(x.created_at), actor: x.actor ?? null })),
      financials: { subtotalCents: N(r.subtotal_cents), discountCents: N(r.discount_cents), taxCents: N(r.tax_cents), tipCents: N(r.tip_cents), surchargeCents: N(r.surcharge_cents), totalCents: N(r.total_cents), paidCents: N(r.paid_cents), refundedCents: N(r.refunded_cents), balanceCents: N(r.due_cents) },
      lines: lines.map((l: any) => ({ id: String(l.id), name: l.name ?? null, cents: N(l.line_total_cents), kind: l.line_kind ?? null, technician: l.technician ?? null })),
      tipAllocations: tipAlloc.map((x: any) => ({ technicianId: String(x.technician_id), name: x.full_name ?? null, cents: N(x.tip_cents) })),
      audit: auditRows.map((a: any) => ({ action: String(a.action_type), at: iso(a.created_at), actor: a.actor ?? a.role ?? null })),
      permissions: { refund: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.refund'), customer: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view') },
    };
  }

  /** extras (Split Payments 13) — Duplicate event detector for one ticket's tenders. DIAGNOSIS ONLY: nothing is erased,
   *  merged or reversed. Three recorded signals:
   *   • repeatedCallbacks — a tender whose processor callbacks (payment_gateway_events by matched payment / reference)
   *                         repeat an event id;
   *   • repeatedOperation — another tender of this salon carrying the same processor reference (the same operation
   *                         recorded twice);
   *   • duplicatePosting  — a tender posted more than once to a local ledger: more than one gift-card redemption entry or
   *                         more than one live cash-drawer movement for the same payment. */
  private async duplicateEvents(ctx: FinanceCtx, ticketId: string) {
    const T = ctx.tenantId;
    const rows = (await sql<any>`select p.id, p.processor_transaction_id as ref,
        (select count(*)::int from payment_gateway_events e where e.tenant_id = p.tenant_id and (e.matched_payment_id = p.id or (p.processor_transaction_id is not null and e.processor_transaction_id = p.processor_transaction_id))) as deliveries,
        (select count(distinct coalesce(e.event_id, e.id::text))::int from payment_gateway_events e where e.tenant_id = p.tenant_id and (e.matched_payment_id = p.id or (p.processor_transaction_id is not null and e.processor_transaction_id = p.processor_transaction_id))) as events,
        (select count(*)::int from payments o where o.tenant_id = p.tenant_id and p.processor_transaction_id is not null and o.processor_transaction_id = p.processor_transaction_id and o.id <> p.id
           and not (o.status in (${sql.join([...REFUNDS])}) or (o.status in ('voided', 'void') and o.amount_cents = 0))) as same_ref,
        (select count(*)::int from gift_card_transactions x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.type in ('redeem', 'redemption')) as gift_posts,
        (select count(*)::int from cash_drawer_movements m where m.tenant_id = p.tenant_id and m.source_type = 'payment' and m.source_id = p.id and m.voided_at is null) as drawer_posts
      from payments p where p.tenant_id = ${T} and p.ticket_id = ${ticketId}::uuid and not (p.status in (${sql.join([...REFUNDS])})) order by p.created_at, p.id`.execute(this.db)).rows;
    const out: Array<{ paymentId: string; kind: 'repeated_callbacks' | 'repeated_operation' | 'duplicate_gift_posting' | 'duplicate_drawer_posting'; count: number; ref: string | null }> = [];
    for (const r of rows) {
      const pid = String(r.id), ref = r.ref ?? null;
      if (N(r.deliveries) > N(r.events)) out.push({ paymentId: pid, kind: 'repeated_callbacks', count: N(r.deliveries) - N(r.events), ref });
      if (N(r.same_ref) > 0) out.push({ paymentId: pid, kind: 'repeated_operation', count: N(r.same_ref), ref });
      if (N(r.gift_posts) > 1) out.push({ paymentId: pid, kind: 'duplicate_gift_posting', count: N(r.gift_posts), ref });
      if (N(r.drawer_posts) > 1) out.push({ paymentId: pid, kind: 'duplicate_drawer_posting', count: N(r.drawer_posts), ref });
    }
    return { checkedTenders: rows.length, findings: out };
  }

  /** extras (Split Payments 05) — Cross-Module Reconciliation for one ticket, by the references the modules share (the
   *  ticket, the payment, the salon business day). READ-ONLY: nothing is moved, posted, voided or corrected here.
   *   • giftCards — confirmed gift-card tenders on the ticket vs the gift-card ledger's redemptions for the ticket (by ticket
   *                 or by one of its payments): matched / differs / not used;
   *   • tips      — the ticket's tip vs the tip split to technicians (Tips): matched / unallocated / differs / not used;
   *   • cash      — each confirmed cash tender's business day (branch time zone) and whether that day's drawer was counted
   *                 (Cash Drawer / Daily Closeout): counted / open / not opened;
   *   • checkout  — the ticket's own paid state vs what the tenders left due (Checkout ↔ Transactions): aligned / misaligned. */
  private async crossModule(ctx: FinanceCtx, ticketId: string, ticketTipCents: number, dueCents: number) {
    const T = ctx.tenantId;
    const tz = await salonTimeZone(this.db, T);
    const g = (await sql<{ tender: string | number; ledger: string | number }>`select
        coalesce((select sum(p.amount_cents) from payments p where p.tenant_id = ${T} and p.ticket_id = ${ticketId}::uuid and lower(coalesce(p.method, '')) in ('gift_card', 'gift') and p.status in (${sql.join(CONFIRMED)})), 0)::bigint as tender,
        coalesce((select sum(abs(x.amount_cents)) from gift_card_transactions x where x.tenant_id = ${T} and x.type in ('redeem', 'redemption')
          and (x.ticket_id = ${ticketId}::uuid or x.payment_id in (select p2.id from payments p2 where p2.tenant_id = ${T} and p2.ticket_id = ${ticketId}::uuid))), 0)::bigint as ledger`.execute(this.db)).rows[0];
    const alloc = N((await sql<{ c: string | number }>`select coalesce(sum(x.tip_cents), 0)::bigint as c from ticket_tip_allocations x where x.tenant_id = ${T} and x.ticket_id = ${ticketId}::uuid`.execute(this.db)).rows[0]?.c);
    const cash = (await sql<{ id: string; amount_cents: string | number; day: string; statuses: string | null }>`select p.id::text as id, p.amount_cents, d.day,
        (select string_agg(distinct s.status, ',') from cash_drawer_sessions s where s.tenant_id = p.tenant_id and s.branch_id = p.branch_id and s.business_date = d.day::date) as statuses
      from payments p left join branches br on br.id = p.branch_id and br.tenant_id = p.tenant_id
      cross join lateral (select to_char(coalesce(p.approved_at, p.created_at) at time zone coalesce(nullif(br.timezone, ''), ${tz}), 'YYYY-MM-DD') as day) d
      where p.tenant_id = ${T} and p.ticket_id = ${ticketId}::uuid and lower(coalesce(p.method, '')) = 'cash' and p.status in (${sql.join(CONFIRMED)}) order by p.created_at, p.id`.execute(this.db)).rows;
    const tk = (await sql<{ status: string | null; payment_status: string | null }>`select k.status, k.payment_status from tickets k where k.tenant_id = ${T} and k.id = ${ticketId}::uuid`.execute(this.db)).rows[0];
    const due = dueCents;   // unpaid: the balance the row shows; paid: total − confirmed tenders
    const paid = tk?.status === 'paid' || tk?.payment_status === 'paid';
    const gt = N(g?.tender), gl = N(g?.ledger);
    return {
      giftCards: { tenderCents: gt, ledgerCents: gl, state: gt === 0 && gl === 0 ? 'not_used' as const : gt === gl ? 'matched' as const : 'differs' as const },
      tips: { ticketTipCents: ticketTipCents, allocatedCents: alloc, state: ticketTipCents === 0 && alloc === 0 ? 'not_used' as const : alloc === ticketTipCents ? 'matched' as const : alloc === 0 ? 'unallocated' as const : 'differs' as const },
      cash: cash.map((c) => { const st = (c.statuses ?? '').split(',').filter(Boolean);
        return { paymentId: String(c.id), amountCents: N(c.amount_cents), businessDate: c.day, closeout: st.some((x) => x === 'reconciled' || x === 'discrepancy') ? 'counted' as const : st.length ? 'open' as const : 'not_opened' as const }; }),
      checkout: { ticketPaid: paid, dueCents: due, state: paid && due > 0 ? 'misaligned' as const : 'aligned' as const },
      note: 'read_only_no_money_moved' as const,
    };
  }

  /** The registers that took a listed ticket (the filter list). */
  async registers(ctx: FinanceCtx): Promise<{ id: string; name: string }[]> {
    const rows = (await sql<any>`select st.id, st.name from pos_stations st where st.tenant_id = ${ctx.tenantId} and (${ctx.branchId && isUuid(ctx.branchId) ? sql`st.branch_id = ${ctx.branchId}::uuid` : sql`true`}) and st.retired_at is null order by st.name`.execute(this.db)).rows;
    return rows.map((r: any) => ({ id: String(r.id), name: String(r.name ?? '') }));
  }

  /** CSV of every matching ticket (all pages): one row per ticket, the breakdown per method; masked contact; audited. */
  async exportCsv(ctx: FinanceCtx, f: SpFilters): Promise<string> {
    const w = this.where(f);
    const rows = (await sql<any>`select ${SplitPaymentsScreenRepository.ROW_COLS}, 0 as rank from (${this.base(ctx, (await this.dues(ctx)).rel)}) a where ${w} order by a.created_at desc, a.id desc limit 20000`.execute(this.db)).rows.map((r: any) => this.row({ ...ctx, permissions: ctx.permissions.filter((p) => p !== 'pos.customers.view') }, r));
    const sum = await this.summary(ctx, f);
    const bd = (x: ReturnType<SplitPaymentsScreenRepository['row']>, m: string) => usd(x.breakdown.lines.find((l) => l.method === m)?.cents ?? 0);
    const doc = csvDocument('Split payments', [['Generated', new Date().toISOString()], ['Period', f.period.from ? `${f.period.from} to ${f.period.to} (${f.basis} date, ${f.period.tz})` : 'All time'], ['Search', f.q || '—'], ['Status', f.status ?? 'all'], ['Currency', 'USD'], ['Contact', 'masked']],
      ['Ticket', 'Customer', 'Created', 'Completed', 'Methods', 'Tenders', 'Total', 'Cash', 'Card', 'Gift card', 'Other', 'Paid', 'Refunded', 'Balance', 'Status', 'Register'],
      rows.map((x) => [x.ticketNumber ?? '', x.customer?.name ?? '', x.createdAt ?? '', x.completedAt ?? '', x.methods.join(' + '), x.tenders, usd(x.totalCents), bd(x, 'cash'), bd(x, 'card'), bd(x, 'gift_card'), bd(x, 'other'), usd(x.paidCents), usd(x.refundedCents), usd(x.balanceCents), x.status, x.register ?? '']),
      [['Tickets', String(rows.length)], ['Total of these tickets', usd(rows.reduce((a, x) => a + x.totalCents, 0))], ['Split tickets (period)', String(sum.kpis.splitTickets)], ['Split total (period)', usd(sum.kpis.splitTotalCents)]]);
    await audit(this.auditor, ctx, 'split_payments', 'split_payments_exported', 'ticket', null, { rows: rows.length, status: f.status ?? 'all', search: f.q ? 'yes' : 'no' }, (e) => this.log.warn(`split payments export audit failed: ${(e as Error).message}`));
    return doc;
  }
}
