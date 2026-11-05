// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { PlanDistributionItem } from '@aipowersalon/api-contracts/platform';
import type { PlanDistributionItem } from '@aipowersalon/api-contracts/platform';
// dashboard.dto.ts — Super-Admin platform dashboard contracts. The overview is computed from per-tenant facts the
// platform already has (status, plan tier, usage, age) plus a plan-price config supplied by the caller (prices are a
// business setting, never hard-coded/fabricated here). Pure helpers live in dashboard-core.ts.

export type PlatformTenantStatus = 'active' | 'suspended' | 'pending' | 'trialing' | 'cancelled';

export interface PlatformTenantFact {
  status: PlatformTenantStatus;
  planTier: string;            // e.g. 'Premium' | 'Standard' | 'Basic' | 'Trial'
  usagePercent: number;        // 0..100 (of the tenant's plan limit)
  createdDaysAgo: number;      // whole days since the tenant was created
}


export interface SuperAdminDashboardOverview {
  totals: { total: number; active: number; suspended: number; pending: number; trialing: number; cancelled: number };
  newTenants: number;            // created within the window (default 30 days)
  estimatedMrrCents: number;     // Σ planPrice for ACTIVE tenants only
  averageUsagePercent: number;   // mean usage across ACTIVE tenants (0 if none), rounded
  tenantsOverUsage: number;      // ACTIVE tenants at/above the usage threshold (default 80%)
  planDistribution: PlanDistributionItem[]; // across all non-cancelled tenants, desc by count then tier
}

export interface DashboardOptions {
  planPrices: Record<string, number>; // planTier -> monthly price in cents
  newWindowDays?: number;              // default 30
  usageThresholdPercent?: number;      // default 80
}
