// reputation-settings-center.ts — Review & Reputation Settings guide (Nov 1 2026): `/pos/reputation-settings/*`.
//
// The settings stay where they were: tenant_ai_reputation_settings (tenant / branch layers over PLATFORM_DEFAULTS, merged by
// the ONE resolver, resolveSettings — the same one AI drafting and the checkout review-request hook read live on every call,
// so there is no cache to go stale). This center adds what the screen could not show or protect:
//   • provenance — each of the eight controls' effective value, the platform default, and which layer set it;
//   • the assistant's operational state apart from the switch: salon / branch switch, the package's Super Admin switch and
//     the subscription (the AI entitlement gate's own rules), the salon's SMS sender, review providers;
//   • the TRUTH about what runs: approval is always enforced (a reply is published only from an approved draft);
//     nothing calls the automatic-reply path, nothing sends scheduled review requests, and no reminder sender exists —
//     the screen says so instead of implying it;
//   • safe writes — salon level only, the existing manage permission, validated, version-checked, the
//     approval-vs-automatic-reply conflict refused, ONE transaction writing the row, the (now append-only) history log
//     ai_reputation_config_versions and a fail-closed audit; the old write merged nothing and swallowed every error;
//   • a read-only health check. Nothing here publishes, approves, sends a message, charges or changes a subscription.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { RetentionRepository, isUuid, salonPresetRange, type RetentionContext } from '@aipowersalon/customers';
import { resolveSettings, PLATFORM_DEFAULTS, type ReputationConfig, type SettingsLayer } from './ai-review-reputation-settings';

type Row = Record<string, any>;
export type RssCtx = RetentionContext;
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;
export type EntitlementFn = (ctx: RssCtx) => Promise<{ allowed: boolean; reason: string; subscriptionStatus: string } | null>;
export class ReputationSettingsError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

/** the eight photographed controls, in screen order */
export const RSS_KEYS = ['enabled', 'responseTone', 'approvalRequired', 'autoResponse', 'requestsEnabled', 'channel', 'delayMinutes', 'oneReminder'] as const;
export type RssKey = (typeof RSS_KEYS)[number];
export const RSS_TONES = ['professional', 'warm', 'luxury', 'friendly', 'concise', 'apologetic', 'brand'] as const;
export const RSS_CHANNELS = ['sms', 'email', 'app'] as const;
export const RSS_DELAY = { min: 0, max: 10080 } as const;
export const RSS_EVENT_TYPES = ['settings_changed', 'assistant_enabled', 'assistant_disabled'] as const;
export const RSS_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const RSS_PAGE_SIZES = [10, 25, 50, 100] as const;
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const REVIEW_PROVIDERS = ['google_business_profile', 'facebook_pages', 'yelp'];
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);
type Cfg = Omit<Partial<ReputationConfig>, 'autoResponse' | 'reviewRequest'> & { autoResponse?: Partial<ReputationConfig['autoResponse']>; reviewRequest?: Partial<ReputationConfig['reviewRequest']> };

