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

export interface POSServingState {
  kpis: ServingKpis;
  filters: ServingFilterCounts;
  activeServices: ActiveServingListResponse;
  selectedService?: ServingTicketDetail;
  services: ServiceOption[];
  technicians: TechnicianOption[];
}

// ---- Request DTOs (§16-18, §25) ----
export interface ChangeServingTechnicianRequest { technicianId: string; reason?: string; managerPin?: string; }
export interface UpdateServiceNotesRequest { notes: string; level?: "ticket" | "customer"; }
export interface AddOnServiceRequest { serviceId: string; technicianId?: string; acceptedByCustomer?: boolean; }
export interface SendCustomerMessageRequest { body: string; channel?: "sms" | "app_push"; }

// ---- §22 Customer App ----
export type CustomerProgressStatus =
  | "accepted" | "in_progress" | "service_done" | "checkout" | "paid";

export interface CustomerServiceProgress {
  ticketId: string;
  customerId: string;
  status: CustomerProgressStatus;
  customerName: string;
  loyaltyTier?: string;
  stationLabel?: string;
  currentServiceName: string;
  technicianName: string;
  technicianRole: string;
  acceptedAt?: string;
  inProgressAt?: string;
  serviceDoneAt?: string;
  checkoutAt?: string;
  elapsedSeconds: number;
  estimatedFinishTime?: string;
}

// ---- §13 Progress + status derivation (pure, unit-testable) ----
export function progressPercent(elapsedMinutes: number, estimatedDurationMinutes: number): number {
  if (estimatedDurationMinutes <= 0) return 0;
  return Math.min(100, Math.round((elapsedMinutes / estimatedDurationMinutes) * 100));
}

export function deriveServingStatus(
  percent: number,
  minutesToFinish: number,
  lineDone: boolean,
): ServingStatus {
  if (lineDone) return "service_done";
  if (percent >= 85 || minutesToFinish <= 10) return "nearly_finished";
  if (percent <= 15) return "just_started";
  return "in_progress";
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
}

export interface POSServingKpisFull {
  servingNow: number; activeTickets: number; delayedServices: number; nearingCompletion: number;
  averageServiceDurationMinutes: number; totalInServiceSalesCents: Money; techniciansInService: number; servicesCompletedToday: number;
  addOnAttachRatePercent: number; addOnRevenueCents: Money;
  customerSatisfactionAvg: number;
  onTimeCompletionPercent: number;
  techniciansTotal: number;
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
export interface ServingInsight { id: string; text: string; sub?: string; action?: string; route?: string; severity?: "info" | "warn" | "danger"; }

export interface POSServingFullState {
  kpis: POSServingKpisFull;
  kpiTrends?: Record<string, { deltaPercent: number | null; direction: "up" | "down"; text?: string }>;
  analytics: ServingAnalytics;
  techPerformance: ServingTechPerformance[];
  staff: ServingStaffRow[];
  insights: ServingInsight[];
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
  if (status === "not_started") return "Just Started";
  if (estMin && estMin > 0 && elapsedMin >= estMin * 0.85) return "Finishing Soon";
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
// Only tickets with a positive estimate are judged; 0 when none qualify (the UI then shows "pending data"). Whole percent.
export function computeOnTimeCompletionPercent(rows: { actualMinutes: number; estimatedMinutes: number }[]): number {
  const judged = rows.filter((r) => r.estimatedMinutes > 0);
  if (judged.length === 0) return 0;
  const onTime = judged.filter((r) => r.actualMinutes <= r.estimatedMinutes).length;
  return Math.round((onTime / judged.length) * 100);
}
// ONE-PAY (Oct 13 2026): the hard-coded 15 % 'estimateServingCommissionCents' is gone — unpaid work has no commission until the compensation
// engine prices it (CompensationService.previewForTicket, shown on the checkout detail); this board's field is null.
export function servingSearch(rows: POSServingTicketRow[], q: string): POSServingTicketRow[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter((r) => r.ticketNumber.toLowerCase().includes(s) || r.customerName.toLowerCase().includes(s) || (r.customerPhone || "").toLowerCase().includes(s) || (r.primaryTechnicianName || "").toLowerCase().includes(s) || r.serviceNames.some((n) => n.toLowerCase().includes(s)) || (r.station || "").toLowerCase().includes(s));
}
