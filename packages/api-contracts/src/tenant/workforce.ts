// workforce.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export type HandoffStatus = 'open' | 'submitted' | 'reconciled' | 'discrepancy' | 'cancelled' | 'reopened';   // reopened: End-of-Day Cash 17
export interface QualifiedTechnician { technicianId: string; displayName: string; workingStatus: string; shiftStatus: string; status: string; }

export interface CashHandoff {
  technicianId: string; technicianName: string; businessDate: string;
  expectedCents: number; paymentCount: number;
  countedCents: number | null; varianceCents: number | null;
  status: HandoffStatus;
  submittedAt: string | null; reconciledAt: string | null; notes: string | null;
  /** End-of-Day Cash (Oct 29 2026): the unit's version (send it back as expectedVersion — a stale count is refused),
   *  how a discrepancy was resolved (the original figures stay), and the cash already transferred into the register. */
  version?: number; resolution?: { reason: string | null; at: string } | null; drawerTransferCents?: number;
}
export interface HandoffLine { ticketId: string; ticketNumber: string; customerName: string; amountCents: number; confirmedAt: string | null; }
export interface CashHandoffDetail extends CashHandoff { lines: HandoffLine[]; }

// ── Time off (merge Oct 12 2026 — technician_time_off 528 + 582; /tech/time-off and /pos/technicians/:id/time-off) ──
/** Our 528 vocabulary: a technician's request is `pending`; a manager decides it once (approved | rejected); a pending
 *  request withdrawn by its technician is `cancelled`. Only `approved` removes availability. */
export type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type TimeOffKind = 'VACATION' | 'SICK' | 'PERSONAL' | 'UNAVAILABLE';
export interface TimeOffEntry {
  id: string; tenantId: string; branchId: string | null; technicianId: string; startsAt: string; endsAt: string;
  kind: TimeOffKind; status: TimeOffStatus; reason: string | null; requestedBy: string | null; approvedBy: string | null;
  decidedAt: string | null; decisionNote: string | null; createdAt: string;
}
/** POST /tech/time-off — the technician is the session user (never named by the client). */
export interface TimeOffRequestBody { startsAt: string; endsAt: string; kind?: TimeOffKind | null; reason?: string | null }
/** POST /pos/technicians/:technicianId/time-off — manager-entered, approved immediately. allBranches → branch_id null. */
export interface TimeOffCreateBody extends TimeOffRequestBody { allBranches?: boolean | null }
/** POST /pos/technicians/:technicianId/time-off/:id/decision — 409 `already_decided` when it is no longer pending. */
export interface TimeOffDecisionBody { decision: 'approved' | 'rejected'; note?: string | null }
export interface TimeOffWithdrawResult { ok: true }

/** GET /pos/technicians/live-schedule/week (merge Oct 12 2026): Monday..Sunday of the week containing `date`, one live
 *  board per salon-local day. The board shape is the live schedule's own (LiveTechnicianScheduleState, modules/queue) —
 *  the server passes it as TBoard; clients that only need the envelope use the default. */
export interface LiveScheduleWeek<TBoard = unknown> { weekStart: string; days: { date: string; board: TBoard }[]; /** with lanePage: the technician-row page */ lanes?: { page: number; pageSize: number; total: number; totalPages: number; totalAll: number } }

// ── Workforce state + breaks (merge Oct 12 2026, WF — technician_workforce_state 579 / technician_breaks 580) ──
/** GET /pos/workforce-status(/:technicianId) — the ONE operational state a technician is in. `queue` is DERIVED
 *  (AVAILABLE only when active, clocked in, not on break, idle, holding no ticket and not manually unavailable). */
