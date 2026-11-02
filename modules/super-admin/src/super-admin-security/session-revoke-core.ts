// Pure logic for session revocation. No DB/Nest deps. Validates the revoke scope, enforces that broad scopes carry a
// reason, guarantees the acting admin can protect their own/emergency session, and summarizes impact. The revoke itself
// (sessions + their refresh tokens, idempotent) is executed in the repo transaction; this layer makes it safe & auditable.

export const REVOKE_SCOPES = ['session', 'user', 'tenant', 'role'] as const;
export type RevokeScope = (typeof REVOKE_SCOPES)[number];

export type ScopeResult = { ok: true } | { ok: false; reason: string };
export function validateRevokeScope(scope: string, target: string | null | undefined, reason: string | null | undefined): ScopeResult {
  const s = String(scope || '').toLowerCase();
  if (!REVOKE_SCOPES.includes(s as RevokeScope)) return { ok: false, reason: `unsupported scope "${scope}"` };
  if (!String(target || '').trim()) return { ok: false, reason: `scope "${s}" requires a target id` };
  // Broad scopes (everything except a single session) must carry a reason for the audit trail.
  if (s !== 'session' && !String(reason || '').trim()) return { ok: false, reason: `scope "${s}" requires a reason` };
  return { ok: true };
}

// Which session id (if any) must be preserved so the acting administrator is never locked out by their own action.
export function protectedSessionId(currentSessionId: string | null | undefined): string | null {
  const s = String(currentSessionId || '').trim();
  return s || null;
}

export interface RevokeImpact { sessionsToRevoke: number; alreadyRevoked: number; refreshTokensToRevoke: number; protectedSession: boolean }
export function summarizeRevoke(impact: RevokeImpact): { total: number; message: string } {
  const total = impact.sessionsToRevoke;
  const parts = [`${total} active session${total === 1 ? '' : 's'}`, `${impact.refreshTokensToRevoke} refresh token${impact.refreshTokensToRevoke === 1 ? '' : 's'}`];
  if (impact.protectedSession) parts.push('your current session is preserved');
  if (impact.alreadyRevoked > 0) parts.push(`${impact.alreadyRevoked} already revoked (skipped)`);
  return { total, message: `Will revoke ${parts.join(', ')}.` };
}
