import type { Money } from '@aipowersalon/money';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { QueueFilters } from '@aipowersalon/api-contracts/tenant';
import type { QueueFilters } from '@aipowersalon/api-contracts/tenant';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
// queue.dto.ts — AIPowerSalon POS Queue (/pos/queue).
// The intake stage: waiting guests (walk-ins + appointment arrivals), wait estimates, technician assignment,
// priority handling, then move into Tech Queue or Serving. Self-contained (Money/QueueStatus + wait helpers mirror
// workflow.dto). Context (tenant/branch/role/permissions) comes from the session — never a client tenantId.
export type QueueSource = "walk_in" | "appointment" | "online" | "google" | "ai" | "manual";
export type QueuePriority = "normal" | "high" | "vip" | "urgent";
export type QueueItemStatus = "waiting" | "called" | "assigned" | "ready_for_tech" | "moved_to_tech_queue" | "in_service" | "cancelled" | "removed";

export interface QueueRequestedService { serviceId: string; serviceName: string; estimatedDurationMinutes: number; priceCents?: Money; priceOverrideCents?: Money; overrideReason?: string; isAddon?: boolean; parentServiceId?: string; }

export interface POSQueueItemRow {
  queueItemId: string; tenantId: string; branchId?: string; customerId?: string; customerName: string; avatarUrl?: string | null; customerAvatarUrl?: string | null; customerPhone?: string; isVip?: boolean;
  source: QueueSource; appointmentId?: string | null; ticketId?: string | null;
  requestedServices: QueueRequestedService[]; serviceCount: number; priority: QueuePriority; status: QueueItemStatus; requestedTechnicianName?: string; bestMatchTechnicianName?: string; bestMatchTechnicianId?: string;
  assignedTechnicianId?: string | null; assignedTechnicianName?: string | null; station?: string;
  checkedInAt: string; quotedWaitMinutes?: number; actualWaitMinutes?: number; notes?: string; createdAt: string; updatedAt: string;
  /** BUILD_PLAN Phase 6: the guest's version (every transition bumps it — send it back as expectedVersion), the
   *  requested technician's id, the board position, the party and whether an assignment lock pins the guest. */
  version?: number; requestedTechnicianId?: string | null; position?: number | null; groupId?: string | null; locked?: boolean;
  /** Round 2: the active lock on the board row (null = none). The item detail carries the full QueueItemLock. */
  lock?: { technicianId: string | null; reason: string | null } | null;
  /** multi-technician routing: ≥2 technicians hold lines of this visit; every line technician (lead first) */
  sharedVisit?: boolean; lineTechnicianIds?: string[];
  /** the engine's Best Match is a split over several technicians ('split') or one ('single') */
  bestMatchMode?: 'single' | 'split'; bestMatchTechnicianNames?: string[];
}

export interface POSQueueItemDetail extends POSQueueItemRow {
  technicianEligible?: boolean; customerNotifiedAt?: string | null;
  /** BUILD_PLAN Phase 6 (audit bug 1): the technician of the customer's last finished visit — the engine's "previous". */
  previousTechnicianId?: string | null; previousTechnicianName?: string | null;
  lock?: QueueItemLock | null; lateMinutes?: number | null; appointmentStartAt?: string | null;
  serviceAssignments?: QueueServiceAssignmentView[];
  email?: string; loyaltyPoints?: number; visitCount?: number; totalSpendCents?: Money; birthday?: string | null; preferredTechName?: string; allergies?: string;
  auditSummary: { lastAction: string; lastActorRole: string; lastAt: string }[];
}

export interface QueueStaffRow { technicianId?: string; name: string; avatarUrl?: string | null; specialty?: string; currentLoad?: number; nextAvailable?: string; status: string; }
export interface QueueTrendPoint { hour: number; count: number; }
export interface QueueMixSlice { label: string; sharePercent: number; count: number; }
export interface QueueServiceBar { service: string; count: number; sharePercent: number; }
export interface QueueConversion { percent: number | null; goalPercent: number; deltaPercent: number | null; }
export interface QueueAnalytics {
  queueTrend: QueueTrendPoint[];
  customerTypeMix: QueueMixSlice[];
  visitSourceMix: QueueMixSlice[];
  topWaitingServices: QueueServiceBar[];
  conversion: QueueConversion;
  potentialRevenueByService: { service: string; revenueCents: Money }[];
  potentialRevenueTotalCents: Money;
  potentialRevenueDeltaPercent: number | null;
}
export interface QueueInsight { id: string; text: string; sub?: string; action?: string; route?: string; severity?: "info" | "warn" | "danger"; }

