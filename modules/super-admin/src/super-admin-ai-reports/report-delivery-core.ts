// Pure logic for report delivery. No DB/Nest deps. Governs the delivery status machine, validates recipient ELIGIBILITY
// (the cross-tenant isolation guarantee), decides the aggregate run delivery status by a documented rule, and computes
// the delivery success rate. Every recipient is checked here before any delivery row is created.

export const DELIVERY_STATUSES = ['pending', 'queued', 'in_progress', 'delivered', 'failed', 'bounced', 'suppressed', 'excluded', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const TRANSITIONS: Record<string, DeliveryStatus[]> = {
  pending: ['queued', 'in_progress', 'delivered', 'failed', 'suppressed', 'excluded', 'cancelled'],
  queued: ['in_progress', 'delivered', 'failed', 'cancelled'],
  in_progress: ['delivered', 'failed', 'bounced', 'cancelled'],
  failed: ['queued', 'in_progress', 'delivered', 'cancelled'],   // retryable
  bounced: ['queued', 'in_progress', 'delivered', 'cancelled'],  // retryable
  delivered: [], suppressed: [], excluded: [], cancelled: [],
};
export function canDeliveryTransition(from: string, to: string): boolean {
  return (TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase() as DeliveryStatus);
}
export function isRetryable(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'failed' || s === 'bounced';
}

export interface RunScope { scopeType: string; tenantId: string | null }
export interface Recipient { id: string; type?: string; tenantId?: string | null; isPlatform?: boolean; active?: boolean; suppressed?: boolean; external?: boolean }
export type EligibilityResult = { ok: true } | { ok: false; reason: string };

// The core isolation + permission gate. A tenant-scoped run may reach only that tenant's recipients (or platform-level
// recipients); a cross-tenant/platform run may reach only platform-authorized recipients. External recipients require
// an explicit allowExternal flag. A recipient bound to another tenant is NEVER eligible for this run.
export function validateRecipientEligibility(recipient: Recipient, run: RunScope, opts: { allowExternal?: boolean } = {}): EligibilityResult {
  if (recipient.active === false) return { ok: false, reason: 'recipient inactive' };
  if (recipient.suppressed) return { ok: false, reason: 'recipient suppressed' };
  if (recipient.external && !opts.allowExternal) return { ok: false, reason: 'external sharing not permitted' };
  const runTenant = run.tenantId ?? null;
  if (runTenant) {
    // tenant/branch-scoped run: only that tenant's recipients, or explicitly platform-level recipients
    if (recipient.isPlatform) return { ok: true };
    if ((recipient.tenantId ?? null) !== runTenant) return { ok: false, reason: 'recipient belongs to a different tenant' };
    return { ok: true };
  }
  // platform / all-tenants run: only platform-authorized recipients (a single-tenant recipient must not receive it)
  if (!recipient.isPlatform) return { ok: false, reason: 'cross-tenant report requires a platform-authorized recipient' };
  return { ok: true };
}

// Aggregate run delivery status from recipient-level counts (documented rule).
export function aggregateDeliveryStatus(counts: { delivered: number; failed: number; bounced: number; pending: number; total: number }): DeliveryStatus | 'partially_delivered' | 'not_requested' {
  const attemptedFail = (counts.failed || 0) + (counts.bounced || 0);
  if ((counts.total || 0) === 0) return 'not_requested';
  if (counts.delivered === counts.total) return 'delivered';
  if (counts.delivered > 0 && (attemptedFail > 0 || counts.pending > 0)) return 'partially_delivered';
  if (counts.delivered === 0 && attemptedFail > 0 && counts.pending === 0) return 'failed';
  return 'pending';
}

export function deliverySuccessRate(delivered: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.round((delivered / total) * 1000) / 10;
}
export function buildDeliveryKey(runId: string, recipientId: string): string {
  return `${String(runId || '').trim()}|${String(recipientId || '').trim()}`;
}
