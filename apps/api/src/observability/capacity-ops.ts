// capacity-ops.ts — BUILD_PLAN Phase 11 (Constitution 4): the System Operations capacity sections.
//
//   LOAD / noisy neighbour (§35/§113): per-tenant requests, request time and DB statement time from tenant_load_minute
//     (every API process flushes it — HttpMetricsInterceptor) plus each tenant's slow-query samples
//     (db_slow_query_samples). Top 10 by load. `tenant.load.watch` (every 5 min) raises ONE platform alert while a single
//     salon is more than half of the platform's load, and resolves it when that stops.
//   COST (§96/§171): daily per-tenant, per-provider QUANTITIES from the existing ledgers (sms_usage_records,
//     sms_delivery_logs, ai_usage_logs, jobs, tenant_storage_usage) × unit prices from platform_settings
//     ('cost.unit_price.*'). A ledger's own recorded cost (provider_cost_micros, the AI price table's cost_micro_usd) is
//     used where present. A price that was never set is 0 and the line says UNKNOWN — nothing here invents a price.
//   QUOTAS (§113/§160): what QuotaService.limitFor answers for a salon, its usage, and the override / plan-default edit.
//   WEBHOOKS (§173–175): per-provider received / verified / rejected / duplicate / processed (this process's counters;
//     the platform-wide series is aipowersalon_webhook_events_total at /metrics).
// Reads are super_admin.system_operations.view; edits are super_admin.system.manage + step-up + a reason + audit.
import { canMoveToSql } from '@aipowersalon/database';
import { ALERT } from '@aipowersalon/super-admin';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { BadRequestException, Body, Controller, Get, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Optional, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, ListQueries } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';
import { utcDate } from '@aipowersalon/date-time';
import { runTick, log, webhookCounts, webhookCountsSince } from '@aipowersalon/observability';
import { AuditService } from '@aipowersalon/audit';
import { QuotaService, QUOTA_KINDS, EDITABLE_QUOTA_KINDS, type EditableQuotaKind } from '../common/tenant-quotas';
import { CapacityOpsControllerListQueries } from './capacity-ops.list-queries';
import { COST_PRICES_BODY, QUOTA_BODY } from './request-schemas';

// ── load / noisy neighbour ───────────────────────────────────────────────────────────────────────────────────────────
export interface TenantLoadRow { tenantId: string; tenantName: string | null; requests: number; requestMs: number; dbMs: number; dbQueries: number; slowQueries: number; requestShare: number; dbShare: number }
export interface LoadReport { windowMinutes: number; totals: { requests: number; requestMs: number; dbMs: number; activeTenants: number }; top: TenantLoadRow[]; dominant: TenantLoadRow | null; generatedAt: string }

/** Below this many requests in the window the platform is too quiet for a share to mean anything. */
export const NOISY_MIN_REQUESTS = 300;
export const NOISY_SHARE = 0.5;
/** Pure: the tenant using more than half the platform's load (DB time, else requests), or null. Needs ≥ 2 active salons. */
export function noisyNeighbour(rows: readonly TenantLoadRow[], totals: LoadReport['totals']): TenantLoadRow | null {
  if (totals.activeTenants < 2 || totals.requests < NOISY_MIN_REQUESTS) return null;
  const worst = [...rows].sort((a, b) => Math.max(b.dbShare, b.requestShare) - Math.max(a.dbShare, a.requestShare))[0];
  return worst && (worst.dbShare > NOISY_SHARE || worst.requestShare > NOISY_SHARE) ? worst : null;
}

// ── cost ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The unit prices a Super Admin sets (USD per billing unit). Unset = 0 = unknown. */
export const COST_PRICES = [
  { key: 'cost.unit_price.sms.message', category: 'sms', label: 'SMS — per message (where the provider\'s own cost was not recorded)', perUnits: 1 },
  { key: 'cost.unit_price.ai.million_tokens', category: 'ai', label: 'AI — per 1,000,000 tokens (where the model price table recorded no cost)', perUnits: 1_000_000 },
  { key: 'cost.unit_price.compute.thousand_jobs', category: 'compute', label: 'Background jobs — per 1,000 jobs', perUnits: 1_000 },
  { key: 'cost.unit_price.storage.gb_month', category: 'storage', label: 'Uploaded storage — per GB-month', perUnits: 1 },
] as const;
export type CostCategory = (typeof COST_PRICES)[number]['category'];
export interface CostQty { tenantId: string; day: string; provider: string; unit: string; quantity: number; knownCostMicros: number; pricedQuantity: number }
export interface CostLine extends CostQty { estimatedMicros: number; unknownQuantity: number }

