// payment-reconciliation.service.ts — per-tenant gateway reconciliation from the settlement/refund ledgers
// (Payment Gateway Isolation §16). Every query is scoped to the caller's tenant_id, so totals never cross tenants.
// This is record-sourced (settlement batches + refund rows the gateway reported), distinct from the Reports module's
// ticket/payment KPI aggregation.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface ReconciliationSummary {
  from: string | null;
  to: string | null;
  refunds: { count: number; totalCents: number };
  settlements: { count: number; grossCents: number; feeCents: number; netCents: number };
}

export interface PaymentsOverview {
  kpis: {
    todayRevenueCents: number; todayCollectionsCents: number; refundsIssuedCents: number; outstandingBalanceCents: number;
    totalTransactions: number; averageTicketCents: number; failedTransactions: number; pendingPayoutsCents: number;
  };
  totals: { totalRevenueCents: number; totalCollectedCents: number; totalRefundsCents: number; outstandingBalanceCents: number; totalTipsCents: number; totalPayoutsCents: number };
  revenueTrend: { day: string; revenueCents: number }[];
  paymentMethods: { method: string; count: number; amountCents: number }[];
  topServices: { name: string; revenueCents: number }[];
  health: { successful: number; failed: number; chargebacks: number; refundRatePercent: number; collectionRatePercent: number; healthScorePercent: number };
  transactions: { paymentId: string; ticketNumber?: string; customerName?: string; serviceName?: string; method: string; amountCents: number; status: string; type: string; createdAt: string }[];
  upcomingPayouts: { label: string; amountCents: number; scheduledFor?: string | null }[];
}

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));

export class PaymentReconciliationService {
  constructor(private readonly db: Kysely<DB> | null) {}

  async summary(tenantId: string, from?: string, to?: string): Promise<ReconciliationSummary> {
    const base: ReconciliationSummary = { from: from ?? null, to: to ?? null, refunds: { count: 0, totalCents: 0 }, settlements: { count: 0, grossCents: 0, feeCents: 0, netCents: 0 } };
    if (!this.db || !tenantId) return base;

    let rq = this.db.selectFrom('payment_refunds')
      .select((eb) => [eb.fn.countAll().as('c'), eb.fn.sum('amount_cents').as('amt')])
      .where('tenant_id', '=', tenantId);
    if (from) rq = rq.where('created_at', '>=', from as any);
    if (to) rq = rq.where('created_at', '<=', to as any);
    const r = await rq.executeTakeFirst().catch(() => undefined);

    let sq = this.db.selectFrom('payment_settlements')
      .select((eb) => [eb.fn.countAll().as('c'), eb.fn.sum('gross_cents').as('g'), eb.fn.sum('fee_cents').as('f'), eb.fn.sum('net_cents').as('net')])
      .where('tenant_id', '=', tenantId);
    if (from) sq = sq.where('created_at', '>=', from as any);
    if (to) sq = sq.where('created_at', '<=', to as any);
    const s = await sq.executeTakeFirst().catch(() => undefined);

    return {
      from: from ?? null, to: to ?? null,
      refunds: { count: n(r && (r as any).c), totalCents: n(r && (r as any).amt) },
      settlements: { count: n(s && (s as any).c), grossCents: n(s && (s as any).g), feeCents: n(s && (s as any).f), netCents: n(s && (s as any).net) },
    };
  }