export interface POSQueueKpisFull {
  waitingGuests: number; averageWaitMinutes: number; longestWaitMinutes: number; vipWaiting: number;
  appointmentsWaiting: number; walkInsWaiting: number; readyForTech: number; assignedTechnicians: number; delayedQueueItems: number;
  readyForAssignment: number; estQueueRevenueCents: Money; readyForService: number; noShowRisk: number;
  returnRatePercent: number;
}

export type WaitEstimateBasis = "avg_service_minutes" | "available_techs" | "manual";
// BUILD_PLAN Phase 6 (audit "three auto-assign switches"): `autoAssignTechnicianEnabled` is RETIRED — nothing read it.
// Auto-assignment has ONE switch: the AI queue-assignment settings (salon defaults + branch overrides, kill switches).
export interface QueueWorkflowSettings {
  waitEstimateBasis: WaitEstimateBasis; vipPriorityEnabled: boolean;
  allowManualPriority: boolean; allowMoveToServingWithoutTech: boolean; notifyCustomerWhenReady: boolean;
}
export const DEFAULT_QUEUE_SETTINGS: QueueWorkflowSettings = {
  waitEstimateBasis: "available_techs", vipPriorityEnabled: true,
  allowManualPriority: true, allowMoveToServingWithoutTech: false, notifyCustomerWhenReady: true,
};

export interface QueueFilterFacets { statuses: string[]; sources: string[]; technicians: string[]; serviceCategories: string[]; priorityLevels: string[]; stations: string[]; }

export interface POSQueueFullState {
  kpis: POSQueueKpisFull;
  kpiTrends?: Record<string, { deltaPercent: number | null; direction: "up" | "down"; text?: string }>;
  analytics: QueueAnalytics;
  staff: QueueStaffRow[];
  insights: QueueInsight[];
  queue: { items: POSQueueItemRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };
  selectedQueueItem?: POSQueueItemDetail;
  filters: QueueFilterFacets;
  workflowSettings: QueueWorkflowSettings;
}

