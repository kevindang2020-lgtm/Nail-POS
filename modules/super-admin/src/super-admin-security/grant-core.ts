// Pure logic for privileged-access grants. No DB/Nest deps. Elevations are ALWAYS time-boxed (a bounded expiry is
// mandatory), reviewable (approve/revoke with separation of duties — no self-approval), and expiring (a sweep marks
// past-window grants expired). Controlled privilege/scope vocab + validated status machine. "Currently elevated" is only
// true for an active grant inside its window — an expired grant confers nothing.

export const PRIVILEGE_KINDS = ['super_admin', 'owner', 'manager_override', 'billing_admin', 'security_admin', 'support_elevated'] as const;
export const GRANT_SCOPES = ['platform', 'tenant'] as const;
const DEFAULT_MAX_WINDOW_DAYS = 90;

export function normalizePrivilege(p: string): string { const v = String(p || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); return (PRIVILEGE_KINDS as readonly string[]).includes(v) ? v : ''; }

export type RequestResult = { ok: true } | { ok: false; reason: string };
export function validateGrantRequest(input: { userId: string; privilege: string; scope: string; target?: string | null; reason?: string | null; expiresAt?: string | null }, nowMs: number, maxWindowDays = DEFAULT_MAX_WINDOW_DAYS): RequestResult {
  if (!String(input.userId || '').trim()) return { ok: false, reason: 'userId is required' };
  if (!normalizePrivilege(input.privilege)) return { ok: false, reason: `unsupported privilege "${input.privilege}"` };
  const scope = String(input.scope || '').toLowerCase();
  if (!(GRANT_SCOPES as readonly string[]).includes(scope)) return { ok: false, reason: `unsupported scope "${input.scope}"` };
  if (scope === 'tenant' && !String(input.target || '').trim()) return { ok: false, reason: 'tenant scope requires a target tenant id' };
  if (!String(input.reason || '').trim()) return { ok: false, reason: 'a reason/justification is required' };
  const exp = Date.parse(String(input.expiresAt || ''));
  if (Number.isNaN(exp)) return { ok: false, reason: 'a valid expiry is required (grants are always time-boxed)' };
  if (exp <= nowMs) return { ok: false, reason: 'expiry must be in the future' };
  if (exp - nowMs > maxWindowDays * 86400000) return { ok: false, reason: `expiry exceeds the maximum window of ${maxWindowDays} days` };
  return { ok: true };
}

export function isExpired(expiresAt: string | null, nowMs: number): boolean { if (!expiresAt) return true; const t = Date.parse(expiresAt); return Number.isNaN(t) || t <= nowMs; }
export function isCurrentlyElevated(status: string, expiresAt: string | null, nowMs: number): boolean { return String(status || '').toLowerCase() === 'active' && !isExpired(expiresAt, nowMs); }
export function reviewDue(expiresAt: string | null, nowMs: number, warnDays = 3): boolean { if (!expiresAt) return false; const t = Date.parse(expiresAt); if (Number.isNaN(t)) return false; return t > nowMs && t - nowMs <= warnDays * 86400000; }

export const TRANSITIONS: Record<string, string[]> = { pending: ['active', 'denied'], active: ['revoked', 'expired', 'completed'], denied: [], revoked: [], expired: [], completed: [] };
export function canGrantTransition(from: string, to: string): boolean { return (TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase()); }

// Separation of duties: the approver may not be the requester.
export function enforceSeparation(requesterId: string | null, approverId: string | null): { ok: true } | { ok: false; reason: string } {
  if (requesterId && approverId && String(requesterId) === String(approverId)) return { ok: false, reason: 'the approver cannot be the requester (separation of duties)' };
  return { ok: true };
}

export function buildGrantRef(nowMs: number, seq: number): string { return `PAG-${new Date(nowMs).getUTCFullYear()}-${String(seq).padStart(3, '0')}`; }
