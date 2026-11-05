import type { Money } from '@aipowersalon/money';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { CheckInFilters } from '@aipowersalon/api-contracts/tenant';
import type { CheckInFilters } from '@aipowersalon/api-contracts/tenant';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
// check-in.dto.ts — AIPowerSalon POS Check-In contracts.
// Endpoints derive tenantId/branchId from the authenticated session — never from the client (§28).

export type ArrivalSource = "appointment" | "walk_in";
export type ArrivalStatus = "arrived" | "new_walk_in" | "checked_in";
export type WaitStatus = "waiting" | "assigned" | "serving" | "ready_checkout";

// ---- §9 KPIs ----
export interface CheckInKpis {
  todayCheckIns: number;
  todayCheckInsTrendPercent: number;
  waitingGuests: number;
  estimatedWaitMinutes: number;
  walkInsToday: number;
  appointmentsArrived: number;
  appointmentArrivalPercent: number;
  readyForTech: number;
  noShows?: number;
  techsAvailable?: number;
  customerReturnRate?: number;
}

// ---- §10 arrivals ----
export interface CheckInArrival {
  rowId: string;
  timeLabel: string;
  customerId: string;
  customerName: string;
  avatarUrl?: string | null;
  phone: string;
  source: ArrivalSource;
  services: string[];
  technicianName?: string;
  arrivalStatus: ArrivalStatus;
  appointmentId?: string;
  ticketId?: string;
  queueItemId?: string;
}

// ---- §11 appointment panel ----
export interface AppointmentMini {
  appointmentId: string;
  timeLabel: string;
  startTime: string;
  customerId: string;
  customerName: string;
  avatarUrl?: string | null;
  serviceName: string;
  status: "upcoming" | "arrived" | "no_show";
  technicianName?: string;
}

// ---- §13 guest detail ----
export interface CheckInGuestDetail {
  customerId: string;
  fullName: string;
  phone: string;
  email?: string;
  isLoyaltyMember: boolean;
  totalVisits: number;
  totalSpentCents: number;
  appointment?: {
    appointmentId: string;
    dateTimeLabel: string;
    arrivalStatus: string;
    bookingSource: string;
    confirmedBy: string;
  };
  selectedServices: { name: string; priceCents: number }[];
  discountCents: number;
  estimatedTotalCents: number;
  notes?: string;
  ticketId?: string;
  queueItemId?: string;
}

// ---- §18/§19 waiting + ready ----
export interface WaitingGuest { queueItemId: string; timeLabel: string; customerId: string; customerName: string; avatarUrl?: string | null; serviceName: string; status: WaitStatus; waitedMinutes: number; requestedTechnicianName?: string; requestedTechnicianId?: string; }
export interface ReadyForAssignmentGuest { queueItemId: string; customerName: string; serviceName: string; ticketId: string; }

export interface ServiceOption { serviceId: string; name: string; durationMinutes: number; priceCents: number; }
export interface TechnicianOption { technicianId: string; displayName: string; avatarUrl?: string | null; }
// Available-technicians row: load is real (count of active assignments); specialty/nextAvailable need schedule data (omitted until wired).
export interface CheckInAvailableTech { technicianId: string; displayName: string; avatarUrl?: string | null; activeAssignments: number; status: "available" | "busy"; }
export interface CheckInSourceSlice { name: string; count: number; pct: number; }
export interface CheckInArrivalBucket { hourLabel: string; hour: number; count: number; }

// ---- §23 consolidated state ----
export interface CheckInState {
  kpis: CheckInKpis;
  arrivals: CheckInArrival[];
  appointmentCheckIn: { upcoming: AppointmentMini[]; arrived: AppointmentMini[]; noShow: AppointmentMini[] };
  waiting: WaitingGuest[];
  readyForAssignment: ReadyForAssignmentGuest[];
  selectedGuest?: CheckInGuestDetail;
  services: ServiceOption[];
  technicians: TechnicianOption[];
  availableTechnicians?: CheckInAvailableTech[];
  sourceMix?: CheckInSourceSlice[];
  arrivalTrend?: CheckInArrivalBucket[];
  customerType?: { returning: number; new: number; vip: number; returnRatePct: number };
  frontDeskInsights?: FrontDeskInsight[];
  dailyPerformance?: { checkInsCompleted: number; noShowRatePct: number; avgCheckInSeconds: number | null; satisfaction: number | null };
}

