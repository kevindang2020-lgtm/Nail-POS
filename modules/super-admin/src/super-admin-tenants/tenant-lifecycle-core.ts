import { utcDate } from '@aipowersalon/date-time';
// tenant-lifecycle-core.ts — Constitution 7 §16–§21: the explicit tenant lifecycle and its legal moves (decision D6).
// The database keeps tenants.status consistent with lifecycle_state (migration 463); this decides which MOVES are legal
// and what each must carry.
// Constitution 7 §18 — the reason codes live with the suspension POLICY in @aipowersalon/permissions (one source)
import { SUSPENSION_REASON_CODES } from '@aipowersalon/permissions';
export { SUSPENSION_REASON_CODES } from '@aipowersalon/permissions';
export type { SuspensionReasonCode } from '@aipowersalon/permissions';
export const MIN_STATUS_REASON = 10;

export const LIFECYCLE_STATES = ['DRAFT', 'ONBOARDING', 'PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE', 'RESTRICTED', 'SUSPENDED', 'CLOSED', 'ARCHIVED'] as const;
export type LifecycleState = typeof LIFECYCLE_STATES[number];
export const isLifecycleState = (s: unknown): s is LifecycleState => typeof s === 'string' && (LIFECYCLE_STATES as readonly string[]).includes(s);

/** §16 legal moves. CLOSED is not terminal: it leads to ARCHIVED (§21: closed → retention → archive); ARCHIVED is. */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  DRAFT: ['ONBOARDING', 'CLOSED'],
  ONBOARDING: ['PENDING_APPROVAL', 'CLOSED'],
  PENDING_APPROVAL: ['ACTIVE', 'ONBOARDING', 'CLOSED'],
  ACTIVE: ['PAST_DUE', 'RESTRICTED', 'SUSPENDED', 'CLOSED'],
  PAST_DUE: ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED'],
  RESTRICTED: ['ACTIVE', 'SUSPENDED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'CLOSED'],
  CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
};

export type LifecycleDecision = { ok: true; from: LifecycleState; to: LifecycleState } | { ok: false; error: string };

/**
 * A move is legal when the transition table allows it AND the request carries what the move needs:
 *  • to SUSPENDED or RESTRICTED (§18): a suspension reason code and a written reason;
 *  • back to ACTIVE from RESTRICTED or SUSPENDED (§20), to CLOSED or ARCHIVED (§21): a written reason.
 */
export function decideLifecycleMove(from: string, to: string, reason?: string, reasonCode?: string): LifecycleDecision {
  if (!isLifecycleState(from)) return { ok: false, error: 'The tenant has no readable lifecycle state.' };
  if (!isLifecycleState(to)) return { ok: false, error: `Unknown lifecycle state. Use one of: ${LIFECYCLE_STATES.join(', ')}.` };
  if (from === to) return { ok: false, error: `Tenant is already ${to}.` };
  if (!LIFECYCLE_TRANSITIONS[from].includes(to)) return { ok: false, error: `A tenant cannot move from ${from} to ${to}.` };
  const hasReason = (reason ?? '').trim().length >= MIN_STATUS_REASON;
  if (to === 'SUSPENDED' || to === 'RESTRICTED') {
    if (!reasonCode || !(SUSPENSION_REASON_CODES as readonly string[]).includes(reasonCode)) return { ok: false, error: `Choose a reason code (${SUSPENSION_REASON_CODES.join(', ')}).` };
    if (!hasReason) return { ok: false, error: `Describe the reason (at least ${MIN_STATUS_REASON} characters).` };
  }
  const needsReason = (to === 'ACTIVE' && (from === 'RESTRICTED' || from === 'SUSPENDED')) || to === 'CLOSED' || to === 'ARCHIVED';
  if (needsReason && !hasReason) return { ok: false, error: `A reason of at least ${MIN_STATUS_REASON} characters is required for this change.` };
  return { ok: true, from, to };
}

/**
 * §20 — reactivation "policy validation". A tenant suspended for SECURITY or FRAUD comes back only with the security
 * permission (held by PLATFORM_SUPER_ADMIN), because the account itself was the problem. Integrations disabled as
 * compromised are NOT restored by reactivation — they stay disabled until someone re-enables each after review (the
 * caller reports how many). Returns the refusal message, or null.
 */
export const SECURITY_SUSPENSION_CODES = ['SECURITY', 'FRAUD'] as const;
export function reactivationRequirement(suspensionReasonCode: string | null | undefined, actorPermissions: readonly string[] | undefined): string | null {
  if ((SECURITY_SUSPENSION_CODES as readonly string[]).includes(String(suspensionReasonCode))) {
    if (!actorPermissions?.includes('super_admin.security.manage')) return `This salon was suspended for ${suspensionReasonCode}. Reactivating it needs the security permission (super_admin.security.manage).`;
  }
  return null;
}

/**
 * §21 — "CLOSED → retention → archive": a closed tenant is archived only after the retention period, and never while a
 * legal hold covers it. Financial and audit history stay in place for that period (nothing is deleted by archiving).
 */
export const CLOSURE_RETENTION_DAYS = 90;
export function archiveRequirement(closedAt: Date | null, activeLegalHolds: number, now: Date): string | null {
  if (activeLegalHolds > 0) return `A legal hold covers this salon (${activeLegalHolds}). It cannot be archived until the hold is released.`;
  if (!closedAt) return 'The closure date is unknown, so the retention period cannot be checked.';
  const until = new Date(closedAt.getTime() + CLOSURE_RETENTION_DAYS * 86_400_000);
  if (now.getTime() < until.getTime()) return `Closed salons are kept for ${CLOSURE_RETENTION_DAYS} days. This one can be archived from ${utcDate(until)}.`;
  return null;
}
