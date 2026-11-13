/**
 * Technician eligibility (spec §17 phase 1, §18, §20, §23).
 *
 * Eligibility is evaluated BEFORE any ranking or Fair Turn consideration.
 * An ineligible technician is never offered, never ranked, and never has a
 * Fair Turn turn consumed (spec §24).
 */
import { buildDayContext, slotFits, type BuildDayContextInput, type FitFailure } from './availability';
import type { BookingErrorCode } from './bookingErrors';
import type { BookingPolicy, ID, Service, Technician } from './scheduleTypes';

export type EligibilityFailure =
  | 'TENANT_MISMATCH'
  | 'BRANCH_MISMATCH'
  | 'INACTIVE'
  | 'NOT_WORKING'
  | 'SERVICE_INELIGIBLE'
  | 'SERVICE_INACTIVE'
  | 'SERVICE_NOT_AT_BRANCH'
  | 'OVERLAP'
  | 'LUNCH'
  | 'BREAK'
  | 'BLOCKED'
  | 'TIME_OFF'
  | 'PROTECTED'
  | 'OFF_GRID'
  | 'INVALID_DURATION'
  | 'POLICY_LEAD_TIME'
  | 'POLICY_MAX_DURATION'
  | 'REQUESTED_OTHER_TECHNICIAN';

export interface EligibilityResult {
  eligible: boolean;
  failures: EligibilityFailure[];
  conflictId?: ID;
}

export interface EvaluateEligibilityInput extends Omit<BuildDayContextInput, 'technician'> {
  technician: Technician;
  tenantId: ID;
  branchId: ID;
  /** Services to perform (ids must all be in technician.serviceIds). */
  services: Service[];
  /** Total required minutes incl. time-changing add-ons. */
  durationMinutes: number;
  /** Proposed start, minutes since local midnight. Omit for "service-only" eligibility. */
  startMinute?: number;
  /** "Now" in minutes since local midnight, for lead-time policy. Omit to skip. */
  nowMinute?: number;
  policy?: BookingPolicy;
  /** If the customer requested a specific technician, only that one is eligible. */
  requestedTechnicianId?: ID | null;
}

const fitToEligibility: Record<FitFailure, EligibilityFailure> = {
  OFF_GRID: 'OFF_GRID',
  NOT_WORKING: 'NOT_WORKING',
  OVERLAP: 'OVERLAP',
  LUNCH: 'LUNCH',
  BREAK: 'BREAK',
  BLOCKED: 'BLOCKED',
  TIME_OFF: 'TIME_OFF',
  PROTECTED: 'PROTECTED',
};

/** Static (time-independent) checks: tenant, branch, active, service qualification. */
export function evaluateStaticEligibility(
  input: Pick<EvaluateEligibilityInput, 'technician' | 'tenantId' | 'branchId' | 'services' | 'requestedTechnicianId'>,
): EligibilityFailure[] {
  const { technician: t, tenantId, branchId, services } = input;
  const f: EligibilityFailure[] = [];
  if (t.tenantId !== tenantId) f.push('TENANT_MISMATCH');
  if (t.branchId !== branchId) f.push('BRANCH_MISMATCH');
  if (!t.active) f.push('INACTIVE');
  if (t.workingState === 'time_off') f.push('TIME_OFF');
  if (input.requestedTechnicianId && input.requestedTechnicianId !== t.id) f.push('REQUESTED_OTHER_TECHNICIAN');
  const qualified = new Set(t.serviceIds ?? []);
  for (const s of services) {
    if (!s.active) f.push('SERVICE_INACTIVE');
    if (s.branchIds && s.branchIds.length > 0 && !s.branchIds.includes(branchId)) f.push('SERVICE_NOT_AT_BRANCH');
    if (!qualified.has(s.id)) f.push('SERVICE_INELIGIBLE');
  }
  return [...new Set(f)];
}