// request bodies
export interface CreateQueueItemRequest { customerId?: string; customerName: string; customerPhone?: string; source?: QueueSource; serviceIds?: string[]; priority?: QueuePriority; notes?: string; appointmentId?: string | null; requestedTechnicianId?: string | null; }
export interface ChangeRequestedTechnicianRequest { technicianId: string | null; reason?: string; }
export interface UpdateQueueItemRequest { customerName?: string; customerPhone?: string; notes?: string; station?: string; }
export type QueueAssignSource = 'staff' | 'ai_suggestion' | 'auto_assign' | 'repair';
export type QueueWriteSource = QueueAssignSource | 'system' | 'customer' | 'kiosk' | 'technician';
export interface AssignTechnicianRequest {
  technicianId: string; managerOverride?: boolean;
  /** Fair Turn §68–69: why staff chose someone other than the recommended technician (required then, unless MANUAL mode) */
  overrideReasonCode?: string | null;
  /** Fair Turn: the engine's decision (internal callers — the AI accept / auto-run — never the HTTP body) */
  turn?: QueueTurnDecision | null;
  /** Smooth Refresh spec §77: the assignee the board SHOWED (null = unassigned). If the server's current assignee differs,
   *  another device changed it first → 409 VERSION_CONFLICT instead of a silent reassignment. Omit for older clients
   *  (staff only — the AI must always send it: audit bug 5). */
  expectedTechnicianId?: string | null;
  /** BUILD_PLAN Phase 6: the guest's version the caller read (a recommendation's queueVersion). Stale → 409. */
  expectedVersion?: number;
  /** Who is assigning — recorded on the history row. 'ai_suggestion' / 'auto_assign' are held to the AI rules (bug 5). */
  source?: QueueAssignSource;
  /** Same key → same result, no second write (a retried accept / auto-run never assigns twice). */
  idempotencyKey?: string;
  reason?: string;
}
/** Spec §77/§106: the queue item changed between reading and assigning (another receptionist, or the AI assigner). */
export class QueueAssignmentConflict extends Error {
  readonly code = 'VERSION_CONFLICT' as const;
  /** multi-technician plans: which guest / which line was stale (the 409 body carries them) */
  queueItemId?: string; serviceId?: string;
  constructor(public currentTechnicianId: string | null, public currentVersion: number | null = null, message?: string, where: { queueItemId?: string; serviceId?: string } = {}) {
    super(message || 'This guest was just assigned or changed on another device. The queue has been refreshed.'); this.name = 'QueueAssignmentConflict';
    if (where.queueItemId) this.queueItemId = where.queueItemId;
    if (where.serviceId) this.serviceId = where.serviceId;
  }
}
/** BUILD_PLAN Phase 6: a manager pinned this guest (to a technician, or to "nobody yet"); only an override may move them. */
export class QueueAssignmentLocked extends Error {
  readonly code = 'ASSIGNMENT_LOCKED' as const;
  constructor(public lock: QueueItemLock) {
    super(lock.technicianId ? 'This guest is locked to another technician by a manager. Unlock or use a manager override.' : 'A manager locked this guest as "do not assign yet". Unlock or use a manager override.');
    this.name = 'QueueAssignmentLocked';
  }
}
/** The idempotency key already produced an assignment: nothing was written this time (the caller returns the result). */
export class QueueIdempotentReplay extends Error {
  constructor(public queueItemId: string) { super('This assignment was already applied.'); this.name = 'QueueIdempotentReplay'; }
}
/** A queue rule refused the write (plain words for the screen; 400). */
export class QueueRuleError extends Error { constructor(msg: string) { super(msg); this.name = 'QueueRuleError'; } }
/** What assign() may overwrite: the status and assignee the caller read (+ the version, when the caller sent one). */
export interface QueueAssignExpectation { status: string; technicianId: string | null; version?: number }
/** How a write is described in pos_queue_status_history + pos_queue_audit (one transaction with the write). */
export interface QueueWriteMeta {
  action: string; source?: QueueWriteSource; reason?: string | null; idempotencyKey?: string | null;
  auditAction?: string; metadata?: Record<string, unknown>;
  /** Fair Turn Engine: the engine's pick + skips + pool for the turn ledger (written in the assignment transaction) */
  turn?: QueueTurnDecision | null;
}
/** Fair Turn Engine (wave 2): what the technician turn queue records with an assignment (§45, §53, §67, §70). */
export interface QueueTurnDecision {
  recommendedTechnicianId?: string | null;
  /** §69: CUSTOMER_REQUEST | SKILL_MATCH | APPOINTMENT_PROTECTION | LANGUAGE_MATCH | ACCESSIBILITY_NEED | TRAINING | MANAGER_DECISION | CORRECT_PREVIOUS_MISTAKE | EMERGENCY */
  overrideReasonCode?: string | null;
  skips?: { technicianId: string; reason: string }[] | null;
  eligiblePool?: string[] | null;
}

// ===== BUILD_PLAN Phase 6 — the shared queue state model (wire shapes mirror @aipowersalon/api-contracts/tenant) =====
export interface QueueItemLock { lockId: string; technicianId: string | null; technicianName?: string | null; reason: string; lockedBy: string | null; expiresAt: string | null; createdAt: string }
export interface LockQueueItemRequest { technicianId: string | null; reason: string; expiresInMinutes?: number }
export interface UnlockQueueItemRequest { reason: string }
export interface ReorderQueueRequest { order: { queueItemId: string; expectedVersion?: number }[] }
export interface QueueHistoryRow {
  version: number; fromStatus: string | null; toStatus: string; fromTechnicianId: string | null; toTechnicianId: string | null;
  action: string; source: string; actorId: string | null; reason: string | null; createdAt: string;
}
export interface CreateQueueGroupRequest { label: string; queueItemIds: string[]; together?: boolean }
export interface QueueGroupView {
  groupId: string; label: string; size: number; together: boolean; status: string; createdAt: string;
  members: { queueItemId: string; customerName: string; status: string; assignedTechnicianId: string | null; assignedTechnicianName: string | null }[];
}
export interface ServiceAssignmentsRequest { assignments: { serviceId: string; technicianId: string | null }[] }
export interface QueueServiceAssignmentView { serviceId: string; serviceName: string; technicianId: string | null; technicianName: string | null; status: string; sequence: number;
  timing?: 'parallel' | 'after'; afterServiceId?: string | null; plannedStartOffsetMin?: number | null; startedAt?: string | null; completedAt?: string | null; techQueueTicketId?: string | null; version?: number }