/** read one control out of a stored layer's config (undefined = this layer does not set it) */
function layerValue(enabled: boolean | null | undefined, cfg: Cfg | null | undefined, key: RssKey): unknown {
  switch (key) {
    case 'enabled': return enabled == null ? undefined : enabled;
    case 'responseTone': return cfg?.responseTone;
    case 'approvalRequired': return cfg?.approvalRequired;
    case 'autoResponse': return cfg?.autoResponse?.enabled;
    case 'requestsEnabled': return cfg?.reviewRequest?.enabled;
    case 'channel': return cfg?.reviewRequest?.channel === 'in_app' ? 'app' : cfg?.reviewRequest?.channel;
    case 'delayMinutes': return cfg?.reviewRequest?.delayMinutes;
    case 'oneReminder': return cfg?.reviewRequest?.oneReminder;
  }
}
function effectiveValue(eff: { enabled: boolean; config: ReputationConfig }, key: RssKey): unknown {
  const c = eff.config;
  switch (key) {
    case 'enabled': return eff.enabled;
    case 'responseTone': return c.responseTone;
    case 'approvalRequired': return c.approvalRequired !== false;
    case 'autoResponse': return !!c.autoResponse.enabled;
    case 'requestsEnabled': return !!c.reviewRequest.enabled;
    case 'channel': return c.reviewRequest.channel === 'in_app' ? 'app' : c.reviewRequest.channel;
    case 'delayMinutes': return c.reviewRequest.delayMinutes;
    case 'oneReminder': return !!c.reviewRequest.oneReminder;
  }
}
const DEFAULTS = Object.fromEntries(RSS_KEYS.map((k) => [k, effectiveValue({ enabled: true, config: PLATFORM_DEFAULTS }, k)])) as Record<RssKey, unknown>;
function validValue(key: RssKey, v: unknown): boolean {
  switch (key) {
    case 'responseTone': return typeof v === 'string' && (RSS_TONES as readonly string[]).includes(v);
    case 'channel': return typeof v === 'string' && (RSS_CHANNELS as readonly string[]).includes(v);
    case 'delayMinutes': return typeof v === 'number' && Number.isInteger(v) && v >= RSS_DELAY.min && v <= RSS_DELAY.max;
    default: return typeof v === 'boolean';
  }
}
/** write one control into a stored config (returns a new object; nested policies are merged, never replaced) */
function withValue(cfg: Cfg, key: Exclude<RssKey, 'enabled'>, v: unknown): Cfg {
  const out: Cfg = { ...cfg };
  if (key === 'responseTone') out.responseTone = v as ReputationConfig['responseTone'];
  else if (key === 'approvalRequired') out.approvalRequired = v as boolean;
  else if (key === 'autoResponse') out.autoResponse = { ...(cfg.autoResponse ?? {}), enabled: v as boolean };
  else {
    const field = key === 'requestsEnabled' ? 'enabled' : key;
    out.reviewRequest = { ...(cfg.reviewRequest ?? {}), [field]: v } as Cfg['reviewRequest'];
  }
  return out;
}

