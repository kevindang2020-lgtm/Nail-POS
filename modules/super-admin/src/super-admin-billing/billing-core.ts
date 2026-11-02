// billing-core.ts — pure, deterministic billing roll-up. Enriches each fact with MRR from the configured plan-price map
// (active subscriptions only) and computes platform totals. No I/O, no fabrication — unit-tested by billing-core.spec.ts.
import type { BillingFact, TenantBillingRow, BillingOverview, BillingResult, SubscriptionStatus, PaymentConfigStatus } from './billing.dto';
import { SETTABLE_SUBSCRIPTION_STATUSES } from './billing.dto';

const SUB_STATUSES: SubscriptionStatus[] = ['active', 'trialing', 'past_due', 'expired', 'cancelled', 'none'];
const PAY_STATUSES: PaymentConfigStatus[] = ['pending', 'active', 'error', 'disabled', 'none'];

export function buildBilling(facts: BillingFact[], planPrices: Record<string, number> = {}): BillingResult {
  const rows: TenantBillingRow[] = facts.map((f) => ({
    ...f,
    mrrCents: f.subscriptionStatus === 'active' ? (planPrices[f.plan] ?? 0) : 0,
  }));

  const bySubscriptionStatus = Object.fromEntries(SUB_STATUSES.map((s) => [s, 0])) as Record<SubscriptionStatus, number>;
  const byPaymentStatus = Object.fromEntries(PAY_STATUSES.map((s) => [s, 0])) as Record<PaymentConfigStatus, number>;
  const byPlan = new Map<string, number>();
  let mrrCents = 0;
  let hardwareOutstandingCents = 0;

  for (const r of rows) {
    bySubscriptionStatus[r.subscriptionStatus] = (bySubscriptionStatus[r.subscriptionStatus] ?? 0) + 1;
    byPaymentStatus[r.paymentStatus] = (byPaymentStatus[r.paymentStatus] ?? 0) + 1;
    if (r.subscriptionStatus !== 'cancelled' && r.subscriptionStatus !== 'expired') byPlan.set(r.plan, (byPlan.get(r.plan) ?? 0) + 1);
    mrrCents += r.mrrCents;
    if (r.hardwareStatus === 'active') hardwareOutstandingCents += Math.max(0, r.hardwareRemainingCents);
  }

  const planDistribution = [...byPlan.entries()]
    .map(([plan, count]) => ({ plan, count }))
    .sort((a, b) => (b.count - a.count) || a.plan.localeCompare(b.plan));

  const overview: BillingOverview = {
    totalTenants: rows.length,
    mrrCents,
    bySubscriptionStatus,
    byPaymentStatus,
    hardwareOutstandingCents,
    planDistribution,
    planCatalog: Object.keys(planPrices).sort(),
  };
  return { rows, overview };
}

// Pure validation for a subscription update. Throws Error('...') on invalid input so the controller can map to 400.
// Returns the normalized patch (trimmed plan, validated status). At least one of plan/status must be present.
export function normalizeSubscriptionUpdate(input: { plan?: unknown; status?: unknown }): { plan?: string; status?: import('./billing.dto').SubscriptionStatus } {
  const out: { plan?: string; status?: any } = {};
  if (input.plan !== undefined && input.plan !== null) {
    if (typeof input.plan !== 'string' || input.plan.trim() === '') throw new Error('plan must be a non-empty string');
    out.plan = input.plan.trim();
  }
  if (input.status !== undefined && input.status !== null) {
    if (typeof input.status !== 'string' || !SETTABLE_SUBSCRIPTION_STATUSES.includes(input.status as any)) {
      throw new Error('status must be one of: ' + SETTABLE_SUBSCRIPTION_STATUSES.join(', '));
    }
    out.status = input.status;
  }
  if (out.plan === undefined && out.status === undefined) throw new Error('provide plan and/or status');
  return out;
}
