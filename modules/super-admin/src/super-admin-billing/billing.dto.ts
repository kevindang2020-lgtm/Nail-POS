// billing.dto.ts — Super-Admin Billing & Subscriptions surface. Per-tenant subscription + payment-config + hardware
// payoff, plus platform roll-ups. Facts are RAW from the repo; the pure core (billing-core.ts) enriches each row with
// MRR from configured plan prices and computes the overview. No fabrication: MRR is 0 until PLAN_PRICES_JSON is set,
// and the raw merchant_id is never exposed (only the last 4).
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'expired' | 'cancelled' | 'none';
export type PaymentConfigStatus = 'pending' | 'active' | 'error' | 'disabled' | 'none';
export type HardwareStatus = 'active' | 'paid_off' | 'none';

export interface BillingFact {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  plan: string;                       // subscription plan tier (raw string), 'Trial' when no subscription row
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  processor: string;                  // fiserv | cardpointe | none
  merchantIdLast4: string | null;     // last 4 of the live MID, or null when unprovisioned
  paymentConfigured: boolean;
  paymentStatus: PaymentConfigStatus;
  hardwareTotalCents: number;
  hardwareRemainingCents: number;
  hardwareStatus: HardwareStatus;
}

export interface TenantBillingRow extends BillingFact {
  mrrCents: number;                   // plan price when subscription is active, else 0
}


export interface BillingResult { rows: TenantBillingRow[]; overview: BillingOverview }

// Mutable subscription statuses (a real subscription can be set to any of these; 'none' = no subscription, not settable).
export const SETTABLE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['active', 'trialing', 'past_due', 'expired', 'cancelled'];
export interface SubscriptionUpdate { plan?: string; status?: SubscriptionStatus }

// The billing core's computed overview (a server-internal shape; the endpoint returns BillingSubscriptionsOverview).
export interface BillingOverview {
  totalTenants: number;
  mrrCents: number;                   // sum of active tenants' plan prices
  bySubscriptionStatus: Record<SubscriptionStatus, number>;
  byPaymentStatus: Record<PaymentConfigStatus, number>;
  hardwareOutstandingCents: number;   // sum of remaining_cents across tenants still paying off
  planDistribution: { plan: string; count: number }[];
  planCatalog: string[];              // configured plan tiers (PLAN_PRICES_JSON keys), for the change-plan dropdown
}
