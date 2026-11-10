// reports.kysely.repository.ts — production ReportsRepositoryPort over Postgres (Kysely).
// Loads a REAL, tenant/branch-scoped transaction list from payments ⨝ tickets (+ ticket_service_lines for the
// service/category, customers for the name, technicians for the name) and then runs the SAME shared pure builders
// (buildReportsState / buildExportRows) the in-memory adapter uses — so every KPI, trend, breakdown, transaction row,
// and CSV export is computed by identical, honest math. Server-side filters are applied by the shared builder.
//
// Honest fallbacks (documented — no schema source per transaction, so NOT faked): cardSurcharge is 0 (the payments
// table has no surcharge column), customerType defaults to 'returning', and bookingSource defaults to 'walk_in'.
// gift_card is normalized to the builder's 'giftCard' bucket; refunded/voided payment statuses map to 'refunded'.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { branchTimeZone } from '@aipowersalon/database';
import type { ReportFilters } from './reports.dto';
import { ReportsContext, ReportsRepositoryPort, Tx, buildReportsState, buildExportRows, daysAgo, attributeCardSurcharge, applyFilters } from './reports.repository';
import { rankCategories, rankTechnicians, type ServiceLineFact } from './service-revenue';
import { buildTrend, previousRange, change, type RevenueTrend } from './trend';
import { ticketFacts, type ReportTicketFact } from './report-tickets';
import { REPORTABLE_PAYMENT_STATUSES, isRefundStatus } from '@aipowersalon/api-contracts';
import { addDays as addYmdDays, dateColumnYmd } from '@aipowersalon/date-time';   // §87: one calendar helper

const dateOnly = (v: any): string => dateColumnYmd(v) ?? String(v ?? '').slice(0, 10);
const normMethod = (m: string) => (m === 'gift_card' ? 'giftCard' : m === 'gift' ? 'giftCard' : m || 'card');
const isRefund = isRefundStatus; // shared single source of truth (was a duplicated local list)

