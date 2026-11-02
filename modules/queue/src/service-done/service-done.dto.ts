import type { Money } from '@aipowersalon/money';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { ServiceDoneFilters } from '@aipowersalon/api-contracts/tenant';
import type { ServiceDoneFilters } from '@aipowersalon/api-contracts/tenant';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
// service-done.dto.ts — AIPowerSalon POS Service Done (/pos/service-done).
// The workflow stage between Serving and Checkout: review completed services, confirm quality, finalize notes,
// notify the customer, and send approved tickets to Checkout. Builds on workflow.dto's CompletedTicket so the
// completed-service shape never drifts. Context (tenant/branch/role/permissions) comes from the session.
// Money + QueueStatus mirror workflow.dto (kept local so this bundle is self-contained; identical definitions).
export type QueueStatus = "waiting" | "ready" | "assigned" | "serving" | "ready_checkout" | "completed";

export type QualityStatus = "pending" | "approved" | "issue_found" | "needs_review";
export type CheckoutStatus = "not_ready" | "ready_for_checkout" | "sent_to_checkout" | "reopened";
export type ServiceDoneStatus = "completed" | "ready_for_checkout" | "sent_to_checkout" | "reopened";

export interface POSServiceDoneTicketRow {
  ticketId: string; ticketNumber: string; tenantId: string; branchId?: string; customerId?: string; customerName: string;
  customerPhone?: string; isVip?: boolean; station?: string; serviceCount: number; serviceNames: string[]; addOnsLabel?: string; tipCents?: Money;
  primaryTechnicianId?: string; primaryTechnicianName?: string; helperTechnicianId?: string; helperTechnicianName?: string;
  startedAt?: string; completedAt: string; durationMinutes?: number; subtotalCents: Money; estimatedCommissionCents?: Money | null;
  qualityStatus: QualityStatus; checkoutStatus: CheckoutStatus; customerNotifiedAt?: string | null; notes?: string; status: ServiceDoneStatus;
}

export interface QualityChecklist { allServicesCompleted: boolean; customerReady: boolean; servicesReviewed: boolean; noOpenIssues: boolean; notesCompleted: boolean; }
export interface ServiceLine { serviceLineId: string; serviceName: string; serviceId?: string; category?: string; technicianId?: string; technicianName?: string; priceCents: Money; isAddOn?: boolean; }

export interface POSServiceDoneTicketDetail {
  ticketId: string; ticketNumber: string;
  customer: { customerId?: string; fullName: string; phone?: string; isVip?: boolean; loyaltyPoints?: number; visitCount?: number; totalSpendCents?: Money };
  station?: string; services: ServiceLine[];
  primaryTechnician?: { technicianId: string; name: string }; helperTechnician?: { technicianId: string; name: string } | null;
  startedAt?: string; completedAt: string; durationMinutes?: number;
  qualityChecklist: QualityChecklist; qualityStatus: QualityStatus; notes?: string; customerVisibleNotes?: string;
  customerNotifiedAt?: string | null; subtotalCents: Money; estimatedCommissionCents?: Money | null; checkoutStatus: CheckoutStatus; status: ServiceDoneStatus; serviceDoneLocked?: boolean;
  rebooking?: { label: string; window: string } | null;
  /** §108: the ticket's row version — a quality / confirmation write may send it back as expectedVersion */
  version?: number;
  /** §54: tips entered on the (unpaid) ticket — an estimate, not a captured tip */
  tipCents?: Money;
  auditSummary: { lastAction: string; lastActorRole: string; lastAt: string }[];
}

// Pure: suggest a rebooking window from a guest's paid-visit dates (ISO strings). Needs >=2 prior visits to infer a
// cadence; otherwise returns null (honest — the UI hides the suggestion rather than guessing). The cadence is the
// average gap between consecutive visits, clamped to a sane 7–60 day range; the window is a ~1-week band centered on
// (today + cadence). Label is rounded to whole weeks.
export function buildRebookingSuggestion(paidDates: (string | null | undefined)[], now: Date = new Date()): { label: string; window: string } | null {
  const ts = paidDates.map((d) => (d ? new Date(d).getTime() : NaN)).filter((t) => !isNaN(t)).sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 86400000);
  const avg = gaps.reduce((a, g) => a + g, 0) / gaps.length;
  const cadence = Math.max(7, Math.min(60, Math.round(avg)));
  const weeks = Math.max(1, Math.round(cadence / 7));
  const start = new Date(now.getTime() + (cadence - 3) * 86400000);
  const end = new Date(now.getTime() + (cadence + 4) * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label: `Fill in ~${weeks} week${weeks === 1 ? '' : 's'}`, window: `${fmt(start)} – ${fmt(end)}` };
}

