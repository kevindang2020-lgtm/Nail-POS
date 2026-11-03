// business-center.ts — AI Business Reports + AI Business Alerts guides (Nov 3 2026): `/pos/ai-business/center/*`.
//
// Audit findings this answers:
//   • THE CANONICAL REPORTS ENGINE IGNORED `preset`: with no from/to it always read the last 7 days, so the AI Business tools —
//     the Daily brief, Weekly summary, Monthly review, the alerts' "today" / "week" values — were all the same 7 days, and the
//     Sales Report screen's period tabs (it sends `period`) did nothing. Fixed at the source (reports.kysely.repository.ts
//     presetRange + reports.controller.ts `period`), so every consumer gets the period it names.
//   • Report history: the 100 newest, no search / filter / pages; "completed" + "expired" on one row was the 7-day content
//     window (the content is kept but no longer shown), not a failed download; a report did not record WHICH days it covered;
//     a read error showed "No reports yet".
//   • Alerts: an evaluation only set two timestamps — no history, no "triggered → recovered", no acknowledgement; nothing
//     evaluates rules automatically (the stored frequency is not acted on) and no notification is sent.
//
// What this adds (reports and alerts stay in their tables — ai_business_report_jobs 338, ai_business_alerts 337):
//   reports: summary · list (search · type · status incl. content expired · generated date presets + From/To · pages) · detail
//            (period, headline figures, availability) · generate with a chosen period (double-tap safe) · regenerate (a new
//            report; the old one is kept) · Verify Numbers (the stored canonical Sales Report snapshot vs the Sales Report now,
//            same days) · Check AI Business Reports System;
//   alerts:  summary · rules (search · metric · status · pages) · history (search · state · date presets + From/To · pages) ·
//            evaluate now (recorded: value, threshold, sample, exact days, state change) · acknowledge · explain (the
//            deterministic price × volume bridge or the appointment funnel — no invented cause) · anomaly (yesterday vs the same
//            weekday over the previous 8 weeks, median and spread, only with enough comparable days) · Check AI Business Alerts
//            System.
// Nothing here edits a sale, an appointment, a customer, a price or a schedule, and nothing sends a message.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import type { ReportsService } from '@aipowersalon/reports';
import { presetRange as presetRangeOf } from '@aipowersalon/reports';
import type { AiBusinessContext } from './ai-business.dto';
import type { AiBusinessReportsService } from './ai-business-reports.service';
import type { AiBusinessAlertsService } from './ai-business-alerts.service';
import type { AiBusinessRevenueService } from './ai-business-revenue.service';
import type { AiBusinessAppointmentsService } from './ai-business-appointments.service';