export class KyselyReportsRepository implements ReportsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private scoped(qb: any, ctx: ReportsContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }

  // build the real transaction list (a generous window; the shared builder re-applies the precise filters)
  private async loadTx(ctx: ReportsContext, filters: ReportFilters): Promise<Tx[]> {
    const from = filters.from || daysAgo(400);
    const to = filters.to || daysAgo(0);
    // F5 (Nov 6 2026): a payment's report DAY is the salon-local day (the same zone the presets use), not the UTC day —
    // an 8 pm sale in New York is 00:xx UTC the next day and used to land on tomorrow (and fall out of "today"). The SQL
    // window is one day wider on each side; `at` below is the local day and the builder applies the exact range.
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId && /^[0-9a-f-]{36}$/i.test(ctx.branchId) ? ctx.branchId : null);
    const localYmd = (v: any): string => { const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? dateOnly(v) : new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };
    const pays = await this.scoped(this.db.selectFrom('payments'), ctx)
      .where((eb: any) => eb.between(sqlDate(eb, 'created_at'), addYmdDays(from, -1), addYmdDays(to, 1)))
      // only revenue-bearing rows: a declined / not_configured / voided / pending payment collected nothing and must
      // never count toward reported sales. Refunds are kept (they net out as refundsCents in the summary).
      .where('status', 'in', [...REPORTABLE_PAYMENT_STATUSES])
      .select(['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'tax_cents', 'discount_cents', 'surcharge_cents', 'status', 'created_at'])
      .execute().catch(() => []);
    if (!pays.length) return [];
    const ticketIds = [...new Set(pays.map((p: any) => p.ticket_id).filter(Boolean))];
    const tickets = ticketIds.length ? await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', 'in', ticketIds).select(['id', 'customer_id', 'primary_technician_id', 'surcharge_cents', 'tax_cents', 'discount_cents', 'tip_cents']).execute().catch(() => []) : [];
    const tById: Record<string, any> = {}; for (const t of tickets) tById[t.id] = t;
    const custIds = [...new Set(tickets.map((t: any) => t.customer_id).filter(Boolean))];
    const techIds = [...new Set(tickets.map((t: any) => t.primary_technician_id).filter(Boolean))];
    const custs = custIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', custIds).select(['id', 'full_name']).execute().catch(() => []) : [];
    const techs = techIds.length ? await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', 'in', techIds).select(['id', 'full_name']).execute().catch(() => []) : [];
    const cName: Record<string, string> = {}; for (const c of custs) cName[c.id] = c.full_name || '';
    const tName: Record<string, string> = {}; for (const t of techs) tName[t.id] = t.full_name || '';
    // one representative service line per ticket (for service name + category)
    const lines = ticketIds.length ? await this.scoped(this.db.selectFrom('ticket_service_lines as l'), ctx, 'l').leftJoin('services as s', 's.id', 'l.service_id').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .where('l.ticket_id', 'in', ticketIds).select(['l.ticket_id as ticketId', 'l.service_name_snapshot as svcName', 'c.name as cat']).execute().catch(() => []) : [];
    const lineByTicket: Record<string, { svcName: string; cat: string }> = {};
    for (const l of lines) if (!lineByTicket[l.ticketId]) lineByTicket[l.ticketId] = { svcName: l.svcName || 'Service', cat: l.cat || 'General' };
    // wave 4 PILOT: each ticket's SALES (service + retail lines, before discounts) and its retail part — from the lines
    const money = ticketIds.length ? await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('ticket_id', 'in', ticketIds).where('removed_at', 'is', null)
      .select(['ticket_id', 'line_total_cents', 'product_id', 'line_kind']).execute().catch(() => []) : [];
    const salesByTicket: Record<string, { sales: number; product: number }> = {};
    for (const m of money) {
      const c = salesByTicket[m.ticket_id] || { sales: 0, product: 0 }; const v = Number(m.line_total_cents || 0);
      c.sales += v; if (m.product_id || String(m.line_kind || '').toLowerCase() === 'retail') c.product += v; salesByTicket[m.ticket_id] = c;
    }
    // ONE payment row per ticket carries the ticket's own figures (its first revenue row), so a split ticket is counted once
    const carrier: Record<string, string> = {};
    for (const p of [...pays].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))) if (p.ticket_id && !isRefund(p.status) && !carrier[p.ticket_id]) carrier[p.ticket_id] = p.id;

    // The surcharge a card row CHARGED is on that row (payments.surcharge_cents — recorded on every path since wave 4); the
    // older ticket-level attribution only ever saw split payments. A refund row carries none.
    const surchargeById: Record<string, number> = Object.fromEntries(pays.map((p: any) => [p.id, isRefund(p.status) ? 0 : Number(p.surcharge_cents || 0)]));
    void attributeCardSurcharge;
    return pays.map((p: any): Tx => {
      const t = tById[p.ticket_id] || {};
      const line = lineByTicket[p.ticket_id] || { svcName: 'Service', cat: 'General' };
      const techId = t.primary_technician_id || '';
      const custId = t.customer_id || '';
      return {
        id: p.id, ticketId: p.ticket_id || null, at: localYmd(p.created_at), occurredAt: new Date(p.created_at).toISOString(), customerId: custId, customer: cName[custId] || '', customerType: 'returning',
        technicianId: techId, technician: tName[techId] || '', service: line.svcName, category: line.cat, paymentMethod: normMethod(p.method),
        bookingSource: 'walk_in', grossCents: Number(p.amount_cents || 0), surchargeCents: surchargeById[p.id] || 0, status: isRefund(p.status) ? 'refunded' : 'completed',
        // the ticket's own discount / tax / tip / sales ride on its ONE carrier row (payments rows never carried tax or
        // discounts, and a split's tip is on the ticket, not on a card row) — wave 4 PILOT
        ...(p.ticket_id && carrier[p.ticket_id] === p.id
          ? { discountCents: Number(t.discount_cents || 0), taxCents: Number(t.tax_cents || 0), tipCents: Number(t.tip_cents || 0), salesCents: salesByTicket[p.ticket_id]?.sales ?? Number(p.amount_cents || 0), productCents: salesByTicket[p.ticket_id]?.product ?? 0 }
          : p.ticket_id ? { discountCents: 0, taxCents: 0, tipCents: 0, salesCents: 0, productCents: 0 }
          : { discountCents: Number(p.discount_cents || 0), taxCents: Number(p.tax_cents || 0), tipCents: Number(p.tip_cents || 0) }),
      };
    });
  }

  /** AI Business Reports guide (Nov 3 2026): a preset WITHOUT from/to used to be ignored — every caller asking for "today",
   *  "month" or "year" (the Sales Report screen, the AI Business Assistant tools, its alerts and its reports) got the last 7 days.
   *  A preset is now turned into the salon-local days it names; explicit from/to still win. */
  private async withPresetRange(ctx: ReportsContext, f: ReportFilters): Promise<ReportFilters> {
    if (f.from || f.to || f.preset === 'custom') return f;
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId && /^[0-9a-f-]{36}$/i.test(ctx.branchId) ? ctx.branchId : null);
    // Nov 8 2026 (full run, pilot salon at GMT+14): with no preset and no dates the default "last 7 days" was counted from the
    // SERVER's UTC day, so a salon already on tomorrow saw an empty Reports screen. The default now ends on the salon's day.
    if (!f.preset) return { ...f, ...defaultRange(new Date(), tz) };
    return { ...f, ...(f.period === 'previous' ? previousPeriodRange(f.preset, new Date(), tz) : presetRange(f.preset, new Date(), tz)) };
  }

  async query(ctx: ReportsContext, filtersIn: ReportFilters) {
    const filters = await this.withPresetRange(ctx, filtersIn);
    const txs = await this.loadTx(ctx, filters);
    const out = buildReportsState(txs, filters, ctx.branchId);
    // batch 9 guide 2 (Nov 10 2026): Revenue by Service from the period's SERVICE LINES (the shared calculation), not each
    // ticket's first line — a manicure + pedicure ticket used to put both services under the first one's category
    const inScope = applyFilters(txs, filters, ctx.branchId);
    const facts = await this.serviceLineFacts(ctx, inScope);
    // batch 9 guide 3 (Nov 10 2026): the trend — every bucket of the period, revenue on the sales basis + paid tickets
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId && /^[0-9a-f-]{36}$/i.test(ctx.branchId) ? ctx.branchId : null);
    const range = out.state.dateRange;
    const trend: RevenueTrend = buildTrend(inScope, range.from, range.to, tz, filters.groupBy);
    if (filters.compare) {
      const prev = previousRange(range.from, range.to);
      const pf: ReportFilters = { ...filters, ...prev, preset: 'custom' };
      const before = buildTrend(applyFilters(await this.loadTx(ctx, pf), pf, ctx.branchId), prev.from, prev.to, tz, 'day');
      trend.compare = { ...prev, revenueCents: before.totalRevenueCents, tickets: before.totalTickets,
        revenueChangePercent: change(trend.totalRevenueCents, before.totalRevenueCents), ticketsChangePercent: change(trend.totalTickets, before.totalTickets) };
    }
    out.state.trend = trend;
    out.state.dateRange.timezone = tz;   // the screen formats times in the salon's zone, not the browser's
    // batch 9 guide 6: the leaderboard from the same lines — each technician owns only their own service lines
    out.state.topTechnicians = rankTechnicians(facts.lines);
    out.state.revenueByService = rankCategories(facts.lines).map((c) => ({ serviceId: c.key, serviceName: c.name, revenueCents: c.grossCents, serviceCount: c.units, percentOfTop: c.percentOfTop }));
    const withLines: typeof out & { serviceLines: typeof facts; tickets: ReportTicketFact[]; returningIds?: string[] } = Object.assign(out, { serviceLines: facts, tickets: ticketFacts(inScope, facts) });
    await this.overlayFacts(ctx, out).catch(() => undefined);
    // a failure leaves retention / no-show / rating null (shown N/A, never a made-up 0) and is logged, not hidden
    await this.overlayPeople(ctx, filters, out).catch((e: unknown) => { console.warn('[reports] people overlay unavailable:', e instanceof Error ? e.message : String(e)); });
    return withLines;
  }

  /** batch 9 guide 2 (Nov 10 2026): the service lines of the period's PAID tickets (one carrier row per ticket — the Daily
   *  Summary population), with their recorded amount, quantity, historical name / category, technician and customer.
   *  This salon and branch only (every read is tenant-scoped). Discounts and refunds come back per ticket. */
  async serviceLineFacts(ctx: ReportsContext, txs: Tx[]): Promise<{ lines: ServiceLineFact[]; discountByTicket: Record<string, number>; refundByTicket: Record<string, number>; ticketNumbers?: Record<string, string | null>; phones?: Record<string, string> }> {
    const paid = txs.filter((t) => t.status === 'completed' && t.ticketId);
    const at: Record<string, string> = {}; const sales: Record<string, number> = {}; const disc: Record<string, number> = {}; const custOf: Record<string, { id: string; name: string }> = {};
    for (const t of paid) {
      const k = t.ticketId as string; const o = t.occurredAt ?? t.at;
      if (!at[k] || o < at[k]) at[k] = o;
      sales[k] = (sales[k] || 0) + Math.max(0, (t.salesCents ?? 0) - (t.productCents ?? 0));
      disc[k] = (disc[k] || 0) + (t.discountCents || 0);
      if (t.customerId) custOf[k] = { id: t.customerId, name: t.customer };
    }
    const refundByTicket: Record<string, number> = {};
    for (const t of txs) if (t.status === 'refunded' && t.ticketId) refundByTicket[t.ticketId] = (refundByTicket[t.ticketId] || 0) + Math.abs(t.grossCents || 0);
    const ids = Object.keys(at);
    if (!ids.length) return { lines: [], discountByTicket: disc, refundByTicket };
    const rows = await this.scoped(this.db.selectFrom('ticket_service_lines as l'), ctx, 'l')
      .leftJoin('services as s', (j: any) => j.onRef('s.id', '=', 'l.service_id').onRef('s.tenant_id', '=', 'l.tenant_id'))
      .leftJoin('service_categories as c', (j: any) => j.onRef('c.id', '=', 's.category_id').onRef('c.tenant_id', '=', 'l.tenant_id'))
      .leftJoin('technicians as tc', (j: any) => j.onRef('tc.id', '=', 'l.technician_id').onRef('tc.tenant_id', '=', 'l.tenant_id'))
      .where('l.ticket_id', 'in', ids).where('l.removed_at', 'is', null).where('l.product_id', 'is', null)
      .where((eb: any) => eb.or([eb('l.line_kind', 'is', null), eb(eb.fn('lower', ['l.line_kind']), '<>', 'retail')]))
      .select(['l.id', 'l.ticket_id', 'l.service_id', 'l.service_name_snapshot', 'l.category_snapshot', 'c.name as cat', 'l.technician_id', 'tc.full_name as tech', 'l.quantity', 'l.line_total_cents'])
      .execute();
    const tks = await this.scoped(this.db.selectFrom('tickets as t'), ctx, 't')
      .leftJoin('customers as cu', (j: any) => j.onRef('cu.id', '=', 't.customer_id').onRef('cu.tenant_id', '=', 't.tenant_id'))
      .where('t.id', 'in', ids).select(['t.id', 't.ticket_number', 'cu.normalized_phone as phone']).execute();
    const tk: Record<string, { num: string | null; phone: string }> = {};
    for (const r of tks) tk[r.id] = { num: r.ticket_number == null ? null : String(r.ticket_number), phone: String(r.phone ?? '').replace(/\D/g, '') };
    const withLines = new Set<string>();
    const lines: ServiceLineFact[] = rows.map((r: any) => {
      withLines.add(r.ticket_id);
      const category = String(r.category_snapshot || r.cat || '').trim();
      return {
        id: r.id, ticketId: r.ticket_id, ticketNumber: tk[r.ticket_id]?.num ?? null, occurredAt: at[r.ticket_id], serviceId: r.service_id ?? null,
        serviceName: String(r.service_name_snapshot || '').trim(), category, unmapped: !category, technicianId: r.technician_id ?? null, technician: r.tech || '',
        customerId: custOf[r.ticket_id]?.id ?? null, customer: custOf[r.ticket_id]?.name ?? '', units: Math.max(1, Number(r.quantity) || 1),
        grossCents: Number(r.line_total_cents || 0), phoneDigits: tk[r.ticket_id]?.phone || '',
      };
    });
    const ticketNumbers: Record<string, string | null> = {}; const phones: Record<string, string> = {};
    for (const k of ids) { ticketNumbers[k] = tk[k]?.num ?? null; phones[k] = tk[k]?.phone ?? ''; }
    for (const k of ids) if (!withLines.has(k) && sales[k] > 0) lines.push({
      id: 'ticket:' + k, ticketId: k, ticketNumber: tk[k]?.num ?? null, occurredAt: at[k], serviceId: null, serviceName: '', category: '', unmapped: true, noLines: true,
      technicianId: null, technician: '', customerId: custOf[k]?.id ?? null, customer: custOf[k]?.name ?? '', units: 0, grossCents: sales[k], phoneDigits: tk[k]?.phone || '' });
    return { lines, discountByTicket: disc, refundByTicket, ticketNumbers, phones };
  }

  /** Nov 10 2026 (Daily Summary guide §10, §15): the KPIs the payment rows cannot answer, from their own sources — never a 0
   *  that stands for "unknown". Salon-local days ([from, to] inclusive) in the branch's time zone; this salon and branch only.
   *  · new vs returning: a customer with a paid ticket BEFORE the period is returning, otherwise new
   *  · retention: of the customers with a paid ticket in the previous equal-length period, the share who came back in this one
   *  · no-show rate: no_show ÷ appointments scheduled in the period (cancelled excluded); none scheduled → null (N/A)
   *  · average rating: the Reputation definition (ratings 1–5, not spam, review date in the period); none → null (N/A) */
  private async overlayPeople(ctx: ReportsContext, f: ReportFilters, out: { state: any; rows: any[]; returningIds?: string[] }): Promise<void> {
    const s = out.state; const from = f.from, to = f.to;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
    const T = ctx.tenantId;
    const B = ctx.branchId && /^[0-9a-f-]{36}$/i.test(ctx.branchId) ? ctx.branchId : null;
    const tz = await branchTimeZone(this.db, T, B);
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    const prevTo = addYmdDays(from, -1), prevFrom = addYmdDays(from, -days);
    // column references written out (no identifier is built from a value)
    const brT = B ? sql`and t.branch_id = ${B}::uuid` : sql``, brA = B ? sql`and a.branch_id = ${B}::uuid` : sql``, brR = B ? sql`and r.branch_id = ${B}::uuid` : sql``;
    // batch 9 guide 7 (Nov 10 2026): a "paid visit" is a ticket with a collected (non-refund) payment recorded on that salon day —
    // the SAME population as every money figure on the reports (it used tickets.paid_at, which some paths never set, so New /
    // Returning could read 0 beside a Customers card that counted them)
    const paidStatuses = [...REPORTABLE_PAYMENT_STATUSES].filter((st) => !isRefundStatus(st));
    const payDay = sql`(p.created_at at time zone ${tz})::date`;
    const paidIn = (a: string, b: string) => sql`select distinct t.customer_id from tickets t
      join payments p on p.ticket_id = t.id and p.tenant_id = t.tenant_id and p.status = any(${paidStatuses}::text[])
      where t.tenant_id = ${T}::uuid ${brT} and t.customer_id is not null and ${payDay} between ${a}::date and ${b}::date`;
    const paidBefore = (ids: string[], day: string) => sql<{ customer_id: string }>`select distinct t.customer_id from tickets t
      join payments p on p.ticket_id = t.id and p.tenant_id = t.tenant_id and p.status = any(${paidStatuses}::text[])
      where t.tenant_id = ${T}::uuid ${brT} and t.customer_id = any(${ids}::uuid[]) and ${payDay} < ${day}::date`;
    const cur: string[] = (await sql<{ customer_id: string }>`${paidIn(from, to)}`.execute(this.db)).rows.map((r) => String(r.customer_id));
    const returningIds = cur.length ? (await paidBefore(cur, from).execute(this.db)).rows.map((r) => String(r.customer_id)) : [];
    const returning = returningIds.length;
    s.customerInsights.returningCustomers = returning; s.customerInsights.newCustomers = cur.length - returning; s.kpis.newCustomers = cur.length - returning;
    out.returningIds = returningIds;
    const prev: string[] = (await sql<{ customer_id: string }>`${paidIn(prevFrom, prevTo)}`.execute(this.db)).rows.map((r) => String(r.customer_id));
    const curSet = new Set(cur); const back = prev.filter((c) => curSet.has(c)).length;
    s.customerInsights.retentionCohort = prev.length; s.customerInsights.retentionReturned = back;
    s.customerInsights.retentionRatePercent = prev.length ? Math.round((back / prev.length) * 1000) / 10 : null;
    // the change against the previous period of the same length — they were a constant 0 ("0%" on every card); no prior base
    // → null (N/A), never 0% or +100%
    const prevReturning = prev.length ? (await paidBefore(prev, prevFrom).execute(this.db)).rows.length : 0;
    s.customerInsights.newCustomersTrendPercent = change(cur.length - returning, prev.length - prevReturning);
    s.customerInsights.returningCustomersTrendPercent = change(returning, prevReturning);
    s.customerInsights.retentionRateTrendPercent = null;   // needs the cohort before the previous period — not computed, so not shown
    const ap = (await sql<{ total: number; scheduled: number; no_show: number; cancelled: number; completed: number; open: number }>`select count(*)::int as total,
        count(*) filter (where a.status not in ('cancelled', 'canceled'))::int as scheduled, count(*) filter (where a.status = 'no_show')::int as no_show,
        count(*) filter (where a.status in ('cancelled', 'canceled'))::int as cancelled, count(*) filter (where a.status = 'completed')::int as completed,
        count(*) filter (where a.status in ('booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'))::int as open
      from pos_tech_appointments a where a.tenant_id = ${T}::uuid ${brA} and a.appt_date between ${from}::date and ${to}::date`.execute(this.db)).rows[0];
    const scheduled = Number(ap?.scheduled ?? 0);
    s.kpis.noShowRatePercent = scheduled ? Math.round((Number(ap?.no_show ?? 0) / scheduled) * 1000) / 10 : null;
    // batch 9 guide 5 (Nov 10 2026): the Appointments Report outcomes are APPOINTMENTS by scheduled salon day — every status,
    // each appointment once. Total used to be the payment-row count and Completed the paid-ticket count (so always 100%),
    // with Cancelled / No-Show a constant 0; every share is of the same Total, and N/A (null) when nothing was booked.
    const tot = Number(ap?.total ?? 0); const share = (n: number) => (tot ? Math.round((n / tot) * 1000) / 10 : null);
    const done = Number(ap?.completed ?? 0), canc = Number(ap?.cancelled ?? 0), ns = Number(ap?.no_show ?? 0), open = Number(ap?.open ?? 0);
    s.bookingsOverview = {
      ...s.bookingsOverview, basis: 'scheduled_date', totalBookings: tot,
      completed: done, completedPercent: share(done), cancelled: canc, cancelledPercent: share(canc), noShow: ns, noShowPercent: share(ns),
      open, openPercent: share(open), other: Math.max(0, tot - done - canc - ns - open), otherPercent: share(Math.max(0, tot - done - canc - ns - open)),
    };
    const rv = (await sql<{ avg: number | null }>`select round(avg(r.rating) filter (where r.rating between 1 and 5), 1)::float as avg from reviews r
      where r.tenant_id = ${T}::uuid ${brR} and coalesce(r.is_spam, false) = false
        and (coalesce(r.review_date, r.created_at) at time zone ${tz})::date between ${from}::date and ${to}::date`.execute(this.db)).rows[0];
    s.kpis.averageRating = rv?.avg == null ? null : Number(rv.avg);
  }

  /** wave 4 PILOT: the facts the pure builder cannot know — never invented. Tips by technician are the compensation
   *  snapshot's allocation (the payroll authority: a split ticket's tip is split); the tax rate and the card-surcharge %
   *  are the salon's settings; the processor status is the salon's gateway status. */
  private async overlayFacts(ctx: ReportsContext, out: { state: any; rows: any[] }): Promise<void> {
    const s = out.state;
    const ticketIds = [...new Set((out.rows || []).filter((r: any) => r.status !== 'refunded' && r.ticketId).map((r: any) => String(r.ticketId)))];
    if (ticketIds.length) {
      const tips: any[] = await this.db.selectFrom('ticket_compensation_snapshots as s').leftJoin('technicians as t', 't.id', 's.technician_id')
        .where('s.tenant_id', '=', ctx.tenantId).where('s.ticket_id', 'in', ticketIds).where('s.technician_id', 'is not', null)
        .select(['s.technician_id as id', 't.full_name as name', (eb: any) => eb.fn.sum(eb('s.card_tip_cents', '+', eb.ref('s.cash_tip_cents'))).as('tips')])
        .groupBy(['s.technician_id', 't.full_name']).execute();
      if (tips.length) s.tips.byTechnician = tips.map((x) => ({ technicianId: String(x.id), name: String(x.name ?? ''), tipsCents: Number(x.tips || 0) })).sort((a, b) => b.tipsCents - a.tipsCents);
    }
    const setting = async (category: string): Promise<any> => {
      const rows: any[] = await this.db.selectFrom('tenant_settings').where('tenant_id', '=', ctx.tenantId).where('category', '=', category)
        .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId || null), eb('branch_id', 'is', null)])).select(['branch_id', 'settings_json']).execute();
      const pick = rows.find((r) => r.branch_id && r.branch_id === ctx.branchId) ?? rows.find((r) => !r.branch_id);
      const j = pick?.settings_json; return typeof j === 'string' ? JSON.parse(j) : j ?? null;
    };
    const tax = await setting('tax'); if (tax && Number.isFinite(Number(tax.taxRatePercent))) s.tax.taxRatePercent = Number(tax.taxRatePercent);
    const pc = await setting('payments-checkout');
    if (pc && Number.isFinite(Number(pc.creditCardSurchargePercent))) s.discountSurcharge.surchargePercent = pc.creditCardSurchargeEnabled === false ? 0 : Number(pc.creditCardSurchargePercent);
    const gw: any = await this.db.selectFrom('tenant_payment_config').where('tenant_id', '=', ctx.tenantId).select(['status']).executeTakeFirst();
    s.payments.processorStatus = String(gw?.status || 'not_configured');
  }
  async exportRows(ctx: ReportsContext, type: string, filtersIn: ReportFilters) { const filters = await this.withPresetRange(ctx, filtersIn); return buildExportRows(await this.loadTx(ctx, filters), type, filters, ctx.branchId); }
}

