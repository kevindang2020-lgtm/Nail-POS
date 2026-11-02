import type { Money } from '@aipowersalon/money';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { TechQueueFilters } from '@aipowersalon/api-contracts/tenant';
import type { TechQueueFilters, TechQueueLanePage } from '@aipowersalon/api-contracts/tenant';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
// tech-queue.dto.ts — AIPowerSalon POS Tech Queue (/pos/tech-queue).
// The technician-acceptance stage between Queue and Serving: assigned tickets, technician lanes, accept/decline,
// reassignment, delays, then move into Serving. Self-contained (Money/QueueStatus + helpers mirror workflow.dto).
// Context (tenant/branch/role/permissions) comes from the session — never a client tenantId.
export type TQSource = "walk_in" | "appointment" | "online" | "google" | "ai" | "manual";
export type TQPriority = "normal" | "high" | "vip" | "urgent";
export type TQTicketStatus = "assigned" | "waiting_for_acceptance" | "accepted" | "declined" | "ready_to_start" | "in_service" | "paused" | "delayed" | "expired" | "cancelled";
export type TQDelayStatus = "none" | "warning" | "late" | "critical";
export type TQWorkingStatus = "available" | "in_service" | "on_break" | "off_today" | "scheduled_later";

export interface TQRequestedService { serviceId: string; serviceName: string; estimatedDurationMinutes: number; priceCents?: Money; }

export interface POSTechQueueTicketRow {
  techQueueTicketId: string; queueItemId?: string; ticketId?: string; tenantId: string; branchId?: string; customerId?: string; customerName: string; avatarUrl?: string | null; customerAvatarUrl?: string | null; customerPhone?: string; isVip?: boolean;
  source: TQSource; appointmentId?: string | null; requestedServices: TQRequestedService[]; serviceCount: number; priority: TQPriority; status: TQTicketStatus;
  assignedTechnicianId: string; assignedTechnicianName: string; assignedTechnicianAvatarUrl?: string | null; station?: string; assignedAt: string; acceptedAt?: string | null; startedAt?: string | null;
  quotedWaitMinutes?: number; assignedWaitMinutes?: number; notes?: string; delayStatus?: TQDelayStatus; createdAt: string; updatedAt: string;
  /** multi-technician routing: this row is part n of a split visit (null = the whole visit) and the other parts */
  visitPart?: number | null; sharedWith?: { technicianId: string; technicianName: string | null; serviceNames: string[]; status: string; visitPart: number }[];
}

export interface POSTechQueueTicketDetail extends POSTechQueueTicketRow {
  technicianEligible?: boolean; technicianNotifiedAt?: string | null; customerNotifiedAt?: string | null; delayReason?: string;
  auditSummary: { lastAction: string; lastActorRole: string; lastAt: string }[];
}

export interface POSTechQueueTechnicianLane {
  technicianId: string; technicianName: string; avatarUrl?: string; workingStatus: TQWorkingStatus;
  activeTicketCount: number; acceptedTicketCount: number; delayedTicketCount: number; estimatedWorkloadMinutes: number; tickets: POSTechQueueTicketRow[];
}

export interface POSTechQueueKpisFull {
  assignedTickets: number; waitingForAcceptance: number; acceptedTickets: number; readyToStart: number;
  delayedTickets: number; activeTechnicians: number; availableTechnicians: number; averageAssignedWaitMinutes: number;
  laborRevenueTodayCents: number; utilizationTodayPercent: number; upsellCapturePercent: number;
  scheduledTechnicians: number; servicesInProgress: number; waitingForAssignment: number; avgTurnTimeMinutes: number;
}

export interface TechQueueWorkflowSettings {
  technicianMustAcceptTicket: boolean; allowReassignTechnician: boolean; allowStartWithoutAcceptance: boolean;
  allowMoveToServingWithoutTech: boolean; notifyTechnicianOnAssignment: boolean; notifyCustomerWhenReady: boolean; delayAlertMinutes: number;
  acceptanceTimeoutSeconds: number; // §12 server-driven offer expiry; 0 disables auto-expiry. Env override: TECH_ACCEPTANCE_TIMEOUT_SECONDS.
}
export const DEFAULT_TQ_SETTINGS: TechQueueWorkflowSettings = {
  technicianMustAcceptTicket: true, allowReassignTechnician: true, allowStartWithoutAcceptance: false,
  allowMoveToServingWithoutTech: false, notifyTechnicianOnAssignment: true, notifyCustomerWhenReady: true, delayAlertMinutes: 10,
  acceptanceTimeoutSeconds: Number(process.env.TECH_ACCEPTANCE_TIMEOUT_SECONDS ?? 90),
};

/** §12 — the server is authoritative for expiry. An offer is expired when it is still a pending, unaccepted offer AND
 *  its acceptance_deadline is in the past. Pure + clock-injectable so it is unit-tested without a database. */
