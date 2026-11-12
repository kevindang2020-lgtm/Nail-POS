// money-overview-screen.repository.ts — Payments & Money mandate (Oct 29 2026): the read model behind POS Payments & Money →
// Overview (/tenant/payments/overview). Raw SQL, tenant + location scoped; every figure says its scope and date field.
// The old /pos/payments/overview (kept for the dashboard tile) mixed windows and grains, which is why the photo showed
// Revenue / Collections $116.43 beside three tenders summing $168.15: it summed only status 'approved', so the split's
// 'partial' $51.72 tender — confirmed money — was dropped; "today" and the trend were UTC days; Collections was Revenue;
// Average divided by tenders; Total Transactions counted every attempt of 7 days; Top Services was all-time over every line
// (removed ones too); Health was a count ratio shown as "100 % Excellent"; Outstanding read ticket statuses never written;
// a read error became $0. Here:
//   PERIOD (the chosen preset / custom range, salon time zone, start-inclusive · day-after-end-exclusive):
//   • REVENUE        — services & products sold on tickets PAID in the period: Σ (subtotal − discount). Tax, tips and the
//                      tender split are not revenue; a partly paid ticket becomes revenue when it is paid;
//   • COLLECTIONS    — Σ confirmed tender amounts by payment date (= the Transactions screen's Gross, tips included);
//                      the gift-card part is shown (stored value redeemed, not new money);
//   • REFUNDS ISSUED — completed refunds by refund date; pending ones are shown apart, never added;
//   • TRANSACTIONS   — confirmed tenders (= the Transactions screen's count); FAILED — declined / failed attempts, with
//                      unresolved (pending, stranded) attempts labelled separately, never called failed;
//   • AVERAGE TICKET — Revenue ÷ tickets paid in the period (never ÷ tenders);
//   AS OF NOW (point-in-time, never summed over days):
//   • OUTSTANDING    — what is still owed: partly paid tickets (total − confirmed tenders) + sent / partially paid
//                      invoices (total − recorded invoice payments). Gift-card liability and settlements are not in it;
//   • PENDING PAYOUTS — processor settlements not yet paid out (pending / scheduled / in transit / processing) — expected
//                      money, never "in the bank";
//   ALL TIME (the six secondary totals): the same definitions with no date bound; Total Payouts = processor payouts
//   settled / deposited (staff payroll payouts are a different ledger and never mixed in).
import { TICKET_NET_SALES_T, openTicketDues } from './ticket-money';
import { Logger } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';
import {
  type FinanceCtx, type Period, type PageReq, type Paged, FinanceError, resolvePeriod, salonTimeZone, tsInPeriod, clampPage, isUuid, N, iso, likeOf, digitsOf, daysBetween,
} from './finance-scope';
import { methodKey } from './split-payments-screen.repository';
import { TransactionsScreenRepository } from './transactions-screen.repository';
import { FUNDING_DAYS } from './recon-workspace.repository';