const categoryOf = (provider: string): CostCategory => (provider.split(':')[0] as CostCategory);
/** Pure: one ledger line → cost. Known ledger cost for the priced part; price × the rest; a zero price leaves the rest UNKNOWN. */
export function priceLine(q: CostQty, pricesUsd: Readonly<Record<string, number>>): CostLine {
  const def = COST_PRICES.find((p) => p.category === categoryOf(q.provider));
  const price = def ? Number(pricesUsd[def.key] ?? 0) : 0;
  const rest = Math.max(0, q.quantity - q.pricedQuantity);
  let units = rest / (def?.perUnits ?? 1);
  if (def?.category === 'storage') units = rest / 1e9 / 30;          // bytes held for one day → GB-months
  const est = price > 0 ? Math.round(units * price * 1e6) : 0;
  return { ...q, estimatedMicros: q.knownCostMicros + est, unknownQuantity: price > 0 ? 0 : rest };
}

@Injectable()
export class CapacityOpsService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() private readonly quotas?: QuotaService, @Optional() private readonly audit?: AuditService) {}
  private need() { if (!this.db) throw new NotFoundException('Capacity data needs the database.'); return this.db; }

  async load(minutes = 15, now = new Date()): Promise<LoadReport> {
    const db = this.need();
    const win = Math.max(1, Math.min(24 * 60, Math.round(minutes)));
    const from = new Date(now.getTime() - win * 60_000);
    const rows = (await sql<any>`
      with l as (select tenant_id, sum(request_count)::bigint n, sum(sum_ms)::bigint ms, sum(db_ms)::bigint dbms, sum(db_queries)::bigint q
                   from tenant_load_minute where bucket_minute >= ${from} group by tenant_id),
           s as (select tenant_id, count(*)::int slow from db_slow_query_samples where sampled_at >= ${from} and tenant_id is not null group by tenant_id)
      select l.*, coalesce(s.slow, 0) slow, t.display_name from l left join s on s.tenant_id = l.tenant_id left join tenants t on t.id = l.tenant_id`.execute(db)).rows;
    const totals = { requests: 0, requestMs: 0, dbMs: 0, activeTenants: rows.length };
    for (const r of rows) { totals.requests += Number(r.n); totals.requestMs += Number(r.ms); totals.dbMs += Number(r.dbms); }
    const all: TenantLoadRow[] = rows.map((r: any) => ({
      tenantId: String(r.tenant_id), tenantName: r.display_name ?? null, requests: Number(r.n), requestMs: Number(r.ms), dbMs: Number(r.dbms), dbQueries: Number(r.q), slowQueries: Number(r.slow),
      requestShare: totals.requests ? Number(r.n) / totals.requests : 0, dbShare: totals.dbMs ? Number(r.dbms) / totals.dbMs : 0,
    }));
    const top = all.sort((a, b) => (b.dbMs - a.dbMs) || (b.requests - a.requests)).slice(0, 10);
    return { windowMinutes: win, totals, top, dominant: noisyNeighbour(all, totals), generatedAt: now.toISOString() };
  }

  async prices(): Promise<Record<string, number>> {
    const db = this.need();
    const r = (await sql<any>`select setting_key, value from platform_settings where setting_key like 'cost.unit_price.%'`.execute(db)).rows;
    const out: Record<string, number> = Object.fromEntries(COST_PRICES.map((p) => [p.key, 0]));
    for (const x of r) { const v = Number(typeof x.value === 'string' ? JSON.parse(x.value) : x.value); if (x.setting_key in out && Number.isFinite(v) && v >= 0) out[x.setting_key] = v; }
    return out;
  }

  /** Daily quantities per tenant / provider from the ledgers, [from, to). Days are UTC (platform cost, not a salon's day). */
  async quantities(from: Date, to: Date): Promise<CostQty[]> {
    const db = this.need();
    const day = (col: string) => sql.raw(`floor(extract(epoch from ${col}) / 86400)::int`);
    const r = (await sql<any>`
      select tenant_id, ${day('requested_at')} d, 'sms:' || provider provider, 'message' unit, count(*)::bigint qty,
             coalesce(sum(provider_cost_micros), 0)::bigint known, count(provider_cost_micros)::bigint priced
        from sms_usage_records where requested_at >= ${from} and requested_at < ${to} and (status <> 'FAILED' or provider_message_id is not null)
       group by 1, 2, 3
      union all
      select tenant_id, ${day('created_at')}, 'sms:twilio', 'message', count(*)::bigint, 0::bigint, 0::bigint
        from sms_delivery_logs where created_at >= ${from} and created_at < ${to} and tenant_id is not null and status <> 'failed'
       group by 1, 2
      union all
      select tenant_id, ${day('created_at')}, 'ai:' || coalesce(nullif(model_provider, ''), 'unknown'), 'token', coalesce(sum(total_tokens), 0)::bigint,
             coalesce(sum(cost_micro_usd), 0)::bigint, coalesce(sum(total_tokens) filter (where cost_micro_usd > 0), 0)::bigint
        from ai_usage_logs where created_at >= ${from} and created_at < ${to}
       group by 1, 2, 3
      union all
      select tenant_id, ${day('created_at')}, 'compute:jobs', 'job', count(*)::bigint, 0::bigint, 0::bigint
        from jobs where created_at >= ${from} and created_at < ${to} and tenant_id is not null
       group by 1, 2`.execute(db)).rows;
    const out: CostQty[] = r.map((x: any) => ({ tenantId: String(x.tenant_id), day: utcDate(new Date(Number(x.d) * 86_400_000)), provider: String(x.provider), unit: String(x.unit),
      quantity: Number(x.qty), knownCostMicros: Number(x.known), pricedQuantity: Number(x.priced) }));
    // storage: today's held bytes, for each day of the window (the usage table holds the current figure, not a history)
    const st = (await sql<any>`select tenant_id, bytes_used from tenant_storage_usage where bytes_used > 0`.execute(db)).rows;
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
    for (const s of st) for (let i = 0; i < days; i++) out.push({ tenantId: String(s.tenant_id), day: utcDate(new Date(from.getTime() + i * 86_400_000)), provider: 'storage:uploads', unit: 'byte_day', quantity: Number(s.bytes_used), knownCostMicros: 0, pricedQuantity: 0 });
    return out;
  }

  async cost(days = 7, now = new Date()) {
    const n = Math.max(1, Math.min(90, Math.round(days)));
    const to = new Date(Date.parse(utcDate(now)) + 86_400_000), from = new Date(to.getTime() - n * 86_400_000);
    const prices = await this.prices();
    const lines = (await this.quantities(from, to)).map((q) => priceLine(q, prices));
    const add = <K extends string>(m: Map<K, any>, k: K, l: CostLine, extra: Record<string, unknown>) => {
      const a = m.get(k) ?? { ...extra, quantity: 0, estimatedMicros: 0, knownCostMicros: 0, unknownQuantity: 0 };
      a.quantity += l.quantity; a.estimatedMicros += l.estimatedMicros; a.knownCostMicros += l.knownCostMicros; a.unknownQuantity += l.unknownQuantity; m.set(k, a);
    };
    const byProvider = new Map<string, any>(), byTenant = new Map<string, any>(), byDay = new Map<string, any>();
    for (const l of lines) { add(byProvider, `${l.provider}|${l.unit}`, l, { provider: l.provider, unit: l.unit }); add(byTenant, l.tenantId, l, { tenantId: l.tenantId }); add(byDay, l.day, l, { day: l.day }); }
    const names = new Map<string, string>();
    const ids = [...byTenant.keys()];
    if (ids.length) for (const t of (await sql<any>`select id, display_name from tenants where id in (${sql.join(ids.slice(0, 2000).map((i) => sql`${i}`))})`.execute(this.need())).rows) names.set(String(t.id), t.display_name);
    const status = (x: any) => (x.unknownQuantity > 0 ? (x.estimatedMicros > 0 ? 'PARTIAL' : 'UNKNOWN') : 'ESTIMATED');
    return {
      from: utcDate(from), to: utcDate(new Date(to.getTime() - 1)), days: n,
      prices: COST_PRICES.map((p) => ({ key: p.key, category: p.category, label: p.label, usd: prices[p.key], unknown: !(prices[p.key] > 0) })),
      perProvider: [...byProvider.values()].map((x) => ({ ...x, status: status(x) })).sort((a, b) => b.estimatedMicros - a.estimatedMicros),
      perTenant: [...byTenant.values()].map((x) => ({ ...x, tenantName: names.get(x.tenantId) ?? null, status: status(x) })).sort((a, b) => b.estimatedMicros - a.estimatedMicros || b.quantity - a.quantity).slice(0, 50),
      daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      note: 'Estimates. A provider\'s own recorded cost is used where the ledger has it; elsewhere quantity × the unit price set here. A price never set is UNKNOWN, not zero.',
    };
  }

  async setPrices(input: any, actor: { userId: string | null }) {
    const db = this.need();
    const reason = String(input?.reason ?? '').trim();
    if (reason.length < 10) throw new BadRequestException({ code: 'reason_required', message: 'A reason of at least 10 characters is required.' });
    const list: Array<{ key: string; usd: number }> = Array.isArray(input?.prices) ? input.prices : [];
    if (!list.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Send at least one price.' });
    for (const p of list) {
      if (!COST_PRICES.some((d) => d.key === p?.key)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `Unknown price "${String(p?.key).slice(0, 60)}".` });
      if (!(Number.isFinite(Number(p.usd)) && Number(p.usd) >= 0 && Number(p.usd) <= 1_000_000)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `${p.key}: a price is a dollar amount from 0 to 1,000,000.` });
    }
    const before = await this.prices();
    await db.transaction().execute(async (trx: any) => {
      for (const p of list) {
        const v = JSON.stringify(Number(p.usd));
        const prev: any = (await sql`select value, version from platform_settings where setting_key = ${p.key} for update`.execute(trx)).rows[0];
        await sql`insert into platform_settings (setting_key, setting_group, value, value_type, version)
                  values (${p.key}, 'cost_unit_prices', ${v}::jsonb, 'number', 1)
                  on conflict (setting_key) do update set value = excluded.value, version = platform_settings.version + 1, updated_at = now()`.execute(trx);
        await sql`insert into platform_setting_changes (setting_key, setting_group, previous_value, new_value, version, actor, actor_role, reason, source)
                  values (${p.key}, 'cost_unit_prices', ${prev ? JSON.stringify(prev.value) : null}::jsonb, ${v}::jsonb, ${Number(prev?.version ?? 0) + 1}, ${actor.userId}, 'SUPER_ADMIN', ${reason}, 'ui')`.execute(trx);
      }
    });
    await this.audit?.recordPlatform({ userId: actor.userId, role: 'SUPER_ADMIN', module: 'system_operations', action: 'cost_unit_prices_changed', resourceType: 'platform_setting',
      summary: list.map((p) => `${p.key}=${Number(p.usd)}`).join(', '), metadata: { reason, before: Object.fromEntries(list.map((p) => [p.key, before[p.key]])), after: Object.fromEntries(list.map((p) => [p.key, Number(p.usd)])) }, reason });
    return this.prices();
  }

  // ── quotas ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async quotaView(tenantId: string) {
    const db = this.need();
    const t = (await sql<any>`select id, display_name from tenants where id::text = ${tenantId}`.execute(db)).rows[0];
    if (!t || !this.quotas) throw new NotFoundException('Tenant not found.');
    const limits = await Promise.all(QUOTA_KINDS.map((k) => this.quotas!.limitFor(String(t.id), k)));
    const rows = await this.quotas.rows(String(t.id));
    const jobs = (await sql<any>`select count(*)::int n from jobs where tenant_id = ${t.id} and status = 'running'`.execute(db)).rows[0];
    return { tenantId: String(t.id), tenantName: t.display_name ?? null, limits, override: rows.tenant, planDefault: rows.plan,
      usage: { storage_bytes: await this.quotas.storageUsed(String(t.id)), jobs_in_flight: Number(jobs?.n ?? 0) } };
  }

  async setQuota(scope: 'tenant' | 'plan', id: string, input: any, actor: { userId: string | null }) {
    const db = this.need();
    const reason = String(input?.reason ?? '').trim();
    if (reason.length < 10) throw new BadRequestException({ code: 'reason_required', message: 'A reason of at least 10 characters is required.' });
    const vals: Record<EditableQuotaKind, number | null> = { api_requests_per_min: null, jobs_in_flight: null, storage_bytes: null };
    for (const k of EDITABLE_QUOTA_KINDS) {
      const v = input?.[k];
      if (v === null || v === undefined || v === '') continue;
      const n = Number(v);
      const max = k === 'jobs_in_flight' ? 50 : k === 'api_requests_per_min' ? 1_000_000 : Number.MAX_SAFE_INTEGER;
      if (!Number.isInteger(n) || n < (k === 'storage_bytes' ? 0 : 1) || n > max) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `${k} must be a whole number${k === 'jobs_in_flight' ? ' from 1 to 50' : ''} (empty = inherit).` });
      vals[k] = n;
    }
    const exists = scope === 'tenant'
      ? (await sql<any>`select 1 from tenants where id::text = ${id}`.execute(db)).rows.length
      : (await sql<any>`select 1 from subscription_plans where id::text = ${id}`.execute(db)).rows.length;
    if (!exists) throw new NotFoundException(scope === 'tenant' ? 'Tenant not found.' : 'Plan not found.');
    const table = scope === 'tenant' ? sql.table('tenant_quotas') : sql.table('plan_quota_defaults');
    const col = scope === 'tenant' ? sql.ref('tenant_id') : sql.ref('plan_id');
    await sql`insert into ${table} (${col}, api_requests_per_min, jobs_in_flight, storage_bytes, reason, updated_by)
              values (${id}::uuid, ${vals.api_requests_per_min}, ${vals.jobs_in_flight}, ${vals.storage_bytes}, ${reason}, ${actor.userId})
              on conflict (${col}) do update set api_requests_per_min = excluded.api_requests_per_min, jobs_in_flight = excluded.jobs_in_flight,
                storage_bytes = excluded.storage_bytes, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = now()`.execute(db);
    await this.audit?.recordPlatform({ userId: actor.userId, role: 'SUPER_ADMIN', module: 'system_operations', action: scope === 'tenant' ? 'tenant_quota_changed' : 'plan_quota_changed',
      resourceType: scope === 'tenant' ? 'tenant' : 'subscription_plan', resourceId: id, summary: JSON.stringify(vals), metadata: { reason, ...vals }, reason });
    this.quotas?.clear();
    return scope === 'tenant' ? this.quotaView(id) : { planId: id, ...vals };
  }

  webhooks() { return { since: webhookCountsSince(), scope: 'this API process', providers: webhookCounts() }; }
}

