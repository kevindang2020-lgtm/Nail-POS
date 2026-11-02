import { taxCents as taxOf } from '@aipowersalon/money';
import type { Money } from '@aipowersalon/money';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
import { centsToUsd, taxCents } from '@aipowersalon/money';
export { centsToUsd };   // owned by @aipowersalon/money (Constitution 13 §86)
// overview.dto.ts — AIPowerSalon POS Overview (`GET /pos/overview/state`). Tenant business-summary page.
// Context (tenantId/branchId/userId/role) is resolved from the session — never sent by the client (§8).
// Overview ≠ Dashboard: this is high-level business visibility; Dashboard is the live command center.


export interface MoneyKpi { amountCents: Money; displayAmount: string; changePercent: number; comparisonLabel: string; }
export interface CountKpi { count: number; change: number; changePercent?: number; comparisonLabel: string; }

export interface ScheduleAppointment {
  appointmentId: string; customerId: string; customerName: string; serviceNames: string[];
  startTime: string; endTime: string; status: string; source: string; isVip?: boolean;
  amountCents: Money; durationMinutes: number;
}
export interface TechnicianScheduleColumn {
  technicianId: string; name: string; role: string; avatarUrl?: string; colorKey?: string;
  appointments: ScheduleAppointment[];
}
export interface OpenSlot { technicianId: string; startTime: string; endTime: string; }

export interface CurrentTicketSummary {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerPhone: string;
  loyaltyLabel?: string; checkedInAt?: string; technicianName?: string;
  services: { name: string; priceCents: Money }[];
  subtotalCents: Money; taxCents: Money; totalCents: Money; status: string;
}
export interface GuestSnapshot { customerId: string; totalVisits: number; lastVisitDate?: string; totalSpentCents: Money; loyaltyPoints: number; }

export interface RevenueTrendPoint { date: string; revenueCents: Money; }
export interface TopServiceSummary { serviceId: string; serviceName: string; revenueCents: Money; count: number; }
export interface TopTechnicianSummary { technicianId: string; technicianName: string; revenueCents: Money; completedServices: number; utilizationPercent: number | null; }
export interface PaymentMixSummary { method: "card" | "cash" | "gift_card" | "split" | "other"; amountCents: Money; percent: number; }
/** Overview mandate §16: `id` + `route` (where staff act on it) — advisory; nothing is changed by an insight itself. */
export interface QuickInsight { type: string; title: string; value?: string; severity: "info" | "success" | "warning" | "danger"; id?: string; route?: string; vars?: Record<string, string | number>; }

export interface PosOverviewResponse {
  context: { tenantId: string; branchId: string; salonName: string; branchName: string; businessDate: string; timezone: string; };
  kpis: {
    todayRevenue: MoneyKpi;
    todayCheckIns: CountKpi;
    walkInsToday: CountKpi;
    averageTicket: MoneyKpi;
    waitingGuests: CountKpi;
    servingNow: CountKpi;
    readyCheckout: CountKpi;
    /** active = on duty by the workforce state (OVERVIEW_KPI_DEFINITIONS.staffOnDuty); onBreak = of those, on break */
    activeTechs: { active: number; scheduled: number; onBreak?: number };
    clientSatisfaction: { rating: number; reviewCount: number };
    onlineBookings: CountKpi;
  };
  schedulePreview: { date: string; technicians: TechnicianScheduleColumn[]; openSlots: OpenSlot[] };
  /** completedServiceLines: service lines finished today (wave 4 pilot) — what "completed services" means. */
  todayAppointments: { total: number; completed: number; noShow: number; cancelled: number; remaining: number; completedPercent: number; completedServiceLines: number };
  walkInStatus: { waiting: number; estimatedWaitMinutes: number; checkedInNotAssigned: number };
  currentTicket: CurrentTicketSummary | null;
  guestSnapshot: GuestSnapshot | null;
  analytics: {
    revenueTrend: RevenueTrendPoint[];
    topServices: TopServiceSummary[];
    topTechnicians: TopTechnicianSummary[];
    paymentMix: PaymentMixSummary[];
    quickInsights: QuickInsight[];
  };
  /** Today's checkout facts sourced from the payments + queue tables (paidTickets/tips/longestWait). */
  checkoutToday: { paidTickets: number; tipsCents: Money; longestWaitMinutes: number };
}

// online booking sources that count toward the Online Bookings KPI
export const ONLINE_SOURCES = ["online_booking", "customer_app", "google_booking_link", "ai_phone"];

// ===== pure helpers (unit-testable) =====