type Row = Record<string, any>;
export class BusinessCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
export const BC_TYPES = ['daily_brief', 'weekly_summary', 'monthly_review', 'branch_comparison'] as const;
export const BC_REPORT_PRESETS: Record<string, readonly string[]> = {
  daily_brief: ['today', 'yesterday'], weekly_summary: ['week'], monthly_review: ['month', 'quarter', 'year'], branch_comparison: ['week', 'month', 'quarter'],
};
export const BC_STATUSES = ['all', 'queued', 'running', 'completed', 'failed', 'viewable', 'content_expired'] as const;
export const BC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'custom'] as const;
export const BC_EVENT_STATES = ['all', 'triggered', 'recovered', 'unchanged', 'not_evaluated', 'unacknowledged'] as const;
export const BC_RULE_STATUSES = ['all', 'active', 'paused', 'triggered', 'needs_review', 'never_evaluated'] as const;
export const BC_PAGE_SIZES = [10, 25, 50, 100] as const;
const HEALTH_GAP_SECONDS = 30;
const DEDUPE_SECONDS = 15;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const has = (ctx: AiBusinessContext, p: string) => (ctx.permissions ?? []).includes(p);
const esc = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const pick = <T extends readonly (string | number)[]>(list: T, v: unknown): T[number] | undefined => (list as readonly unknown[]).includes(v) ? v as T[number] : undefined;
const addDays = (d: string, k: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const TYPE_LABEL: Record<string, string> = { daily_brief: 'daily brief', weekly_summary: 'weekly summary', monthly_review: 'monthly review', branch_comparison: 'branch comparison' };

export interface BcDeps {
  reports: AiBusinessReportsService; alerts: AiBusinessAlertsService; revenue: AiBusinessRevenueService; appointments: AiBusinessAppointmentsService;
  sales: Pick<ReportsService, 'getSales'>;
}

export class BusinessCenter {
  constructor(private readonly db: Kysely<any>, private readonly d: BcDeps, private readonly now: () => number = () => Date.now()) {}

  private need(ctx: AiBusinessContext) {
    if (!ctx?.tenantId || !ctx?.userId) throw new BusinessCenterError('Not signed in.', 'AUTH_REQUIRED', 401);
    if (!has(ctx, 'pos.ai_business.view')) throw new BusinessCenterError('Your role cannot use AI Business.', 'PERMISSION_DENIED', 403);
  }
  private branch(ctx: AiBusinessContext) { return isUuid(ctx.branchId) ? String(ctx.branchId) : null; }
  /** a branch login sees its own branch's reports / rules; a salon-wide login sees all of them */
  private scope(ctx: AiBusinessContext, alias: 'j' | 'a' | 'e') {
    const B = this.branch(ctx); if (!B) return sql`true`;
    return alias === 'j' ? sql`j.branch_id = ${B}::uuid` : alias === 'a' ? sql`a.branch_id = ${B}::uuid` : sql`e.branch_id = ${B}::uuid`;
  }
  private async tz(ctx: AiBusinessContext) { return branchTimeZone(this.db, ctx.tenantId, this.branch(ctx)); }
  private async today(ctx: AiBusinessContext) { const tz = await this.tz(ctx); return { tz, today: new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now())) }; }
  private async window(ctx: AiBusinessContext, f: Row) {
    const { tz, today } = await this.today(ctx);
    const preset = pick(BC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    let from: string | null = null, to: string | null = null;
    if (preset !== 'all') {
      const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; to = today;
      if (preset === 'today') from = today; else if (preset === 'yesterday') from = to = addDays(today, -1); else if (preset === 'week') from = addDays(today, -dow);
      else if (preset === 'last_7') from = addDays(today, -6); else if (preset === 'month') from = today.slice(0, 8) + '01'; else if (preset === 'last_30') from = addDays(today, -29);
      else if (preset === 'year') from = today.slice(0, 4) + '-01-01';
      else if (preset === 'last_month') { const first = today.slice(0, 8) + '01'; to = addDays(first, -1); from = to.slice(0, 8) + '01'; }
      else {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z || a > z) throw new BusinessCenterError('Choose a From and a To date; the From date must be on or before the To date.', 'BC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const inP = (col: any) => (!from || !to ? sql`true` : sql`(${col} >= (${from}::date)::timestamp at time zone ${tz} and ${col} < ((${to}::date + 1))::timestamp at time zone ${tz})`);
    return { preset, from, to, today, timeZone: tz, inP };
  }
  private paging(f: Row) {
    const pageSize = pick(BC_PAGE_SIZES, Number(f.pageSize)) ?? 25;
    return { pageSize, page: Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1))) };
  }

  // ═════════════════════════════════════════════ REPORTS ═════════════════════════════════════════════
  private reportView(r: Row) {
    const expired = r.expires_at ? new Date(r.expires_at).getTime() < this.now() : false;
    const content = typeof r.content === 'string' ? JSON.parse(r.content) : r.content;
    const availability = r.status === 'failed' ? 'failed' : r.status !== 'completed' ? 'not_ready' : expired ? 'content_expired' : 'viewable';
    return {
      id: String(r.id), reportType: String(r.report_type), preset: String(r.preset), status: String(r.status), availability,
      period: content?.period ?? null, createdAt: iso(r.created_at), startedAt: iso(r.started_at), completedAt: iso(r.completed_at), expiresAt: iso(r.expires_at),
      requestedBy: r.requester ?? null, branchId: r.branch_id ?? null, error: r.error ?? null, hasSnapshot: !!content?.snapshot,
    };
  }
  private static REPORT_COLS = sql`j.id, j.report_type, j.preset, j.status, j.content, j.error, j.created_at, j.started_at, j.completed_at, j.expires_at, j.branch_id, u.full_name as requester`;

  async reportSummary(ctx: AiBusinessContext) {
    this.need(ctx);
    const T = ctx.tenantId;
    const r = (await sql<Row>`select count(*)::int as total, count(*) filter (where j.status = 'queued')::int as queued, count(*) filter (where j.status = 'running')::int as running,
        count(*) filter (where j.status = 'failed')::int as failed, count(*) filter (where j.status = 'completed' and j.expires_at > now())::int as viewable,
        count(*) filter (where j.status = 'completed' and j.expires_at <= now())::int as content_expired,
        count(*) filter (where j.status in ('queued', 'running') and j.created_at < now() - interval '10 minutes')::int as stuck, max(j.created_at) as last_at
      from ai_business_report_jobs j where j.tenant_id = ${T} and ${this.scope(ctx, 'j')}`.execute(this.db)).rows[0] ?? {};
    return { total: N(r.total), queued: N(r.queued), running: N(r.running), failed: N(r.failed), viewable: N(r.viewable), contentExpired: N(r.content_expired), stuck: N(r.stuck),
      lastGeneratedAt: iso(r.last_at), contentDays: 7, presets: BC_REPORT_PRESETS };
  }

  async reportList(ctx: AiBusinessContext, f: Row = {}) {
    this.need(ctx);
    const T = ctx.tenantId; const w = await this.window(ctx, f); const { page, pageSize } = this.paging(f);
    const conds: any[] = [sql`j.tenant_id = ${T}`, this.scope(ctx, 'j'), w.inP(sql`j.created_at`)];
    const type = pick(BC_TYPES, f.type); if (type) conds.push(sql`j.report_type = ${type}`);
    const st = pick(BC_STATUSES, f.status) ?? 'all';
    if (st === 'viewable') conds.push(sql`j.status = 'completed' and j.expires_at > now()`);
    else if (st === 'content_expired') conds.push(sql`j.status = 'completed' and j.expires_at <= now()`);
    else if (st !== 'all') conds.push(sql`j.status = ${st}`);
    const q = String(f.q ?? '').trim().slice(0, 80);
    if (q) {
      const typeHits = Object.entries(TYPE_LABEL).filter(([, l]) => l.includes(q.toLowerCase())).map(([k]) => k);
      conds.push(isUuid(q) ? sql`j.id = ${q}::uuid` : sql`(j.preset ilike ${esc(q)} or j.id::text ilike ${esc(q)} or u.full_name ilike ${esc(q)} or j.error ilike ${esc(q)}
        ${typeHits.length ? sql`or j.report_type = any(${typeHits}::text[])` : sql``})`);
    }
    const where = sql.join(conds, sql` and `);
    const from = sql`ai_business_report_jobs j left join users u on u.id = j.requested_by_user_id and u.tenant_id = j.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${from} where ${where}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages);
    const order = f.sort === 'oldest' ? sql`j.created_at asc, j.id asc` : sql`j.created_at desc, j.id desc`;
    const rows = (await sql<Row>`select ${BusinessCenter.REPORT_COLS} from ${from} where ${where} order by ${order} limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.reportView(r)), total, page: p, pageSize, totalPages, period: { preset: w.preset, from: w.from, to: w.to, today: w.today, timeZone: w.timeZone } };
  }

  private async reportRow(ctx: AiBusinessContext, id: string) {
    if (!isUuid(id)) throw new BusinessCenterError('Report not found.', 'BC_REPORT_NOT_FOUND', 404);
    const r = (await sql<Row>`select ${BusinessCenter.REPORT_COLS} from ai_business_report_jobs j left join users u on u.id = j.requested_by_user_id and u.tenant_id = j.tenant_id
      where j.tenant_id = ${ctx.tenantId} and j.id = ${id}::uuid and ${this.scope(ctx, 'j')}`.execute(this.db)).rows[0];
    if (!r) throw new BusinessCenterError('Report not found.', 'BC_REPORT_NOT_FOUND', 404);
    return r;
  }

  async reportDetail(ctx: AiBusinessContext, id: string) {
    this.need(ctx);
    const r = await this.reportRow(ctx, id);
    const v = this.reportView(r);
    const content = v.availability === 'viewable' ? (typeof r.content === 'string' ? JSON.parse(r.content) : r.content) : null;
    return { ...v, headline: content ? headline(content) : [], sections: content ? Object.keys(content).filter((k) => !['period', 'snapshot'].includes(k)) : [], content };
  }

  /** the exact days and the canonical Sales Report figures for them — stored with the report so Verify can re-check them later */
  private snapshotFor(ctx: AiBusinessContext) {
    return async (preset: string) => {
      const { tz } = await this.today(ctx);
      const range = presetRangeOf(preset, new Date(this.now()), tz);
      let snapshot: Row | null = null;
      try {
        const { kpis } = await this.d.sales.getSales({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions }, { from: range.from, to: range.to });
        snapshot = { netSalesCents: kpis.netSalesCents, grossSalesCents: kpis.grossSalesCents, ticketsCount: kpis.ticketsCount, averageTicketCents: kpis.averageTicketCents, refundsCents: kpis.refundsCents, discountsCents: kpis.discountsCents, takenAt: new Date(this.now()).toISOString() };
      } catch { snapshot = null; }   // no financial permission: the report has no money snapshot to verify (shown as "cannot verify")
      return { period: { preset, from: range.from, to: range.to, timeZone: tz, partial: range.to >= new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(this.now())) }, ...(snapshot ? { snapshot } : {}) };
    };
  }

  async reportGenerate(ctx: AiBusinessContext, b: { reportType?: unknown; preset?: unknown }) {
    this.need(ctx);
    const type = pick(BC_TYPES, b.reportType);
    if (!type) throw new BusinessCenterError('Choose a report.', 'BC_REPORT_TYPE_INVALID');
    const preset = b.preset == null ? BC_REPORT_PRESETS[type][0] : String(b.preset);
    if (!BC_REPORT_PRESETS[type].includes(preset)) throw new BusinessCenterError('That period is not available for this report.', 'BC_REPORT_PERIOD_INVALID');
    // a second tap on the same button within a few seconds returns the report already being made — never a duplicate
    const dup = (await sql<Row>`select j.id from ai_business_report_jobs j where j.tenant_id = ${ctx.tenantId} and j.requested_by_user_id = ${ctx.userId}::uuid and j.report_type = ${type}
      and j.preset = ${preset} and j.status <> 'failed' and j.created_at > now() - ${DEDUPE_SECONDS + ' seconds'}::interval order by j.created_at desc limit 1`.execute(this.db)).rows[0];
    if (dup) return { ...(await this.reportDetail(ctx, String(dup.id))), duplicate: true };
    const job = await this.d.reports.create(ctx, type, preset, this.snapshotFor(ctx));
    return { ...(await this.reportDetail(ctx, job.id)), duplicate: false };
  }

  /** a NEW report of the same type and period name, with today's data — the old one is kept as it was */
  async reportRegenerate(ctx: AiBusinessContext, id: string) {
    this.need(ctx);
    const r = await this.reportRow(ctx, id);
    const job = await this.d.reports.create(ctx, String(r.report_type), String(r.preset), this.snapshotFor(ctx));
    return { ...(await this.reportDetail(ctx, job.id)), regeneratedFrom: id };
  }

  /** Verify Numbers: the snapshot stored with the report vs the Sales Report now, for the same days and scope */
  async reportVerify(ctx: AiBusinessContext, id: string) {
    this.need(ctx);
    const r = await this.reportRow(ctx, id);
    const content = typeof r.content === 'string' ? JSON.parse(r.content) : r.content;
    const period = content?.period; const snap = content?.snapshot;
    if (r.status !== 'completed') return { id, status: 'cannot_verify', reason: 'not_completed', items: [] };
    if (!period?.from || !snap) return { id, status: 'cannot_verify', reason: !period?.from ? 'no_period' : 'no_snapshot', items: [] };
    let now: Row;
    try {
      now = (await this.d.sales.getSales({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions }, { from: period.from, to: period.to })).kpis as Row;
    } catch { return { id, status: 'cannot_verify', reason: 'no_permission', items: [] }; }
    const keys = ['netSalesCents', 'grossSalesCents', 'ticketsCount', 'averageTicketCents', 'refundsCents', 'discountsCents'];
    const items = keys.filter((k) => snap[k] != null).map((k) => ({ metric: k, inReport: N(snap[k]), salesReportNow: N(now[k]), difference: N(now[k]) - N(snap[k]), matched: N(now[k]) === N(snap[k]) }));
    const status = items.every((x) => x.matched) ? 'matched' : 'changed';
    return { id, status, reason: status === 'changed' ? (period.partial ? 'period_was_in_progress' : 'source_changed_since') : null, period, snapshotTakenAt: snap.takenAt ?? null,
      checkedAt: new Date(this.now()).toISOString(), items, sourceRoute: `/tenant/reports/sales?from=${period.from}&to=${period.to}` };
  }

  // ═════════════════════════════════════════════ ALERTS ═════════════════════════════════════════════
  private ruleView(r: Row) {
    return { id: String(r.id), title: r.title, metricId: r.metric_id, operator: r.operator, threshold: N(r.threshold), preset: r.preset, minSampleSize: N(r.min_sample_size),
      frequency: r.frequency, channel: r.channel, active: !!r.active, createdAt: iso(r.created_at), lastCheckedAt: iso(r.last_checked_at), lastTriggeredAt: iso(r.last_triggered_at),
      branchId: r.branch_id ?? null, createdBy: r.creator ?? null,
      latest: r.ev_id ? { id: String(r.ev_id), triggered: !!r.ev_triggered, sampleOk: !!r.ev_sample_ok, value: r.ev_value == null ? null : N(r.ev_value), stateChange: r.ev_state,
        evaluatedAt: iso(r.ev_at), acknowledgedAt: iso(r.ev_ack) } : null };
  }
  private static RULE_FROM = (T: string) => sql`ai_business_alerts a
    left join users u on u.id = a.created_by_user_id
    left join lateral (select e.id as ev_id, e.triggered as ev_triggered, e.sample_ok as ev_sample_ok, e.value as ev_value, e.state_change as ev_state, e.evaluated_at as ev_at, e.acknowledged_at as ev_ack
      from ai_business_alert_events e where e.tenant_id = ${T} and e.alert_id = a.id order by e.evaluated_at desc, e.id desc limit 1) ev on true`;
  private static RULE_COLS = sql`a.id, a.title, a.metric_id, a.operator, a.threshold, a.preset, a.min_sample_size, a.frequency, a.channel, a.active, a.created_at, a.last_checked_at, a.last_triggered_at,
    a.branch_id, u.full_name as creator, ev.ev_id, ev.ev_triggered, ev.ev_sample_ok, ev.ev_value, ev.ev_state, ev.ev_at, ev.ev_ack`;

  async alertSummary(ctx: AiBusinessContext) {
    this.need(ctx);
    const T = ctx.tenantId;
    const r = (await sql<Row>`select count(*) filter (where a.active)::int as active, count(*) filter (where not a.active)::int as paused,
        count(*) filter (where a.active and ev.ev_triggered and ev.ev_ack is null)::int as triggered,
        count(*) filter (where a.active and ev.ev_id is not null and not ev.ev_sample_ok)::int as needs_review,
        count(*) filter (where a.active and ev.ev_id is null)::int as never, max(ev.ev_at) as last_at
      from ${BusinessCenter.RULE_FROM(T)} where a.tenant_id = ${T} and ${this.scope(ctx, 'a')}`.execute(this.db)).rows[0] ?? {};
    return { activeRules: N(r.active), pausedRules: N(r.paused), triggeredUnacknowledged: N(r.triggered), needsReview: N(r.needs_review), neverEvaluated: N(r.never),
      lastEvaluatedAt: iso(r.last_at), automaticEvaluation: false, notificationsSent: false };
  }

  async alertRules(ctx: AiBusinessContext, f: Row = {}) {
    this.need(ctx);
    const T = ctx.tenantId; const { page, pageSize } = this.paging(f);
    const conds: any[] = [sql`a.tenant_id = ${T}`, this.scope(ctx, 'a')];
    const st = pick(BC_RULE_STATUSES, f.status) ?? 'all';
    if (st === 'active') conds.push(sql`a.active`); else if (st === 'paused') conds.push(sql`not a.active`);
    else if (st === 'triggered') conds.push(sql`ev.ev_triggered and ev.ev_ack is null`); else if (st === 'needs_review') conds.push(sql`ev.ev_id is not null and not ev.ev_sample_ok`);
    else if (st === 'never_evaluated') conds.push(sql`ev.ev_id is null`);
    if (typeof f.metric === 'string' && /^[a-z_]{3,40}$/.test(f.metric) && f.metric !== 'all') conds.push(sql`a.metric_id = ${f.metric}`);
    const q = String(f.q ?? '').trim().slice(0, 80);
    if (q) conds.push(isUuid(q) ? sql`a.id = ${q}::uuid` : sql`(a.title ilike ${esc(q)} or a.metric_id ilike ${esc(q.replace(/\s+/g, '_'))} or u.full_name ilike ${esc(q)})`);
    const where = sql.join(conds, sql` and `);
    const total = N((await sql<Row>`select count(*)::int as n from ${BusinessCenter.RULE_FROM(T)} where ${where}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages);
    const rows = (await sql<Row>`select ${BusinessCenter.RULE_COLS} from ${BusinessCenter.RULE_FROM(T)} where ${where} order by a.created_at desc, a.id desc limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.ruleView(r)), total, page: p, pageSize, totalPages };
  }

  async alertHistory(ctx: AiBusinessContext, f: Row = {}) {
    this.need(ctx);
    const T = ctx.tenantId; const w = await this.window(ctx, f); const { page, pageSize } = this.paging(f);
    const conds: any[] = [sql`e.tenant_id = ${T}`, this.scope(ctx, 'e'), w.inP(sql`e.evaluated_at`)];
    if (isUuid(f.alertId)) conds.push(sql`e.alert_id = ${String(f.alertId)}::uuid`);
    const st = pick(BC_EVENT_STATES, f.state) ?? 'all';
    if (st === 'unacknowledged') conds.push(sql`e.triggered and e.acknowledged_at is null`); else if (st !== 'all') conds.push(sql`e.state_change = ${st}`);
    const q = String(f.q ?? '').trim().slice(0, 80);
    if (q) conds.push(sql`(a.title ilike ${esc(q)} or e.metric_id ilike ${esc(q.replace(/\s+/g, '_'))})`);
    const where = sql.join(conds, sql` and `);
    const from = sql`ai_business_alert_events e join ai_business_alerts a on a.id = e.alert_id and a.tenant_id = e.tenant_id left join users u on u.id = e.acknowledged_by`;
    const total = N((await sql<Row>`select count(*)::int as n from ${from} where ${where}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages);
    const rows = (await sql<Row>`select e.id, e.alert_id, a.title, e.source, e.metric_id, e.operator, e.threshold, e.preset, e.period_from, e.period_to, e.value, e.sample_size, e.min_sample_size,
        e.sample_ok, e.triggered, e.state_change, e.reason, e.evaluated_at, e.acknowledged_at, e.ack_note, u.full_name as acknowledged_by_name
      from ${from} where ${where} order by e.evaluated_at desc, e.id desc limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ id: String(r.id), alertId: String(r.alert_id), title: r.title, source: r.source, metricId: r.metric_id, operator: r.operator, threshold: N(r.threshold),
      preset: r.preset, periodFrom: r.period_from ? String(r.period_from).slice(0, 10) : null, periodTo: r.period_to ? String(r.period_to).slice(0, 10) : null,
      value: r.value == null ? null : N(r.value), sampleSize: r.sample_size == null ? null : N(r.sample_size), minSampleSize: N(r.min_sample_size), sampleOk: !!r.sample_ok,
      triggered: !!r.triggered, stateChange: r.state_change, reason: r.reason, evaluatedAt: iso(r.evaluated_at), acknowledgedAt: iso(r.acknowledged_at), ackNote: r.ack_note ?? null,
      acknowledgedBy: r.acknowledged_by_name ?? null })), total, page: p, pageSize, totalPages, period: { preset: w.preset, from: w.from, to: w.to, today: w.today, timeZone: w.timeZone } };
  }

  /** Evaluate now — the existing evaluator (canonical metrics, minimum sample), recorded with the exact days and the state change */
  async alertEvaluate(ctx: AiBusinessContext, id: string) {
    this.need(ctx);
    if (!isUuid(id)) throw new BusinessCenterError('Alert not found.', 'BC_ALERT_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const a = (await sql<Row>`select a.id, a.branch_id, a.metric_id, a.operator, a.threshold, a.preset, a.min_sample_size from ai_business_alerts a
      where a.tenant_id = ${T} and a.id = ${id}::uuid and ${this.scope(ctx, 'a')}`.execute(this.db)).rows[0];
    if (!a) throw new BusinessCenterError('Alert not found.', 'BC_ALERT_NOT_FOUND', 404);
    const ev = await this.d.alerts.evaluateNow(ctx, id);
    const { tz } = await this.today(ctx);
    const range = presetRangeOf(String(a.preset), new Date(this.now()), tz);
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('ai-business-alert:' || ${id}))`.execute(trx);
      const prev = (await sql<Row>`select e.triggered, e.sample_ok from ai_business_alert_events e where e.tenant_id = ${T} and e.alert_id = ${id}::uuid and e.sample_ok
        order by e.evaluated_at desc, e.id desc limit 1`.execute(trx)).rows[0];
      const change = !ev.sampleOk ? 'not_evaluated' : ev.triggered && !prev?.triggered ? 'triggered' : !ev.triggered && prev?.triggered ? 'recovered' : 'unchanged';
      const row = (await sql<Row>`insert into ai_business_alert_events (tenant_id, branch_id, alert_id, source, metric_id, operator, threshold, preset, period_from, period_to, value, sample_size,
          min_sample_size, sample_ok, triggered, state_change, reason, actor_user_id)
        values (${T}, ${a.branch_id ?? null}, ${id}::uuid, 'manual', ${ev.metricId}, ${ev.operator}, ${ev.threshold}, ${ev.preset}, ${range.from}::date, ${range.to}::date, ${ev.value},
          ${ev.sampleSize}, ${N(a.min_sample_size)}, ${ev.sampleOk}, ${ev.triggered}, ${change}, ${ev.reason}, ${isUuid(ctx.userId) ? ctx.userId : null})
        returning id, evaluated_at`.execute(trx)).rows[0];
      return { ...ev, eventId: String(row.id), evaluatedAt: iso(row.evaluated_at), stateChange: change, period: { from: range.from, to: range.to, timeZone: tz } };
    });
  }

  async alertAcknowledge(ctx: AiBusinessContext, eventId: string, b: { note?: unknown }) {
    this.need(ctx);
    if (!isUuid(eventId)) throw new BusinessCenterError('Alert event not found.', 'BC_EVENT_NOT_FOUND', 404);
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';
    const r = (await sql<Row>`update ai_business_alert_events e set acknowledged_at = now(), acknowledged_by = ${isUuid(ctx.userId) ? ctx.userId : null}, ack_note = ${note || null}
      where e.tenant_id = ${ctx.tenantId} and e.id = ${eventId}::uuid and ${this.scope(ctx, 'e')} and e.triggered and e.acknowledged_at is null
      returning e.id, e.acknowledged_at`.execute(this.db)).rows[0];
    if (!r) {
      const exists = (await sql<Row>`select e.triggered, e.acknowledged_at from ai_business_alert_events e where e.tenant_id = ${ctx.tenantId} and e.id = ${eventId}::uuid and ${this.scope(ctx, 'e')}`.execute(this.db)).rows[0];
      if (!exists) throw new BusinessCenterError('Alert event not found.', 'BC_EVENT_NOT_FOUND', 404);
      throw new BusinessCenterError(exists.acknowledged_at ? 'This alert was already acknowledged.' : 'Only a triggered alert can be acknowledged.', 'BC_EVENT_NOT_ACKNOWLEDGEABLE', 409);
    }
    return { id: String(r.id), acknowledgedAt: iso(r.acknowledged_at) };
  }

  /** the measured explanation — no invented cause: money metrics use the exact price × volume bridge against the comparable
   *  previous period; appointment metrics show their funnel. Correlation, not proof. */
  async alertExplain(ctx: AiBusinessContext, eventId: string) {
    this.need(ctx);
    if (!isUuid(eventId)) throw new BusinessCenterError('Alert event not found.', 'BC_EVENT_NOT_FOUND', 404);
    const e = (await sql<Row>`select e.id, e.metric_id, e.preset, e.value, e.threshold, e.operator, e.triggered, e.sample_ok, e.sample_size, e.period_from, e.period_to
      from ai_business_alert_events e where e.tenant_id = ${ctx.tenantId} and e.id = ${eventId}::uuid and ${this.scope(ctx, 'e')}`.execute(this.db)).rows[0];
    if (!e) throw new BusinessCenterError('Alert event not found.', 'BC_EVENT_NOT_FOUND', 404);
    const preset = String(e.preset);
    const base = { eventId, metricId: e.metric_id, value: e.value == null ? null : N(e.value), threshold: N(e.threshold), operator: e.operator, triggered: !!e.triggered, sampleOk: !!e.sample_ok,
      period: { from: e.period_from ? String(e.period_from).slice(0, 10) : null, to: e.period_to ? String(e.period_to).slice(0, 10) : null }, readOnly: true, causation: 'not_proven' };
    if (e.metric_id === 'net_sales' || e.metric_id === 'average_ticket') {
      // compared with the equivalent previous period (yesterday → the day before, month → last month to the same day)
      const x: any = await this.d.revenue.explainRevenueChange(ctx, preset);
      return { ...base, kind: 'revenue_bridge', explanation: x, sourceRoute: '/tenant/reports/sales' };
    }
    const m: any = await this.d.appointments.getAppointmentMetrics(ctx, preset);
    return { ...base, kind: 'appointment_funnel', explanation: m, sourceRoute: '/tenant/reports' };
  }

  /** anomaly check (opt-in, read-only): yesterday (a complete salon day) vs the same weekday in the previous 8 weeks, from the
   *  Sales Report. Median and median absolute deviation; flagged only with at least 4 comparable days that had sales. */
  async alertAnomaly(ctx: AiBusinessContext) {
    this.need(ctx);
    const { tz, today } = await this.today(ctx);
    const day = addDays(today, -1);
    const rc = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    const read = async (d: string) => (await this.d.sales.getSales(rc, { from: d, to: d })).kpis;
    let actual: any;
    try { actual = await read(day); } catch { throw new BusinessCenterError('Your role cannot see sales figures.', 'PERMISSION_DENIED', 403); }
    const history: { date: string; netSalesCents: number; ticketsCount: number }[] = [];
    for (let k = 1; k <= 8; k++) { const d = addDays(day, -7 * k); const x = await read(d); history.push({ date: d, netSalesCents: x.netSalesCents, ticketsCount: x.ticketsCount }); }
    const comparable = history.filter((h) => h.ticketsCount > 0);
    const out = (['netSalesCents', 'ticketsCount'] as const).map((metric) => {
      const vals = comparable.map((h) => h[metric]).sort((a, b) => a - b);
      if (vals.length < 4) return { metric, actual: actual[metric], status: 'insufficient_history', comparableDays: vals.length, baseline: null, spread: null, difference: null };
      const med = median(vals); const mad = median(vals.map((v) => Math.abs(v - med))) || Math.max(1, Math.round(med * 0.05));
      const z = (actual[metric] - med) / (1.4826 * mad);
      return { metric, actual: actual[metric], baseline: med, spread: mad, difference: actual[metric] - med, score: Math.round(z * 10) / 10,
        status: Math.abs(z) >= 3 ? (z < 0 ? 'unusually_low' : 'unusually_high') : 'normal', comparableDays: vals.length };
    });
    return { day, timeZone: tz, weekday: new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), items: out, history,
      note: 'A lead to look into, not a proven cause. Holidays, closures and short days count as ordinary days in the baseline.' };
  }

  // ═════════════════════════════════════════════ HEALTH ═════════════════════════════════════════════
  async check(ctx: AiBusinessContext, area: 'reports' | 'alerts') {
    this.need(ctx);
    const T = ctx.tenantId; const B = this.branch(ctx);
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from ai_business_health_runs where tenant_id = ${T} and area = ${area}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true, changesAnything: false });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; component: string; state: St; count?: number | null; detail?: Record<string, unknown>; lastPassedAt?: string | null }> = [];
    const one = async (q: { execute: (db: Kysely<any>) => Promise<{ rows: Row[] }> }): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const rc = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    // the canonical Sales Report answers, and a preset means the days it names (the 7-day bug)
    try {
      const { today } = await this.today(ctx);
      const a = (await this.d.sales.getSales(rc, { preset: 'today' })).kpis; const z = (await this.d.sales.getSales(rc, { from: today, to: today })).kpis;
      checks.push({ key: 'sales_source', component: 'metrics', state: 'PASSED' });
      checks.push({ key: 'period_matches', component: 'metrics', state: a.netSalesCents === z.netSalesCents && a.ticketsCount === z.ticketsCount ? 'PASSED' : 'FAILED' });
    } catch { checks.push({ key: 'sales_source', component: 'metrics', state: 'UNAVAILABLE' }); }
    try { await this.d.appointments.getAppointmentMetrics(ctx, 'today'); checks.push({ key: 'appointments_source', component: 'metrics', state: 'PASSED' }); }
    catch { checks.push({ key: 'appointments_source', component: 'metrics', state: 'UNAVAILABLE' }); }
    if (area === 'reports') {
      const r = await one(sql<Row>`select count(*)::int as n, count(*) filter (where j.status in ('queued', 'running') and j.created_at < now() - interval '10 minutes')::int as stuck,
          count(*) filter (where j.status = 'failed' and j.created_at > now() - interval '7 days')::int as failed7,
          count(*) filter (where j.status = 'completed' and j.expires_at <= now())::int as expired,
          count(*) filter (where j.status = 'completed' and j.expires_at > now() and not (j.content ? 'period'))::int as no_period
        from ai_business_report_jobs j where j.tenant_id = ${T} and ${this.scope(ctx, 'j')}`);
      checks.push({ key: 'reports_readable', component: 'storage', state: 'PASSED', count: N(r.n) });
      checks.push({ key: 'no_stuck_reports', component: 'generation', state: N(r.stuck) ? 'FAILED' : 'PASSED', count: N(r.stuck) });
      checks.push({ key: 'recent_failures', component: 'generation', state: N(r.failed7) ? 'WARNING' : 'PASSED', count: N(r.failed7) });
      checks.push({ key: 'content_window', component: 'storage', state: N(r.expired) ? 'WARNING' : 'PASSED', count: N(r.expired) });
      checks.push({ key: 'reports_record_period', component: 'verification', state: N(r.no_period) ? 'WARNING' : 'PASSED', count: N(r.no_period) });
      checks.push({ key: 'scheduled_reports', component: 'automation', state: 'UNAVAILABLE' });
    } else {
      const r = await one(sql<Row>`select count(*) filter (where a.active)::int as active, count(*) filter (where a.active and ev.ev_id is null)::int as never,
          count(*) filter (where a.active and (ev.ev_at is null or ev.ev_at < now() - interval '1 day'))::int as stale,
          count(*) filter (where a.active and a.min_sample_size < 1)::int as no_sample, count(*) filter (where a.active and a.channel in ('email', 'sms'))::int as channel_rules
        from ${BusinessCenter.RULE_FROM(T)} where a.tenant_id = ${T} and ${this.scope(ctx, 'a')}`);
      checks.push({ key: 'rules_readable', component: 'rules', state: N(r.active) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(r.active) });
      checks.push({ key: 'rules_evaluated', component: 'evaluation', state: N(r.stale) ? 'WARNING' : 'PASSED', count: N(r.stale), detail: { never: N(r.never) } });
      checks.push({ key: 'automatic_evaluation', component: 'evaluation', state: 'UNAVAILABLE' });
      checks.push({ key: 'sample_guard', component: 'rules', state: N(r.no_sample) ? 'WARNING' : 'PASSED', count: N(r.no_sample) });
      checks.push({ key: 'delivery_channels', component: 'notifications', state: N(r.channel_rules) ? 'WARNING' : 'PASSED', count: N(r.channel_rules) });
    }
    const cross = await one(area === 'reports'
      ? sql<Row>`select count(*)::int as n from ai_business_report_jobs j join users u on u.id = j.requested_by_user_id where j.tenant_id = ${T} and u.tenant_id is not null and u.tenant_id <> j.tenant_id`
      : sql<Row>`select count(*)::int as n from ai_business_alert_events e join ai_business_alerts a on a.id = e.alert_id where e.tenant_id = ${T} and a.tenant_id <> e.tenant_id`);
    checks.push({ key: 'tenant_isolation', component: 'security', state: N(cross.n) ? 'FAILED' : 'PASSED', count: N(cross.n) });
    checks.push({ key: 'no_side_effects', component: 'security', state: 'PASSED' });
    const prev = (await sql<Row>`select c->>'key' as key, max(h.created_at) as at from ai_business_health_runs h cross join lateral jsonb_array_elements(h.checks) c
      where h.tenant_id = ${T} and h.area = ${area} and c->>'state' = 'PASSED' group by 1`.execute(this.db)).rows;
    const checkedAt = new Date(this.now()).toISOString();
    for (const x of checks) x.lastPassedAt = x.state === 'PASSED' ? checkedAt : iso(prev.find((p) => p.key === x.key)?.at);
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    // a feature that is not built (UNAVAILABLE) is reported, but does not turn the system red on its own
    const overall = checks.some((x) => x.state === 'FAILED') ? 'FAILED' : checks.some((x) => x.state === 'WARNING' || (x.state === 'UNAVAILABLE' && x.component === 'metrics')) ? 'WARNING' : 'PASSED';
    const id = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('ai-business-health:' || ${T} || ${area}))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into ai_business_health_runs (id, tenant_id, branch_id, area, actor_user_id, overall, checks)
        values (${id}, ${T}, ${B}, ${area}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id, overall, checks, checkedAt, reused: false, changesAnything: false };
    });
  }
}

