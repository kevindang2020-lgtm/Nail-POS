// tapToPayAdminApi.ts — Super Admin → Tap to Pay (Owner & Manager Payment App mandate §5–§9, §34, §123, §145): a tenant's
// Tap to Pay onboarding STATUS (Apple entitlement + the processor's Tap to Pay merchant enrollment + whether the platform
// credentials exist) and its registered payment phones. Wired to the SuperAdminGuard routes under /super-admin/tap-to-pay.
// Safe status only — no merchant credential, key or token ever crosses this API.
import type { TtpAppleEntitlementStatus, TtpPspEnrollmentStatus, TtpOnboardingAdminView, TtpDeviceAdminRow } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
export { TTP_APPLE_STATUSES, TTP_PSP_STATUSES } from '@aipowersalon/api-contracts/platform';
export type { TtpAppleEntitlementStatus, TtpPspEnrollmentStatus, TtpOnboardingAdminView, TtpDeviceAdminRow };
import { api } from './client';

const enc = encodeURIComponent;
const base = (tenantId: string) => `/super-admin/tap-to-pay/tenants/${enc(tenantId)}`;

export const tapToPayAdminApi = {
  onboarding: (tenantId: string) => api.get<TtpOnboardingAdminView>(`${base(tenantId)}/onboarding`),
  setOnboarding: (tenantId: string, body: { appleEntitlementStatus: TtpAppleEntitlementStatus; pspEnrollmentStatus: TtpPspEnrollmentStatus; notes?: string }) =>
    api.post<unknown>(`${base(tenantId)}/onboarding`, body),
  devices: (tenantId: string) => api.get<TtpDeviceAdminRow[]>(`${base(tenantId)}/devices`),
  approve: (tenantId: string, deviceId: string) => api.post<TtpDeviceAdminRow>(`${base(tenantId)}/devices/${enc(deviceId)}/approve`, {}),
  revoke: (tenantId: string, deviceId: string) => api.post<TtpDeviceAdminRow>(`${base(tenantId)}/devices/${enc(deviceId)}/revoke`, {}),
};
