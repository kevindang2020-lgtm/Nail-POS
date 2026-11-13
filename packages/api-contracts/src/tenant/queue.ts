// queue.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

import { foldVi } from '../text/vi-fold';

export interface CheckInFilters { search?: string; source?: string; status?: string; technicianId?: string; branchId?: string; page?: number; pageSize?: number;
  /** 200-technician §2 (Oct 27 2026): one page of Available Technicians; 'none' = no `technicians` name list */
  techPage?: number; techPageSize?: number; roster?: 'none'; }
export interface LiveScheduleFilters {
  date?: string; view?: 'day' | 'week'; status?: string; skill?: string; search?: string;
  /** 200-technician §2 (Oct 27 2026): page the technician COLUMNS (day board and week rows) instead of one per technician of
   *  the salon. Omitted = every column (the legacy shape). */
  lanePage?: number; lanePageSize?: number;
  /** columns by technician name (accent-insensitive: "nguyen" finds "Nguyễn") or "#n" (n = place in the name order) */
  laneSearch?: string;
  /** 'none' = do not return filters.technicians (every technician's name) */
  roster?: 'none';
}
/** GET /pos/technicians/live-schedule/{state,week} with lanePage: the column page that came back. */
export interface LiveScheduleLanePage { page: number; pageSize: number; total: number; totalPages: number; totalAll: number }
export const LIVE_SCHEDULE_LANE_PAGE_SIZE = 12;
export const LIVE_SCHEDULE_LANE_PAGE_SIZE_MAX = 48;
/** The ONE Live Technician Schedule column page rule (200-technician §2, Oct 27 2026; same shape as Tech Appointments):
 *  name order (then id); `laneSearch` = "#n" (n = place in that order) or the name, accent-insensitive (foldVi: "nguyen"
 *  finds "Nguyễn"). Returns null when the request did not ask for paging (legacy: every column). Pure. */
export function liveScheduleLaneIds(columns: { technicianId: string; fullName: string }[], f: Pick<LiveScheduleFilters, 'lanePage' | 'lanePageSize' | 'laneSearch'>): { ids: string[]; lanes: LiveScheduleLanePage } | null {
  if (f.lanePage === undefined && f.lanePageSize === undefined && !f.laneSearch) return null;
  const pageSize = Math.min(LIVE_SCHEDULE_LANE_PAGE_SIZE_MAX, Math.max(1, Math.trunc(Number(f.lanePageSize)) || LIVE_SCHEDULE_LANE_PAGE_SIZE));
  const ordered = columns.slice().sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '') || a.technicianId.localeCompare(b.technicianId));
  const term = foldVi(String(f.laneSearch ?? '').trim());
  const num = /^#?\d{1,6}$/.test(term) ? Number(term.replace('#', '')) : null;
  const hit = term ? ordered.filter((t, i) => (num != null && i + 1 === num) || foldVi(t.fullName || '').includes(term)) : ordered;
  const totalPages = Math.max(1, Math.ceil(hit.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(Number(f.lanePage)) || 1));
  return { ids: hit.slice((page - 1) * pageSize, page * pageSize).map((t) => t.technicianId), lanes: { page, pageSize, total: hit.length, totalPages, totalAll: columns.length } };
}
export interface QueueFilters {
  search?: string; status?: string; source?: string; technicianId?: string; serviceCategory?: string; priority?: string; station?: string; waitMin?: number; waitMax?: number; page?: number; pageSize?: number;
}
export interface ServiceDoneFilters {
  search?: string; status?: string; qualityStatus?: string; checkoutStatus?: string; technicianId?: string; serviceCategory?: string; station?: string; page?: number; pageSize?: number;
}
export interface ServingFilters {
  search?: string; status?: string; technicianId?: string; serviceCategory?: string; station?: string; delayStatus?: string; page?: number; pageSize?: number;
}
export interface TechQueueFilters {
  search?: string; status?: string; source?: string; technicianId?: string; serviceCategory?: string; priority?: string; station?: string; delayStatus?: string; page?: number; pageSize?: number;
  /** 200-technician §2 (Oct 27 2026): page the technician LANES on the server (Live Technician Queue table, lanes, the
   *  Available Technicians list) instead of returning one row per technician of the salon. Omitted = every lane (legacy). */
  lanePage?: number; lanePageSize?: number;
  /** search the lanes by name / specialty (accent-insensitive) or "#n" (n = rotation position) */
  laneSearch?: string;
  /** one of TECH_QUEUE_LANE_STATUS_GROUPS' keys (ready / serving / soon / break / hold / off) */
  laneStatus?: string;
  /** 'none' = do not return filters.technicians (every technician's name); the POS picks through the server-paged picker */
  roster?: 'none';
}
/** §33 status groups over the Tech Queue lane statuses (the screen's status filter; the server pages by them). */
export const TECH_QUEUE_LANE_STATUS_GROUPS: Record<string, string[]> = {
  ready: ['available'],
  serving: ['in_service', 'finishing_soon'],
  soon: ['appointment_soon'],
  break: ['on_break'],
  hold: ['hold'],
  off: ['off_today', 'scheduled_later'],
};
/** GET /pos/tech-queue/state with lanePage: the lane page that came back (totalAll = every lane before search / filter). */
export interface TechQueueLanePage { page: number; pageSize: number; total: number; totalPages: number; totalAll: number }
/** Largest lane page the Tech Queue state returns. */
export const TECH_QUEUE_LANE_PAGE_SIZE_MAX = 48;
/** The ONE lane search + status filter + page rule (server pages with it; the screen's legacy path filters the same way).
 *  Search: "#n" = rotation position n; otherwise the name or a specialty, accent-insensitive (foldVi). */