const CONFIRMED = [...new Set([...REVENUE_BEARING_STATUSES, 'completed', 'succeeded', 'settled', 'partially_refunded'])];
const FAILED = ['declined', 'failed', 'error', 'rejected'];
const UNRESOLVED_EXCLUDE = [...CONFIRMED, ...FAILED, 'refunded', 'refund', 'reversed', 'voided', 'void', 'canceled', 'cancelled', 'expired', 'timeout'];
const PENDING_PAYOUT = ['pending', 'scheduled', 'in_transit', 'processing', 'queued', 'sent'];
const PAID_PAYOUT = ['paid', 'deposited', 'settled', 'completed', 'complete', 'posted'];
const OPEN_INVOICE = ['sent', 'partially_paid', 'open', 'past_due', 'pending'];
export const MONEY_DEFINITIONS = {
  revenueBridge: 'Revenue + tax + tips on the tickets paid in the period, the difference collected on those tickets, minus what was collected for them on another day, plus what was collected in the period for other tickets (open, paid in another period, or none) = Collections.',
  revenue: 'Services and products sold on tickets paid in the period (subtotal minus discounts). Tax and tips are not revenue; a partly paid ticket counts when it is paid.',
  collections: 'Confirmed payment tenders by payment date — the same as Gross on Transactions (tips included). Gift-card redemptions are shown inside it.',
  refunds: 'Completed refunds by the date they completed. Pending refunds are shown separately.',
  outstanding: 'As of now: the balance still owed on partly paid tickets plus sent or partially paid invoices. Not gift-card balances, not settlements.',
  transactions: 'Confirmed payment tenders in the period — the same count as Transactions. A split ticket counts each tender.',
  averageTicket: 'Revenue divided by the tickets paid in the period (never by tenders).',
  failed: 'Declined or failed payment attempts in the period. Attempts still unresolved with the processor are shown separately.',
  pendingPayouts: 'As of now: processor settlements not yet paid out. Expected money — not a bank deposit.',
  totals: 'All time, same definitions. Total payouts are processor payouts that settled or were deposited (staff payroll is a separate ledger).',
  topServices: 'Service and product lines on tickets paid in the period, removed lines excluded; once per line, never per tender or technician.',
  paymentMethods: 'Confirmed tender amounts by method in the period. Terminal and Tap to Pay are capture channels of Card.',
  health: 'Success rate = confirmed ÷ (confirmed + failed) attempts; refund rate = completed refunds ÷ collections; collection rate = collections ÷ (collections + outstanding).',
} as const;

