// tips-screen.repository.ts — Tips & Gratuity mandate (Oct 29 2026): the read model behind POS Payments → Tips
// (/tenant/payments/tips). Raw SQL, tenant + location scoped, ONE grain per figure so nothing is ever multiplied:
//   • a TIP EVENT is a PAID ticket (tickets.tip_cents — the amount the customer tipped, collected once at payment);
//   • its CARD / CASH split comes from the ticket's settled payment rows (payments.tip_cents by method) under the SAME
//     rule the compensation engine uses (splitTipByPaymentMethod: Σ card + cash == the ticket tip, remainder to the
//     dominant rail, the ticket's chosen method when the rows carry no tip) — so this screen, payroll and the Technician
//     App agree;
//   • ALLOCATED tips are ticket_tip_allocations — one row per (ticket, technician), upserted; never the per-line
//     compensation snapshot rows (summing those is how the photo showed $19.20 against $9.60 collected — see
//     compensation-snapshot.repository.persistSnapshot). The snapshot is still READ, per ticket, so a ticket whose frozen
//     rows disagree with its collected tip is FLAGGED (never silently "fixed");
//   • REVERSALS / CORRECTIONS are compensation_adjustments (category tip_correction): refund / void / chargeback
//     reversals reduce what was collected; manual corrections re-split between technicians and net to zero;
//   • PAID OUT is the payroll period (payroll_periods by the ticket's collection day and location): paid / approved /
//     open / none — payout never adds a tip.
// Date bases: collected (tickets.paid_at — default), checkout (tickets.created_at), allocation (first snapshot /
// allocation time), adjustment (compensation_adjustments.created_at — the Adjustments view), payout (payroll_periods.paid_at).
import { TICKET_NET_SALES_T } from './ticket-money';
import type { TipsTechnicianEarningsResponse, TipsPayoutState, TipsAccuracyResponse, TipsAccuracyCheck, TipsAllocationBasis } from '@aipowersalon/api-contracts/tenant';
import { foldVi } from '@aipowersalon/api-contracts';
import { Logger } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import {
  type FinanceCtx, type Period, type PageReq, type Paged, FinanceError, resolvePeriod, salonTimeZone, tsInPeriod, clampPage, isUuid, N, iso, likeOf, digitsOf,
  csvDocument, usd, audit, type AuditRecorder, oneOf, moneyToCents, isValidTimeZone, DEFAULT_PAGE_SIZE,
} from './finance-scope';

export const TIP_BASES = ['collected', 'checkout', 'allocation', 'adjustment', 'payout'] as const;
export const TIP_METHODS = ['card', 'cash', 'split'] as const;
export const TIP_STATUSES = ['tipped', 'no_tip', 'unallocated', 'partial', 'mismatch', 'reversed', 'paid_out', 'pending_payout'] as const;
export const TIP_SORTS = ['collected_desc', 'collected_asc', 'amount_desc', 'amount_asc', 'ticket_desc'] as const;
export const DIST_SORTS = ['allocated_desc', 'allocated_asc', 'name_asc', 'tickets_desc'] as const;
export type TipBasis = (typeof TIP_BASES)[number];
export interface TipFilters {
  period: Period; basis: TipBasis; q: string; technicianId?: string; method?: (typeof TIP_METHODS)[number]; status?: (typeof TIP_STATUSES)[number];
  minCents?: number; maxCents?: number; sort: (typeof TIP_SORTS)[number];
}
const SETTLED = ['approved', 'partial', 'partially_refunded', 'paid', 'captured', 'completed'];
const POSTED = ['posted', 'approved', 'applied'];
/** Team Tips (Nov 13 2026): who may search / see a technician's own phone — the Team Members contact rule */
const TECH_CONTACT = ['technicians.edit', 'pos.technicians.edit'];
/** Team Tips: tips lists page at 10 / 25 / 50 / 100 (the Payments view keeps its 12) — never more than 100 */
export function tipsPageReq(q: { page?: unknown; pageSize?: unknown }): PageReq {
  const page = Math.max(1, Math.min(100_000, Math.floor(N(q.page) || 1)));
  const want = Math.floor(N(q.pageSize) || DEFAULT_PAGE_SIZE);
  return { page, pageSize: Math.max(1, Math.min(100, want)) };
}
const maskPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : null; };
const maskName = (v: string | null | undefined) => { const p = String(v ?? '').trim().split(/\s+/).filter(Boolean); return p.length ? (p.length > 1 ? `${p[0]} ${p[p.length - 1].charAt(0)}.` : p[0]) : null; };
const showPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p ?? null); };

/** Team Tips (Nov 13 2026): how a ticket's split was decided, from who wrote its allocation rows (ticket_tip_allocations.source,
 *  migration 817) — read, never recomputed: the customer on the display, the front desk, the only technician, or the salon's
 *  tip policy applied by the compensation engine at payment (two technicians 50/50 exact-cent; three or more its rule). */
export function allocationBasis(sources: unknown, techs: number): TipsAllocationBasis {
  const set = new Set(String(sources ?? '').split(',').filter(Boolean));
  if (set.has('customer_display')) return 'customer_selected';
  if (set.has('staff')) return 'staff_directed';
  return techs <= 1 ? 'single' : 'salon_policy';
}

