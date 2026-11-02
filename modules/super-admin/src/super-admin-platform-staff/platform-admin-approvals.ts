// platform-admin-approvals.ts — Security Deep Scan §134: creating a platform administrator (a platform-role invitation) and
// changing a platform account's role are APPROVABLE actions in the maker/checker mechanism (modules/platform
// PlatformApprovals). Policy default OFF — the action runs at once, exactly as before (a single operator is never locked
// out). With platform_settings 'approvals.platform.admin_invite.required' / 'approvals.platform.role_change.required' set
// to true (Super Admin → Approvals → policies, needs super_admin.platform_roles.manage + step-up), the action becomes a
// REQUEST that ANOTHER platform user holding super_admin.platform_roles.manage must approve within 24 h; the requester can
// never approve their own; every step is audited. On approval it runs attributed to the requester but within the APPROVER's
// permissions (PlatformApprovals' rule) — so the grant ceiling and the no-self / last-Super-Admin rules apply again.
import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { PlatformApprovals } from '@aipowersalon/platform';

export const PLATFORM_ADMIN_INVITE = 'platform.admin_invite';
export const PLATFORM_ROLE_CHANGE = 'platform.role_change';
export const PLATFORM_ADMIN_APPROVAL_PERMISSION = 'super_admin.platform_roles.manage';

/** The ONE PlatformApprovals instance (provided by the platform module), or null in a process without it. */
export function platformApprovalsFrom(moduleRef?: ModuleRef | null): PlatformApprovals | null {
  try { return (moduleRef?.get(PlatformApprovals, { strict: false }) as PlatformApprovals) ?? null; } catch (e) {
    // No PlatformApprovals provider in this process (a test app, a worker): the actions run directly, as with the policy
    // off. Said out loud so a production process missing the platform module is visible in the logs.
    new Logger('PlatformAdminApprovals').warn(`dual approval unavailable (no PlatformApprovals provider): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Register an action once (idempotent by key). */
export function registerOnce(approvals: PlatformApprovals | null, key: string, label: string, execute: (payload: any, actor: { userId: string | null; permissions: readonly string[] }) => Promise<unknown>): void {
  if (!approvals || approvals.registered().some((a) => a.key === key)) return;
  approvals.register({ key, label, requiredPermission: PLATFORM_ADMIN_APPROVAL_PERMISSION, execute });
}

/** The answer a route gives when the action was filed for a second approver instead of run. */
export const pendingAnswer = (approvalId: string, expiresAt: string) => ({ ok: true, pending: true, approvalId, expiresAt,
  message: 'Sent to another platform administrator for approval (dual approval is on for this action).' });