export function pageTechQueueLanes<T extends { technicianName: string; specialties: string[]; status: string; rotationPosition: number }>(
  rows: T[], q: string | undefined, group: string | undefined, page: number | undefined, pageSize: number,
): { items: T[]; total: number; page: number; totalPages: number } {
  const needle = foldVi(q || '');
  const rot = /^#?(\d+)$/.exec(needle);
  const allowed = group ? TECH_QUEUE_LANE_STATUS_GROUPS[group] || [] : null;
  const hit = rows.filter((r) => (!allowed || allowed.includes(r.status))
    && (!needle || (rot ? r.rotationPosition === Number(rot[1]) : foldVi(r.technicianName).includes(needle) || r.specialties.some((sp) => foldVi(sp).includes(needle)))));
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const totalPages = Math.max(1, Math.ceil(hit.length / size));
  const p = Math.min(Math.max(1, Math.floor(Number(page)) || 1), totalPages);
  return { items: hit.slice((p - 1) * size, p * size), total: hit.length, page: p, totalPages };
}

export interface GoCheckInSettings {
  enabled: boolean;
  appointmentCheckinEnabled: boolean; walkinCheckinEnabled: boolean; newCustomerEnabled: boolean;
  serviceSelectionEnabled: boolean; technicianPreferenceEnabled: boolean;
  tenantPhoneLookupEnabled: boolean; centralLookupEnabled: boolean; customerLinkingEnabled: boolean;
  showWaitEstimate: boolean; autoSendToQueue: boolean; requireFrontDeskApproval: boolean;
  confirmationTimeoutSeconds: number;   // idle auto-return after "You're Checked In!" (seconds)
  /** Dual-Screen mandate §118–§119: the customer display's languages ('en' | 'vi'), the salon's default first. */
  displayLanguages: string[];
}

/** A Go Check-In device as the Super Admin device list shows it (the service maps its row to this view). */
export type GoCheckInDeviceStatus = 'active' | 'inactive' | 'disabled' | 'revoked' | 'expired';
export interface GoCheckInDeviceView {
  deviceId: string; deviceName: string; branchId: string | null; deviceType: string; checkinSlug: string;
  publicUrl: string | null; status: GoCheckInDeviceStatus; lastSeenAt: string | null; tokenExpiresAt: string | null;
  allowedBranchIds: string[];
}
/** GET /super-admin/tenants/:tenantId/go-check-in — the devices plus the tenant's kiosk settings. */
export interface GoCheckInDevicesState { devices: GoCheckInDeviceView[]; settings: GoCheckInSettings }

// ===== BUILD_PLAN Phase 6 (ai_queue_assignment → complete): the shared queue state model, routes under pos/queue =====
// The server's own declarations live in @aipowersalon/queue (queue.dto.ts) with the SAME shapes; once this package's dist
// is rebuilt the queue module imports these instead (one definition).
export type QueueAssignSource = 'staff' | 'ai_suggestion' | 'auto_assign' | 'repair';
/** POST pos/queue/items/:id/assign-technician */
export interface QueueAssignTechnicianRequest {
  technicianId: string; managerOverride?: boolean; expectedTechnicianId?: string | null; expectedVersion?: number;
  source?: QueueAssignSource; idempotencyKey?: string; reason?: string;
  /** Fair Turn §68–69: required (or `reason`) when assigning someone other than the recommended technician outside MANUAL mode →
   *  400 { code: 'MANUAL_OVERRIDE_REASON_REQUIRED' } otherwise. One of TURN_OVERRIDE_REASONS. */
  overrideReasonCode?: string;
}
/** Fair Turn §69: the manual-override reasons (the server records them on the MANUAL_ASSIGN turn event). */
export const TURN_OVERRIDE_REASONS = ['CUSTOMER_REQUEST', 'SKILL_MATCH', 'APPOINTMENT_PROTECTION', 'LANGUAGE_MATCH', 'ACCESSIBILITY_NEED', 'TRAINING', 'MANAGER_DECISION', 'CORRECT_PREVIOUS_MISTAKE', 'EMERGENCY'] as const;
/** Fair Turn §64–66: technician decline reasons — the first eight are safety / eligibility reasons and never cost a turn. */
export const TURN_DECLINE_REASONS = ['NOT_LICENSED', 'NOT_SKILLED', 'MEDICAL_RESTRICTION', 'PHYSICAL_LIMITATION', 'EQUIPMENT_UNAVAILABLE', 'APPOINTMENT_CONFLICT', 'MANAGER_DECISION', 'MANAGER_APPROVED',
  'SERVICE_CONCERN', 'PERSONAL_EMERGENCY', 'CUSTOMER_HISTORY', 'PERSONAL_PREFERENCE', 'OTHER'] as const;
