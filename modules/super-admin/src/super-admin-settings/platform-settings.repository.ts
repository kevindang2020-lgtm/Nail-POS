import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface StoredSetting {
  settingKey: string;
  settingGroup: string;
  value: unknown;
  valueType: string;
  version: number;
  changedBy: string | null;
  updatedAt: string;
}

export interface SettingChange {
  settingKey: string;
  settingGroup: string;
  previousValue: unknown;
  newValue: unknown;
  version: number;
  actor: string | null;
  actorRole: string | null;
  reason: string | null;
  source: string;
  correlationId: string | null;
  createdAt: string;
}

export interface UpsertInput {
  key: string;
  group: string;
  valueType: string;
  value: unknown;
  expectedVersion: number; // 0 means "not yet stored"
  changedBy: string | null;
  isMandatory: boolean;
  isSensitive: boolean;
  policy: string;
}

export interface PlatformSettingsRepo {
  listStored(): Promise<StoredSetting[]>;
  getStored(key: string): Promise<StoredSetting | null>;
  /** Optimistic upsert. Applies only if the stored version equals expectedVersion (or 0 when absent). Returns the new row, or null on a version conflict. */
  upsertIfVersion(input: UpsertInput): Promise<StoredSetting | null>;
  recordChange(change: Omit<SettingChange, 'createdAt'>): Promise<void>;
  /** Remove all explicit overrides so every setting falls back to its code default (Reset to Defaults). */
  clearStored(): Promise<number>;
  listChanges(limit: number): Promise<SettingChange[]>;
  listChangesSince(sinceIso: string): Promise<SettingChange[]>;
  /** For the overview cards. Null when no database is available (honest — the card renders as unavailable). */
  tenantCounts(): Promise<{ active: number; total: number; newThisMonth: number } | null>;
  dbHealthy(): Promise<boolean>;
  /** Tenant counts grouped by locale (NULL = inherits platform default). Null when no database is available. */
  localeDistribution(): Promise<{ locale: string | null; count: number }[] | null>;
  /** Default-adoption counts: total tenants + tenants that have overridden at least one settings category. */
  adoptionCounts(): Promise<{ totalTenants: number; overriddenTenants: number } | null>;
}

function mapRow(r: any): StoredSetting {
  return {
    settingKey: r.setting_key,
    settingGroup: r.setting_group,
    value: r.value,
    valueType: r.value_type,
    version: Number(r.version),
    changedBy: r.changed_by ?? null,
    updatedAt: (r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)),
  };
}
function mapChange(r: any): SettingChange {
  return {
    settingKey: r.setting_key, settingGroup: r.setting_group,
    previousValue: r.previous_value ?? null, newValue: r.new_value ?? null,
    version: Number(r.version), actor: r.actor ?? null, actorRole: r.actor_role ?? null,
    reason: r.reason ?? null, source: r.source, correlationId: r.correlation_id ?? null,
    createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
  };
}

export class KyselyPlatformSettingsRepo implements PlatformSettingsRepo {
  constructor(private readonly db: Kysely<DB>) {}
  private get t() { return this.db as any; }

