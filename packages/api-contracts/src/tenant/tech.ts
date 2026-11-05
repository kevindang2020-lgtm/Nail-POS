// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

// ---- §8 profile ----
export interface TechMe {
  technicianId: string;
  fullName: string;
  initials: string;
  roleLabel: string;
  avatarUrl?: string;
  status: TechnicianStatus;
}

// ---- §9 today's overview ----
export interface TechTodayOverview {
  bookings: number;
  completed: number;
  inService: number;
  totalSalesCents: number;
  totalSalesTrendPercent: number;
}

// ---- §10 current service ----
export interface TechCurrentService {
  ticketId: string;
  queueItemId: string;
  serviceLineId: string;
  customerId: string;
  customerInitials: string;
  customerName: string;
  serviceName: string;
  startedAt: string;        // ISO; client counts up from here
  elapsedSeconds: number;   // server-computed at fetch time (source of truth)
  estimatedFinishTime?: string;
  status: "accepted" | "serving" | "nearly_finished";
}

// ---- §11 next appointment ----
export interface TechNextAppointment {
  appointmentId: string;
  customerInitials: string;
  customerName: string;
  serviceName: string;
  startTime: string;
  status: "confirmed" | "arrived" | "checked_in" | "waiting" | "assigned";
}

// A row in the technician's full day schedule. Unlike TechNextAppointment (upcoming only), status is the raw appointment
// status so completed / cancelled / no-show items also render.
export interface TechScheduleItem {
  appointmentId: string;
  customerInitials: string;
  customerName: string;
  serviceName: string;
  startTime: string;
  status: string;
  durationMinutes: number;
  vip: boolean;
  inspirationPhotoUrl?: string | null;
}

// ---- §12 earnings snapshot ----
export interface TechEarningsSnapshot {
  todaySalesCents: number;
  /** from the compensation snapshot (the ONE payroll authority); null ⇒ the authority could not be read — never estimated */
  tipsCents: number | null;
  /** from the compensation snapshot (service + retail commission + posted adjustments); null ⇒ unknown, never estimated */
  estimatedCommissionCents: number | null;
  /** why tips / commission are null (ONE-PAY: there is no fallback formula) */
  note?: string;
}

// One completed service line in the technician's earnings detail (today). commissionCents is the compensation snapshot's figure.
export interface TechEarningsLine {
  serviceName: string;
  lineTotalCents: number;
  commissionCents: number;
  completedAt: string;
}

export interface TechEarningsDetail { snapshot: TechEarningsSnapshot; lines: TechEarningsLine[]; period?: EarningsPeriod; dateFrom?: string; dateTo?: string }

// ---- §15 available actions ----
export interface TechAvailableActions {
  canAcceptTicket: boolean;
  canStartService: boolean;
  canMarkServiceDone: boolean;
  canToggleBreak: boolean;
}

// ---- §15 consolidated state ----
export interface TechDashboardState {
  technician: TechMe;
  overview: TechTodayOverview;
  currentService?: TechCurrentService;
  nextAppointment?: TechNextAppointment;
  earnings: TechEarningsSnapshot;
  notificationsCount: number;
  availableActions: TechAvailableActions;
  assignedTicketId?: string | null;   // id of the assigned-unaccepted ticket (so the client can Accept it), else null
}

export interface TechTicketServiceLine { id: string; name: string; priceCents: number; durationMinutes: number; status: string; /** catalog service id (eligibility, Oct 12 2026 merge); null for retail / custom lines */ serviceId?: string | null; }

export interface TechTicketListItem { ticketId: string; ticketNumber?: string; customerName: string | null; serviceSummary: string; status: TechTicketStatus; startedAt?: string | null; totalCents: number; acceptanceDeadline?: string | null; version?: number; scheduledStart?: string | null; vip?: boolean; }

export interface TechQueueCustomer { name: string | null; serviceSummary: string; scheduledTime?: string | null; status: string; }

/** BUILD_PLAN Phase 6 round 2 — how a guest came to the technician (latest assign row of the queue history), the active
 *  manager lock, and whether it pins the guest to THIS technician. Absent for a ticket with no queue row. */
export type TechAssignSource = 'staff' | 'ai_suggestion' | 'auto_assign' | 'repair' | 'customer';
export interface TechAssignmentSignals {
  queueItemId?: string | null; assignSource?: TechAssignSource;
  lock?: { technicianId: string | null; reason: string | null } | null; lockedToYou?: boolean;
}
export interface TechQueueEntry extends TechAssignmentSignals { ticketId: string; ticketNumber: string; name: string | null; serviceSummary: string; scheduledTime?: string | null; status: TechTicketStatus; vip: boolean; mine: boolean; }

export interface TechQueueState { turnPosition: number | null; status: TechnicianStatus; upNext?: TechQueueCustomer; following?: TechQueueCustomer; onBreak: boolean; myQueue?: TechQueueEntry[]; branchQueue?: TechQueueEntry[];
  /** 200-technician mandate §43 (Oct 23 2026): the branch's whole active queue size — branchQueue is the next BRANCH_QUEUE_WINDOW only, never a silent cut */
  branchQueueTotal?: number; }
/** How many of the branch's active tickets the Technician App shows as context (the rest are counted in branchQueueTotal). */
export const TECH_BRANCH_QUEUE_WINDOW = 50;

export interface TechMoreState { technician: TechMe; workingHoursLabel: string | null; skillsLabel: string | null; }

export interface TechSkillService { serviceId: string; serviceName: string; isPrimary: boolean; }

export interface RequestableService { serviceId: string; serviceName: string; category: string | null; }

export type SkillChangeType = 'add' | 'remove';