export interface POSServiceDoneKpisFull {
  completedServicesToday: number; ticketsReadyForReview: number; ticketsReadyForCheckout: number; qualityIssuesCount: number;
  reopenedServicesToday: number; averageServiceDurationMinutes: number; estimatedSalesCents: Money; estimatedCommissionCents: Money | null;
  addOnRevenueCents: Money;
  /** avg seconds from Service Done (tickets.service_done_at) to Ready for Checkout (ready_checkout_at), tickets readied today; 0 = none */
  averageTurnaroundSeconds: number;
  /** Service Done mandate §55: the average 1–5 rating guests gave (tickets.satisfaction_rating) on tickets paid today;
   *  null = no rating yet ("Not enough data"), never a decorative 0 */
  customerSatisfactionAvg: number | null;
  /** how many ratings the average is built from */
  customerSatisfactionCount?: number;
  /** §53: tips on tickets PAID today (tickets.tip_cents where paid_at is today) — captured through Checkout, the payment
   *  authority; Service Done only displays it. Tips entered on unpaid tickets are the potential-revenue estimate. */
  tipsCapturedCents: Money;
  /** §57: of the distinct guests whose service completed today, the % who booked a NEW appointment after that service
   *  (created after their service_done_at, dated today or later, not cancelled / no-show). A booking that already existed
   *  before the service does not count. null = no completed guest yet. */
  rebookingRatePercent: number | null;
  /** distinct guests completed today — the rebooking rate's denominator */
  rebookingEligible?: number;
  /** §59: of the tickets completed today, the % with no quality issue recorded (service_done_quality_status <> 'issue_found').
   *  null = nothing completed today — never a decorative 100 %. */
  completionAccuracyPercent: number | null;
}

export interface ServiceDoneWorkflowSettings {
  requireQualityCheckBeforeCheckout: boolean; requireServiceNotes: boolean; allowReopenService: boolean;
  managerApprovalRequiredForReopen: boolean; autoFlowToCheckoutEnabled: boolean; notifyCustomerWhenReady: boolean;
}
export const DEFAULT_SERVICE_DONE_SETTINGS: ServiceDoneWorkflowSettings = {
  requireQualityCheckBeforeCheckout: true, requireServiceNotes: false, allowReopenService: true,
  managerApprovalRequiredForReopen: false, autoFlowToCheckoutEnabled: false, notifyCustomerWhenReady: true,
};

export interface ServiceDoneFilterFacets { statuses: string[]; technicians: string[]; serviceCategories: string[]; qualityStatuses: string[]; stations: string[]; }

export interface ServiceDoneTechPerformance { technicianId?: string; name: string; completedGuests: number; revenueCents: Money; tipsCents: Money; avgMinutes: number; rating: number | null; }
export interface ReadyFinishingTech { technicianId?: string; name: string; specialty?: string; currentLoadBusy?: number; currentLoadCap?: number; nextAvailable?: string; status: string; }
/** §44: the board carries the operationally relevant technicians (Available, then Finishing Soon, Busy, Break) capped at
 *  STAFF_BOARD_LIMIT, plus the counts for everyone on duty — never 200 cards. `roster` = every non-archived technician. */
export const SD_STAFF_BOARD_LIMIT = 8;
export interface ServiceDoneStaffSummary { onDuty: number; available: number; finishing: number; busy: number; onBreak: number; shown: number; roster: number }
/** Generic over the row shape: Serving's Available / Finishing panel uses the same rule (Serving mandate §62). */
export function capReadyStaff<T extends { status: string } = ReadyFinishingTech>(rows: T[], roster: number, limit = SD_STAFF_BOARD_LIMIT): { staff: T[]; staffSummary: ServiceDoneStaffSummary } {
  const ORDER: Record<string, number> = { Available: 0, 'Finishing Soon': 1, Busy: 2, Break: 3 };
  const sorted = [...rows].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
  const n = (st: string) => rows.filter((r) => r.status === st).length;
  const staff = sorted.slice(0, Math.max(0, limit));
  return { staff, staffSummary: { onDuty: rows.length, available: n('Available'), finishing: n('Finishing Soon'), busy: n('Busy'), onBreak: n('Break'), shown: staff.length, roster } };
}
export interface ServiceDoneFunnel { completed: number; inReview: number; readyForCheckout: number; sentToFrontDesk: number; }
export interface ServiceDonePotentialRevenue { totalCents: Money; serviceCents: Money; addOnCents: Money; tipsEstCents: Money; taxesEstCents: Money; }
export interface ServiceDoneAnalytics {
  completionTrend: { hour: number; count: number }[];
  serviceMix: { category: string; sharePercent: number; count: number }[];
  addOnMix: { label: string; sharePercent: number; count: number }[];
  funnel: ServiceDoneFunnel;
  potentialRevenue: ServiceDonePotentialRevenue;
  completionTrendDeltaPercent: number | null;
  potentialRevenueDeltaPercent: number | null;
}
export interface ServiceDoneInsight { id: string; text: string; sub?: string; action?: string; route?: string; severity?: "info" | "warn" | "danger"; /** WP-C1: the numbers / names the text was written from — the POS renders the insight from id + vars in the cashier's language */ vars?: Record<string, string | number>; }

