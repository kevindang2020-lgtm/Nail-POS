import { api } from './client';
import type { BookingVerificationPlatformPolicyView, BookingVerificationTenantRow, BookingVerificationHealthView } from '@aipowersalon/api-contracts';

// superAdminBookingVerificationApi — BUILD_PLAN Phase 4: Super Admin → Booking Verification Oversight. Counts and switches
// only — the API never returns a phone number, a code or a credential here. The module and emergency switches need
// step-up (the shared "Confirm it's you" prompt) and a reason.
export const superAdminBookingVerificationApi = {
  policy: () => api.get<BookingVerificationPlatformPolicyView>('/super-admin/booking-verification/policy'),
  tenants: (limit = 200) => api.get<BookingVerificationTenantRow[]>('/super-admin/booking-verification/tenants', { limit }),
  health: (hours = 24) => api.get<BookingVerificationHealthView>('/super-admin/booking-verification/health', { hours }),
  setModule: (enabled: boolean, reason: string) => api.post<BookingVerificationPlatformPolicyView>('/super-admin/booking-verification/module', { enabled, reason }),
  setEmergency: (disabled: boolean, reason: string) => api.post<BookingVerificationPlatformPolicyView>('/super-admin/booking-verification/emergency-disable', { disabled, reason }),
  /** Send the salon's whole platform row (required / blocked / bypassBlocked) — each change needs a reason. */
  setTenant: (tenantId: string, body: { required: boolean; blocked: boolean; bypassBlocked: boolean; reason: string }) =>
    api.patch<void>(`/super-admin/booking-verification/tenants/${encodeURIComponent(tenantId)}`, body),
};
