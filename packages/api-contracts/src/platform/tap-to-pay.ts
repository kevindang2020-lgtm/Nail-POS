// tap-to-pay.ts — Super Admin → Tap to Pay (Owner & Manager Payment App mandate §5–§9, §123, §145): the SAFE onboarding
// status of a salon (Apple entitlement + the payment processor's Tap to Pay merchant enrollment + whether the platform
// credentials are present — yes/no only) and its registered payment phones. Wire contract for
// /super-admin/tap-to-pay/tenants/:tenantId/* (modules/checkout ttp-onboarding.controller.ts). Never a credential.
export type TtpAppleEntitlementStatus = 'not_started' | 'requested' | 'approved' | 'rejected';
/** The processor-side Tap to Pay merchant enrollment (today: Fiserv's commerce platform). */
export type TtpPspEnrollmentStatus = 'not_started' | 'onboarding' | 'active' | 'suspended';
export const TTP_APPLE_STATUSES: readonly TtpAppleEntitlementStatus[] = ['not_started', 'requested', 'approved', 'rejected'];
export const TTP_PSP_STATUSES: readonly TtpPspEnrollmentStatus[] = ['not_started', 'onboarding', 'active', 'suspended'];

export interface TtpOnboardingAdminView {
  tenantId: string;
  appleEntitlementStatus: TtpAppleEntitlementStatus;
  /** the processor enrollment status (same value as the legacy `commerceHubStatus` field) */
  pspEnrollmentStatus: TtpPspEnrollmentStatus;
  onboarded: boolean;
  credentialsPresent: boolean;
  notes?: string | null;
  updatedAt?: string | null;
}

export interface TtpDeviceAdminRow {
  deviceId: string; branchId?: string | null; label?: string | null; platform: string; osVersion?: string | null; appVersion?: string | null;
  tapToPayCapable: boolean; status: 'pending' | 'active' | 'revoked' | 'compromised' | 'disabled'; approvedAt?: string | null; lastSeenAt?: string | null;
  boundUserId?: string | null; revokedAt?: string | null; revokeReason?: string | null; lastPaymentAt?: string | null; lastErrorAt?: string | null; lastErrorCode?: string | null;
}
