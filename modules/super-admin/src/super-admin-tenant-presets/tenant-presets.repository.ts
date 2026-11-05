import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface TenantPreset {
  id: string; name: string; scope: string; categorySlug: string | null; description: string | null;
  settings: Record<string, unknown>; active: boolean; isDefault: boolean; createdAt: string; updatedAt: string;
}
export interface NewPreset { name: string; scope: string; categorySlug?: string | null; description?: string | null; settings: Record<string, unknown>; createdBy: string | null; }

export interface TenantPresetsRepo {
  list(scope?: string): Promise<TenantPreset[]>;
  get(id: string): Promise<TenantPreset | null>;
  defaultFor(scope: string): Promise<TenantPreset | null>;
  insert(p: NewPreset): Promise<TenantPreset>;
  update(id: string, patch: Partial<Pick<TenantPreset, 'name' | 'description' | 'categorySlug' | 'settings' | 'active'>>): Promise<TenantPreset | null>;
  /** Make this preset the single default for its scope (transactionally clears any other default for that scope). */
  makeDefault(id: string, scope: string): Promise<TenantPreset | null>;
}

const iso = (x: any) => (x == null ? null : x instanceof Date ? x.toISOString() : String(x));
const obj = (x: any): Record<string, unknown> => { if (x && typeof x === 'object' && !Array.isArray(x)) return x; try { const p = JSON.parse(x); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; } };
function map(r: any): TenantPreset {
  return { id: r.id, name: r.name, scope: r.scope, categorySlug: r.category_slug ?? null, description: r.description ?? null, settings: obj(r.settings), active: !!r.active, isDefault: !!r.is_default, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! };
}

export class KyselyTenantPresetsRepo implements TenantPresetsRepo {
  constructor(private readonly db: Kysely<DB>) {}
  private get t() { return this.db as any; }
  async list(scope?: string): Promise<TenantPreset[]> { let q = this.t.selectFrom('tenant_presets').selectAll(); if (scope) q = q.where('scope', '=', scope); const rows = await q.orderBy('scope', 'asc').orderBy('name', 'asc').execute(); return rows.map(map); }
  async get(id: string) { const r = await this.t.selectFrom('tenant_presets').selectAll().where('id', '=', id).executeTakeFirst(); return r ? map(r) : null; }
  async defaultFor(scope: string) { const r = await this.t.selectFrom('tenant_presets').selectAll().where('scope', '=', scope).where('is_default', '=', true).executeTakeFirst(); return r ? map(r) : null; }
  async insert(p: NewPreset): Promise<TenantPreset> {
    const r = await this.t.insertInto('tenant_presets').values({ name: p.name, scope: p.scope, category_slug: p.categorySlug ?? null, description: p.description ?? null, settings: JSON.stringify(p.settings || {}), active: true, is_default: false, created_by: p.createdBy, created_at: new Date(), updated_at: new Date() }).returningAll().executeTakeFirst();
    return map(r);
  }
  async update(id: string, patch: any): Promise<TenantPreset | null> {
    const set: any = { updated_at: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.categorySlug !== undefined) set.category_slug = patch.categorySlug;
    if (patch.settings !== undefined) set.settings = JSON.stringify(patch.settings);
    if (patch.active !== undefined) set.active = patch.active;
    const r = await this.t.updateTable('tenant_presets').set(set).where('id', '=', id).returningAll().executeTakeFirst();
    return r ? map(r) : null;
  }
  async makeDefault(id: string, scope: string): Promise<TenantPreset | null> {
    return await this.db.transaction().execute(async (trx: any) => {
      await trx.updateTable('tenant_presets').set({ is_default: false, updated_at: new Date() }).where('scope', '=', scope).where('is_default', '=', true).execute();
      const r = await trx.updateTable('tenant_presets').set({ is_default: true, active: true, updated_at: new Date() }).where('id', '=', id).returningAll().executeTakeFirst();
      return r ? map(r) : null;
    });
  }
}

export class InMemoryTenantPresetsRepo implements TenantPresetsRepo {
  private rows: TenantPreset[] = [];
  async list(scope?: string) { return this.rows.filter((r) => !scope || r.scope === scope).slice().sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name)); }
  async get(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async defaultFor(scope: string) { return this.rows.find((r) => r.scope === scope && r.isDefault) || null; }
  async insert(p: NewPreset) { const v: TenantPreset = { id: 'tp_' + (this.rows.length + 1), name: p.name, scope: p.scope, categorySlug: p.categorySlug ?? null, description: p.description ?? null, settings: p.settings || {}, active: true, isDefault: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; this.rows.push(v); return v; }
  async update(id: string, patch: any) { const v = this.rows.find((r) => r.id === id); if (!v) return null; if (patch.name !== undefined) v.name = patch.name; if (patch.description !== undefined) v.description = patch.description; if (patch.categorySlug !== undefined) v.categorySlug = patch.categorySlug; if (patch.settings !== undefined) v.settings = patch.settings; if (patch.active !== undefined) v.active = patch.active; return v; }
  async makeDefault(id: string, scope: string) { const v = this.rows.find((r) => r.id === id); if (!v) return null; for (const r of this.rows) if (r.scope === scope) r.isDefault = false; v.isDefault = true; v.active = true; return v; }
}
