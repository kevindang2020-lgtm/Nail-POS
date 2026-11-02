// add-on-authority.ts — D1 (Oct 22 2026, Kevin: "use the recommended"; §141): the "Add-ons" CATEGORY is the one add-on
// model. A service in that category (isAddOnCategory — the one rule, @aipowersalon/api-contracts) IS an add-on of every
// main service at its branch: the kiosk, the POS walk-in / booking screens, serving and checkout already treat it so.
// The older `service_add_ons` table (migration 346) is kept — nothing is removed — and is SERVED beside the category
// rows by the readers that used to read it alone (catalog getAddOns, customer booking): one answer on every path.
import { sql, type Kysely } from 'kysely';
import { isAddOnCategory } from '@aipowersalon/api-contracts';
import type { DB } from './kysely.types';

export interface CategoryAddOn {
  /** the add-on SERVICE's id — what a ticket line / a booking names (the AI upsell adapter's contract) */
  addOnId: string; name: string; priceCents: number; durationDeltaMinutes: number; isTaxable: boolean; isActive: boolean;
  /** where the row comes from: the category (the authority) or the legacy table (kept, served) */
  source: 'category' | 'legacy_table';
}

/** Every active service in an "Add-ons" category at the SAME branch as `serviceId` (the main service), as add-on rows.
 *  Empty when the service is unknown to this tenant. Reads only; the category name rule decides, never a hard-coded "Add-on". */
export async function categoryAddOnsForService(db: Kysely<DB>, tenantId: string, serviceId: string): Promise<CategoryAddOn[]> {
  const main = await db.selectFrom('services').select(['branch_id', 'category_id']).where('tenant_id', '=', tenantId).where('id', '=', serviceId).executeTakeFirst();
  if (!main) return [];
  const mainBranch = String(main.branch_id), mainCategory = main.category_id == null ? '__' : String(main.category_id);
  const rows: any[] = await db.selectFrom('services as s').innerJoin('service_categories as c', 'c.id', 's.category_id')
    .select(['s.id', 's.name', 's.price_cents', 's.duration_minutes', 's.status', 's.category_id', 'c.name as category_name'])
    .where('s.tenant_id', '=', tenantId).where('s.branch_id', '=', mainBranch).where('s.id', '<>', serviceId)
    .where(sql`coalesce(s.status, 'active')`, '<>', 'archived')
    .orderBy('s.name').execute();
  return rows.filter((r) => isAddOnCategory(r.category_name) && String(r.category_id ?? '') !== mainCategory)
    .map((r) => ({ addOnId: String(r.id), name: String(r.name), priceCents: Number(r.price_cents || 0), durationDeltaMinutes: Number(r.duration_minutes || 0),
      isTaxable: true, isActive: String(r.status ?? 'active') === 'active', source: 'category' as const }));
}

/** The category rows (authority) first, then the legacy table rows that do not name one of them. */
export function mergeAddOnRows(category: CategoryAddOn[], legacy: Omit<CategoryAddOn, 'source'>[]): CategoryAddOn[] {
  const seen = new Set(category.map((a) => a.addOnId));
  return [...category, ...legacy.filter((l) => !seen.has(l.addOnId)).map((l) => ({ ...l, source: 'legacy_table' as const }))];
}