// Functional Decision 9 — the signed-in technician's own time-clock state (server time is authoritative).
export interface TechClockView { state: 'clocked_in' | 'clocked_out'; clockedInAt: string | null; lastClockOutAt: string | null; hoursToday: number; serverTime: string; }
export type SkillChangeStatus = 'draft' | 'submitted' | 'pending' | 'under_review' | 'more_information_required' | 'approved' | 'rejected';

export interface SkillChangeRequest { id: string; serviceId: string; serviceName: string; requestType: SkillChangeType; note: string | null; status: SkillChangeStatus; createdAt: string; decidedAt: string | null; proficiencyLevel?: string | null; experienceYears?: number | null; supportingPhotos?: string[]; certificateEvidence?: string | null; reviewNotes?: string | null; submittedAt?: string | null; }

export interface TechSkillsView extends TechSkills { requestableServices: RequestableService[]; requests: SkillChangeRequest[]; }

export interface TechWorkingHoursDay { dayOfWeek: number; startTime: string | null; endTime: string | null; lunchStartTime: string | null; lunchEndTime: string | null; isWorking: boolean; }

// The technician's payroll as they see it: one row per finalized/paid period they have a line in, plus a paid/unpaid/total roll-up.
export interface TechPayrollPeriod {
  periodId: string; label: string | null; periodStart: string; periodEnd: string;
  status: 'draft' | 'finalized' | 'paid'; paidAt: string | null;
  servicesCount: number; grossCents: number; commissionCents: number; tipsCents: number; adjustmentCents: number; payableCents: number;
  /** Payroll wave 2 (§78/§85–§89): what was actually PAID for this period (recorded payouts) and what is still owed. */
  paidCents?: number; outstandingCents?: number;
  retailCommissionCents?: number; hourlyPayCents?: number; salaryPayCents?: number; bonusCents?: number; guaranteeTopUpCents?: number; deductionCents?: number;
}
/** §89 one recorded payout of the technician's own pay. */
export interface TechPayout { id: string; periodId: string; periodLabel: string | null; periodStart: string; periodEnd: string; amountCents: number; method: string; status: string; paidAt: string | null; createdAt: string }
/** §152 the technician's question about an earning (the manager's private note never crosses to the Tech App). */
export interface TechPayrollInquiry { id: string; periodId: string | null; subjectType: string; subjectId: string | null; message: string; status: string; response: string | null; respondedAt: string | null; createdAt: string }

export type TechnicianStatus =
  | "available" | "assigned" | "in_service" | "on_break" | "lunch" | "off_shift";

export type EarningsPeriod = 'day' | 'week' | 'month' | 'custom';   // 'custom' (dateFrom/dateTo): developer, Sep 2026

export type TechTicketStatus = 'assigned' | 'accepted' | 'serving' | 'nearly_finished' | 'paused' | 'done' | 'cancelled';

export interface TechSkills { specialties: string[]; services: TechSkillService[]; }

/** Multi-technician routing: a part of a shared (split) visit as the technician sees it. The tech ticket detail
 *  (TechTicketView, modules/queue tech.repository.ts) gains `sharedVisit?: TechSharedVisit | null`. */
export interface TechSharedVisit { visitPart: number; partCount: number; others: { technicianName: string | null; serviceNames: string[]; status: string }[] }

// ── Technician App self-service reads + certifications (Oct 12 2026 merge; other chat, workforce audit #26/#99, P2 #28) ──
// GET /tech/time-clock/summary · /tech/performance?days=7|30|90 · /tech/tips?days=7|14|30 · /tech/customers?search=
export interface TechTimeClockView {
  clockStatus: 'CLOCKED_OUT' | 'CLOCKED_IN' | 'ON_BREAK'; timezone: string;
  today: { punches: Array<{ start: string; end: string | null; minutes: number }>; breaks: Array<{ kind: string; start: string; end: string | null; minutes: number }>; workedMinutes: number; breakMinutes: number };
  weekWorkedMinutes: number;
}
export interface TechPerformanceView {
  windowDays: number; servicesCompleted: number; ticketsServed: number; salesCents: number; averageTicketCents: number;
  tipsCents: number; tipRatePercent: number | null; rating: { average: number | null; count: number }; returningCustomerPercent: number | null;
}
export interface TechTipsView { windowDays: number; totalCents: number; cardCents: number; cashCents: number; byDay: Array<{ date: string; cardCents: number; cashCents: number }> }
/** First name + last initial and visit history only — never contact details or the customer id (customerKey is opaque). */
export interface TechCustomerRow { customerKey: string; displayName: string; visits: number; lastVisitAt: string | null; lastServices: string[] }
// GET/POST /tech/certifications, PATCH/DELETE /tech/certifications/:id · GET /pos/technician-certifications/:technicianId,
// POST /pos/technician-certifications/:technicianId/:certificationId/verify { status: 'VERIFIED' | 'REVOKED', reason? }
export type TechCertificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'EXPIRED' | 'REVOKED';
export interface TechCertificationView {
  id: string; technicianId: string | null; globalTechProfileId: string | null; name: string; issuer: string | null;
  issuedAt: string | null; expiresAt: string | null; hasDocument: boolean; verificationStatus: TechCertificationStatus;
  verifiedAt: string | null; verifiedByUserId: string | null; revokedReason: string | null; daysToExpiry: number | null; createdAt: string; updatedAt: string;
}
/** DELETE /tech/certifications/:id */
export interface TechCertificationDeleted { ok: true }
export interface TechCertificationBody { name?: string; issuer?: string | null; issuedAt?: string | null; expiresAt?: string | null; documentKey?: string | null }
