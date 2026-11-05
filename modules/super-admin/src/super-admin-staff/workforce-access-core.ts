// Pure, deterministic validation + mapping for Super-Admin account-access support (§32).
// No DB, no NestJS — unit-testable in isolation. The platform may, as a controlled support action, force a logout
// (revoke sessions), require a password change, or reset MFA enrollment for a worker who is locked out. Status changes
// (suspend / reactivate) are intentionally NOT here — those remain tenant-management responsibilities.

export const ACCESS_ACTIONS = ['revoke_sessions', 'force_password_reset', 'reset_mfa'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export function isAccessAction(x: unknown): x is AccessAction {
  return typeof x === 'string' && (ACCESS_ACTIONS as readonly string[]).includes(x);
}

export const MIN_REASON_LEN = 8;

export interface AccessSupportInput { action?: unknown; reason?: unknown }
export type AccessValidation = { ok: true; action: AccessAction; reason: string } | { ok: false; error: string };

// A reason is mandatory and must be meaningful — every access intervention is audited and a terse/blank reason makes
// the audit trail useless. Confirmation (typed) is enforced at the UI layer; the server still requires action+reason.
export function validateAccessSupport(input: AccessSupportInput): AccessValidation {
  if (!isAccessAction(input?.action)) return { ok: false, error: `action must be one of: ${ACCESS_ACTIONS.join(', ')}` };
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_REASON_LEN) return { ok: false, error: `reason is required (at least ${MIN_REASON_LEN} characters)` };
  return { ok: true, action: input.action, reason };
}

export function accessAuditType(action: AccessAction): string {
  switch (action) {
    case 'revoke_sessions': return 'workforce_session_revoke';
    case 'force_password_reset': return 'workforce_password_reset';
    case 'reset_mfa': return 'workforce_mfa_reset';
  }
}

export function accessActionLabel(action: AccessAction): string {
  switch (action) {
    case 'revoke_sessions': return 'Revoke active sessions (force logout)';
    case 'force_password_reset': return 'Require password change on next login';
    case 'reset_mfa': return 'Reset MFA enrollment';
  }
}
