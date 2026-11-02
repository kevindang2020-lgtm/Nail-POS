import { suspensionPolicyFor } from '@aipowersalon/permissions';
/**
 * auth-flow.ts — pure login decision state machine (no I/O).
 *
 * The orchestrator service gathers facts (does the user exist, is the password
 * valid, tenant/user/subscription status, MFA state, branch count) and passes
 * them here. This function decides the single correct outcome. Keeping it pure
 * makes every branch trivially unit-testable and identical across tenant login,
 * branded-URL login, and MFA continuation.
 */

export type TenantStatus = 'active' | 'pending' | 'suspended' | 'cancelled';
export type UserStatus = 'active' | 'invited' | 'suspended' | 'inactive';
export type SubStatus = 'active' | 'trialing' | 'trial' | 'past_due' | 'expired' | 'cancelled';

export type LoginOutcome =
  | 'BRANCH_INACTIVE'
  | 'INVALID_CREDENTIALS'
  | 'TENANT_NOT_FOUND'
  | 'TENANT_SUSPENDED'
  | 'TENANT_CANCELLED'
  | 'USER_DISABLED'
  | 'SUBSCRIPTION_BLOCKED'
  | 'MFA_REQUIRED'
  | 'BRANCH_SELECTION_REQUIRED'
  | 'RATE_LIMITED'
  | 'SUCCESS';

export interface LoginFacts {
  tenantFound: boolean;
  tenantStatus?: TenantStatus;
  userFound: boolean;
  passwordValid: boolean;
  userStatus?: UserStatus;
  subscriptionStatus?: SubStatus;
  /** true when the user's role/tenant policy requires MFA and it isn't satisfied yet */
  mfaRequired: boolean;
  mfaSatisfied: boolean;
  branchCount: number;              // ACTIVE branches only
  /** false when the user's assigned branch exists but is not active. */
  assignedBranchActive?: boolean;
  /** Constitution 7 §19 — the signing-in user's role and, if the salon is suspended, why (decides billing-only access). */
  role?: string;
  suspensionReasonCode?: string | null;
}

export interface LoginDecision {
  outcome: LoginOutcome;
  /** Constitution 7 §19 — set when the session may reach ONLY billing (a salon suspended for a cause that keeps owner billing access) */
  restriction?: 'SUSPENDED_BILLING_ONLY';
  /** safe, user-facing message (never leaks whether an account exists) */
  message: string;
}

const GENERIC =
  "We couldn't sign you in. Please check your salon code, email/phone, and password.";

/**
 * Order matters. We surface tenant/subscription blocks only AFTER credentials
 * verify, so an attacker can't probe tenant state with a bad password.
 */
export function decideLogin(f: LoginFacts): LoginDecision {
  if (!f.tenantFound) return { outcome: 'TENANT_NOT_FOUND', message: GENERIC };

  // Credentials must be valid before we reveal anything tenant/account specific.
  if (!f.userFound || !f.passwordValid) {
    return { outcome: 'INVALID_CREDENTIALS', message: GENERIC };
  }

  // Constitution 7 §19 — "do not simply delete tenant access": when the suspension cause keeps owner billing access
  // (BILLING, TERMS, TENANT_REQUEST, PLATFORM_OPERATION, OTHER), the OWNER may sign in to a BILLING-ONLY session — to pay
  // and settle. Subscription and branch checks do not apply to it (a past-due subscription is the reason it exists).
  // Staff never; SECURITY / FRAUD never; an unknown cause never (suspensionPolicyFor falls back to the strictest policy).
  if (f.tenantStatus === 'suspended' && f.role === 'OWNER' && ownerBillingAllowed(f.suspensionReasonCode)) {
    if (f.userStatus && f.userStatus !== 'active')
      return {
        outcome: 'USER_DISABLED',
        message: 'Your user account is currently disabled. Please contact your salon owner or manager.',
      };
    if (f.mfaRequired && !f.mfaSatisfied)
      return { outcome: 'MFA_REQUIRED', message: 'Enter the 6-digit verification code to continue.' };
    return { outcome: 'SUCCESS', message: 'Your salon is suspended. You can review your AI PowerSalon invoices; contact support to settle and reactivate.', restriction: 'SUSPENDED_BILLING_ONLY' };
  }
  if (f.tenantStatus === 'suspended')
    return {
      outcome: 'TENANT_SUSPENDED',
      message: 'This salon account is currently suspended. Please contact AIPowerSalon support.',
    };
  if (f.tenantStatus === 'cancelled')
    return {
      outcome: 'TENANT_CANCELLED',
      message: 'This salon account is closed. Please contact AIPowerSalon support.',
    };
  if (f.userStatus && f.userStatus !== 'active')
    return {
      outcome: 'USER_DISABLED',
      message: 'Your user account is currently disabled. Please contact your salon owner or manager.',
    };

  if (f.subscriptionStatus === 'expired' || f.subscriptionStatus === 'cancelled' || f.subscriptionStatus === 'past_due')
    return {
      outcome: 'SUBSCRIPTION_BLOCKED',
      message: 'Your salon subscription needs attention. Please contact the salon owner.',
    };

  if (f.mfaRequired && !f.mfaSatisfied)
    return { outcome: 'MFA_REQUIRED', message: 'Enter the 6-digit verification code to continue.' };

  if (f.branchCount > 1)
    return { outcome: 'BRANCH_SELECTION_REQUIRED', message: 'Select the branch you want to work in.' };

  // A session must never be scoped to a branch that is not active. Previously the branch's status was never
  // checked, so staff assigned to a suspended/closed branch could still sign in and operate under it.
  if (f.assignedBranchActive === false)
    return {
      outcome: 'BRANCH_INACTIVE',
      message: 'This salon location is not currently active. Please contact your salon owner or manager.',
    };

  return { outcome: 'SUCCESS', message: 'Signed in.' };
}

/** §19: does this suspension cause keep the owner's billing access? (unknown / missing cause → no) */
export function ownerBillingAllowed(code: string | null | undefined): boolean {
  if (!code) return false;
  return suspensionPolicyFor(code).find((l) => l.capability === 'ownerBillingAccess')?.allowed === true;
}