// Multi-technician routing (migration 569): the ONE canonical multi-line assignment (wire shapes = @aipowersalon/api-contracts/tenant)
export type { PlanLineTiming, AssignPlanLineRequest, AssignPlanItemRequest, AssignPlanRequest, AssignPlanResult, TechQueueSharedPart, MoveGroupToTechQueueResult } from '@aipowersalon/api-contracts/tenant';
/** One line of a plan as the repository writes it: the request line + what the planner knew (timing / offset). */
export interface PlanWriteLine { serviceId: string; technicianId: string; expectedTechnicianId: string | null; timing: 'parallel' | 'after'; afterServiceId: string | null; plannedStartOffsetMin: number | null }
export interface PlanWriteItem { queueItemId: string; expectedVersion: number; expectedTechnicianId: string | null; leadTechnicianId: string; lines: PlanWriteLine[] }
export interface TechnicianAvailabilityRow {
  technicianId: string; name: string; status: 'available' | 'in_service' | 'on_break' | 'blocked' | 'off_shift';
  availableInMinutes: number | null; shiftEndsInMinutes: number | null; activeAssignments: number; onBreak: boolean; nextAppointmentInMinutes: number | null;
}
export interface QueueAssignmentEntryInput {
  queueItemId: string; branchId: string | null; version: number; requiredCategories: string[]; serviceDurationMinutes: number;
  requestedTechnicianId: string | null; previousTechnicianId: string | null; isVip: boolean; isAppointment: boolean;
  appointmentStartAt: string | null; lateMinutes: number | null; groupId: string | null; groupSize: number | null;
  lock: { technicianId: string | null; reason: string } | null; serviceIds: string[];
  /** multi-technician routing: every line of the visit (category from the catalog; the line's technician + status) */
  services: QueueAssignmentServiceInput[]; customerName?: string;
}
export interface QueueAssignmentServiceInput {
  serviceId: string; serviceName: string; category: string | null; durationMinutes: number; sequence: number; isAddon: boolean;
  parentServiceId: string | null; assignedTechnicianId: string | null; status: string;
}
export interface QueueAssignmentCandidateInput {
  technicianId: string; name: string; branchId: string | null; available: boolean; skills: string[];
  activeAssignments: number; isPrevious: boolean; rotationIndex: number | null; lastServedAt: string | null; assignedMinutes: number;
  availableInMinutes: number | null; shiftEndsInMinutes: number | null; onBreak: boolean; blocked: boolean;
  maxConcurrent: number | null; nextAppointmentInMinutes: number | null;
}
export interface QueueAssignmentInputs { entry: QueueAssignmentEntryInput; candidates: QueueAssignmentCandidateInput[] }
export interface QueueScanEntry {
  queueEntryId: string; version: number; waitMinutes: number; status: string; assignedTechnicianId: string | null;
  requestedTechnicianId: string | null; isAppointment: boolean; appointmentStartAt: string | null; lateMinutes: number | null;
  isVip: boolean; groupId: string | null; serviceIds: string[]; startedAt: string | null; expectedDurationMinutes: number;
  updatedAt: string; lock: { technicianId: string | null; reason: string } | null;
}
export interface AcceptAlternateRequest { technicianId: string }
export interface RequestedTechnicianView { technicianId: string; name: string; busy: boolean; availableInMinutes: number | null }
export interface AlternateTechnicianView { technicianId: string; name: string; availableInMinutes: number | null }
/** GET customer/queue additions and the kiosk check-in result additions (round 2). */
export interface QueueAlternatesView { requestedTechnician: RequestedTechnicianView | null; alternates: AlternateTechnicianView[] }
export interface AcceptAlternateResult { ok: true; queueItemId: string; requestedTechnicianId: string; requestedTechnicianName: string; technicianName: string; version: number }
export interface CustomerAlternatesView {
  queueItemId: string; requestedTechnicianId: string | null; requestedTechnicianName: string | null; requestedAvailableInMinutes: number | null;
  alternates: { technicianId: string; name: string; availableInMinutes: number | null }[];
}
/** BUILD_PLAN Phase 6 round 2 (the ops repair path): the same stale-board / version rules as assign; `source` lands on the history row. */
export interface UnassignTechnicianRequest { reason?: string; expectedTechnicianId?: string | null; expectedVersion?: number; source?: QueueAssignSource }
export interface UpdateServicesRequest { serviceIds: string[]; }
export interface UpdatePriorityRequest { priority: QueuePriority; reason?: string; }
export interface NotifyCustomerRequest { channel: "sms" | "app" | "front_desk"; }
export interface CancelQueueItemRequest { reason: string; }
export interface RemoveQueueItemRequest { reason?: string; }

