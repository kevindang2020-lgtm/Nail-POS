// forecast-center.ts — AI Analytics & Forecasting guide (Nov 2 2026), the second half: `/pos/ai-analytics/center/*`.
//
// What was missing: every forecast the page showed was recorded (forecast_points, migration 340 — one row per run + target
// date, the realized value filled in once the date has passed), but nobody could SEE that record: no list of past forecasts,
// no way to find one, no forecast-vs-actual for a run, and no way to tell whether the forecasting system itself was healthy.
//
// What it is now — read-only, over the existing record (nothing is re-forecast, nothing is written but the check's evidence):
//   • summary — runs ever, runs in the last 30 days, last run per forecast, matured days waiting for their actual, evaluated days;
//   • runs    — the forecast history: one row per run (type · model + version · branch · generated · horizon · status ·
//               realized error and interval coverage), search (run id, model, version, branch, product), type and status
//               filters, presets + From/To on the generated date in salon time, newest first, numbered pages;
//   • run     — one run's days: forecast, 80% range, actual, error, inside the range or not;
//   • check   — "Check AI Analytics & Forecasting System": the history the models train on, the data-quality checks
//               (duplicate appointments, impossible durations, past appointments with no outcome), the stored forecasts,
//               evaluation, backtest, interval coverage, the subscription gate, tenant isolation. Each check says which part
//               of the system it is about and when it last passed. Read-only.
// Who sees what: appointment forecasts need reports.view, revenue forecasts pos.reports.financial_view (the same rule as the
// forecast itself), product forecasts inventory.view or reports.view. A branch user sees their branch only.
import { hasPermission } from '@aipowersalon/permissions';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { enforcementMode } from '../ai-entitlement/ai-entitlement.guard';
import { addDays as addYmdDays, dateColumnYmd } from '@aipowersalon/date-time';   // §87: one calendar helper

type Row = Record<string, any>;
export interface FcCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export class ForecastCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
export const FC_DOMAINS = ['all', 'appointments', 'revenue', 'product_demand'] as const;
export const FC_STATUSES = ['all', 'pending', 'awaiting', 'partial', 'evaluated'] as const;
export const FC_SORTS = ['newest', 'oldest'] as const;
export const FC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'custom'] as const;
export const FC_PAGE_SIZES = [10, 25, 50, 100] as const;
/** the minimum days of history before a forecast is produced (the forecast services' MIN_HISTORY) */
export const FC_MIN_HISTORY = 14;
/** an 80% range that holds fewer than this share of the actual days is too narrow */
export const FC_MIN_COVERAGE = 0.6;
const OPEN_STATUSES = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const ymd = (v: unknown) => dateColumnYmd(v);
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
// the platform's one permission rule (Nov 6 2026 full-run route sweep): a raw includes() missed alias-granted keys, so every
// owner and manager was refused here although the route guard (the same rule) had let them in
const has = (ctx: FcCtx, p: string) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], p);
const addDays = (d: string, k: number) => addYmdDays(d, k);

export type FcState = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
export interface FcCheck { key: string; component: string; state: FcState; count?: number | null; detail?: Record<string, unknown>; lastPassedAt?: string | null }
/** what the check reads through the forecast services (the same series the forecasts are built from) */
export interface FcProbes {
  appointments: () => Promise<{ historyDays: number; minimum: number; ready: boolean; zeroDays: number; lastDay: string | null }>;
  revenue: () => Promise<{ historyDays: number; minimum: number; ready: boolean; zeroDays: number } | { restricted: true }>;
}

export class ForecastCenter {
  constructor(private readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) {}