// ---- §12 walk-in request ----
export interface WalkInCheckInRequest {
  customerId?: string;
  customerPhone?: string;
  customerFirstName?: string;
  customerLastName?: string;
  serviceIds: string[];
  technicianId?: string;
  source: "walk_in";
  notes?: string;
}

// ===== pure helpers (unit-testable) =====

// estimate wait: queue depth x average service length / number of available techs (simple model)
export function estimateWaitMinutes(waitingCount: number, avgServiceMinutes: number, availableTechs: number): number {
  if (availableTechs <= 0) return waitingCount * avgServiceMinutes;
  return Math.round((waitingCount / availableTechs) * avgServiceMinutes);
}
export function arrivalPercent(arrived: number, scheduled: number): number {
  if (scheduled <= 0) return 0;
  return Math.round((arrived / scheduled) * 100);
}
// estimated ticket total from line snapshots minus discount
export function estimatedTotalCents(lines: { priceCents: number }[], discountCents: number): number {
  const sum = lines.reduce((a, l) => a + l.priceCents, 0);
  return Math.max(0, sum - discountCents);
}

// ===== §9/§10 additions: check-in records, KPIs, settings, search, transfers (front-door intake) =====
export type CheckInSource = "appointment" | "walk_in" | "online" | "google" | "ai" | "customer_app" | "manual";
export type CheckInStatus = "checked_in" | "sent_to_queue" | "sent_to_tech_queue" | "in_service" | "cancelled" | "completed";

export interface CheckInServiceLine { serviceId: string; serviceName: string; durationMinutes: number; priceCents?: Money; priceOverrideCents?: Money; overrideReason?: string; isAddon?: boolean; parentServiceId?: string; }
export interface CheckInServiceLineInput { serviceId?: string; name?: string; durationMinutes?: number; priceCents?: Money; overrideReason?: string; isAddon?: boolean; parentServiceId?: string; }

export interface POSCheckInRow {
  checkInId: string; tenantId: string; branchId?: string; customerId?: string; customerName: string; customerPhone?: string; avatarUrl?: string | null; isVip?: boolean;
  appointmentId?: string | null; source: CheckInSource; services: CheckInServiceLine[]; technicianId?: string | null; technicianName?: string | null;
  checkedInAt: string; quotedWaitMinutes?: number; status: CheckInStatus; notes?: string;
}

export interface POSCheckInKpisFull {
  checkedInToday: number; appointmentsCheckedIn: number; walkInsCheckedIn: number; waitingNow: number;
  sentToQueue: number; sentToTechQueue: number; startedService: number; averageWaitMinutes: number; noShowsToday: number; onlineArrivalsToday: number;
}

export interface POSCheckInAppointmentRow {
  appointmentId: string; customerId?: string; customerName: string; customerPhone?: string; avatarUrl?: string | null; startTime: string; technicianName?: string; serviceNames: string[]; source: CheckInSource; alreadyCheckedIn: boolean;
}

export interface CheckInSettings {
  allowWalkIns: boolean; allowNewCustomerCheckIn: boolean; requirePhoneForNewCustomer: boolean;
  defaultQueueRoute: "queue" | "tech_queue" | "serving"; autoEstimateWait: boolean; allowStartServiceWithoutQueue: boolean; branchTimezone: string;
}
export const DEFAULT_CHECK_IN_SETTINGS: CheckInSettings = {
  allowWalkIns: true, allowNewCustomerCheckIn: true, requirePhoneForNewCustomer: true,
  defaultQueueRoute: "queue", autoEstimateWait: true, allowStartServiceWithoutQueue: false, branchTimezone: "America/New_York",
};