// ===== pure helpers (unit-testable) — mirror workflow.dto =====
export function estimateWaitMinutes(waitingCount: number, avgServiceMinutes: number, availableTechs: number): number {
  if (availableTechs <= 0) return waitingCount * avgServiceMinutes;
  return Math.round((waitingCount / availableTechs) * avgServiceMinutes);
}
// VIP/urgent first (when enabled), then longest wait; assigns 1-based positions
export function rankQueue(items: { queueItemId: string; waitedMinutes: number; priority: QueuePriority }[], vipPriorityEnabled: boolean): { queueItemId: string; position: number }[] {
  const weight = (p: QueuePriority) => (p === "urgent" ? 3 : p === "vip" ? 2 : p === "high" ? 1 : 0);
  return items.slice().sort((a, b) => {
    if (vipPriorityEnabled) { const d = weight(b.priority) - weight(a.priority); if (d !== 0) return d; }
    return b.waitedMinutes - a.waitedMinutes;
  }).map((g, i) => ({ queueItemId: g.queueItemId, position: i + 1 }));
}
export function canMoveToServing(args: { status: QueueItemStatus; hasTechnician: boolean; serviceCount: number; allowWithoutTech: boolean }): { ok: boolean; reason?: string } {
  if (args.status === "in_service") return { ok: false, reason: "ALREADY_IN_SERVICE" };
  if (["cancelled", "removed"].includes(args.status)) return { ok: false, reason: "NOT_ACTIVE" };
  if (args.serviceCount <= 0) return { ok: false, reason: "NO_SERVICES" };
  if (!args.hasTechnician && !args.allowWithoutTech) return { ok: false, reason: "TECHNICIAN_REQUIRED" };
  return { ok: true };
}
export function canMoveToTechQueue(status: QueueItemStatus, hasTechnician: boolean): { ok: boolean; reason?: string } {
  if (status === "moved_to_tech_queue") return { ok: false, reason: "ALREADY_MOVED" };
  if (["cancelled", "removed", "in_service"].includes(status)) return { ok: false, reason: "NOT_ELIGIBLE" };
  if (!hasTechnician) return { ok: false, reason: "TECHNICIAN_REQUIRED" };
  return { ok: true };
}
export function buildServingIdempotencyKey(queueItemId: string): string { return queueItemId + ":move_to_serving"; }
export function buildTechQueueIdempotencyKey(queueItemId: string): string { return queueItemId + ":move_to_tech_queue"; }
// Pure: return rate = share of the distinct customers currently in the queue who are returning (have >=1 prior paid
// visit). Whole percent; 0 when there are no identified customers (the UI then shows "pending data"). A waiting guest
// hasn't paid for today's visit yet, so their paid-ticket count equals their prior-visit count.
export function computeReturnRatePercent(customers: { customerId?: string | null }[], visitsByCustomer: Record<string, number>): number {
  const ids = new Set<string>();
  for (const c of customers) if (c.customerId) ids.add(c.customerId);
  if (ids.size === 0) return 0;
  let returning = 0;
  for (const id of ids) if ((visitsByCustomer[id] || 0) > 0) returning++;
  return Math.round((returning / ids.size) * 100);
}
export function queueSearch(rows: POSQueueItemRow[], q: string): POSQueueItemRow[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter((r) => r.customerName.toLowerCase().includes(s) || (r.customerPhone || "").toLowerCase().includes(s) || (r.assignedTechnicianName || "").toLowerCase().includes(s) || r.requestedServices.some((x) => x.serviceName.toLowerCase().includes(s)) || (r.notes || "").toLowerCase().includes(s) || r.queueItemId.toLowerCase().includes(s));
}

// ===== Reference-module pure aggregates (unit-testable; computed from active queue items) =====
type QAggItem = { source?: string; isVip?: boolean; priority?: string; customerId?: string | null; requestedServices: { serviceName: string; priceCents?: number }[] };