export interface TechnicianWorkforceStateView {
  tenantId: string; branchId: string | null; technicianId: string;
  employment: 'active' | 'inactive' | 'suspended' | 'archived';
  clock: 'CLOCKED_OUT' | 'CLOCKED_IN' | 'ON_BREAK';
  shift: 'OFF_SHIFT' | 'ON_SHIFT';
  queue: 'AVAILABLE' | 'ASSIGNED' | 'SERVING' | 'BREAK' | 'UNAVAILABLE' | 'OFF_SHIFT';
  service: 'IDLE' | 'SERVING' | 'PAUSED';
  presence: 'online' | 'offline';
  currentTicketId: string | null; manualUnavailable: boolean;
  openShiftId: string | null; breakStartedAt: string | null; updatedAt: string; version: number;
}
/** POST /pos/workforce-status/:technicianId/unavailable — the manager's "not taking customers" flag (on:false lifts it). */
export interface WorkforceUnavailableBody { on: boolean }
/** POST /pos/time-clock/break-start — `kind` lunch | break (default break). break-end takes { technicianId }. */
export interface TimeClockBreakBody { technicianId: string; kind?: 'break' | 'lunch' | null; reason?: string | null }
/** One technician's time-clock row (the punches of the salon-local day + the open break). */
/** Fair Turn §35–40 (migration 603): the salon's break policy (GET / PUT /pos/time-clock/break-policy). */
export interface TimeClockBreakPolicyValues { jurisdiction: string; restBreakPaidUpToMinutes: number; mealBreakMinMinutes: number; interruptedMealCompensable: boolean; kindDefaults: { break: 'rest' | 'meal'; lunch: 'rest' | 'meal' } }
export interface TimeClockBreakPolicyView { policy: TimeClockBreakPolicyValues; defaults: TimeClockBreakPolicyValues; version: number; salon: unknown; branch: unknown }
/** POST /pos/technician-clock/breaks/:breakId/adjust — the trail rows written (append-only) */
export interface TimeClockBreakAdjustResult { ok: true; adjustments: number }
export interface TimeClockTechnicianRow {
  technicianId: string; technicianName: string | null;
  state: 'clocked_in' | 'on_break' | 'clocked_out' | 'off';
  clockedInAt: string | null; onBreakSince: string | null; lastClockOutAt: string | null;
  hoursToday: number; shiftCount: number;
  shifts: { id: string; technicianId: string; shiftDate?: string; startTime: string | null; endTime: string | null; status: string }[];
  /** today's breaks + break-policy classification (migration 603) */
  breaks?: { id: string; kind: string; startedAt: string; endedAt: string | null; classification: string | null; paidMinutes: number | null; unpaidMinutes: number | null; interrupted: boolean }[];
}
/** 200-technician §2 (Oct 27 2026): GET /pos/time-clock/state?page&pageSize&search&state — one page of the day's roster
 *  (on the clock first, then hours today) instead of every technician of the salon; the KPIs still count everyone.
 *  `state`: clocked_in | on_break | clocked_out | off | on_clock (= clocked in or on break). Omitted page = every row (legacy). */
export interface TimeClockStateQuery { page?: number; pageSize?: number; search?: string; state?: string }
export interface TimeClockRosterPage { page: number; pageSize: number; total: number; totalPages: number; totalAll: number }
export const TIME_CLOCK_PAGE_SIZE_MAX = 48;

// ── Technician Profile mandate (wave 3 TECH, Oct 13 2026) ─────────────────────────────────────────────────────────────
/** GET /pos/technicians/:id/employment-history — one row of THIS salon's employment history (§128; leave merged from approved time off). */
export interface EmploymentHistoryRow {
  id: string;
  type: 'hired' | 'rehired' | 'role_changed' | 'branch_added' | 'branch_removed' | 'suspended' | 'reactivated' | 'terminated' | 'transferred' | 'leave';
  label: string; occurredAt: string; endsAt: string | null;
  branchId: string | null; branchName: string | null; from: string | null; to: string | null; reason: string | null; actorName: string | null;
}
/** POST /pos/technicians/import — per-row outcome (§112; preview outcomes are will_*; never matched by name, §113). */
export type TechnicianImportOutcome = 'will_create' | 'will_invite_existing' | 'already_here' | 'created' | 'invited_existing' | 'refused' | 'invalid';
export interface TechnicianImportRow { line: number; name: string; outcome: TechnicianImportOutcome; technicianId?: string; techCode?: string; message?: string }
export interface TechnicianImportResult { dryRun: boolean; runId: string | null; total: number; results: TechnicianImportRow[]; counts: Record<string, number>; error?: string }
/** GET /pos/technician-profile-changes — a held public-profile edit awaiting this salon's decision (§95; `version` guards the decision). */
export interface ProfileChangeRequest { requestId: string; profileId: string; technicianId: string | null; displayName: string; changes: Record<string, unknown>; current: Record<string, unknown>; requestedAt: string; version: number }
/** GET /pos/technician-profile-changes */
export interface ProfileChangeRequestList { requests: ProfileChangeRequest[] }
/** POST /pos/technician-profile-changes/:requestId/{approve|reject} — `applied` is the public edit now live (empty on reject). */
export interface ProfileChangeDecisionResult { ok: true; decision: 'approved' | 'rejected'; requestId: string; applied: Record<string, unknown> }
/** GET | PATCH /pos/technician-profile-policy — the salon's §95 switch. */
export interface TechnicianProfilePolicy { publicProfileChangesRequireApproval: boolean; updatedAt: string | null }
/** GET /pos/technicians/:technicianId/employment-history (§128). */
export interface EmploymentHistoryResponse { technicianId: string; events: EmploymentHistoryRow[] }
/** POST /tech/profile/pending-changes/withdraw — the technician withdraws her own held public-profile edit (§95). */
export interface PendingProfileChangeWithdrawResult { ok: true; withdrawn: boolean }
/** POST /tech/profile/photos/:photoId/showcase — share an approved public portfolio photo into the Nail Showcase (§46). */
export interface PortfolioShowcaseShareResult { ok: true; postId: string; status: string; already: boolean }
/** DELETE /tech/profile/photos/:photoId/showcase */
export interface PortfolioShowcaseUnshareResult { ok: true; removed: boolean }
