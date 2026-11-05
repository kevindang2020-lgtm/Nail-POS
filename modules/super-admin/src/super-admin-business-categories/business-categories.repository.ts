import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface BizCategory {
  id: string; name: string; slug: string; description: string | null; icon: string | null;
  sortOrder: number; active: boolean; isDefault: boolean; createdAt: string; updatedAt: string;
}
export interface NewCategory { name: string; slug: string; description?: string | null; icon?: string | null; sortOrder: number; createdBy: string | null; }

export interface BizCategoriesRepo {
  list(includeInactive: boolean): Promise<BizCategory[]>;
  get(id: string): Promise<BizCategory | null>;
  findBySlug(slug: string): Promise<BizCategory | null>;
  insert(c: NewCategory): Promise<BizCategory>;
  update(id: string, patch: Partial<Pick<BizCategory, 'name' | 'description' | 'icon' | 'active' | 'sortOrder'>>): Promise<BizCategory | null>;
  reorder(pairs: { id: string; sortOrder: number }[]): Promise<void>;
  counts(): Promise<{ active: number; total: number }>;
}

const iso = (x: any) => (x == null ? null : x instanceof Date ? x.toISOString() : String(x));
function map(r: any): BizCategory {
  return { id: r.id, name: r.name, slug: r.slug, description: r.description ?? null, icon: r.icon ?? null, sortOrder: r.sort_order ?? 0, active: !!r.active, isDefault: !!r.is_default, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! };
}

export class KyselyBizCategoriesRepo implements BizCategoriesRepo {
  constructor(private readonly db: Kysely<DB>) {}
  private get t() { return this.db as any; }
  async list(includeInactive: boolean): Promise<BizCategory[]> {
    let q = this.t.selectFrom('business_categories').selectAll();
    if (!includeInactive) q = q.where('active', '=', true);
    const rows = await q.orderBy('sort_order', 'asc').orderBy('name', 'asc').execute();
    return rows.map(map);
  }
  async get(id: string) { const r = await this.t.selectFrom('business_categories').selectAll().where('id', '=', id).executeTakeFirst(); return r ? map(r) : null; }
  async findBySlug(slug: string) { const r = await this.t.selectFrom('business_categories').selectAll().where('slug', '=', slug).executeTakeFirst(); return r ? map(r) : null; }
  async insert(c: NewCategory): Promise<BizCategory> {
    const r = await this.t.insertInto('business_categories').values({ name: c.name, slug: c.slug, description: c.description ?? null, icon: c.icon ?? null, sort_order: c.sortOrder, active: true, is_default: false, created_by: c.createdBy, created_at: new Date(), updated_at: new Date() }).returningAll().executeTakeFirst();
    return map(r);
  }
  async update(id: string, patch: any): Promise<BizCategory | null> {
    const set: any = { updated_at: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.sortOrder !== undefined) set.sort_order = patch.sortOrder;
    const r = await this.t.updateTable('business_categories').set(set).where('id', '=', id).returningAll().executeTakeFirst();
    return r ? map(r) : null;
  }
  async reorder(pairs: { id: string; sortOrder: number }[]): Promise<void> {
    await this.db.transaction().execute(async (trx: any) => { for (const p of pairs) await trx.updateTable('business_categories').set({ sort_order: p.sortOrder, updated_at: new Date() }).where('id', '=', p.id).execute(); });
  }
  async counts(): Promise<{ active: number; total: number }> {
    const r: any = await this.t.selectFrom('business_categories').select([sql<number>`count(*)::int`.as('total'), sql<number>`count(*) filter (where active)::int`.as('active')]).executeTakeFirst();
    return { active: Number(r?.active || 0), total: Number(r?.total || 0) };
  }
}

export class InMemoryBizCategoriesRepo implements BizCategoriesRepo {
  private rows: BizCategory[] = [];
  seed(rows: BizCategory[]) { this.rows = rows; }
  async list(includeInactive: boolean) { return this.rows.filter((r) => includeInactive || r.active).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)); }
  async get(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async findBySlug(slug: string) { return this.rows.find((r) => r.slug === slug) || null; }
  async insert(c: NewCategory) { const v: BizCategory = { id: 'bc_' + (this.rows.length + 1), name: c.name, slug: c.slug, description: c.description ?? null, icon: c.icon ?? null, sortOrder: c.sortOrder, active: true, isDefault: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; this.rows.push(v); return v; }
  async update(id: string, patch: any) { const v = this.rows.find((r) => r.id === id); if (!v) return null; if (patch.name !== undefined) v.name = patch.name; if (patch.description !== undefined) v.description = patch.description; if (patch.icon !== undefined) v.icon = patch.icon; if (patch.active !== undefined) v.active = patch.active; if (patch.sortOrder !== undefined) v.sortOrder = patch.sortOrder; return v; }
  async reorder(pairs: { id: string; sortOrder: number }[]) { for (const p of pairs) { const v = this.rows.find((r) => r.id === p.id); if (v) v.sortOrder = p.sortOrder; } }
  async counts() { return { active: this.rows.filter((r) => r.active).length, total: this.rows.length }; }
}
