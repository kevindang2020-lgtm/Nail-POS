import { centsToUsd } from '@aipowersalon/money';
export { centsToUsd };   // owned by @aipowersalon/money (Constitution 13 §86)
// dashboard.dto.ts — AIPowerSalon POS Dashboard contracts (§8-21).
// Every endpoint derives tenantId/branchId/userId/role from the authenticated session — never the client (§25).

export type ColorKey = "pink" | "purple" | "blue" | "green" | "orange";

// ---- §8 KPIs ----
export interface DashboardKpis {
  todayRevenueCents: number;
  todayRevenueTrendPercent: number;
  waitingGuests: number;
  waitingTrendCount: number;
  servingNow: number;
  servingTrendCount: number;
  readyCheckout: number;
  readyCheckoutTrendCount: number;
  activeTechs: number;
  totalTechs: number;
  customerSatisfactionScore: number;
  customerSatisfactionMax: number;
  onlineBookings: number;
  onlineBookingsTrendCount: number;
  // T02 dashboard KPI strip additions
  monthlyCardVolumeCents: number;
  checkInsToday: number;
  appointmentsToday: number;
  averageTicketCents: number;
  customerRetentionPercent: number;
  aiBookingConversionPercent: number;
  // Period-over-period trend deltas for the KPI strip (signed %; 0 when no prior-period baseline yet).
  monthlyCardVolumeTrendPercent: number;
  checkInsTodayTrendPercent: number;
  appointmentsTodayTrendPercent: number;
  averageTicketTrendPercent: number;
  customerRetentionTrendPercent: number;
  aiBookingConversionTrendPercent: number;
}

// ---- §9 calendar (reuses booking calendar shape) ----
export interface CalendarTechnician { id: string; displayName: string; roleLabel: string; colorKey: ColorKey; }
export interface CalendarAppointment {
  id: string; customerId: string; customerName: string; technicianId: string;
  serviceNames: string[]; startTime: string; endTime: string;
  status: string; source: string;
}
export interface CalendarDayResponse { date: string; technicians: CalendarTechnician[]; appointments: CalendarAppointment[]; openSlots: { technicianId: string; startTime: string; endTime: string }[]; }

// ---- §11 today's appointments ----
export interface TodaysAppointmentsStats {
  totalAppointments: number; completed: number; noShow: number; cancelled: number; remaining: number; completedPercent: number;
}

// ---- §12 walk-in status ----
export interface WalkInStatus { waitingCount: number; estimatedWaitMinutes: number; checkedInNotAssigned: number; }

// ---- §13 current ticket ----
export interface CurrentTicketServiceLine { name: string; priceCents: number; }
export interface CurrentTicket {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerPhone: string;
  isLoyaltyMember: boolean; checkedInLabel: string; technicianName: string;
  serviceLines: CurrentTicketServiceLine[]; subtotalCents: number; taxCents: number; taxRatePercent: number; totalCents: number;
}

// ---- §14 guest snapshot ----
export interface GuestSnapshot { customerId: string; totalVisits: number; lastVisitDate: string; totalSpentCents: number; loyaltyPoints: number; }

// ---- §15-18 analytics ----
export interface RevenueTrend { period: string; totalCents: number; trendPercent: number; series: { label: string; valueCents: number; apptCount: number }[]; }
export interface TopService { name: string; revenueCents: number; }
export interface TopTechnician { technicianId: string; name: string; revenueCents: number; servicesCount: number; utilizationPercent: number | null; tipsCents: number; rating: number | null; }
export interface PaymentMixEntry { method: "card" | "cash" | "other"; percent: number; amountCents: number; }
export interface PaymentMix { period: string; entries: PaymentMixEntry[]; }
// Today's Operations Snapshot — the six operational tiles on the dashboard (all real, tenant/branch-scoped).
export interface OperationsSnapshot { waitingGuests: number; estWaitMinutes: number; walkInsToday: number; walkInPercent: number; readyCheckout: number; readyCheckoutValueCents: number; completedServices: number; noShows: number; noShowPercent: number; upcomingNext3h: number; }

