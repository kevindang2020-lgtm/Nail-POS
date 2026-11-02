// Pure logic for the emergency-lockdown workflow. No DB/Nest deps. This is the safety core: a lockdown is NEVER one-step.
// It must be proposed (scope+reason), then confirmed with BOTH a step-up re-auth AND a typed confirmation phrase, then
// executed, and it is always reversible (lift). The initiating admin is never in scope (self-preservation). Controlled
// scopes + validated status machine. The actual session revocation on execute is delegated to the revoke engine.

export const LOCKDOWN_SCOPES = ['account', 'tenant', 'platform'] as const;
export type LockdownScope = (typeof LOCKDOWN_SCOPES)[number];

export type ProposalResult = { ok: true } | { ok: false; reason: string };
export function validateProposal(scope: string, target: string | null | undefined, reason: string | null | undefined): ProposalResult {
  const s = String(scope || '').toLowerCase();
  if (!LOCKDOWN_SCOPES.includes(s as LockdownScope)) return { ok: false, reason: `unsupported scope "${scope}"` };
  if ((s === 'account' || s === 'tenant') && !String(target || '').trim()) return { ok: false, reason: `${s} lockdown requires a target id` };
  if (!String(reason || '').trim()) return { ok: false, reason: 'a reason is required' };
  return { ok: true };
}

// The typed confirmation phrase the initiator must reproduce EXACTLY (case-sensitive) — forces deliberateness.
export function expectedConfirmationPhrase(scope: string): string { return `LOCKDOWN ${String(scope || '').toUpperCase()}`; }

// Confirmation requires BOTH factors: the exact typed phrase AND a verified step-up re-authentication.
export function verifyConfirmation(scope: string, typedPhrase: string, stepUpVerified: boolean): { ok: true } | { ok: false; reason: string } {
  if (!stepUpVerified) return { ok: false, reason: 'step-up re-authentication required' };
  if (String(typedPhrase || '') !== expectedConfirmationPhrase(scope)) return { ok: false, reason: 'confirmation phrase does not match' };
  return { ok: true };
}

export const TRANSITIONS: Record<string, string[]> = { proposed: ['confirmed', 'cancelled'], confirmed: ['active', 'cancelled'], active: ['lifted'], lifted: [], cancelled: [] };
export function canLockdownTransition(from: string, to: string): boolean { return (TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase()); }

// Map a lockdown scope to a session-revoke scope for execution. Platform has no single revoke target — enforcement of a
// platform lockdown is via the auth gate (documented), not a single revoke call.
export function mapToRevokeScope(scope: string): { revokeScope: 'user' | 'tenant' | null } {
  const s = String(scope || '').toLowerCase();
  if (s === 'account') return { revokeScope: 'user' };
  if (s === 'tenant') return { revokeScope: 'tenant' };
  return { revokeScope: null };
}

// Self-preservation invariant: the initiator is never included in the lockdown target.
export function violatesSelfPreservation(scope: string, target: string | null, initiatorUserId: string | null): boolean {
  const s = String(scope || '').toLowerCase();
  return s === 'account' && !!target && !!initiatorUserId && String(target) === String(initiatorUserId);
}

export function buildLockdownRef(nowMs: number, seq: number): string { return `LKD-${new Date(nowMs).getUTCFullYear()}-${String(seq).padStart(3, '0')}`; }