export function changePercent(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
export function completedPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}
export function ticketTotals(lines: { priceCents: Money }[], taxRatePercent: number): { subtotalCents: Money; taxCents: Money; totalCents: Money } {
  const subtotalCents = lines.reduce(function (a, l) { return a + l.priceCents; }, 0);
  const taxCents = taxOf(subtotalCents, taxRatePercent);
  return { subtotalCents: subtotalCents, taxCents: taxCents, totalCents: subtotalCents + taxCents };
}
// payment mix percentages (largest-remainder so they sum to 100)
export function paymentMixPercentages(amounts: { method: PaymentMixSummary["method"]; amountCents: Money }[]): PaymentMixSummary[] {
  const total = amounts.reduce(function (a, x) { return a + x.amountCents; }, 0);
  if (total <= 0) return amounts.map(function (x) { return { method: x.method, amountCents: x.amountCents, percent: 0 }; });
  const f = amounts.map(function (x) { const e = (x.amountCents / total) * 100; return { method: x.method, amountCents: x.amountCents, percent: Math.floor(e), rem: e - Math.floor(e) }; });
  let used = f.reduce(function (a, r) { return a + r.percent; }, 0);
  f.sort(function (a, b) { return b.rem - a.rem; });
  let i = 0; while (used < 100 && i < f.length) { f[i].percent += 1; used += 1; i += 1; }
  return f.map(function (r) { return { method: r.method, amountCents: r.amountCents, percent: r.percent }; });
}
export function estimateWaitMinutes(waitingCount: number, avgServiceMinutes: number, availableTechs: number): number {
  if (availableTechs <= 0) return waitingCount * avgServiceMinutes;
  return Math.round((waitingCount / availableTechs) * avgServiceMinutes);
}
// busiest window: hour bucket with the most appointments -> "2PM - 6PM" style label
export function busiestWindow(startHours: number[]): string | null {
  if (!startHours.length) return null;
  const counts: { [h: number]: number } = {};
  startHours.forEach(function (h) { counts[h] = (counts[h] || 0) + 1; });
  let peak = startHours[0];
  Object.keys(counts).forEach(function (k) { if (counts[+k] > counts[peak]) peak = +k; });
  function lab(h: number) { const ap = h >= 12 ? "PM" : "AM"; return (h % 12 || 12) + ap; }
  return lab(peak) + " - " + lab(peak + 4);
}

// ===========================================================================
// Spec §8 contract: POSOverviewState — a flatter projection of PosOverviewResponse.
// ONE source of truth = the aggregate above; this is a derived shape (toPosOverviewState).
// Use whichever the caller prefers; the controller can serve either at /pos/overview/state.
// ===========================================================================

export interface POSOverviewAlert {
  id: string;
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  message?: string;
  route?: string;
}

export interface POSOverviewState {
  kpis: {
    todayRevenueCents: number; waitingGuests: number; servingNow: number; readyCheckout: number;
    activeTechs: number; totalTechsOnSchedule: number; clientSatisfaction: number; onlineBookings: number;
  };
  todaySummary: {
    checkIns: number; appointments: number; walkIns: number; completedServices: number;
    openTickets: number; cancelledAppointments: number; noShows: number;
  };
  queue: { waiting: number; averageWaitMinutes: number; longestWaitMinutes: number };
  serving: { inService: number; nearingCompletion: number; delayedServices: number };
  checkout: { readyForPayment: number; paidTickets: number; tipsTodayCents: number; surchargeCollectedCents: number };
  revenueTrend: { points: { label: string; amountCents: number }[] };
  topServices: { items: { serviceId: string; name: string; revenueCents: number; count: number }[] };
  topTechnicians: { items: { technicianId: string; name: string; revenueCents: number; servicesDone: number }[] };
  paymentMix: {
    cardPercent: number; cardAmountCents: number; cashPercent: number; cashAmountCents: number;
    otherPercent: number; otherAmountCents: number;
  };
  insights: {
    busiestTimeToday?: string; highRevenueService?: string; staffOnBreakCount?: number;
    inventoryLowCount?: number; messages: string[];
  };
  alerts: POSOverviewAlert[];
  moduleStatus?: {
    moduleKey: "aipowersalon-pos-overview";
    completionPercent: number;
    status: "Complete" | "In Progress" | "Needs Review" | "Blocked" | "Not Started";
    missingReasons: string[];
  };
}

function pickMix(mix: PaymentMixSummary[], method: PaymentMixSummary["method"]): { amountCents: Money; percent: number } {
  const m = mix.find((x) => x.method === method);
  return { amountCents: m ? m.amountCents : 0, percent: m ? m.percent : 0 };
}

