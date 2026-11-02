// overview-floor.ts — the POS Overview's pure server-side rules (Overview 27-inch mandate, Oct 28 2026). Unit-tested in
// overview-floor.vitest.spec.ts; used by the Postgres aggregate (overview.kysely.repository.ts) and the live board
// (overview-board.service.ts). The screen renders these answers — it no longer derives stages, lists or insights from
// whichever appointment rows it happened to load (§27).
import type { QuickInsight, RevenueTrendPoint } from './overview.dto';
import { stockStatus } from '@aipowersalon/inventory';
import { addDays } from '@aipowersalon/date-time';

/** §11–§15, §18, §21: a card shows its top rows and the server's TOTAL — never every record. */
export const OVERVIEW_TOP_ROWS = { arrivals: 7, liveTechQueue: 6, readyForAssignment: 5, readyForCheckout: 5, reminders: 6, messages: 6, inventoryAlerts: 6 } as const;
export const OVERVIEW_INSIGHTS_MAX = 5;

/** The queue statuses the Customer Queue counts as waiting (the same population as its "Guests Waiting" KPI). */
export const OVERVIEW_WAITING_STATUSES = ['waiting', 'called', 'assigned', 'ready_for_tech'] as const;
/** Ticket statuses that are closed — never "active" or "ready for checkout" (the Checkout board's own list). */
export const OVERVIEW_CLOSED_TICKET_STATUSES = ['paid', 'void', 'voided', 'cancelled', 'canceled', 'refunded', 'closed'] as const;

/** §17: the 7-day trend has a point for EVERY day (a day with no sale is 0, not a missing point that bends the line). */
export function fillRevenueTrend(points: RevenueTrendPoint[], endDate: string, days = 7): RevenueTrendPoint[] {
  const by = new Map(points.map((p) => [String(p.date).slice(0, 10), Number(p.revenueCents) || 0]));
  const end = Date.UTC(Number(endDate.slice(0, 4)), Number(endDate.slice(5, 7)) - 1, Number(endDate.slice(8, 10)));
  if (!Number.isFinite(end)) return points;
  const out: RevenueTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) { const d = addDays(endDate.slice(0, 10), -i); out.push({ date: d, revenueCents: by.get(d) ?? 0 }); }
  return out;
}

/** §12: minutes left on a live service = its own line durations − time in service (paused time excluded); null when the
 *  visit carries no duration (never a universal default). */
export function liveMinutesLeft(startedAtMs: number | null, pausedMs: number, durationMinutes: number, nowMs: number): number | null {
  if (!startedAtMs || !(durationMinutes > 0)) return null;
  const elapsed = Math.max(0, (nowMs - startedAtMs - Math.max(0, pausedMs || 0)) / 60000);
  return Math.max(0, Math.round(durationMinutes - elapsed));
}

/** §21: the Inventory module's own thresholds (inventory-core.stockStatus) with the branch's overrides. */
export function inventoryAlertStatus(onHand: number, reorderLevel: number, criticalLevel: number | null): 'out' | 'critical' | 'low' | null {
  const s = stockStatus(onHand, reorderLevel, null, criticalLevel);
  return s === 'out_of_stock' ? 'out' : s === 'critical' ? 'critical' : s === 'low' ? 'low' : null;
}
const SEVERITY_RANK: Record<string, number> = { out: 0, critical: 1, low: 2 };
export const inventoryAlertOrder = (a: { status: string; stock: number; reorderLevel: number }, b: { status: string; stock: number; reorderLevel: number }) =>
  (SEVERITY_RANK[a.status] ?? 9) - (SEVERITY_RANK[b.status] ?? 9) || (a.stock / Math.max(1, a.reorderLevel)) - (b.stock / Math.max(1, b.reorderLevel));

export interface OverviewInsightFacts {
  longestWaitMinutes: number; waitingGuests: number; averageServiceMinutes: number;
  readyForCheckout: number; staffOnBreak: number; onDuty: number; lowInventory: number;
  topServiceName: string | null; topServiceRevenueCents: number;
  appointmentsRemaining: number; unassignedWaiting: number; availableTechnicians: number;
}
/** `vars` = the numbers / name in the text: the POS words the insight from `id` + `vars` in the user's language */
export type OverviewInsight = QuickInsight & { id: string; route?: string; vars?: Record<string, string | number> };