export interface POSCheckInCustomerDetail { customerId: string; fullName: string; phone?: string; email?: string; isVip?: boolean; loyaltyTier?: string; totalVisits: number; }
export interface POSCheckInAppointmentDetail extends POSCheckInAppointmentRow { services: CheckInServiceLine[]; technicianId?: string; status: string; notes?: string; }

export interface CheckInFilterFacets { sources: string[]; statuses: string[]; technicians: { technicianId: string; name: string; avatarUrl?: string | null }[]; services: { serviceId: string; name: string }[]; branches: { branchId: string; name: string }[]; }

export interface POSCheckInFullState {
  kpis: POSCheckInKpisFull;
  recentCheckIns: { items: POSCheckInRow[]; pagination?: { page: number; pageSize: number; totalItems: number; totalPages: number } };
  appointmentsReadyForCheckIn: POSCheckInAppointmentRow[];
  filters: CheckInFilterFacets;
  settings: CheckInSettings;
  selectedCustomer?: POSCheckInCustomerDetail;
  selectedAppointment?: POSCheckInAppointmentDetail;
  aggregates?: CheckInAggregates;
  customerMix?: { returning: number; new: number; vip: number; total: number };
  satisfactionAvg?: number | null;
}

// request bodies
export interface WalkInRequest { customerId?: string; customerName: string; customerPhone?: string; isNewCustomer?: boolean; serviceIds: string[]; serviceLines?: CheckInServiceLineInput[]; priceOverrides?: Record<string, { priceCents: number; reason?: string }>; technicianId?: string; notes?: string; isVip?: boolean; }
export interface CreateCustomerRequest { fullName: string; phone?: string; email?: string; smsOptIn?: boolean; }
export interface UpdateCheckInServicesRequest { serviceIds: string[]; serviceLines?: CheckInServiceLineInput[]; priceOverrides?: Record<string, { priceCents: number; reason?: string }>; }
export interface AssignCheckInTechnicianRequest { technicianId: string; managerOverride?: boolean; }
export interface UpdateWaitEstimateRequest { quotedWaitMinutes?: number; }
export interface CancelCheckInRequest { reason: string; cancelAppointment?: boolean; }

// ===== pure helpers (unit-testable) =====
export function checkInDurationMinutes(services: { durationMinutes: number }[]): number { return services.reduce((a, s) => a + s.durationMinutes, 0); }
// normalize a phone to digits for duplicate detection
export function normalizePhone(phone?: string): string { return (phone || "").replace(/\D/g, ""); }
// last 10 significant digits (so +1-856-555-0101 and 856-555-0101 match)
function phoneKey(phone?: string): string { const d = normalizePhone(phone); return d.length > 10 ? d.slice(-10) : d; }
// a candidate new customer is a likely duplicate if its phone (or email) matches an existing customer
export function findDuplicateCustomer(existing: { customerId: string; phone?: string; email?: string }[], phone?: string, email?: string): string | null {
  const p = phoneKey(phone); const e = (email || "").trim().toLowerCase();
  for (const c of existing) { if (p && p.length >= 7 && phoneKey(c.phone) === p) return c.customerId; if (e && (c.email || "").trim().toLowerCase() === e) return c.customerId; }
  return null;
}