/** 409 bodies: code VERSION_CONFLICT { currentTechnicianId, currentVersion } or ASSIGNMENT_LOCKED { lock } */
export interface QueueItemLock { lockId: string; technicianId: string | null; technicianName?: string | null; reason: string; lockedBy: string | null; expiresAt: string | null; createdAt: string }
/** POST pos/queue/items/:id/lock (needs ai_queue_assignment.override) → the item detail */
export interface LockQueueItemRequest { technicianId: string | null; reason: string; expiresInMinutes?: number }
/** POST pos/queue/items/:id/unlock → the item detail */
export interface UnlockQueueItemRequest { reason: string }
/** POST pos/queue/reorder → { order: { queueItemId, position, version }[] } */
export interface ReorderQueueRequest { order: { queueItemId: string; expectedVersion?: number }[] }
/** GET pos/queue/items/:id/history → { queueItemId, history: QueueHistoryRow[] } */
export interface QueueHistoryRow {
  version: number; fromStatus: string | null; toStatus: string; fromTechnicianId: string | null; toTechnicianId: string | null;
  action: string; source: string; actorId: string | null; reason: string | null; createdAt: string;
}
/** POST pos/queue/groups → QueueGroupView; GET pos/queue/groups → QueueGroupView[] */
export interface CreateQueueGroupRequest { label: string; queueItemIds: string[]; together?: boolean }
export interface QueueGroupView {
  groupId: string; label: string; size: number; together: boolean; status: string; createdAt: string;
  members: { queueItemId: string; customerName: string; status: string; assignedTechnicianId: string | null; assignedTechnicianName: string | null }[];
}
/** PUT pos/queue/items/:id/service-assignments → the item detail */
export interface ServiceAssignmentsRequest { assignments: { serviceId: string; technicianId: string | null }[] }
export interface QueueServiceAssignmentView { serviceId: string; serviceName: string; technicianId: string | null; technicianName: string | null; status: string; sequence: number;
  timing?: PlanLineTiming; afterServiceId?: string | null; plannedStartOffsetMin?: number | null; startedAt?: string | null; completedAt?: string | null; techQueueTicketId?: string | null; version?: number }
/** GET pos/queue/technicians/availability → TechnicianAvailabilityRow[] */
export interface TechnicianAvailabilityRow {
  technicianId: string; name: string; status: 'available' | 'in_service' | 'on_break' | 'blocked' | 'off_shift';
  availableInMinutes: number | null; shiftEndsInMinutes: number | null; activeAssignments: number; onBreak: boolean; nextAppointmentInMinutes: number | null;
}
/** Fields the queue item (row / detail) gained in Phase 6. */
export interface QueueItemPhase6Fields {
  version: number; requestedTechnicianId: string | null; position: number | null; groupId: string | null; locked?: boolean;
  assignedTechnicianId: string | null; bestMatchTechnicianId?: string; previousTechnicianId?: string | null; previousTechnicianName?: string | null;
  /** board rows: { technicianId, reason } | null; the item detail carries the full QueueItemLock */
  lock?: { technicianId: string | null; reason: string | null } | null;
  lateMinutes?: number | null; appointmentStartAt?: string | null; serviceAssignments?: QueueServiceAssignmentView[];
  /** multi-technician routing: ≥2 distinct technicians hold lines of this visit; every line technician (lead first) */
  sharedVisit?: boolean; lineTechnicianIds?: string[];
}
/** POST pos/queue/auto-balance/preview — proposals come from the AI engine; `available: false` when none is bound. */
export interface AutoBalanceProposalView { queueItemId: string; customerName: string; technicianId: string; technicianName: string; reason: string; addressesWaitMinutes: number; confidence?: number; expectedTechnicianId?: string | null; expectedVersion?: number }
export interface AutoBalancePreviewView {
  proposals: AutoBalanceProposalView[]; unassignable: { queueItemId: string; customerName: string; reason: string }[];
  summary: { proposed: number; guestsConsidered: number; totalWaitAddressedMinutes: number }; available?: boolean; unavailableReason?: string;
}
/** POST pos/queue/auto-balance/apply — send expectedTechnicianId / expectedVersion from the preview (never overwrites). */
export interface AutoBalanceApplyRequest { proposals: { queueItemId: string; technicianId: string; expectedTechnicianId?: string | null; expectedVersion?: number }[] }
/** Customer app: GET customer/queue/:queueItemId/alternates, POST customer/queue/:queueItemId/accept-alternate { technicianId } */
export interface CustomerQueueAlternatesView {
  queueItemId: string; requestedTechnicianId: string | null; requestedTechnicianName: string | null; requestedAvailableInMinutes: number | null;
  alternates: { technicianId: string; name: string; availableInMinutes: number | null }[];
}
export interface CustomerAcceptAlternateResult { ok: true; queueItemId: string; requestedTechnicianId: string; requestedTechnicianName: string; technicianName: string; version: number }

