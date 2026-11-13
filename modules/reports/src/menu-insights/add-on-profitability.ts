// add-on-profitability.ts — Extras · ADD-ONS 09 "Service profitability context: optional authorized reporting on sold add-ons
// and consumed recipe cost with clearly defined basis".
//
// Basis (returned with every answer, so the screen states it):
//   • window   the last N salon-local days (branch time zone), by the day the ticket was PAID;
//   • revenue  the add-on lines' line totals on paid tickets (a removed line, a removed ticket, and a fully refunded or
//              voided ticket are left out);
//   • cost     units sold × THE recipe unit cost of the add-on's catalog service (recipeUnitCosts — the same function Menu
//              Insights uses: Σ recipe quantity × the product's own cost, or its location average). TODAY's product
//              costs, not the stock movements of those visits;
//   • contribution = revenue − recipe cost, BEFORE commission, tax and labor.
// An add-on with no recipe (or a line with no catalog service) has no cost figure — null ("—"), never a guessed 0 — and its
// revenue is kept out of the costed totals. Authorized only (inventory.cost.view). Read only: nothing is written.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { tenantTimeZone } from '@aipowersalon/database';
import type { AddOnProfitabilityItem, AddOnProfitabilityResponse } from '@aipowersalon/api-contracts/tenant';
import { recipeUnitCosts } from './menu-insights.kysely.repository';

export const ADD_ON_PROFIT_WINDOWS = [7, 30, 90, 365] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);

/** PURE: one group's figures from its sales and the recipe unit cost (null = no recipe). */
export function addOnProfitRow(g: { key: string; serviceId: string | null; name: string; units: number; tickets: number; revenue: number }, unitCost: number | null): AddOnProfitabilityItem {
  const cost = unitCost == null ? null : unitCost * g.units;
  return { key: g.key, serviceId: g.serviceId, name: g.name, unitsSold: g.units, ticketCount: g.tickets, revenueCents: g.revenue,
    recipeUnitCostCents: unitCost, recipeCostCents: cost, contributionCents: cost == null ? null : g.revenue - cost };
}

export class AddOnProfitabilityReport {
  constructor(private readonly db: Kysely<DB>) {}

  async report(ctx: { tenantId: string; branchId?: string | null }, f: { days?: unknown; page?: unknown; pageSize?: unknown }): Promise<AddOnProfitabilityResponse> {
    const T = ctx.tenantId;
    const days = (ADD_ON_PROFIT_WINDOWS as readonly number[]).includes(Math.trunc(Number(f.days))) ? Math.trunc(Number(f.days)) : 30;
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10));
    const B = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
    const tz = await tenantTimeZone(this.db as never, T);
    const from = (await sql<{ f: Date }>`select ((((now() at time zone ${tz})::date) - ${days - 1}::int)::timestamp at time zone ${tz}) as f`.execute(this.db)).rows[0]!.f;
    const groups = (await sql<{ key: string; service_id: string | null; name: string; units: number; tickets: number; revenue: number }>`
      select coalesce(l.service_id::text, 'name:' || lower(btrim(l.service_name_snapshot))) as key, l.service_id, max(l.service_name_snapshot) as name,
        coalesce(sum(greatest(coalesce(l.quantity, 1), 1)), 0)::int as units, count(distinct l.ticket_id)::int as tickets, coalesce(sum(l.line_total_cents), 0)::bigint as revenue
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.removed_at is null and t.removed_at is null and (coalesce(l.is_add_on, false) or lower(coalesce(l.line_kind, '')) = 'add_on')
        and t.paid_at is not null and t.paid_at >= ${from} and t.status not in ('refunded', 'voided', 'void', 'cancelled')
        and (${B}::uuid is null or t.branch_id = ${B}::uuid)
      group by 1, 2`.execute(this.db)).rows;
    const ids = [...new Set(groups.map((g) => g.service_id).filter((x): x is string => !!x).map(String))];
    const costs = await recipeUnitCosts(this.db, T, ids);
    const all = groups.map((g) => addOnProfitRow({ key: String(g.key), serviceId: g.service_id ? String(g.service_id) : null, name: String(g.name ?? ''), units: N(g.units), tickets: N(g.tickets), revenue: N(g.revenue) },
      g.service_id && costs.has(String(g.service_id)) ? costs.get(String(g.service_id))! : null))
      .sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    const costed = all.filter((x) => x.recipeCostCents != null);
    const totalItems = all.length; const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(Math.max(1, Math.trunc(Number(f.page)) || 1), totalPages);
    return {
      window: { days, from: new Date(from).toISOString(), timeZone: tz },
      basis: { revenue: 'paid_tickets_line_totals', cost: 'recipe_at_current_product_cost', excludes: ['commission', 'tax', 'labor', 'refunded_or_voided_tickets'] },
      totals: { unitsSold: all.reduce((n, x) => n + x.unitsSold, 0), revenueCents: all.reduce((n, x) => n + x.revenueCents, 0),
        costedRevenueCents: costed.reduce((n, x) => n + x.revenueCents, 0), recipeCostCents: costed.reduce((n, x) => n + (x.recipeCostCents ?? 0), 0),
        contributionCents: costed.reduce((n, x) => n + (x.contributionCents ?? 0), 0), addOnsWithoutRecipe: totalItems - costed.length },
      items: all.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalItems, totalPages,
    };
  }
}
