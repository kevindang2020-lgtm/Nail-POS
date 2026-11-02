// loyalty-dashboard.repository.ts — READ-ONLY raw aggregates for the fuller Super Admin Loyalty Programs dashboard,
// over the real loyalty tables (customer_loyalty_profiles, loyalty_redemptions, loyalty_rewards) joined to tenants.
// Tenant scope is applied via the shared overview-scope helpers. Writes nothing; empty DB → honest empty bundle.
import { type DB, andTenant, tenantPred, type OverviewScope } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';

export interface RawProfileRollup { members: number; pointsOutstanding: number; pointsIssued: number; pointsRedeemed: number; tenantsWithLoyalty: number; tiered: number; membersWithActivity: number }
export interface RawTierRow { tier: string; count: number }
export interface RawDayPoint { day: string; count: number; points: number }
export interface RawTenantPerf { tenantId: string; tenantName: string | null; activePrograms: number; members: number; pointsIssued: number; pointsRedeemed: number; redemptions: number; pointsOutstanding: number; tiered: number }
export interface RawTodayCounts { newMembers: number; redemptions: number; pointsRedeemed: number }
export interface LoyaltyDashboardData {
  rollup: RawProfileRollup; tierRows: RawTierRow[]; redemptionsTotal: number; activeRewards: number;
  redemptionsByDay: RawDayPoint[]; membersByDay: RawDayPoint[]; tenantPerf: RawTenantPerf[]; today: RawTodayCounts;
}

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

const EMPTY: LoyaltyDashboardData = {
  rollup: { members: 0, pointsOutstanding: 0, pointsIssued: 0, pointsRedeemed: 0, tenantsWithLoyalty: 0, tiered: 0, membersWithActivity: 0 },
  tierRows: [], redemptionsTotal: 0, activeRewards: 0, redemptionsByDay: [], membersByDay: [], tenantPerf: [], today: { newMembers: 0, redemptions: 0, pointsRedeemed: 0 },
};

export class LoyaltyDashboardRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async dashboardData(scope?: OverviewScope): Promise<LoyaltyDashboardData> {
    if (!this.db) return EMPTY;

    const rollupP = sql<any>`
      select count(*)::int as members,
             coalesce(sum(points_balance), 0)::bigint as points_outstanding,
             coalesce(sum(total_earned_points), 0)::bigint as points_issued,
             coalesce(sum(total_redeemed_points), 0)::bigint as points_redeemed,
             count(distinct tenant_id)::int as tenants_with_loyalty,
             count(*) filter (where lower(coalesce(nullif(loyalty_tier,''),'Regular')) <> 'regular')::int as tiered,
             count(distinct customer_id) filter (where customer_id in (
               select customer_id from loyalty_redemptions rd where rd.created_at >= now() - interval '30 days'
               ${scope?.tenantId ? sql`and rd.tenant_id = ${scope.tenantId}` : sql``}))::int as members_with_activity
      from customer_loyalty_profiles where ${tenantPred(scope)}`.execute(this.db);

    const tiersP = sql<any>`
      select coalesce(nullif(loyalty_tier,''),'Regular') as tier, count(*)::int as count
      from customer_loyalty_profiles where ${tenantPred(scope)} group by 1 order by count desc`.execute(this.db);

    const redTotalP = sql<any>`select count(*)::int as c from loyalty_redemptions rd where ${tenantPred(scope)}`.execute(this.db);
    const activeRewardsP = sql<any>`select count(*)::int as c from loyalty_rewards r where r.active = true ${andTenant(scope)}`.execute(this.db);

    const redByDayP = sql<any>`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as count, coalesce(sum(points_spent),0)::bigint as points
      from loyalty_redemptions rd where rd.created_at >= now() - interval '7 days' and ${tenantPred(scope)}
      group by 1 order by 1`.execute(this.db);

    const memByDayP = sql<any>`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as count, 0::bigint as points
      from customer_loyalty_profiles where created_at >= now() - interval '7 days' and ${tenantPred(scope)}
      group by 1 order by 1`.execute(this.db);

    const perfP = sql<any>`
      select t.id as tenant_id, t.display_name as tenant_name,
             (select count(*) from loyalty_rewards lr where lr.tenant_id = t.id and lr.active = true)::int as active_programs,
             (select count(*) from customer_loyalty_profiles lp where lp.tenant_id = t.id)::int as members,
             (select coalesce(sum(total_earned_points),0) from customer_loyalty_profiles lp where lp.tenant_id = t.id)::bigint as points_issued,
             (select coalesce(sum(total_redeemed_points),0) from customer_loyalty_profiles lp where lp.tenant_id = t.id)::bigint as points_redeemed,
             (select count(*) from loyalty_redemptions rd where rd.tenant_id = t.id)::int as redemptions,
             (select coalesce(sum(points_balance),0) from customer_loyalty_profiles lp where lp.tenant_id = t.id)::bigint as points_outstanding,
             (select count(*) from customer_loyalty_profiles lp where lp.tenant_id = t.id and lower(coalesce(nullif(lp.loyalty_tier,''),'Regular')) <> 'regular')::int as tiered
      from tenants t
      where exists (select 1 from customer_loyalty_profiles lp where lp.tenant_id = t.id) ${andTenant(scope, 't.id')}
      order by members desc limit 25`.execute(this.db);

    const todayP = sql<any>`
      select (select count(*) from customer_loyalty_profiles lp where lp.created_at >= date_trunc('day', now()) and ${tenantPred(scope, 'lp.tenant_id')})::int as new_members,
             (select count(*) from loyalty_redemptions rd where rd.created_at >= date_trunc('day', now()) and ${tenantPred(scope, 'rd.tenant_id')})::int as redemptions,
             (select coalesce(sum(points_spent),0) from loyalty_redemptions rd where rd.created_at >= date_trunc('day', now()) and ${tenantPred(scope, 'rd.tenant_id')})::bigint as points_redeemed`.execute(this.db);

    const [rollup, tiers, redTotal, activeRewards, redByDay, memByDay, perf, today] = await Promise.all([rollupP, tiersP, redTotalP, activeRewardsP, redByDayP, memByDayP, perfP, todayP]);
    const rr = rollup.rows[0] ?? {};
    const td = today.rows[0] ?? {};
    return {
      rollup: { members: n(rr.members), pointsOutstanding: n(rr.points_outstanding), pointsIssued: n(rr.points_issued), pointsRedeemed: n(rr.points_redeemed), tenantsWithLoyalty: n(rr.tenants_with_loyalty), tiered: n(rr.tiered), membersWithActivity: n(rr.members_with_activity) },
      tierRows: tiers.rows.map((r: any) => ({ tier: String(r.tier), count: n(r.count) })),
      redemptionsTotal: n(redTotal.rows[0]?.c), activeRewards: n(activeRewards.rows[0]?.c),
      redemptionsByDay: redByDay.rows.map((r: any) => ({ day: String(r.day), count: n(r.count), points: n(r.points) })),
      membersByDay: memByDay.rows.map((r: any) => ({ day: String(r.day), count: n(r.count), points: 0 })),
      tenantPerf: perf.rows.map((r: any) => ({ tenantId: String(r.tenant_id), tenantName: r.tenant_name ?? null, activePrograms: n(r.active_programs), members: n(r.members), pointsIssued: n(r.points_issued), pointsRedeemed: n(r.points_redeemed), redemptions: n(r.redemptions), pointsOutstanding: n(r.points_outstanding), tiered: n(r.tiered) })),
      today: { newMembers: n(td.new_members), redemptions: n(td.redemptions), pointsRedeemed: n(td.points_redeemed) },
    };
  }
}
