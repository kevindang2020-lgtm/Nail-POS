// dashboard-kpi-check.ts — AI PowerSalon Live Operations 04: KPI Accuracy & Reconciliation Checker. PURE.
//
// For each Live Operations KPI: the value the screen was served (the 30-second cached aggregate), the SAME calculation run
// fresh right now, and the authority's value for the same branch / salon day / payment-state rules — the Overview board,
// whose floor and revenue definitions the Live Operations mandate §25 names as the ones Live Operations must equal. The
// verdict is never a guess:
//   match        shown = fresh = authority
//   stale_cache  shown ≠ fresh while fresh = authority → the cache is older than the data (it self-heals within its TTL)
//   mismatch     fresh ≠ authority → the two definitions disagree (a wiring bug to fix — never hidden)
//   not_checked  the KPI has no second source to verify it against (never reported as a pass)
import type { LiveOpsKpiCheck, LiveOpsKpiCheckRow } from '@aipowersalon/api-contracts/tenant';
import type { POSDashboardState } from './dashboard.dto';
import type { PosOverviewResponse } from '../overview/overview.dto';

type Unit = LiveOpsKpiCheckRow['unit'];
interface KpiDef { kpi: string; unit: Unit; pick: (s: POSDashboardState) => number; authority?: (o: PosOverviewResponse) => number; definition: string }

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export const LIVE_OPS_KPIS: KpiDef[] = [
  { kpi: 'todayRevenueCents', unit: 'cents', pick: (s) => n(s.kpis.todayRevenueCents), authority: (o) => n(o.kpis.todayRevenue?.amountCents), definition: 'payments in the revenue-bearing statuses, dated by the branch day of the payment' },
  { kpi: 'averageTicketCents', unit: 'cents', pick: (s) => n(s.kpis.averageTicketCents), authority: (o) => n(o.kpis.averageTicket?.amountCents), definition: "today's revenue ÷ tickets paid on the branch day" },
  { kpi: 'waitingGuests', unit: 'count', pick: (s) => n(s.kpis.waitingGuests), authority: (o) => n(o.kpis.waitingGuests?.count), definition: 'queue items waiting · called · assigned · ready for service' },
  { kpi: 'servingNow', unit: 'count', pick: (s) => n(s.kpis.servingNow), authority: (o) => n(o.kpis.servingNow?.count), definition: 'tickets in service: started, not done, not removed' },
  { kpi: 'readyCheckout', unit: 'count', pick: (s) => n(s.kpis.readyCheckout), authority: (o) => n(o.kpis.readyCheckout?.count), definition: 'tickets ready for checkout: not paid, not closed, not removed' },
  { kpi: 'activeTechs', unit: 'count', pick: (s) => n(s.kpis.activeTechs), authority: (o) => n(o.kpis.activeTechs?.active), definition: 'technicians on duty by the workforce state (clocked in, on break or on shift)' },
  { kpi: 'checkInsToday', unit: 'count', pick: (s) => n(s.kpis.checkInsToday), authority: (o) => n(o.kpis.todayCheckIns?.count), definition: 'check-ins (queue items) dated by the branch day' },
  { kpi: 'onlineBookings', unit: 'count', pick: (s) => n(s.kpis.onlineBookings), authority: (o) => n(o.kpis.onlineBookings?.count), definition: 'appointments on the day booked through an online channel' },
  { kpi: 'customerSatisfactionScore', unit: 'rating', pick: (s) => n(s.kpis.customerSatisfactionScore), authority: (o) => n(o.kpis.clientSatisfaction?.rating), definition: 'average review rating' },
  { kpi: 'appointmentsToday', unit: 'count', pick: (s) => n(s.kpis.appointmentsToday), definition: 'booking calendar rows on the day (every status)' },
  { kpi: 'monthlyCardVolumeCents', unit: 'cents', pick: (s) => n(s.kpis.monthlyCardVolumeCents), definition: 'card payments this month' },
  { kpi: 'customerRetentionPercent', unit: 'count', pick: (s) => n(s.kpis.customerRetentionPercent), definition: 'returning customers share' },
  { kpi: 'aiBookingConversionPercent', unit: 'count', pick: (s) => n(s.kpis.aiBookingConversionPercent), definition: 'AI bookings conversion' },
];

export function reconcileKpis(input: { shown: POSDashboardState; fresh: POSDashboardState; authority: PosOverviewResponse | null; checkedAt: string; branchId: string | null; businessDate: string; cacheTtlSeconds: number }): LiveOpsKpiCheck {
  const rows: LiveOpsKpiCheckRow[] = LIVE_OPS_KPIS.map((d) => {
    const shown = d.pick(input.shown), fresh = d.pick(input.fresh);
    const av = d.authority && input.authority ? d.authority(input.authority) : null;
    if (av == null) return { kpi: d.kpi, unit: d.unit, shown, fresh, authority: null, authorityValue: null, status: 'not_checked', reason: 'no_second_source', definition: d.definition };
    const status = fresh !== av ? 'mismatch' : shown !== fresh ? 'stale_cache' : 'match';
    return { kpi: d.kpi, unit: d.unit, shown, fresh, authority: 'overview_board', authorityValue: av, status, reason: status === 'mismatch' ? 'definition_differs' : status === 'stale_cache' ? 'cache_older_than_data' : 'same_value', definition: d.definition };
  });
  const ex = input.fresh.revenueTrend?.explain;
  return {
    checkedAt: input.checkedAt,
    scope: { branchId: input.branchId, timeZone: ex?.timeZone ?? input.authority?.context?.timezone ?? null, businessDate: input.businessDate, revenueStatuses: ex?.statuses ?? [], revenueDateBasis: 'payment_created_branch_day' },
    cacheTtlSeconds: input.cacheTtlSeconds, rows,
    summary: { match: rows.filter((r) => r.status === 'match').length, staleCache: rows.filter((r) => r.status === 'stale_cache').length, mismatch: rows.filter((r) => r.status === 'mismatch').length, notChecked: rows.filter((r) => r.status === 'not_checked').length },
  };
}
