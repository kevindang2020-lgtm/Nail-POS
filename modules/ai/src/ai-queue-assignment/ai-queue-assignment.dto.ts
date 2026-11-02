// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { RequiredAction, RecommendationCandidate, RecommendationEnvelope } from '@aipowersalon/api-contracts/tenant';
import type { RequiredAction, RecommendationCandidate, RecommendationEnvelope } from '@aipowersalon/api-contracts/tenant';
// ai-queue-assignment.dto.ts — shared types for the AI Queue Assignment layer. This module is an intelligence
// layer ON TOP of the existing queue lifecycle (queue/, tech-queue/, technicians/, tech-recommendation/); it never
// re-implements assignment mechanics. Context mirrors QueueContext so controllers reuse the same ctxFrom(req).
export interface QueueAssignmentContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
}

// A hard eligibility failure — a deterministic constraint AI ranking can never bypass.
export type HardFailReason =
  | 'wrong_branch' | 'not_clocked_in' | 'missing_skill' | 'at_capacity' | 'on_break' | 'blocked'
  | 'appointment_reserved' | 'station_unavailable' | 'manual_lock'
  // Fair Turn Engine (wave 2): the technician turn queue's own hard rules
  | 'not_in_rotation' | 'manager_hold' | 'customer_declined';
// (BUILD_PLAN Phase 6, audit "hard-rule gate": wrong_branch now compares the technician's REAL branch with the guest's
// branch; manual_lock means an active lock pins the guest to someone else or to nobody yet.)

export interface EligibilityInput {
  technicianId: string;
  name: string;
  branchId: string | null;           // tech's active branch
  clockedIn: boolean;
  skills: string[];                   // service categories the tech can perform
  requiredCategories: string[];       // categories the visit requires
  activeAssignments: number;          // current active assignments
  maxConcurrent: number;              // branch/tenant capacity per tech (>=1)
  onBreak: boolean;
  blocked: boolean;
  reservedForAppointment: boolean;    // holding this tech for an upcoming confirmed appointment
  stationAvailable: boolean;          // required station/equipment free (true when not required)
  manualLock: boolean;                // staff locked this tech out of new assignments
  /** the guest's branch — a technician of another branch fails wrong_branch (audit: the check was vacuous) */
  queueBranchId?: string | null;
  /** deep-scan (Oct 22 2026): the exact-service eligibility authority's answer; when a boolean it decides missing_skill
   *  (the category match is the fallback only) */
  serviceEligible?: boolean | null;
}

export interface EligibilityResult {
  technicianId: string;
  eligible: boolean;
  hardFails: HardFailReason[];
}

// Extra per-technician signals the base tech-recommendation engine deliberately does not model yet. Supplying these
// lets the envelope add rotation / workload-minutes / appointment / shift-end terms WITHOUT forking the base engine.
export interface AssignmentSignals {
  technicianId: string;
  name: string;
  available: boolean;
  skills: string[];
  activeLoad?: number;            // active assignment count (base engine term)
  isRequested?: boolean;
  isPrevious?: boolean;
  rotationIndex?: number | null;  // position in the branch rotation (lower = more "up next"); null = unknown
  assignedMinutes?: number | null;// total assigned service minutes today (workload balancing); null = unknown
  availableInMinutes?: number | null; // minutes until free (0 = now); null = unknown
  shiftEndsInMinutes?: number | null; // minutes until shift end; null = unknown
  nextAppointmentInMinutes?: number | null; // minutes until this tech's next confirmed appointment; null = none
}



// The structured, versioned recommendation envelope — the spec's required output (never a single unexplained result).

export type DecisionType = 'accepted' | 'rejected' | 'overridden' | 'kept_unassigned';
/** What the decision log holds: staff decisions plus the auto-run's own 'auto_assigned' (audit bug 13 — it was logged
 *  as 'accepted' and inflated the acceptance rate). Staff can never post 'auto_assigned'. */
export type StoredDecisionType = DecisionType | 'auto_assigned';
export const STAFF_DECISIONS: readonly DecisionType[] = ['accepted', 'rejected', 'overridden', 'kept_unassigned'];

export class QueueAssignmentError extends Error { constructor(msg: string) { super(msg); this.name = 'QueueAssignmentError'; } }
export class QueueAssignmentForbiddenError extends QueueAssignmentError { constructor(msg = 'FORBIDDEN') { super(msg); this.name = 'QueueAssignmentForbiddenError'; } }
export class QueueAssignmentValidationError extends QueueAssignmentError { constructor(msg = 'INVALID') { super(msg); this.name = 'QueueAssignmentValidationError'; } }
export class QueueAssignmentDisabledError extends QueueAssignmentError { constructor(msg = 'DISABLED') { super(msg); this.name = 'QueueAssignmentDisabledError'; } }
/** The guest changed since the suggestion was made (another device, the auto-run, a stale version) → 409. */
export class QueueAssignmentStaleError extends QueueAssignmentError {
  readonly code = 'VERSION_CONFLICT' as const;
  /** multi-technician plans: the guest / line that was stale */
  queueItemId?: string; serviceId?: string;
  constructor(public readonly currentTechnicianId: string | null = null, msg = 'This guest was just assigned or changed on another device. Refresh and try again.', where: { queueItemId?: string; serviceId?: string } = {}) {
    super(msg); this.name = 'QueueAssignmentStaleError';
    if (where.queueItemId) this.queueItemId = where.queueItemId;
    if (where.serviceId) this.serviceId = where.serviceId;
  }
}