// cast a TIMESTAMPTZ column to ::date for an inclusive day-range comparison
function sqlDate(eb: any, col: string) { return eb.fn('date', [eb.ref(col)]); }

/** the default report window (no preset, no dates): the salon's day and the 7 days before it — the same span the shared
 *  builder's daysAgo(7)..daysAgo(0) default names, counted on the salon's calendar instead of the server's */
export function defaultRange(now: Date, tz: string): { from: string; to: string } {
  const to = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 7);
  return { from: d.toISOString().slice(0, 10), to };
}

/** the salon-local days a report preset names (inclusive), for `now` in `tz`; weeks start on Monday */
export function presetRange(preset: string, now: Date, tz: string): { from: string; to: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const add = (d: string, k: number) => addYmdDays(d, k);
  const y = today.slice(0, 4), m = Number(today.slice(5, 7));
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const d = add(today, -1); return { from: d, to: d }; }
    case 'week': return { from: add(today, -((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7)), to: today };
    case 'month': return { from: today.slice(0, 8) + '01', to: today };
    case 'quarter': return { from: `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`, to: today };
    case 'year': return { from: `${y}-01-01`, to: today };
    // A4 (Nov 5 2026): rolling windows ending today (today included) and the whole previous calendar month
    case 'last7': return { from: add(today, -6), to: today };
    case 'last30': return { from: add(today, -29), to: today };
    case 'last_month': { const first = today.slice(0, 8) + '01'; const end = add(first, -1); return { from: end.slice(0, 8) + '01', to: end }; }
    default: return { from: add(today, -7), to: today };
  }
}