export interface POSServiceDoneFullState {
  kpis: POSServiceDoneKpisFull;
  kpiTrends?: Record<string, { deltaPercent: number | null; direction: "up" | "down"; text?: string }>;
  analytics: ServiceDoneAnalytics;
  techPerformance: ServiceDoneTechPerformance[];
  staff: ReadyFinishingTech[];
  staffSummary?: ServiceDoneStaffSummary;
  insights: ServiceDoneInsight[];
  tickets: { items: POSServiceDoneTicketRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };
  selectedTicket?: POSServiceDoneTicketDetail;
  filters: ServiceDoneFilterFacets;
  workflowSettings: ServiceDoneWorkflowSettings;
}

// request bodies
export interface QualityCheckRequest { checklist?: Partial<QualityChecklist>; result: "approved" | "issue_found" | "needs_review"; managerPin?: string; note?: string; /** §108: optimistic concurrency — the version the reviewer saw */ expectedVersion?: number; }
export interface UpdateNotesRequest { notes?: string; customerVisibleNotes?: string; }
export interface AssignTechnicianRequest { technicianId: string; managerOverride?: boolean; }
export interface AssignHelperRequest { technicianId: string | null; }
export interface NotifyCustomerRequest { channel: "sms" | "app" | "customer_display" | "front_desk"; }
export interface ReopenServiceRequest { reason: string; managerPin?: string; }

// pure helpers (unit-testable)
export function qualityApproved(status: QualityStatus): boolean { return status === "approved"; }
// gate: a ticket may be sent to checkout only when completed, quality-approved (if required), and notes present (if required)
export function canSendToCheckout(args: { status: ServiceDoneStatus; qualityStatus: QualityStatus; notes?: string; settings: ServiceDoneWorkflowSettings }): { ok: boolean; reason?: string } {
  if (args.status === "sent_to_checkout") return { ok: false, reason: "ALREADY_SENT" };
  if (args.status === "reopened") return { ok: false, reason: "REOPENED" };
  if (args.settings.requireQualityCheckBeforeCheckout && args.qualityStatus !== "approved") return { ok: false, reason: "QUALITY_NOT_APPROVED" };
  if (args.settings.requireServiceNotes && !(args.notes || "").trim()) return { ok: false, reason: "NOTES_REQUIRED" };
  return { ok: true };
}
// idempotency for send-to-checkout so a retry never creates a duplicate checkout ticket
export function buildSendIdempotencyKey(ticketId: string, subtotalCents: Money): string { return ticketId + ":send_to_checkout:" + subtotalCents; }
export function subtotalFromLines(lines: { priceCents: Money }[]): Money { return lines.reduce((a, l) => a + l.priceCents, 0); }

// Pure aggregate: total add-on revenue across the given tickets' add-on service lines (is_add_on=true).
export function addOnRevenueFromTickets(tickets: { lines: ServiceLine[] }[]): Money {
  let cents = 0;
  for (const t of tickets) for (const l of (t.lines || [])) if (l.isAddOn) cents += l.priceCents || 0;
  return cents;
}
// Pure aggregate: rebooking rate = of the distinct customers who completed a service today, the percentage that booked a
// new appointment after it (the repository decides "booked after" — §57). Returns null when no distinct completed-today
// customer exists (the UI says "Not enough data" rather than a misleading 0 %). Whole-percent.
export function computeRebookingRatePercent(completedTodayCustomerIds: (string | null | undefined)[], rebookedCustomerIds: Iterable<string>): number | null {
  const completed = new Set<string>();
  for (const id of completedTodayCustomerIds) if (id) completed.add(id);
  if (completed.size === 0) return null;
  const rebooked = new Set<string>(rebookedCustomerIds);
  let matched = 0;
  for (const id of completed) if (rebooked.has(id)) matched++;
  return Math.round((matched / completed.size) * 100);
}
// simple commission base estimate (tenant rules refine this in the real repo)
// ONE-PAY (Oct 13 2026): the hard-coded 15 % 'estimateCommissionCents' is gone — unpaid work has no commission until the compensation
// engine prices it (CompensationService.previewForTicket, shown on the checkout detail); this board's field is null.