// ===== Multi-technician routing (split visits + parties, migration 569) — ONE canonical writer: POST pos/queue/plans/assign =====
export type PlanLineTiming = 'parallel' | 'after';
export interface AssignPlanLineRequest { serviceId: string; technicianId: string; expectedTechnicianId: string | null }
export interface AssignPlanItemRequest { queueItemId: string; expectedVersion: number; expectedTechnicianId: string | null; leadTechnicianId?: string; lines: AssignPlanLineRequest[] }
export interface AssignPlanRequest { items: AssignPlanItemRequest[]; groupId?: string | null; idempotencyKey: string; managerOverride?: boolean; reason?: string | null; source?: QueueAssignSource }
export interface AssignPlanResult { applied: true; replayed: boolean; items: { queueItemId: string; version: number; assignedTechnicianId: string; serviceAssignments: QueueServiceAssignmentView[] }[] }
/** Board rows (POSQueueItemRow + tech-queue waiting guests) gain these. */
export interface QueueBestMatchPlanFields { bestMatchMode?: 'single' | 'split'; bestMatchTechnicianNames?: string[] }
export interface TechQueueSharedPart { technicianId: string; technicianName: string | null; serviceNames: string[]; status: string; visitPart: number }
/** POSTechQueueTicketRow gains these. */
export interface TechQueueSharedPartFields { visitPart?: number | null; sharedWith?: TechQueueSharedPart[] }
/** POST pos/queue/groups/:groupId/move-to-tech-queue */
export interface MoveGroupToTechQueueResult { moved: { queueItemId: string; techQueueTicketIds: string[]; duplicate: boolean }[] }

// ── Serving 07 — Touch Safe Action Review (GET pos/serving/tickets/:ticketId/action-review, pos.serving.view). Before an
//    impactful serving action (Mark Ready, move to another technician, an add-on — at its catalog price or a manual price)
//    the screen shows the guest, the service lines the action touches, the permission it needs and whether THIS person
//    holds it, and every conflict THE action's own gates would raise — computed by the same checks the action runs
//    (canMarkDone, the Service Done lock, the workflow settings, the ONE technician eligibility authority). Read only:
//    nothing is written, moved, priced or sent. Integer cents.
export type ServingReviewAction = 'mark_ready' | 'assign_technician' | 'add_service';
export interface ServingActionReviewConflict { code: string; severity: 'block' | 'warn' | 'info'; vars?: Record<string, string | number> }
export interface ServingActionReview {
  ticketId: string; action: ServingReviewAction;
  guest: { customerName: string; ticketNumber: string; isVip: boolean };
  /** the lines the action touches: Mark Ready → every line; a move → the lines the primary technician performs; an add-on → the new line */
  affected: { serviceLineId: string | null; serviceName: string; technicianName: string | null; priceCents: number; isNew: boolean }[];
  change: { fromTechnicianName?: string | null; toTechnicianName?: string | null; catalogPriceCents?: number; priceCents?: number; priceSource?: 'catalog' | 'manual' } | null;
  permission: { key: string; allowed: boolean; overrideKey?: string; overrideAllowed?: boolean };
  conflicts: ServingActionReviewConflict[];
  /** true when no conflict blocks and the permission is held — the real action would be accepted as reviewed */
  canProceed: boolean;
  /** the server's call whether the screen must stop for a confirmation: always for a move or an add-on; for Mark Ready only
   *  when something blocks or warns (or the permission is missing) — a clean Mark Ready stays one tap */
  needsConfirmation: boolean;
}
