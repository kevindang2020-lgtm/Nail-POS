// overview.kysely.repository.ts — production OverviewRepo over Postgres (Kysely). One scoped aggregate powers the
// page. EVERY query is filtered by tenant_id and (branch_id = :branchId OR :branchId IS NULL) — scope comes from the
// session, never the client. KPI math uses the same dto helpers as the in-memory repo.
import { loadTechUtilization } from '@aipowersalon/workforce';
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, tenantTimeZone, safeZoneName, type DB } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import type { OverviewRepo, OverviewScope, OverviewQuery } from './overview.repository';
import { emptyOverview } from './overview.repository';
import { estimateWaitMinutes } from '@aipowersalon/queue';
import { REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';
import type { PosOverviewResponse } from './overview.dto';

const REVENUE_STATUSES = [...REVENUE_BEARING_STATUSES];

const money = (cents: number, changePercent = 0, comparisonLabel = 'vs yesterday') => ({
  amountCents: cents, displayAmount: '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), changePercent, comparisonLabel,
});
const pct = (cur: number, prev: number) => (prev <= 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10);
const ONLINE_SOURCES = ['online', 'online_booking', 'customer_app', 'google', 'google_booking_link', 'ai', 'ai_phone'];

/** wave 4 pilot P3: "completed services" = the service LINES finished on the salon's day (an add-on is a service; a
 *  removed line is not) — not the number of completed appointments (a walk-in has none; a visit can hold several). */
export async function completedServiceLinesOn(db: Kysely<DB>, scope: OverviewScope, date: string, tz: string): Promise<number> {
  const Z = sql.lit(tz);
  const r: any = await db.selectFrom('ticket_service_lines as l').where('l.tenant_id', '=', scope.tenantId)
    .$if(!!scope.branchId, (qb: any) => qb.where('l.branch_id', '=', scope.branchId))
    .where('l.status', '=', 'completed').where('l.removed_at', 'is', null)
    .where(sql`(l.completed_at AT TIME ZONE ${Z})::date`, '=', sql`${date}::date`)
    .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
  return Number(r?.n || 0);
}

export class KyselyOverviewRepo implements OverviewRepo {
  constructor(private readonly db: Kysely<DB>) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;

  // adds tenant + branch scope to any query builder
  private scoped(qb: any, scope: OverviewScope): any {
    let q = qb.where('tenant_id', '=', scope.tenantId);
    if (scope.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)]));
    return q;
  }

  async getAggregate(scope: OverviewScope, q: OverviewQuery): Promise<PosOverviewResponse> {
    const base = emptyOverview(scope); // valid shape; we fill the parts backed by real tables
    // The BRANCH's day (the salon's, for an all-branches view) — Oct 6 2026. It was the UTC day: from 8 pm in New York
    // the overview opened on an empty "tomorrow", and every payment, check-in and paid ticket was filed by its UTC date.
    const tz = safeZoneName(scope.branchId ? await branchTimeZone(this.db, scope.tenantId, scope.branchId) : await tenantTimeZone(this.db, scope.tenantId));
    const Z = sql.lit(tz);   // a literal, not a parameter: the expression is repeated in GROUP BY
    const date = q.date || businessDate(tz, new Date(this.now()));
    const dayExpr = sql<string>`(created_at AT TIME ZONE ${Z})::date`;

    // --- revenue today + yesterday (payments) ---
    const rev = await this.scoped(this.db.selectFrom('payments'), scope)
      .where('status', 'in', REVENUE_STATUSES)
      .select((eb: any) => [
        eb.fn.sum(eb.case().when(dayExpr, '=', date).then(eb.ref('amount_cents')).else(0).end()).as('today'),
        eb.fn.sum(eb.case().when(dayExpr, '=', sql<string>`(${date}::date - 1)`).then(eb.ref('amount_cents')).else(0).end()).as('yest'),
      ]).executeTakeFirst().catch(() => undefined);
    const todayRev = Number(rev?.today || 0), yestRev = Number(rev?.yest || 0);
    base.kpis.todayRevenue = money(todayRev, pct(todayRev, yestRev));

    // --- payment mix (today) ---
    const mix = await this.scoped(this.db.selectFrom('payments'), scope)
      .where('status', 'in', REVENUE_STATUSES).where(dayExpr, '=', date)
      .groupBy('method').select((eb: any) => ['method', eb.fn.sum('amount_cents').as('cents')]).execute().catch(() => []);
    const mixTotal = mix.reduce((a: number, r: any) => a + Number(r.cents), 0) || 1;
    base.analytics.paymentMix = mix.map((r: any) => ({ method: r.method, amountCents: Number(r.cents), percent: Math.round((Number(r.cents) / mixTotal) * 100) }));

    // --- 7-day revenue trend ---
    const trend = await this.scoped(this.db.selectFrom('payments'), scope)
      .where('status', 'in', REVENUE_STATUSES)
      .where(dayExpr, '>=', sql<string>`(${date}::date - 6)`).where(dayExpr, '<=', date)
      .groupBy(dayExpr).select((eb: any) => [sql<string>`to_char(${dayExpr}, 'YYYY-MM-DD')`.as('date'), eb.fn.sum('amount_cents').as('cents')])   // text: a DATE column arrives as a JS Date, and String(Date) is not YYYY-MM-DD
      .orderBy('date').execute().catch(() => []);
    base.analytics.revenueTrend = trend.map((r: any) => ({ date: String(r.date), revenueCents: Number(r.cents) }));

    // --- live counts (queue + tickets) ---
    const waiting = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where('status', '=', 'waiting')
      .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    base.kpis.waitingGuests = { count: Number(waiting?.n || 0), change: 0, comparisonLabel: 'vs yesterday' };
    const serving = await this.scoped(this.db.selectFrom('tickets'), scope).where('serving_started_at', 'is not', null).where('service_done_at', 'is', null)
      .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    base.kpis.servingNow = { count: Number(serving?.n || 0), change: 0, comparisonLabel: 'vs yesterday' };
    const ready = await this.scoped(this.db.selectFrom('tickets'), scope).where('ready_checkout_at', 'is not', null).where('paid_at', 'is', null)
      .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    base.kpis.readyCheckout = { count: Number(ready?.n || 0), change: 0, comparisonLabel: 'vs yesterday' };

    // --- today's checkout facts (paid tickets + tips from payments; longest wait from the queue) ---
    const chk = await this.scoped(this.db.selectFrom('payments'), scope)
      .where('status', 'in', REVENUE_STATUSES).where(dayExpr, '=', date)
      .select((eb: any) => [sql<number>`count(distinct ticket_id)`.as('paid'), eb.fn.sum('tip_cents').as('tips')])
      .executeTakeFirst().catch(() => undefined);
    base.checkoutToday.paidTickets = Number(chk?.paid || 0);
    base.checkoutToday.tipsCents = Number(chk?.tips || 0);
    const lw = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where('status', '=', 'waiting')
      .select(() => sql<number>`coalesce(max(extract(epoch from (now() - checked_in_at)) / 60), 0)`.as('m'))
      .executeTakeFirst().catch(() => undefined);
    base.checkoutToday.longestWaitMinutes = Math.max(0, Math.round(Number(lw?.m || 0)));

    // --- technicians active / scheduled ---
    const active = await this.scoped(this.db.selectFrom('technician_statuses'), scope).where('status', 'in', ['available', 'busy'])
      .select((eb: any) => eb.fn.count(sql`distinct technician_id`).as('n')).executeTakeFirst().catch(() => undefined);
    const scheduled = await this.scoped(this.db.selectFrom('technician_shifts'), scope).where('shift_date', '=', date)
      .select((eb: any) => eb.fn.count(sql`distinct technician_id`).as('n')).executeTakeFirst().catch(() => undefined);
    base.kpis.activeTechs = { active: Number(active?.n || 0), scheduled: Number(scheduled?.n || 0) };

    // --- today's check-ins + walk-ins (canonical source: pos_queue_items — the SAME check-in records the Check-In
    //     page counts; walk-ins are source='walk_in'). Replaces the frontend's appointment-status guesswork. ---
    const ciDay = sql<string>`(checked_in_at AT TIME ZONE ${Z})::date`;
    const ciToday = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where(ciDay, '=', date).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const ciYest = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where(ciDay, '=', sql<string>`(${date}::date - 1)`).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const ciWalk = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where(ciDay, '=', date).where('source', '=', 'walk_in').select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const todayCI = Number(ciToday?.n || 0), yestCI = Number(ciYest?.n || 0), walkCI = Number(ciWalk?.n || 0);
    base.kpis.todayCheckIns = { count: todayCI, change: todayCI - yestCI, changePercent: pct(todayCI, yestCI), comparisonLabel: 'vs yesterday' };
    base.kpis.walkInsToday = { count: walkCI, change: 0, changePercent: 0, comparisonLabel: 'vs yesterday' };
    const notAssigned = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where('status', '=', 'waiting').where('assigned_technician_id', 'is', null).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);

    // --- average ticket = today's revenue ÷ PAID-ticket count (spec §6; matches Sales Reports), not appointments ---
    const paidDay = sql<string>`(paid_at AT TIME ZONE ${Z})::date`;
    const ptToday = await this.scoped(this.db.selectFrom('tickets'), scope).where(paidDay, '=', date).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const ptYest = await this.scoped(this.db.selectFrom('tickets'), scope).where(paidDay, '=', sql<string>`(${date}::date - 1)`).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const paidToday = Number(ptToday?.n || 0), paidYest = Number(ptYest?.n || 0);
    const avgToday = paidToday > 0 ? Math.round(todayRev / paidToday) : 0;
    const avgYest = paidYest > 0 ? Math.round(yestRev / paidYest) : 0;
    base.kpis.averageTicket = money(avgToday, pct(avgToday, avgYest));

    // --- satisfaction (reviews) ---
    const sat = await this.scoped(this.db.selectFrom('reviews'), scope)
      .select((eb: any) => [eb.fn.avg('rating').as('avg'), eb.fn.countAll().as('n')]).executeTakeFirst().catch(() => undefined);
    base.kpis.clientSatisfaction = { rating: Math.round(Number(sat?.avg || 0) * 10) / 10, reviewCount: Number(sat?.n || 0) };

    // --- online bookings today ---
    const online = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('source', 'in', ONLINE_SOURCES).where('appt_date', '=', date)
      .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    base.kpis.onlineBookings = { count: Number(online?.n || 0), change: 0, comparisonLabel: 'vs yesterday' };

    // --- today appointments breakdown ---
    const appts = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('appt_date', '=', date)
      .groupBy('status').select((eb: any) => ['status', eb.fn.countAll().as('n')]).execute().catch(() => []);
    const byStatus: Record<string, number> = {}; let total = 0;
    for (const r of appts) { byStatus[r.status] = Number(r.n); total += Number(r.n); }
    const completed = byStatus['completed'] || 0, noShow = byStatus['no_show'] || 0, cancelled = byStatus['cancelled'] || 0;
    base.todayAppointments = { total, completed, noShow, cancelled, remaining: Math.max(0, total - completed - noShow - cancelled), completedPercent: total ? Math.round((completed / total) * 100) : 0,
      completedServiceLines: await completedServiceLinesOn(this.db, scope, date, tz) };
    // --- walk-in status: real estimated wait (shared Check-In formula) + checked-in-not-assigned (was hardcoded 0) ---
    const avgDur = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('appt_date', '=', date).where('status', 'not in', ['cancelled', 'no_show'])
      .select((eb: any) => eb.fn.avg('duration_minutes').as('m')).executeTakeFirst().catch(() => undefined);
    const avgServiceMin = Math.round(Number(avgDur?.m || 0)) || 40; // fallback when no durations yet
    const waitingN = Number(waiting?.n || 0), activeN = Number(active?.n || 0);
    base.walkInStatus = { waiting: waitingN, estimatedWaitMinutes: estimateWaitMinutes(waitingN, avgServiceMin, activeN), checkedInNotAssigned: Number(notAssigned?.n || 0) };

    // --- top services (today, by line revenue) ---
    const topSvc = await this.scoped(this.db.selectFrom('ticket_service_lines'), scope).where(dayExpr, '=', date)
      .groupBy(['service_id', 'service_name_snapshot'])
      .select((eb: any) => ['service_id as serviceId', 'service_name_snapshot as serviceName', eb.fn.sum('line_total_cents').as('revenueCents'), eb.fn.countAll().as('count')])
      .orderBy('revenueCents', 'desc').limit(5).execute().catch(() => []);
    base.analytics.topServices = topSvc.map((r: any) => ({ serviceId: r.serviceId || '', serviceName: r.serviceName, revenueCents: Number(r.revenueCents), count: Number(r.count) }));

    // --- top technicians (today) --- qualified l.* filter (technicians join also exposes tenant_id/branch_id)
    const topTech = await this.db.selectFrom('ticket_service_lines as l').leftJoin('technicians as t', 't.id', 'l.technician_id')
      .where('l.tenant_id', '=', scope.tenantId)
      .$if(!!scope.branchId, (qb: any) => qb.where((eb: any) => eb.or([eb('l.branch_id', '=', scope.branchId), eb('l.branch_id', 'is', null)])))
      .where(sql`(l.created_at AT TIME ZONE ${Z})::date`, '=', date)
      .groupBy(['l.technician_id', 't.full_name'])
      .select((eb: any) => ['l.technician_id as technicianId', 't.full_name as technicianName', eb.fn.sum('l.line_total_cents').as('revenueCents'), eb.fn.count('l.id').as('completedServices')])
      .orderBy('revenueCents', 'desc').limit(5).execute().catch(() => []);
    // --- technician utilization: canonical shared definition (busy appt minutes / available shift|schedule minutes) ---
    const utilMap = await loadTechUtilization(this.db, { tenantId: scope.tenantId, branchId: scope.branchId }, date);
    const utilFor = (tid: string): number | null => utilMap.get(tid) ?? null;
    base.analytics.topTechnicians = topTech.map((r: any) => ({ technicianId: r.technicianId || '', technicianName: r.technicianName || r.technicianId || '', revenueCents: Number(r.revenueCents), completedServices: Number(r.completedServices), utilizationPercent: utilFor(String(r.technicianId || '')) }));

    // --- deterministic insights ---
    // Inventory low count — canonical Inventory Management system (inventory_products + per-branch location stock),
    // not the legacy inventory_items table. Sums on-hand per product (scoped to the branch when present) and counts
    // those at/below their configured reorder level.
    const low = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM (
        SELECT p.id, p.reorder_level, coalesce(sum(s.quantity_on_hand), 0) AS on_hand
        FROM inventory_products p
        LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id ${scope.branchId ? sql`AND s.branch_id = ${scope.branchId}` : sql``}
        WHERE p.tenant_id = ${scope.tenantId} AND p.archived_at IS NULL AND p.reorder_level > 0
        GROUP BY p.id, p.reorder_level
      ) q WHERE q.on_hand <= q.reorder_level`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    const onBreak = await this.scoped(this.db.selectFrom('technician_statuses'), scope).where('status', '=', 'break')
      .select((eb: any) => eb.fn.count(sql`distinct technician_id`).as('n')).executeTakeFirst().catch(() => undefined);
    base.analytics.quickInsights = [
      { type: 'high_revenue_service', title: 'High revenue service', value: base.analytics.topServices[0]?.serviceName || '—', severity: 'success' },
      { type: 'staff_on_break', title: 'Staff on break right now', value: String(Number(onBreak?.n || 0)), severity: 'warning' },
      { type: 'inventory_low', title: 'Inventory low', value: String(Number(low?.n || 0)), severity: 'danger' },
    ];

    // --- schedule preview (today's per-technician appointments → Arrivals, Live Tech Queue, Today's Appointments) ---
    // Authored against the schema; not executed this session (no live Postgres) — verify at deploy. Degrades to empty.
    let schedQb: any = this.db.selectFrom('pos_tech_appointments as a').leftJoin('technicians as t', 't.id', 'a.technician_id')
      .where('a.tenant_id', '=', scope.tenantId).where('a.appt_date', '=', date);
    if (scope.branchId) schedQb = schedQb.where((eb: any) => eb.or([eb('a.branch_id', '=', scope.branchId), eb('a.branch_id', 'is', null)]));
    const schedRows = await schedQb.select((eb: any) => [
        'a.id as appointmentId', 'a.technician_id as technicianId', 't.full_name as techName', 't.role_label as techRole', 't.avatar_url as avatarUrl',
        'a.customer_id as customerId', 'a.customer_name as customerName', 'a.services as services',
        'a.start_time as startTime', 'a.end_time as endTime', 'a.status as status', 'a.source as source', 'a.is_vip as isVip',
      ]).orderBy('a.technician_id').orderBy('a.start_time').execute().catch(() => []);
    const svcNames = (raw: any): string[] => {
      let v: any = raw;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return v ? [v] : []; } }
      if (Array.isArray(v)) return v.map((x: any) => (typeof x === 'string' ? x : x?.name || x?.serviceName)).filter(Boolean);
      return [];
    };
    // appointment amount = sum of the service line prices carried on the appointment's services jsonb (real)
    const svcAmount = (raw: any): { amountCents: number; durationMinutes: number } => {
      let v: any = raw;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return { amountCents: 0, durationMinutes: 0 }; } }
      if (Array.isArray(v)) return v.reduce((acc: any, x: any) => (typeof x === 'object' && x ? { amountCents: acc.amountCents + Number(x.priceCents ?? x.price_cents ?? 0), durationMinutes: acc.durationMinutes + Number(x.durationMinutes ?? x.duration_minutes ?? 0) } : acc), { amountCents: 0, durationMinutes: 0 });
      return { amountCents: 0, durationMinutes: 0 };
    };
    const cols = new Map<string, any>();
    for (const r of schedRows as any[]) {
      const tid = r.technicianId || 'unassigned';
      if (!cols.has(tid)) cols.set(tid, { technicianId: tid, name: r.techName || 'Unassigned', role: r.techRole || '', appointments: [] });
      const amt = svcAmount(r.services);
      cols.get(tid).appointments.push({ appointmentId: r.appointmentId, customerId: r.customerId || '', customerName: r.customerName || 'Guest', serviceNames: svcNames(r.services), startTime: r.startTime || '', endTime: r.endTime || '', status: r.status || '', source: r.source || '', isVip: !!r.isVip, amountCents: amt.amountCents, durationMinutes: amt.durationMinutes });
    }
    base.schedulePreview = { date, technicians: Array.from(cols.values()), openSlots: [] };

    base.context = { tenantId: scope.tenantId, branchId: scope.branchId || '', salonName: base.context.salonName, branchName: base.context.branchName, businessDate: date, timezone: tz };
    return base;
  }
}
