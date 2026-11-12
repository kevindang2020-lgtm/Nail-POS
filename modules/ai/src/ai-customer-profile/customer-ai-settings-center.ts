// customer-ai-settings-center.ts — Customer AI Settings guide (Nov 1 2026): `/pos/customer-ai-settings/*`.
//
// The settings stay where they were: ai_customer_profile_settings (tenant / branch / user layers over the code defaults,
// merged by the ONE resolver, resolveSettings — the same one the assistant, Customer Intelligence, Churn Watch, Rebooking
// and Service Recommendations read). This center adds what the screen could not show or protect:
//   • provenance — each threshold's effective value, the code default, and which layer set it;
//   • two independent questions kept apart — the NUMBERS, and whether the assistant can RUN (salon switch, branch / user
//     switches, the package's Super Admin global switch and the subscription, via the AI entitlement gate's own rules);
//   • propagation — whether the last evaluations (Customer Intelligence → Churn Watch + Rebooking; Service Recommendations)
//     used the current values, or are pending a Refresh;
//   • safe writes — salon-level only, permission-gated (the existing manage permission), version-checked, append-only
//     history (ai_customer_profile_settings_events) + fail-closed audit in the same transaction; then the assistant's cache
//     is invalidated. A threshold change never re-evaluates customers synchronously and never books, texts or bills.
//   • a read-only impact preview and a read-only health check.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { RetentionRepository, isUuid, salonPresetRange, VISIT_TICKET_STATUSES, type RetentionContext } from '@aipowersalon/customers';
import { DEFAULT_TUNABLES, type ProfileTunables } from './ai-customer-profile-core';
import { resolveSettings, PLATFORM_DEFAULTS, type ProfileSettingsLayer } from './ai-customer-profile-settings';
import { CI_RULE_VERSION } from './customer-intelligence-center';
import { SR_RULE_VERSION } from './service-recommendations-center';

type Row = Record<string, any>;
export type CasCtx = RetentionContext;
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;
/** the AI entitlement gate's decision for this salon's package (allowed + reason), or null when it cannot be read */
export type EntitlementFn = (ctx: CasCtx) => Promise<{ allowed: boolean; reason: string; subscriptionStatus: string } | null>;
export class CustomerAiSettingsError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

