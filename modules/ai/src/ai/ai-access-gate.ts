// ai-access-gate.ts — PURE access decision for every AI endpoint. This is the enforcement heart of the business rule
// "a tenant must have an active paid AI package (or an unexpired Super-Admin trial) before any AI runs." It takes a
// snapshot (tenant status, package enabled flag, the tenant's subscription, usage, permission) and returns an allow/deny
// decision with a clean reason. No DB, no I/O — the endpoint layer assembles the snapshot; this file decides. Every
// status value from the spec (active/trialing/past_due/unpaid/cancelled/expired/disabled/suspended) is handled.

export type AiSubscriptionStatus =
  | 'active' | 'trialing' | 'past_due' | 'unpaid' | 'cancelled' | 'expired' | 'disabled' | 'suspended';

export type TenantAccountStatus = 'active' | 'pending' | 'suspended' | 'cancelled';

export type AiAccessReason =
  | 'ok' | 'tenant_not_active' | 'package_disabled' | 'not_subscribed' | 'trial_expired'
  | 'past_due' | 'unpaid' | 'cancelled' | 'expired' | 'subscription_suspended'
  | 'permission_denied' | 'limit_exceeded' | 'branch_disabled';

export interface AiAccessSnapshot {
  tenantStatus: TenantAccountStatus;
  /**
   * TRUE when the usage counter could not be read at all.
   *
   * This exists because the repository used to `.catch(() => 0)` that query — and `used: 0` is not "unknown", it
   * is a CONFIDENT ZERO that is indistinguishable from a tenant who has genuinely used nothing. So a single
   * failed count silently removed EVERY tenant's usage limit: `0 + 1 > limit` is false, so `limit_exceeded` could
   * never fire, and a tenant far past their cap kept consuming AI for free until someone noticed by hand.
   *
   * We still ALLOW the call (see below) — blocking a paying customer because a count timed out is the worse
   * error. But the uncertainty is now VISIBLE instead of laundered into a number.
   */
  usageUnknown?: boolean;
  supportMode?: boolean;                 // Super-Admin support session may permit access to a suspended tenant
  packageEnabled: boolean;               // Super-Admin global enable for this package
  subscription: { status: AiSubscriptionStatus; trialEndsAt?: string | Date | null } | null;
  usage: { used: number; limit: number; overageEnabled: boolean }; // limit <= 0 means unlimited
  pastDuePolicy?: 'block' | 'limit';     // Super-Admin setting for past_due tenants (default block)
  hasPermission: boolean;
  /** Four-Module guide §12 (AI-02): the branch's operational override when the request has a branch context. `enabled:
   *  false` turns the package off for that branch; true / null inherit the salon. It can never enable a package the
   *  platform disabled or the salon is not entitled to — those checks run first. Absent = no branch context. */
  branchOverride?: { branchId: string; enabled: boolean | null } | null;
  requestedUsage?: number;               // units this call will consume (default 1)
  now?: Date;
}

export interface AiAccessDecision {
  allowed: boolean;
  reason: AiAccessReason;
  subscriptionStatus: AiSubscriptionStatus | 'none';
  /**
   * -1 = UNLIMITED.  null = UNKNOWN (the usage counter could not be read).
   *
   * These are deliberately different values, and the distinction is the whole point. `-1` is a promise: "there is
   * no cap." `null` is an admission: "we could not find out." Returning `-1` for an unknown — which I did in the
   * first cut of this fix — tells a billing screen the tenant has NO LIMIT, which is a confident lie in the one
   * direction that costs money. It is the same failure as `.catch(() => 0)`, wearing a different number.
   */
  remainingUsage: number | null;
  upgradeRequired: boolean;
  limitExceeded: boolean;
  /** Functional Decision 30: 'warn_80' / 'warn_90' once this request takes usage to 80% / 90% of the limit (null otherwise). */
  usageWarning?: UsageWarning | null;
  /** The usage counter could not be read. `limitExceeded: false` here means UNKNOWN, not "within limit". */
  usageUnknown?: boolean;
}

/** Functional Decision 30 — warn at 80%, warn again at 90%, stop at 100% (unless the tenant enabled overage). */
export type UsageWarning = 'warn_80' | 'warn_90' | 'limit_reached';
export function usageWarningLevel(used: number, limit: number): UsageWarning | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;   // unlimited
  const pct = used / limit;
  return pct >= 1 ? 'limit_reached' : pct >= 0.9 ? 'warn_90' : pct >= 0.8 ? 'warn_80' : null;
}
/** The stable error code a client sees when non-critical AI stops at the limit (Decision 30). */
export const AI_USAGE_LIMIT_REACHED = 'AI_USAGE_LIMIT_REACHED' as const;

const deny = (reason: AiAccessReason, subscriptionStatus: AiAccessDecision['subscriptionStatus'], opts: Partial<AiAccessDecision> = {}): AiAccessDecision => ({
  allowed: false, reason, subscriptionStatus, remainingUsage: opts.remainingUsage ?? 0,
  upgradeRequired: opts.upgradeRequired ?? false, limitExceeded: opts.limitExceeded ?? false,
});