/**
 * `tenant.load.watch` — every 5 minutes: one platform alert ('tenant_load' / 'noisy_neighbour') while a single salon is
 * more than half of the platform's load over the last 15 minutes; resolved when it is not. Same episode pattern as the
 * health aggregator: one open alert at a time, a dedupe key per raise.
 */
export const LOAD_WATCH_EVERY_MS = 5 * 60_000;
@Injectable()
export class NoisyNeighbourWatch implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly ops: CapacityOpsService, @Optional() @Inject(DATABASE) private readonly db: any) {}
  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'tenant.load.watch', jobClass: 'standard', everyMs: LOAD_WATCH_EVERY_MS }, () => this.check()).catch(() => undefined); }, LOAD_WATCH_EVERY_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async check(now = new Date()): Promise<{ dominant: string | null; raised: boolean; resolved: number }> {
    if (!this.db) return { dominant: null, raised: false, resolved: 0 };
    const r = await this.ops.load(15, now);
    const d = r.dominant;
    if (!d) {
      const res: any = await sql`update alerts set status = 'resolved', resolved_at = ${now}, updated_at = ${now}
                                 where tenant_id is null and related_module = 'tenant_load' and related_record_id = 'noisy_neighbour' and status in ('unread', 'read') and ${canMoveToSql(ALERT, 'resolved')}`.execute(this.db);
      return { dominant: null, raised: false, resolved: Number(res?.numAffectedRows ?? 0) };
    }
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const title = `One salon is ${pct(Math.max(d.dbShare, d.requestShare))} of platform load`;
    const message = `${d.tenantName ?? d.tenantId} used ${pct(d.dbShare)} of database time and ${pct(d.requestShare)} of requests over the last ${r.windowMinutes} minutes `
      + `(${d.requests} requests, ${Math.round(d.dbMs / 1000)} s of database time, ${d.slowQueries} slow queries). Check System Operations → Load; tighten the salon's quota if it is runaway traffic. Runbook: RUNBOOKS.md#noisy-neighbour`;
    const ins = await sql<{ id: string }>`
      insert into alerts (id, tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
      select gen_random_uuid(), null, 'Platform', ${title}, ${message}, 'system', 'medium', 'unread', 'tenant_load', 'noisy_neighbour', ${`tenant_load:noisy_neighbour:${now.getTime()}`}
      where not exists (select 1 from alerts where tenant_id is null and related_module = 'tenant_load' and related_record_id = 'noisy_neighbour' and status in ('unread', 'read'))
      on conflict (dedupe_key) do nothing returning id`.execute(this.db);
    if (ins.rows.length) log.warn('alert.raised', { component: 'tenant_load', tenantId: d.tenantId, dbShare: d.dbShare, requestShare: d.requestShare });
    return { dominant: d.tenantId, raised: ins.rows.length > 0, resolved: 0 };
  }
}

