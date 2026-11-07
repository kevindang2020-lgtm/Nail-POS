import type { TechMetrics, TechMetricPeriod } from '@aipowersalon/workforce';
/**
 * tech.repository.ts — data port for the Technician-mobile surface (and an honest empty in-memory fallback).
 *
 * TechService owns the authorization + state-guard logic; this port abstracts the cross-domain reads/writes (technician
 * resolution, dashboard pieces, ticket lookup, the accept/start/complete transitions, and break state). The Postgres
 * (Kysely) implementation is deferred to the next slice. The in-memory fallback returns NO data (no technician, no
 * tickets) so that, without a database, the tech endpoints honestly report "nothing" rather than fabricating activity.
 */
import type { TechTicketServiceLine, TechTicketListItem, TechQueueCustomer, TechQueueEntry, TechQueueState, TechMoreState, TechSkillService, RequestableService, SkillChangeType, SkillChangeStatus, SkillChangeRequest, TechSkillsView, TechWorkingHoursDay, TechPayrollPeriod, TechTicketStatus, TechSkills, TechSharedVisit } from '@aipowersalon/api-contracts/tenant';
export type { TechTicketServiceLine, TechTicketListItem, TechQueueCustomer, TechQueueEntry, TechQueueState, TechMoreState, TechSkillService, RequestableService, SkillChangeType, SkillChangeStatus, SkillChangeRequest, TechSkillsView, TechWorkingHoursDay, TechPayrollPeriod, TechTicketStatus, TechSkills };   // owned by packages/api-contracts (Constitution 13 §13)
import { TechError } from './tech-errors';
import type { Role } from '@aipowersalon/permissions';
import type { TechMe, TechNextAppointment, TechScheduleItem, TechnicianStatus, LineSnapshot } from './tech-dashboard.dto';
import type { CurrentServiceInput } from './tech-dashboard.core';

/** BUILD_PLAN Phase 6 round 2 — how a guest came to the technician (the latest assign row of pos_queue_status_history:
 *  staff / AI suggestion / auto-assign / repair / the customer), whether a manager locked them, and whether to THIS
 *  technician. Joined from pos_tech_queue_tickets to its pos_queue_items row; absent for a ticket with no queue row. */
export type TechAssignSource = 'staff' | 'ai_suggestion' | 'auto_assign' | 'repair' | 'customer';
export interface TechAssignmentSignals {
  queueItemId?: string | null; assignSource?: TechAssignSource;
  lock?: { technicianId: string | null; reason: string | null } | null; lockedToYou?: boolean;
}
export interface TechContext { tenantId: string; branchId: string; userId: string; role: Role; permissions: string[]; }

/** Ticket as the technician sees it. The accept/start/done transitions only need id+technicianId+status; the detail
 *  read additionally fills the rich fields (customer/services/notes/total/timestamps). All optional so the lightweight
 *  transition returns and the empty in-memory fallback still satisfy the type. */
