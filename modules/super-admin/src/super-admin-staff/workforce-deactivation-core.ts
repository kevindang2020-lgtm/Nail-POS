// Pure validation for terminated-user access deactivation (§33). When a worker is already inactive/suspended
// (a tenant decision), the platform may, as a controlled security cleanup, revoke any lingering access — active
// sessions and device/app registrations. This NEVER changes the worker's status (active ↔ suspended ↔ inactive is a
// tenant-management responsibility); it only removes access that should no longer exist for a non-active account.

export const DEACTIVATABLE_STATUSES = ['inactive', 'suspended'] as const;
export type DeactivatableStatus = (typeof DEACTIVATABLE_STATUSES)[number];

export function canDeactivate(status: unknown): status is DeactivatableStatus {
  return typeof status === 'string' && (DEACTIVATABLE_STATUSES as readonly string[]).includes(status);
}

export const MIN_DEACT_REASON_LEN = 8;
export const DEACTIVATION_AUDIT_TYPE = 'workforce_access_deactivated';

export interface DeactivationInput { reason?: unknown }
export type DeactivationValidation = { ok: true; reason: string } | { ok: false; error: string; code: 'invalid' };

// Guard order matters: an active worker can never be deactivated here (that would lock out a working employee — a
// tenant action), and the reason is mandatory for the audit trail.
export function validateDeactivation(status: unknown, input: DeactivationInput): DeactivationValidation {
  if (!canDeactivate(status)) return { ok: false, code: 'invalid', error: 'worker is active or not in a deactivatable state; status changes are a tenant responsibility' };
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_DEACT_REASON_LEN) return { ok: false, code: 'invalid', error: `reason is required (at least ${MIN_DEACT_REASON_LEN} characters)` };
  return { ok: true, reason };
}

export function summarizeDeactivation(r: { sessionsRevoked: number; devicesRevoked: number }): string {
  return `Revoked ${r.sessionsRevoked} session(s) and ${r.devicesRevoked} device registration(s).`;
}