export class MoneyOverviewScreenRepository {
  private readonly log = new Logger('MoneyOverviewScreen');
  private readonly tx: TransactionsScreenRepository;
  constructor(private readonly db: Kysely<any>) { this.tx = new TransactionsScreenRepository(db, null); }

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'today', allowAll: true });
  }
  /** this location (rows with no location belong to the salon as a whole), or the whole salon */
  private pScope(ctx: FinanceCtx, col: RawBuilder<unknown>): RawBuilder<boolean> {
    return ctx.branchId && isUuid(ctx.branchId) ? sql<boolean>`(${col} = ${ctx.branchId}::uuid or ${col} is null)` : sql<boolean>`true`;
  }

  /** Revenue (period or all time): tickets PAID in the window, Σ net sales (live lines − discount — subtotal_cents is already
   *  net of the discount and skip-line never writes it; see ticket-money.ts), and how many. */
  private async revenue(ctx: FinanceCtx, p: Period | null) {
    const r = (await sql<any>`select coalesce(sum(${TICKET_NET_SALES_T}), 0)::bigint as revenue, count(*)::int as tickets,
        coalesce(sum(coalesce(t.tip_cents, 0)), 0)::bigint as tips
      from tickets t where t.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`t.branch_id`)} and t.status = 'paid' and t.paid_at is not null and t.removed_at is null
        and ${p ? tsInPeriod(sql`t.paid_at`, p) : sql<boolean>`true`}`.execute(this.db)).rows[0] ?? {};
    return { revenueCents: N(r.revenue), paidTickets: N(r.tickets), tipsCents: N(r.tips) };
  }
  private async collections(ctx: FinanceCtx, p: Period | null) {
    const r = (await sql<any>`select count(*)::int as n, coalesce(sum(p.amount_cents), 0)::bigint as cents,
        coalesce(sum(p.amount_cents) filter (where p.method in ('gift_card', 'gift')), 0)::bigint as gift
      from payments p where p.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`p.branch_id`)} and p.status in (${sql.join(CONFIRMED)})
        and ${p ? tsInPeriod(sql`coalesce(p.approved_at, p.created_at)`, p) : sql<boolean>`true`}`.execute(this.db)).rows[0] ?? {};
    return { transactions: N(r.n), collectionsCents: N(r.cents), giftCardCents: N(r.gift) };
  }
  /** PAYMENTS 05 (Nov 12 2026): Revenue vs Collections explainer — an exact bridge from earned Revenue to collected tenders
   *  for the period, from the same rows as the two KPIs (nothing estimated):
   *    Revenue + tax + tips on the tickets paid in the period          = expected for those tickets
   *    collected on those tickets (any day) − expected                  = other charges / difference on them
   *    − collected for those tickets on another day (outside the period)
   *    + collected in the period for other tickets (still open, paid in another period, or with no ticket)
   *    = Collections.   Refunds are not in either figure (they are their own KPI). */
  private async bridge(ctx: FinanceCtx, p: Period, revenueCents: number, collectionsCents: number) {
    const paidIn = sql<boolean>`t.status = 'paid' and t.paid_at is not null and t.removed_at is null and ${tsInPeriod(sql`t.paid_at`, p)}`;
    const tk = (await sql<any>`select coalesce(sum(coalesce(t.tax_cents, 0)), 0)::bigint as tax, coalesce(sum(coalesce(t.tip_cents, 0)), 0)::bigint as tips
      from tickets t where t.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`t.branch_id`)} and ${paidIn}`.execute(this.db)).rows[0] ?? {};
    const inP = tsInPeriod(sql`coalesce(p.approved_at, p.created_at)`, p);
    const pm = (await sql<any>`select coalesce(sum(p.amount_cents) filter (where x.id is not null), 0)::bigint as on_paid,
        coalesce(sum(p.amount_cents) filter (where x.id is not null and not ${inP}), 0)::bigint as other_days,
        coalesce(sum(p.amount_cents) filter (where x.id is null and ${inP}), 0)::bigint as other_tickets,
        count(distinct coalesce(p.ticket_id::text, p.id::text)) filter (where x.id is null and ${inP})::int as other_n
      from payments p left join lateral (select t.id from tickets t where t.tenant_id = p.tenant_id and t.id = p.ticket_id and ${this.pScope(ctx, sql`t.branch_id`)} and ${paidIn}) x on true
      where p.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`p.branch_id`)} and p.status in (${sql.join(CONFIRMED)}) and (x.id is not null or ${inP})`.execute(this.db)).rows[0] ?? {};
    const expected = revenueCents + N(tk.tax) + N(tk.tips);
    const onPaid = N(pm.on_paid), otherDays = N(pm.other_days), otherTickets = N(pm.other_tickets);
    return { revenueCents, taxCents: N(tk.tax), tipsCents: N(tk.tips), expectedCents: expected, collectedOnPaidTicketsCents: onPaid, otherDifferenceCents: onPaid - expected,
      collectedOtherDaysCents: otherDays, collectedForOtherTicketsCents: otherTickets, otherTicketsCount: N(pm.other_n), collectionsCents,
      balanced: onPaid - otherDays + otherTickets === collectionsCents };
  }
  private async refunds(ctx: FinanceCtx, p: Period | null) {
    const r = (await sql<any>`select coalesce(sum(r.amount_cents) filter (where r.status = 'refunded'), 0)::bigint as done, count(*) filter (where r.status = 'refunded')::int as done_n,
        coalesce(sum(r.amount_cents) filter (where r.status in ('reserved', 'pending', 'processing')), 0)::bigint as pending, count(*) filter (where r.status in ('reserved', 'pending', 'processing'))::int as pending_n
      from payment_refunds r where r.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`r.branch_id`)}
        and ${p ? tsInPeriod(sql`(case when r.status = 'refunded' then coalesce(r.settled_at, r.created_at) else r.created_at end)`, p) : sql<boolean>`true`}`.execute(this.db)).rows[0] ?? {};
    return { refundsCents: N(r.done), refundsCount: N(r.done_n), pendingRefundsCents: N(r.pending), pendingRefunds: N(r.pending_n) };
  }
  /** As of now: partly paid tickets + open invoices. */
  private async outstanding(ctx: FinanceCtx) {
    // the amount still due on a partly paid ticket is computed exactly (ticket-money.ts) — total_cents / locked_total_cents
    // are not the ticket's total before it is paid
    const dues = await openTicketDues(this.db, ctx.tenantId, CONFIRMED, ctx.branchId && isUuid(ctx.branchId) ? ctx.branchId : null);
    const dv = [...dues.values()];
    const t = { due: dv.reduce((a, d) => a + d.dueCents, 0), n: dv.filter((d) => d.dueCents > 0).length };
    const i = (await sql<any>`select coalesce(sum(greatest(0, i.total_cents - coalesce(ip.paid, 0))), 0)::bigint as due, count(*)::int as n from invoices i
        left join lateral (select sum(x.amount_cents) as paid from invoice_payments x where x.tenant_id = i.tenant_id and x.invoice_id = i.id) ip on true
       where i.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`i.branch_id`)} and i.status in (${sql.join(OPEN_INVOICE)}) and i.voided_at is null`.execute(this.db)).rows[0] ?? {};
    return { outstandingCents: N(t.due) + N(i.due), ticketsDue: N(t.n), ticketsDueCents: N(t.due), invoicesDue: N(i.n), invoicesDueCents: N(i.due) };
  }
  private async payouts(ctx: FinanceCtx) {
    const r = (await sql<any>`select coalesce(sum(coalesce(s.net_cents, s.gross_cents)) filter (where lower(coalesce(s.status, '')) in (${sql.join(PENDING_PAYOUT)})), 0)::bigint as pending,
        count(*) filter (where lower(coalesce(s.status, '')) in (${sql.join(PENDING_PAYOUT)}))::int as pending_n,
        coalesce(sum(coalesce(s.net_cents, s.gross_cents)) filter (where lower(coalesce(s.status, '')) in (${sql.join(PAID_PAYOUT)})), 0)::bigint as paid,
        max(s.created_at) as latest
      from payment_settlements s where s.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`s.branch_id`)}`.execute(this.db)).rows[0] ?? {};
    return { pendingPayoutsCents: N(r.pending), pendingPayouts: N(r.pending_n), totalPayoutsCents: N(r.paid), latestSettlementAt: iso(r.latest) };
  }
  private async attempts(ctx: FinanceCtx, p: Period) {
    const r = (await sql<any>`select count(*) filter (where p.status in (${sql.join(CONFIRMED)}))::int as ok, count(*) filter (where p.status in (${sql.join(FAILED)}))::int as failed,
        count(*) filter (where p.status not in (${sql.join(UNRESOLVED_EXCLUDE)}) or p.stranded_at is not null)::int as unresolved, max(p.created_at) as latest
      from payments p where p.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`p.branch_id`)} and p.amount_cents > 0 and ${tsInPeriod(sql`p.created_at`, p)}`.execute(this.db)).rows[0] ?? {};
    const cb = (await sql<any>`select count(*)::int as n, coalesce(sum(c.amount_cents), 0)::bigint as cents from chargebacks c
       where c.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`c.branch_id`)} and ${tsInPeriod(sql`coalesce(c.opened_at, c.created_at)`, p)}`.execute(this.db)).rows[0] ?? {};
    return { successful: N(r.ok), failed: N(r.failed), unresolved: N(r.unresolved), chargebacks: N(cb.n), chargebackCents: N(cb.cents), latestPaymentAt: iso(r.latest) };
  }

  /** extras Payments & Money 12 — Payout Forecast: the processor payouts still pending, by expected arrival date and
   *  processor, each date labelled with its source: 'processor' = the processor's own expected deposit date; 'estimated' =
   *  settlement date + FUNDING_DAYS (the same estimate Deposit Reconciliation uses). A date before the salon's today is
   *  'late' — never shown as arrived: only a recorded bank deposit is. Read-only. */
  async payoutForecast(ctx: FinanceCtx, p: Period) {
    const rows = (await sql<{ d: string | null; processor: string | null; sourced: boolean; n: number; cents: number | string }>`
      select to_char(coalesce(s.expected_deposit_date, ((coalesce(s.settled_at, s.created_at) at time zone ${p.tz})::date + ${FUNDING_DAYS}::int)), 'YYYY-MM-DD') as d,
             s.processor_type as processor, (s.expected_deposit_date is not null) as sourced, count(*)::int as n, coalesce(sum(coalesce(s.net_cents, s.gross_cents)), 0)::bigint as cents
        from payment_settlements s
       where s.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`s.branch_id`)} and lower(coalesce(s.status, '')) in (${sql.join(PENDING_PAYOUT)}) and s.actual_deposit_date is null
       group by 1, 2, 3 order by 1 asc, 2 asc nulls last, 3 desc limit 60`.execute(this.db)).rows;
    const items = rows.map((r) => ({ expectedDate: r.d, processor: r.processor ?? null, source: r.sourced ? 'processor' as const : 'estimated' as const,
      payouts: N(r.n), netCents: N(r.cents), late: r.d != null && r.d < p.today }));
    return { today: p.today, fundingDays: FUNDING_DAYS, items, totalCents: items.reduce((a, x) => a + x.netCents, 0) };
  }

  /** The Overview: KPIs (period / as of now), the four analytics panels, recent activity, payouts, all-time totals. */
  async overview(ctx: FinanceCtx, p: Period) {
    const [rev, col, rf, out, pay, att, allRev, allCol, allRf] = await Promise.all([
      this.revenue(ctx, p), this.collections(ctx, p), this.refunds(ctx, p), this.outstanding(ctx), this.payouts(ctx), this.attempts(ctx, p),
      this.revenue(ctx, null), this.collections(ctx, null), this.refunds(ctx, null),
    ]);
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const successRate = pct(att.successful, att.successful + att.failed);
    const refundRate = pct(rf.refundsCents, col.collectionsCents);
    const collectionRate = pct(col.collectionsCents, col.collectionsCents + out.outstandingCents);
    const reasons: string[] = [];
    if (att.failed > 0) reasons.push('failed_payments'); if (att.unresolved > 0) reasons.push('unresolved_payments'); if (att.chargebacks > 0) reasons.push('chargebacks');
    if (rf.pendingRefunds > 0) reasons.push('pending_refunds');
    const status = att.successful + att.failed + att.unresolved === 0 ? 'no_activity' : reasons.length ? 'attention' : 'healthy';
    const [revenueBridge, trend, methods, services, recent, upcoming, payoutForecast] = await Promise.all([this.bridge(ctx, p, rev.revenueCents, col.collectionsCents), this.trend(ctx, p), this.methods(ctx, p), this.services(ctx, p, { page: 1, pageSize: 5 }), this.recent(ctx, p), this.payoutList(ctx, { page: 1, pageSize: 4 }), this.payoutForecast(ctx, p)]);
    return {
      period: p, scope: ctx.branchId && isUuid(ctx.branchId) ? 'location' : 'salon', generatedAt: new Date().toISOString(),
      kpis: {
        revenueCents: rev.revenueCents, collectionsCents: col.collectionsCents, giftCardCollectionsCents: col.giftCardCents, refundsIssuedCents: rf.refundsCents, pendingRefundsCents: rf.pendingRefundsCents,
        outstandingBalanceCents: out.outstandingCents, totalTransactions: col.transactions, averageTicketCents: rev.paidTickets ? Math.round(rev.revenueCents / rev.paidTickets) : 0, paidTickets: rev.paidTickets,
        failedTransactions: att.failed, unresolvedTransactions: att.unresolved, pendingPayoutsCents: pay.pendingPayoutsCents, pendingPayouts: pay.pendingPayouts,
      },
      outstanding: out, revenueBridge,
      totals: { totalRevenueCents: allRev.revenueCents, totalCollectedCents: allCol.collectionsCents, totalRefundsCents: allRf.refundsCents, outstandingBalanceCents: out.outstandingCents, totalTipsCents: allRev.tipsCents, totalPayoutsCents: pay.totalPayoutsCents },
      revenueTrend: trend, paymentMethods: methods, topServices: services,
      health: { status, reasons, successful: att.successful, failed: att.failed, unresolved: att.unresolved, chargebacks: att.chargebacks, chargebackCents: att.chargebackCents,
        successRatePercent: successRate, refundRatePercent: refundRate, collectionRatePercent: collectionRate, latestPaymentAt: att.latestPaymentAt, latestSettlementAt: pay.latestSettlementAt },
      recentTransactions: recent, upcomingPayouts: upcoming, payoutForecast,
      definitions: MONEY_DEFINITIONS,
    };
  }

  /** Revenue and collections per bucket: days up to 62 days, weeks up to ~1 year, else months; every bucket in range. */
  async trend(ctx: FinanceCtx, p: Period) {
    let from = p.from, to = p.to;
    if (!from || !to) {   // all time: from the first paid ticket / tender, by month
      const r = (await sql<any>`select to_char(min(x.at) at time zone ${p.tz}, 'YYYY-MM-DD') as first from (select min(t.paid_at) as at from tickets t where t.tenant_id = ${ctx.tenantId} and t.paid_at is not null
         union all select min(coalesce(pp.approved_at, pp.created_at)) from payments pp where pp.tenant_id = ${ctx.tenantId} and pp.status in (${sql.join(CONFIRMED)})) x`.execute(this.db)).rows[0];
      if (!r?.first) return { bucket: 'month' as const, points: [] as { start: string; label: string; revenueCents: number; collectionsCents: number }[] };
      from = String(r.first); to = p.today;
    }
    const span = daysBetween(from, to);
    const bucket = span <= 62 ? 'day' : span <= 400 ? 'week' : 'month';
    const rows = (await sql<any>`with b as (select to_char(g, 'YYYY-MM-DD') as start from generate_series(date_trunc(${bucket}, ${from}::date::timestamp), ${to}::date::timestamp, ('1 ' || ${bucket})::interval) g),
      rv as (select to_char(date_trunc(${bucket}, t.paid_at at time zone ${p.tz}), 'YYYY-MM-DD') as start, sum(${TICKET_NET_SALES_T})::bigint as cents
               from tickets t where t.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`t.branch_id`)} and t.status = 'paid' and t.paid_at is not null and t.removed_at is null
                and t.paid_at >= (${from}::date)::timestamp at time zone ${p.tz} and t.paid_at < ((${to}::date + 1))::timestamp at time zone ${p.tz} group by 1),
      cl as (select to_char(date_trunc(${bucket}, coalesce(pp.approved_at, pp.created_at) at time zone ${p.tz}), 'YYYY-MM-DD') as start, sum(pp.amount_cents)::bigint as cents
               from payments pp where pp.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`pp.branch_id`)} and pp.status in (${sql.join(CONFIRMED)})
                and coalesce(pp.approved_at, pp.created_at) >= (${from}::date)::timestamp at time zone ${p.tz} and coalesce(pp.approved_at, pp.created_at) < ((${to}::date + 1))::timestamp at time zone ${p.tz} group by 1)
      select b.start, coalesce(rv.cents, 0)::bigint as revenue, coalesce(cl.cents, 0)::bigint as collections from b left join rv on rv.start = b.start left join cl on cl.start = b.start order by b.start`.execute(this.db)).rows;
    const label = (s: string) => { const d = new Date(`${s}T12:00:00Z`); return bucket === 'month' ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
    return { bucket, points: rows.map((r: any) => ({ start: String(r.start), label: label(String(r.start)), revenueCents: N(r.revenue), collectionsCents: N(r.collections) })) };
  }

  async methods(ctx: FinanceCtx, p: Period) {
    const rows = (await sql<any>`select p.method, count(*)::int as n, sum(p.amount_cents)::bigint as cents from payments p
      where p.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`p.branch_id`)} and p.status in (${sql.join(CONFIRMED)}) and ${tsInPeriod(sql`coalesce(p.approved_at, p.created_at)`, p)}
      group by p.method`.execute(this.db)).rows;
    const by = new Map<string, { count: number; amountCents: number }>();
    for (const r of rows) { const k = methodKey(r.method); const v = by.get(k) ?? { count: 0, amountCents: 0 }; v.count += N(r.n); v.amountCents += N(r.cents); by.set(k, v); }
    const total = [...by.values()].reduce((a, v) => a + v.amountCents, 0);
    return { totalCents: total, methods: [...by.entries()].map(([method, v]) => ({ method, ...v, percent: total ? Math.round((v.amountCents / total) * 1000) / 10 : 0 })).sort((a, b) => b.amountCents - a.amountCents || a.method.localeCompare(b.method)) };
  }

  /** Lines on tickets paid in the period — ranked, paginated (View All Services), searchable. */
  async services(ctx: FinanceCtx, p: Period, pg: PageReq, search = '') {
    const s = search.trim().toLowerCase().slice(0, 100);
    const base = sql`from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`t.branch_id`)} and l.removed_at is null and t.status = 'paid' and t.paid_at is not null and t.removed_at is null
        and ${tsInPeriod(sql`t.paid_at`, p)} ${s ? sql`and lower(coalesce(l.service_name_snapshot, '')) like ${likeOf(s)}` : sql``}`;
    const key = sql`coalesce(l.service_id::text, l.product_id::text, lower(l.service_name_snapshot))`;
    const total = N((await sql<{ n: number }>`select count(distinct ${key})::int as n ${base}`.execute(this.db)).rows[0]?.n);
    const c = clampPage(pg, total);
    const rows = (await sql<any>`select max(l.service_name_snapshot) as name, max(l.line_kind) as kind, sum(l.line_total_cents)::bigint as cents, sum(greatest(1, coalesce(l.quantity, 1)))::int as qty, count(distinct l.ticket_id)::int as tickets
      ${base} group by ${key} order by sum(l.line_total_cents) desc, max(l.service_name_snapshot) limit ${c.pageSize} offset ${c.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ name: r.name || 'Service', kind: r.kind ?? null, revenueCents: N(r.cents), count: N(r.qty), tickets: N(r.tickets) })), total, page: c.page, pageSize: c.pageSize, pageCount: c.pageCount };
  }

  private async recent(ctx: FinanceCtx, p: Period) {
    const r = await this.tx.list(ctx, this.tx.filters(p, {}), { page: 1, pageSize: 5 });
    return r.items.map((x) => ({ id: x.id, ticketNumber: x.ticketNumber, customer: x.customer?.name ?? null, method: x.method, amountCents: x.grossCents, state: x.state, at: x.paidAt ?? x.createdAt }));
  }

  /** Processor payouts (settlements), newest first: pending ones first in Upcoming; the full history paginated. */
  async payoutList(ctx: FinanceCtx, pg: PageReq, opts: { status?: 'pending' | 'paid' | 'all' } = {}): Promise<Paged<any>> {
    const st = opts.status ?? 'pending';
    const w = sql<boolean>`${this.pScope(ctx, sql`s.branch_id`)} ${st === 'pending' ? sql`and lower(coalesce(s.status, '')) in (${sql.join(PENDING_PAYOUT)})` : st === 'paid' ? sql`and lower(coalesce(s.status, '')) in (${sql.join(PAID_PAYOUT)})` : sql``}`;
    const total = N((await sql<{ n: number }>`select count(*)::int as n from payment_settlements s where s.tenant_id = ${ctx.tenantId} and ${w}`.execute(this.db)).rows[0]?.n);
    const c = clampPage(pg, total);
    const rows = (await sql<any>`select s.id, s.settlement_id, s.processor_type, s.status, s.gross_cents, s.fee_cents, s.net_cents, to_char(s.expected_deposit_date, 'YYYY-MM-DD') as expected_deposit_date, to_char(s.actual_deposit_date, 'YYYY-MM-DD') as actual_deposit_date, s.funding_account_last4, s.settled_at, s.created_at, s.reconciliation_status, s.transaction_count
      from payment_settlements s where s.tenant_id = ${ctx.tenantId} and ${w} order by s.created_at desc, s.id desc limit ${c.pageSize} offset ${c.offset}`.execute(this.db)).rows;
    const d = (v: unknown) => (v == null ? null : String(v));   // to_char'd in SQL: the stored DATE, never shifted by a zone
    return { items: rows.map((r: any) => ({
      id: String(r.id), reference: r.settlement_id ?? null, processor: r.processor_type ?? null, status: String(r.status ?? 'unknown'), grossCents: N(r.gross_cents), feeCents: N(r.fee_cents), netCents: N(r.net_cents ?? r.gross_cents),
      expectedDate: d(r.expected_deposit_date), depositedDate: d(r.actual_deposit_date), destination: r.funding_account_last4 ? `••${r.funding_account_last4}` : null, settledAt: iso(r.settled_at), createdAt: iso(r.created_at),
      bank: r.actual_deposit_date ? 'deposit_recorded' : 'not_confirmed', reconciliation: r.reconciliation_status ?? null, transactions: N(r.transaction_count),
    })), total, page: c.page, pageSize: c.pageSize, pageCount: c.pageCount };
  }

  /** The one search box: typed results — payments (via Transactions), invoices, payouts — newest first, tenant-scoped. */
  async search(ctx: FinanceCtx, p: Period, q: string) {
    const s = q.trim().slice(0, 100);
    if (s.length < 2) throw new FinanceError('Type at least two characters.', 'VALIDATION_FAILED', 400, { field: 'search' });
    const lower = s.toLowerCase(), d = digitsOf(s).replace(/^1(?=\d{10}$)/, '');
    const [payments, invoices, payouts] = await Promise.all([
      this.tx.list(ctx, this.tx.filters(p, { search: s }), { page: 1, pageSize: 8 }),
      sql<any>`select i.id, i.invoice_number, i.status, i.total_cents, i.issue_date, i.created_at, coalesce(c.full_name, i.bill_to_name) as name from invoices i left join customers c on c.id = i.customer_id and c.tenant_id = i.tenant_id
        where i.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`i.branch_id`)} and (lower(i.invoice_number) like ${likeOf(lower)} or lower(coalesce(c.full_name, i.bill_to_name, '')) like ${likeOf(lower)}
          ${d.length >= 7 ? sql`or right(coalesce(i.bill_to_phone_digits, regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g')), ${d.slice(-10).length}) = ${d.slice(-10)}` : sql``}
          ${s.includes('@') ? sql`or lower(coalesce(i.bill_to_email, c.email, '')) = ${lower}` : sql``} ${isUuid(s) ? sql`or i.id = ${s}::uuid` : sql``})
        order by i.created_at desc, i.id desc limit 6`.execute(this.db),
      sql<any>`select s.id, s.settlement_id, s.status, s.net_cents, s.created_at, s.processor_type from payment_settlements s
        where s.tenant_id = ${ctx.tenantId} and ${this.pScope(ctx, sql`s.branch_id`)} and (lower(coalesce(s.settlement_id, '')) like ${likeOf(lower)} ${isUuid(s) ? sql`or s.id = ${s}::uuid` : sql``})
        order by s.created_at desc, s.id desc limit 6`.execute(this.db),
    ]);
    return {
      query: s, period: p,
      payments: { total: payments.total, items: payments.items.map((x) => ({ type: 'payment' as const, id: x.id, ticketNumber: x.ticketNumber, customer: x.customer, amountCents: x.grossCents, state: x.state, method: x.method, at: x.paidAt ?? x.createdAt })) },
      invoices: invoices.rows.map((r: any) => ({ type: 'invoice' as const, id: String(r.id), number: r.invoice_number, customer: r.name ?? null, amountCents: N(r.total_cents), state: String(r.status), at: iso(r.created_at) })),
      payouts: payouts.rows.map((r: any) => ({ type: 'payout' as const, id: String(r.id), reference: r.settlement_id ?? null, processor: r.processor_type ?? null, amountCents: N(r.net_cents), state: String(r.status ?? ''), at: iso(r.created_at) })),
    };
  }
}