export interface TechTicketView extends TechAssignmentSignals {
  addOnSuggestions?: { serviceId: string; serviceName: string; priceCents: number; source: string }[];
  ticketId: string; realTicketId?: string | null; technicianId: string | null; status: TechTicketStatus;
  ticketNumber?: string; customerId?: string | null; customerName?: string | null; customerPhoneMasked?: string | null;
  services?: TechTicketServiceLine[]; notes?: string | null; totalCents?: number; durationMinutes?: number;
  scheduledStart?: string | null; scheduledEnd?: string | null;
  acceptedAt?: string | null; startedAt?: string | null; completedAt?: string | null; acceptanceDeadline?: string | null; startSource?: string | null; version?: number;
  // Reference-rich fields — populated from real joins (customer VIP / preferred tech / assignment signals). Fields
  // with no backing column (loyalty tier, structured allergies, inspo) stay null rather than being invented.
  vip?: boolean; loyaltyTier?: string | null; allergies?: string[] | null; safetyNotes?: string | null;
  assignmentReason?: string | null; requestedTechnician?: string | null; inspoUrl?: string | null;
  /** multi-technician routing: this ticket is part n of a split visit — the other parts (null / absent = the whole visit) */
  sharedVisit?: TechSharedVisit | null;
}
export interface PendingSkillChangeRequest extends SkillChangeRequest { technicianId: string; technicianName: string; }
// Functional Decision 7 — the reviewer's steps: DRAFT -> SUBMITTED -> UNDER_REVIEW -> MORE_INFORMATION_REQUIRED ->
// APPROVED / REJECTED. 'pending' is the legacy name for submitted (rows written before migration 475). A draft is the
// technician's own and never reaches a reviewer; a request waiting on more information goes back to SUBMITTED only when
// the technician resubmits it (updateSkillChangeRequest), though the reviewer may still approve or reject it outright.
export type SkillReviewDecision = 'under_review' | 'more_information_required' | 'approved' | 'rejected';
export const SKILL_REVIEW_DECISIONS: readonly SkillReviewDecision[] = ['under_review', 'more_information_required', 'approved', 'rejected'];
const SKILL_REVIEW_MOVES: Record<string, readonly SkillReviewDecision[]> = {
  submitted: SKILL_REVIEW_DECISIONS, pending: SKILL_REVIEW_DECISIONS,
  under_review: ['more_information_required', 'approved', 'rejected'],
  more_information_required: ['approved', 'rejected'],
};
export function canReviewSkillRequest(from: string, to: string): boolean {
  return (SKILL_REVIEW_MOVES[from] ?? []).includes(to as SkillReviewDecision);
}
export interface SkillChangeBody { serviceId: string; requestType?: SkillChangeType; note?: string | null; proficiencyLevel?: string | null; experienceYears?: number | null; supportingPhotos?: string[]; certificateEvidence?: string | null; status?: SkillChangeStatus; }
export interface NoteBody { note?: string; visibility?: 'internal' | 'customer' }
export interface CancelRequestBody { reason?: string }
/** §11 technician declines a pending assignment offer. A reason is REQUIRED (the service rejects an empty one). */
export interface DeclineBody { reason: string; reasonCode?: string | null }
// §27 audit trail — actions only; NEVER store passwords/tokens/payment data/private note bodies.
export type TechAuditAction =
  | 'technician_ticket_viewed' | 'technician_ticket_accepted' | 'technician_service_started'
  | 'technician_note_added' | 'technician_service_completed' | 'technician_service_paused' | 'technician_service_resumed' | 'technician_ticket_cancel_requested' | 'technician_ticket_declined' | 'technician_addon_added' | 'technician_service_added'
  | 'technician_break_started' | 'technician_break_ended' | 'technician_earnings_viewed'
  | 'technician_skill_change_requested' | 'technician_skill_change_updated' | 'technician_skill_change_decided'
  | 'technician_clocked_in' | 'technician_clocked_out'
  // Oct 12 2026 merge (Technician Profile): eligibility + certification + help-message bookkeeping
  | 'technician_skill_review_started' | 'technician_skill_more_info_requested' | 'technician_eligibility_granted' | 'technician_eligibility_revoked'
  | 'technician_eligibility_refused' | 'technician_certification_added' | 'technician_certification_updated' | 'technician_certification_deleted' | 'technician_certification_verified' | 'technician_certification_revoked'
  | 'technician_manager_message_resolved';
export interface AuditMeta {
  serviceId?: string; ticketId?: string | null; data?: Record<string, unknown> }

export interface ServiceDoneBody { notes?: string }

export interface TechDashboardRaw {
  technician: TechMe;
  todayLines: LineSnapshot[];
  bookings: number; completed: number; inService: number; salesTrendPercent: number;
  currentService?: CurrentServiceInput;
  nextAppointment?: TechNextAppointment;
  notificationsCount?: number;
  hasAssignedUnacceptedTicket: boolean;
  hasAcceptedNotStarted: boolean;
  assignedTicketId?: string | null;
}