export function offerIsExpired(o: { status: TQTicketStatus; acceptedAtMs: number | null; deadlineMs: number | null }, nowMs: number): boolean {
  if (o.acceptedAtMs) return false;                                  // already accepted — never expires
  if (!['assigned', 'waiting_for_acceptance'].includes(o.status)) return false; // only a pending offer can expire
  if (!o.deadlineMs) return false;                                   // no deadline set (acceptance not required) — never auto-expires
  return o.deadlineMs <= nowMs;
}

export interface TechQueueFilterFacets { statuses: string[]; technicians: string[]; serviceCategories: string[]; sources: string[]; priorityLevels: string[]; stations: string[]; }

export interface POSTechQueueFullState {
  kpis: POSTechQueueKpisFull;
  kpiTrends?: Record<string, { deltaPercent: number | null; direction: "up" | "down"; text?: string }>;
  technicianRows?: TechQueueTechRow[];
  waitingGuests?: TechQueueWaitingGuest[];
  availableTechnicians?: TechQueueAvailRow[];
  analytics?: TechQueueAnalytics;
  insights?: TechQueueInsight[];
  technicianLanes: POSTechQueueTechnicianLane[];
  tickets: { items: POSTechQueueTicketRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };
  selectedTicket?: POSTechQueueTicketDetail;
  filters: TechQueueFilterFacets;
  workflowSettings: TechQueueWorkflowSettings;
  techPerformanceToday?: TechPerfRow[];
  /** 200-technician §2 — with lanePage: the lane page that came back, the Workload Board columns (counts over every
   *  technician, a few rows each) and the size of the available list (availableTechnicians is one page) */
  lanes?: TechQueueLanePage;
  workload?: TechQueueWorkload;
  availableTechniciansTotal?: number;
}
export type TechQueueWorkloadColumn = { count: number; items: TechQueueTechRow[] };
export interface TechQueueWorkload { available: TechQueueWorkloadColumn; inProgress: TechQueueWorkloadColumn; finishing: TechQueueWorkloadColumn; breakOffline: TechQueueWorkloadColumn }
/** the code behind nextAvailableLabel (the POS labels it in the user's language) */
export type TechQueueNextAvailable = 'now' | 'on_break' | 'off' | 'soon';
export interface TechPerfRow { technicianId: string; technicianName: string; avatarUrl?: string | null; services: number; revenueCents: number; tipCents: number; ratingAvg: number | null; /** paged board: her utilization (the lane row may be on another page) */ utilizationPercent?: number | null; }

// request bodies
export interface AcceptTicketRequest { managerOverride?: boolean; /** the ticket version the client saw (155) — a stale click is a no-op */ expectedVersion?: number; }
export interface DeclineTicketRequest { reason: string; expectedVersion?: number; /** Fair Turn §64: NOT_LICENSED | NOT_SKILLED | MEDICAL_RESTRICTION | … | PERSONAL_PREFERENCE | OTHER */ reasonCode?: string | null; }
export interface ReassignTechnicianRequest { technicianId: string; reason: string; managerOverride?: boolean; }
export interface UpdateServicesRequest { serviceIds: string[]; }
export interface UpdatePriorityRequest { priority: TQPriority; reason?: string; }
export interface NotifyTechnicianRequest { channel?: "push" | "sms"; }
export interface NotifyCustomerRequest { channel: "sms" | "app" | "front_desk"; }
export interface ReportDelayRequest { reason: string; extraMinutes?: number; customerNotified?: boolean; managerReviewNeeded?: boolean; }
export interface ClearDelayRequest { note: string; }
export interface CancelTicketRequest { reason: string; }

