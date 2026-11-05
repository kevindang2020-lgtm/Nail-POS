// superAdminCompensationApi.ts — §27 cross-tenant compensation-config oversight for Super Admin.
import { api } from './client';
import type { TenantCompensationSummary } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)


export const superAdminCompensationApi = {
  overview: () => api.get<TenantCompensationSummary[]>('/super-admin/compensation/overview'),
};
export type { TenantCompensationSummary };