// ---- §19 quick insights ----
export interface QuickInsight { kind: string; text: string; tone: "info" | "success" | "warning" | "danger"; }

// ---- §11 AI Insights (operational intelligence; deterministic, derived from the real aggregate) ----
export type AiInsightActionKind = "missed_calls" | "inventory" | "rebooking" | "upsell" | "staffing";
export interface AiInsightAction { label: string; kind: AiInsightActionKind; }
export interface AiInsight { id: string; icon: string; primary: string; secondary: string; tone: "info" | "success" | "warning" | "danger"; action?: AiInsightAction; }
export interface AiInsightInputs {
  peakWindowLabel?: string; peakServiceName?: string;
  suggestExtraTech?: boolean; staffingWindowLabel?: string;
  missedCalls?: number; avgBookingValueCents?: number;
  upsellEligible?: number; rebookingDue?: number; lowStockCount?: number;
}
// 12-hour clock label for an hour-of-day (0-23): 13 -> "1:00 PM"
export function clockLabel(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24; const ap = h < 12 ? "AM" : "PM"; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${ap}`;
}
// "1:00 PM - 3:00 PM" for a peak start hour + window length (default 2h)
export function hourWindowLabel(startHour: number, lengthHours = 2): string { return `${clockLabel(startHour)} - ${clockLabel(startHour + lengthHours)}`; }
function usd0(cents: number): string { return "$" + Math.round(cents / 100).toLocaleString("en-US"); }
/** Build the ordered AI Insights rows. Each row appears ONLY when its real signal is present, so production never
 *  shows a fabricated insight; the dev fixture supplies all inputs for 1:1 visual parity with the reference. */
export function buildAiInsights(i: AiInsightInputs): AiInsight[] {
  const out: AiInsight[] = [];
  if (i.peakWindowLabel) out.push({ id: "peak_time", icon: "peak", tone: "info", primary: `Peak time today: ${i.peakWindowLabel}`, secondary: i.peakServiceName ? `High demand for ${i.peakServiceName}.` : "Plan staffing for the busy window." });
  if (i.suggestExtraTech) out.push({ id: "staffing", icon: "staff", tone: "warning", primary: "Suggest adding 1 extra tech", secondary: `${i.staffingWindowLabel ? `Between ${i.staffingWindowLabel} ` : "During peak hours "}to reduce wait time.` });
  if (i.missedCalls && i.missedCalls > 0) out.push({ id: "missed_calls", icon: "phone", tone: "warning", primary: `${i.missedCalls} missed calls today`, secondary: `Potential bookings worth ~${usd0(i.missedCalls * (i.avgBookingValueCents || 0))}.`, action: { label: "View & Call Back", kind: "missed_calls" } });
  if (i.upsellEligible && i.upsellEligible > 0) out.push({ id: "upsell", icon: "upsell", tone: "info", primary: "Upsell opportunity", secondary: `${i.upsellEligible} guests eligible for add-on services.` });
  if (i.rebookingDue && i.rebookingDue > 0) out.push({ id: "rebooking", icon: "rebook", tone: "success", primary: `${i.rebookingDue} customers due for rebooking`, secondary: "Reach out to increase retention." });
  if (i.lowStockCount && i.lowStockCount > 0) out.push({ id: "low_stock", icon: "stock", tone: "danger", primary: "Low stock alert", secondary: `${i.lowStockCount} products running low.`, action: { label: "View Inventory", kind: "inventory" } });
  return out;
}

// ---- §20 quick actions ----
export interface QuickAction { key: string; label: string; description: string; route?: string; }

export interface PosContext { tenantId: string; branchId: string; salonName: string; branchName: string; }

// ---- T02 dashboard modules ----
export interface LiveActivityItem { time: string; guestName: string; serviceName: string; technicianName: string; status: string; elapsedMinutes: number; }
export interface CustomerRetentionStat { returningPercent: number; returningCount: number; newPercent: number; newCount: number; inactivePercent: number; inactiveCount: number; totalCustomers: number; }
export interface LocationSnapshot { branchId: string; branchName: string; revenueCents: number; checkIns: number; trendPercent: number; }

// ---- §21 consolidated state ----
export interface POSDashboardState {
  context: PosContext;
  kpis: DashboardKpis;
  calendar: CalendarDayResponse;
  todaysAppointments: TodaysAppointmentsStats;
  walkInStatus: WalkInStatus;
  operationsSnapshot: OperationsSnapshot;
  currentTicket?: CurrentTicket;
  guestSnapshot?: GuestSnapshot;
  revenueTrend: RevenueTrend;
  topServices: TopService[];
  topTechnicians: TopTechnician[];
  paymentMix: PaymentMix;
  liveActivity: LiveActivityItem[];
  customerRetention: CustomerRetentionStat;
  multiLocation: LocationSnapshot[];
  quickInsights: QuickInsight[];
  aiInsights: AiInsight[];
  quickActions: QuickAction[];
}

// ===== pure helpers (unit-testable) =====

export function completedPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

// signed percent change vs a prior value
export function trendPercent(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}


// derive subtotal/tax/total from line snapshots + a tax rate percent
export function ticketTotals(lines: { priceCents: number }[], taxRatePercent: number): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = lines.reduce(function (a, l) { return a + l.priceCents; }, 0);
  const taxCents = Math.round(subtotalCents * (taxRatePercent / 100));
  return { subtotalCents: subtotalCents, taxCents: taxCents, totalCents: subtotalCents + taxCents };
}

// payment mix percentages from per-method totals (rounded, largest-remainder so they sum to 100)
export function paymentMixPercentages(amounts: { method: "card" | "cash" | "other"; amountCents: number }[]): PaymentMixEntry[] {
  const total = amounts.reduce(function (a, x) { return a + x.amountCents; }, 0);
  if (total <= 0) return amounts.map(function (x) { return { method: x.method, percent: 0, amountCents: x.amountCents }; });
  const raw = amounts.map(function (x) { return { method: x.method, amountCents: x.amountCents, exact: (x.amountCents / total) * 100 }; });
  const floored = raw.map(function (r) { return { method: r.method, amountCents: r.amountCents, percent: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }; });
  let used = floored.reduce(function (a, r) { return a + r.percent; }, 0);
  floored.sort(function (a, b) { return b.rem - a.rem; });
  let i = 0;
  while (used < 100 && i < floored.length) { floored[i].percent += 1; used += 1; i += 1; }
  return floored.map(function (r) { return { method: r.method, percent: r.percent, amountCents: r.amountCents }; });
}

// estimate wait minutes from queue depth, avg service length, available techs
export function estimateWaitMinutes(waitingCount: number, avgServiceMinutes: number, availableTechs: number): number {
  if (availableTechs <= 0) return waitingCount * avgServiceMinutes;
  return Math.round((waitingCount / availableTechs) * avgServiceMinutes);
}

// ===========================================================================
// Spec §8 contract: POSDashboardSummary — the FLAT dashboard shape the screen
// hydrates from `GET /pos/dashboard/state?shape=summary`. It is a projection of
// the richer POSDashboardState above (ONE source of truth = the aggregate).
// Fields the aggregate cannot express yet (queue/serving/checkout item lists,
// paid/tips/surcharge, customer breakdown, alerts) are emitted empty/0 and listed
// in moduleStatus.missingReasons — they come from the queue/serving/checkout/
// payments/customers services in your repo. Never faked.
// ===========================================================================

export interface POSDashboardAppointmentRow { appointmentId: string; customerName: string; serviceName: string; startTime: string; status: string; }
export interface POSDashboardQueueRow { queueItemId: string; customerName: string; serviceName: string; waitMinutes: number; status: string; }
export interface POSDashboardServingRow { serviceId: string; customerName: string; serviceName: string; technicianName: string; status: string; }
export interface POSDashboardCheckoutRow { ticketId: string; ticketNumber: string; customerName: string; totalCents: number; status: string; }
export interface POSDashboardAlert { id: string; severity: "info" | "success" | "warning" | "danger"; title: string; message?: string; route?: string; }

export interface POSDashboardSummary {
  kpis: {
    todayRevenueCents: number; appointmentsToday: number; waitingGuests: number; servingNow: number;
    readyCheckout: number; activeTechs: number; totalTechsOnSchedule: number; clientSatisfaction: number; onlineBookings: number;
  };
  operations: { checkIns: number; walkIns: number; appointments: number; completedServices: number; openTickets: number; cancelledAppointments: number; noShows: number; };
  appointments: { upcoming: POSDashboardAppointmentRow[]; lateCount: number; onlineBookingCount: number; };
  queue: { waiting: number; averageWaitMinutes: number; longestWaitMinutes: number; items: POSDashboardQueueRow[]; };
  serving: { inService: number; nearingCompletion: number; delayedServices: number; items: POSDashboardServingRow[]; };
  checkout: { readyForPayment: number; paidTickets: number; tipsTodayCents: number; surchargeCollectedCents: number; items: POSDashboardCheckoutRow[]; };
  revenueTrend: { points: { label: string; amountCents: number }[]; };
  topServices: { items: { serviceId: string; name: string; revenueCents: number; count: number }[]; };
  topTechnicians: { items: { technicianId: string; name: string; revenueCents: number; servicesDone: number }[]; };
  paymentMix: { cardPercent: number; cardAmountCents: number; cashPercent: number; cashAmountCents: number; otherPercent: number; otherAmountCents: number; };
  customers: { newCustomersToday: number; returningCustomersToday: number; vipCustomersToday: number; };
  insights: { busiestTimeToday?: string; highRevenueService?: string; staffOnBreakCount?: number; inventoryLowCount?: number; messages: string[]; };
  alerts: POSDashboardAlert[];
  moduleStatus?: { moduleKey: "aipowersalon-pos-dashboard"; completionPercent: number; status: "Complete" | "In Progress" | "Needs Review" | "Blocked" | "Not Started"; missingReasons: string[]; };
}

function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function mixOf(entries: PaymentMixEntry[], m: "card" | "cash" | "other") { const e = entries.find((x) => x.method === m); return { percent: e ? e.percent : 0, amountCents: e ? e.amountCents : 0 }; }

/** Project the flat spec summary from the rich aggregate. */
export function toPosDashboardSummary(s: POSDashboardState): POSDashboardSummary {
  const k = s.kpis, ta = s.todaysAppointments, wi = s.walkInStatus;
  const card = mixOf(s.paymentMix.entries, "card"), cash = mixOf(s.paymentMix.entries, "cash");
  const otherAmt = s.paymentMix.entries.filter((e) => e.method === "other").reduce((a, e) => a + e.amountCents, 0);
  const otherPct = Math.max(0, 100 - card.percent - cash.percent);
  const byKind = (kind: string) => s.quickInsights.find((q) => q.kind === kind);
  const busiest = byKind("busiest_window") || byKind("busiest");
  const highRev = byKind("high_revenue_service") || byKind("top_service");
  const onBreak = byKind("staff_on_break");
  const lowInv = byKind("inventory_low");
  const numIn = (t?: string) => { if (!t) return undefined; const m = t.match(/\d+/); return m ? Number(m[0]) : undefined; };

  const missing = [
    "queue.items / serving.items / checkout.items: source from queue/serving/checkout services",
    "checkout.paidTickets/tipsTodayCents/surchargeCollectedCents: source from payments aggregate",
    "queue.longestWaitMinutes, serving.nearingCompletion/delayedServices: source from queue/serving services",
    "customers.new/returning/vip: source from customers service",
    "topServices.items[].count, topTechnicians.items[].servicesDone: not in current aggregate",
  ];

  return {
    kpis: {
      todayRevenueCents: k.todayRevenueCents, appointmentsToday: ta.totalAppointments, waitingGuests: k.waitingGuests,
      servingNow: k.servingNow, readyCheckout: k.readyCheckout, activeTechs: k.activeTechs,
      totalTechsOnSchedule: k.totalTechs, clientSatisfaction: k.customerSatisfactionScore, onlineBookings: k.onlineBookings,
    },
    operations: {
      checkIns: ta.completed + ta.remaining, walkIns: wi.waitingCount, appointments: ta.totalAppointments,
      completedServices: ta.completed, openTickets: k.servingNow + k.readyCheckout, cancelledAppointments: ta.cancelled, noShows: ta.noShow,
    },
    appointments: {
      upcoming: s.calendar.appointments.slice(0, 6).map((a) => ({ appointmentId: a.id, customerName: a.customerName, serviceName: a.serviceNames[0] || "", startTime: a.startTime, status: a.status })),
      lateCount: 0, onlineBookingCount: k.onlineBookings,
    },
    queue: { waiting: wi.waitingCount, averageWaitMinutes: wi.estimatedWaitMinutes, longestWaitMinutes: 0, items: [] },
    serving: { inService: k.servingNow, nearingCompletion: 0, delayedServices: 0, items: [] },
    checkout: { readyForPayment: k.readyCheckout, paidTickets: 0, tipsTodayCents: 0, surchargeCollectedCents: 0, items: [] },
    revenueTrend: { points: s.revenueTrend.series.map((p) => ({ label: p.label, amountCents: p.valueCents })) },
    topServices: { items: s.topServices.map((t) => ({ serviceId: slug(t.name), name: t.name, revenueCents: t.revenueCents, count: 0 })) },
    topTechnicians: { items: s.topTechnicians.map((t) => ({ technicianId: t.technicianId, name: t.name, revenueCents: t.revenueCents, servicesDone: 0 })) },
    paymentMix: { cardPercent: card.percent, cardAmountCents: card.amountCents, cashPercent: cash.percent, cashAmountCents: cash.amountCents, otherPercent: otherPct, otherAmountCents: otherAmt },
    customers: { newCustomersToday: 0, returningCustomersToday: 0, vipCustomersToday: 0 },
    insights: {
      busiestTimeToday: busiest ? busiest.text : undefined, highRevenueService: highRev ? highRev.text : undefined,
      staffOnBreakCount: numIn(onBreak && onBreak.text), inventoryLowCount: numIn(lowInv && lowInv.text),
      messages: s.quickInsights.map((q) => q.text),
    },
    alerts: [],
    moduleStatus: { moduleKey: "aipowersalon-pos-dashboard", completionPercent: 86, status: "In Progress", missingReasons: missing },
  };
}

// ── Dashboard metric helpers (spec §20) — single source of truth for derived KPIs so the Dashboard
// and Reports never diverge. Pure + tested in dashboard-metrics.spec.ts.
export function averageTicketCents(eligibleRevenueCents: number, eligiblePaidCount: number): number {
  if (!eligiblePaidCount || eligiblePaidCount <= 0) return 0; // zero-ticket safe
  return Math.round(eligibleRevenueCents / eligiblePaidCount);
}
export function rebookRatePercent(eligibleWithFutureAppt: number, eligibleCompletedVisits: number): number {
  if (!eligibleCompletedVisits || eligibleCompletedVisits <= 0) return 0;
  return Math.round((eligibleWithFutureAppt / eligibleCompletedVisits) * 100);
}
export function utilizationPercent(productiveServiceMinutes: number, availableScheduledMinutes: number): number {
  if (!availableScheduledMinutes || availableScheduledMinutes <= 0) return 0;
  return Math.min(100, Math.round((productiveServiceMinutes / availableScheduledMinutes) * 100));
}
export function onDutyPercent(clockedIn: number, scheduled: number): number {
  if (!scheduled || scheduled <= 0) return 0;
  return Math.round((clockedIn / scheduled) * 100);
}