// ===== Aggregates over the FULL check-in set (computed in the repo, not from a page) =====
export interface CheckInAggregates {
  technicianLoad: { technicianId: string; activeAssignments: number }[];
  sourceCounts: { source: string; count: number }[];
  arrivalByHour: { hour: number; count: number }[];
}
export function computeCheckInAggregates(rows: { status: string; technicianId?: string | null; source?: string; checkedInAtMs?: number }[]): CheckInAggregates {
  const loadBy: Record<string, number> = {}; const srcBy: Record<string, number> = {}; const hourBy: Record<number, number> = {};
  for (const r of rows) {
    if (r.technicianId && (r.status === "in_service" || r.status === "sent_to_tech_queue")) loadBy[r.technicianId] = (loadBy[r.technicianId] || 0) + 1;
    const src = r.source || "other"; srcBy[src] = (srcBy[src] || 0) + 1;
    if (typeof r.checkedInAtMs === "number") { const h = new Date(r.checkedInAtMs).getHours(); hourBy[h] = (hourBy[h] || 0) + 1; }
  }
  return {
    technicianLoad: Object.entries(loadBy).map(([technicianId, activeAssignments]) => ({ technicianId, activeAssignments })),
    sourceCounts: Object.entries(srcBy).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    arrivalByHour: Object.entries(hourBy).map(([hour, count]) => ({ hour: Number(hour), count })).sort((a, b) => a.hour - b.hour),
  };
}

// Customer segmentation over the full check-in set. Returning/new uses prior visit count; VIP from the row flag.
export function computeCustomerMix(rows: { customerId?: string; isVip?: boolean }[], visitsByCustomer: Record<string, number>): { returning: number; new: number; vip: number; total: number } {
  let returning = 0, nw = 0, vip = 0;
  for (const r of rows) {
    if (r.isVip) { vip++; continue; }
    const v = r.customerId ? (visitsByCustomer[r.customerId] || 0) : 0;
    if (v > 0) returning++; else nw++;
  }
  return { returning, new: nw, vip, total: rows.length };
}

// Rule-based front-desk insights over real aggregated data (no model call). Each is derived, not fabricated.
export interface FrontDeskInsight { id: string; text: string; severity: "info" | "warn"; }
export function computeFrontDeskInsights(i: { arrivalByHour: { hour: number; count: number }[]; vip: number; averageWaitMinutes: number; waitingNow: number; techsAvailable: number; walkInsToday: number; checkedInToday: number }): FrontDeskInsight[] {
  const out: FrontDeskInsight[] = [];
  const hr = (h: number) => ((h % 12) || 12) + (h < 12 ? "am" : "pm");
  if (i.arrivalByHour.length) {
    const peak = i.arrivalByHour.reduce((a, b) => (b.count > a.count ? b : a));
    if (peak.count > 0) out.push({ id: "peak", text: `Peak arrival window around ${hr(peak.hour)} (${peak.count} check-ins).`, severity: "info" });
  }
  if (i.averageWaitMinutes >= 20) out.push({ id: "wait", text: `Average wait is ${i.averageWaitMinutes} min — consider adding a technician.`, severity: "warn" });
  if (i.waitingNow > 0 && i.techsAvailable === 0) out.push({ id: "noidle", text: `${i.waitingNow} guest(s) waiting and no idle technicians.`, severity: "warn" });
  if (i.vip > 0) out.push({ id: "vip", text: `${i.vip} VIP guest(s) checked in today — ensure a premium experience.`, severity: "info" });
  if (i.checkedInToday > 0 && i.walkInsToday / i.checkedInToday >= 0.5) out.push({ id: "walkin", text: `Walk-ins are ${Math.round((i.walkInsToday / i.checkedInToday) * 100)}% of today's check-ins.`, severity: "info" });
  return out;
}

