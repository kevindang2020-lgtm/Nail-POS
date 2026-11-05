// ttp-onboarding.ts — per-tenant Tap to Pay onboarding STATE + the pure "flip" that turns readiness on.
//
// The honest rule (see ttp-config.ts for why): Tap to Pay is usable for a tenant ONLY when the CommerceHub
// credentials are actually present AND that tenant has been recorded as fully onboarded (Apple entitlement approved
// + CommerceHub active). Missing either → readiness stays `tap_to_pay_setup_required`. This module owns the recorded
// half; ttp-config owns the credentials half.

export type AppleEntitlementStatus = 'not_started' | 'requested' | 'approved' | 'rejected';
export type CommerceHubStatus = 'not_started' | 'onboarding' | 'active' | 'suspended';

export const APPLE_ENTITLEMENT_STATUSES: AppleEntitlementStatus[] = ['not_started', 'requested', 'approved', 'rejected'];
export const COMMERCEHUB_STATUSES: CommerceHubStatus[] = ['not_started', 'onboarding', 'active', 'suspended'];

export interface TtpOnboardingRecord {
  appleEntitlementStatus: AppleEntitlementStatus;
  commerceHubStatus: CommerceHubStatus;
  notes?: string | null;
  updatedAt?: string | null;
}

export interface TtpOnboardingInput {
  appleEntitlementStatus: AppleEntitlementStatus;
  commerceHubStatus: CommerceHubStatus;
  notes?: string | null;
  updatedBy?: string | null;
}

export interface TtpOnboardingStore {
  get(tenantId: string): Promise<TtpOnboardingRecord | null>;
  set(tenantId: string, input: TtpOnboardingInput): Promise<TtpOnboardingRecord>;
}

/** A tenant is onboarded for Tap to Pay iff Apple entitlement is APPROVED and CommerceHub is ACTIVE. */
export function isTenantTtpOnboarded(r: TtpOnboardingRecord | null | undefined): boolean {
  return !!r && r.appleEntitlementStatus === 'approved' && r.commerceHubStatus === 'active';
}

/**
 * The readiness flip. `envConfigured` is whether the CommerceHub TTP credentials exist (ttp-config). Tap to Pay is
 * configured for this tenant ONLY when BOTH the credentials are present AND the tenant is recorded as onboarded —
 * so the app can never light up on recorded state alone (no creds = no session token = no charge), nor on creds
 * alone (a tenant Apple/Fiserv hasn't finished onboarding).
 */
export function tenantTapToPayConfigured(envConfigured: boolean, r: TtpOnboardingRecord | null | undefined): boolean {
  return envConfigured && isTenantTtpOnboarded(r);
}

export function validateOnboardingInput(input: TtpOnboardingInput): void {
  if (!APPLE_ENTITLEMENT_STATUSES.includes(input.appleEntitlementStatus)) {
    throw new Error(`appleEntitlementStatus must be one of ${APPLE_ENTITLEMENT_STATUSES.join(', ')}.`);
  }
  if (!COMMERCEHUB_STATUSES.includes(input.commerceHubStatus)) {
    throw new Error(`commerceHubStatus must be one of ${COMMERCEHUB_STATUSES.join(', ')}.`);
  }
}

export class InMemoryTtpOnboardingStore implements TtpOnboardingStore {
  private readonly m = new Map<string, TtpOnboardingRecord>();
  async get(tenantId: string): Promise<TtpOnboardingRecord | null> { return this.m.get(tenantId) ?? null; }
  async set(tenantId: string, input: TtpOnboardingInput): Promise<TtpOnboardingRecord> {
    validateOnboardingInput(input);
    const rec: TtpOnboardingRecord = {
      appleEntitlementStatus: input.appleEntitlementStatus,
      commerceHubStatus: input.commerceHubStatus,
      notes: input.notes ?? null,
      updatedAt: new Date().toISOString(),
    };
    this.m.set(tenantId, rec);
    return rec;
  }
}
