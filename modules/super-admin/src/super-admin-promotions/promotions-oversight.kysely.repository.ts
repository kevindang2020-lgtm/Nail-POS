// Kysely implementation — BUILD_PLAN Phase 5: reads the ONE deals domain (deals + deal_redemptions + tenants/branches).
// tenant_promotions / tenant_promotion_redemptions are frozen (migration 523); their rows were carried into deals (522).
// "Revenue" is what the customers paid on the tickets that carried a redeemed offer; "discount" what the offers took off.
// CROSS-TENANT BY DESIGN: Super Admin platform oversight (behind SuperAdminGuard), read-only.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type {
  PromotionsOversightRepositoryPort, StatusCount, TypeCount, KpiTotals, DailyPoint, TopPromotionRow, TenantOversightRow, BottomTotals,
} from './promotions-oversight.repository';
import type { OfferFacts } from './promotions-core';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const OUT = sql`case when d.suspended_at is not null then 'disabled' when d.status = 'canceled' then 'cancelled' when d.status = 'sold_out' then 'completed' else d.status end`;
// the redeemed offers with what they took off and what their ticket paid
const REDEEMED = sql`select r.deal_id, r.tenant_id, r.redeemed_at, (r.amount_discounted_cents - r.reversed_cents) as discount_cents, coalesce(t.total_cents, 0) as paid_cents
                       from deal_redemptions r left join tickets t on t.id = r.ticket_id and t.tenant_id = r.tenant_id
                      where r.status in ('redeemed','partially_reversed')`;

export class KyselyPromotionsOversightRepository implements PromotionsOversightRepositoryPort {
  constructor(private readonly db: AppDatabase) {}

  async statusCounts(): Promise<StatusCount[]> {
    return sql<StatusCount>`select ${OUT} as status, count(*)::int as count from deals d where d.kind <> 'announcement' group by 1`.execute(this.db as any).then((r) => r.rows).catch(() => []);
  }
  async typeCounts(): Promise<TypeCount[]> {
    return sql<TypeCount>`select d.kind || ':' || d.discount_type as type, count(*)::int as count from deals d where d.kind <> 'announcement' group by 1`.execute(this.db as any).then((r) => r.rows).catch(() => []);
  }

  async kpiTotals(): Promise<KpiTotals> {
    const p: any = await sql`
      select count(*) filter (where d.status = 'active')::int as active, count(*) filter (where d.status = 'scheduled')::int as scheduled,
        count(*) filter (where d.status in ('expired','sold_out'))::int as completed, 0::int as platform_offers,
        count(*) filter (where d.status = 'pending_approval')::int as high_value_pending, count(distinct d.branch_id) filter (where d.branch_id is not null)::int as branches
      from deals d where d.kind <> 'announcement'`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    const r: any = await sql`select count(*)::bigint as redemptions, coalesce(sum(paid_cents),0)::bigint as revenue_cents, coalesce(sum(discount_cents),0)::bigint as discount_total
                             from (${REDEEMED}) x`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { active: n(p?.active), scheduled: n(p?.scheduled), completed: n(p?.completed), participatingBranches: n(p?.branches), platformOffers: n(p?.platform_offers), highValuePending: n(p?.high_value_pending),
      redemptions: n(r?.redemptions), revenueCents: n(r?.revenue_cents), discountTotalCents: n(r?.discount_total), eligibleTotalCents: n(r?.revenue_cents) + n(r?.discount_total) };
  }

  async daily7(): Promise<DailyPoint[]> {
    const rows: any[] = await sql`select redeemed_at::date as day, count(*)::bigint as redemptions, coalesce(sum(paid_cents),0)::bigint as revenue_cents
      from (${REDEEMED}) x where redeemed_at >= current_date - interval '6 days' group by redeemed_at::date order by redeemed_at::date`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((d) => ({ day: iso(d.day) || String(d.day), redemptions: n(d.redemptions), revenueCents: n(d.revenue_cents) }));
  }

  async topPromotions(limit: number): Promise<TopPromotionRow[]> {
    const rows: any[] = await sql`
      select d.id, d.title, t.display_name as tenant, b.name as branch, d.kind || ':' || d.discount_type as offer, ${OUT} as status, d.starts_at, d.ends_at,
        coalesce(x.redemptions,0)::bigint as redemptions, coalesce(x.revenue_cents,0)::bigint as revenue_cents
      from deals d left join tenants t on t.id = d.tenant_id left join branches b on b.id = d.branch_id and b.tenant_id = d.tenant_id
      left join (select deal_id, count(*) as redemptions, sum(paid_cents) as revenue_cents from (${REDEEMED}) y group by deal_id) x on x.deal_id = d.id
      where d.kind <> 'announcement' order by revenue_cents desc nulls last limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ id: String(r.id), name: r.title ?? null, tenant: r.tenant ?? null, branch: r.branch ?? null, offer: r.offer ?? null, status: r.status, revenueCents: n(r.revenue_cents), redemptions: n(r.redemptions), startAt: iso(r.starts_at), endAt: iso(r.ends_at) }));
  }

  async byTenant(limit: number): Promise<TenantOversightRow[]> {
    const rows: any[] = await sql`
      select d.tenant_id, t.display_name as tenant, count(*) filter (where d.status='active')::int as active,
        coalesce(sum(x.redemptions),0)::bigint as redemptions, coalesce(sum(x.revenue_cents),0)::bigint as revenue_cents, max(d.updated_at) as last_activity
      from deals d left join tenants t on t.id = d.tenant_id
      left join (select deal_id, count(*) as redemptions, sum(paid_cents) as revenue_cents from (${REDEEMED}) y group by deal_id) x on x.deal_id = d.id
      where d.kind <> 'announcement' group by d.tenant_id, t.display_name order by revenue_cents desc nulls last limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ tenantId: String(r.tenant_id), tenant: r.tenant ?? null, active: n(r.active), redemptions: n(r.redemptions), revenueCents: n(r.revenue_cents), lastActivity: iso(r.last_activity) }));
  }

  async exceptionCandidates(limit: number): Promise<OfferFacts[]> {
    const rows: any[] = await sql`
      select d.id, d.title, t.display_name as tenant, ${OUT} as status, d.starts_at, d.ends_at, d.tenant_id, d.branch_id
      from deals d left join tenants t on t.id = d.tenant_id where d.kind <> 'announcement' order by d.updated_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ id: String(r.id), name: r.title ?? null, tenant: r.tenant ?? null, status: r.status, startAt: iso(r.starts_at), endAt: iso(r.ends_at), branchId: r.branch_id ? String(r.branch_id) : null, tenantId: r.tenant_id ? String(r.tenant_id) : null, revenueCents: 0 }));
  }

  async bottomTotals(): Promise<BottomTotals> {
    const r: any = await sql`select coalesce(count(*) filter (where redeemed_at::date = current_date),0)::bigint as redemptions_today,
        coalesce(sum(paid_cents) filter (where redeemed_at::date = current_date),0)::bigint as revenue_today from (${REDEEMED}) x`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    const p: any = await sql`select count(*) filter (where created_at::date = current_date)::int as new_offers from deals where kind <> 'announcement'`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { redemptionsToday: n(r?.redemptions_today), revenueTodayCents: n(r?.revenue_today), newOffersToday: n(p?.new_offers) };
  }
}
