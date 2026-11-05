import { api } from './client';
import type { AdminDealRow } from '@aipowersalon/api-contracts/platform';
export type { AdminDealRow };   // the API's own contract

// superAdminDealsApi — BUILD_PLAN Phase 5: Super Admin → Deals Oversight. The marketplace across salons, suspending a
// deal (a reason is required; audited; booked and on-ticket uses are given back), and the per-salon switch / live-deal
// limit (step-up + reason). The platform-wide kill switch stays on the Kill Switches panel.
export interface DealsOverview { totalDeals: number; active: number; pendingApproval: number; suspended: number; totalRedemptions: number; totalDiscountedCents: number; discountedLast30DaysCents: number; reversedRedemptions: number; openApplications: number; tenantsWithDeals: number; coupons: number; automatic: number; tenantsSwitchedOff: number }
export interface DealsTenantRow { tenantId: string; salonName: string | null; platformDisabled: boolean; platformDisabledReason: string | null; platformMaxActiveDeals: number | null; dealsEnabled: boolean; stackingPolicy: string; activeDeals: number; discountedLast30DaysCents: number }
export const superAdminDealsApi = {
  overview: () => api.get<DealsOverview>('/super-admin/deals/overview'),
  list: (q: { status?: string; kind?: string; q?: string; suspended?: boolean; tenantId?: string } = {}) => api.get<AdminDealRow[]>('/super-admin/deals', q as any),
  tenants: () => api.get<DealsTenantRow[]>('/super-admin/deals/tenants'),
  suspend: (id: string, reason: string) => api.post<{ suspended: boolean; releasedPlaces: number; releasedApplications: number }>(`/super-admin/deals/${encodeURIComponent(id)}/suspend`, { reason }),
  setTenant: (tenantId: string, body: { disabled?: boolean; reason?: string | null; maxActiveDeals?: number | null }) => api.patch<DealsTenantRow>(`/super-admin/deals/tenants/${encodeURIComponent(tenantId)}`, body),
};
