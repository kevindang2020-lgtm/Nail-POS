/**
 * branch-lifecycle-core.ts — pure, DB-free status lifecycle for branches (§30–§32).
 *
 * Defines the allowed transition graph, validates a requested status change (allowed transition + required reason +
 * typed branch-name confirmation for high-risk actions), and produces the documented impact summary the confirmation
 * screen shows. The service re-applies the transition guard against the live row (status = expected-from) so a stale
 * UI cannot force an illegal jump. Unit-tested without a database.
 */

export type BranchStatus =
  | 'draft' | 'opening' | 'under_review' | 'setup_in_progress' | 'ready_to_launch'
  | 'active' | 'paused' | 'suspended' | 'maintenance' | 'closing' | 'closed';

/**
 * Allowed transitions for Super-Admin oversight actions. Onboarding-stage advancement is handled by the onboarding
 * workflow, not here; this graph covers the operate/pause/suspend/maintain/close lifecycle a Super Admin drives.
 */
export const ALLOWED_TRANSITIONS: Record<string, BranchStatus[]> = {
  active: ['paused', 'suspended', 'maintenance', 'closing'],
  paused: ['active', 'suspended', 'closing'],
  suspended: ['active', 'closing'],
  maintenance: ['active', 'suspended'],
  closing: ['closed', 'active'],
  ready_to_launch: ['active'],
};

/** High-risk targets require typed branch-name confirmation (§31). */
export const HIGH_RISK_TARGETS = new Set<BranchStatus>(['suspended', 'closing', 'closed']);

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase() as BranchStatus);
}

/** Human-readable effect lines for the confirmation screen (§32). Documented, not exhaustive of every integration. */
export function impactSummary(to: string): string[] {
  switch (String(to || '').toLowerCase()) {
    case 'paused':
      return ['Branch staff login is blocked', 'Online booking is paused', 'Existing appointments are retained', 'Payment processing is paused', 'Customer data and reports are preserved'];
    case 'suspended':
      return ['Branch staff login is blocked', 'POS devices are deactivated', 'Online booking and AI receptionist are disabled', 'Payment processing and settlement are halted', 'Customer data, history and reports are preserved (not deleted)'];
    case 'closing':
      return ['Branch is winding down — new bookings are stopped', 'Existing appointments should be completed or reassigned', 'Devices and integrations remain until closed', 'Financial history is preserved with original ownership'];
    case 'closed':
      return ['Branch is closed to all operations', 'Devices are released; integrations disconnected', 'Customer and financial history are retained for legal/reporting', 'Reopening requires a new activation'];
    case 'maintenance':
      return ['Branch is temporarily offline for maintenance', 'Booking is paused; staff login may be restricted', 'Data, devices and settlement are preserved'];
    case 'active':
      return ['Branch returns to normal operation', 'Staff login, booking and payments are re-enabled', 'No data is changed by reactivation'];
    default:
      return ['Status change applied.'];
  }
}

export interface StatusChangeInput {
  from?: unknown; to?: unknown; reason?: unknown; confirmName?: unknown; branchName?: unknown;
}
export type StatusChangeValidation = { ok: true; value: { to: BranchStatus; reason: string } } | { ok: false; errors: string[] };

export function validateStatusChange(input: StatusChangeInput | undefined): StatusChangeValidation {
  const i = input || {};
  const from = String(i.from ?? '').toLowerCase();
  const to = String(i.to ?? '').toLowerCase();
  const reason = String(i.reason ?? '').trim();
  const errors: string[] = [];

  if (!to) errors.push('A target status is required.');

  if (to && !canTransition(from, to)) {
    const allowed = ALLOWED_TRANSITIONS[from] || [];
    errors.push(allowed.length ? `Cannot change a ${from || 'unknown'} branch to ${to}. Allowed: ${allowed.join(', ')}.` : `A ${from || 'unknown'} branch cannot be changed from this page.`);
  }
  if (reason.length < 3) errors.push('A reason is required (at least 3 characters).');

  if (to && HIGH_RISK_TARGETS.has(to as BranchStatus)) {
    const confirmName = String(i.confirmName ?? '').trim();
    const branchName = String(i.branchName ?? '').trim();
    if (!branchName || confirmName.toLowerCase() !== branchName.toLowerCase()) {
      errors.push('Type the exact branch name to confirm this high-risk action.');
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { to: to as BranchStatus, reason } };
}