export function evaluateAiAccess(s: AiAccessSnapshot): AiAccessDecision {
  const now = s.now ?? new Date();
  const subStatus = s.subscription?.status ?? 'none';

  // 1) Tenant account must be usable. Suspended/cancelled/pending blocks unless an active support session permits it.
  if (s.tenantStatus !== 'active' && !(s.tenantStatus === 'suspended' && s.supportMode)) {
    return deny('tenant_not_active', subStatus);
  }

  // 2) Package must be globally enabled by Super Admin.
  if (!s.packageEnabled) return deny('package_disabled', subStatus);

  // 3) Must have a subscription at all.
  if (!s.subscription) return deny('not_subscribed', 'none', { upgradeRequired: true });

  // 4) Subscription status gate.
  switch (s.subscription.status) {
    case 'active':
      break;
    case 'trialing': {
      const ends = s.subscription.trialEndsAt ? new Date(s.subscription.trialEndsAt) : null;
      if (ends && now.getTime() > ends.getTime()) return deny('trial_expired', 'trialing', { upgradeRequired: true });
      break;
    }
    case 'past_due':
      if ((s.pastDuePolicy ?? 'block') === 'block') return deny('past_due', 'past_due', { upgradeRequired: true });
      break; // 'limit' policy: allow through to the usage check
    case 'unpaid':    return deny('unpaid', 'unpaid', { upgradeRequired: true });
    case 'cancelled': return deny('cancelled', 'cancelled', { upgradeRequired: true });
    case 'expired':   return deny('expired', 'expired', { upgradeRequired: true });
    case 'disabled':  return deny('package_disabled', 'disabled');
    case 'suspended': return deny('subscription_suspended', 'suspended');
  }

  // 4b) Branch operational override (AI-02). After the global switch and the tenant entitlement, so neither can be
  // bypassed by a branch; before the permission and the (tenant-wide, shared) usage quota.
  if (s.branchOverride && s.branchOverride.enabled === false) return deny('branch_disabled', subStatus);

  // 5) Permission/role.
  if (!s.hasPermission) return deny('permission_denied', subStatus);

  // 6) Usage limit / overage.
  //
  // If we could not READ the usage, we do not pretend it is zero. We allow the call — a paying tenant must not be
  // cut off because a count query timed out — but `limitExceeded` is reported as UNKNOWN rather than false, and
  // the decision carries the flag so a caller can log it, alert on it, or refuse to bill against it.
  if (s.usageUnknown) {
    return {
      allowed: true, reason: 'ok', subscriptionStatus: subStatus,
      // NULL, not -1. -1 means "unlimited" in this codebase, and a UI reading it would render exactly that —
      // telling the tenant they have no cap when in truth we simply failed to count. `null` cannot be mistaken
      // for a quantity: any caller doing arithmetic on it fails loudly instead of displaying a comfortable lie.
      remainingUsage: null, upgradeRequired: false, limitExceeded: false, usageUnknown: true,
    };
  }
  const limit = s.usage.limit;
  const requested = Math.max(1, s.requestedUsage ?? 1);
  const unlimited = !Number.isFinite(limit) || limit <= 0;
  const remaining = unlimited ? -1 : Math.max(0, limit - s.usage.used);
  if (!unlimited && s.usage.used + requested > limit) {
    if (s.usage.overageEnabled) {
      return { allowed: true, reason: 'ok', subscriptionStatus: subStatus, remainingUsage: remaining, upgradeRequired: false, limitExceeded: true };
    }
    return deny('limit_exceeded', subStatus, { limitExceeded: true, upgradeRequired: true, remainingUsage: 0 });
  }

  const after = usageWarningLevel(s.usage.used + requested, limit);
  return { allowed: true, reason: 'ok', subscriptionStatus: subStatus, remainingUsage: remaining, upgradeRequired: false, limitExceeded: false,
           usageWarning: after === 'warn_80' || after === 'warn_90' || after === 'limit_reached' ? after : null };
}

/** Human-readable label for a denial reason — drives the POS locked/upgrade screen copy. */
export function accessReasonLabel(reason: AiAccessReason): string {
  switch (reason) {
    case 'ok': return 'Access granted';
    case 'tenant_not_active': return 'This salon account is not active';
    case 'package_disabled': return 'This AI package is currently unavailable';
    case 'not_subscribed': return 'Subscribe to unlock this AI assistant';
    case 'trial_expired': return 'Your free trial has ended — upgrade to continue';
    case 'past_due': return 'Payment is past due — update billing to restore access';
    case 'unpaid': return 'This AI package is unpaid';
    case 'cancelled': return 'This AI package was cancelled';
    case 'expired': return 'This AI subscription has expired';
    case 'subscription_suspended': return 'This AI subscription is suspended';
    case 'permission_denied': return 'You do not have permission to use this AI assistant';
    case 'limit_exceeded': return 'You have reached this month\u2019s usage limit';
    case 'branch_disabled': return 'This AI package is turned off for this branch';
  }
}