// ===== pure helpers (unit-testable) =====
export function canAccept(status: TQTicketStatus): { ok: boolean; reason?: string } {
  if (["assigned", "waiting_for_acceptance"].includes(status)) return { ok: true };
  return { ok: false, reason: "NOT_PENDING" };
}
export function canStart(args: { status: TQTicketStatus; mustAccept: boolean; allowStartWithoutAcceptance: boolean; managerOverride: boolean }): { ok: boolean; reason?: string } {
  if (["in_service", "cancelled", "declined"].includes(args.status)) return { ok: false, reason: "NOT_STARTABLE" };
  if (args.mustAccept && !args.allowStartWithoutAcceptance && !args.managerOverride && !["accepted", "ready_to_start", "delayed"].includes(args.status)) return { ok: false, reason: "ACCEPTANCE_REQUIRED" };
  return { ok: true };
}
export function canMoveToServing(args: { status: TQTicketStatus; hasTechnician: boolean; serviceCount: number; allowWithoutTech: boolean; mustAccept: boolean; allowStartWithoutAcceptance: boolean; managerOverride: boolean }): { ok: boolean; reason?: string } {
  if (args.status === "in_service") return { ok: false, reason: "ALREADY_IN_SERVICE" };
  if (["cancelled", "declined"].includes(args.status)) return { ok: false, reason: "NOT_ACTIVE" };
  if (args.serviceCount <= 0) return { ok: false, reason: "NO_SERVICES" };
  if (!args.hasTechnician && !args.allowWithoutTech) return { ok: false, reason: "TECHNICIAN_REQUIRED" };
  const s = canStart({ status: args.status, mustAccept: args.mustAccept, allowStartWithoutAcceptance: args.allowStartWithoutAcceptance, managerOverride: args.managerOverride });
  if (!s.ok) return s;
  return { ok: true };
}
export function deriveDelayStatus(assignedWaitMinutes: number, delayAlertMinutes: number): TQDelayStatus {
  if (assignedWaitMinutes <= delayAlertMinutes) return "none";
  const over = assignedWaitMinutes - delayAlertMinutes;
  if (over <= delayAlertMinutes) return "warning";
  if (over <= delayAlertMinutes * 3) return "late";
  return "critical";
}
export function buildServingIdempotencyKey(techQueueTicketId: string): string { return techQueueTicketId + ":move_to_serving"; }
export function workloadMinutes(tickets: { requestedServices: { estimatedDurationMinutes: number }[]; status: TQTicketStatus }[]): number {
  return tickets.filter((t) => !["cancelled", "declined", "in_service"].includes(t.status)).reduce((a, t) => a + t.requestedServices.reduce((s, x) => s + x.estimatedDurationMinutes, 0), 0);
}
// Pure: technician utilization for the day = actual service minutes delivered / scheduled shift minutes, as a whole
// percent capped at 100 (utilization of scheduled capacity). Returns 0 when no scheduled minutes (no shift data) so
// the UI shows "pending data" rather than a divide-by-zero or misleading rate.
export function computeUtilizationPercent(actualServiceMinutes: number, scheduledMinutes: number): number {
  if (!(scheduledMinutes > 0)) return 0;
  const pct = Math.round((Math.max(0, actualServiceMinutes) / scheduledMinutes) * 100);
  return Math.min(100, pct);
}
// Pure: upsell capture = share of the day's completed tickets that carried at least one add-on line. Whole percent;
// 0 when there are no completed tickets (UI then shows "pending data").
export function computeUpsellCapturePercent(ticketsWithAddOn: number, totalTickets: number): number {
  if (!(totalTickets > 0)) return 0;
  return Math.round((Math.max(0, ticketsWithAddOn) / totalTickets) * 100);
}
export function techQueueSearch(rows: POSTechQueueTicketRow[], q: string): POSTechQueueTicketRow[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter((r) => r.customerName.toLowerCase().includes(s) || (r.customerPhone || "").toLowerCase().includes(s) || r.assignedTechnicianName.toLowerCase().includes(s) || r.requestedServices.some((x) => x.serviceName.toLowerCase().includes(s)) || (r.notes || "").toLowerCase().includes(s) || (r.station || "").toLowerCase().includes(s) || r.techQueueTicketId.toLowerCase().includes(s));
}

// ===== Reference (technician-centric) view-model additions =====
export interface TechQueueTechRow {
  /** 200-technician §33: 'hold' = the Fair Turn ledger holds her today (holdReason); 'appointment_soon' = ready, with an
   *  appointment within APPOINTMENT_SOON_MINUTES (appointment protection on). In service / finishing / break / off win. */
  rotationPosition: number; technicianId: string; technicianName: string; avatarUrl?: string | null; specialties: string[]; status: TQWorkingStatus | "finishing_soon" | "hold" | "appointment_soon";
  nextAppointmentInMinutes?: number | null; holdReason?: string | null;
  guests: number; currentServiceName?: string; currentServiceCustomer?: string; nextAvailableLabel: string; nextAvailable?: TechQueueNextAvailable;
  utilizationPercent: number | null; tipsTodayCents: number; revenueTodayCents: number;
}
export interface TechQueueWaitingGuest {
  queueItemId?: string; customerId?: string; customerName: string; avatarUrl?: string | null; customerAvatarUrl?: string | null; serviceName: string; preferredTechName?: string; priority: TQPriority; waitMinutes: number; bestMatchTechnicianName?: string; bestMatchTechnicianId?: string; bestMatchAvatarUrl?: string | null;
  /** BUILD_PLAN Phase 6 round 2: the queue item's version (send it back as expectedVersion) and its assignee (null = unassigned). */
  version?: number; assignedTechnicianId?: string | null;
}
export interface TechQueueAvailRow { technicianId: string; technicianName: string; avatarUrl?: string | null; status: TQWorkingStatus; nextAvailableLabel: string; nextAvailable?: TechQueueNextAvailable; specialties: string[]; }
export interface TechQueueTrendPoint { hour: number; utilizationPercent: number; activeTechnicians?: number; availableTechnicians?: number; servicesInProgress?: number; }
export interface TechQueueServiceMixCell { category: string; percent: number; count: number; revenueCents: number; }
export interface TechQueueServiceMixCol { technicianId: string; technicianName: string; cells: TechQueueServiceMixCell[]; }
export interface TechQueueSourceSlice { source: string; /** canonical slice code (additive, Vietnamese POS §21) — the POS words it */ code?: 'appointment' | 'walk_in' | 'ai' | 'manual'; count: number; percent: number; }
export interface TechQueueAnalytics {
  utilizationTrend: TechQueueTrendPoint[];
  serviceMixByTechnician: TechQueueServiceMixCol[];
  serviceCategories: string[];
  assignmentSource: TechQueueSourceSlice[];
  assignmentSourceTotal: number;
  topRevenueTechs: { technicianId: string; technicianName: string; revenueCents: number }[];
}
export interface TechQueueInsight { id: string; text: string; sub?: string; action?: string; route?: string; severity?: "info" | "warn" | "danger"; /** the numbers / name in the text — the POS writes the insight from `id` + `vars` in the user's language */ vars?: Record<string, string | number>; }