  async listStored(): Promise<StoredSetting[]> {
    const rows = await this.t.selectFrom('platform_settings').selectAll().execute();
    return rows.map(mapRow);
  }
  async getStored(key: string): Promise<StoredSetting | null> {
    const r = await this.t.selectFrom('platform_settings').selectAll().where('setting_key', '=', key).executeTakeFirst();
    return r ? mapRow(r) : null;
  }
  async upsertIfVersion(i: UpsertInput): Promise<StoredSetting | null> {
    const existing = await this.t.selectFrom('platform_settings').selectAll().where('setting_key', '=', i.key).executeTakeFirst();
    const valueJson = sql`${JSON.stringify(i.value ?? null)}::jsonb`;
    if (!existing) {
      if (i.expectedVersion !== 0) return null; // created concurrently
      const r = await this.t.insertInto('platform_settings').values({
        setting_key: i.key, setting_group: i.group, value: valueJson, value_type: i.valueType, version: 1,
        override_policy: i.policy, is_mandatory: i.isMandatory, is_sensitive: i.isSensitive, changed_by: i.changedBy,
        effective_from: new Date(), created_at: new Date(), updated_at: new Date(),
      }).returningAll().executeTakeFirst();
      return r ? mapRow(r) : null;
    }
    const r = await this.t.updateTable('platform_settings').set({
      value: valueJson, value_type: i.valueType, version: Number(existing.version) + 1,
      override_policy: i.policy, is_mandatory: i.isMandatory, is_sensitive: i.isSensitive, changed_by: i.changedBy, updated_at: new Date(),
    }).where('setting_key', '=', i.key).where('version', '=', i.expectedVersion).returningAll().executeTakeFirst();
    return r ? mapRow(r) : null;
  }
  async recordChange(c: Omit<SettingChange, 'createdAt'>): Promise<void> {
    await this.t.insertInto('platform_setting_changes').values({
      setting_key: c.settingKey, setting_group: c.settingGroup,
      previous_value: sql`${JSON.stringify(c.previousValue ?? null)}::jsonb`, new_value: sql`${JSON.stringify(c.newValue ?? null)}::jsonb`,
      version: c.version, actor: c.actor, actor_role: c.actorRole, reason: c.reason, source: c.source, correlation_id: c.correlationId, created_at: new Date(),
    }).execute();
  }
  async clearStored(): Promise<number> { const r: any = await this.t.deleteFrom('platform_settings').executeTakeFirst(); return Number(r?.numDeletedRows ?? 0); }
  async listChanges(limit: number): Promise<SettingChange[]> {
    const rows = await this.t.selectFrom('platform_setting_changes').selectAll().orderBy('created_at', 'desc').limit(limit).execute();
    return rows.map(mapChange);
  }
  async listChangesSince(sinceIso: string): Promise<SettingChange[]> {
    const rows = await this.t.selectFrom('platform_setting_changes').selectAll().where('created_at', '>=', new Date(sinceIso)).orderBy('created_at', 'desc').execute();
    return rows.map(mapChange);
  }
  async tenantCounts(): Promise<{ active: number; total: number; newThisMonth: number } | null> {
    try {
      const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
      const row: any = await this.t.selectFrom('tenants')
        .select([
          sql<number>`count(*)::int`.as('total'),
          sql<number>`count(*) filter (where status = 'active')::int`.as('active'),
          sql<number>`count(*) filter (where created_at >= ${monthStart})::int`.as('new_this_month'),
        ]).executeTakeFirst();
      if (!row) return null;
      return { active: Number(row.active || 0), total: Number(row.total || 0), newThisMonth: Number(row.new_this_month || 0) };
    } catch { return null; }
  }
  async dbHealthy(): Promise<boolean> {
    try { await sql`select 1`.execute(this.db); return true; } catch { return false; }
  }
  async localeDistribution(): Promise<{ locale: string | null; count: number }[] | null> {
    try {
      const rows: any[] = await this.t.selectFrom('tenants').select(['locale', sql<number>`count(*)::int`.as('count')]).where('status', '<>', 'cancelled').groupBy('locale').execute();
      return rows.map((r) => ({ locale: r.locale ?? null, count: Number(r.count || 0) }));
    } catch { return null; }
  }
  async adoptionCounts(): Promise<{ totalTenants: number; overriddenTenants: number } | null> {
    try {
      const t: any = await this.t.selectFrom('tenants').select(sql<number>`count(*) filter (where status <> 'cancelled')::int`.as('total')).executeTakeFirst();
      const o: any = await this.t.selectFrom('tenant_settings').select(sql<number>`count(distinct tenant_id)::int`.as('overridden')).executeTakeFirst();
      return { totalTenants: Number(t?.total || 0), overriddenTenants: Number(o?.overridden || 0) };
    } catch { return null; }
  }
}

export class InMemoryPlatformSettingsRepo implements PlatformSettingsRepo {
  private rows = new Map<string, StoredSetting & { policy: string }>();
  private changes: SettingChange[] = [];

  async listStored(): Promise<StoredSetting[]> { return [...this.rows.values()].map(({ policy, ...s }) => { void policy; return s; }); }
  async getStored(key: string): Promise<StoredSetting | null> { const r = this.rows.get(key); return r ? { ...r } : null; }
  async upsertIfVersion(i: UpsertInput): Promise<StoredSetting | null> {
    const existing = this.rows.get(i.key);
    if (!existing) {
      if (i.expectedVersion !== 0) return null;
      const row = { settingKey: i.key, settingGroup: i.group, value: i.value, valueType: i.valueType, version: 1, changedBy: i.changedBy, updatedAt: new Date().toISOString(), policy: i.policy };
      this.rows.set(i.key, row);
      return { ...row };
    }
    if (existing.version !== i.expectedVersion) return null;
    const row = { ...existing, value: i.value, valueType: i.valueType, version: existing.version + 1, changedBy: i.changedBy, updatedAt: new Date().toISOString(), policy: i.policy };
    this.rows.set(i.key, row);
    return { ...row };
  }
  async recordChange(c: Omit<SettingChange, 'createdAt'>): Promise<void> { this.changes.push({ ...c, createdAt: new Date().toISOString() }); }
  async clearStored(): Promise<number> { const n = this.rows.size; this.rows.clear(); return n; }
  async listChanges(limit: number): Promise<SettingChange[]> { return this.changes.slice().reverse().slice(0, limit); }
  async listChangesSince(sinceIso: string): Promise<SettingChange[]> { return this.changes.filter((c) => c.createdAt >= sinceIso).reverse(); }
  async tenantCounts(): Promise<{ active: number; total: number; newThisMonth: number } | null> { return null; } // no DB → honest unavailable
  async dbHealthy(): Promise<boolean> { return true; }
  private localeDist: { locale: string | null; count: number }[] | null = null;
  seedLocaleDistribution(d: { locale: string | null; count: number }[] | null) { this.localeDist = d; }
  async localeDistribution(): Promise<{ locale: string | null; count: number }[] | null> { return this.localeDist; }
  private adoption: { totalTenants: number; overriddenTenants: number } | null = null;
  seedAdoption(a: { totalTenants: number; overriddenTenants: number } | null) { this.adoption = a; }
  async adoptionCounts(): Promise<{ totalTenants: number; overriddenTenants: number } | null> { return this.adoption; }
}
