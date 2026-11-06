// global-rewards-dual-control.ts — Batch C decision 1 (Kevin, Nov 6 2026: "pick best for my POS").
//
// The Loyalty guide asks for a SECOND Super Admin to approve a global earning-rule publish and a program update. With only
// one Super Admin that would block every change, so the rule is:
//   · the two actions are registered with the platform's maker/checker (PlatformApprovals — the same mechanism as plan-limit
//     overrides and platform role changes), policy ON from migration 824 (Super Admin → Approvals can turn it off, audited);
//   · policy on AND another active platform account that can approve (holds super_admin.billing.manage) → the change becomes
//     a REQUEST: another person must approve within 24 h, never the requester; it then runs as the requester;
//   · policy on but NO other eligible approver → it runs now as an audited SELF-APPROVAL (reason required, audit row says
//     no second approver existed) — one Super Admin is never locked out, and adding a second one turns dual control on by
//     itself;
//   · a program change that only PAUSES (earning / redemption / purchases / reimbursements) is an emergency control: it is
//     never held for a second approver. Un-pausing and limit changes are.
import { sql, type Kysely } from 'kysely';
import { platformPermissionsFor, isPlatformRole, PLATFORM_FALLBACK_ROLE } from '@aipowersalon/permissions';
import { recordPlatformAuditStrict } from '@aipowersalon/audit';
import { GlobalRewardsError } from './global-rewards-core';

export const GR_GLOBAL_RULE_ACTION = 'loyalty.global_rule_publish';
export const GR_PROGRAM_ACTION = 'loyalty.program_update';
export const GR_APPROVAL_PERMISSION = 'super_admin.billing.manage';
export const PLATFORM_APPROVALS_TOKEN = 'PLATFORM_APPROVALS';

export interface GrApprovalActor { userId: string | null; permissions: readonly string[] }
/** The platform maker/checker (modules/platform PlatformApprovals), declared narrowly — loyalty does not import platform. */
export interface ApprovalsLike {
  register(a: { key: string; label: string; requiredPermission: string; execute: (payload: any, actor: GrApprovalActor) => Promise<unknown> }): void;
  registered(): { key: string }[];
  required(action: string): Promise<boolean>;
  runOrRequest(key: string, payload: any, reason: string, actor: GrApprovalActor, targetRef?: string | null): Promise<{ executed: true; result: unknown } | { executed: false; approvalId: string; expiresAt: string }>;
}
export type DualControlMode = 'off' | 'second_approver' | 'self_approval';

const PAUSE_KEYS = new Set(['earn_paused', 'redeem_paused', 'purchases_paused', 'reimbursements_paused']);
/** A patch that only turns pauses ON — the emergency stop, never held for approval. */
export function isPauseOnly(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((k) => PAUSE_KEYS.has(k) && patch[k] === true);
}

/** Active platform accounts, other than `actorUserId`, whose platform role can approve (super_admin.billing.manage). */
export async function otherEligibleApprovers(db: Kysely<any>, actorUserId: string | null): Promise<number> {
  const rows = (await sql<{ id: string; platform_role: string | null }>`SELECT u.id::text AS id, u.platform_role FROM users u
    WHERE u.role = 'SUPER_ADMIN' AND u.tenant_id IS NULL AND coalesce(u.status, 'active') = 'active' AND u.id::text <> ${String(actorUserId ?? '')}`.execute(db)).rows;
  return rows.filter((r) => (platformPermissionsFor(isPlatformRole(r.platform_role ?? '') ? r.platform_role : PLATFORM_FALLBACK_ROLE) as string[]).includes(GR_APPROVAL_PERMISSION)).length;
}

export async function dualControlMode(approvals: ApprovalsLike | null, db: Kysely<any>, action: string, actor: GrApprovalActor): Promise<DualControlMode> {
  if (!approvals || !(await approvals.required(action))) return 'off';
  return (await otherEligibleApprovers(db, actor.userId)) > 0 ? 'second_approver' : 'self_approval';
}

export async function auditSelfApproval(db: Kysely<any>, actor: GrApprovalActor, action: string, reason: string, meta: Record<string, unknown>): Promise<void> {
  await recordPlatformAuditStrict(db, { userId: actor.userId, role: 'super_admin' }, { module: 'platform', action: 'approval_self_approved', resourceType: 'platform_approval', resourceId: action,
    metadata: { action, reason, why: 'no other active platform account can approve this change', ...meta } });
}

export function needReason(reason: unknown): string {
  const r = String(reason ?? '').trim();
  if (r.length < 10) throw new GlobalRewardsError('This change needs approval: give a reason of at least 10 characters.', 'VALIDATION_FAILED', 400, { field: 'reason' });
  return r;
}

export const pendingApproval = (approvalId: string, expiresAt: string) => ({ ok: true, pending: true, approvalId, expiresAt,
  message: 'Sent to another Super Admin for approval (dual control is on for this change).' });
