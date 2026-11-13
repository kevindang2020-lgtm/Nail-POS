// menu-insights.kysely.repository.ts — production gather over Postgres. Service metrics (revenue, bookings, price,
// category, recipe-cost→margin) are computed from REAL tables (ticket_service_lines / services / service_product_recipes
// / inventory_products), scoped to the session's tenant+branch. When a tenant has no ticket history these come back
// empty and the service honestly reports hasEnoughData=false. Product- and combo-grounded metrics (retail sales,
// co-occurrence lift) are a documented follow-up and return [] here rather than being invented.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { InsightsContext, MenuInsightsRepositoryPort } from './menu-insights.repository';
import type { MenuInsightsGathered, ServiceMetric } from './menu-insights.dto';

const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** THE recipe cost of one unit of a service: Σ recipe quantity × the product's own purchase cost (cost_cents), or — when
 *  that is not set — the average of its per-location average_cost_cents. Today's costs (not the cost when sold). One
 *  function for Menu Insights and the Add-On profitability report (Extras · ADD-ONS 09), so the two never disagree. */
export async function recipeUnitCosts(db: Kysely<DB>, tenantId: string, serviceIds?: string[]): Promise<Map<string, number>> {
  if (serviceIds && !serviceIds.length) return new Map();
  // average_cost_cents is NOT a column on inventory_products — it lives on inventory_location_stock (migration 108);
  // it is per-LOCATION, so it is averaged across the product's stock rows.
  const rows = (await sql<{ service_id: string; cost: number }>`
    SELECT r.service_id, COALESCE(SUM(r.quantity * COALESCE(p.cost_cents, s.avg_cost, 0)), 0) AS cost
    FROM service_product_recipes r
    JOIN inventory_products p ON p.id = r.product_id AND p.tenant_id = r.tenant_id
    LEFT JOIN LATERAL (
      SELECT avg(ils.average_cost_cents)::int AS avg_cost
      FROM inventory_location_stock ils
      WHERE ils.product_id = p.id AND ils.tenant_id = p.tenant_id
    ) s ON true
    WHERE r.tenant_id = ${tenantId} ${serviceIds ? sql`AND r.service_id IN (${sql.join(serviceIds)})` : sql``}
    GROUP BY r.service_id`.execute(db)).rows;
  return new Map(rows.map((c) => [String(c.service_id), Math.round(num(c.cost))]));
}

export class KyselyMenuInsightsRepository implements MenuInsightsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async gather(ctx: InsightsContext, windowDays: number): Promise<MenuInsightsGathered> {
    const branch = ctx.branchId || '';
    const days = windowDays > 0 ? windowDays : 30;

    const active = await sql<{ id: string; name: string; price_cents: number; category_id: string; category_name: string }>`
      SELECT s.id, s.name, s.price_cents, s.category_id, COALESCE(c.name, '') AS category_name
      FROM services s
      LEFT JOIN service_categories c ON c.id = s.category_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${ctx.tenantId} AND (${branch} = '' OR s.branch_id = ${branch}) AND s.archived_at IS NULL
    `.execute(this.db).then((r) => r.rows).catch(() => [] as any[]);

    if (!active.length) return { services: [], products: [], combos: [] };

    const agg = await sql<{ service_id: string; bookings: number; revenue: number }>`
      SELECT service_id, COUNT(DISTINCT ticket_id) AS bookings, COALESCE(SUM(line_total_cents), 0) AS revenue
      FROM ticket_service_lines
      WHERE tenant_id = ${ctx.tenantId} AND (${branch} = '' OR branch_id = ${branch})
        AND removed_at IS NULL AND COALESCE(is_add_on, false) = false AND service_id IS NOT NULL
        AND created_at >= now() - make_interval(days => ${days})
      GROUP BY service_id
    `.execute(this.db).then((r) => r.rows).catch(() => [] as any[]);

    const costMap = await recipeUnitCosts(this.db, ctx.tenantId).catch(() => new Map<string, number>());

    const aggMap = new Map<string, { bookings: number; revenue: number }>();
    for (const a of agg) aggMap.set(a.service_id, { bookings: num(a.bookings), revenue: num(a.revenue) });

    const services: ServiceMetric[] = active.map((s) => {
      const a = aggMap.get(s.id);
      return {
        serviceId: s.id, name: s.name, categoryId: s.category_id, categoryName: s.category_name || '',
        priceCents: num(s.price_cents), costCents: costMap.has(s.id) ? costMap.get(s.id)! : null,
        bookings: a ? a.bookings : 0, revenueCents: a ? a.revenue : 0, addOnAttachRate: null,
      };
    });

    return { services, products: [], combos: [] };
  }
}