export class ReputationSettingsCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly entitlement: EntitlementFn, private readonly enforcement: () => 'off' | 'observe' | 'enforce',
    private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  /** the tenant row and the session's branch row — read fail-closed (a read error is an error, never "defaults") */
  private async layers(ex: Kysely<any>, ctx: RssCtx) {
    const rows = (await sql<Row>`select id, level, branch_id, enabled, config, version, updated_at from tenant_ai_reputation_settings
      where tenant_id = ${ctx.tenantId} and (level = 'tenant' or (level = 'branch' and branch_id = ${uuidOrNull(ctx.branchId)}::uuid))`.execute(ex)).rows;
    const tenant = rows.find((r) => r.level === 'tenant'); const branch = rows.find((r) => r.level === 'branch');
    const layer = (r: Row | undefined): SettingsLayer | undefined => (r ? { ...(r.enabled == null ? {} : { enabled: r.enabled }), ...(r.config ? { config: r.config } : {}) } : undefined);
    return { tenant, branch, layers: { tenant: layer(tenant), branch: layer(branch) } };
  }

  // ── read: effective values, provenance, operational truth ─────────────────────────────────────────────────────
  async state(ctx: RssCtx) {
    const T = ctx.tenantId;
    const { tenant, branch, layers } = await this.layers(this.db, ctx);
    const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, ...layers });
    const settings = RSS_KEYS.map((key) => {
      let source: 'default' | 'tenant' | 'branch' = 'default'; const ignoredAt: string[] = [];
      for (const [lvl, r] of [['tenant', tenant], ['branch', branch]] as const) {
        const v = layerValue(r?.enabled, r?.config as Cfg | null, key);
        if (v === undefined || v === null) continue;
        if (validValue(key, v)) source = lvl; else ignoredAt.push(lvl);
      }
      return { key, value: effectiveValue(eff, key), default: DEFAULTS[key], source, ignoredAt };
    });
    let ent: Awaited<ReturnType<EntitlementFn>> = null; let entError = false;
    try { ent = await this.entitlement(ctx); } catch { entError = true; }
    const mode = this.enforcement();
    const sms = (await sql<Row>`select status, from_number is not null as has_number, messaging_service_sid is not null as has_service, last_validated_at, last_validation_error
      from tenant_messaging_credentials where tenant_id = ${T} and provider = 'twilio' limit 1`.execute(this.db)).rows[0];
    const providers = N((await sql<Row>`select count(*)::int as n from integration_connections where tenant_id = ${T} and provider_key = any(${REVIEW_PROVIDERS}::text[]) and connection_status = 'active'`.execute(this.db)).rows[0]?.n);
    const req = (await sql<Row>`select count(*) filter (where status = 'scheduled')::int as scheduled, count(*) filter (where status = 'scheduled' and scheduled_for < now())::int as overdue,
      count(*) filter (where status in ('sent', 'delivered', 'converted'))::int as sent from review_requests where tenant_id = ${T}`.execute(this.db)).rows[0] ?? {};
    const last = (await sql<Row>`select v.created_at, coalesce(u.full_name, u.email) as actor from ai_reputation_config_versions v left join users u on u.id = v.changed_by_user_id and u.tenant_id = ${T}
      where v.tenant_id = ${T} order by v.created_at desc, v.id desc limit 1`.execute(this.db)).rows[0];
    const subscriptionBlocks = !!ent && !ent.allowed && mode === 'enforce';
    return {
      assistant: {
        effectiveEnabled: eff.enabled, disabledAtLevel: eff.disabledAtLevel,
        salon: tenant?.enabled === false ? 'disabled' : tenant?.enabled === true ? 'enabled' : 'inherited',
        branchOverride: branch ? (branch.enabled === false ? 'disabled' : branch.enabled === true ? 'enabled' : 'none') : 'none',
        operational: !eff.enabled ? 'disabled' : subscriptionBlocks ? 'subscription_blocked' : entError || !ent ? 'unknown_entitlement' : 'operational',
      },
      entitlement: ent ? { allowed: ent.allowed, reason: ent.reason, subscriptionStatus: ent.subscriptionStatus, enforcement: mode } : { allowed: null, reason: entError ? 'unreadable' : 'unknown', subscriptionStatus: 'unknown', enforcement: mode },
      settings,
      // the other stored request safeguards (not on the photographed screen; shown read-only so nothing is hidden)
      safeguards: { quietHoursStart: eff.config.reviewRequest.quietHoursStart, quietHoursEnd: eff.config.reviewRequest.quietHoursEnd, cooldownDays: eff.config.reviewRequest.cooldownDays,
        maxPerCustomerPerPeriod: eff.config.reviewRequest.maxPerCustomerPerPeriod, minVisitValueCents: eff.config.reviewRequest.minVisitValueCents },
      // what actually runs — never implied by a checkbox
      runtime: {
        approval: 'always_enforced',                                          // publish requires an approved draft, whatever the box says
        autoResponse: eff.config.autoResponse.enabled ? 'saved_not_running' : 'off',   // no job calls the automatic-reply path
        reviewRequests: { scheduling: eff.enabled && eff.config.reviewRequest.enabled ? 'on_checkout' : 'off', sender: 'not_running', scheduled: N(req.scheduled), overdueNotSent: N(req.overdue), sent: N(req.sent) },
        reminder: eff.config.reviewRequest.oneReminder ? 'saved_not_built' : 'off',
        propagation: 'live',                                                  // drafting and checkout read the settings on every call
      },
      sms: { configured: sms?.status === 'configured', sender: sms ? (sms.has_service ? 'messaging_service' : sms.has_number ? 'number' : 'none') : 'none', lastValidatedAt: iso(sms?.last_validated_at), lastError: sms?.last_validation_error ? 'validation_failed' : null },
      providers: { connected: providers },
      salonRow: { version: N(tenant?.version ?? 0), exists: !!tenant, updatedAt: iso(tenant?.updated_at) },
      lastChange: last ? { at: iso(last.created_at), by: last.actor ?? null } : null,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  // ── write: salon level, validated, conflict-checked, version-checked, history + fail-closed audit in one transaction ──
  async save(ctx: RssCtx, b: { values?: unknown; expectedVersion?: unknown; reason?: unknown }, audit: AuditFn) {
    const T = ctx.tenantId;
    if (b.expectedVersion == null || !Number.isInteger(Number(b.expectedVersion))) throw new ReputationSettingsError('Reload the settings and try again.', 'RSS_VERSION_REQUIRED');
    const values = (b.values && typeof b.values === 'object' ? b.values : {}) as Record<string, unknown>;
    const unknownKeys = Object.keys(values).filter((k) => !(RSS_KEYS as readonly string[]).includes(k));
    if (unknownKeys.length) throw new ReputationSettingsError('Unknown setting.', 'RSS_INVALID_VALUE', 400, { keys: unknownKeys });
    const bad = Object.entries(values).filter(([k, v]) => !validValue(k as RssKey, v)).map(([k]) => k);
    if (bad.length) throw new ReputationSettingsError('A value is not allowed.', 'RSS_INVALID_VALUE', 400, { keys: bad, tones: RSS_TONES, channels: RSS_CHANNELS, delay: RSS_DELAY });
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 500) : null;
    const out = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('reputation-settings:' || ${T}))`.execute(trx);
      const cur = (await sql<Row>`select id, enabled, config, version from tenant_ai_reputation_settings where tenant_id = ${T} and level = 'tenant' and branch_id is null for update`.execute(trx)).rows[0];
      const curVersion = N(cur?.version ?? 0);
      if (N(b.expectedVersion) !== curVersion) throw new ReputationSettingsError('Someone else changed these settings. They have been reloaded.', 'RSS_STALE_VERSION', 409, { currentVersion: curVersion });
      const before = { enabled: (cur?.enabled ?? null) as boolean | null, config: ((cur?.config ?? {}) as Cfg) };
      let enabled = before.enabled; let config: Cfg = { ...before.config };
      const changed: RssKey[] = [];
      for (const key of RSS_KEYS) {
        if (!(key in values)) continue;
        const v = values[key];
        if (key === 'enabled') {
          // "Enable" is stored as inherit (null): a salon never overrides a platform or package decision
          const next = v ? null : false;
          if ((enabled === false) !== (next === false)) { enabled = next; changed.push(key); }
          continue;
        }
        if (layerValue(enabled, config, key) !== v) { config = withValue(config, key, v); changed.push(key); }
      }
      if (!changed.length) throw new ReputationSettingsError('Nothing changed.', 'RSS_NO_CHANGE', 409);
      // approval vs automatic reply — refused on the RESULT (this salon's level), so neither box can bypass the other
      const resTenant = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { ...(enabled == null ? {} : { enabled }), config: config as Partial<ReputationConfig> } });
      if (resTenant.config.autoResponse.enabled && resTenant.config.approvalRequired !== false)
        throw new ReputationSettingsError('Automatic replies cannot be on while "Require approval before publishing" is on. Turn one of them off.', 'RSS_POLICY_CONFLICT', 409);
      const version = curVersion + 1;
      const cfgJson = Object.keys(config).length ? JSON.stringify(config) : null;
      if (cur) await sql`update tenant_ai_reputation_settings set enabled = ${enabled}, config = ${cfgJson}::jsonb, version = ${version}, updated_by_user_id = ${uuidOrNull(ctx.userId)}, updated_at = now()
        where tenant_id = ${T} and id = ${cur.id}`.execute(trx);
      else await sql`insert into tenant_ai_reputation_settings (tenant_id, level, branch_id, enabled, config, version, updated_by_user_id) values (${T}, 'tenant', null, ${enabled}, ${cfgJson}::jsonb, ${version}, ${uuidOrNull(ctx.userId)})`.execute(trx);
      const type = changed.length === 1 && changed[0] === 'enabled' ? (enabled === false ? 'assistant_disabled' : 'assistant_enabled') : 'settings_changed';
      const eventId = randomUUID();
      await sql`insert into ai_reputation_config_versions (id, tenant_id, level, branch_id, version, config, enabled, changed_by_user_id, event_type, before, changed_keys, reason, actor_role)
        values (${eventId}, ${T}, 'tenant', null, ${version}, ${cfgJson}::jsonb, ${enabled}, ${uuidOrNull(ctx.userId)}, ${type}, ${JSON.stringify(before)}::jsonb, ${changed}::text[], ${reason}, ${String(ctx.role ?? '') || null})`.execute(trx);
      await audit(trx as unknown as Kysely<any>, { eventId, type, changed, version, before, after: { enabled, config } });
      return { eventId, version };
    });
    return { ...out, state: await this.state(ctx) };
  }

  // ── history (newest first) ────────────────────────────────────────────────────────────────────────────────────
  private async period(ctx: RssCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const preset = pick(RSS_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const w = await this.ret.window(ctx, { preset: 'today' });
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today: w.today, tz: w.tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !z) throw new ReputationSettingsError('Choose a From and a To date.', 'RSS_INVALID_PERIOD');
      if (a > z) throw new ReputationSettingsError('The From date must be on or before the To date.', 'RSS_INVALID_PERIOD');
      from = a; to = z;
    } else ({ from, to } = salonPresetRange(preset, w.today)!);
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${w.tz}) as s, ((${to}::date + 1)::timestamp at time zone ${w.tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today: w.today, tz: w.tz };
  }
  async history(ctx: RssCtx, f: { q?: unknown; type?: unknown; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId;
    const pageSize = (RSS_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const where = [sql`v.tenant_id = ${T}`];
    const type = pick(RSS_EVENT_TYPES, f.type);
    if (type) where.push(sql`v.event_type = ${type}`);
    if (per.start && per.end) where.push(sql`v.created_at >= ${per.start} and v.created_at < ${per.end}`);
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      where.push(sql`(v.event_type ilike ${like} or coalesce(v.reason, '') ilike ${like} or coalesce(v.actor_role, '') ilike ${like} or array_to_string(v.changed_keys, ' ') ilike ${like}
        or coalesce(u.full_name, '') ilike ${like} or coalesce(u.email, '') ilike ${like} or v.id::text = ${q} or v.config::text ilike ${like})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`ai_reputation_config_versions v left join users u on u.id = v.changed_by_user_id and u.tenant_id = v.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select v.id, v.level, v.branch_id, v.event_type, v.changed_keys, v.before, v.config, v.enabled, v.reason, v.version, v.actor_role, v.created_at, coalesce(u.full_name, u.email) as actor
      from ${FROM} where ${W} order by v.created_at desc, v.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.eventOut(r)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, type: type ?? null, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz } };
  }
  private eventOut(r: Row) {
    const before = r.before as { enabled?: boolean | null; config?: Cfg } | null;
    // each changed control as before → after (rows written before Nov 2 2026 have no "before": shown as unknown)
    const keys = ((r.changed_keys ?? []) as string[]).filter((k) => (RSS_KEYS as readonly string[]).includes(k)) as RssKey[];
    const changes = keys.map((k) => ({ key: k, before: before ? layerValue(before.enabled, before.config, k) ?? null : null, after: layerValue(r.enabled, r.config as Cfg, k) ?? null, beforeKnown: !!before }));
    return { id: String(r.id), level: r.level, branchId: r.branch_id ? String(r.branch_id) : null, type: r.event_type, changes, legacy: !before, reason: r.reason ?? null,
      version: N(r.version), actor: r.actor ?? null, role: r.actor_role ?? null, at: iso(r.created_at) };
  }
  async event(ctx: RssCtx, id: string) {
    const T = ctx.tenantId;
    if (!isUuid(`${id}`)) throw new ReputationSettingsError('Change not found.', 'RSS_EVENT_NOT_FOUND', 404);
    const r = (await sql<Row>`select v.id, v.level, v.branch_id, v.event_type, v.changed_keys, v.before, v.config, v.enabled, v.reason, v.version, v.actor_role, v.created_at, coalesce(u.full_name, u.email) as actor
      from ai_reputation_config_versions v left join users u on u.id = v.changed_by_user_id and u.tenant_id = v.tenant_id where v.tenant_id = ${T} and v.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) throw new ReputationSettingsError('Change not found.', 'RSS_EVENT_NOT_FOUND', 404);
    // the settings are read live by drafting and the checkout hook: a change applies to the next draft / checkout
    const drafts = N((await sql<Row>`select count(*)::int as n from review_response_versions where tenant_id = ${T} and created_at >= ${r.created_at} and is_ai_generated`.execute(this.db)).rows[0]?.n);
    const requests = N((await sql<Row>`select count(*)::int as n from review_requests where tenant_id = ${T} and created_at >= ${r.created_at}`.execute(this.db)).rows[0]?.n);
    return { ...this.eventOut(r), propagation: { mode: 'live', aiDraftsSince: drafts, requestsScheduledSince: requests } };
  }

  // ── Check Reputation Settings (read-only; records its own evidence; one run per salon per 30 s) ──────────────────
  async check(ctx: RssCtx) {
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from review_reputation_settings_health_runs where tenant_id = ${T}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; state: St; count?: number | null; detail?: Record<string, unknown> }> = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    let st: Awaited<ReturnType<ReputationSettingsCenter['state']>> | null = null;
    try { st = await this.state(ctx); checks.push({ key: 'settings_readable', state: 'PASSED' }); }
    catch { checks.push({ key: 'settings_readable', state: 'FAILED' }); }
    if (st) {
      const ignored = st.settings.filter((x) => x.ignoredAt.length).length;
      checks.push({ key: 'values_valid', state: ignored ? 'WARNING' : 'PASSED', count: ignored });
      checks.push({ key: 'assistant_state', state: st.assistant.effectiveEnabled ? 'PASSED' : 'WARNING', detail: { disabledAtLevel: st.assistant.disabledAtLevel } });
      const e = st.entitlement;
      checks.push({ key: 'subscription', state: e.allowed === null ? 'UNAVAILABLE' : e.allowed ? 'PASSED' : e.enforcement === 'enforce' ? 'FAILED' : 'WARNING', detail: { reason: e.reason, enforcement: e.enforcement } });
      checks.push({ key: 'auto_response', state: st.runtime.autoResponse === 'off' ? 'PASSED' : 'WARNING' });
      const reqOn = st.runtime.reviewRequests.scheduling === 'on_checkout';
      checks.push({ key: 'requests_sender', state: !reqOn && !st.runtime.reviewRequests.scheduled ? 'PASSED' : 'WARNING', count: st.runtime.reviewRequests.overdueNotSent });
      checks.push({ key: 'reminder', state: st.runtime.reminder === 'off' ? 'PASSED' : 'WARNING' });
      const smsNeeded = reqOn && st.settings.find((x) => x.key === 'channel')?.value === 'sms';
      checks.push({ key: 'sms_sender', state: st.sms.configured ? 'PASSED' : smsNeeded ? 'WARNING' : 'INSUFFICIENT_DATA' });
      checks.push({ key: 'provider_connected', state: st.providers.connected ? 'PASSED' : 'WARNING', count: st.providers.connected });
    }
    // approval vs automatic reply anywhere (salon or any branch row)
    const rows = (await sql<Row>`select level, branch_id, enabled, config from tenant_ai_reputation_settings where tenant_id = ${T}`.execute(this.db)).rows;
    const tenantRow = rows.find((r) => r.level === 'tenant');
    const layer = (r: Row | undefined): SettingsLayer | undefined => (r ? { ...(r.enabled == null ? {} : { enabled: r.enabled }), ...(r.config ? { config: r.config } : {}) } : undefined);
    const conflicts = [tenantRow, ...rows.filter((r) => r.level === 'branch')].filter(Boolean).filter((r) => {
      const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: layer(tenantRow), ...(r!.level === 'branch' ? { branch: layer(r) } : {}) });
      return eff.config.autoResponse.enabled && eff.config.approvalRequired !== false;
    }).length;
    checks.push({ key: 'policy_conflict', state: conflicts ? 'FAILED' : 'PASSED', count: conflicts });
    // a public reply published without an approval record (manual or automatic) — Critical
    const unapproved = N((await one(sql<Row>`select count(*)::int as n from review_response_drafts d where d.tenant_id = ${T} and d.status = 'published'
      and not exists (select 1 from review_approvals a where a.tenant_id = d.tenant_id and a.review_id = d.review_id and a.action in ('approved', 'auto_approved'))`)).n);
    checks.push({ key: 'approval_enforced', state: unapproved ? 'FAILED' : 'PASSED', count: unapproved });
    // requests marked sent before their scheduled time (the delay was not honoured)
    const early2 = N((await one(sql<Row>`select count(*)::int as n from review_requests where tenant_id = ${T} and sent_at is not null and scheduled_for is not null and sent_at < scheduled_for`)).n);
    checks.push({ key: 'delay_honoured', state: early2 ? 'FAILED' : 'PASSED', count: early2 });
    // requests scheduled for a customer who has since withdrawn consent for that channel
    const noConsent = N((await one(sql<Row>`select count(*)::int as n from review_requests q join customers c on c.id = q.customer_id and c.tenant_id = q.tenant_id
      where q.tenant_id = ${T} and q.status = 'scheduled' and ((q.channel = 'sms' and c.marketing_sms_opt_in is false) or (q.channel = 'email' and c.marketing_email_opt_in is false))`)).n);
    checks.push({ key: 'consent', state: noConsent ? 'WARNING' : 'PASSED', count: noConsent });
    // a visit with more than one request on the same channel (dedupe broke)
    const dupes = N((await one(sql<Row>`select count(*)::int as n from (select 1 from review_requests where tenant_id = ${T} and appointment_id is not null group by appointment_id, channel having count(*) > 1) x`)).n);
    checks.push({ key: 'no_duplicate_requests', state: dupes ? 'FAILED' : 'PASSED', count: dupes });
    const branchRows = rows.filter((r) => r.level === 'branch').length;
    checks.push({ key: 'branch_overrides', state: branchRows ? 'WARNING' : 'PASSED', count: branchRows });
    const unexplained = N((await one(sql<Row>`select count(*)::int as n from tenant_ai_reputation_settings s where s.tenant_id = ${T}
      and not exists (select 1 from ai_reputation_config_versions v where v.tenant_id = s.tenant_id and v.level = s.level and coalesce(v.branch_id::text, '') = coalesce(s.branch_id::text, '') and v.version = s.version)`)).n);
    checks.push({ key: 'history_complete', state: unexplained ? 'WARNING' : 'PASSED', count: unexplained });
    const cross = N((await one(sql<Row>`select count(*)::int as n from ai_reputation_config_versions v join users u on u.id = v.changed_by_user_id where v.tenant_id = ${T} and u.tenant_id <> v.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('reputation-settings-health:' || ${T}))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into review_reputation_settings_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