// Pure: Assignment Source mix from tech-queue tickets (canonical sources, original source preserved).
export function buildAssignmentSourceMix(items: { source?: string }[]): { slices: TechQueueSourceSlice[]; total: number } {
  const map: Record<string, string> = { appointment: "Appointments", walk_in: "Walk-ins", ai: "AI Assignment", manual: "Manual Front Desk", online: "Appointments", google: "Appointments" };
  const by: Record<string, number> = {};
  for (const it of items) { const k = map[it.source || "manual"] || "Manual Front Desk"; by[k] = (by[k] || 0) + 1; }
  const total = Object.values(by).reduce((a, x) => a + x, 0);
  const order = ["Appointments", "Walk-ins", "AI Assignment", "Manual Front Desk"];
  const codeOf: Record<string, TechQueueSourceSlice['code']> = { Appointments: 'appointment', 'Walk-ins': 'walk_in', 'AI Assignment': 'ai', 'Manual Front Desk': 'manual' };
  const slices = Object.entries(by).map(([source, count]) => ({ source, code: codeOf[source], count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 }))
    .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
  return { slices, total };
}

// Finishing Soon (canonical) — an in-service ticket is "finishing soon" when its remaining time (expected service
// minutes minus elapsed since start) is at/under the threshold but not yet overdue past it. Pure + unit-tested so the
// Live Technician Queue status pill and the Workload Board column reflect real near-completion, not a fixture flag.
export function deriveFinishingSoon(startedAtMs: number | null | undefined, expectedMinutes: number, nowMs: number, thresholdMinutes = 10): boolean {
  if (!startedAtMs || !expectedMinutes || expectedMinutes <= 0) return false;
  const elapsedMin = (nowMs - startedAtMs) / 60000;
  const remaining = expectedMinutes - elapsedMin;
  return remaining <= thresholdMinutes && remaining > -thresholdMinutes; // within the last `threshold` mins (or just slipped)
}

// Hourly Utilization Trend (canonical, query-time) — for each hour window, utilization = productive service minutes
// that fall within the hour ÷ scheduled working minutes within the hour. Pure + unit-tested; the repo supplies the
// hour windows and the session/shift spans, so no hourly snapshot table is needed.
export function hourOverlapMinutes(startMs: number, endMs: number, winStartMs: number, winEndMs: number): number {
  const lo = Math.max(startMs, winStartMs); const hi = Math.min(endMs, winEndMs);
  return hi > lo ? (hi - lo) / 60000 : 0;
}
export function computeUtilizationTrend(
  sessions: { startMs: number; endMs: number }[],
  shifts: { startMs: number; endMs: number }[],
  hourWindows: { hour: number; startMs: number; endMs: number }[],
): TechQueueTrendPoint[] {
  return hourWindows.map((w) => {
    const busy = sessions.reduce((a, s) => a + hourOverlapMinutes(s.startMs, s.endMs, w.startMs, w.endMs), 0);
    const avail = shifts.reduce((a, sh) => a + hourOverlapMinutes(sh.startMs, sh.endMs, w.startMs, w.endMs), 0);
    const utilizationPercent = avail > 0 ? Math.min(100, Math.round((busy / avail) * 100)) : 0;
    const servicesInProgress = sessions.filter((s) => s.startMs < w.endMs && s.endMs > w.startMs).length;
    return { hour: w.hour, utilizationPercent, servicesInProgress };
  });
}