/**
 * The equivalent PREVIOUS period of a preset, to the same point (Nov 3 audit: "why did revenue change?" compared This Month
 * with This Month). today → yesterday; yesterday → the day before; week (Mon..today) → last Mon..the same weekday;
 * month (1st..today) → last month 1st..the same day (clamped to its last day); quarter / year likewise.
 */
export function previousPeriodRange(preset: string, now: Date, tz: string): { from: string; to: string } {
  const cur = presetRange(preset, now, tz);
  const add = (d: string, k: number) => addYmdDays(d, k);
  const shiftMonths = (d: string, k: number) => {
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + k, day = Number(d.slice(8, 10));
    const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  };
  switch (preset) {
    case 'today': case 'yesterday': return { from: add(cur.from, -1), to: add(cur.to, -1) };
    case 'week': return { from: add(cur.from, -7), to: add(cur.to, -7) };
    case 'month': return { from: shiftMonths(cur.from, -1), to: shiftMonths(cur.to, -1) };
    case 'quarter': return { from: shiftMonths(cur.from, -3), to: shiftMonths(cur.to, -3) };
    case 'year': return { from: shiftMonths(cur.from, -12), to: shiftMonths(cur.to, -12) };
    case 'last_month': { const end = add(cur.from, -1); return { from: end.slice(0, 8) + '01', to: end }; }   // the whole month before
    default: { const len = Math.round((Date.parse(cur.to) - Date.parse(cur.from)) / 86_400_000) + 1; return { from: add(cur.from, -len), to: add(cur.to, -len) }; }
  }
}