// Top Waiting Services + Service Mix: count by the *primary* requested service of each active item (one documented
// counting rule — the first requested service represents the visit's headline service).
export function buildTopWaitingServices(items: QAggItem[]): QueueServiceBar[] {
  const by: Record<string, number> = {};
  for (const it of items) { const name = it.requestedServices?.[0]?.serviceName; if (name) by[name] = (by[name] || 0) + 1; }
  const total = Object.values(by).reduce((a, x) => a + x, 0);
  return Object.entries(by).map(([service, count]) => ({ service, count, sharePercent: total ? Math.round((count / total) * 100) : 0 })).sort((a, b) => b.count - a.count).slice(0, 6);
}
// Visit Source Mix: canonical source buckets (App / Phone / Walk-In / AI Receptionist / In Person).
export function buildVisitSourceMix(items: QAggItem[]): QueueMixSlice[] {
  const map: Record<string, string> = { online: "App", app: "App", phone: "Phone", google: "Phone", walk_in: "Walk-In", ai: "AI Receptionist", manual: "In Person", appointment: "In Person" };
  const by: Record<string, number> = {};
  for (const it of items) { const k = map[it.source || "manual"] || "In Person"; by[k] = (by[k] || 0) + 1; }
  const total = Object.values(by).reduce((a, x) => a + x, 0);
  return Object.entries(by).map(([label, count]) => ({ label, count, sharePercent: total ? Math.round((count / total) * 100) : 0 })).sort((a, b) => b.count - a.count);
}
// Customer Type Mix: VIP first, then Walk-In vs Returning vs New (returning = has >=1 prior paid visit).
export function buildCustomerTypeMix(items: QAggItem[], returnVisits: Record<string, number>): QueueMixSlice[] {
  const by: Record<string, number> = { Returning: 0, New: 0, VIP: 0, "Walk-In": 0 };
  for (const it of items) {
    if (it.isVip || it.priority === "vip") { by.VIP++; continue; }
    if (it.source === "walk_in") { by["Walk-In"]++; continue; }
    if (it.customerId && (returnVisits[it.customerId] || 0) > 0) by.Returning++; else by.New++;
  }
  const total = Object.values(by).reduce((a, x) => a + x, 0);
  return Object.entries(by).filter(([, c]) => c > 0).map(([label, count]) => ({ label, count, sharePercent: total ? Math.round((count / total) * 100) : 0 }));
}
// Potential Revenue by Queue: sum requested-service prices of active items, grouped by primary service.
export function buildQueuePotentialRevenue(items: QAggItem[]): { byService: { service: string; revenueCents: number }[]; totalCents: number } {
  const by: Record<string, number> = {}; let total = 0;
  for (const it of items) { for (const rs of (it.requestedServices || [])) { const c = rs.priceCents || 0; total += c; const name = rs.serviceName || "Other"; by[name] = (by[name] || 0) + c; } }
  return { byService: Object.entries(by).map(([service, revenueCents]) => ({ service, revenueCents })).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 6), totalCents: total };
}

// Queue Conversion (canonical) — of the guests who checked into the queue on the business day and were not
// administratively cancelled, the share that reached Serving (status → in_service, stamped via started_at).
// Denominator therefore counts guests who left / no-showed as "did not convert"; only `cancelled` visits are
// excluded (they never intended to flow through). Returns null when there's nothing to measure.
export function computeQueueConversion(eligibleCount: number, convertedCount: number): number | null {
  if (!eligibleCount || eligibleCount <= 0) return null;
  return Math.min(100, Math.round((convertedCount / eligibleCount) * 100));
}
export const QUEUE_CONVERSION_GOAL_PERCENT = 70;

// ===== Auto Balance (preview-then-confirm) — proposals come from the AI engine (QUEUE_RECOMMENDER.balance) =====
// BUILD_PLAN Phase 6 (audit parallel implementation 1 + bug 11): the queue's own scorer (buildAutoBalanceProposals over
// recommendTechnician) is removed. Same wire shape for the POS; `available: false` when no engine is bound.
export interface AutoBalanceProposal { queueItemId: string; customerName: string; technicianId: string; technicianName: string; reason: string; addressesWaitMinutes: number; confidence?: number; expectedTechnicianId?: string | null; expectedVersion?: number }
export interface AutoBalancePreview {
  proposals: AutoBalanceProposal[]; unassignable: { queueItemId: string; customerName: string; reason: string }[];
  summary: { proposed: number; guestsConsidered: number; totalWaitAddressedMinutes: number };
  available?: boolean; unavailableReason?: string;
}