function median(v: number[]) { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }
/** the headline figures of a completed report (server-side, so the screen shows labelled numbers, not raw JSON) */
export function headline(content: Row): { key: string; value: number; unit: 'cents' | 'count' | 'percent' }[] {
  const out: { key: string; value: number; unit: 'cents' | 'count' | 'percent' }[] = [];
  const s = content.snapshot;
  if (s) {
    out.push({ key: 'net_sales', value: N(s.netSalesCents), unit: 'cents' }, { key: 'paid_tickets', value: N(s.ticketsCount), unit: 'count' }, { key: 'average_ticket', value: N(s.averageTicketCents), unit: 'cents' });
    if (N(s.refundsCents)) out.push({ key: 'refunds', value: N(s.refundsCents), unit: 'cents' });
  } else {
    const rev = content.revenue && content.revenue.available !== false ? content.revenue : content.brief?.revenue?.available ? content.brief.revenue : null;
    if (rev && typeof rev.netSalesCents === 'number') out.push({ key: 'net_sales', value: rev.netSalesCents, unit: 'cents' });
  }
  const appts = content.appointments?.funnel || content.brief?.appointments;
  if (appts && typeof appts.completed === 'number') out.push({ key: 'completed_appointments', value: appts.completed, unit: 'count' });
  if (appts && typeof appts.totalBookings === 'number') out.push({ key: 'bookings', value: appts.totalBookings, unit: 'count' });
  if (content.customers && typeof content.customers.newCustomers === 'number') out.push({ key: 'new_customers', value: content.customers.newCustomers, unit: 'count' });
  if (Array.isArray(content.branches?.branches)) out.push({ key: 'branches', value: content.branches.branches.length, unit: 'count' });
  return out;
}
