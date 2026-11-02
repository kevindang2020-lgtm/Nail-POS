import { api } from './client';
import type { CustomerPhoneOversight, CustomerPhoneOversightTenantRow, CustomerPhoneSweepResult } from '@aipowersalon/api-contracts';

// superAdminCustomerPhoneApi — BUILD_PLAN Phase 3 (customer_phone_number_management): the platform view of phone changes.
// Counts and states only — the API never returns a phone number, a code or a credential to this screen.
export const superAdminCustomerPhoneApi = {
  oversight: (hours = 168, tenantId?: string) => api.get<CustomerPhoneOversight>('/super-admin/customer-phone/oversight', { hours, ...(tenantId ? { tenantId } : {}) }),
  byTenant: (hours = 168) => api.get<CustomerPhoneOversightTenantRow[]>('/super-admin/customer-phone/oversight/tenants', { hours }),
  /** Close changes past their deadline and queue every failed synchronisation. A reason is required (audited). */
  sweep: (reason: string) => api.post<CustomerPhoneSweepResult>('/super-admin/customer-phone/sweep', { reason }),
};