// ===== Contract adapter: POSCheckInFullState (what getState computes) -> CheckInState (what the POS screen reads) =====
function ciTimeLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function ciWaitedMinutes(iso?: string, nowMs: number = Date.now()): number {
  if (!iso) return 0; const t = new Date(iso).getTime(); if (isNaN(t)) return 0;
  return Math.max(0, Math.round((nowMs - t) / 60000));
}
export function mapToCheckInState(full: POSCheckInFullState, nowMs: number = Date.now()): CheckInState {
  const k = full.kpis;
  const rows = full.recentCheckIns.items;
  const appts = full.appointmentsReadyForCheckIn;
  const activeArrivalRows = rows.filter((r) => r.status !== "cancelled" && (r.status as string) !== "completed" && (r.status as string) !== "service_done");
  const arrivals: CheckInArrival[] = activeArrivalRows.map((r) => ({
    rowId: r.checkInId,
    timeLabel: ciTimeLabel(r.checkedInAt),
    customerId: r.customerId || "",
    customerName: r.customerName,
    avatarUrl: r.avatarUrl || null,
    phone: r.customerPhone || "",
    source: r.source === "appointment" ? "appointment" : "walk_in",
    services: r.services.map((s) => s.serviceName),
    technicianName: r.technicianName || undefined,
    arrivalStatus: (r.status === "checked_in" ? "checked_in" : r.status === "in_service" ? "in_service" : r.status === "sent_to_tech_queue" ? "ready" : "arrived") as ArrivalStatus,
    appointmentId: r.appointmentId || undefined,
  }));
  const toMini = (a: POSCheckInAppointmentRow, status: "upcoming" | "arrived" | "no_show"): AppointmentMini => ({
    appointmentId: a.appointmentId, timeLabel: ciTimeLabel(a.startTime), startTime: a.startTime,
    customerId: a.customerId || "", customerName: a.customerName, avatarUrl: a.avatarUrl || null, serviceName: a.serviceNames.join(", "), status, technicianName: a.technicianName
  });
  const upcoming = appts.filter((a) => !a.alreadyCheckedIn).map((a) => toMini(a, "upcoming"));
  const arrived = appts.filter((a) => a.alreadyCheckedIn).map((a) => toMini(a, "arrived"));
  const waiting: WaitingGuest[] = rows.filter((r) => r.status === "checked_in" || r.status === "sent_to_queue").map((r) => ({
    queueItemId: r.checkInId, timeLabel: ciTimeLabel(r.checkedInAt), customerId: r.customerId || "", customerName: r.customerName, avatarUrl: r.avatarUrl || null,
    serviceName: r.services.map(s => s.serviceName).join(', ') || "", status: "waiting", waitedMinutes: ciWaitedMinutes(r.checkedInAt, nowMs),
    requestedTechnicianName: r.technicianName || undefined, requestedTechnicianId: r.technicianId || undefined
  }));
  const readyForAssignment: ReadyForAssignmentGuest[] = rows.filter((r) => r.status === "sent_to_tech_queue").map((r) => ({
    queueItemId: r.checkInId, customerName: r.customerName, serviceName: r.services[0]?.serviceName || "", ticketId: r.checkInId,
  }));
  // Available technicians: load from repo aggregates (full set, not the 20-row page). Specialty/nextAvailable need schedule data.
  const loadByTech: Record<string, number> = {};
  for (const t of full.aggregates?.technicianLoad || []) loadByTech[t.technicianId] = t.activeAssignments;
  const availableTechnicians: CheckInAvailableTech[] = full.filters.technicians.map((t) => {
    const activeAssignments = loadByTech[t.technicianId] || 0;
    return { technicianId: t.technicianId, displayName: t.name, avatarUrl: t.avatarUrl || null, activeAssignments, status: activeAssignments > 0 ? "busy" : "available" };
  });
  const techsAvailable = availableTechnicians.filter((t) => t.status === "available").length;
  // Source mix + arrival trend from repo aggregates (full set):
  const srcLabels: Record<string, string> = { walk_in: "Walk-In", appointment: "Appointment", online: "Online", google: "Google", ai: "AI Receptionist", customer_app: "Customer App", manual: "Manual" };
  const srcTotal = (full.aggregates?.sourceCounts || []).reduce((a, s) => a + s.count, 0) || 1;
  const sourceMix: CheckInSourceSlice[] = (full.aggregates?.sourceCounts || []).map((s) => ({ name: srcLabels[s.source] || s.source, count: s.count, pct: Math.round((s.count / srcTotal) * 100) }));
  const arrivalTrend: CheckInArrivalBucket[] = (full.aggregates?.arrivalByHour || []).map((b) => ({ hour: b.hour, hourLabel: ((b.hour % 12) || 12) + (b.hour < 12 ? "a" : "p"), count: b.count }));
  const cm = full.customerMix;
  const returnRatePct = cm && cm.total > 0 ? Math.round((cm.returning / cm.total) * 1000) / 10 : 0;
  const frontDeskInsights = computeFrontDeskInsights({
    arrivalByHour: full.aggregates?.arrivalByHour || [], vip: cm?.vip || 0,
    averageWaitMinutes: k.averageWaitMinutes, waitingNow: k.waitingNow, techsAvailable,
    walkInsToday: k.walkInsCheckedIn, checkedInToday: k.checkedInToday,
  });
  // Daily performance: completed + no-show rate are real; satisfaction comes from today's paid-ticket ratings (when
  // present). Avg check-in time still needs check-in duration tracking not in this path (null = pending).
  const apptDenom = k.appointmentsCheckedIn + k.noShowsToday;
  const sat = typeof full.satisfactionAvg === 'number' && full.satisfactionAvg > 0 ? full.satisfactionAvg : null;
  const dailyPerformance = { checkInsCompleted: k.checkedInToday, noShowRatePct: apptDenom > 0 ? Math.round((k.noShowsToday / apptDenom) * 1000) / 10 : 0, avgCheckInSeconds: null, satisfaction: sat };
  return {
    kpis: {
      todayCheckIns: k.checkedInToday,
      todayCheckInsTrendPercent: 0,
      waitingGuests: k.waitingNow,
      estimatedWaitMinutes: k.averageWaitMinutes,
      walkInsToday: k.walkInsCheckedIn,
      appointmentsArrived: k.appointmentsCheckedIn,
      appointmentArrivalPercent: arrivalPercent(k.appointmentsCheckedIn, k.appointmentsCheckedIn + k.noShowsToday),
      readyForTech: k.sentToTechQueue,
      noShows: k.noShowsToday,
      techsAvailable,
      customerReturnRate: returnRatePct,
    },
    arrivals,
    appointmentCheckIn: { upcoming, arrived, noShow: [] },
    waiting,
    readyForAssignment,
    services: full.filters.services.map((s) => ({ serviceId: s.serviceId, name: s.name, durationMinutes: 0, priceCents: 0 })),
    technicians: full.filters.technicians.map((t) => ({ technicianId: t.technicianId, displayName: t.name, avatarUrl: t.avatarUrl || null })),
    availableTechnicians,
    sourceMix,
    arrivalTrend,
    customerType: cm ? { returning: cm.returning, new: cm.new, vip: cm.vip, returnRatePct } : undefined,
    frontDeskInsights,
    dailyPerformance,
  };
}
export function canStartFromCheckIn(status: CheckInStatus): { ok: boolean; reason?: string } {
  if (status === "in_service") return { ok: false, reason: "ALREADY_IN_SERVICE" };
  if (status === "cancelled") return { ok: false, reason: "CANCELLED" };
  return { ok: true };
}
export function buildQueueIdempotencyKey(checkInId: string): string { return checkInId + ":move_to_queue"; }
export function buildTechQueueIdempotencyKey(checkInId: string): string { return checkInId + ":move_to_tech_queue"; }
export function buildServingIdempotencyKey(checkInId: string): string { return checkInId + ":start_service"; }
export function buildAppointmentCheckInKey(appointmentId: string): string { return appointmentId + ":appointment_check_in"; }
export function checkInSearch(rows: POSCheckInRow[], q: string): POSCheckInRow[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter((r) => r.customerName.toLowerCase().includes(s) || (r.customerPhone || "").toLowerCase().includes(s) || (r.technicianName || "").toLowerCase().includes(s) || r.services.some((x) => x.serviceName.toLowerCase().includes(s)) || r.checkInId.toLowerCase().includes(s));
}