/** Project the spec's flatter POSOverviewState from the canonical aggregate.
 *  Fields the aggregate does not yet source (paidTickets, tips, surcharge, longestWait,
 *  nearingCompletion, delayed, checkIns/walkIns/openTickets) are derived where a real proxy
 *  exists and otherwise reported in moduleStatus.missingReasons — never faked. */
export function toPosOverviewState(res: PosOverviewResponse): POSOverviewState {
  const k = res.kpis;
  const ta = res.todayAppointments;
  const card = pickMix(res.analytics.paymentMix, "card");
  const cash = pickMix(res.analytics.paymentMix, "cash");
  const otherAmt = res.analytics.paymentMix
    .filter((m) => m.method !== "card" && m.method !== "cash")
    .reduce((a, m) => a + m.amountCents, 0);
  const otherPct = Math.max(0, 100 - card.percent - cash.percent);

  const byType = (t: string) => res.analytics.quickInsights.find((q) => q.type === t);
  const busiest = byType("busiest_window");
  const highRev = byType("high_revenue_service");
  const onBreak = byType("staff_on_break");
  const lowInv = byType("inventory_low");

  const missing: string[] = [];
  const checkoutPaid = res.checkoutToday.paidTickets, tips = res.checkoutToday.tipsCents, surcharge = 0;
  if (res.currentTicket === null) missing.push("currentTicket: none open (expected when idle)");
  missing.push("checkout.surchargeCollectedCents: source from payments aggregate");
  missing.push("serving.nearingCompletion/delayedServices: source from serving services (needs service-duration model)");

  return {
    kpis: {
      todayRevenueCents: k.todayRevenue.amountCents,
      waitingGuests: k.waitingGuests.count,
      servingNow: k.servingNow.count,
      readyCheckout: k.readyCheckout.count,
      activeTechs: k.activeTechs.active,
      totalTechsOnSchedule: k.activeTechs.scheduled,
      clientSatisfaction: k.clientSatisfaction.rating,
      onlineBookings: k.onlineBookings.count,
    },
    todaySummary: {
      checkIns: k.todayCheckIns.count,              // real: check-in records today (pos_queue_items)
      appointments: ta.total,
      walkIns: k.walkInsToday.count,                // real: walk-in check-in records today
      completedServices: ta.completedServiceLines,   // service lines done today — not completed appointments (wave 4 pilot)
      openTickets: k.servingNow.count + k.readyCheckout.count,
      cancelledAppointments: ta.cancelled,
      noShows: ta.noShow,
    },
    queue: {
      waiting: res.walkInStatus.waiting,
      averageWaitMinutes: res.walkInStatus.estimatedWaitMinutes,
      longestWaitMinutes: res.checkoutToday.longestWaitMinutes,
    },
    serving: { inService: k.servingNow.count, nearingCompletion: 0, delayedServices: 0 },
    checkout: {
      readyForPayment: k.readyCheckout.count,
      paidTickets: checkoutPaid, tipsTodayCents: tips, surchargeCollectedCents: surcharge,
    },
    revenueTrend: { points: res.analytics.revenueTrend.map((p) => ({ label: p.date, amountCents: p.revenueCents })) },
    topServices: { items: res.analytics.topServices.map((s) => ({ serviceId: s.serviceId, name: s.serviceName, revenueCents: s.revenueCents, count: s.count })) },
    topTechnicians: { items: res.analytics.topTechnicians.map((t) => ({ technicianId: t.technicianId, name: t.technicianName, revenueCents: t.revenueCents, servicesDone: t.completedServices })) },
    paymentMix: {
      cardPercent: card.percent, cardAmountCents: card.amountCents,
      cashPercent: cash.percent, cashAmountCents: cash.amountCents,
      otherPercent: otherPct, otherAmountCents: otherAmt,
    },
    insights: {
      busiestTimeToday: busiest ? busiest.value : undefined,
      highRevenueService: highRev ? highRev.value : undefined,
      staffOnBreakCount: onBreak && onBreak.value ? Number(onBreak.value) || undefined : undefined,
      inventoryLowCount: lowInv && lowInv.value ? Number(lowInv.value) || undefined : undefined,
      messages: res.analytics.quickInsights.map((q) => q.title + (q.value ? ": " + q.value : "")),
    },
    alerts: [],
    moduleStatus: {
      moduleKey: "aipowersalon-pos-overview",
      completionPercent: 94,
      status: "In Progress",
      missingReasons: missing,
    },
  };
}