  // Tenant Payments & Money overview — aggregated from payments + tickets + settlement/refund ledgers (real money,
  // integer cents, tenant-scoped). Empty until payments are captured; never fabricates numbers.
  async overview(tenantId: string, branchId?: string): Promise<PaymentsOverview> {
    const empty: PaymentsOverview = {
      kpis: { todayRevenueCents: 0, todayCollectionsCents: 0, refundsIssuedCents: 0, outstandingBalanceCents: 0, totalTransactions: 0, averageTicketCents: 0, failedTransactions: 0, pendingPayoutsCents: 0 },
      totals: { totalRevenueCents: 0, totalCollectedCents: 0, totalRefundsCents: 0, outstandingBalanceCents: 0, totalTipsCents: 0, totalPayoutsCents: 0 },
      revenueTrend: [], paymentMethods: [], topServices: [],
      health: { successful: 0, failed: 0, chargebacks: 0, refundRatePercent: 0, collectionRatePercent: 0, healthScorePercent: 0 },
      transactions: [], upcomingPayouts: [],
    };
    if (!this.db || !tenantId) return empty;
    const db = this.db;
    const scope = <T extends { where: any }>(q: T): T => {
      let r: any = (q as any).where('tenant_id', '=', tenantId);
      if (branchId) r = r.where((eb: any) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
      return r;
    };

    // payments in the last 7 days (drives trend, methods, transactions); today's slice drives the "today" KPIs
    const pays = await scope(db.selectFrom('payments').select(['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'status', 'created_at']))
      .where('created_at', '>=', sql`now() - interval '7 days'` as any).orderBy('created_at', 'desc').execute().catch(() => [] as any[]);
    const approved = pays.filter((p: any) => p.status === 'approved');
    const isToday = (v: any) => iso(v).slice(0, 10) === new Date().toISOString().slice(0, 10);
    const approvedToday = approved.filter((p: any) => isToday(p.created_at));

    // refunds + settlements (all-time totals; today's refunds for the KPI)
    const refundRows = await scope(db.selectFrom('payment_refunds').select(['amount_cents', 'created_at'])).execute().catch(() => [] as any[]);
    const refundsTodayCents = refundRows.filter((r: any) => isToday(r.created_at)).reduce((a: number, r: any) => a + n(r.amount_cents), 0);
    const totalRefundsCents = refundRows.reduce((a: number, r: any) => a + n(r.amount_cents), 0);
    const settleRows = await scope(db.selectFrom('payment_settlements').select(['net_cents', 'gross_cents', 'status', 'settled_at', 'created_at'])).execute().catch(() => [] as any[]);
    const pendingPayoutsCents = settleRows.filter((s: any) => /pending|scheduled|in_transit/i.test(s.status || '')).reduce((a: number, s: any) => a + n(s.net_cents ?? s.gross_cents), 0);
    const totalPayoutsCents = settleRows.filter((s: any) => /paid|deposited|settled|complete/i.test(s.status || '')).reduce((a: number, s: any) => a + n(s.net_cents ?? s.gross_cents), 0);

    // outstanding = completed-but-unpaid ticket totals
    const outRow = await scope(db.selectFrom('tickets').select((eb) => [eb.fn.sum('total_cents').as('amt')]))
      .where('status', 'in', ['service_done', 'ready_for_checkout', 'sent_to_checkout', 'completed']).where('paid_at', 'is', null)
      .executeTakeFirst().catch(() => undefined);
    const outstandingBalanceCents = n((outRow as any)?.amt);

    // revenue trend (last 7 days, approved)
    const trendMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); trendMap[d.toISOString().slice(0, 10)] = 0; }
    for (const p of approved) { const day = iso(p.created_at).slice(0, 10); if (day in trendMap) trendMap[day] += n(p.amount_cents); }
    const revenueTrend = Object.entries(trendMap).map(([day, revenueCents]) => ({ day, revenueCents }));

    // payment methods breakdown (approved, 7d)
    const methodMap: Record<string, { count: number; amountCents: number }> = {};
    for (const p of approved) { const m = p.method || 'other'; (methodMap[m] ||= { count: 0, amountCents: 0 }); methodMap[m].count += 1; methodMap[m].amountCents += n(p.amount_cents); }
    const paymentMethods = Object.entries(methodMap).map(([method, v]) => ({ method, count: v.count, amountCents: v.amountCents })).sort((a, b) => b.amountCents - a.amountCents);

    // top services by revenue (paid tickets, all-time)
    const svcRows = await scope(db.selectFrom('ticket_service_lines').select((eb) => ['service_name_snapshot as name', eb.fn.sum('line_total_cents').as('rev')]))
      .groupBy('service_name_snapshot').orderBy('rev', 'desc').limit(5).execute().catch(() => [] as any[]);
    const topServices = svcRows.map((r: any) => ({ name: r.name || 'Service', revenueCents: n(r.rev) })).filter((x: any) => x.revenueCents > 0);

    // transactions (most recent 12), labelled with customer + first service
    const txIds = approved.slice(0, 12).map((p: any) => p.ticket_id).filter(Boolean);
    const tkRows = txIds.length ? await scope(db.selectFrom('tickets').select(['id', 'ticket_number', 'customer_id'])).where('id', 'in', txIds).execute().catch(() => [] as any[]) : [];
    const tkBy: Record<string, any> = {}; for (const t of tkRows) tkBy[t.id] = t;
    const custIds = tkRows.map((t: any) => t.customer_id).filter(Boolean);
    const custRows = custIds.length ? await scope(db.selectFrom('customers').select(['id', 'full_name'])).where('id', 'in', custIds).execute().catch(() => [] as any[]) : [];
    const custBy: Record<string, string> = {}; for (const c of custRows) custBy[c.id] = c.full_name;
    const svcByTicket: Record<string, string> = {};
    if (txIds.length) { const lines = await scope(db.selectFrom('ticket_service_lines').select(['ticket_id', 'service_name_snapshot'])).where('ticket_id', 'in', txIds).execute().catch(() => [] as any[]); for (const l of lines) if (!svcByTicket[l.ticket_id]) svcByTicket[l.ticket_id] = l.service_name_snapshot; }
    const allRecent = pays.slice(0, 12);
    const transactions = allRecent.map((p: any) => {
      const tk = tkBy[p.ticket_id];
      return { paymentId: p.id, ticketNumber: tk?.ticket_number, customerName: tk ? custBy[tk.customer_id] : undefined, serviceName: svcByTicket[p.ticket_id], method: p.method, amountCents: n(p.amount_cents), status: p.status, type: p.status === 'refunded' ? 'Refund' : p.status === 'voided' ? 'Void' : 'Payment', createdAt: iso(p.created_at) };
    });

    // health
    const successful = approved.length;
    const failed = pays.filter((p: any) => p.status === 'declined').length;
    const totalRevenueCents = approved.reduce((a: number, p: any) => a + n(p.amount_cents), 0);
    const totalTipsCents = approved.reduce((a: number, p: any) => a + n(p.tip_cents), 0);
    const refundRatePercent = totalRevenueCents > 0 ? Math.round((totalRefundsCents / totalRevenueCents) * 1000) / 10 : 0;
    const collectedPlusOutstanding = totalRevenueCents + outstandingBalanceCents;
    const collectionRatePercent = collectedPlusOutstanding > 0 ? Math.round((totalRevenueCents / collectedPlusOutstanding) * 1000) / 10 : 0;
    const healthScorePercent = successful + failed > 0 ? Math.round((successful / (successful + failed)) * 100) : 0;

    const todayRevenueCents = approvedToday.reduce((a: number, p: any) => a + n(p.amount_cents), 0);
    return {
      kpis: {
        todayRevenueCents, todayCollectionsCents: todayRevenueCents, refundsIssuedCents: refundsTodayCents, outstandingBalanceCents,
        totalTransactions: pays.length, averageTicketCents: successful > 0 ? Math.round(totalRevenueCents / successful) : 0,
        failedTransactions: pays.filter((p: any) => p.status === 'declined' && isToday(p.created_at)).length, pendingPayoutsCents,
      },
      totals: { totalRevenueCents, totalCollectedCents: totalRevenueCents, totalRefundsCents, outstandingBalanceCents, totalTipsCents, totalPayoutsCents },
      revenueTrend, paymentMethods, topServices,
      health: { successful, failed, chargebacks: 0, refundRatePercent, collectionRatePercent, healthScorePercent },
      transactions, upcomingPayouts: settleRows.filter((s: any) => /pending|scheduled|in_transit/i.test(s.status || '')).slice(0, 5).map((s: any) => ({ label: 'Settlement', amountCents: n(s.net_cents ?? s.gross_cents), scheduledFor: s.settled_at ? iso(s.settled_at) : null })),
    };
  }
}
