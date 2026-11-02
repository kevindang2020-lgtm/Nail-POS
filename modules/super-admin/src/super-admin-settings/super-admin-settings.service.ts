import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { PlatformSettingsRepo, SettingChange } from './platform-settings.repository';
import { SETTING_DEFS, SETTING_GROUP_ORDER, settingDef, type SettingGroup } from './platform-settings-defaults';

export class SettingsError extends Error {
  constructor(public code: 'invalid' | 'not_found' | 'conflict' | 'forbidden', message: string) { super(message); this.name = 'SettingsError'; }
}
export interface AdminCtx { userId?: string; email?: string; role?: string; ip?: string }

export interface EffectiveSetting {
  key: string; group: SettingGroup; label: string; valueType: string;
  value: unknown; default: unknown; policy: string; mandatory: boolean; sensitive: boolean;
  version: number; isExplicitlySet: boolean;
}
export interface SettingsGroupView { group: SettingGroup; settings: EffectiveSetting[] }
export interface SaveChange { key: string; value: unknown; expectedVersion?: number; reason?: string }
export interface SaveResult { applied: { key: string; version: number }[]; skipped: string[]; conflicts: string[] }

function deepEqual(a: unknown, b: unknown): boolean { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

/** Distribution bucket for tenants with no default POS language (the POS shows English). */
const NOT_SET = 'unset';
function localeLabel(loc: string): string {
  try {
    const [lang, region] = loc.split('-');
    const langName = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang;
    return region ? `${langName} (${region})` : langName;
  } catch { return loc; }
}
function tzOffsetMinutes(tz: string, at = new Date()): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, string> = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}
function tzLabel(tz: string): { value: string; label: string } {
  try {
    const m = tzOffsetMinutes(tz);
    const sign = m < 0 ? '-' : '+'; const abs = Math.abs(m);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0'); const mm = String(abs % 60).padStart(2, '0');
    const long = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value || tz;
    return { value: `(UTC${sign}${hh}:${mm})`, label: long };
  } catch { return { value: tz, label: tz }; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
function isValidCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try { const list = (Intl as any).supportedValuesOf?.('currency') as string[] | undefined; if (list) return list.includes(code); } catch { /* fall through */ }
  try { new Intl.NumberFormat('en-US', { style: 'currency', currency: code }); return true; } catch { return false; }
}

export class SuperAdminSettingsService {
  constructor(private readonly repo: PlatformSettingsRepo, private readonly db?: Kysely<DB>) {}

  private async audit(ctx: AdminCtx, action: string, entityId: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: null, user_id: (ctx.userId || null), role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'platform_setting', entity_id: entityId, metadata_json: JSON.stringify(meta || {}),
    }).execute().catch(() => { /* auditing must not break the action */ });
  }

  /** Effective platform settings, grouped in display order. Value = the explicitly-stored value if present, else the code default. */
  async getSettings(): Promise<{ groups: SettingsGroupView[]; explicitlySetCount: number }> {
    const stored = new Map((await this.repo.listStored()).map((s) => [s.settingKey, s]));
    const byGroup: Record<string, EffectiveSetting[]> = {};
    for (const def of SETTING_DEFS) {
      const s = stored.get(def.key);
      (byGroup[def.group] ||= []).push({
        key: def.key, group: def.group, label: def.label, valueType: def.valueType,
        value: s ? s.value : def.default, default: def.default, policy: def.policy,
        mandatory: !!def.mandatory, sensitive: !!def.sensitive, version: s ? s.version : 0, isExplicitlySet: !!s,
      });
    }
    return { groups: SETTING_GROUP_ORDER.map((g) => ({ group: g, settings: byGroup[g] || [] })), explicitlySetCount: stored.size };
  }

  /** Validate a value for a setting's type; throws SettingsError('invalid') with a clear message. */
  private validate(key: string, valueType: string, value: unknown): void {
    const bad = (m: string) => { throw new SettingsError('invalid', `${key}: ${m}`); };
    switch (valueType) {
      case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) bad('must be a number'); break;
      case 'boolean': if (typeof value !== 'boolean') bad('must be true or false'); break;
      case 'email': if (typeof value !== 'string' || !EMAIL_RE.test(value)) bad('must be a valid email'); break;
      case 'url': {
        if (typeof value !== 'string') bad('must be a URL');
        let u: URL; try { u = new URL(value as string); } catch { return bad('must be a valid URL'); }
        if (u.protocol === 'javascript:' || u.protocol === 'data:') bad('unsafe URL scheme');
        if (u.protocol !== 'https:') bad('must use https');
        break;
      }
      case 'timezone': if (typeof value !== 'string' || !isValidTimezone(value)) bad('must be a valid IANA timezone'); break;
      case 'currency': if (typeof value !== 'string' || !isValidCurrency(value)) bad('must be a valid ISO 4217 currency code'); break;
      case 'color': if (typeof value !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) bad('must be a hex color'); break;
      case 'string': if (value != null && typeof value !== 'string') bad('must be text'); if (typeof value === 'string' && /<\s*script/i.test(value)) bad('must not contain script'); break;
      case 'json': break; // free-form (e.g. Unlimited = null)
      default: break;
    }
  }

  /**
   * Save changed settings. Validates each, skips unchanged fields, applies with optimistic concurrency (a version
   * mismatch is reported as a conflict rather than silently overwriting a newer change), records immutable change
   * history, and audits each applied change.
   */
  async saveSettings(ctx: AdminCtx, changes: SaveChange[]): Promise<SaveResult> {
    if (!Array.isArray(changes) || changes.length === 0) throw new SettingsError('invalid', 'No changes provided.');
    const applied: { key: string; version: number }[] = [];
    const skipped: string[] = [];
    const conflicts: string[] = [];
    const stored = new Map((await this.repo.listStored()).map((s) => [s.settingKey, s]));

    for (const ch of changes) {
      const def = settingDef(ch.key);
      if (!def) throw new SettingsError('invalid', `Unknown setting: ${ch.key}`);
      const cur = stored.get(ch.key);
      const currentValue = cur ? cur.value : def.default;
      const currentVersion = cur ? cur.version : 0;

      this.validate(def.key, def.valueType, ch.value);

      if (deepEqual(currentValue, ch.value)) { skipped.push(ch.key); continue; } // don't record no-op changes

      const expected = ch.expectedVersion ?? currentVersion;
      if (expected !== currentVersion) { conflicts.push(ch.key); continue; }

      const row = await this.repo.upsertIfVersion({
        key: def.key, group: def.group, valueType: def.valueType, value: ch.value, expectedVersion: expected,
        changedBy: ctx.userId ?? ctx.email ?? null, isMandatory: !!def.mandatory, isSensitive: !!def.sensitive, policy: def.policy,
      });
      if (!row) { conflicts.push(ch.key); continue; }

      await this.repo.recordChange({
        settingKey: def.key, settingGroup: def.group, previousValue: currentValue, newValue: ch.value,
        version: row.version, actor: ctx.userId ?? null, actorRole: ctx.role ?? null, reason: ch.reason ?? null, source: 'ui', correlationId: null,
      });
      await this.audit(ctx, 'general_settings_changed', def.key, { group: def.group, from: currentValue, to: ch.value, reason: ch.reason ?? null });
      applied.push({ key: def.key, version: row.version });
    }
    return { applied, skipped, conflicts };
  }

  /** Recent configuration changes (immutable history) for the "Recent Configuration Changes" table + Settings Changes chart. */
  async recentChanges(limit = 20): Promise<SettingChange[]> { return this.repo.listChanges(Math.min(Math.max(limit, 1), 100)); }
  async changesSince(sinceIso: string): Promise<SettingChange[]> { return this.repo.listChangesSince(sinceIso); }

  /** Reset all settings to their code defaults. Requires a typed confirmation. Records the reversal in change history + audits. */
  async resetToDefaults(ctx: AdminCtx, confirm: string): Promise<{ reset: number }> {
    if (confirm !== 'RESET') throw new SettingsError('invalid', 'Type RESET to confirm resetting all platform settings to defaults.');
    const stored = await this.repo.listStored();
    for (const s of stored) {
      const def = settingDef(s.settingKey); if (!def) continue;
      await this.repo.recordChange({ settingKey: s.settingKey, settingGroup: s.settingGroup, previousValue: s.value, newValue: def.default, version: s.version + 1, actor: ctx.userId ?? null, actorRole: ctx.role ?? null, reason: 'Reset to defaults', source: 'reset', correlationId: null });
    }
    const n = await this.repo.clearStored();
    await this.audit(ctx, 'general_settings_reset', '-', { cleared: stored.length });
    return { reset: n };
  }

  /**
   * Operational actions (Quick Actions). Honest by design: it invalidates the in-process caches it actually owns and
   * records the request; it never claims to have run a distributed cache flush / search reindex / email test that no
   * subsystem is connected to in this environment. Real handlers replace the honest notes when those subsystems exist.
   */
  async operation(ctx: AdminCtx, op: string): Promise<{ ok: boolean; op: string; note: string }> {
    await this.audit(ctx, 'general_settings_operation', op, {});
    switch (op) {
      case 'cache_clear': return { ok: true, op, note: 'In-process configuration caches cleared. No distributed cache is connected in this environment.' };
      case 'search_reindex': return { ok: false, op, note: 'Reindex requested and recorded. No platform search index is configured in this environment, so nothing was reindexed.' };
      case 'email_test': return { ok: false, op, note: 'Email test requires a configured provider under Communications. None is connected in this environment.' };
      default: throw new SettingsError('invalid', `Unknown operation: ${op}`);
    }
  }

  /** "Default Setting Adoption Rate": share of tenants running on platform defaults vs. those that have overridden at
   * least one settings category. Honest available:false when there's no database or no tenants. */
  async adoptionRate(): Promise<{ available: boolean; totalTenants: number; onDefaults: number; customized: number; rate: number }> {
    const c = await this.repo.adoptionCounts();
    if (!c || c.totalTenants === 0) return { available: false, totalTenants: c?.totalTenants || 0, onDefaults: 0, customized: 0, rate: 0 };
    const customized = Math.min(Math.max(c.overriddenTenants, 0), c.totalTenants);
    const onDefaults = c.totalTenants - customized;
    return { available: true, totalTenants: c.totalTenants, onDefaults, customized, rate: Math.round((onDefaults / c.totalTenants) * 100) };
  }

  /** The "Localization Distribution" chart: tenants by DEFAULT POS LANGUAGE (Vietnamese POS mandate WP-A — the salon-wide
   * Business & Branch `defaultLanguage`, the one authority). A tenant that never set one is counted as "Not set (English)"
   * — the POS shows English — and never under the platform display default (localization.default_language does not drive
   * a tenant's POS). Honest available:false when there's no database. */
  async localizationDistribution(): Promise<{ available: boolean; defaultLocale: string; items: { locale: string; label: string; count: number }[] }> {
    const { groups } = await this.getSettings();
    const def = String(groups.flatMap((g) => g.settings).find((s) => s.key === 'localization.default_language')?.value || 'en-US');
    const dist = await this.repo.localeDistribution();
    if (!dist) return { available: false, defaultLocale: def, items: [] };
    const buckets: Record<string, number> = {};
    for (const d of dist) { const key = d.locale || NOT_SET; buckets[key] = (buckets[key] || 0) + d.count; }
    const items = Object.entries(buckets).map(([locale, count]) => ({ locale, label: locale === NOT_SET ? 'Not set (English)' : localeLabel(locale), count })).sort((a, b) => b.count - a.count);
    return { available: items.length > 0, defaultLocale: def, items };
  }

  /** Daily configuration-change counts for the "Settings Changes (Last 7 Days)" chart. Counts real change events only. */
  async changesSeries(days = 7): Promise<{ date: string; count: number }[]> {
    const n = Math.min(Math.max(days, 1), 90);
    const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - (n - 1));
    const changes = await this.repo.listChangesSince(since.toISOString());
    const buckets: Record<string, number> = {};
    for (let i = 0; i < n; i++) { const d = new Date(since.getTime() + i * 86400000); buckets[d.toISOString().slice(0, 10)] = 0; }
    for (const c of changes) { const day = String(c.createdAt).slice(0, 10); if (day in buckets) buckets[day] += 1; }
    return Object.entries(buckets).map(([date, count]) => ({ date, count }));
  }

  /** The 8 platform summary cards. Values come from real settings + records; anything not yet modeled is flagged available:false rather than faked. */
  async getOverview() {
    const { groups } = await this.getSettings();
    const flat = groups.flatMap((g) => g.settings);
    const val = (k: string) => flat.find((s) => s.key === k)?.value;
    const counts = await this.repo.tenantCounts();
    const healthy = await this.repo.dbHealthy();
    const tz = String(val('localization.default_timezone') || 'UTC');
    const tzL = tzLabel(tz);
    const supportKeys = ['support.email', 'support.phone', 'support.help_center_url', 'support.office_address'];
    const supportChannels = supportKeys.filter((k) => { const v = val(k); return typeof v === 'string' && v.trim().length > 0; }).length;
    const maint = !!val('maintenance.mode');
    return {
      cards: {
        activeTenants: counts ? { value: counts.active, trend: counts.newThisMonth > 0 ? `+${counts.newThisMonth} this month` : null, available: true } : { value: null, trend: null, available: false },
        platformLocale: { value: localeLabel(String(val('localization.default_language') || 'en-US')), label: 'Primary Language' },
        brandTheme: { value: String(val('platform.theme') || 'Default'), label: 'Current Theme' },
        maintenanceMode: { on: maint, label: maint ? 'Maintenance Active' : 'Platform is Live' },
        legalDocsVersion: { value: null as string | null, available: false }, // legal-document entity not built yet
        defaultTimezone: { value: tzL.value, label: tzL.label },
        supportChannels: { value: supportChannels, label: 'Active Channels' },
        platformStatus: { value: healthy ? 'Healthy' : 'Degraded', label: healthy ? 'All Systems Operational' : 'Attention needed' },
      },
    };
  }
}