/**
 * §16: advisory insights — at most five, only when there is something to say, in a fixed priority order. Each one names
 * WHERE to act (`route`); none of them changes checkout, payroll, inventory, assignments or appointments by itself.
 * The `type` codes the flat summary projection reads (high_revenue_service, staff_on_break, inventory_low) are kept.
 */
export function buildOverviewInsights(f: OverviewInsightFacts): OverviewInsight[] {
  const out: OverviewInsight[] = [];
  const longWait = Math.max(20, Math.round(f.averageServiceMinutes / 2));
  if (f.waitingGuests > 0 && f.longestWaitMinutes >= longWait) out.push({ id: 'long_wait', type: 'unusual_wait', title: 'Unusual wait time', value: `${f.longestWaitMinutes} min longest wait · ${f.waitingGuests} waiting`, severity: 'danger', route: '/queue', vars: { minutes: f.longestWaitMinutes, waiting: f.waitingGuests } });
  if (f.unassignedWaiting > 0 && f.availableTechnicians > 0) out.push({ id: 'unassigned', type: 'unassigned_guests', title: 'Guests waiting for a technician', value: `${f.unassignedWaiting} unassigned · ${f.availableTechnicians} available`, severity: 'warning', route: '/queue?assign=1', vars: { count: f.unassignedWaiting, free: f.availableTechnicians } });
  if (f.readyForCheckout >= 3) out.push({ id: 'checkout_backlog', type: 'checkout_backlog', title: 'Guests ready for checkout', value: `${f.readyForCheckout} waiting to pay`, severity: 'warning', route: '/checkout', vars: { count: f.readyForCheckout } });
  if (f.lowInventory > 0) out.push({ id: 'inventory_low', type: 'inventory_low', title: 'Inventory low', value: `${f.lowInventory} product${f.lowInventory === 1 ? '' : 's'} at or below reorder`, severity: 'danger', route: '/tenant/inventory', vars: { count: f.lowInventory } });
  if (f.staffOnBreak > 0) out.push({ id: 'staff_on_break', type: 'staff_on_break', title: 'Staff on break right now', value: `${f.staffOnBreak} of ${f.onDuty} on duty`, severity: 'info', route: '/technicians', vars: { count: f.staffOnBreak, onDuty: f.onDuty } });
  if (f.topServiceName && f.topServiceRevenueCents > 0) out.push({ id: 'high_revenue_service', type: 'high_revenue_service', title: 'High revenue service', value: f.topServiceName, severity: 'success', route: '/reports', vars: { name: f.topServiceName } });
  if (f.appointmentsRemaining === 0 && f.onDuty > 0 && f.waitingGuests === 0) out.push({ id: 'booking_opportunity', type: 'booking_opportunity', title: 'Booking opportunity', value: 'No more appointments today — open slots for walk-ins and online booking', severity: 'info', route: '/booking' });
  return out.slice(0, OVERVIEW_INSIGHTS_MAX);
}

/** §28: every KPI's business definition — population, window and state (also in the status report). */
export const OVERVIEW_KPI_DEFINITIONS: Record<string, string> = {
  todayCheckIns: "Queue entries checked in on the branch's business day (pos_queue_items.checked_in_at in the branch zone) — the Check-In page's population.",
  waitingGuests: 'Active queue entries in waiting / called / assigned / ready_for_tech, now — the Customer Queue "Guests Waiting" KPI.',
  walkInsToday: "Of today's check-ins, source = walk_in.",
  servingNow: 'Tickets in service now: status serving, serving_started_at set, service_done_at not set, not removed (paused services included).',
  readyCheckout: 'Tickets at checkout now: ready_checkout_at set, not paid, not closed (paid / void / cancelled / refunded), not removed — any age.',
  todayRevenue: "Payments in approved / partial / paid / captured (REVENUE_BEARING_STATUSES) created on the branch's business day; failed, cancelled and unresolved payments never count.",
  averageTicket: "Today's revenue ÷ tickets paid on the branch's business day (paid_at); 0 with no paid ticket.",
  staffOnDuty: 'Active technicians whose workforce state is clocked in, on break or on shift (technician_workforce_state) — not merely employed; ÷ technicians with a shift today (at least the on-duty count).',
};