export interface TechDataPort {
  resolveTechnicianId(ctx: TechContext): Promise<string | null>;
  /** F5 §73 (Nov 6 2026): the technician's Today / Week / Month metrics (clocked, break, service, ready minutes, turn units) */
  techMetrics?(ctx: TechContext, technicianId: string, period: TechMetricPeriod): Promise<TechMetrics>;
  /** §26 platform kill switch (tenant_app_flags.technician_app). */
  technicianAppEnabled(ctx: TechContext): Promise<boolean>;
  /** Per-technician switch (technician_app_settings.app_enabled). Optional so existing fakes still type-check; the
   *  Kysely port implements it and TechService fails closed when it answers false. Absent row = enabled. */
  technicianAppAccessEnabled?(ctx: TechContext, technicianId: string): Promise<boolean>;
  listNotifications(ctx: TechContext, technicianId: string, limit?: number): Promise<{ id: string; type: string; title: string; body: string | null; reference: string | null; readAt: string | null; createdAt: string }[]>;
  markNotificationsRead(ctx: TechContext, technicianId: string, ids: string[] | 'all'): Promise<number>;
  todaySchedule(ctx: TechContext, technicianId: string, nowMs?: number, dateStr?: string): Promise<TechScheduleItem[]>;
  // todayEarningsLines / earningsLines (a second "price × stamped rate" earnings reader, UTC window, no tips) were
  // REMOVED Oct 13 2026 (FLOW duplicate D2): nothing called them; the compensation snapshot is the one earnings source.
  serviceHistory(ctx: TechContext, technicianId: string, service?: string, limit?: number): Promise<{ items: { ticketId: string; serviceName: string; customerName: string; completedAt: string | null; rating: number | null; lineTotalCents: number }[]; services: string[] }>;
  dashboardRaw(ctx: TechContext, technicianId: string, nowMs?: number): Promise<TechDashboardRaw>;
  getTicket(ctx: TechContext, ticketId: string): Promise<TechTicketView | null>;
  accept(ctx: TechContext, ticketId: string, expectedVersion?: number): Promise<boolean>;
  decline(ctx: TechContext, ticketId: string, body: DeclineBody): Promise<void>;
  start(ctx: TechContext, ticketId: string): Promise<boolean>;
  pause(ctx: TechContext, ticketId: string): Promise<void>;
  resume(ctx: TechContext, ticketId: string): Promise<void>;
  complete(ctx: TechContext, ticketId: string, body: ServiceDoneBody): Promise<void>;
  breakContext(ctx: TechContext, technicianId: string): Promise<{ status: TechnicianStatus; hasActiveService: boolean }>;
  setBreak(ctx: TechContext, technicianId: string, on: boolean, managerOverride: boolean): Promise<TechnicianStatus>;
  listTickets(ctx: TechContext, technicianId: string, nowMs?: number): Promise<TechTicketListItem[]>;
  queueState(ctx: TechContext, technicianId: string, nowMs?: number): Promise<TechQueueState>;
  moreState(ctx: TechContext, technicianId: string): Promise<TechMoreState>;
  addNote(ctx: TechContext, ticketId: string, body: NoteBody): Promise<void>;
  requestCancel(ctx: TechContext, ticketId: string, body: CancelRequestBody): Promise<void>;
  recordAudit(ctx: TechContext, technicianId: string, action: TechAuditAction, meta?: AuditMeta): Promise<void>;
  skills(ctx: TechContext, technicianId: string): Promise<TechSkills>;
  workingHours(ctx: TechContext, technicianId: string): Promise<TechWorkingHoursDay[]>;
  requestableServices(ctx: TechContext, technicianId: string): Promise<RequestableService[]>;
  createSkillChangeRequest(ctx: TechContext, technicianId: string, body: SkillChangeBody): Promise<SkillChangeRequest>;
  /** true when pause/resume reach clients through the domain-event projection (outbox AND publisher on) */
  emitsDomainEvents?(): boolean;
  updateSkillChangeRequest(ctx: TechContext, requestId: string, technicianId: string, body: SkillChangeBody): Promise<SkillChangeRequest>;
  listSkillChangeRequests(ctx: TechContext, technicianId: string): Promise<SkillChangeRequest[]>;
  listPendingSkillChangeRequests(ctx: TechContext): Promise<PendingSkillChangeRequest[]>;
  decideSkillChangeRequest(ctx: TechContext, requestId: string, decision: SkillChangeStatus, decidedByUserId: string, reviewNotes?: string | null): Promise<PendingSkillChangeRequest>;
  // The technician's OWN finalized payroll — read from the same payroll_periods/payroll_lines the owner/manager
  // Payroll screen writes (no parallel data model, no recompute here — this is a read of what payroll already produced).
  myPayroll(ctx: TechContext, technicianId: string): Promise<TechPayrollView>;
  saveManagerMessage(ctx: TechContext, data: { technicianId: string; technicianName: string; topic: string; message: string }): Promise<string>;
  /** With `technicianId`: only that technician's own messages. Without: the salon inbox (manager read). */
  getManagerMessages(ctx: TechContext, technicianId?: string): Promise<TechManagerMessage[]>;
  resolveManagerMessage(ctx: TechContext, messageId: string): Promise<void>;
}

export interface TechManagerMessage {
  id: string;
  technicianId: string;
  technicianName: string;
  topic: string;
  message: string;
  status: string;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface TechPayrollView {
  paidCents: number; unpaidCents: number; totalCents: number;
  periods: TechPayrollPeriod[];
}

export class InMemoryTechRepository implements TechDataPort {
  /** test hook for the §26 kill switch */
  technicianAppFlag = true;
  async technicianAppEnabled(_ctx: TechContext) { return this.technicianAppFlag; }
  notifications: { id: string; technicianId: string; type: string; title: string; body: string | null; reference: string | null; readAt: string | null; createdAt: string }[] = [];
  async listNotifications(_ctx: TechContext, technicianId: string, limit = 50) {
    return this.notifications.filter((n) => n.technicianId === technicianId).slice(0, limit).map(({ technicianId: _t, ...n }) => n);
  }
  async markNotificationsRead(_ctx: TechContext, technicianId: string, ids: string[] | 'all') {
    let c = 0;
    for (const n of this.notifications) if (n.technicianId === technicianId && !n.readAt && (ids === 'all' || ids.includes(n.id))) { n.readAt = new Date().toISOString(); c++; }
    return c;
  }