export function evaluateEligibility(input: EvaluateEligibilityInput): EligibilityResult {
  const failures = evaluateStaticEligibility(input);
  const grid = input.policy?.gridMinutes ?? 15;
  if (input.durationMinutes <= 0 || input.durationMinutes % grid !== 0) failures.push('INVALID_DURATION');
  if (input.policy?.maxDurationMinutes && input.durationMinutes > input.policy.maxDurationMinutes) failures.push('POLICY_MAX_DURATION');

  let conflictId: ID | undefined;
  if (input.startMinute !== undefined) {
    if (input.nowMinute !== undefined && input.policy?.minLeadMinutes) {
      if (input.startMinute < input.nowMinute + input.policy.minLeadMinutes) failures.push('POLICY_LEAD_TIME');
    }
    const ctx = buildDayContext(input);
    const fit = slotFits(ctx, input.startMinute, input.durationMinutes, grid);
    if (!fit.fits && fit.failure) {
      failures.push(fitToEligibility[fit.failure]);
      conflictId = fit.conflictId;
    }
  } else {
    // Service-only eligibility still requires the technician to be on shift that day.
    const ctx = buildDayContext(input);
    if (ctx.working.length === 0) failures.push('NOT_WORKING');
  }
  const unique = [...new Set(failures)];
  return { eligible: unique.length === 0, failures: unique, conflictId };
}

/** Map the most important failure to a domain error code (spec §35). */
export function failureToErrorCode(failures: EligibilityFailure[]): BookingErrorCode {
  const order: [EligibilityFailure, BookingErrorCode][] = [
    ['TENANT_MISMATCH', 'PERMISSION_DENIED'],
    ['BRANCH_MISMATCH', 'PERMISSION_DENIED'],
    ['SERVICE_INELIGIBLE', 'TECHNICIAN_SERVICE_INELIGIBLE'],
    ['SERVICE_INACTIVE', 'TECHNICIAN_SERVICE_INELIGIBLE'],
    ['SERVICE_NOT_AT_BRANCH', 'TECHNICIAN_SERVICE_INELIGIBLE'],
    ['REQUESTED_OTHER_TECHNICIAN', 'TECHNICIAN_UNAVAILABLE'],
    ['OVERLAP', 'APPOINTMENT_CONFLICT'],
    ['PROTECTED', 'APPOINTMENT_PROTECTION'],
    ['BLOCKED', 'BLOCKED_TIME_CONFLICT'],
    ['INVALID_DURATION', 'INVALID_DURATION'],
    ['OFF_GRID', 'INVALID_DURATION'],
    ['POLICY_MAX_DURATION', 'INVALID_DURATION'],
    ['INACTIVE', 'TECHNICIAN_UNAVAILABLE'],
    ['TIME_OFF', 'TECHNICIAN_UNAVAILABLE'],
    ['NOT_WORKING', 'TECHNICIAN_UNAVAILABLE'],
    ['LUNCH', 'TECHNICIAN_UNAVAILABLE'],
    ['BREAK', 'TECHNICIAN_UNAVAILABLE'],
    ['POLICY_LEAD_TIME', 'TECHNICIAN_UNAVAILABLE'],
  ];
  for (const [f, code] of order) if (failures.includes(f)) return code;
  return 'UNKNOWN';
}

export const ELIGIBILITY_LABELS: Record<EligibilityFailure, string> = {
  TENANT_MISMATCH: 'Different salon',
  BRANCH_MISMATCH: 'Different branch',
  INACTIVE: 'Inactive',
  NOT_WORKING: 'Not working',
  SERVICE_INELIGIBLE: 'Not qualified for service',
  SERVICE_INACTIVE: 'Service inactive',
  SERVICE_NOT_AT_BRANCH: 'Service not offered here',
  OVERLAP: 'Already booked',
  LUNCH: 'Lunch',
  BREAK: 'Break',
  BLOCKED: 'Blocked time',
  TIME_OFF: 'Time off',
  PROTECTED: 'Runs into protected appointment',
  OFF_GRID: 'Not on 15-minute grid',
  INVALID_DURATION: 'Invalid duration',
  POLICY_LEAD_TIME: 'Too soon',
  POLICY_MAX_DURATION: 'Exceeds maximum duration',
  REQUESTED_OTHER_TECHNICIAN: 'Customer requested another technician',
};