/** the five thresholds on the screen, in screen order, with their units and accepted ranges */
export const CAS_KEYS = ['minVisitsForServicePref', 'minVisitsForTechPref', 'minVisitsForCadence', 'inactiveDays', 'longTermInactiveDays'] as const;
export type CasKey = (typeof CAS_KEYS)[number];
export const CAS_BOUNDS: Record<CasKey, { unit: 'visits' | 'days'; min: number; max: number }> = {
  minVisitsForServicePref: { unit: 'visits', min: 1, max: 20 }, minVisitsForTechPref: { unit: 'visits', min: 1, max: 20 }, minVisitsForCadence: { unit: 'visits', min: 2, max: 20 },
  inactiveDays: { unit: 'days', min: 14, max: 730 }, longTermInactiveDays: { unit: 'days', min: 30, max: 1095 },
};
export const CAS_EVENT_TYPES = ['assistant_enabled', 'assistant_disabled', 'thresholds_changed', 'thresholds_reset'] as const;
export const CAS_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const CAS_PAGE_SIZES = [10, 25, 50, 100] as const;
const LEVELS = ['tenant', 'branch', 'user'] as const;
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);
const sameJson = (a: unknown, b: unknown) => { const n = (o: unknown) => JSON.stringify(Object.keys((o ?? {}) as object).sort().map((k) => [k, (o as Record<string, unknown>)[k]])); return n(a) === n(b); };
const validNumber = (k: CasKey, v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= CAS_BOUNDS[k].min && v <= CAS_BOUNDS[k].max;

export class CustomerAiSettingsCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly entitlement: EntitlementFn, private readonly invalidate: (tenantId: string) => Promise<void>,
    private readonly enforcement: () => 'off' | 'observe' | 'enforce', private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  /** the three layers this session resolves (tenant + the session's branch + the session's user) — read fail-closed */
  private async layers(ex: Kysely<any>, ctx: CasCtx, lockTenant = false) {
    const T = ctx.tenantId;
    const rows = (await sql<Row>`select id, level, branch_id, user_id, enabled, tunables, version, updated_at, updated_by_user_id from ai_customer_profile_settings
      where tenant_id = ${T} and (level = 'tenant' or (level = 'branch' and branch_id = ${uuidOrNull(ctx.branchId)}::uuid) or (level = 'user' and user_id = ${uuidOrNull(ctx.userId)}::uuid))
      ${lockTenant ? sql`for update` : sql``}`.execute(ex)).rows;
    const by = (l: string) => rows.find((r) => r.level === l);
    const layer = (r: Row | undefined): ProfileSettingsLayer | undefined => (r ? { enabled: r.enabled ?? undefined, tunables: (r.tunables ?? undefined) as Partial<ProfileTunables> | undefined } : undefined);
    return { rows: { tenant: by('tenant'), branch: by('branch'), user: by('user') }, layers: { tenant: layer(by('tenant')), branch: layer(by('branch')), user: layer(by('user')) } };
  }

  // ── read: the effective state, its provenance, and propagation ───────────────────────────────────────────────
  async state(ctx: CasCtx) {
    const T = ctx.tenantId;
    const { rows, layers } = await this.layers(this.db, ctx);
    const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, ...layers });
    const thresholds = CAS_KEYS.map((key) => {
      // the last layer that sets a VALID value wins (resolveSettings drops invalid ones); a value that was dropped is shown
      let source: 'default' | 'tenant' | 'branch' | 'user' = 'default'; const ignored: string[] = [];
      for (const l of LEVELS) {
        const v = (layers[l]?.tunables as Record<string, unknown> | undefined)?.[key];
        if (v === undefined || v === null) continue;
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) source = l; else ignored.push(l);
      }
      return { key, value: eff.tunables[key], unit: CAS_BOUNDS[key].unit, default: DEFAULT_TUNABLES[key], source, ignoredAt: ignored, bounds: { min: CAS_BOUNDS[key].min, max: CAS_BOUNDS[key].max } };
    });
    let ent: Awaited<ReturnType<EntitlementFn>> = null; let entError = false;
    try { ent = await this.entitlement(ctx); } catch { entError = true; }
    const mode = this.enforcement();
    const subscriptionBlocks = !!ent && !ent.allowed && mode === 'enforce';
    const operational = !eff.enabled ? 'disabled' : subscriptionBlocks ? 'subscription_blocked' : entError || !ent ? 'unknown_entitlement' : 'operational';
    const ci = (await sql<Row>`select finished_at, tunables, rule_version from customer_intelligence_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(this.db)).rows[0];
    const srs = (await sql<Row>`select finished_at, tunables, rule_version from service_recommendation_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(this.db)).rows[0];
    const applied = (r: Row | undefined, version: string) => (!r ? 'never' : r.rule_version !== version ? 'pending' : sameJson(r.tunables, eff.tunables) ? 'applied' : 'pending');
    // Config Drift Alert (read-only): WHICH values the last completed evaluation used that differ from the values the resolver
    // gives now, and whether it ran under an older rule version. Churn Watch + Rebooking read Customer Intelligence's evaluation,
    // so its drift is theirs. Nothing is re-evaluated here; a Refresh on that screen is the only fix.
    const drift = (r: Row | undefined, version: string) => {
      if (!r) return null;
      const used = (r.tunables ?? {}) as Record<string, unknown>;
      const now = eff.tunables as unknown as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(now), ...Object.keys(used)])].sort()
        .filter((k) => used[k] !== now[k])
        .map((k) => ({ key: k, evaluatedValue: (used[k] ?? null) as number | null, currentValue: (now[k] ?? null) as number | null, onScreen: (CAS_KEYS as readonly string[]).includes(k) }));
      const ruleChanged = r.rule_version !== version;
      return { drifted: ruleChanged || keys.length > 0, keys, ruleVersion: { evaluated: (r.rule_version ?? null) as string | null, current: version, changed: ruleChanged } };
    };
    const last = (await sql<Row>`select e.created_at, coalesce(u.full_name, u.email) as actor from ai_customer_profile_settings_events e left join users u on u.id = e.actor_user_id and u.tenant_id = ${T}
      where e.tenant_id = ${T} order by e.created_at desc, e.id desc limit 1`.execute(this.db)).rows[0];
    const t = rows.tenant;
    return {
      assistant: {
        effectiveEnabled: eff.enabled, disabledAtLevel: eff.disabledAtLevel,
        salon: t?.enabled === false ? 'disabled' : t?.enabled === true ? 'enabled' : 'inherited',
        branchOverride: rows.branch ? (rows.branch.enabled === false ? 'disabled' : rows.branch.enabled === true ? 'enabled' : 'none') : 'none',
        userOverride: rows.user ? (rows.user.enabled === false ? 'disabled' : rows.user.enabled === true ? 'enabled' : 'none') : 'none',
        operational,
      },
      // the package's Super Admin global switch and the subscription, as the AI entitlement gate decides them
      entitlement: ent ? { allowed: ent.allowed, reason: ent.reason, subscriptionStatus: ent.subscriptionStatus, enforcement: mode } : { allowed: null, reason: entError ? 'unreadable' : 'unknown', subscriptionStatus: 'unknown', enforcement: mode },
      thresholds,
      salonRow: { version: N(t?.version ?? 0), updatedAt: iso(t?.updated_at), exists: !!t },
      lastChange: last ? { at: iso(last.created_at), by: last.actor ?? null } : null,
      propagation: {
        customerIntelligence: { state: applied(ci, CI_RULE_VERSION), lastEvaluatedAt: iso(ci?.finished_at), feeds: ['churn_watch', 'rebooking'], drift: drift(ci, CI_RULE_VERSION) },
        serviceRecommendations: { state: applied(srs, SR_RULE_VERSION), lastEvaluatedAt: iso(srs?.finished_at), drift: drift(srs, SR_RULE_VERSION) },
      },
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  // ── writes: salon level only, version-checked, history + fail-closed audit in one transaction ─────────────────
  private async write(ctx: CasCtx, b: { expectedVersion?: unknown; reason?: unknown }, change: (cur: { enabled: boolean | null; tunables: Record<string, number> }) =>
      { type: (typeof CAS_EVENT_TYPES)[number]; enabled: boolean | null; tunables: Record<string, number>; changed: string[] }, audit: AuditFn) {
    const T = ctx.tenantId;
    if (b.expectedVersion == null || !Number.isInteger(Number(b.expectedVersion))) throw new CustomerAiSettingsError('Reload the settings and try again.', 'CAS_VERSION_REQUIRED');
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 500) : null;
    const out = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('customer-ai-settings:' || ${T}))`.execute(trx);
      const cur = (await sql<Row>`select id, enabled, tunables, version from ai_customer_profile_settings where tenant_id = ${T} and level = 'tenant' and branch_id is null and user_id is null for update`.execute(trx)).rows[0];
      const curVersion = N(cur?.version ?? 0);
      if (N(b.expectedVersion) !== curVersion) throw new CustomerAiSettingsError('Someone else changed these settings. They have been reloaded.', 'CAS_STALE_VERSION', 409, { currentVersion: curVersion });
      const before = { enabled: (cur?.enabled ?? null) as boolean | null, tunables: { ...((cur?.tunables ?? {}) as Record<string, number>) } };
      const next = change(before);
      if (!next.changed.length) throw new CustomerAiSettingsError('Nothing changed.', 'CAS_NO_CHANGE', 409);
      const version = curVersion + 1;
      const tun = Object.keys(next.tunables).length ? JSON.stringify(next.tunables) : null;
      if (cur) await sql`update ai_customer_profile_settings set enabled = ${next.enabled}, tunables = ${tun}::jsonb, version = ${version}, updated_at = now(), updated_by_user_id = ${uuidOrNull(ctx.userId)}, updated_by = ${uuidOrNull(ctx.userId)}
        where tenant_id = ${T} and id = ${cur.id}`.execute(trx);
      else await sql`insert into ai_customer_profile_settings (tenant_id, level, enabled, tunables, version, updated_by_user_id, updated_by) values (${T}, 'tenant', ${next.enabled}, ${tun}::jsonb, ${version}, ${uuidOrNull(ctx.userId)}, ${uuidOrNull(ctx.userId)})`.execute(trx);
      const eventId = randomUUID();
      const after = { enabled: next.enabled, tunables: next.tunables };
      await sql`insert into ai_customer_profile_settings_events (id, tenant_id, level, event_type, before, after, changed_keys, reason, version, actor_user_id, actor_role)
        values (${eventId}, ${T}, 'tenant', ${next.type}, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${next.changed}::text[], ${reason}, ${version}, ${uuidOrNull(ctx.userId)}, ${String(ctx.role ?? '') || null})`.execute(trx);
      await audit(trx as unknown as Kysely<any>, { eventId, type: next.type, changed: next.changed, version, before, after });
      return { eventId, version };
    });
    // the assistant's cached summaries depend on these values; the evaluations pick them up on their next Refresh
    await this.invalidate(T);
    return { ...out, state: await this.state(ctx) };
  }

  /** Disable / Enable for this salon. Never touches the subscription, billing, the Super Admin switch or other salons. */
  async setAssistant(ctx: CasCtx, b: { enabled?: unknown; expectedVersion?: unknown; reason?: unknown }, audit: AuditFn) {
    if (typeof b.enabled !== 'boolean') throw new CustomerAiSettingsError('Choose Enable or Disable.', 'CAS_INVALID_VALUE');
    const want = b.enabled;
    return this.write(ctx, b, (cur) => {
      // "enabled" at the salon level is stored as inherit (null): the salon never overrides a platform or package decision
      const nextEnabled = want ? null : false;
      const isOff = cur.enabled === false;
      return { type: want ? 'assistant_enabled' : 'assistant_disabled', enabled: nextEnabled, tunables: cur.tunables, changed: isOff === !want ? [] : ['enabled'] };
    }, audit);
  }

  /** Change the salon's thresholds (validated, ordered). `reset: true` returns all five to the code defaults. */
  async setThresholds(ctx: CasCtx, b: { values?: unknown; reset?: unknown; expectedVersion?: unknown; reason?: unknown }, audit: AuditFn) {
    const reset = b.reset === true;
    const values = (b.values && typeof b.values === 'object' ? b.values : {}) as Record<string, unknown>;
    if (!reset) {
      const unknownKeys = Object.keys(values).filter((k) => !(CAS_KEYS as readonly string[]).includes(k));
      if (unknownKeys.length) throw new CustomerAiSettingsError('Unknown setting.', 'CAS_INVALID_VALUE', 400, { keys: unknownKeys });
      const bad = Object.entries(values).filter(([k, v]) => !validNumber(k as CasKey, v)).map(([k]) => k);
      if (bad.length) throw new CustomerAiSettingsError('A value is outside its allowed range.', 'CAS_OUT_OF_RANGE', 400, { keys: bad, bounds: CAS_BOUNDS });
    }
    const { layers } = await this.layers(this.db, ctx);
    return this.write(ctx, b, (cur) => {
      const tunables: Record<string, number> = { ...cur.tunables };
      if (reset) for (const k of CAS_KEYS) delete tunables[k];
      else for (const [k, v] of Object.entries(values)) tunables[k] = v as number;
      // the order is a rule of the lifecycle: long-term inactive must come after inactive (checked on the RESULT)
      const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { tunables }, branch: layers.branch, user: layers.user }).tunables;
      if (eff.longTermInactiveDays <= eff.inactiveDays) throw new CustomerAiSettingsError('"Long-term inactive after" must be later than "Inactive after".', 'CAS_ORDER', 400, { inactiveDays: eff.inactiveDays, longTermInactiveDays: eff.longTermInactiveDays });
      const changed = CAS_KEYS.filter((k) => cur.tunables[k] !== tunables[k]);
      return { type: reset ? 'thresholds_reset' : 'thresholds_changed', enabled: cur.enabled, tunables, changed };
    }, audit);
  }

  /** read-only estimate of how many authorized customers a proposed value moves across a boundary (never commits) */
  async preview(ctx: CasCtx, b: { values?: unknown }) {
    const T = ctx.tenantId;
    const values = (b.values && typeof b.values === 'object' ? b.values : {}) as Record<string, unknown>;
    const st = await this.state(ctx);
    const cur = Object.fromEntries(st.thresholds.map((x) => [x.key, x.value])) as Record<CasKey, number>;
    const out: Array<{ key: CasKey; current: number; proposed: number; affected: number | null; valid: boolean }> = [];
    // per customer: completed visits, the most-repeated service and technician counts, days since the last completed visit
    const base = sql`select c.id,
        (select count(*) from tickets t where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[])) as visits,
        (select max(n) from (select count(*) as n from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
          where l.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and l.removed_at is null and l.service_id is not null and t.status = any(${VISIT}::text[]) group by l.service_id) s) as top_service,
        (select max(n) from (select count(*) as n from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
          where l.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and l.removed_at is null and l.technician_id is not null and t.status = any(${VISIT}::text[]) group by l.technician_id) s) as top_tech,
        (select extract(day from now() - max(coalesce(t.paid_at, t.finished_at, t.created_at)))::int from tickets t where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[])) as days_since
      from customers c where c.tenant_id = ${T} and c.archived_at is null`;
    const range = (a: number, z: number) => [Math.min(a, z), Math.max(a, z)];
    for (const [k, v] of Object.entries(values)) {
      if (!(CAS_KEYS as readonly string[]).includes(k)) continue;
      const key = k as CasKey;
      if (!validNumber(key, v)) { out.push({ key, current: cur[key], proposed: Number(v), affected: null, valid: false }); continue; }
      const [lo, hi] = range(cur[key], v as number);
      const col = key === 'minVisitsForServicePref' ? sql`top_service` : key === 'minVisitsForTechPref' ? sql`top_tech` : key === 'minVisitsForCadence' ? sql`visits` : sql`days_since`;
      // visit thresholds: customers whose count sits between the two values cross the line; day thresholds: whose days since
      // the last visit do (inactiveDays only matters without a personal cadence, i.e. below the cadence minimum)
      const extra = key === 'inactiveDays' ? sql`and visits > 0 and visits < ${cur.minVisitsForCadence}` : key === 'longTermInactiveDays' ? sql`and visits > 0` : sql``;
      const n = lo === hi ? 0 : N((await sql<Row>`select count(*)::int as n from (${base}) x where ${col} >= ${lo} and ${col} < ${hi} ${extra}`.execute(this.db)).rows[0]?.n);
      out.push({ key, current: cur[key], proposed: v as number, affected: n, valid: true });
    }
    return { items: out, estimated: true, note: 'An estimate from live completed visits. Nothing is recalculated or changed until the settings are saved and the evaluations are refreshed.' };
  }

  // ── history ───────────────────────────────────────────────────────────────────────────────────────────────────
  private async period(ctx: CasCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const preset = pick(CAS_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const w = await this.ret.window(ctx, { preset: 'today' });
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today: w.today, tz: w.tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !z) throw new CustomerAiSettingsError('Choose a From and a To date.', 'CAS_INVALID_PERIOD');
      if (a > z) throw new CustomerAiSettingsError('The From date must be on or before the To date.', 'CAS_INVALID_PERIOD');
      from = a; to = z;
    } else ({ from, to } = salonPresetRange(preset, w.today)!);
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${w.tz}) as s, ((${to}::date + 1)::timestamp at time zone ${w.tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today: w.today, tz: w.tz };
  }
  async history(ctx: CasCtx, f: { q?: unknown; type?: unknown; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId;
    const pageSize = (CAS_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const where = [sql`e.tenant_id = ${T}`];
    const type = pick(CAS_EVENT_TYPES, f.type);
    if (type) where.push(sql`e.event_type = ${type}`);
    if (per.start && per.end) where.push(sql`e.created_at >= ${per.start} and e.created_at < ${per.end}`);
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      // a setting key or label word, the actor, the role, the event type, the reason or an event id
      where.push(sql`(e.event_type ilike ${like} or e.reason ilike ${like} or coalesce(e.actor_role, '') ilike ${like} or array_to_string(e.changed_keys, ' ') ilike ${like}
        or coalesce(u.full_name, '') ilike ${like} or coalesce(u.email, '') ilike ${like} or e.id::text = ${q})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`ai_customer_profile_settings_events e left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where e.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.id, e.level, e.event_type, e.changed_keys, e.before, e.after, e.reason, e.version, e.actor_role, e.created_at, coalesce(u.full_name, u.email) as actor
      from ${FROM} where e.tenant_id = ${T} and ${W} order by e.created_at desc, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.eventOut(r)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, type: type ?? null, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz } };
  }
  private eventOut(r: Row) {
    return { id: String(r.id), level: r.level, type: r.event_type, changedKeys: (r.changed_keys ?? []) as string[], before: r.before ?? {}, after: r.after ?? {}, reason: r.reason ?? null,
      version: N(r.version), actor: r.actor ?? null, role: r.actor_role ?? null, at: iso(r.created_at) };
  }
  async event(ctx: CasCtx, id: string) {
    const T = ctx.tenantId;
    if (!isUuid(`${id}`)) throw new CustomerAiSettingsError('Change not found.', 'CAS_EVENT_NOT_FOUND', 404);
    const r = (await sql<Row>`select e.id, e.level, e.event_type, e.changed_keys, e.before, e.after, e.reason, e.version, e.actor_role, e.created_at, coalesce(u.full_name, u.email) as actor
      from ai_customer_profile_settings_events e left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) throw new CustomerAiSettingsError('Change not found.', 'CAS_EVENT_NOT_FOUND', 404);
    // was the change picked up by the evaluations that ran after it?
    const ci = (await sql<Row>`select finished_at from customer_intelligence_scans where tenant_id = ${T} and status = 'completed' and finished_at >= ${r.created_at} order by started_at limit 1`.execute(this.db)).rows[0];
    const srs = (await sql<Row>`select finished_at from service_recommendation_scans where tenant_id = ${T} and status = 'completed' and finished_at >= ${r.created_at} order by started_at limit 1`.execute(this.db)).rows[0];
    return { ...this.eventOut(r), propagation: { customerIntelligence: ci ? { state: 'applied', at: iso(ci.finished_at) } : { state: 'pending', at: null },
      serviceRecommendations: srs ? { state: 'applied', at: iso(srs.finished_at) } : { state: 'pending', at: null } } };
  }

  // ── Check Customer AI System (read-only; records its own evidence; one run per salon per 30 s) ──────────────────
  async check(ctx: CasCtx) {
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from customer_ai_settings_health_runs where tenant_id = ${T} and branch_id is not distinct from ${uuidOrNull(ctx.branchId)}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; state: St; count?: number | null; detail?: Record<string, unknown> }> = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    let st: Awaited<ReturnType<CustomerAiSettingsCenter['state']>> | null = null;
    try { st = await this.state(ctx); checks.push({ key: 'settings_source', state: 'PASSED' }); }
    catch { checks.push({ key: 'settings_source', state: 'FAILED' }); }
    if (st) {
      const ignored = st.thresholds.filter((x) => x.ignoredAt.length).length;
      checks.push({ key: 'values_valid', state: ignored ? 'WARNING' : 'PASSED', count: ignored });
      const v = Object.fromEntries(st.thresholds.map((x) => [x.key, x.value])) as Record<string, number>;
      checks.push({ key: 'threshold_order', state: v.longTermInactiveDays > v.inactiveDays ? 'PASSED' : 'FAILED', detail: { inactiveDays: v.inactiveDays, longTermInactiveDays: v.longTermInactiveDays } });
      const outOfRange = CAS_KEYS.filter((k) => !validNumber(k, v[k])).length;
      checks.push({ key: 'values_in_range', state: outOfRange ? 'WARNING' : 'PASSED', count: outOfRange });
      checks.push({ key: 'assistant_state', state: st.assistant.effectiveEnabled ? 'PASSED' : 'WARNING', detail: { disabledAtLevel: st.assistant.disabledAtLevel } });
      const overrides = (st.assistant.branchOverride !== 'none' ? 1 : 0) + (st.assistant.userOverride !== 'none' ? 1 : 0) + st.thresholds.filter((x) => x.source === 'branch' || x.source === 'user').length;
      checks.push({ key: 'scoped_overrides', state: overrides ? 'WARNING' : 'PASSED', count: overrides });
      const e = st.entitlement;
      checks.push({ key: 'subscription', state: e.allowed === null ? 'UNAVAILABLE' : e.allowed ? 'PASSED' : e.enforcement === 'enforce' ? 'FAILED' : 'WARNING', detail: { reason: e.reason, enforcement: e.enforcement } });
      for (const [key, p] of [['intelligence_applied', st.propagation.customerIntelligence], ['recommendations_applied', st.propagation.serviceRecommendations]] as const)
        checks.push({ key, state: p.state === 'applied' ? 'PASSED' : p.state === 'never' ? 'INSUFFICIENT_DATA' : 'WARNING',
          detail: { lastEvaluatedAt: p.lastEvaluatedAt, driftedKeys: p.drift ? p.drift.keys.map((x) => x.key) : [], ruleVersionChanged: p.drift?.ruleVersion.changed ?? false } });
    }
    const failedScans = N((await one(sql<Row>`select
        (select count(*) from customer_intelligence_scans where tenant_id = ${T} and status = 'failed' and started_at > now() - interval '7 days')
      + (select count(*) from service_recommendation_scans where tenant_id = ${T} and status = 'failed' and started_at > now() - interval '7 days') as n`)).n);
    checks.push({ key: 'recent_evaluation_failures', state: failedScans ? 'WARNING' : 'PASSED', count: failedScans });
    const visits = N((await one(sql<Row>`select count(*)::int as n from tickets where tenant_id = ${T} and customer_id is not null and removed_at is null and status = any(${VISIT}::text[])`)).n);
    checks.push({ key: 'customer_history', state: visits ? 'PASSED' : 'INSUFFICIENT_DATA', count: visits });
    // a change written without a history row (outside this screen) cannot be explained on the History tab
    const unexplained = N((await one(sql<Row>`select count(*)::int as n from ai_customer_profile_settings s where s.tenant_id = ${T} and s.level = 'tenant'
      and not exists (select 1 from ai_customer_profile_settings_events e where e.tenant_id = s.tenant_id and e.level = 'tenant' and e.version = s.version)
      and (s.enabled is not null or s.tunables is not null)`)).n);
    checks.push({ key: 'history_complete', state: unexplained ? 'WARNING' : 'PASSED', count: unexplained });
    const cross = N((await one(sql<Row>`select count(*)::int as n from ai_customer_profile_settings_events e join users u on u.id = e.actor_user_id where e.tenant_id = ${T} and u.tenant_id <> e.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('customer-ai-settings-health:' || ${T} || ':' || coalesce(${uuidOrNull(ctx.branchId)}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into customer_ai_settings_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