const actorOf = (req: any) => ({ userId: req?.ctx?.userId ?? null });

@UseGuards(SuperAdminGuard)
@ListQueries(CapacityOpsControllerListQueries)
@Controller('super-admin/system')
export class CapacityOpsController {
  constructor(private readonly svc: CapacityOpsService) {}
  @Get('load') @RequirePermission('super_admin.system_operations.view')
  load(@Query('minutes') minutes?: string) { return this.svc.load(Number(minutes) || 15); }
  @Get('cost') @RequirePermission('super_admin.system_operations.view')
  cost(@Query('days') days?: string) { return this.svc.cost(Number(days) || 7); }
  @RequireStepUp()
  @Put('cost/prices') @RequirePermission('super_admin.system.manage')
  setPrices(@Body(ValidatedBody(COST_PRICES_BODY, { strict: true })) b: any, @Req() req: any) { return this.svc.setPrices(b, actorOf(req)); }
  @Get('webhooks') @RequirePermission('super_admin.system_operations.view')
  webhooks() { return this.svc.webhooks(); }
  @Get('quotas/tenants/:tenantId') @RequirePermission('super_admin.system_operations.view')
  quota(@Param('tenantId') tenantId: string) { return this.svc.quotaView(String(tenantId)); }
  @RequireStepUp()
  @Put('quotas/tenants/:tenantId') @RequirePermission('super_admin.system.manage')
  setTenantQuota(@Param('tenantId') tenantId: string, @Body(ValidatedBody(QUOTA_BODY, { strict: true })) b: any, @Req() req: any) { return this.svc.setQuota('tenant', String(tenantId), b, actorOf(req)); }
  @RequireStepUp()
  @Put('quotas/plans/:planId') @RequirePermission('super_admin.system.manage')
  setPlanQuota(@Param('planId') planId: string, @Body(ValidatedBody(QUOTA_BODY, { strict: true })) b: any, @Req() req: any) { return this.svc.setQuota('plan', String(planId), b, actorOf(req)); }
}