export class TipsScreenRepository {
  private readonly log = new Logger('TipsScreen');
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await this.zone(ctx), { defaultPreset: 'month', allowAll: true });
  }
  /** Team Tips (Nov 13 2026): the SESSION branch's time zone (a salon's second location may sit in another zone); the salon's
   *  zone when the session has no branch or the branch has none. Presets and Custom days are that zone's calendar days. */
  private async zone(ctx: FinanceCtx): Promise<string> {
    if (ctx.branchId && isUuid(ctx.branchId)) {
      const r = (await sql<{ timezone: string | null }>`select b.timezone from branches b where b.tenant_id = ${ctx.tenantId} and b.id = ${ctx.branchId}::uuid`.execute(this.db)).rows[0];
      if (r?.timezone && isValidTimeZone(r.timezone)) return r.timezone;
    }
    return salonTimeZone(this.db, ctx.tenantId);
  }
  filters(period: Period, q: Record<string, unknown>): TipFilters {
    const cents = (v: unknown, field: string) => { if (v == null || v === '') return undefined; const n = typeof v === 'number' ? v : moneyToCents(String(v)); if (n == null || n < 0) throw new FinanceError('Enter a valid amount.', 'VALIDATION_FAILED', 400, { field }); return n; };
    const f: TipFilters = {
      period, basis: oneOf(q.dateField, TIP_BASES, 'dateField') ?? 'collected', q: typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '',
      technicianId: typeof q.technicianId === 'string' && isUuid(q.technicianId) ? q.technicianId : undefined,
      method: oneOf(q.method, TIP_METHODS, 'method'), status: oneOf(q.status, TIP_STATUSES, 'status'),
      minCents: cents(q.minAmount, 'minAmount'), maxCents: cents(q.maxAmount, 'maxAmount'), sort: oneOf(q.sort, TIP_SORTS, 'sort') ?? 'collected_desc',
    };
    if (f.minCents != null && f.maxCents != null && f.minCents > f.maxCents) throw new FinanceError('The minimum amount must not be above the maximum.', 'VALIDATION_FAILED', 400, { field: 'minAmount' });
    return f;
  }
  private scope(ctx: FinanceCtx): RawBuilder<boolean> { return ctx.branchId && isUuid(ctx.branchId) ? sql<boolean>`t.branch_id = ${ctx.branchId}::uuid` : sql<boolean>`true`; }

  /** One row per ELIGIBLE ticket (paid, not removed, revenue-bearing or tipped) with its tip facts — the grain of every
   *  figure on the screen. Allocation, snapshot, reversal and payout facts are pre-aggregated per ticket before the join. */
  private base(ctx: FinanceCtx, tz = 'UTC'): RawBuilder<unknown> {
    const T = ctx.tenantId;
    return sql`select t.id, t.tenant_id, t.branch_id, t.ticket_number, t.customer_id, t.primary_technician_id, t.paid_at, t.created_at, t.chosen_payment_method,
        greatest(0, coalesce(t.tip_cents, 0))::bigint as tip_cents, ${TICKET_NET_SALES_T}::bigint as pretip_sales_cents, coalesce(t.total_cents, 0)::bigint as total_cents,
        coalesce(pay.card_pay, 0)::bigint as card_pay, coalesce(pay.cash_pay, 0)::bigint as cash_pay, coalesce(pay.methods, '') as methods, coalesce(pay.refs, '') as refs, coalesce(pay.tenders, 0)::int as tenders,
        coalesce(alc.alloc_cents, 0)::bigint as alloc_cents, coalesce(alc.techs, 0)::int as alloc_techs, alc.tech_names, alc.tech_ids, alc.first_alloc_at, alc.tech_phones, alc.alloc_sources,
        snp.snap_cents, snp.first_snap_at,
        coalesce(rev.reversed_cents, 0)::bigint as reversed_cents, coalesce(man.manual_cents, 0)::bigint as manual_cents,
        per.id as period_id, per.label as period_label, per.status as period_status, per.payout_status as period_payout_status, per.paid_at as period_paid_at,
        exists (select 1 from cash_payment_confirmations cc where cc.tenant_id = t.tenant_id and cc.ticket_id = t.id and cc.status = 'confirmed') as cash_to_tech,
        c.full_name as customer_name, c.normalized_phone as customer_phone, c.email as customer_email, b.name as branch_name, pt.full_name as primary_tech_name,
        regexp_replace(coalesce(pt.normalized_phone, ''), '[^0-9]', '', 'g') as primary_tech_phone
      from tickets t
      left join lateral (select
          coalesce(sum(case when p.method <> 'cash' then greatest(0, coalesce(p.tip_cents, 0)) else 0 end), 0) as card_pay,
          coalesce(sum(case when p.method = 'cash' then greatest(0, coalesce(p.tip_cents, 0)) else 0 end), 0) as cash_pay,
          string_agg(distinct p.method, ',') as methods, string_agg(p.processor_transaction_id, ',') filter (where p.processor_transaction_id is not null) as refs, count(*) as tenders
        from payments p where p.tenant_id = t.tenant_id and p.ticket_id = t.id and p.status in (${sql.join(SETTLED)})) pay on true
      left join lateral (select sum(x.tip_cents) as alloc_cents, count(*) as techs, string_agg(coalesce(tc.full_name, '?'), ', ' order by x.tip_cents desc) as tech_names, string_agg(x.technician_id::text, ',' order by x.tip_cents desc) as tech_ids, min(x.created_at) as first_alloc_at,
          string_agg(regexp_replace(coalesce(tc.normalized_phone, ''), '[^0-9]', '', 'g'), ',') as tech_phones, string_agg(distinct x.source, ',') as alloc_sources
        from ticket_tip_allocations x left join technicians tc on tc.id = x.technician_id and tc.tenant_id = x.tenant_id where x.tenant_id = t.tenant_id and x.ticket_id = t.id) alc on true
      left join lateral (select sum(coalesce(s.card_tip_cents, 0) + coalesce(s.cash_tip_cents, 0)) as snap_cents, min(s.snapshot_at) as first_snap_at
        from ticket_compensation_snapshots s where s.tenant_id = t.tenant_id and s.ticket_id = t.id) snp on true
      left join lateral (select sum(j.amount_cents) as reversed_cents from compensation_adjustments j where j.tenant_id = t.tenant_id and j.ticket_id = t.id and j.category = 'tip_correction' and j.source <> 'manual' and j.status in (${sql.join(POSTED)})) rev on true
      left join lateral (select sum(j.amount_cents) as manual_cents from compensation_adjustments j where j.tenant_id = t.tenant_id and j.ticket_id = t.id and j.category = 'tip_correction' and j.source = 'manual' and j.status in (${sql.join(POSTED)})) man on true
      left join lateral (select pp.id, pp.label, pp.status, pp.payout_status, pp.paid_at from payroll_periods pp where pp.tenant_id = t.tenant_id and (pp.branch_id = t.branch_id or pp.branch_id is null)
        and t.paid_at is not null and (t.paid_at at time zone ${tz})::date between pp.period_start and pp.period_end and pp.canceled_at is null order by pp.branch_id nulls last limit 1) per on true
      left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
      left join branches b on b.id = t.branch_id and b.tenant_id = t.tenant_id
      left join technicians pt on pt.id = t.primary_technician_id and pt.tenant_id = t.tenant_id
      where t.tenant_id = ${T} and t.status = 'paid' and t.removed_at is null and (coalesce(t.total_cents, 0) > 0 or coalesce(t.tip_cents, 0) > 0) and ${this.scope(ctx)}`;
  }
  /** the engine's card / cash rule, in SQL, over a base row `a` (see the header) */
  private static readonly CASH = sql`(case when a.card_pay + a.cash_pay = 0 then (case when a.chosen_payment_method = 'cash' then a.tip_cents else 0 end)
      when a.cash_pay >= a.card_pay then greatest(0, a.tip_cents - a.card_pay) else least(a.tip_cents, a.cash_pay) end)`;
  private static readonly CARD = sql`(a.tip_cents - ${TipsScreenRepository.CASH})`;
  /** extras TIPS & GRATUITY 04 (round 10): WHERE the cash tip went — handed straight to the technician (the visit was settled by
   *  Cash to Technician: a CONFIRMED cash_payment_confirmations row for the ticket — the technician confirmed receiving it)
   *  or collected into the drawer (every other cash tip). Only splits the cash figure above; card / cash stay the engine's. */
  private static readonly CASH_TECH = sql`(case when a.cash_to_tech then ${TipsScreenRepository.CASH} else 0 end)`;
  private basisCol(b: TipBasis): RawBuilder<unknown> {
    return { collected: sql`a.paid_at`, checkout: sql`a.created_at`, allocation: sql`coalesce(a.first_alloc_at, a.first_snap_at)`, adjustment: sql`a.paid_at`, payout: sql`a.period_paid_at` }[b];
  }
  private static readonly ALLOC_STATE = sql`(case when a.tip_cents = 0 then 'none' when a.alloc_cents = a.tip_cents then 'allocated' when a.alloc_cents = 0 then 'unallocated' when a.alloc_cents > a.tip_cents then 'over' else 'partial' end)`;
  private static readonly PAYOUT_STATE = sql`(case when a.period_id is null then 'none' when a.period_payout_status = 'paid' or a.period_status = 'paid' then 'paid' when a.period_status in ('approved', 'finalized', 'submitted', 'prepared') then 'approved' else 'open' end)`;
  private static readonly METHOD = sql`(case when a.tip_cents = 0 then 'none' when ${TipsScreenRepository.CARD} > 0 and ${TipsScreenRepository.CASH} > 0 then 'split' when ${TipsScreenRepository.CASH} > 0 then 'cash' else 'card' end)`;

  private where(f: TipFilters, ctx?: FinanceCtx): RawBuilder<boolean> {
    const parts: RawBuilder<boolean>[] = [tsInPeriod(this.basisCol(f.basis), f.period)];
    if (f.technicianId) parts.push(sql<boolean>`(',' || coalesce(a.tech_ids, '') || ',' like ${'%,' + f.technicianId + ',%'} or (a.alloc_cents = 0 and a.primary_technician_id = ${f.technicianId}::uuid))`);
    if (f.method) parts.push(sql<boolean>`${TipsScreenRepository.METHOD} = ${f.method}`);
    if (f.status === 'tipped') parts.push(sql<boolean>`a.tip_cents > 0`);
    if (f.status === 'no_tip') parts.push(sql<boolean>`a.tip_cents = 0`);
    if (f.status === 'unallocated') parts.push(sql<boolean>`a.tip_cents > 0 and a.alloc_cents = 0`);
    if (f.status === 'partial') parts.push(sql<boolean>`a.tip_cents > 0 and a.alloc_cents > 0 and a.alloc_cents <> a.tip_cents`);
    if (f.status === 'mismatch') parts.push(sql<boolean>`a.snap_cents is not null and a.snap_cents <> a.tip_cents`);
    if (f.status === 'reversed') parts.push(sql<boolean>`a.reversed_cents <> 0`);
    if (f.status === 'paid_out') parts.push(sql<boolean>`a.tip_cents > 0 and ${TipsScreenRepository.PAYOUT_STATE} = 'paid'`);
    if (f.status === 'pending_payout') parts.push(sql<boolean>`a.tip_cents > 0 and ${TipsScreenRepository.PAYOUT_STATE} <> 'paid'`);
    if (f.minCents != null) parts.push(sql<boolean>`a.tip_cents >= ${f.minCents}`);
    if (f.maxCents != null) parts.push(sql<boolean>`a.tip_cents <= ${f.maxCents}`);
    if (f.q) parts.push(this.search(f.q, ctx).where);
    return sql<boolean>`${sql.join(parts, sql` and `)}`;
  }
  /** customer name / phone (any format) / technician / ticket # / payment ref / exact amount — exact references rank first.
   *  Team Tips (Nov 13 2026): technician names match case- AND accent-insensitively (vi_fold — "thao" finds "Thảo", "dang" finds
   *  "Đặng"); a technician's own phone or id only for a role that may see team contact details; the customer's name / phone /
   *  e-mail only for a role with customer access (pos.customers.view) — another role's search simply never matches them. Every
   *  condition runs inside the tenant + location scope of the base query, before counting and paging. */
  private search(q: string, ctx?: FinanceCtx): { where: RawBuilder<boolean>; rank: RawBuilder<number> } {
    const can = (p: string) => !!ctx && hasPermission(ctx as Parameters<typeof hasPermission>[0], p);
    const customers = !ctx || can('pos.customers.view');   // no ctx = an internal caller (export rows are masked separately)
    const contact = !!ctx && TECH_CONTACT.some(can);
    const lower = q.toLowerCase(), folded = foldVi(q), d = digitsOf(q).replace(/^1(?=\d{10}$)/, ''); const tn = q.replace(/^#/, '').trim();
    const exact: RawBuilder<boolean>[] = []; const part: RawBuilder<boolean>[] = [];
    if (isUuid(q)) exact.push(sql<boolean>`a.id = ${q}::uuid`);
    if (isUuid(q) && contact) exact.push(sql<boolean>`((',' || coalesce(a.tech_ids, '') || ',') like ${'%,' + q.toLowerCase() + ',%'} or a.primary_technician_id = ${q}::uuid)`);
    if (/^\d{1,8}$/.test(tn)) exact.push(sql<boolean>`a.ticket_number = ${tn}`);
    if (/^[A-Za-z0-9_-]{4,}$/.test(q)) exact.push(sql<boolean>`(',' || a.refs || ',') like ${'%,' + q + ',%'}`);
    const amt = /^\$?\d{1,6}(\.\d{1,2})?$/.test(q) ? moneyToCents(q) : null;   // an amount, not a phone number
    if (amt != null && amt > 0) exact.push(sql<boolean>`(a.tip_cents = ${amt} or a.total_cents = ${amt})`);
    if (d.length >= 7 && customers) exact.push(sql<boolean>`right(regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g'), ${d.slice(-10).length}) = ${d.slice(-10)}`);
    if (d.length >= 7 && contact) exact.push(sql<boolean>`((',' || coalesce(a.tech_phones, '') || ',') like ${'%' + d.slice(-10) + ',%'} or right(a.primary_tech_phone, ${d.slice(-10).length}) = ${d.slice(-10)})`);
    if (q.length >= 2 && !/^\d+$/.test(q)) {
      if (customers) part.push(sql<boolean>`vi_fold(coalesce(a.customer_name, '')) like ${likeOf(folded)}`);
      part.push(sql<boolean>`vi_fold(coalesce(a.tech_names, '')) like ${likeOf(folded)}`);
      part.push(sql<boolean>`vi_fold(coalesce(a.primary_tech_name, '')) like ${likeOf(folded)}`);
      if (q.includes('@') && customers) part.push(sql<boolean>`lower(coalesce(a.customer_email, '')) like ${likeOf(lower)}`);
    }
    if (/^\d{1,8}$/.test(tn) && tn.length >= 2) part.push(sql<boolean>`a.ticket_number like ${tn + '%'}`);
    const ex = exact.length ? sql<boolean>`(${sql.join(exact, sql` or `)})` : sql<boolean>`false`;
    const pa = part.length ? sql<boolean>`(${sql.join(part, sql` or `)})` : sql<boolean>`false`;
    return { where: sql<boolean>`(${ex} or ${pa})`, rank: sql<number>`(case when ${ex} then 2 when ${pa} then 1 else 0 end)` };
  }

  private row(ctx: FinanceCtx, r: any) {
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    const tip = N(r.tip_cents), card = N(r.card), cash = N(r.cash);
    const techIds = String(r.tech_ids ?? '').split(',').filter(Boolean); const techNames = String(r.tech_names ?? '').split(', ').filter(Boolean);
    return {
      ticketId: String(r.id), ticketNumber: r.ticket_number ?? null, collectedAt: iso(r.paid_at), checkoutAt: iso(r.created_at), branch: r.branch_name ?? null,
      // Team Tips (Nov 13 2026): a role without customer access sees a masked name ("Linh T.") beside the masked phone
      customer: r.customer_id ? { id: String(r.customer_id), name: canContact ? (r.customer_name ?? null) : maskName(r.customer_name), phone: canContact ? showPhone(r.customer_phone) : maskPhone(r.customer_phone) } : null,
      technicians: techIds.length ? techIds.map((id, i) => ({ id, name: techNames[i] ?? null })) : r.primary_technician_id ? [{ id: String(r.primary_technician_id), name: r.primary_tech_name ?? null }] : [],
      method: String(r.method), tenders: N(r.tenders), paymentRefs: String(r.refs ?? '').split(',').filter(Boolean),
      amountCents: tip, cardCents: card, cashCents: cash, cashSource: cash > 0 ? (r.cash_to_tech ? 'technician' : 'drawer') : null, cashToTechnicianCents: r.cash_to_tech ? cash : 0, cashDrawerCents: r.cash_to_tech ? 0 : cash, pretipSalesCents: N(r.pretip_sales_cents), totalCents: N(r.total_cents),
      allocatedCents: N(r.alloc_cents), unallocatedCents: Math.max(0, tip - N(r.alloc_cents)), allocationState: String(r.alloc_state),
      snapshotCents: r.snap_cents == null ? null : N(r.snap_cents), snapshotMismatch: r.snap_cents != null && N(r.snap_cents) !== tip,
      reversedCents: N(r.reversed_cents), netCents: tip + N(r.reversed_cents), manualCorrectionCents: N(r.manual_cents),
      payout: { state: String(r.payout_state), periodId: r.period_id ? String(r.period_id) : null, periodLabel: r.period_label ?? null, paidAt: iso(r.period_paid_at) },
      ...(r.matched_by !== undefined ? { matchedBy: r.rank === 2 ? 'reference' : r.rank === 1 ? 'name' : null } : {}),
    };
  }
  private static readonly ROW_COLS = sql`a.*, ${TipsScreenRepository.CARD} as card, ${TipsScreenRepository.CASH} as cash, ${TipsScreenRepository.METHOD} as method, ${TipsScreenRepository.ALLOC_STATE} as alloc_state, ${TipsScreenRepository.PAYOUT_STATE} as payout_state`;

  async transactions(ctx: FinanceCtx, f: TipFilters, pr: PageReq): Promise<Paged<ReturnType<TipsScreenRepository['row']>>> {
    const w = this.where(f, ctx); const s = this.search(f.q, ctx);
    const total = N((await sql<any>`select count(*)::int as n from (${this.base(ctx, f.period.tz)}) a where ${w}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const order = { collected_desc: sql`a.paid_at desc, a.id desc`, collected_asc: sql`a.paid_at asc, a.id asc`, amount_desc: sql`a.tip_cents desc, a.paid_at desc, a.id desc`, amount_asc: sql`a.tip_cents asc, a.paid_at desc, a.id desc`, ticket_desc: sql`a.ticket_number desc nulls last, a.id desc` }[f.sort];
    const rows = (await sql<any>`select ${TipsScreenRepository.ROW_COLS}, ${f.q ? s.rank : sql`0`} as rank, true as matched_by from (${this.base(ctx, f.period.tz)}) a where ${w}
      order by ${f.q ? sql`rank desc, ` : sql``}${order} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.row(ctx, r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  /** The five KPIs + the reconciliation strip, over every eligible ticket in the period (never the page). */
  async summary(ctx: FinanceCtx, f: TipFilters) {
    const w = this.where({ ...f, q: '', status: undefined, method: undefined, minCents: undefined, maxCents: undefined });
    const r = (await sql<any>`select count(*)::int as eligible, count(*) filter (where a.tip_cents > 0)::int as tipped, count(*) filter (where a.tip_cents = 0)::int as no_tip,
        coalesce(sum(a.tip_cents), 0)::bigint as collected, coalesce(sum(${TipsScreenRepository.CARD}), 0)::bigint as card, coalesce(sum(${TipsScreenRepository.CASH}), 0)::bigint as cash,
        coalesce(sum(${TipsScreenRepository.CASH_TECH}), 0)::bigint as cash_tech,
        coalesce(sum(a.pretip_sales_cents), 0)::bigint as sales, coalesce(sum(a.reversed_cents), 0)::bigint as reversed, coalesce(sum(a.manual_cents), 0)::bigint as manual,
        coalesce(sum(a.alloc_cents), 0)::bigint as allocated, coalesce(sum(greatest(0, a.tip_cents - a.alloc_cents)), 0)::bigint as unallocated,
        count(*) filter (where a.snap_cents is not null and a.snap_cents <> a.tip_cents)::int as mismatch, coalesce(sum(a.snap_cents) filter (where a.snap_cents is not null), 0)::bigint as snapshot,
        coalesce(sum(a.alloc_cents) filter (where ${TipsScreenRepository.PAYOUT_STATE} = 'paid'), 0)::bigint as paid_out,
        coalesce(sum(a.alloc_cents) filter (where ${TipsScreenRepository.PAYOUT_STATE} <> 'paid'), 0)::bigint as pending_payout,
        coalesce(sum(a.alloc_cents) filter (where ${TipsScreenRepository.PAYOUT_STATE} = 'approved'), 0)::bigint as payable,
        coalesce(sum(a.alloc_cents) filter (where ${TipsScreenRepository.PAYOUT_STATE} in ('open', 'none')), 0)::bigint as accrued,
        count(*) filter (where ${TipsScreenRepository.METHOD} = 'split')::int as split_tickets
      from (${this.base(ctx, f.period.tz)}) a where ${w}`.execute(this.db)).rows[0] ?? {};
    const collected = N(r.collected), sales = N(r.sales), tipped = N(r.tipped);
    return {
      kpis: {
        totalTipsCents: collected, reversedCents: N(r.reversed), netTipsCents: collected + N(r.reversed), cardTipsCents: N(r.card), cashTipsCents: N(r.cash), cashToTechnicianTipsCents: N(r.cash_tech), cashDrawerTipsCents: N(r.cash) - N(r.cash_tech),
        avgTipRatePct: sales > 0 ? Math.round((collected / sales) * 1000) / 10 : null, avgTipPerTippedTicketCents: tipped > 0 ? Math.round(collected / tipped) : null,
        noTipCount: N(r.no_tip), eligibleTickets: N(r.eligible), tippedTickets: tipped, splitTickets: N(r.split_tickets),
      },
      reconciliation: { collectedCents: collected, allocatedCents: N(r.allocated), unallocatedCents: N(r.unallocated), manualCorrectionCents: N(r.manual), reversedCents: N(r.reversed),
        snapshotCents: N(r.snapshot), snapshotMismatchTickets: N(r.mismatch), paidOutCents: N(r.paid_out), pendingPayoutCents: N(r.pending_payout),
        // Team Tips (Nov 13 2026): pending payout split by payroll state — PAYABLE = allocated tips in an approved (not yet paid)
        // pay period; ACCRUED = in an open period or none yet. paid + payable + accrued == allocated.
        payableCents: N(r.payable), accruedCents: N(r.accrued),
        balanced: N(r.allocated) + N(r.unallocated) === collected },
      definitions: { totalTips: 'sum of tickets.tip_cents on paid tickets, collection date', cardCash: 'settled payment rows by method; remainder to the dominant rail; the chosen method when rows carry no tip', cashSource: 'cash tips of visits settled by Cash to Technician (a confirmed cash payment confirmation) were handed to the technician; every other cash tip was collected into the drawer',
        avgTipRate: 'total tips ÷ pre-tip sales (subtotal − discounts, tax excluded) of every eligible ticket, including no-tip tickets', avgTipAmount: 'total tips ÷ tipped tickets (tickets with a tip above $0)',
        payable: 'allocated tips whose pay period is approved but not yet paid', paid: 'allocated tips whose pay period is marked paid (payroll state — an export is not a payout)', noTip: 'paid, non-removed tickets with a zero tip', allocated: 'ticket_tip_allocations (one row per ticket and technician)' },
      period: f.period, basis: f.basis, asOf: new Date().toISOString(),
      permissions: { export: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.reports.export'), adjust: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'tips.adjust'),
        customer: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view'), technicianContact: TECH_CONTACT.some((k) => hasPermission(ctx as Parameters<typeof hasPermission>[0], k)) },
    };
  }

  /** Per technician over the period: allocated card / cash / total, share, tickets, paid-out vs pending, corrections.
   *  Grain: (ticket, technician) from ticket_tip_allocations; card / cash by the ticket's own card:cash share. */
  async distribution(ctx: FinanceCtx, f: TipFilters, pr: PageReq, sort: (typeof DIST_SORTS)[number] = 'allocated_desc') {
    const w = this.where({ ...f, technicianId: undefined, status: undefined, method: undefined, minCents: undefined, maxCents: undefined });
    const rows = (await sql<any>`with a as (select ${TipsScreenRepository.ROW_COLS} from (${this.base(ctx, f.period.tz)}) a where ${w}),
      x as (select al.technician_id, al.ticket_id, al.tip_cents as alloc, a.card, a.cash, a.tip_cents, a.payout_state, a.paid_at from ticket_tip_allocations al join a on a.id = al.ticket_id where al.tenant_id = ${ctx.tenantId} and al.tip_cents > 0),
      -- Individual Technician Tipping 05 (round 10): per ticket, everything allocated against the ticket's own collected tip
      tk as (select x.ticket_id, sum(x.alloc) as allocated, max(x.tip_cents) as tip from x group by x.ticket_id),
      per as (select x.technician_id, count(distinct x.ticket_id)::int as tickets, sum(x.alloc)::bigint as allocated,
          sum(case when x.tip_cents > 0 then round(x.alloc::numeric * x.card / x.tip_cents) else 0 end)::bigint as card_alloc,
          sum(x.alloc) filter (where x.payout_state = 'paid')::bigint as paid_out, sum(x.alloc) filter (where x.payout_state <> 'paid')::bigint as pending, max(x.paid_at) as last_at,
          count(distinct x.ticket_id) filter (where tk.allocated <> tk.tip)::int as unreconciled
        from x join tk on tk.ticket_id = x.ticket_id group by x.technician_id),
      corr as (select j.technician_id, sum(j.amount_cents) filter (where j.source = 'manual')::bigint as manual, sum(j.amount_cents) filter (where j.source <> 'manual')::bigint as reversed
        from compensation_adjustments j join a on a.id = j.ticket_id where j.tenant_id = ${ctx.tenantId} and j.category = 'tip_correction' and j.status in (${sql.join(POSTED)}) group by j.technician_id)
      select per.*, coalesce(corr.manual, 0)::bigint as manual, coalesce(corr.reversed, 0)::bigint as reversed, tc.full_name as name, tc.status as tech_status
      from per left join corr on corr.technician_id = per.technician_id left join technicians tc on tc.id = per.technician_id and tc.tenant_id = ${ctx.tenantId}`.execute(this.db)).rows;
    const totalAlloc = rows.reduce((s: number, r: any) => s + N(r.allocated), 0);
    const items = rows.map((r: any) => {
      const allocated = N(r.allocated), card = Math.min(allocated, Math.max(0, N(r.card_alloc)));
      return { technicianId: String(r.technician_id), name: r.name ?? null, active: r.tech_status !== 'archived', tickets: N(r.tickets), allocatedCents: allocated, cardCents: card, cashCents: allocated - card,
        sharePct: totalAlloc > 0 ? Math.round((allocated / totalAlloc) * 1000) / 10 : 0, paidOutCents: N(r.paid_out), pendingCents: N(r.pending),
        manualCorrectionCents: N(r.manual), reversedCents: N(r.reversed), netCents: allocated + N(r.manual) + N(r.reversed), lastAt: iso(r.last_at),
        // tickets this technician is on whose allocations do not add up to the ticket's collected tip (the per-recipient reconciliation)
        unreconciledTickets: N(r.unreconciled) };
    });
    const cmp = { allocated_desc: (a: any, b: any) => b.allocatedCents - a.allocatedCents || String(a.name).localeCompare(String(b.name)), allocated_asc: (a: any, b: any) => a.allocatedCents - b.allocatedCents,
      name_asc: (a: any, b: any) => String(a.name ?? '').localeCompare(String(b.name ?? '')), tickets_desc: (a: any, b: any) => b.tickets - a.tickets || b.allocatedCents - a.allocatedCents }[sort];
    items.sort(cmp);
    const pg = clampPage(pr, items.length);
    return { items: items.slice(pg.offset, pg.offset + pg.pageSize), total: items.length, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount,
      totals: { allocatedCents: totalAlloc, technicians: items.length, cardCents: items.reduce((s2, x) => s2 + x.cardCents, 0), cashCents: items.reduce((s2, x) => s2 + x.cashCents, 0),
        paidOutCents: items.reduce((s2, x) => s2 + x.paidOutCents, 0), pendingCents: items.reduce((s2, x) => s2 + x.pendingCents, 0), unreconciledTechnicians: items.filter((x) => x.unreconciledTickets > 0).length } };
  }

  /** extras TIPS 01 — Technician Earnings Overlay: one technician over the period (same filters / basis as Distribution, so
   *  the totals reconcile with that row): per ticket THIS technician's allocated share (ticket_tip_allocations), the ticket's
   *  payout state and the payroll period it falls in; totals by state; the periods with this technician's sum. Read-only. */
  async technicianEarnings(ctx: FinanceCtx, f: TipFilters, technicianId: string, pr: PageReq): Promise<Omit<TipsTechnicianEarningsResponse, 'period' | 'dateBasis'>> {
    if (!isUuid(technicianId)) throw new FinanceError('That tip record could not be found.', 'TIP_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const tech = (await sql<{ id: string; full_name: string | null; status: string | null }>`select tc.id, tc.full_name, tc.status from technicians tc where tc.tenant_id = ${T} and tc.id = ${technicianId}::uuid`.execute(this.db)).rows[0];
    if (!tech) throw new FinanceError('That tip record could not be found.', 'TIP_NOT_FOUND', 404);
    const w = this.where({ ...f, technicianId: undefined, status: undefined, method: undefined, minCents: undefined, maxCents: undefined, q: '' });
    const x = sql`with a as (select ${TipsScreenRepository.ROW_COLS} from (${this.base(ctx, f.period.tz)}) a where ${w}),
      x as (select al.ticket_id, al.tip_cents as alloc, a.ticket_number, a.paid_at, a.tip_cents, a.payout_state, a.period_id, a.period_label, a.period_paid_at, a.alloc_techs,
          a.method, a.alloc_sources, a.manual_cents
        from ticket_tip_allocations al join a on a.id = al.ticket_id where al.tenant_id = ${T} and al.technician_id = ${technicianId}::uuid and al.tip_cents > 0)`;
    const tot = (await sql<any>`${x} select count(*)::int as n, coalesce(sum(alloc), 0)::bigint as allocated,
        coalesce(sum(alloc) filter (where payout_state = 'paid'), 0)::bigint as paid, coalesce(sum(alloc) filter (where payout_state = 'approved'), 0)::bigint as approved,
        coalesce(sum(alloc) filter (where payout_state = 'open'), 0)::bigint as open, coalesce(sum(alloc) filter (where payout_state = 'none'), 0)::bigint as unscheduled from x`.execute(this.db)).rows[0] ?? {};
    const corr = (await sql<any>`with a as (select a.id from (${this.base(ctx, f.period.tz)}) a where ${w})
      select coalesce(sum(j.amount_cents) filter (where j.source = 'manual'), 0)::bigint as manual, coalesce(sum(j.amount_cents) filter (where j.source <> 'manual'), 0)::bigint as reversed
      from compensation_adjustments j join a on a.id = j.ticket_id where j.tenant_id = ${T} and j.technician_id = ${technicianId}::uuid and j.category = 'tip_correction' and j.status in (${sql.join(POSTED)})`.execute(this.db)).rows[0] ?? {};
    const per = (await sql<any>`${x} select period_id, max(period_label) as label, max(payout_state) as state, max(period_paid_at) as paid_at, sum(alloc)::bigint as allocated, count(*)::int as tickets
      from x group by period_id order by max(period_paid_at) desc nulls first, max(period_label) desc nulls first`.execute(this.db)).rows;
    const total = N(tot.n); const pg = clampPage(pr, total);
    const rows = (await sql<any>`${x} select * from x order by paid_at desc, ticket_id desc limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    const st = (v: unknown): TipsPayoutState => (v === 'paid' || v === 'approved' || v === 'open' ? v : 'none');
    const allocated = N(tot.allocated), paid = N(tot.paid);
    return {
      technician: { id: String(tech.id), name: tech.full_name ?? null, active: tech.status !== 'archived' },
      totals: { allocatedCents: allocated, paidCents: paid, approvedCents: N(tot.approved), openCents: N(tot.open), unscheduledCents: N(tot.unscheduled), pendingCents: allocated - paid, tickets: total,
        manualCorrectionCents: N(corr.manual), reversedCents: N(corr.reversed), netCents: allocated + N(corr.manual) + N(corr.reversed) },
      periods: per.map((r: any) => ({ id: r.period_id ? String(r.period_id) : null, label: r.label ?? null, state: st(r.state), allocatedCents: N(r.allocated), tickets: N(r.tickets), paidAt: iso(r.paid_at) })),
      items: rows.map((r: any) => ({ ticketId: String(r.ticket_id), ticketNumber: r.ticket_number ?? null, collectedAt: iso(r.paid_at), ticketTipCents: N(r.tip_cents), allocatedCents: N(r.alloc), sharedWith: Math.max(0, N(r.alloc_techs) - 1),
        payoutState: st(r.payout_state), period: r.period_id ? { id: String(r.period_id), label: r.period_label ?? null, paidAt: iso(r.period_paid_at) } : null,
        method: (['card', 'cash', 'split', 'none'].includes(String(r.method)) ? String(r.method) : 'none') as 'card' | 'cash' | 'split' | 'none',
        allocationBasis: allocationBasis(r.alloc_sources, N(r.alloc_techs)), corrected: N(r.manual_cents) !== 0 })),
      total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount,
    };
  }

  /** Team Tips (Nov 13 2026) — the One-Click Tip Accuracy check. READ-ONLY: every figure is a SELECT over the same scope and
   *  date basis as the KPIs (tenant + location, period, basis); nothing is written, corrected, allocated or paid. Each check
   *  names how many tickets it concerns, their cents where money is involved, and up to five ticket ids to open. */
  async accuracy(ctx: FinanceCtx, f: TipFilters): Promise<Omit<TipsAccuracyResponse, 'period' | 'dateBasis'>> {
    const T = ctx.tenantId;
    const w = this.where({ ...f, q: '', status: undefined, method: undefined, minCents: undefined, maxCents: undefined, technicianId: undefined });
    const a = sql`(select ${TipsScreenRepository.ROW_COLS} from (${this.base(ctx, f.period.tz)}) a where ${w})`;
    const first = sql`(select min(p.created_at) from payments p where p.tenant_id = a.tenant_id and p.ticket_id = a.id and p.status in (${sql.join(SETTLED)}))`;
    type Agg = { n: number; cents: number | string | null; ids: string[] | null };
    const agg = async (cond: RawBuilder<boolean>, cents: RawBuilder<unknown>): Promise<Agg> => (await sql<Agg>`select count(*)::int as n, coalesce(sum(${cents}), 0)::bigint as cents,
        (array_agg(a.id::text order by a.paid_at desc, a.id desc))[1:5] as ids from ${a} a where ${cond}`.execute(this.db)).rows[0] ?? { n: 0, cents: 0, ids: [] };
    const tot = (await sql<any>`select coalesce(sum(a.tip_cents), 0)::bigint as collected, coalesce(sum(least(a.alloc_cents, a.tip_cents)), 0)::bigint as allocated_capped, coalesce(sum(a.alloc_cents), 0)::bigint as allocated,
        coalesce(sum(greatest(0, a.tip_cents - a.alloc_cents)), 0)::bigint as unallocated, count(*) filter (where a.tip_cents > 0)::int as tipped from ${a} a`.execute(this.db)).rows[0] ?? {};
    const techSum = N((await sql<any>`select coalesce(sum(al.tip_cents), 0)::bigint as s from ticket_tip_allocations al join ${a} a on a.id = al.ticket_id where al.tenant_id = ${T} and al.tip_cents > 0`.execute(this.db)).rows[0]?.s);
    const inPeriodFirst = f.period.from && f.period.to ? tsInPeriod(first, f.period) : sql<boolean>`true`;
    const [coverage, drift, periodGap, partial, over, mismatch, unsettled] = await Promise.all([
      agg(sql<boolean>`a.tip_cents > 0 and a.tenders = 0`, sql`a.tip_cents`),
      agg(sql<boolean>`a.card_pay + a.cash_pay > 0 and a.card_pay + a.cash_pay <> a.tip_cents`, sql`abs(a.card_pay + a.cash_pay - a.tip_cents)`),
      agg(sql<boolean>`a.tip_cents > 0 and a.tenders > 0 and not ${inPeriodFirst}`, sql`a.tip_cents`),
      agg(sql<boolean>`a.tip_cents > 0 and a.alloc_cents < a.tip_cents`, sql`a.tip_cents - a.alloc_cents`),
      agg(sql<boolean>`a.alloc_cents > a.tip_cents`, sql`a.alloc_cents - a.tip_cents`),
      agg(sql<boolean>`a.snap_cents is not null and a.snap_cents <> a.tip_cents`, sql`abs(a.snap_cents - a.tip_cents)`),
      agg(sql<boolean>`exists (select 1 from payments p where p.tenant_id = a.tenant_id and p.ticket_id = a.id and coalesce(p.tip_cents, 0) > 0 and p.status not in (${sql.join(SETTLED)}) and p.status not in ('refunded', 'refund', 'voided', 'void', 'reversed'))`, sql`0`),
    ]);
    const dup = (await sql<{ n: number; ids: string[] | null }>`select count(*)::int as n, (array_agg(x.ticket_id order by x.ticket_id))[1:5] as ids from (
        select min(p.ticket_id::text) as ticket_id from payments p join ${a} a on a.id = p.ticket_id where p.tenant_id = ${T} and p.processor_transaction_id is not null and p.status in (${sql.join(SETTLED)})
        group by p.processor_transaction_id having count(*) > 1) x`.execute(this.db)).rows[0] ?? { n: 0, ids: [] };
    const mk = (key: TipsAccuracyCheck['key'], v: Agg, bad: 'warn' | 'fail', money = true): TipsAccuracyCheck =>
      ({ key, status: N(v.n) > 0 ? bad : 'ok', count: N(v.n), cents: money ? N(v.cents) : null, samples: (v.ids ?? []).map(String) });
    const collected = N(tot.collected), allocated = N(tot.allocated), unallocated = N(tot.unallocated);
    const checks: TipsAccuracyCheck[] = [
      mk('source_coverage', coverage, 'warn'),
      mk('payment_tip_drift', drift, 'warn'),
      mk('period_match', periodGap, 'warn'),
      { ...mk('allocation_reconciliation', partial, 'warn'), status: N(tot.allocated_capped) + unallocated !== collected || techSum !== allocated ? 'fail' : N(partial.n) > 0 ? 'warn' : 'ok' },
      mk('over_allocated', over, 'fail'),
      mk('snapshot_mismatch', mismatch, 'warn'),
      { key: 'duplicate_provider_reference', status: N(dup.n) > 0 ? 'fail' : 'ok', count: N(dup.n), cents: null, samples: (dup.ids ?? []).map(String) },
      // informational: tips on payments that were never collected (declined / pending / failed) are EXCLUDED from every figure
      { ...mk('unsettled_tip', unsettled, 'warn', false), status: 'ok' },
    ];
    const overall = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
    return { checks, overall, totals: { collectedCents: collected, allocatedCents: allocated, unallocatedCents: unallocated, technicianSumCents: techSum, tippedTickets: N(tot.tipped) }, asOf: new Date().toISOString(), readOnly: true };
  }

  /** The technicians who have tip allocations (the filter list). */
  async technicians(ctx: FinanceCtx): Promise<{ id: string; name: string }[]> {
    const rows = (await sql<any>`select distinct tc.id, tc.full_name from technicians tc where tc.tenant_id = ${ctx.tenantId} and tc.archived_at is null
      and (exists (select 1 from ticket_tip_allocations x where x.tenant_id = tc.tenant_id and x.technician_id = tc.id) or exists (select 1 from tickets t where t.tenant_id = tc.tenant_id and t.primary_technician_id = tc.id and t.status = 'paid'))
      order by tc.full_name`.execute(this.db)).rows;
    return rows.map((r: any) => ({ id: String(r.id), name: String(r.full_name ?? '') }));
  }

  /** One tip event in full: the ticket, its payments' tip parts, each technician's allocation against the frozen snapshot
   *  and the corrections, the payout state, every adjustment and the audit trail. */
  async detail(ctx: FinanceCtx, ticketId: string) {
    if (!isUuid(ticketId)) throw new FinanceError('That tip record could not be found.', 'TIP_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const tz = await this.zone(ctx);
    const r = (await sql<any>`select ${TipsScreenRepository.ROW_COLS}, 0 as rank from (${this.base(ctx, tz)}) a where a.id = ${ticketId}::uuid`.execute(this.db)).rows[0];
    if (!r) throw new FinanceError('That tip record could not be found.', 'TIP_NOT_FOUND', 404);
    const tip = this.row(ctx, r);
    const payments = (await sql<any>`select p.id, p.method, p.amount_cents, coalesce(p.tip_cents, 0) as tip_cents, p.status, p.processor_transaction_id, p.payment_surface, p.device_id, p.created_at
      from payments p where p.tenant_id = ${T} and p.ticket_id = ${ticketId}::uuid order by p.created_at, p.id`.execute(this.db)).rows;
    const allocs = (await sql<any>`select x.technician_id, x.tip_cents, x.created_at, tc.full_name from ticket_tip_allocations x left join technicians tc on tc.id = x.technician_id and tc.tenant_id = x.tenant_id
      where x.tenant_id = ${T} and x.ticket_id = ${ticketId}::uuid order by x.tip_cents desc`.execute(this.db)).rows;
    const snaps = (await sql<any>`select s.technician_id, sum(coalesce(s.card_tip_cents, 0))::bigint as card, sum(coalesce(s.cash_tip_cents, 0))::bigint as cash, count(*)::int as rows, min(s.snapshot_at) as at
      from ticket_compensation_snapshots s where s.tenant_id = ${T} and s.ticket_id = ${ticketId}::uuid group by s.technician_id`.execute(this.db)).rows;
    const adj = (await sql<any>`select j.id, j.technician_id, tc.full_name as tech_name, j.amount_cents, j.reason, j.status, j.source, j.created_at, j.refund_payment_id, coalesce(u.full_name, u.email) as actor
      from compensation_adjustments j left join technicians tc on tc.id = j.technician_id and tc.tenant_id = j.tenant_id left join users u on u.id = coalesce(j.approved_by, j.requested_by)
      where j.tenant_id = ${T} and j.ticket_id = ${ticketId}::uuid and j.category = 'tip_correction' order by j.created_at desc, j.id desc`.execute(this.db)).rows;
    const auditRows = (await sql<any>`select a.action_type, a.created_at, a.role, coalesce(u.full_name, u.email) as actor, a.metadata_json from audit_logs a left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.entity_id = ${ticketId} and (a.action_type like '%tip%' or a.action_type like '%refund%' or a.action_type like '%void%') order by a.created_at desc limit 20`.execute(this.db)).rows;
    const snapBy = new Map<string, any>(snaps.map((s: any) => [String(s.technician_id ?? ''), s]));
    const corrBy = new Map<string, { manual: number; reversed: number }>();
    for (const j of adj) { if (!POSTED.includes(String(j.status))) continue; const k = String(j.technician_id ?? ''); const c = corrBy.get(k) ?? { manual: 0, reversed: 0 }; if (j.source === 'manual') c.manual += N(j.amount_cents); else c.reversed += N(j.amount_cents); corrBy.set(k, c); }
    const techIds = new Set<string>([...allocs.map((a: any) => String(a.technician_id)), ...snaps.map((s: any) => String(s.technician_id ?? '')).filter(Boolean)]);
    const names = new Map<string, string>(allocs.map((a: any) => [String(a.technician_id), a.full_name]));
    const missing = [...techIds].filter((id) => !names.has(id));
    if (missing.length) for (const n of (await sql<any>`select id, full_name from technicians where tenant_id = ${T} and id = any(${missing}::uuid[])`.execute(this.db)).rows) names.set(String(n.id), n.full_name);
    const allocations = [...techIds].map((id) => {
      const a = allocs.find((x: any) => String(x.technician_id) === id); const s = snapBy.get(id); const c = corrBy.get(id) ?? { manual: 0, reversed: 0 };
      const snapshot = s ? N(s.card) + N(s.cash) : null;
      return { technicianId: id, name: names.get(id) ?? null, allocatedCents: a ? N(a.tip_cents) : 0, allocatedAt: a ? iso(a.created_at) : null,
        snapshotCents: snapshot, snapshotRows: s ? N(s.rows) : 0, snapshotMismatch: a != null && snapshot != null && snapshot !== N(a.tip_cents),
        manualCorrectionCents: c.manual, reversedCents: c.reversed, netCents: (snapshot ?? (a ? N(a.tip_cents) : 0)) + c.manual + c.reversed };
    }).sort((x, y) => y.allocatedCents - x.allocatedCents);
    const splitRule = allocs.length === 0 ? 'none' : allocs.length === 1 ? 'single' : allocations.every((x) => x.allocatedCents === allocations[0].allocatedCents) ? 'equal' : 'weighted_or_directed';
    return {
      tip, payments: payments.map((p: any) => ({ id: String(p.id), method: String(p.method), amountCents: N(p.amount_cents), tipCents: N(p.tip_cents), status: String(p.status), processorRef: p.processor_transaction_id ?? null, surface: p.payment_surface ?? null, deviceId: p.device_id ?? null, at: iso(p.created_at) })),
      allocations, splitRule, unallocatedCents: Math.max(0, tip.amountCents - allocations.reduce((s, x) => s + x.allocatedCents, 0)),
      adjustments: adj.map((j: any) => ({ id: String(j.id), technicianId: j.technician_id ? String(j.technician_id) : null, technician: j.tech_name ?? null, amountCents: N(j.amount_cents), reason: j.reason ?? null, status: String(j.status), source: String(j.source ?? ''), kind: j.source === 'manual' ? 'correction' : 'reversal', refundPaymentId: j.refund_payment_id ? String(j.refund_payment_id) : null, at: iso(j.created_at), actor: j.actor ?? null })),
      audit: auditRows.map((a: any) => ({ action: String(a.action_type), at: iso(a.created_at), actor: a.actor ?? a.role ?? null })),
      permissions: { adjust: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'tips.adjust'), customer: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view') },
    };
  }

  /** The Adjustments view: every tip correction / reversal in the period (by its own date), paged. */
  async adjustments(ctx: FinanceCtx, period: Period, q: { kind?: string; search?: string }, pr: PageReq) {
    const T = ctx.tenantId; const scope = ctx.branchId && isUuid(ctx.branchId) ? sql<boolean>`(j.branch_id = ${ctx.branchId}::uuid or j.branch_id is null)` : sql<boolean>`true`;
    const kind = q.kind === 'correction' ? sql<boolean>`j.source = 'manual'` : q.kind === 'reversal' ? sql<boolean>`j.source <> 'manual'` : sql<boolean>`true`;
    const s = (q.search ?? '').trim().toLowerCase();
    const srch = s ? sql<boolean>`(lower(coalesce(tc.full_name, '')) like ${likeOf(s)} or t.ticket_number = ${s.replace(/^#/, '')} or lower(coalesce(j.reason, '')) like ${likeOf(s)})` : sql<boolean>`true`;
    const w = sql<boolean>`j.tenant_id = ${T} and j.category = 'tip_correction' and ${scope} and ${kind} and ${srch} and ${tsInPeriod(sql`j.created_at`, period)}`;
    const total = N((await sql<any>`select count(*)::int as n from compensation_adjustments j left join technicians tc on tc.id = j.technician_id and tc.tenant_id = j.tenant_id left join tickets t on t.id = j.ticket_id and t.tenant_id = j.tenant_id where ${w}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const rows = (await sql<any>`select j.id, j.ticket_id, t.ticket_number, j.technician_id, tc.full_name as tech_name, j.amount_cents, j.reason, j.status, j.source, j.created_at, j.refund_payment_id, coalesce(u.full_name, u.email) as actor
      from compensation_adjustments j left join technicians tc on tc.id = j.technician_id and tc.tenant_id = j.tenant_id left join tickets t on t.id = j.ticket_id and t.tenant_id = j.tenant_id left join users u on u.id = coalesce(j.approved_by, j.requested_by)
      where ${w} order by j.created_at desc, j.id desc limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((j: any) => ({ id: String(j.id), ticketId: j.ticket_id ? String(j.ticket_id) : null, ticketNumber: j.ticket_number ?? null, technicianId: j.technician_id ? String(j.technician_id) : null, technician: j.tech_name ?? null,
      amountCents: N(j.amount_cents), reason: j.reason ?? null, status: String(j.status), source: String(j.source ?? ''), kind: j.source === 'manual' ? 'correction' : 'reversal', refundPaymentId: j.refund_payment_id ? String(j.refund_payment_id) : null, at: iso(j.created_at), actor: j.actor ?? null })),
      total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount, period };
  }

  /** CSV of every matching tip event (all pages) — masked customer contact, no card data; audited. */
  async exportCsv(ctx: FinanceCtx, f: TipFilters): Promise<string> {
    const w = this.where(f, ctx);
    const rows = (await sql<any>`select ${TipsScreenRepository.ROW_COLS}, 0 as rank from (${this.base(ctx, f.period.tz)}) a where ${w} order by a.paid_at desc, a.id desc limit 20000`.execute(this.db)).rows.map((r: any) => this.row({ ...ctx, permissions: ctx.permissions.filter((p) => p !== 'pos.customers.view') }, r));
    const sum = await this.summary(ctx, f);
    const doc = csvDocument('Tips', [['Generated', new Date().toISOString()], ['Period', f.period.from ? `${f.period.from} to ${f.period.to} (${f.basis} date, ${f.period.tz})` : 'All time'], ['Search', f.q || '—'], ['Status', f.status ?? 'all'], ['Currency', 'USD'], ['Contact', 'masked']],
      ['Collected', 'Ticket', 'Customer', 'Technicians', 'Method', 'Tip', 'Card tip', 'Cash tip', 'Cash source', 'Allocated', 'Allocation', 'Reversed', 'Payout', 'Payment refs'],
      rows.map((x) => [x.collectedAt ?? '', x.ticketNumber ?? '', x.customer?.name ?? '', x.technicians.map((t) => t.name).join(' / '), x.method, usd(x.amountCents), usd(x.cardCents), usd(x.cashCents), x.cashSource ?? '', usd(x.allocatedCents), x.allocationState, usd(x.reversedCents), x.payout.state, x.paymentRefs.join(' ')]),
      [['Tip events', String(rows.length)], ['Tips of these rows', usd(rows.reduce((a, x) => a + x.amountCents, 0))], ['Total tips (period)', usd(sum.kpis.totalTipsCents)], ['Allocated (period)', usd(sum.reconciliation.allocatedCents)]]);
    await audit(this.auditor, ctx, 'tips', 'tips_exported', 'ticket', null, { rows: rows.length, status: f.status ?? 'all', search: f.q ? 'yes' : 'no' }, (e) => this.log.warn(`tips export audit failed: ${(e as Error).message}`));
    return doc;
  }
}
