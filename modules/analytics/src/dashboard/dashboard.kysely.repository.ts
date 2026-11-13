// dashboard.kysely.repository.ts — production DashboardRepo over Postgres (Kysely). Consolidated scoped aggregate;
// every query filtered by tenant_id and (branch_id = :branchId OR :branchId IS NULL). Scope is session-derived.
import { sql, type Kysely } from 'kysely';
import { CHECK_IN_ELIGIBLE_STATUSES, REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';
// The statuses a payment counts as revenue in — the one shared list (Oct 6 2026). This screen used its own
// ['completed','paid','captured'], which left out 'approved' — the status checkout writes — so the POS Dashboard's revenue
// figures missed every payment the POS itself took.
const REVENUE = [...REVENUE_BEARING_STATUSES];
import { branchTimeZone, tenantTimeZone, safeZoneName, type DB } from '@aipowersalon/database';
import { businessDate, localDateTimeToEpochMs, addDays } from '@aipowersalon/date-time';
import { CompensationSnapshotRepository } from '@aipowersalon/workforce';
import type { DashboardRepo, DashboardScope, DashboardQuery } from './dashboard.repository';
import { emptyDashboard } from './dashboard.repository';
import type { POSDashboardState, RevenueTrendExplain, LivePriority } from './dashboard.dto';
import { buildAiInsights, hourWindowLabel } from './dashboard.dto';
import { completedServiceLinesOn } from '../overview/overview.kysely.repository';
import { OVERVIEW_WAITING_STATUSES, OVERVIEW_CLOSED_TICKET_STATUSES } from '../overview/overview-floor';

const pct = (cur: number, prev: number) => (prev <= 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10);
const ONLINE = ['online', 'online_booking', 'customer_app', 'google', 'google_booking_link', 'ai', 'ai_phone'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// §9 period window. `range` (today|week|month) drives the trend/services/payment windows the dashboard dropdowns
// select. daysBack is the inclusive lookback for point/aggregate cards; the trend series uses `points` buckets.
type RangeKey = 'today' | 'week' | 'month';
function rangeWindow(range?: string): { key: RangeKey; daysBack: number; points: number; label: string } {
  switch (range) {
    case 'today': return { key: 'today', daysBack: 0, points: 1, label: 'today' };
    case 'month': return { key: 'month', daysBack: 29, points: 30, label: 'month' };
    case 'week':
    default: return { key: 'week', daysBack: 6, points: 7, label: 'week' };
  }
}

/** Trend Explainability: the card's window vs the same-length window right before it, from the rows the card already read. */
export function explainTrend(
  series: { valueCents: number; apptCount: number; date: string }[], revByDay: Map<string, number>, apptByDay: Map<string, number>,
  o: { date: string; daysBack: number; tz: string; today: string; statuses: string[] },
): RevenueTrendExplain {
  const from = addDays(o.date, -o.daysBack), previousTo = addDays(from, -1), previousFrom = addDays(previousTo, -o.daysBack);
  let previousCents = 0, previousAppointments = 0;
  for (let d = previousFrom; d <= previousTo; d = addDays(d, 1)) { previousCents += revByDay.get(d) || 0; previousAppointments += apptByDay.get(d) || 0; }
  const currentCents = series.reduce((a, x) => a + x.valueCents, 0);
  const currentAppointments = series.reduce((a, x) => a + x.apptCount, 0);
  const peak = series.reduce<{ date: string; valueCents: number } | null>((best, x) => (x.valueCents > 0 && (!best || x.valueCents > best.valueCents) ? { date: x.date, valueCents: x.valueCents } : best), null);
  return {
    source: 'payments', statuses: [...o.statuses], appointmentSource: 'appointments', timeZone: o.tz,
    from, to: o.date, previousFrom, previousTo, days: o.daysBack + 1,
    currentCents, previousCents, changeCents: currentCents - previousCents,
    changePercent: previousCents > 0 ? Math.round(((currentCents - previousCents) / previousCents) * 1000) / 10 : null,
    currentAppointments, previousAppointments, includesToday: o.date === o.today, peakDay: peak,
  };
}

export class KyselyDashboardRepo implements DashboardRepo {
  constructor(private readonly db: Kysely<DB>) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;
  private scoped(qb: any, scope: DashboardScope): any {
    let q = qb.where('tenant_id', '=', scope.tenantId);
    if (scope.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)]));
    return q;
  }

  /** Live Operations 03 — each priority is a count of real rows past its stated threshold, with the oldest one's age. */
  private async priorities(scope: DashboardScope, tz: string, waitingGuests: number): Promise<LivePriority[]> {
    const now = new Date(this.now());
    const before = (min: number) => new Date(now.getTime() - min * 60_000);
    const age = (v: unknown) => (v ? Math.max(0, Math.floor((now.getTime() - new Date(String(v instanceof Date ? v.toISOString() : v)).getTime()) / 60_000)) : null);
    const CHECKOUT = 15, WAIT = 30, LATE = 15, MSG = 30;
    const co = await this.scoped(this.db.selectFrom('tickets'), scope).where('ready_checkout_at', 'is not', null).where('paid_at', 'is', null).where('removed_at', 'is', null)
      .where('status', 'not in', [...OVERVIEW_CLOSED_TICKET_STATUSES]).where('ready_checkout_at', '<', before(CHECKOUT))
      .select((eb: any) => [eb.fn.countAll().as('n'), eb.fn.min('ready_checkout_at').as('oldest')]).executeTakeFirst();
    const wt = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where('status', 'in', [...OVERVIEW_WAITING_STATUSES]).where('checked_in_at', '<', before(WAIT))
      .select((eb: any) => [eb.fn.countAll().as('n'), eb.fn.min('checked_in_at').as('oldest')]).executeTakeFirst();
    const av = await this.scoped(this.db.selectFrom('technician_workforce_state'), scope).where('employment_status', '=', 'active').where('clock_status', '=', 'CLOCKED_IN')
      .where('queue_status', '=', 'AVAILABLE').where('manual_unavailable', '=', false).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst();
    // the appointment's start as an instant in the branch's zone (start_time is 'HH:MM' text; a malformed one is skipped)
    const startAt = sql`((appt_date + substring(start_time from '^[0-9]{1,2}:[0-9]{2}')::time) AT TIME ZONE ${tz})`;
    const ov = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('appt_date', '=', businessDate(tz, now)).where('status', 'in', ['booked', 'confirmed'])
      .where('arrived_at', 'is', null).where(sql`start_time ~ '^[0-9]{1,2}:[0-9]{2}'`).where(startAt, '<', before(LATE))
      .select((eb: any) => [eb.fn.countAll().as('n'), eb.fn.min(startAt).as('oldest')]).executeTakeFirst();
    const mg = await this.scoped(this.db.selectFrom('communication_threads'), scope).where('status', '<>', 'closed').where('awaiting_reply_since', '<', before(MSG))
      .select((eb: any) => [eb.fn.countAll().as('n'), eb.fn.min('awaiting_reply_since').as('oldest')]).executeTakeFirst();
    const available = Number(av?.n || 0);
    return [
      { kind: 'checkout_waiting', count: Number(co?.n || 0), oldestMinutes: age(co?.oldest), thresholdMinutes: CHECKOUT, route: '/checkout' },
      { kind: 'long_wait', count: Number(wt?.n || 0), oldestMinutes: age(wt?.oldest), thresholdMinutes: WAIT, route: '/queue' },
      { kind: 'staffing_gap', count: Math.max(0, waitingGuests - available), oldestMinutes: null, thresholdMinutes: null, route: '/tech-queue' },
      { kind: 'overdue_appointment', count: Number(ov?.n || 0), oldestMinutes: age(ov?.oldest), thresholdMinutes: LATE, route: '/booking' },
      { kind: 'message_waiting', count: Number(mg?.n || 0), oldestMinutes: age(mg?.oldest), thresholdMinutes: MSG, route: '/messages' },
    ];
  }

  async getAggregate(scope: DashboardScope, q: DashboardQuery): Promise<POSDashboardState> {
    const s = emptyDashboard(scope);
    // The BRANCH's day (the salon's, for an all-branches view) — Oct 6 2026; it was the UTC day (see the overview).
    const tz = safeZoneName(scope.branchId ? await branchTimeZone(this.db, scope.tenantId, scope.branchId) : await tenantTimeZone(this.db, scope.tenantId));
    const Z = sql.lit(tz);   // a literal, not a parameter: the expression is repeated in GROUP BY
    const date = q.date || businessDate(tz, new Date(this.now()));
    const day = sql<string>`(created_at AT TIME ZONE ${Z})::date`;

    const rev = await this.scoped(this.db.selectFrom('payments'), scope).where('status', 'in', REVENUE)
      .select((eb: any) => [
        eb.fn.sum(eb.case().when(day, '=', date).then(eb.ref('amount_cents')).else(0).end()).as('today'),
        eb.fn.sum(eb.case().when(day, '=', sql<string>`(${date}::date - 1)`).then(eb.ref('amount_cents')).else(0).end()).as('yest'),
      ]).executeTakeFirst().catch(() => undefined);
    const today = Number(rev?.today || 0), yest = Number(rev?.yest || 0);
    s.kpis.todayRevenueCents = today; s.kpis.todayRevenueTrendPercent = pct(today, yest);

    // Live Operations mandate §25 (Oct 28 2026): the same authorities as the Overview / Customer Queue / Serving / Checkout
    // boards — waiting = waiting · called · assigned · ready for service; in service = status serving, not done, not
    // removed; at checkout = not paid, not closed, not removed (it counted 'waiting' only and removed / closed tickets)
    const waiting = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where('status', 'in', [...OVERVIEW_WAITING_STATUSES]).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const serving = await this.scoped(this.db.selectFrom('tickets'), scope).where('status', '=', 'serving').where('removed_at', 'is', null).where('serving_started_at', 'is not', null).where('service_done_at', 'is', null).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const ready = await this.scoped(this.db.selectFrom('tickets'), scope).where('ready_checkout_at', 'is not', null).where('paid_at', 'is', null).where('removed_at', 'is', null).where('status', 'not in', [...OVERVIEW_CLOSED_TICKET_STATUSES]).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    s.kpis.waitingGuests = Number(waiting?.n || 0); s.kpis.servingNow = Number(serving?.n || 0); s.kpis.readyCheckout = Number(ready?.n || 0);

    // §25: on duty = the workforce state (technician_workforce_state: employment active AND clocked in / on break / on shift)
    // — it counted every technician that ever had an 'available' / 'busy' row in the legacy technician_statuses log
    const active = await this.scoped(this.db.selectFrom('technician_workforce_state'), scope).where('employment_status', '=', 'active')
      .where((eb: any) => eb.or([eb('clock_status', 'in', ['CLOCKED_IN', 'ON_BREAK']), eb('shift_status', '=', 'ON_SHIFT')]))
      .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const total = await this.scoped(this.db.selectFrom('technician_shifts'), scope).where('shift_date', '=', date).select((eb: any) => eb.fn.count(sql`distinct technician_id`).as('n')).executeTakeFirst().catch(() => undefined);
    s.kpis.activeTechs = Number(active?.n || 0); s.kpis.totalTechs = Math.max(s.kpis.activeTechs, Number(total?.n || 0));

    const sat = await this.scoped(this.db.selectFrom('reviews'), scope).select((eb: any) => eb.fn.avg('rating').as('avg')).executeTakeFirst().catch(() => undefined);
    s.kpis.customerSatisfactionScore = Math.round(Number(sat?.avg || 0) * 10) / 10;

    const online = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('source', 'in', ONLINE).where('appt_date', '=', date).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    s.kpis.onlineBookings = Number(online?.n || 0);

    const appts = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('appt_date', '=', date).groupBy('status').select((eb: any) => ['status', eb.fn.countAll().as('n')]).execute().catch(() => []);
    const by: Record<string, number> = {}; let tot = 0; for (const r of appts) { by[r.status] = Number(r.n); tot += Number(r.n); }
    const comp = by['completed'] || 0, ns = by['no_show'] || 0, can = by['cancelled'] || 0;
    s.todaysAppointments = { totalAppointments: tot, completed: comp, noShow: ns, cancelled: can, remaining: Math.max(0, tot - comp - ns - can), completedPercent: tot ? Math.round((comp / tot) * 100) : 0 };
    s.walkInStatus = { waitingCount: Number(waiting?.n || 0), estimatedWaitMinutes: 0, checkedInNotAssigned: 0 };

    const win = rangeWindow(q.range);
    // the window shown plus the same-length window right before it (Trend Explainability: what changed) — one read each
    const lookback = win.daysBack * 2 + 1;
    const trend = await this.scoped(this.db.selectFrom('payments'), scope).where('status', 'in', REVENUE)
      .where(day, '>=', sql<string>`(${date}::date - ${lookback}::int)`).where(day, '<=', date)
      .groupBy(day).select((eb: any) => [sql`to_char(${day},'YYYY-MM-DD')`.as('d'), eb.fn.sum('amount_cents').as('cents')]).execute().catch(() => []);
    const apptByDay = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope)
      .where('appt_date', '>=', sql<string>`(${date}::date - ${lookback}::int)`).where('appt_date', '<=', date)
      .groupBy('appt_date').select((eb: any) => [sql`to_char(appt_date,'YYYY-MM-DD')`.as('d'), eb.fn.countAll().as('n')]).execute().catch(() => []);
    const revByDay = new Map<string, number>(trend.map((r: any) => [String(r.d), Number(r.cents)]));
    const apptDayMap = new Map<string, number>(apptByDay.map((r: any) => [String(r.d), Number(r.n)]));
    const trendBase = new Date(date + 'T00:00:00Z');
    const series = [] as { label: string; valueCents: number; apptCount: number; date: string }[];   // date: the POS labels the axis in the user's language
    // For today/week label by weekday; for month label by day-of-month to keep the axis readable.
    for (let i = win.daysBack; i >= 0; i--) {
      const dd = new Date(trendBase.getTime() - i * 86400000); const key = dd.toISOString().slice(0, 10);
      const label = win.key === 'month' ? String(dd.getUTCDate()) : DOW[dd.getUTCDay()];
      series.push({ label, valueCents: revByDay.get(key) || 0, apptCount: apptDayMap.get(key) || 0, date: key });
    }
    s.revenueTrend = { period: win.key, totalCents: series.reduce((a, x) => a + x.valueCents, 0), trendPercent: pct(today, yest), series };
    s.revenueTrend.explain = explainTrend(series, revByDay, apptDayMap, { date, daysBack: win.daysBack, tz, today: businessDate(tz, new Date(this.now())), statuses: REVENUE });

    const topSvc = await this.scoped(this.db.selectFrom('ticket_service_lines'), scope)
      .where(day, '>=', sql<string>`(${date}::date - ${win.daysBack}::int)`).where(day, '<=', date)
      .groupBy('service_name_snapshot').select((eb: any) => ['service_name_snapshot as name', eb.fn.sum('line_total_cents').as('rev')]).orderBy('rev', 'desc').limit(5).execute().catch(() => []);
    s.topServices = topSvc.map((r: any) => ({ name: r.name, revenueCents: Number(r.rev) }));

    let topTechQb: any = this.db.selectFrom('ticket_service_lines as l').leftJoin('technicians as t', 't.id', 'l.technician_id')
      .where('l.tenant_id', '=', scope.tenantId).where(sql`(l.created_at AT TIME ZONE ${Z})::date`, '=', date);
    if (scope.branchId) topTechQb = topTechQb.where((eb: any) => eb.or([eb('l.branch_id', '=', scope.branchId), eb('l.branch_id', 'is', null)]));
    const topTech = await topTechQb.groupBy(['l.technician_id', 't.full_name'])
      .select((eb: any) => ['l.technician_id as technicianId', 't.full_name as name', eb.fn.sum('l.line_total_cents').as('rev'), eb.fn.count('l.id').as('svc')]).orderBy('rev', 'desc').limit(5).execute().catch(() => []);
    // tips: each technician's SHARE from the compensation snapshot (the one tip split) over the salon's day — ONE-PAY
    // (Oct 13 2026); it used to credit tickets.tip_cents whole to the ticket's primary technician. Rating (avg approved
    // reviews), utilization (busy service-mins / scheduled shift-mins).
    const dayFrom = localDateTimeToEpochMs(date, '00:00', tz), dayTo = localDateTimeToEpochMs(addDays(date, 1), '00:00', tz);
    const snapMoney = Number.isFinite(dayFrom) && Number.isFinite(dayTo)
      ? await new CompensationSnapshotRepository(this.db).commissionByTechnician(scope.tenantId, new Date(dayFrom).toISOString(), new Date(dayTo).toISOString(), scope.branchId)
      : new Map<string, { tipsCents: number }>();
    const tipMap = new Map<string, number>([...snapMoney.entries()].map(([k, v]) => [k, Math.max(0, v.tipsCents)]));
    const ratingRows = await this.scoped(this.db.selectFrom('reviews'), scope).where('technician_id', 'is not', null)
      .groupBy('technician_id').select((eb: any) => ['technician_id as tid', eb.fn.avg('rating').as('avg')]).execute().catch(() => []);
    const ratingMap = new Map<string, number>((ratingRows as any[]).map((r) => [String(r.tid), Math.round(Number(r.avg) * 10) / 10]));
    const shiftRows = await this.scoped(this.db.selectFrom('technician_shifts'), scope).where('shift_date', '=', date)
      .select(['technician_id as tid', sql`extract(epoch from (end_time::time - start_time::time))/60`.as('mins')]).execute().catch(() => []);
    const shiftMap = new Map<string, number>((shiftRows as any[]).map((r) => [String(r.tid), Number(r.mins || 0)]));
    const busyRows = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('appt_date', '=', date).where('technician_id', 'is not', null).where('status', '<>', 'cancelled')
      .groupBy('technician_id').select((eb: any) => ['technician_id as tid', eb.fn.sum('duration_minutes').as('busy')]).execute().catch(() => []);
    const busyMap = new Map<string, number>((busyRows as any[]).map((r) => [String(r.tid), Number(r.busy || 0)]));
    s.topTechnicians = (topTech as any[]).map((r) => {
      const tid = String(r.technicianId || ''); const avail = shiftMap.get(tid) || 0; const busy = busyMap.get(tid) || 0;
      return {
        technicianId: tid, name: r.name || tid || '', revenueCents: Number(r.rev), servicesCount: Number(r.svc || 0),
        tipsCents: tipMap.get(tid) || 0, rating: ratingMap.has(tid) ? (ratingMap.get(tid) as number) : null,
        utilizationPercent: avail > 0 ? Math.min(100, Math.round((busy / avail) * 100)) : null,
      };
    });

    const mix = await this.scoped(this.db.selectFrom('payments'), scope).where('status', 'in', REVENUE)
      .where(day, '>=', sql<string>`(${date}::date - ${win.daysBack}::int)`).where(day, '<=', date)
      .groupBy('method').select((eb: any) => ['method', eb.fn.sum('amount_cents').as('cents')]).execute().catch(() => []);
    const mixTotal = mix.reduce((a: number, r: any) => a + Number(r.cents), 0) || 1;
    s.paymentMix = { period: win.key, entries: mix.map((r: any) => ({ method: r.method, percent: Math.round((Number(r.cents) / mixTotal) * 100), amountCents: Number(r.cents) })) };

    const low = await this.scoped(this.db.selectFrom('inventory_items'), scope).where(sql`quantity`, '<=', sql`low_threshold`).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const onBreak = await this.scoped(this.db.selectFrom('technician_statuses'), scope).where('status', '=', 'break').select((eb: any) => eb.fn.count(sql`distinct technician_id`).as('n')).executeTakeFirst().catch(() => undefined);
    s.quickInsights = [
      { kind: 'high_revenue_service', text: s.topServices[0]?.name || '—', tone: 'success' },
      { kind: 'staff_on_break', text: `${Number(onBreak?.n || 0)} staff on break right now`, tone: 'warning' },
      { kind: 'inventory_low', text: `${Number(low?.n || 0)} items low`, tone: 'danger' },
    ];
    s.quickActions = [
      { key: 'new_appointment', label: 'New Appointment', description: 'Book a future appointment', route: '/pos/booking' },
      { key: 'walk_in', label: 'Walk-In Check-In', description: 'Add a walk-in customer', route: '/pos/check-in' },
      { key: 'checkout', label: 'Checkout', description: 'Process payment', route: '/pos/checkout' },
    ];

    // ---- T02 modules (Kysely/production). Each query degrades to empty/zero on failure so one missing column never
    // blanks the dashboard. NOTE: authored against the schema but NOT executed this session (no live Postgres) — verify
    // against the cluster at deploy. The in-memory adapter covers dev/test.
    const monthStart = sql<string>`date_trunc('month', ${date}::date)::date`;
    const lastMonthStart = sql<string>`date_trunc('month', ${date}::date - interval '1 month')::date`;
    const lastMonthSameDay = sql<string>`(${date}::date - interval '1 month')::date`;
    const cardVol = await this.scoped(this.db.selectFrom('payments'), scope).where('status', 'in', REVENUE)
      .where('method', 'in', ['card', 'credit', 'debit', 'credit_card'])
      .select((eb: any) => [
        eb.fn.sum(eb.case().when(day, '>=', monthStart).then(eb.ref('amount_cents')).else(0).end()).as('cents'),
        eb.fn.sum(eb.case().when(sql<boolean>`${day} >= ${lastMonthStart} and ${day} <= ${lastMonthSameDay}`).then(eb.ref('amount_cents')).else(0).end()).as('lastcents'),
      ]).executeTakeFirst().catch(() => undefined);
    s.kpis.monthlyCardVolumeCents = Number(cardVol?.cents || 0);
    s.kpis.monthlyCardVolumeTrendPercent = pct(Number(cardVol?.cents || 0), Number(cardVol?.lastcents || 0));

    const checkIns = await this.scoped(this.db.selectFrom('tickets'), scope)
      .select((eb: any) => [
        eb.fn.sum(eb.case().when(day, '=', date).then(1).else(0).end()).as('n'),
        eb.fn.sum(eb.case().when(day, '=', sql<string>`(${date}::date - 1)`).then(1).else(0).end()).as('yn'),
      ]).executeTakeFirst().catch(() => undefined);
    s.kpis.checkInsToday = Number(checkIns?.n || 0);
    s.kpis.checkInsTodayTrendPercent = pct(Number(checkIns?.n || 0), Number(checkIns?.yn || 0));
    s.kpis.appointmentsToday = tot;
    const yestAppts = (apptByDay as any[]).find((r) => String(r.d) === new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10));
    s.kpis.appointmentsTodayTrendPercent = pct(tot, Number(yestAppts?.n || 0));

    const paidAgg = await this.scoped(this.db.selectFrom('tickets'), scope)
      .select((eb: any) => [
        eb.fn.sum(eb.case().when(sql`(paid_at AT TIME ZONE ${Z})::date`, '=', date).then(1).else(0).end()).as('n'),
        eb.fn.sum(eb.case().when(sql`(paid_at AT TIME ZONE ${Z})::date`, '=', sql<string>`(${date}::date - 1)`).then(1).else(0).end()).as('yn'),
      ]).executeTakeFirst().catch(() => undefined);
    const paid = Number(paidAgg?.n || 0); const paidYest = Number(paidAgg?.yn || 0);
    s.kpis.averageTicketCents = paid > 0 ? Math.round(today / paid) : 0;
    s.kpis.averageTicketTrendPercent = pct(s.kpis.averageTicketCents, paidYest > 0 ? Math.round(yest / paidYest) : 0);

    const ai = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('appt_date', '=', date).where('source', 'in', ['ai', 'ai_phone'])
      .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    s.kpis.aiBookingConversionPercent = tot > 0 ? Math.round((Number(ai?.n || 0) / tot) * 1000) / 10 : 0;

    // Today's Operations Snapshot — six operational tiles (all real, tenant/branch-scoped)
    // Live Operations mandate §25 (Oct 28 2026): the ready value is the Checkout board's open tickets (not removed / closed);
    // walk-ins are today's check-ins with source walk_in (the Check-In page's population — it counted APPOINTMENTS with
    // source manual / phone); "next 3 hours" is the BRANCH's clock (it compared to the database's UTC current_time)
    const readyVal = await this.scoped(this.db.selectFrom('tickets'), scope).where('ready_checkout_at', 'is not', null).where('paid_at', 'is', null).where('removed_at', 'is', null).where('status', 'not in', [...OVERVIEW_CLOSED_TICKET_STATUSES]).select((eb: any) => eb.fn.sum(sql`coalesce(locked_total_cents, total_cents)`).as('cents')).executeTakeFirst().catch(() => undefined);
    const walkIns = await this.scoped(this.db.selectFrom('pos_queue_items'), scope).where(sql`(checked_in_at AT TIME ZONE ${tz})::date`, '=', date).where('source', '=', 'walk_in').select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const branchNow = sql`(now() AT TIME ZONE ${tz})::time`;
    const upcoming = await this.scoped(this.db.selectFrom('pos_tech_appointments'), scope).where('appt_date', '=', date).where('status', 'in', [...CHECK_IN_ELIGIBLE_STATUSES])   // Decision 38: an arrived customer is still upcoming
      .where(sql`start_time::time`, '>=', branchNow).where(sql`start_time::time`, '<=', sql`${branchNow} + interval '3 hours'`).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const wiCount = Number(walkIns?.n || 0); const ciToday = s.kpis.checkInsToday;
    s.operationsSnapshot = {
      waitingGuests: s.kpis.waitingGuests, estWaitMinutes: s.walkInStatus.estimatedWaitMinutes,
      walkInsToday: wiCount, walkInPercent: ciToday > 0 ? Math.round((wiCount / ciToday) * 100) : 0,
      readyCheckout: s.kpis.readyCheckout, readyCheckoutValueCents: Number(readyVal?.cents || 0),
      completedServices: await completedServiceLinesOn(this.db, scope, date, tz), noShows: s.todaysAppointments.noShow,   // service lines done today (wave 4 pilot)
      noShowPercent: s.todaysAppointments.totalAppointments > 0 ? Math.round((s.todaysAppointments.noShow / s.todaysAppointments.totalAppointments) * 100) : 0,
      upcomingNext3h: Number(upcoming?.n || 0),
    };

    // Live Operations 03 — Smart Priority strip (the salon's today only; a past/future day has no "now")
    if (date === businessDate(tz, new Date(this.now()))) s.priorities = await this.priorities(scope, tz, s.kpis.waitingGuests);

    // Live Salon Activity — tickets currently being served, with guest/service/technician + elapsed minutes.
    // Filter on qualified tk.* columns: customers/technicians joins also expose tenant_id/branch_id (ambiguous otherwise).
    let liveQb: any = this.db.selectFrom('tickets as tk')
      .leftJoin('customers as c', 'c.id', 'tk.customer_id').leftJoin('technicians as t', 't.id', 'tk.primary_technician_id')
      .where('tk.tenant_id', '=', scope.tenantId)
      .where('tk.serving_started_at', 'is not', null)
      .where('tk.service_done_at', 'is', null)
      // §25: the Active Services KPI's own population (status serving, not removed) — so the card and the KPI agree
      .where('tk.status', '=', 'serving').where('tk.removed_at', 'is', null);
    if (scope.branchId) liveQb = liveQb.where((eb: any) => eb.or([eb('tk.branch_id', '=', scope.branchId), eb('tk.branch_id', 'is', null)]));
    const liveRows = await liveQb.select((eb: any) => [
      'tk.serving_started_at as startedAt', 'c.full_name as guest', 't.full_name as tech',
      eb.selectFrom('ticket_service_lines as sl').select('sl.service_name_snapshot').whereRef('sl.ticket_id', '=', 'tk.id').whereRef('sl.tenant_id', '=', 'tk.tenant_id').where('sl.removed_at', 'is', null).limit(1).as('serviceName'),
      sql<number>`count(*) OVER ()`.as('total'),
    ]).orderBy('tk.serving_started_at').limit(8).execute().catch(() => []);
    const liveFirst: { total?: number | string } | undefined = liveRows[0];
    s.liveActivityTotal = Number(liveFirst?.total || 0);
    const nowMs = Date.now();
    s.liveActivity = (liveRows as any[]).map((r) => {
      const st = r.startedAt ? new Date(r.startedAt) : null;
      return { startedAt: st ? st.toISOString() : null, time: st ? st.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '', guestName: r.guest || 'Guest', serviceName: r.serviceName || '—', technicianName: r.tech || '—', status: 'in_progress', elapsedMinutes: st ? Math.max(0, Math.round((nowMs - st.getTime()) / 60000)) : 0 };
    });

    // Customer Retention — returning / new / inactive from per-customer ticket history (60-day inactivity window)
    const perCustomer = await this.scoped(this.db.selectFrom('tickets'), scope).where('customer_id', 'is not', null)
      .groupBy('customer_id').select((eb: any) => ['customer_id', eb.fn.countAll().as('visits'), eb.fn.min('created_at').as('firstV'), eb.fn.max('created_at').as('lastV')]).execute().catch(() => []);
    {
      const monthStartMs = new Date(date.slice(0, 8) + '01T00:00:00Z').getTime();
      const cutoffMs = new Date(date + 'T00:00:00Z').getTime() - 60 * 86400000;
      let ret = 0, fresh = 0, inact = 0;
      for (const r of perCustomer) {
        const visits = Number(r.visits || 0); const first = new Date(r.firstV).getTime(); const last = new Date(r.lastV).getTime();
        if (last < cutoffMs) inact++; else if (first >= monthStartMs && visits <= 1) fresh++; else ret++;
      }
      const total = perCustomer.length; const p = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
      s.customerRetention = { returningPercent: p(ret), returningCount: ret, newPercent: p(fresh), newCount: fresh, inactivePercent: p(inact), inactiveCount: inact, totalCustomers: total };
      s.kpis.customerRetentionPercent = s.customerRetention.returningPercent;
    }

    // Multi-Location Snapshot — per-branch revenue + check-ins across the whole tenant (branch scope intentionally dropped)
    // Live Operations mandate §24 (Oct 28 2026): only the branches this person may see (request authz) — a manager limited to
    // two salons saw every branch's revenue here
    let branchQ: any = this.db.selectFrom('branches').where('tenant_id', '=', scope.tenantId).where('status', '<>', 'archived');
    if (scope.branchIds) branchQ = scope.branchIds.length ? branchQ.where('id', 'in', scope.branchIds) : branchQ.where(sql<boolean>`false`);
    const branchRows: { id: string; name: string }[] = await branchQ.select(['id', 'name']).execute().catch(() => []);
    if (branchRows.length > 1) {
      const tToday = await this.db.selectFrom('payments').where('tenant_id', '=', scope.tenantId).where('status', 'in', REVENUE).where(day, '=', date).groupBy('branch_id').select((eb: any) => ['branch_id', eb.fn.sum('amount_cents').as('cents')]).execute().catch(() => []);
      const tYest = await this.db.selectFrom('payments').where('tenant_id', '=', scope.tenantId).where('status', 'in', REVENUE).where(day, '=', sql<string>`(${date}::date - 1)`).groupBy('branch_id').select((eb: any) => ['branch_id', eb.fn.sum('amount_cents').as('cents')]).execute().catch(() => []);
      const ci = await this.db.selectFrom('tickets').where('tenant_id', '=', scope.tenantId).where(day, '=', date).groupBy('branch_id').select((eb: any) => ['branch_id', eb.fn.countAll().as('n')]).execute().catch(() => []);
      const rev = new Map<string, number>(tToday.map((r) => [r.branch_id, Number(r.cents)]));
      const yMap = new Map<string, number>(tYest.map((r) => [r.branch_id, Number(r.cents)]));
      const ciMap = new Map<string, number>(ci.map((r) => [r.branch_id, Number(r.n)]));
      s.multiLocation = branchRows.map((b) => ({ branchId: b.id, branchName: b.name, revenueCents: rev.get(b.id) || 0, checkIns: ciMap.get(b.id) || 0, trendPercent: pct(rev.get(b.id) || 0, yMap.get(b.id) || 0) }))
        .sort((a, b) => b.revenueCents - a.revenueCents);
    }

    // ---- AI Insights (operational intelligence; deterministic, from the real aggregate) ----
    // Busiest hour today → 2-hour peak window. start_time is "HH:MM" text, so parse the hour with split_part.
    const peakRes = await sql<{ hr: number; n: number }>`
      SELECT split_part(start_time, ':', 1)::int AS hr, count(*)::int AS n
      FROM pos_tech_appointments
      WHERE tenant_id = ${scope.tenantId} ${scope.branchId ? sql`AND (branch_id = ${scope.branchId} OR branch_id IS NULL)` : sql``}
        AND appt_date = ${date}::date AND status <> 'cancelled' AND start_time ~ '^[0-9]'
      GROUP BY hr ORDER BY n DESC, hr ASC LIMIT 1`.execute(this.db).catch(() => undefined);
    const peakHour = peakRes?.rows?.[0]?.hr != null ? Number(peakRes.rows[0].hr) : undefined;
    // Rebooking-due: customers whose most recent paid visit is >30 days ago and who have no upcoming appointment.
    const rebookRes = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM (
        SELECT customer_id, max(paid_at) AS last_paid FROM tickets
        WHERE tenant_id = ${scope.tenantId} ${scope.branchId ? sql`AND (branch_id = ${scope.branchId} OR branch_id IS NULL)` : sql``}
          AND customer_id IS NOT NULL AND paid_at IS NOT NULL
        GROUP BY customer_id HAVING max(paid_at) < now() - interval '30 days'
      ) q WHERE NOT EXISTS (
        SELECT 1 FROM pos_tech_appointments a WHERE a.tenant_id = ${scope.tenantId}
          AND a.customer_id = q.customer_id AND a.appt_date >= ${date}::date AND a.status <> 'cancelled')`.execute(this.db).catch(() => undefined);
    const understaffed = s.operationsSnapshot.estWaitMinutes >= 15 && s.kpis.activeTechs < s.kpis.totalTechs;
    s.aiInsights = buildAiInsights({
      peakWindowLabel: peakHour != null ? hourWindowLabel(peakHour, 2) : undefined, peakHour,
      peakServiceName: s.topServices[0]?.name,
      suggestExtraTech: understaffed,
      staffingWindowLabel: peakHour != null ? hourWindowLabel(peakHour, 3) : undefined,
      rebookingDue: Number(rebookRes?.rows?.[0]?.n || 0),
      lowStockCount: Number(low?.n || 0),
      // missedCalls / upsellEligible: no real source in the current schema — intentionally omitted in production
      // (the dev fixture supplies them for 1:1 parity). Wire when a call log / add-on eligibility model exists.
    });

    s.context = { tenantId: scope.tenantId, branchId: scope.branchId || '', salonName: s.context.salonName, branchName: s.context.branchName };
    return s;
  }
}