// ---- Reference-module pure aggregates (unit-testable; computed from real loaded tickets) ----
type MixTicket = { lines: ServiceLine[] };
// Service Mix: share of completed NON-add-on service lines grouped by category (falls back to service name).
export function buildServiceMix(tickets: MixTicket[]): { category: string; sharePercent: number; count: number }[] {
  const by: Record<string, number> = {};
  for (const t of tickets) for (const l of (t.lines || [])) if (!l.isAddOn) { const k = l.category || l.serviceName || 'Other'; by[k] = (by[k] || 0) + 1; }
  const total = Object.values(by).reduce((a, x) => a + x, 0);
  return Object.entries(by).map(([category, count]) => ({ category, count, sharePercent: total ? Math.round((count / total) * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count);
}
// Add-On Mix: share of completed add-on lines grouped by name (top 4 + Other).
export function buildAddOnMix(tickets: MixTicket[]): { label: string; sharePercent: number; count: number }[] {
  const by: Record<string, number> = {};
  for (const t of tickets) for (const l of (t.lines || [])) if (l.isAddOn) { const k = l.serviceName || 'Other'; by[k] = (by[k] || 0) + 1; }
  const total = Object.values(by).reduce((a, x) => a + x, 0);
  const sorted = Object.entries(by).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, 4); const otherCount = sorted.slice(4).reduce((a, x) => a + x.count, 0);
  const rows = top.map((x) => ({ label: x.label, count: x.count, sharePercent: total ? Math.round((x.count / total) * 1000) / 10 : 0 }));
  if (otherCount > 0) rows.push({ label: 'Other', count: otherCount, sharePercent: total ? Math.round((otherCount / total) * 1000) / 10 : 0 });
  return rows;
}
// Per-technician completion performance (primary tech), with revenue + tips + avg duration; rating supplied separately.
export function buildTechPerformance(
  tickets: { primaryTechId?: string; primaryTechName?: string; lines: ServiceLine[]; durationMinutes?: number; tipCents?: number }[],
  ratingByTech: Record<string, number | null> = {},
): ServiceDoneTechPerformance[] {
  const by: Record<string, { name: string; guests: number; revenue: number; tips: number; mins: number; durs: number }> = {};
  for (const t of tickets) {
    if (!t.primaryTechId) continue;
    const e = (by[t.primaryTechId] ||= { name: t.primaryTechName || t.primaryTechId, guests: 0, revenue: 0, tips: 0, mins: 0, durs: 0 });
    e.guests += 1; e.revenue += t.lines.reduce((a, l) => a + (l.priceCents || 0), 0); e.tips += t.tipCents || 0;
    if (t.durationMinutes && t.durationMinutes > 0) { e.mins += t.durationMinutes; e.durs += 1; }
  }
  return Object.entries(by).map(([id, v]) => ({ technicianId: id, name: v.name, completedGuests: v.guests, revenueCents: v.revenue, tipsCents: v.tips, avgMinutes: v.durs ? Math.round(v.mins / v.durs) : 0, rating: ratingByTech[id] ?? null }))
    .sort((a, b) => b.completedGuests - a.completedGuests || b.revenueCents - a.revenueCents);
}
// Completion-accuracy: percent of today's completed tickets with no quality issue (whole percent; 100 when none completed).
export function completionAccuracyPercent(completedToday: number, qualityIssues: number): number | null {
  if (completedToday <= 0) return null;   // §59: nothing to measure yet — never a decorative 100 %
  return Math.max(0, Math.min(100, Math.round(((completedToday - qualityIssues) / completedToday) * 100)));
}
export function serviceDoneSearch(rows: POSServiceDoneTicketRow[], q: string): POSServiceDoneTicketRow[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter((r) => r.ticketNumber.toLowerCase().includes(s) || r.customerName.toLowerCase().includes(s) || (r.customerPhone || "").toLowerCase().includes(s) || (r.primaryTechnicianName || "").toLowerCase().includes(s) || r.serviceNames.some((n) => n.toLowerCase().includes(s)) || (r.station || "").toLowerCase().includes(s));
}