  /** the forecast types this role may see (the same rule as the forecast endpoints) */
  domainsFor(ctx: FcCtx): string[] {
    const out: string[] = [];
    if (has(ctx, 'reports.view')) out.push('appointments');
    if (has(ctx, 'pos.reports.financial_view')) out.push('revenue');
    if (has(ctx, 'inventory.view') || has(ctx, 'reports.view')) out.push('product_demand');
    return out;
  }
  private need(ctx: FcCtx) {
    if (!has(ctx, 'pos.ai_analytics.view')) throw new ForecastCenterError('Your role cannot see AI forecasts.', 'PERMISSION_DENIED', 403);
    const d = this.domainsFor(ctx);
    if (!d.length) throw new ForecastCenterError('Your role cannot see any forecast type.', 'PERMISSION_DENIED', 403);
    return d;
  }
  private scope(col: ReturnType<typeof sql>, ctx: FcCtx): { w: ReturnType<typeof sql> } {
    return isUuid(ctx.branchId) ? { w: sql`${col} = ${ctx.branchId}::uuid` } : { w: sql`true` };
  }
  private async today(ctx: FcCtx) {
    const tz = await branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null);
    return { tz, today: new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now())) };
  }
  private async period(ctx: FcCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const { tz, today } = await this.today(ctx);
    const preset = pick(FC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
    let from: string; let to = today;
    switch (preset) {
      case 'today': from = today; break;
      case 'yesterday': from = to = addDays(today, -1); break;
      case 'week': from = addDays(today, -dow); break;
      case 'last_7': from = addDays(today, -6); break;
      case 'month': from = today.slice(0, 8) + '01'; break;
      case 'last_30': from = addDays(today, -29); break;
      case 'last_month': { const first = today.slice(0, 8) + '01'; to = addDays(first, -1); from = to.slice(0, 8) + '01'; break; }
      case 'year': from = today.slice(0, 4) + '-01-01'; break;
      default: {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z) throw new ForecastCenterError('Choose a From and a To date.', 'FC_INVALID_PERIOD');
        if (a > z) throw new ForecastCenterError('The From date must be on or before the To date.', 'FC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today, tz };
  }

  /** one row per forecast run this role may see, with its evaluation so far */
  private runs(ctx: FcCtx, domains: string[], today: string) {
    return sql`(select p.run_id, min(p.domain) as domain, min(p.entity_id::text) as entity_id, min(p.model) as model, min(p.model_version) as model_version,
          min(p.branch_id::text) as branch_id, min(p.generated_at) as generated_at, count(*)::int as days,
          min(p.target_date) as first_day, max(p.target_date) as last_day, max(p.interval_level) as interval_level,
          max(p.confidence) as confidence, max(p.data_quality) as data_quality, max(p.backtest_wape) as backtest_wape,
          count(*) filter (where p.target_date < ${today}::date)::int as matured, count(p.realized_value)::int as realized,
          sum(p.abs_error) filter (where p.realized_value is not null) as err_sum,
          sum(abs(p.realized_value)) filter (where p.realized_value is not null) as actual_sum,
          count(*) filter (where p.within_interval)::int as inside
        from forecast_points p
        where p.tenant_id = ${ctx.tenantId} and ${this.scope(sql`p.branch_id`, ctx).w} and p.domain = any(${domains}::text[])
        group by p.run_id) r`;
  }
  private status(r: Row) {
    return N(r.realized) >= N(r.days) ? 'evaluated' : N(r.realized) > 0 ? 'partial' : N(r.matured) > 0 ? 'awaiting' : 'pending';
  }
  private shape(r: Row) {
    const realized = N(r.realized);
    return {
      runId: String(r.run_id), domain: r.domain, model: r.model, modelVersion: r.model_version,
      branchId: r.branch_id ?? null, branch: r.branch ?? null, entityId: r.entity_id ?? null, product: r.product ?? null,
      generatedAt: iso(r.generated_at), days: N(r.days), firstDay: ymd(r.first_day), lastDay: ymd(r.last_day),
      intervalLevel: num(r.interval_level), confidence: r.confidence ?? null, dataQuality: r.data_quality ?? null,
      backtestWape: num(r.backtest_wape), status: this.status(r), matured: N(r.matured), realized,
      // WAPE over the days that have an actual; null when there is none (never a fabricated 0)
      wape: realized && N(r.actual_sum) > 0 ? N(r.err_sum) / N(r.actual_sum) : null,
      coverage: realized ? N(r.inside) / realized : null,
    };
  }

  // ── counters ───────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: FcCtx) {
    const domains = this.need(ctx);
    const { today, tz } = await this.today(ctx);
    const c = (await sql<Row>`select count(*)::int as runs, count(*) filter (where r.generated_at > now() - interval '30 days')::int as runs30,
        coalesce(sum(r.matured - r.realized), 0)::int as awaiting, coalesce(sum(r.realized), 0)::int as evaluated
      from ${this.runs(ctx, domains, today)}`.execute(this.db)).rows[0] ?? {};
    const last = (await sql<Row>`select r.domain, max(r.generated_at) as at from ${this.runs(ctx, domains, today)} group by r.domain`.execute(this.db)).rows;
    return {
      counters: { runs: N(c.runs), runs30d: N(c.runs30), awaitingActual: N(c.awaiting), evaluatedDays: N(c.evaluated) },
      lastRun: Object.fromEntries(domains.map((d) => [d, iso(last.find((x) => x.domain === d)?.at)])),
      domains, period: { today, timeZone: tz },
    };
  }

  // ── the forecast history ───────────────────────────────────────────────────────────────────────────────────
  async list(ctx: FcCtx, f: Record<string, unknown>) {
    const domains = this.need(ctx);
    const pageSize = (FC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const domain = pick(FC_DOMAINS, f.domain) ?? 'all';
    const status = pick(FC_STATUSES, f.status) ?? 'all';
    const sort = pick(FC_SORTS, f.sort) ?? 'newest';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const where = [sql`true`];
    if (domain !== 'all') where.push(sql`r.domain = ${domain}`);
    const ST = sql`case when r.realized >= r.days then 'evaluated' when r.realized > 0 then 'partial' when r.matured > 0 then 'awaiting' else 'pending' end`;
    if (status !== 'all') where.push(sql`${ST} = ${status}`);
    if (per.start && per.end) where.push(sql`r.generated_at >= ${per.start} and r.generated_at < ${per.end}`);
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      const idq = q.toLowerCase().replace(/[^0-9a-f-]/g, '');
      where.push(sql`(r.model ilike ${like} or r.model_version ilike ${like} or coalesce(b.name, '') ilike ${like} or coalesce(ip.name, '') ilike ${like}
        or ${idq.length >= 4 && idq.length === q.length ? sql`r.run_id::text like ${idq + '%'}` : sql`false`})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`${this.runs(ctx, domains, per.today)}
      left join branches b on b.id = r.branch_id::uuid and b.tenant_id = ${ctx.tenantId}
      left join inventory_products ip on ip.id = r.entity_id::uuid and ip.tenant_id = ${ctx.tenantId}`;
    const order = sort === 'oldest' ? sql`r.generated_at asc, r.run_id asc` : sql`r.generated_at desc, r.run_id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select r.*, b.name as branch, ip.name as product from ${FROM} where ${W} order by ${order}
      limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => this.shape(r)),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, domain, status, sort, preset: per.preset, from: per.from, to: per.to },
      period: { today: per.today, timeZone: per.tz }, domains,
    };
  }

  // ── one run: forecast vs actual ────────────────────────────────────────────────────────────────────────────
  async run(ctx: FcCtx, runId: string) {
    const domains = this.need(ctx);
    if (!isUuid(runId)) throw new ForecastCenterError('That forecast run was not found.', 'FC_RUN_NOT_FOUND', 404);
    const { today } = await this.today(ctx);
    const head = (await sql<Row>`select r.*, b.name as branch, ip.name as product from ${this.runs(ctx, domains, today)}
      left join branches b on b.id = r.branch_id::uuid and b.tenant_id = ${ctx.tenantId}
      left join inventory_products ip on ip.id = r.entity_id::uuid and ip.tenant_id = ${ctx.tenantId}
      where r.run_id = ${runId}::uuid`.execute(this.db)).rows[0];
    if (!head) throw new ForecastCenterError('That forecast run was not found.', 'FC_RUN_NOT_FOUND', 404);
    const pts = (await sql<Row>`select horizon_step, target_date, point_value, lower_value, upper_value, realized_value, abs_error, within_interval, realized_at
      from forecast_points where tenant_id = ${ctx.tenantId} and run_id = ${runId}::uuid and ${this.scope(sql`branch_id`, ctx).w}
      order by horizon_step asc, target_date asc`.execute(this.db)).rows;
    return {
      run: this.shape(head),
      days: pts.map((p) => {
        const day = ymd(p.target_date) as string;
        return { step: N(p.horizon_step), date: day, forecast: Number(p.point_value), lower: Number(p.lower_value), upper: Number(p.upper_value),
          actual: num(p.realized_value), error: num(p.abs_error), inside: p.within_interval ?? null, evaluatedAt: iso(p.realized_at),
          state: p.realized_value != null ? 'evaluated' : day < today ? 'awaiting' : 'pending' };
      }),
    };
  }

  // ── Check AI Analytics & Forecasting System — read-only ───────────────────────────────────────────────────
  async check(ctx: FcCtx, probes: FcProbes) {
    const domains = this.need(ctx);
    const T = ctx.tenantId;
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from forecasting_health_runs where tenant_id = ${T} and branch_id is not distinct from ${isUuid(ctx.branchId) ? ctx.branchId : null}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const { today } = await this.today(ctx);
    const checks: FcCheck[] = [];
    const one = async (q: { execute: (db: Kysely<any>) => Promise<{ rows: Row[] }> }): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const A = this.scope(sql`a.branch_id`, ctx).w;

    // 1 · the history the models train on (the forecast services' own series — booking calendar, zero-filled)
    if (domains.includes('appointments')) {
      const r = await probes.appointments();
      checks.push({ key: 'appointment_history', component: 'booking_calendar', state: !r.historyDays ? 'INSUFFICIENT_DATA' : r.ready ? 'PASSED' : 'WARNING',
        count: r.historyDays, detail: { minimum: r.minimum, zeroDays: r.zeroDays, lastDay: r.lastDay } });
      const fresh = await one(sql<Row>`select max(a.created_at) as last, count(*) filter (where a.created_at > now() - interval '7 days')::int as n7
        from pos_tech_appointments a where a.tenant_id = ${T} and ${A}`);
      checks.push({ key: 'booking_connection', component: 'booking_calendar', state: !fresh.last ? 'INSUFFICIENT_DATA' : N(fresh.n7) ? 'PASSED' : 'WARNING',
        count: N(fresh.n7), detail: { lastBookingAt: iso(fresh.last) } });
    }
    if (domains.includes('revenue')) {
      const r = await probes.revenue();
      if ('restricted' in r) checks.push({ key: 'revenue_history', component: 'sales_report', state: 'INSUFFICIENT_DATA', detail: { restricted: true } });
      else checks.push({ key: 'revenue_history', component: 'sales_report', state: !r.historyDays ? 'INSUFFICIENT_DATA' : r.ready ? 'PASSED' : 'WARNING',
        count: r.historyDays, detail: { minimum: r.minimum, zeroDays: r.zeroDays } });
    }

    // 2 · data quality of the appointment history (last 180 days)
    const dq = await one(sql<Row>`select
        count(*) filter (where a.duration_minutes < 0 or a.duration_minutes > 720 or not (a.start_time ~ '^[0-9]{2}:[0-9]{2}$' and a.end_time ~ '^[0-9]{2}:[0-9]{2}$')
          or (a.start_time ~ '^[0-9]{2}:[0-9]{2}$' and a.end_time ~ '^[0-9]{2}:[0-9]{2}$' and (a.end_time <= a.start_time or a.end_time::time - a.start_time::time > interval '12 hours')))::int as bad_duration,
        count(*) filter (where a.status = any(${OPEN_STATUSES}::text[]) and a.appt_date < ${today}::date - 1)::int as no_outcome,
        count(*) filter (where a.appt_date < ${today}::date)::int as past,
        count(*) filter (where a.status in ('completed', 'no_show') and a.appt_date < ${today}::date)::int as labelled,
        count(*) filter (where a.status = 'no_show' and a.appt_date < ${today}::date)::int as no_shows
      from pos_tech_appointments a where a.tenant_id = ${T} and ${A} and a.appt_date >= ${today}::date - 180`);
    const dup = N((await one(sql<Row>`select coalesce(sum(n - 1), 0)::int as n from (select count(*)::int as n from pos_tech_appointments a
      where a.tenant_id = ${T} and ${A} and a.status <> 'cancelled' and a.appt_date >= ${today}::date - 180
        and (a.customer_id is not null or a.customer_phone is not null)
      group by a.branch_id, a.technician_id, a.appt_date, a.start_time, coalesce(a.customer_id::text, a.customer_phone) having count(*) > 1) z`)).n);
    checks.push({ key: 'duplicate_appointments', component: 'data_quality', state: dup ? 'WARNING' : N(dq.past) ? 'PASSED' : 'INSUFFICIENT_DATA', count: dup });
    checks.push({ key: 'invalid_durations', component: 'data_quality', state: N(dq.bad_duration) ? 'WARNING' : N(dq.past) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(dq.bad_duration) });
    const noOutcome = N(dq.no_outcome);
    checks.push({ key: 'missing_outcomes', component: 'data_quality', state: !N(dq.past) ? 'INSUFFICIENT_DATA' : noOutcome * 5 > N(dq.past) ? 'FAILED' : noOutcome ? 'WARNING' : 'PASSED',
      count: noOutcome, detail: { pastAppointments: N(dq.past) } });
    checks.push({ key: 'noshow_labels', component: 'no_show_model', state: !N(dq.labelled) ? 'INSUFFICIENT_DATA' : 'PASSED',
      count: N(dq.labelled), detail: { noShows: N(dq.no_shows) } });

    // 3 · the stored forecasts and their evaluation
    const P = this.scope(sql`p.branch_id`, ctx).w;
    const st = await one(sql<Row>`select count(distinct p.run_id)::int as runs, count(distinct p.run_id) filter (where p.generated_at > now() - interval '7 days')::int as runs7,
        max(p.generated_at) as last,
        count(*) filter (where p.lower_value > p.point_value or p.point_value > p.upper_value or p.lower_value < 0)::int as bad_range,
        count(*) filter (where p.realized_value is null and p.target_date < ${today}::date - 3)::int as awaiting,
        count(*) filter (where p.realized_value is not null)::int as realized,
        count(*) filter (where p.within_interval)::int as inside
      from forecast_points p where p.tenant_id = ${T} and ${P} and p.domain = any(${domains}::text[])`);
    checks.push({ key: 'forecast_storage', component: 'forecast_record', state: !N(st.runs) ? 'INSUFFICIENT_DATA' : N(st.runs7) ? 'PASSED' : 'WARNING',
      count: N(st.runs7), detail: { runs: N(st.runs), lastRunAt: iso(st.last) } });
    checks.push({ key: 'forecast_ranges', component: 'forecast_record', state: N(st.bad_range) ? 'FAILED' : N(st.runs) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(st.bad_range) });
    checks.push({ key: 'evaluation', component: 'accuracy_tracking', state: N(st.awaiting) ? 'WARNING' : N(st.realized) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(st.awaiting) });
    const realized = N(st.realized); const cov = realized ? N(st.inside) / realized : null;
    checks.push({ key: 'interval_coverage', component: 'accuracy_tracking', state: realized < 10 ? 'INSUFFICIENT_DATA' : (cov as number) < FC_MIN_COVERAGE ? 'WARNING' : 'PASSED',
      count: realized, detail: { coverage: cov, minimum: FC_MIN_COVERAGE } });
    const bt = (await sql<Row>`select distinct on (p.domain) p.domain, p.backtest_wape from forecast_points p where p.tenant_id = ${T} and ${P}
      and p.domain in ('appointments', 'revenue') and p.domain = any(${domains}::text[]) order by p.domain, p.generated_at desc, p.run_id desc`.execute(this.db)).rows;
    const noBt = bt.filter((r) => r.backtest_wape == null).map((r) => r.domain);
    checks.push({ key: 'backtest', component: 'model', state: !bt.length ? 'INSUFFICIENT_DATA' : noBt.length ? 'WARNING' : 'PASSED', count: noBt.length, detail: { notAvailable: noBt } });

    // 4 · the subscription gate and isolation
    const mode = enforcementMode();
    const blocked = N((await one(sql<Row>`select count(*)::int as n from ai_usage_logs where tenant_id = ${T} and package_code = 'ai_analytics_forecasting'
      and status like 'blocked%' and created_at > now() - interval '7 days'`)).n);
    checks.push({ key: 'entitlement', component: 'subscription', state: !blocked ? 'PASSED' : mode === 'enforce' ? 'FAILED' : 'WARNING', count: blocked, detail: { mode } });
    const cross = N((await one(sql<Row>`select count(*)::int as n from forecast_points p join branches b on b.id = p.branch_id
      where p.tenant_id = ${T} and b.tenant_id <> p.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', component: 'security', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', component: 'security', state: 'PASSED' });

    // when each check last passed (from this salon's earlier checks)
    const prev = (await sql<Row>`select c->>'key' as key, max(h.created_at) as at from forecasting_health_runs h cross join lateral jsonb_array_elements(h.checks) c
      where h.tenant_id = ${T} and h.branch_id is not distinct from ${isUuid(ctx.branchId) ? ctx.branchId : null} and c->>'state' = 'PASSED' group by 1`.execute(this.db)).rows;
    const checkedAt = new Date(this.now()).toISOString();
    for (const c of checks) c.lastPassedAt = c.state === 'PASSED' ? checkedAt : iso(prev.find((p) => p.key === c.key)?.at);

    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED' && x.key !== 'no_side_effects' && x.key !== 'tenant_isolation' && x.key !== 'entitlement') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('forecasting-health:' || ${T} || ':' || coalesce(${isUuid(ctx.branchId) ? ctx.branchId : null}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into forecasting_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt, reused: false };
    });
  }
}