  async resolveTechnicianId(): Promise<string | null> { return null; }
  async myPayroll(): Promise<TechPayrollView> { return { paidCents: 0, unpaidCents: 0, totalCents: 0, periods: [] }; }
  async todaySchedule(): Promise<TechScheduleItem[]> { return []; }
  async serviceHistory(): Promise<{ items: never[]; services: never[] }> { return { items: [], services: [] }; }
  async dashboardRaw(_ctx: TechContext, technicianId: string): Promise<TechDashboardRaw> {
    return {
      technician: { technicianId, fullName: '', initials: '?', roleLabel: '', status: 'off_shift' },
      todayLines: [], bookings: 0, completed: 0, inService: 0, salesTrendPercent: 0,
      notificationsCount: this.notifications.filter((n) => n.technicianId === technicianId && !n.readAt).length, hasAssignedUnacceptedTicket: false, hasAcceptedNotStarted: false,
    };
  }
  async getTicket(): Promise<TechTicketView | null> { return null; }
  async accept(): Promise<boolean> { return true; /* no-op port: treat as applied */ }
  async decline(): Promise<void> { /* no-op (no data source) */ }
  async start(): Promise<boolean> { return true; /* no-op port: treat as applied */ }
  async pause(): Promise<void> { /* no-op */ }
  async resume(): Promise<void> { /* no-op */ }
  async complete(): Promise<void> { /* no-op */ }
  async breakContext(): Promise<{ status: TechnicianStatus; hasActiveService: boolean }> { return { status: 'off_shift', hasActiveService: false }; }
  async setBreak(_ctx: TechContext, _id: string, on: boolean): Promise<TechnicianStatus> { return on ? 'on_break' : 'available'; }
  async listTickets(): Promise<TechTicketListItem[]> { return []; }
  async queueState(_ctx: TechContext, _id: string): Promise<TechQueueState> { return { turnPosition: null, status: 'off_shift', onBreak: false }; }
  async moreState(_ctx: TechContext, technicianId: string): Promise<TechMoreState> { return { technician: { technicianId, fullName: '', initials: '?', roleLabel: '', status: 'off_shift' }, workingHoursLabel: null, skillsLabel: null }; }
  async addNote(): Promise<void> { /* no-op (no data source) */ }
  async requestCancel(): Promise<void> { /* no-op */ }
  async recordAudit(): Promise<void> { /* no-op (no data source) */ }
  async skills(): Promise<TechSkills> { return { specialties: [], services: [] }; }
  async workingHours(): Promise<TechWorkingHoursDay[]> { return []; }
  async requestableServices(): Promise<RequestableService[]> { return []; }
  async createSkillChangeRequest(): Promise<SkillChangeRequest> { throw new TechError('not_found', 'No data source.'); }
  async updateSkillChangeRequest(): Promise<SkillChangeRequest> { throw new TechError('not_found', 'No data source.'); }
  async listSkillChangeRequests(): Promise<SkillChangeRequest[]> { return []; }
  async listPendingSkillChangeRequests(): Promise<PendingSkillChangeRequest[]> { return []; }
  async decideSkillChangeRequest(): Promise<PendingSkillChangeRequest> { throw new TechError('not_found', 'No data source.'); }
  async saveManagerMessage(_ctx: TechContext, _data: any): Promise<string> { return 'mock_msg_id'; }
  async getManagerMessages(_ctx: TechContext, _technicianId?: string): Promise<TechManagerMessage[]> { return []; }
  async resolveManagerMessage(_ctx: TechContext, _id: string): Promise<void> {}
}

/** Derive a human "why you were assigned" reason from real signals (spec §13 — store why the technician was selected).
 *  Pure + unit-tested. Returns null when no signal applies (the UI then omits the line rather than showing a guess). */
export function deriveAssignmentReason(a: { preferredTechId?: string | null; assignedTechId?: string | null; appointmentId?: string | null; source?: string | null }): string | null {
  if (a.preferredTechId && a.assignedTechId && a.preferredTechId === a.assignedTechId) return 'Customer’s preferred technician';
  if (a.appointmentId) return 'Booked appointment';
  switch ((a.source || '').toLowerCase()) {
    case 'walk_in': case 'walkin': return 'Walk-in — assigned at the front desk';
    case 'check_in': case 'checkin': return 'From check-in';
    case 'queue': case 'tech_queue': return 'Next in rotation';
    case 'booking': case 'appointment': return 'Booked appointment';
    default: return null;
  }
}

/** Coerce a jsonb allergies value (array, JSON string, or null) into a clean string[] for the Safety card. Pure. */
export function toStringArray(raw: unknown): string[] | null {
  let v: unknown = raw;
  if (typeof v === 'string') { const str = v; try { v = JSON.parse(str); } catch { return str.trim() ? [str.trim()] : null; } }
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => String(x).trim()).filter(Boolean);
  return out.length ? out : null;
}
