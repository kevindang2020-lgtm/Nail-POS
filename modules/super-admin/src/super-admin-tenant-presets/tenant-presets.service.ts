import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TenantPresetsRepo, TenantPreset } from './tenant-presets.repository';
import { isPresetScope, validatePresetName, sanitizeSettings, settingsCount, PRESET_SCOPES, SCOPE_LABEL, type PresetScope } from './tenant-preset-core';

export class PresetError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); this.name = 'PresetError'; } }
export interface AdminCtx { userId?: string; email?: string; role?: string; ip?: string }

export class TenantPresetsService {
  constructor(private readonly repo: TenantPresetsRepo, private readonly db?: Kysely<DB>) {}

  private async audit(ctx: AdminCtx, action: string, entityId: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs' as any).values({ id: sql`gen_random_uuid()` as any, tenant_id: null as any, user_id: (ctx.userId || null) as any, role: 'SUPER_ADMIN', action_type: action, entity_type: 'tenant_preset', entity_id: entityId, metadata_json: JSON.stringify(meta || {}) as any } as any).execute().catch(() => {});
  }

  list(scope?: string): Promise<TenantPreset[]> { return this.repo.list(scope && isPresetScope(scope) ? scope : undefined); }

  /** The three panel rows: the default preset per scope (name + settings count), honest null when none is set. */
  async defaultsByScope(): Promise<Record<PresetScope, { id: string; name: string; count: number } | null>> {
    const out = {} as Record<PresetScope, { id: string; name: string; count: number } | null>;
    for (const s of PRESET_SCOPES) { const d = await this.repo.defaultFor(s); out[s] = d ? { id: d.id, name: d.name, count: settingsCount(d.settings) } : null; }
    return out;
  }

  /** Rows for the Default Tenant Presets table. */
  async tableRows(): Promise<{ id: string; name: string; scope: string; scopeLabel: string; category: string | null; count: number; isDefault: boolean; active: boolean; updatedAt: string }[]> {
    const all = await this.repo.list();
    return all.map((p) => ({ id: p.id, name: p.name, scope: p.scope, scopeLabel: SCOPE_LABEL[p.scope as PresetScope] || p.scope, category: p.categorySlug, count: settingsCount(p.settings), isDefault: p.isDefault, active: p.active, updatedAt: p.updatedAt }));
  }

  async get(id: string): Promise<TenantPreset> { const p = await this.repo.get(id); if (!p) throw new PresetError('not_found', 'Preset not found.'); return p; }

  async create(ctx: AdminCtx, input: { name: string; scope: string; categorySlug?: string; description?: string; settings?: unknown; makeDefault?: boolean }): Promise<TenantPreset> {
    const err = validatePresetName(input.name); if (err) throw new PresetError('invalid', err);
    if (!isPresetScope(input.scope)) throw new PresetError('invalid', `Scope must be one of: ${PRESET_SCOPES.join(', ')}.`);
    const p = await this.repo.insert({ name: input.name.trim(), scope: input.scope, categorySlug: input.categorySlug ?? null, description: input.description ?? null, settings: sanitizeSettings(input.settings), createdBy: ctx.userId ?? ctx.email ?? null });
    await this.audit(ctx, 'tenant_preset_created', p.id, { name: p.name, scope: p.scope });
    if (input.makeDefault) return this.makeDefault(ctx, p.id);
    return p;
  }

  async update(ctx: AdminCtx, id: string, patch: { name?: string; description?: string; categorySlug?: string; settings?: unknown; active?: boolean }): Promise<TenantPreset> {
    const cur = await this.repo.get(id); if (!cur) throw new PresetError('not_found', 'Preset not found.');
    const set: any = {};
    if (patch.name !== undefined) { const e = validatePresetName(patch.name); if (e) throw new PresetError('invalid', e); set.name = patch.name.trim(); }
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.categorySlug !== undefined) set.categorySlug = patch.categorySlug;
    if (patch.settings !== undefined) set.settings = sanitizeSettings(patch.settings);
    if (patch.active !== undefined) set.active = patch.active;
    const p = await this.repo.update(id, set);
    await this.audit(ctx, 'tenant_preset_updated', id, { fields: Object.keys(set) });
    return p!;
  }

  async makeDefault(ctx: AdminCtx, id: string): Promise<TenantPreset> {
    const cur = await this.repo.get(id); if (!cur) throw new PresetError('not_found', 'Preset not found.');
    const p = await this.repo.makeDefault(id, cur.scope);
    if (!p) throw new PresetError('conflict', 'Could not set the default preset.');
    await this.audit(ctx, 'tenant_preset_set_default', id, { scope: cur.scope });
    return p;
  }
}
