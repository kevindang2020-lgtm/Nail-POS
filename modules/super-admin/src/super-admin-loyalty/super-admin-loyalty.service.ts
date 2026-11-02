// super-admin-loyalty.service.ts — read-only, cross-tenant Loyalty Programs overview for Super Admin (Phase 10). Thin
// orchestration; all aggregation lives in the Kysely repository. Reads the loyalty points system across all tenants:
// customer_loyalty_profiles (balances/tiers), loyalty_rewards (catalog), loyalty_redemptions (history). Distinct from
// Memberships (recurring plans) — this is the points economy. No write paths by design (tenants run their own loyalty
// programs via the POS). Mirrors the super-admin-staff / super-admin-queue service shape.

import type { OverviewScope } from '@aipowersalon/database';

export interface LoyaltyOverviewFilters {
  search: string;  // free-text match on reward title / salon name (server-side, trimmed)
  status: string;  // '' = all rewards, 'active' | 'inactive'
  limit: number;   // rewards-list row cap (default 200)
  scope?: OverviewScope;  // optional single-tenant narrowing (Phase 1); absent = platform-wide
}

export interface PlatformLoyaltyKpis {
  loyaltyMembers: number;      // customers enrolled in loyalty (profiles)
  pointsOutstanding: number;   // sum of current point balances across all members
  pointsRedeemed: number;      // sum of all points ever redeemed
  activeRewards: number;       // active reward definitions across the platform
  salonsWithLoyalty: number;   // distinct salons with any loyalty member
}
export interface PlatformLoyaltyTenantRow { tenantId: string; tenantName: string | null; members: number; pointsOutstanding: number; activeRewards: number; redemptions: number }
export interface PlatformLoyaltyRewardRow { rewardId: string; tenantId: string; tenantName: string | null; title: string; pointsCost: number; active: boolean; redemptionCount: number }
export interface PlatformLoyaltyRedemptionRow { redemptionId: string; tenantId: string; tenantName: string | null; customerName: string | null; rewardTitle: string; pointsSpent: number; createdAt: string | null }
export interface PlatformLoyaltyTierSlice { tier: string; count: number }

export interface PlatformLoyaltyOverview {
  kpis: PlatformLoyaltyKpis;
  tenants: PlatformLoyaltyTenantRow[];
  rewards: PlatformLoyaltyRewardRow[];
  redemptions: PlatformLoyaltyRedemptionRow[];
  tierBreakdown: PlatformLoyaltyTierSlice[];
  tenantCount: number;
}

export interface AdminCtx { userId?: string; email?: string; ip?: string }

interface Repo {
  platformLoyaltyOverview(f: LoyaltyOverviewFilters): Promise<PlatformLoyaltyOverview>;
}

const clampInt = (v: unknown, def: number, min: number, max: number): number => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
};
const clampStr = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export class SuperAdminLoyaltyService {
  constructor(private readonly repo: Repo) {}

  getOverview(_ctx: AdminCtx, q: { search?: unknown; status?: unknown; limit?: unknown; scope?: OverviewScope }): Promise<PlatformLoyaltyOverview> {
    return this.repo.platformLoyaltyOverview({
      search: clampStr(q?.search),
      status: clampStr(q?.status, 40),
      limit: clampInt(q?.limit, 200, 1, 1000),
      scope: q?.scope,
    });
  }
}
