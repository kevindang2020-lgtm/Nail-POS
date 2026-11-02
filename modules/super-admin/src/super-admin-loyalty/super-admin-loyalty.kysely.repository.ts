// super-admin-loyalty.kysely.repository.ts — READ-ONLY, platform-wide (cross-tenant) Loyalty Programs aggregation for
// the Super Admin Loyalty screen. Reads customer_loyalty_profiles, loyalty_rewards, and loyalty_redemptions across all
// tenants (joined to tenants/customers for names). It does NOT re-implement any points/earn/redeem logic and writes
// nothing. With no DB configured it returns an honest empty overview (no fabricated data).
import { type DB, andTenant, tenantPred } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';
import type {
  PlatformLoyaltyOverview, LoyaltyOverviewFilters,
  PlatformLoyaltyTenantRow, PlatformLoyaltyRewardRow, PlatformLoyaltyRedemptionRow, PlatformLoyaltyTierSlice,
} from './super-admin-loyalty.service';

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown): string | null => { if (!v) return null; const d = new Date(v as any); return isNaN(+d) ? null : d.toISOString(); };
const bool = (v: unknown): boolean => v === true || v === 't' || v === 1 || v === '1';

const EMPTY: PlatformLoyaltyOverview = {
  kpis: { loyaltyMembers: 0, pointsOutstanding: 0, pointsRedeemed: 0, activeRewards: 0, salonsWithLoyalty: 0 },
  tenants: [], rewards: [], redemptions: [], tierBreakdown: [], tenantCount: 0,
};

export class SuperAdminLoyaltyKyselyRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async platformLoyaltyOverview(f: LoyaltyOverviewFilters): Promise<PlatformLoyaltyOverview> {
    if (!this.db) return EMPTY;
    const scope = f.scope;
    const hasSearch = f.search.length > 0;
    const pat = `%${f.search}%`;
    const activeFilter = f.status === 'active' ? sql`r.active = true` : f.status === 'inactive' ? sql`r.active = false` : sql`true`;

    const profileKpiP = sql<{ members: number; points_outstanding: number; points_redeemed: number; salons: number }>`
      select count(*)::int as members,
             coalesce(sum(points_balance), 0)::bigint as points_outstanding,
             coalesce(sum(total_redeemed_points), 0)::bigint as points_redeemed,
             count(distinct tenant_id)::int as salons
      from customer_loyalty_profiles where ${tenantPred(scope)}`.execute(this.db);

    const rewardKpiP = sql<{ active_rewards: number }>`
      select count(*)::int as active_rewards from loyalty_rewards where active = true ${andTenant(scope)}`.execute(this.db);

    const tenantsP = sql<{ tenant_id: string; tenant_name: string | null; members: number; points_outstanding: number; active_rewards: number; redemptions: number }>`
      select t.id as tenant_id, t.display_name as tenant_name,
             (select count(*) from customer_loyalty_profiles lp where lp.tenant_id = t.id)::int as members,
             (select coalesce(sum(points_balance), 0) from customer_loyalty_profiles lp where lp.tenant_id = t.id)::bigint as points_outstanding,
             (select count(*) from loyalty_rewards lr where lr.tenant_id = t.id and lr.active = true)::int as active_rewards,
             (select count(*) from loyalty_redemptions rd where rd.tenant_id = t.id)::int as redemptions
      from tenants t
      where (exists (select 1 from customer_loyalty_profiles lp where lp.tenant_id = t.id)
         or exists (select 1 from loyalty_rewards lr where lr.tenant_id = t.id)) ${andTenant(scope, 't.id')}
      order by members desc, t.display_name asc`.execute(this.db);

    const tiersP = sql<{ tier: string; count: number }>`
      select coalesce(nullif(loyalty_tier, ''), 'none') as tier, count(*)::int as count
      from customer_loyalty_profiles where ${tenantPred(scope)} group by loyalty_tier order by count desc`.execute(this.db);

    const rewardsP = sql<{ reward_id: string; tenant_id: string; tenant_name: string | null; title: string; points_cost: number; active: unknown; redemption_count: number }>`
      select r.id as reward_id, r.tenant_id, t.display_name as tenant_name, r.title, r.points_cost, r.active,
             (select count(*) from loyalty_redemptions rd where rd.reward_id = r.id)::int as redemption_count
      from loyalty_rewards r
      left join tenants t on t.id = r.tenant_id
      where ${activeFilter}
        and (${hasSearch ? sql`(r.title ilike ${pat} or t.display_name ilike ${pat})` : sql`true`}) ${andTenant(scope, 'r.tenant_id')}
      order by redemption_count desc, r.points_cost asc
      limit ${f.limit}`.execute(this.db);

    const redemptionsP = sql<{ redemption_id: string; tenant_id: string; tenant_name: string | null; customer_name: string | null; reward_title: string; points_spent: number; created_at: unknown }>`
      select rd.id as redemption_id, rd.tenant_id, t.display_name as tenant_name,
             c.full_name as customer_name, rd.reward_title, rd.points_spent, rd.created_at
      from loyalty_redemptions rd
      left join tenants t on t.id = rd.tenant_id
      left join customers c on c.id = rd.customer_id
      where ${tenantPred(scope, 'rd.tenant_id')}
      order by rd.created_at desc nulls last
      limit 15`.execute(this.db);

    const [pk, rk, tenants, tiers, rewards, redemptions] = await Promise.all([profileKpiP, rewardKpiP, tenantsP, tiersP, rewardsP, redemptionsP]);
    const p = pk.rows[0] ?? { members: 0, points_outstanding: 0, points_redeemed: 0, salons: 0 };

    const tenantRows: PlatformLoyaltyTenantRow[] = tenants.rows.map((r) => ({
      tenantId: r.tenant_id, tenantName: r.tenant_name, members: n(r.members), pointsOutstanding: n(r.points_outstanding), activeRewards: n(r.active_rewards), redemptions: n(r.redemptions),
    }));
    const rewardRows: PlatformLoyaltyRewardRow[] = rewards.rows.map((r) => ({
      rewardId: r.reward_id, tenantId: r.tenant_id, tenantName: r.tenant_name, title: r.title, pointsCost: n(r.points_cost), active: bool(r.active), redemptionCount: n(r.redemption_count),
    }));
    const redemptionRows: PlatformLoyaltyRedemptionRow[] = redemptions.rows.map((r) => ({
      redemptionId: r.redemption_id, tenantId: r.tenant_id, tenantName: r.tenant_name, customerName: r.customer_name, rewardTitle: r.reward_title, pointsSpent: n(r.points_spent), createdAt: iso(r.created_at),
    }));
    const tierBreakdown: PlatformLoyaltyTierSlice[] = tiers.rows.map((r) => ({ tier: r.tier, count: n(r.count) }));

    return {
      kpis: {
        loyaltyMembers: n(p.members),
        pointsOutstanding: n(p.points_outstanding),
        pointsRedeemed: n(p.points_redeemed),
        activeRewards: n(rk.rows[0]?.active_rewards),
        salonsWithLoyalty: n(p.salons),
      },
      tenants: tenantRows,
      rewards: rewardRows,
      redemptions: redemptionRows,
      tierBreakdown,
      tenantCount: tenantRows.length,
    };
  }
}
