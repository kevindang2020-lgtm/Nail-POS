import type { Money } from '@aipowersalon/money';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { ServingFilters } from '@aipowersalon/api-contracts/tenant';
import type { ServingFilters } from '@aipowersalon/api-contracts/tenant';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
// serving.dto.ts — AIPowerSalon POS Serving contracts
// Response + request types shared by serving.controller.ts and the frontend api/posServingApi.ts.
// All POS endpoints derive tenantId/branchId from the authenticated session — never from the client.

export type ServingStatus =
  | "just_started" | "in_progress" | "nearly_finished" | "service_done";

export type ServiceLineStatus = "assigned" | "serving" | "done";

export type ProgressStep = "accepted" | "in_progress" | "service_done" | "checkout";

// ---- §10 KPIs ----
export interface ServingKpis {
  guestsInService: number;
  guestsInServiceTrendPercent: number;
  techniciansBusy: number;
  totalTechnicians: number;
  technicianUtilizationPercent: number;
  averageServiceTimeMinutes: number;
  averageServiceTimeDeltaMinutes: number;
  nearlyFinishedCount: number;
  nearlyFinishedTrendPercent: number;
  upsellOpportunitiesCents: number;
  upsellOpportunitiesTrendPercent: number;
  clientSatisfactionScore: number;
  clientSatisfactionDelta: number;
}

// ---- §11 Filters ----
export interface ServingFilterCounts {
  allActive: number;
  nails: number;
  pedicure: number;
  waxing: number;
  vip: number;
  priority: number;
}

// ---- §12 Live Service Board ----
export interface ActiveServingItem {
  ticketId: string;
  queueItemId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAvatarUrl?: string;
  isVip: boolean;
  loyaltyTier?: string;
  serviceLineId: string;
  serviceName: string;
  serviceCategoryName: string;
  technicianId: string;
  technicianName: string;
  technicianRole: string;
  technicianAvatarUrl?: string;
  startTime: string;
  estimatedFinishTime: string;
  elapsedMinutes: number;
  estimatedDurationMinutes: number;
  progressPercent: number;
  status: ServingStatus;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ActiveServingListResponse {
  items: ActiveServingItem[];
  pagination: Pagination;
}

// ---- §14-20 Selected Service Detail ----
export interface ServingServiceLine {
  serviceLineId: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  technicianId?: string;
  status: ServiceLineStatus;
}

export interface ServingTechnician {
  technicianId: string;
  name: string;
  role: string;
  rating?: number;
  avatarUrl?: string;
}

export interface AddOnSuggestion {
  serviceId: string;
  serviceName: string;
  priceCents: number;
  source: "service_category" | "current_service" | "customer_history" | "seasonal" | "ai_upsell";
}

export interface ServiceProgressTimeline {
  acceptedAt?: string;
  inProgressAt?: string;
  serviceDoneAt?: string;
  checkoutAt?: string;
  currentStep: ProgressStep;
}

export interface ServingTicketDetail {
  ticketId: string;
  queueItemId: string;
  customer: {
    customerId: string;
    fullName: string;
    phone: string;
    avatarUrl?: string;
    isVip: boolean;
    loyaltyTier?: string;
    loyaltyPoints: number;
    memberSince?: string;
    totalVisits: number;
  };
  currentServices: ServingServiceLine[];
  assignedTechnician: ServingTechnician;
  serviceNotes?: string;
  addOnSuggestions: AddOnSuggestion[];
  estimatedTotalCents: number;
  progressTimeline: ServiceProgressTimeline;
}

// ---- §26 Consolidated state ----
export interface ServiceOption { serviceId: string; name: string; priceCents: number; categoryName: string; durationMinutes: number; }
export interface TechnicianOption { technicianId: string; name: string; role: string; available: boolean; }

// ---- Request DTOs (§16-18, §25) ----
export interface UpdateServiceNotesRequest { notes: string; level?: "ticket" | "customer"; }

// ---- §22 Customer App ----
export type CustomerProgressStatus =
  | "accepted" | "in_progress" | "service_done" | "checkout" | "paid";

// ---- §13 Progress + status derivation (pure, unit-testable) ----
export function progressPercent(elapsedMinutes: number, estimatedDurationMinutes: number): number {
  if (estimatedDurationMinutes <= 0) return 0;
  return Math.min(100, Math.round((elapsedMinutes / estimatedDurationMinutes) * 100));
}

// ===== §8/§10/§12/§16 additions: full row/detail/state, timer + delay, workflow settings, request bodies =====
export type ServingTicketStatus = "not_started" | "in_service" | "paused" | "delayed" | "completed" | "sent_to_service_done";
export type DelayStatus = "none" | "warning" | "late" | "critical";

export interface POSServingTicketRow {
  ticketId: string; ticketNumber: string; tenantId: string; branchId?: string; customerId?: string; customerName: string;
  customerPhone?: string; customerAvatarUrl?: string | null; isVip?: boolean; station?: string; serviceCount: number; serviceNames: string[]; stage?: string; addOnsLabel?: string;
  primaryTechnicianId?: string; primaryTechnicianName?: string; helperTechnicianId?: string; helperTechnicianName?: string;
  startedAt?: string; pausedAt?: string | null; estimatedEndAt?: string | null; elapsedMinutes: number; estimatedDurationMinutes?: number;
  subtotalCents: Money; estimatedCommissionCents?: Money | null; status: ServingTicketStatus; delayStatus?: DelayStatus; notes?: string;
  /** §31: the legal next actions for THIS signed-in user (canonical status ∩ workflow settings ∩ permissions) */
  allowedActions?: ServingAction[];
  /** §44 / §90: every technician working a line on this visit (primary first) */
  technicianNames?: string[];
}

/** Serving mandate (Oct 28 2026) §16, §82–§85: a KPI with no population is null (the POS shows "Not enough data"), never a
 *  decorative 0 % / 100 % / 0.0 ★. The definitions are SERVING_KPI_DEFINITIONS below. */
export interface POSServingKpisFull {
  servingNow: number; activeTickets: number; delayedServices: number; nearingCompletion: number;
  averageServiceDurationMinutes: number | null; totalInServiceSalesCents: Money; techniciansInService: number; servicesCompletedToday: number;
  addOnAttachRatePercent: number | null; addOnRevenueCents: Money;
  customerSatisfactionAvg: number | null;
  onTimeCompletionPercent: number | null;
  techniciansTotal: number;
  /** technicians on duty right now (technician_statuses: available / busy / serving / finishing / on break) — the "Technicians Busy" denominator */
  techniciansOnDuty?: number;
  /** guests assigned to a technician and not yet started (Ready to Start) */
  readyToStart?: number;
}

/** §16 / §82–§85: the exact business definitions the Serving KPIs are computed with (both adapters). Population = the
 *  signed-in tenant + branch. "Active" = a ticket in service, paused or delayed (Serving status vocabulary below). */
export const SERVING_KPI_DEFINITIONS = {
  servingNow: 'Active Services — tickets whose Serving status is in_service (started, not paused, not delayed). Live, not a time window.',
  nearingCompletion: 'Ready to Finish — active tickets whose server-elapsed minutes ≥ FINISHING_SOON_FRACTION × the ticket\'s own estimate (sum of its service-line duration snapshots). A ticket with no estimate is never "finishing".',
  averageServiceDurationMinutes: 'Avg Service Time — mean server-elapsed minutes (wall time minus paused time) of the active tickets that have started. null when none has.',
  techniciansInService: 'Technicians Busy — distinct technicians holding an active ticket (primary or a line owner on an active ticket) / technicians on duty (techniciansOnDuty; falls back to the non-archived roster when the status table is empty).',
  addOnAttachRatePercent: 'Add-On Conversion — of the visits on the floor (in service, paused, delayed, or at Service Done and not yet at checkout; each visit is one opportunity), the share carrying ≥ 1 add-on service line. null when there is no visit.',
  delayedServices: 'Services Delayed — tickets reported delayed, or whose elapsed minutes exceed the estimate by more than delayAlertMinutes (deriveDelayStatus late / critical).',
  addOnRevenueCents: 'Upsell Revenue Today — the sum of ADD-ON service lines on the floor\'s tickets (each line counted once; base services and retail products excluded).',
  customerSatisfactionAvg: 'Customer Satisfaction — mean satisfaction_rating of tickets paid since the branch\'s local midnight. null when no ticket was rated today.',
  onTimeCompletionPercent: 'On-Time Completion — of tickets reaching Service Done since the branch\'s local midnight that had a positive estimate, the share whose actual minutes (service_done_at − serving_started_at) ≤ the estimate (tolerance 0 min). null when none qualifies.',
  servicesCompletedToday: 'Service Done today — tickets with service_done_at since the branch\'s local midnight.',
} as const;
/** §32: Finishing Soon = elapsed ≥ this fraction of the ticket's OWN estimate (no universal duration is assumed). */
export const FINISHING_SOON_FRACTION = 0.85;

/** §22–§31 — the canonical Serving status vocabulary (a projection of tickets.status + the live ticket_service_sessions row
 *  + the Service Done lock + the delay marker; derived in the Kysely adapter's deriveStatus) and the moves between them.
 *  completed / sent_to_service_done → in_service is ONLY the audited reopen (reopenServiceDone, reason required). */
export const SERVING_FLOW: Record<ServingTicketStatus, ServingTicketStatus[]> = {
  not_started: ['in_service'],
  in_service: ['paused', 'delayed', 'completed', 'sent_to_service_done'],
  paused: ['in_service', 'completed', 'sent_to_service_done'],
  delayed: ['in_service', 'completed', 'sent_to_service_done'],
  completed: ['sent_to_service_done', 'in_service'],
  sent_to_service_done: ['in_service'],
};
export function canServingMove(from: ServingTicketStatus, to: ServingTicketStatus): boolean { return (SERVING_FLOW[from] || []).includes(to); }
export type ServingAction = 'start' | 'pause' | 'resume' | 'report_delay' | 'clear_delay' | 'mark_ready' | 'send_to_service_done';
export const SERVING_ACTION_PERMISSION: Record<ServingAction, string> = {
  start: 'pos.serving.start', pause: 'pos.serving.pause_resume', resume: 'pos.serving.pause_resume', report_delay: 'pos.serving.report_delay',
  clear_delay: 'pos.serving.report_delay', mark_ready: 'pos.serving.mark_done', send_to_service_done: 'pos.serving.send_to_service_done',
};
/** §31 "Move Stage shows legal next states": the actions the canonical status allows (permissions are applied by the service). */
export function servingNextActions(status: ServingTicketStatus, settings: Pick<ServingWorkflowSettings, 'allowPauseResume'>): ServingAction[] {
  const a: ServingAction[] = [];
  if (status === 'not_started') a.push('start');
  if (status === 'in_service' && settings.allowPauseResume) a.push('pause');
  if (status === 'paused' && settings.allowPauseResume) a.push('resume');
  if (status === 'in_service' || status === 'delayed') a.push('report_delay');
  if (status === 'delayed') a.push('clear_delay');
  if (status === 'in_service' || status === 'paused' || status === 'delayed') a.push('mark_ready');
  if (status === 'in_service' || status === 'paused' || status === 'delayed' || status === 'completed') a.push('send_to_service_done');
  return a;
}
/** §44, §92: open (not done) SERVICE lines per technician on the floor's live tickets — a line belongs to its own technician,
 *  an unowned line to the ticket's primary. A technician whose own lines are all done carries no load on that visit even
 *  while the guest stays in Serving with another technician. Retail lines (no duration, born done) never count. */
export function servingTechnicianLoad(tickets: { status: ServingTicketStatus; primaryTechId?: string; lines: { technicianId?: string; status: ServiceLineStatus; estDurationMin?: number }[] }[]): Record<string, number> {
  const load: Record<string, number> = {};
  for (const t of tickets) {
    if (!['in_service', 'paused', 'delayed'].includes(t.status)) continue;
    for (const l of t.lines) { if (l.status === 'done') continue; const tid = l.technicianId || t.primaryTechId; if (tid) load[tid] = (load[tid] || 0) + 1; }
  }
  return load;
}
/** §56–§57 Auto Balance Floor — ANALYZE + RECOMMEND only. A suggestion is applied by a person through assign-technician, which
 *  re-checks permission, branch, exact service skill, certification, schedule / appointment conflicts and "already serving"
 *  (THE eligibility authority). Never executed automatically. Rule: a guest Ready to Start whose technician is still busy with
 *  another live guest → an Available technician with no open lines; at most `limit` suggestions, oldest wait first. */
export interface ServingBalanceSuggestion { ticketId: string; ticketNumber: string; customerName: string; fromTechnicianId?: string; fromTechnicianName?: string; toTechnicianId: string; toTechnicianName: string; reason: 'technician_busy' | 'unassigned' }
export function buildBalanceSuggestions(
  tickets: { ticketId: string; ticketNumber: string; customerName: string; status: ServingTicketStatus; primaryTechId?: string; primaryTechName?: string; lines: { technicianId?: string; status: ServiceLineStatus }[] }[],
  staff: { technicianId?: string; name: string; status: string }[], limit = 5,
): ServingBalanceSuggestion[] {
  const load = servingTechnicianLoad(tickets);
  const free = staff.filter((s) => s.technicianId && s.status === 'Available' && !load[s.technicianId]).map((s) => ({ id: s.technicianId!, name: s.name }));
  const out: ServingBalanceSuggestion[] = [];
  for (const t of tickets) {
    if (t.status !== 'not_started' || out.length >= limit || free.length === 0) continue;
    const busy = !t.primaryTechId || (load[t.primaryTechId] || 0) > 0;
    if (!busy) continue;
    const to = free.shift()!;
    out.push({ ticketId: t.ticketId, ticketNumber: t.ticketNumber, customerName: t.customerName, fromTechnicianId: t.primaryTechId, fromTechnicianName: t.primaryTechName, toTechnicianId: to.id, toTechnicianName: to.name, reason: t.primaryTechId ? 'technician_busy' : 'unassigned' });
  }
  return out;
}
/** §54–§55 AI Service Insights — advisory only (they never reassign, change a stage, add a charge, complete or touch pay).
 *  Built from the same floor facts by both adapters; at most 5, most urgent first. `action` names what the POS offers
 *  (a filter, the balance recommendations, a customer profile, Service Done) — each one a person then confirms. */
export function buildServingInsights(input: {
  active: { customerName: string; customerId?: string; isVip: boolean; elapsed: number; est: number }[];
  waitingToStart: number; busyTechWaiting: number; readyForServiceDone: number;
  overloaded?: { name: string; open: number } | null; freeTechnicians: number;
  /** Extras Serving 04 (Nov 12 2026): technicians whose current service is expected to run past their next booked
   *  appointment today (worst first) — from buildFloorProjection; absent → no conflict insight */
  bookingConflicts?: { name: string; minutesUntilBooking: number; remainingMinutes: number }[];
}): ServingInsight[] {
  const out: ServingInsight[] = [];
  const overtime = input.active.filter((t) => t.est > 0 && t.elapsed > t.est).length;
  if (overtime > 0) out.push({ id: 'overtime', text: `${overtime} service${overtime === 1 ? ' is' : 's are'} past the estimated duration`, sub: 'Check the guests and update the expected finish.', action: 'Review Now', route: 'filter:delayed', severity: 'warn', vars: { count: overtime } });
  const bc = input.bookingConflicts ?? [];
  if (bc.length) { const w = bc[0];
    out.push({ id: 'booking_conflict', text: `${w.name} has a booking in ${w.minutesUntilBooking} min but needs about ${w.remainingMinutes} min more (${bc.length} conflict${bc.length === 1 ? '' : 's'})`,
      sub: 'Review the Booking board before the next guest arrives — nothing is moved automatically.', action: 'Open', route: '/booking', severity: 'warn',
      vars: { name: w.name, minutes: w.minutesUntilBooking, remaining: w.remainingMinutes, count: bc.length } }); }
  if (input.busyTechWaiting > 0 && input.freeTechnicians > 0) out.push({ id: 'balance', text: `${input.busyTechWaiting} guest${input.busyTechWaiting === 1 ? '' : 's'} waiting on a busy technician`, sub: `${input.freeTechnicians} technician${input.freeTechnicians === 1 ? ' is' : 's are'} free — review Auto Balance.`, action: 'Balance', route: 'balance', severity: 'info', vars: { count: input.busyTechWaiting, free: input.freeTechnicians } });
  if (input.readyForServiceDone > 0) out.push({ id: 'ready', text: `${input.readyForServiceDone} guest${input.readyForServiceDone === 1 ? ' is' : 's are'} ready for Service Done`, sub: 'Hand them off so checkout can start.', action: 'Open', route: '/service-done', severity: 'info', vars: { count: input.readyForServiceDone } });
  if (input.overloaded && input.overloaded.open >= 3) out.push({ id: 'imbalance', text: `${input.overloaded.name} has ${input.overloaded.open} open services`, sub: 'Consider sharing the work with a free technician.', action: 'Balance', route: 'balance', severity: 'warn', vars: { name: input.overloaded.name, count: input.overloaded.open } });
  const vip = input.active.find((t) => t.isVip);
  if (vip) out.push({ id: 'vip', text: `${vip.customerName} should be checked by a manager`, sub: 'Review VIP service quality.', action: 'Open Profile', route: vip.customerId ? `customer:${vip.customerId}` : '/customers', vars: { name: vip.customerName } });
  if (input.waitingToStart > 0 && out.length < 5 && !out.some((x) => x.id === 'balance')) out.push({ id: 'waiting', text: `${input.waitingToStart} guest${input.waitingToStart === 1 ? ' is' : 's are'} ready to start`, sub: 'Start the service when the technician is at the station.', severity: 'info', vars: { count: input.waitingToStart } });
  return out.slice(0, 5);
}
/** §103: the deterministic line id of a logical add-on (ticket + the terminal's client request id) — two terminals submitting
 *  the same addition write the same primary key, so the second insert is a duplicate, never a second line. */
export function addOnLineIdFor(ticketId: string, clientRequestId: string, hash: (s: string) => string): string {
  const h = hash(`serving-add:${ticketId}:${clientRequestId}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface ServingWorkflowSettings {
  allowPauseResume: boolean; allowServiceEditDuringServing: boolean; requireNotesBeforeDone: boolean;
  allowHelperTechnician: boolean; autoSendToServiceDone: boolean; delayAlertMinutes: number;
  /** Tech Live Ticket Edit (build doc §5–§7) — tenant-controlled via the technicianApp settings category. */
  techCanAddService: boolean; techCanChangeService: boolean; techCanRemoveLine: boolean;
  requireApprovalForChangeService: boolean; requireApprovalForRemoveLine: boolean;
}
export const DEFAULT_SERVING_SETTINGS: ServingWorkflowSettings = {
  allowPauseResume: true, allowServiceEditDuringServing: true, requireNotesBeforeDone: false,
  allowHelperTechnician: true, autoSendToServiceDone: false, delayAlertMinutes: 10,
  techCanAddService: true, techCanChangeService: true, techCanRemoveLine: false,
  requireApprovalForChangeService: true, requireApprovalForRemoveLine: true,
};

export interface ServingFilterFacets { statuses: string[]; technicians: string[]; serviceCategories: string[]; stations: string[]; delayStatuses: string[]; }

export interface ServingDetailServiceLine { serviceLineId: string; serviceId: string; serviceName: string; category?: string; priceCents: Money; technicianId?: string; technicianName?: string; status: ServiceLineStatus; isAddOn?: boolean; }
export interface POSServingTicketDetailFull {
  addOnSuggestions?: AddOnSuggestion[];
  ticketId: string; ticketNumber: string; customer: { customerId?: string; fullName: string; phone?: string; isVip?: boolean; loyaltyTier?: string; loyaltyPoints?: number; preferredTechName?: string };
  station?: string; services: ServingDetailServiceLine[]; primaryTechnician?: { technicianId: string; name: string }; helperTechnician?: { technicianId: string; name: string } | null;
  startedAt?: string; pausedAt?: string | null; estimatedEndAt?: string | null; elapsedMinutes: number; estimatedDurationMinutes?: number;
  delayStatus: DelayStatus; delayReason?: string; notes?: string; customerVisibleNotes?: string; subtotalCents: Money; estimatedCommissionCents?: Money | null;
  status: ServingTicketStatus; auditSummary: { lastAction: string; lastActorRole: string; lastAt: string }[];
  allowedActions?: ServingAction[];
}

export interface ServingTechPerformance { technicianId?: string; name: string; activeGuests: number; revenueCents: Money; tipsCents: Money; utilizationPercent: number | null; avgMinutes: number; rating: number | null; }
export interface ServingStaffRow { technicianId?: string; name: string; specialty?: string; currentLoad?: number; nextAvailable?: string; status: string; }
export interface ServingFunnel { started: number; finishing: number; serviceDone: number; completionRatePercent: number; }
export interface ServingPotentialRevenue { totalCents: Money; inServiceCents: Money; addOnsPendingCents: Money; finishingSoonCents: Money; readyToCompleteCents: Money; }
export interface ServingAnalytics {
  serviceTimeTrend: { hour: number; minutes: number }[];
  serviceMix: { category: string; sharePercent: number; count: number }[];
  addOnMix: { label: string; sharePercent: number; count: number }[];
  funnel: ServingFunnel;
  potentialRevenue: ServingPotentialRevenue;
  potentialRevenueDeltaPercent: number | null;
}
export interface ServingInsight { id: string; text: string; sub?: string; action?: string; route?: string; severity?: "info" | "warn" | "danger"; /** WP-C1: the numbers / names the text was written from — the POS renders the insight from id + vars in the cashier's language */ vars?: Record<string, string | number>; }

export interface POSServingFullState {
  kpis: POSServingKpisFull;
  kpiTrends?: Record<string, { deltaPercent: number | null; direction: "up" | "down"; text?: string }>;
  analytics: ServingAnalytics;
  techPerformance: ServingTechPerformance[];
  staff: ServingStaffRow[];
  /** §62: counts for everyone on duty — the panel shows at most SD_STAFF_BOARD_LIMIT rows */
  staffSummary?: { onDuty: number; available: number; finishing: number; busy: number; onBreak: number; shown: number; roster: number };
  insights: ServingInsight[];
  /** §17 / §109: the Live Service Floor stage counts over ALL matched tickets (not just the page) */
  stageCounts?: { readyToStart: number; inService: number; finishing: number; ready: number; paused: number; delayed: number };
  tickets: { items: POSServingTicketRow[]; pagination: Pagination };
  selectedTicket?: POSServingTicketDetailFull;
  filters: ServingFilterFacets;
  workflowSettings: ServingWorkflowSettings;
}

// request bodies
export interface AddServiceRequest { serviceId: string; technicianId?: string; priceOverrideCents?: Money; managerOverride?: boolean; }
export interface EditServiceLineRequest { priceOverrideCents?: Money; technicianId?: string; status?: ServiceLineStatus; expectedVersion?: number; }
export interface RemoveServiceRequest { serviceLineId: string; reason?: string; expectedVersion?: number; }
export interface AssignServingTechnicianRequest { technicianId: string; managerOverride?: boolean; }
export interface AssignServingHelperRequest { technicianId: string | null; }
export interface ReopenServiceDoneRequest { reason: string; }
export interface ReportDelayRequest { reason: string; extraMinutes?: number; customerNotified?: boolean; managerReviewNeeded?: boolean; }
export interface ClearDelayRequest { note: string; }

// ===== pure helpers (unit-testable) =====
// server-truth elapsed minutes: total wall time minus accumulated paused time (and current pause if paused)
export function computeElapsedMinutes(args: { startedAtMs: number | null; pausedAtMs: number | null; accumulatedPausedMs: number; nowMs: number }): number {
  if (!args.startedAtMs) return 0;
  const pausedNow = args.pausedAtMs ? args.nowMs - args.pausedAtMs : 0;
  const active = args.nowMs - args.startedAtMs - args.accumulatedPausedMs - pausedNow;
  return Math.max(0, Math.floor(active / 60000));
}
export function deriveDelayStatus(elapsedMinutes: number, estimatedDurationMinutes: number, delayAlertMinutes: number): DelayStatus {
  if (estimatedDurationMinutes <= 0) return "none";
  const over = elapsedMinutes - estimatedDurationMinutes;
  if (over <= 0) return "none";
  if (over <= delayAlertMinutes) return "warning";
  if (over <= delayAlertMinutes * 3) return "late";
  return "critical";
}
export function canMarkDone(status: ServingTicketStatus, notes: string | undefined, settings: ServingWorkflowSettings): { ok: boolean; reason?: string } {
  if (!["in_service", "paused", "delayed"].includes(status)) return { ok: false, reason: "NOT_IN_SERVICE" };
  if (settings.requireNotesBeforeDone && !(notes || "").trim()) return { ok: false, reason: "NOTES_REQUIRED" };
  return { ok: true };
}
export function canSendToServiceDone(status: ServingTicketStatus): { ok: boolean; reason?: string } {
  if (status === "sent_to_service_done") return { ok: false, reason: "ALREADY_SENT" };
  if (!["completed", "in_service", "paused", "delayed"].includes(status)) return { ok: false, reason: "NOT_READY" };
  return { ok: true };
}
export function buildServiceDoneIdempotencyKey(ticketId: string, subtotalCents: Money): string { return ticketId + ":send_to_service_done:" + subtotalCents; }
export function subtotalFromServingLines(lines: { priceCents: Money }[]): Money { return lines.reduce((a, l) => a + l.priceCents, 0); }

// ---- Reference-module pure aggregates (unit-testable; computed from real loaded tickets) ----
// Derived coarse stage label for the Live Service Floor (fine sub-stages like Prep/Polish/Drying are not modeled —
// production shows this derived label; the dev fixture provides the fine stages for the 1:1 screenshot).
export function servingStageLabel(status: string, elapsedMin: number, estMin: number | undefined): string {
  if (status === "sent_to_service_done" || status === "completed") return "Ready";
  if (status === "paused") return "Paused";
  if (status === "delayed") return "Delayed";
  if (status === "not_started") return "Ready to Start";   // §22: assigned, not started (was "Just Started" — a started guest is In Service)
  if (estMin && estMin > 0 && elapsedMin >= estMin * FINISHING_SOON_FRACTION) return "Finishing Soon";
  return "In Service";
}
type ServingMixTicket = { lines: { serviceId?: string; serviceName: string; category?: string; isAddOn?: boolean; priceCents: Money }[] };
export function buildServingServiceMix(tickets: ServingMixTicket[]): { category: string; sharePercent: number; count: number }[] {
  const by: Record<string, number> = {};
  for (const t of tickets) for (const l of (t.lines || [])) if (!l.isAddOn) { const k = l.category || l.serviceName || "Other"; by[k] = (by[k] || 0) + 1; }
  const total = Object.values(by).reduce((a, x) => a + x, 0);
  return Object.entries(by).map(([category, count]) => ({ category, count, sharePercent: total ? Math.round((count / total) * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count);
}
export function buildServingAddOnMix(tickets: ServingMixTicket[]): { label: string; sharePercent: number; count: number }[] {
  const by: Record<string, number> = {};
  for (const t of tickets) for (const l of (t.lines || [])) if (l.isAddOn) { const k = l.serviceName || "Other"; by[k] = (by[k] || 0) + 1; }
  const total = Object.values(by).reduce((a, x) => a + x, 0);
  const sorted = Object.entries(by).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, 4); const otherCount = sorted.slice(4).reduce((a, x) => a + x.count, 0);
  const rows = top.map((x) => ({ label: x.label, count: x.count, sharePercent: total ? Math.round((x.count / total) * 1000) / 10 : 0 }));
  if (otherCount > 0) rows.push({ label: "Other", count: otherCount, sharePercent: total ? Math.round((otherCount / total) * 1000) / 10 : 0 });
  return rows;
}
export function buildServingTechPerformance(
  tickets: { primaryTechId?: string; primaryTechName?: string; lines: { priceCents: Money }[]; elapsedMinutes: number; tipCents?: number }[],
  ratingByTech: Record<string, number | null> = {},
): ServingTechPerformance[] {
  const by: Record<string, { name: string; guests: number; revenue: number; tips: number; mins: number; n: number }> = {};
  for (const t of tickets) {
    if (!t.primaryTechId) continue;
    const e = (by[t.primaryTechId] ||= { name: t.primaryTechName || t.primaryTechId, guests: 0, revenue: 0, tips: 0, mins: 0, n: 0 });
    e.guests += 1; e.revenue += t.lines.reduce((a, l) => a + (l.priceCents || 0), 0); e.tips += t.tipCents || 0;
    if (t.elapsedMinutes > 0) { e.mins += t.elapsedMinutes; e.n += 1; }
  }
  return Object.entries(by)
    .map(([id, v]) => ({ technicianId: id, name: v.name, activeGuests: v.guests, revenueCents: v.revenue, tipsCents: v.tips, utilizationPercent: null as number | null, avgMinutes: v.n ? Math.round(v.mins / v.n) : 0, rating: ratingByTech[id] ?? null }))
    .sort((a, b) => b.revenueCents - a.revenueCents || b.activeGuests - a.activeGuests);
}
// Pure: on-time completion = share of today's completed services whose actual duration did not exceed the estimate.
// Only tickets with a positive estimate are judged; null when none qualify (§85 — the UI shows "Not enough data", never a
// decorative 0 %). Tolerance 0 min. Whole percent.
export function computeOnTimeCompletionPercent(rows: { actualMinutes: number; estimatedMinutes: number }[]): number | null {
  const judged = rows.filter((r) => r.estimatedMinutes > 0);
  if (judged.length === 0) return null;
  const onTime = judged.filter((r) => r.actualMinutes <= r.estimatedMinutes).length;
  return Math.round((onTime / judged.length) * 100);
}
// ONE-PAY (Oct 13 2026): the hard-coded 15 % 'estimateServingCommissionCents' is gone — unpaid work has no commission until the compensation
// engine prices it (CompensationService.previewForTicket, shown on the checkout detail); this board's field is null.
export function servingSearch(rows: POSServingTicketRow[], q: string): POSServingTicketRow[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter((r) => r.ticketNumber.toLowerCase().includes(s) || r.customerName.toLowerCase().includes(s) || (r.customerPhone || "").toLowerCase().includes(s) || (r.primaryTechnicianName || "").toLowerCase().includes(s) || r.serviceNames.some((n) => n.toLowerCase().includes(s)) || (r.station || "").toLowerCase().includes(s));
}
