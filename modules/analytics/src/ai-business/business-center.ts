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
import { hasPermission } from '@aipowersalon/permissions';
import type { ReportChangeResponse, ReportChangeItem } from '@aipowersalon/api-contracts/tenant';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone, canMoveToSql } from '@aipowersalon/database';
import { AI_BUSINESS_INCIDENT_LIFECYCLE } from './business-alert-incidents';
import type { ReportsService } from '@aipowersalon/reports';
import { presetRange as presetRangeOf } from '@aipowersalon/reports';
import type { AiBusinessContext } from './ai-business.dto';
import type { AiBusinessReportsService } from './ai-business-reports.service';
import type { AiBusinessAlertsService } from './ai-business-alerts.service';
import type { BusinessAlertIncidents } from './business-alert-incidents';
import type { AiBusinessRevenueService } from './ai-business-revenue.service';
import type { AiBusinessAppointmentsService } from './ai-business-appointments.service';
import { addDays as addYmdDays, businessDate, localHour } from '@aipowersalon/date-time';   // §87: one calendar helper
import { growthAdvice } from './ai-business-assistant-extras';

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
export const BC_EVENT_STATES = ['all', 'triggered', 'recovered', 'unchanged', 'not_evaluated', 'failed', 'unacknowledged'] as const;
export const BC_RULE_STATUSES = ['all', 'active', 'paused', 'triggered', 'needs_review', 'never_evaluated'] as const;
export const BC_PAGE_SIZES = [10, 25, 50, 100] as const;
/** AI Business Reports 14 — automated reports: which report each schedule makes, for which period, on which salon day */
export const BC_SCHEDULE_TYPES = ['daily_brief', 'weekly_summary', 'monthly_review'] as const;
export const BC_SCHEDULE_RULE: Record<typeof BC_SCHEDULE_TYPES[number], { preset: string; defaultHour: number; when: 'every_day' | 'sunday' | 'last_day_of_month' }> = {
  daily_brief: { preset: 'yesterday', defaultHour: 7, when: 'every_day' },
  weekly_summary: { preset: 'week', defaultHour: 21, when: 'sunday' },
  monthly_review: { preset: 'month', defaultHour: 21, when: 'last_day_of_month' },
};
/** is this salon-local moment an occurrence of the schedule? → its claim key (the salon date), else null */
export function scheduleOccurrence(type: typeof BC_SCHEDULE_TYPES[number], sendHour: number, now: Date, tz: string): string | null {
  const day = businessDate(tz, now);
  if (localHour(now, tz) < sendHour) return null;
  const rule = BC_SCHEDULE_RULE[type].when;
  if (rule === 'sunday' && new Date(day + 'T12:00:00Z').getUTCDay() !== 0) return null;
  if (rule === 'last_day_of_month' && addYmdDays(day, 1).slice(8, 10) !== '01') return null;
  return day;
}
const HEALTH_GAP_SECONDS = 30;
const DEDUPE_SECONDS = 15;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
// the platform's one permission rule (Nov 6 2026 full-run route sweep): a raw includes() missed alias-granted keys, so every
// owner and manager was refused here although the route guard (the same rule) had let them in
const has = (ctx: AiBusinessContext, p: string) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], p);
const esc = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const pick = <T extends readonly (string | number)[]>(list: T, v: unknown): T[number] | undefined => (list as readonly unknown[]).includes(v) ? v as T[number] : undefined;
const addDays = (d: string, k: number) => addYmdDays(d, k);
const TYPE_LABEL: Record<string, string> = { daily_brief: 'daily brief', weekly_summary: 'weekly summary', monthly_review: 'monthly review', branch_comparison: 'branch comparison' };

export interface BcDeps {
  reports: AiBusinessReportsService; alerts: AiBusinessAlertsService; revenue: AiBusinessRevenueService; appointments: AiBusinessAppointmentsService;
  sales: Pick<ReportsService, 'getSales'>;
  /** A2 (Nov 6 2026): incidents + notifications for a triggered evaluation (business-alert-incidents.ts) */
  incidents?: Pick<BusinessAlertIncidents, 'onTriggered' | 'sweep'> | null;
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

  // ═════════════════════════════ AUTOMATED REPORTS (AI Business Reports 14; migration 895) ═════════════════════════════
  private scheduleView(r: Row, tz: string) {
    const type = r.report_type as typeof BC_SCHEDULE_TYPES[number];
    return { id: r.id ? String(r.id) : null, reportType: type, preset: BC_SCHEDULE_RULE[type].preset, when: BC_SCHEDULE_RULE[type].when, sendHour: N(r.send_hour), active: !!r.active,
      notifyInApp: r.notify_in_app == null ? true : !!r.notify_in_app, lastRunAt: iso(r.last_run_at), lastStatus: r.last_outcome ?? null, lastReason: r.last_reason ?? null,
      lastReportId: r.last_report_id ? String(r.last_report_id) : null, timeZone: tz };
  }
  /** the caller's OWN schedules (one per report type for this location scope); a type never turned on shows its defaults, off */
  async reportSchedules(ctx: AiBusinessContext) {
    this.need(ctx);
    const { tz } = await this.today(ctx);
    const rows = (await sql<Row>`select s.id, s.report_type, s.send_hour, s.active, s.notify_in_app, s.last_run_at, s.last_outcome, s.last_reason, s.last_report_id from ai_business_report_schedules s
      where s.tenant_id = ${ctx.tenantId} and s.owner_user_id = ${ctx.userId}::uuid and s.branch_id is not distinct from ${this.branch(ctx)}::uuid`.execute(this.db)).rows;
    return { items: BC_SCHEDULE_TYPES.map((t) => this.scheduleView(rows.find((r) => r.report_type === t) ?? { report_type: t, send_hour: BC_SCHEDULE_RULE[t].defaultHour, active: false }, tz)),
      timeZone: tz, note: 'Reports are made on the server at or after the hour, salon time — the page does not need to be open.' };
  }
  /** turn the caller's own schedule of one report type on / off, or change its hour (self-consented: only for yourself) */
  async saveReportSchedule(ctx: AiBusinessContext, b: { reportType?: unknown; active?: unknown; sendHour?: unknown; notifyInApp?: unknown }) {
    this.need(ctx);
    const type = pick(BC_SCHEDULE_TYPES, b.reportType);
    if (!type) throw new BusinessCenterError('Choose a report.', 'BC_REPORT_TYPE_INVALID');
    const hour = b.sendHour == null ? BC_SCHEDULE_RULE[type].defaultHour : Number(b.sendHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new BusinessCenterError('Choose an hour from 0 to 23.', 'VALIDATION_FAILED');
    const active = b.active == null ? true : b.active === true;
    const notify = b.notifyInApp == null ? true : b.notifyInApp === true;
    const B = this.branch(ctx);
    // an occurrence that has already come today is not made on the spot: the first report is the NEXT occurrence
    const { tz } = await this.today(ctx);
    const passed = scheduleOccurrence(type, hour, new Date(this.now()), tz);
    await sql`insert into ai_business_report_schedules (tenant_id, branch_id, owner_user_id, report_type, send_hour, active, notify_in_app, last_occurrence, updated_by)
      values (${ctx.tenantId}, ${B}::uuid, ${ctx.userId}::uuid, ${type}, ${hour}, ${active}, ${notify}, ${passed}, ${ctx.userId}::uuid)
      on conflict (tenant_id, owner_user_id, report_type, branch_id) do update set send_hour = excluded.send_hour, active = excluded.active, notify_in_app = excluded.notify_in_app,
        last_occurrence = coalesce(excluded.last_occurrence, ai_business_report_schedules.last_occurrence), updated_at = now(), updated_by = excluded.updated_by`.execute(this.db);
    return this.reportSchedules(ctx);
  }
  /** the background tick (the alerts job's tick, every 5 minutes): every active schedule whose occurrence has come makes ONE
   *  report through the same path as the button, as its owner with the owner's CURRENT role; claimed per occurrence so a second
   *  process or a retry never makes two. An owner who left / lost AI Business → skipped (recorded), never run as anyone else. */
  async reportScheduleSweep(permissionsForRole: (role: string) => string[], limit = 50): Promise<{ generated: number; failed: number; skipped: number }> {
    const rows = (await sql<Row>`select s.id, s.tenant_id, s.branch_id, s.owner_user_id, s.report_type, s.send_hour, s.notify_in_app, s.last_occurrence, u.role, u.status as user_status, u.tenant_id as user_tenant
      from ai_business_report_schedules s left join users u on u.id = s.owner_user_id
      where s.active and (s.last_run_at is null or s.last_run_at < now() - interval '50 minutes')
      order by s.last_run_at asc nulls first, s.id limit ${Math.max(1, Math.min(500, limit))}`.execute(this.db)).rows;
    let generated = 0, failed = 0, skipped = 0;
    for (const r of rows) {
      const T = String(r.tenant_id); const type = r.report_type as typeof BC_SCHEDULE_TYPES[number];
      const tz = await branchTimeZone(this.db, T, r.branch_id ? String(r.branch_id) : null);
      const key = scheduleOccurrence(type, N(r.send_hour), new Date(this.now()), tz);
      if (!key || key === r.last_occurrence) continue;
      const claimed = (await sql<Row>`update ai_business_report_schedules set last_occurrence = ${key}, last_run_at = now() where id = ${String(r.id)}::uuid and active
        and last_occurrence is distinct from ${key} returning id`.execute(this.db)).rows[0];
      if (!claimed) continue;
      const ctx: AiBusinessContext = { tenantId: T, branchId: r.branch_id ? String(r.branch_id) : '', userId: String(r.owner_user_id), role: String(r.role ?? ''), permissions: r.role ? permissionsForRole(String(r.role)) : [] };
      const employed = !!r.user_tenant && String(r.user_tenant) === T && String(r.user_status ?? 'active') === 'active';
      if (!employed || !has(ctx, 'pos.ai_business.view')) {
        await sql`update ai_business_report_schedules set last_outcome = 'skipped', last_reason = ${!employed ? 'owner_not_active' : 'owner_lost_access'} where id = ${String(r.id)}::uuid`.execute(this.db);
        skipped++; continue;
      }
      const job = await this.d.reports.create(ctx, type, BC_SCHEDULE_RULE[type].preset, this.snapshotFor(ctx));
      await sql`update ai_business_report_jobs set schedule_id = ${String(r.id)}::uuid where tenant_id = ${T} and id = ${job.id}::uuid`.execute(this.db);
      const ok = job.status === 'completed';
      await sql`update ai_business_report_schedules set last_outcome = ${ok ? 'generated' : 'failed'}, last_reason = ${ok ? null : String(job.error ?? 'generation_failed').slice(0, 300)}, last_report_id = ${job.id}::uuid
        where id = ${String(r.id)}::uuid`.execute(this.db);
      if (r.notify_in_app) {
        // the inbox line names the report and where to open it — never a figure (it can be read on a shared screen)
        await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
          values (${T}, ${r.branch_id ?? null}, 'ai_business_report', ${ok ? 'info' : 'warning'}, 'new',
            ${ok ? `Your ${TYPE_LABEL[type]} is ready` : `Your ${TYPE_LABEL[type]} could not be made`},
            ${ok ? `Made automatically for ${key}. Open AI Center → AI Business Reports to read it.` : 'The scheduled report failed. Open AI Center → AI Business Reports and run Check AI Business Reports System.'},
            ${JSON.stringify({ reportId: job.id, scheduleId: String(r.id), reportType: type, occurrence: key })}::jsonb, ${has(ctx, 'settings.edit') ? 'owner' : 'all'})`.execute(this.db);
      }
      if (ok) generated++; else failed++;
    }
    return { generated, failed, skipped };
  }

  // ═════════════════════════ EXECUTIVE SUMMARY & GROWTH ADVISOR (AI Business Reports 15) ═════════════════════════
  /** Read-only. The official figures are the report's own stored canonical Sales Report snapshot (headline()) — re-checked by
   *  the SAME reportVerify the Verify button uses, and each figure says whether it still matches. Opportunities come from the
   *  ONE growth advisor (growthAdvice, also used by the assistant) over the report's own sections; each is a proposal for the
   *  owner to review — nothing is changed, sent or started from here, and no number is computed outside the report. */
  async reportExecutive(ctx: AiBusinessContext, id: string) {
    this.need(ctx);
    const d = await this.reportDetail(ctx, id);
    if (d.availability !== 'viewable' || !d.content) return { id, available: false, reason: d.availability, reportType: d.reportType, period: d.period, facts: [], opportunities: [], verification: null, changesAnything: false as const };
    const v = await this.reportVerify(ctx, id);
    const matchedBy = new Map((v.items ?? []).map((x: Row) => [String(x.metric), x]));
    const METRIC: Record<string, string> = { net_sales: 'netSalesCents', paid_tickets: 'ticketsCount', average_ticket: 'averageTicketCents', refunds: 'refundsCents' };
    const c = d.content as Row;
    const facts = headline(c).map((h) => {
      const m = METRIC[h.key] && c.snapshot ? matchedBy.get(METRIC[h.key]) : undefined;
      return { ...h, source: METRIC[h.key] && c.snapshot ? 'sales_report_snapshot' : 'report_section',
        check: m ? (m.matched ? 'matches_sales_report' : 'changed_since') : 'not_checkable', salesReportNow: m && !m.matched ? N(m.salesReportNow) : null };
    });
    const usable = (x: unknown) => (x && typeof x === 'object' && (x as Row).available !== false ? x as Row : null);
    const tips = growthAdvice({ customers: usable(c.customers), appointments: usable(c.appointments), revenue: usable(c.revenue) });
    return { id, available: true, reportType: d.reportType, period: d.period,
      verification: { status: v.status, reason: v.reason ?? null, checkedAt: (v as Row).checkedAt ?? null },
      facts, opportunities: tips.map((t) => ({ kind: t.kind, basis: t.basis, route: t.route, status: 'proposed' as const, ownerReview: true })),
      changesAnything: false as const, rule: 'Figures are the report\'s stored canonical Sales Report numbers; nothing is estimated. Opportunities are suggestions to review.' };
  }

  /** AI Business Assistant 10 — What Changed Since Last Check: two validated reports compared. The older one's days are
   *  re-read from the Sales Report now (THE read Verify Numbers uses): olderNow − olderInReport = data corrections on those
   *  days; newerInReport − olderNow = the actual business change. Same days → all of it is correction. Read only. */
  async reportCompare(ctx: AiBusinessContext, id: string, withId: string): Promise<ReportChangeResponse> {
    this.need(ctx);
    const checkedAt = new Date(this.now()).toISOString();
    const a = await this.reportRow(ctx, id); const b = await this.reportRow(ctx, String(withId ?? ''));
    const parse = (r: Row) => { const c = typeof r.content === 'string' ? JSON.parse(r.content) : r.content; return { id: String(r.id), status: String(r.status), period: c?.period ?? null, snap: c?.snapshot ?? null, createdAt: r.created_at }; };
    const [x, y] = [parse(a), parse(b)];
    // older = the snapshot taken first (else the report made first)
    const t = (v: { snap: Row | null; createdAt: unknown }) => new Date(String(v.snap?.takenAt ?? (v.createdAt instanceof Date ? v.createdAt.toISOString() : v.createdAt))).getTime();
    const [older, newer] = t(x) <= t(y) ? [x, y] : [y, x];
    const side = (v: typeof x) => ({ id: v.id, period: v.period ? { from: String(v.period.from), to: String(v.period.to), ...(v.period.partial != null ? { partial: !!v.period.partial } : {}) } : null, snapshotTakenAt: v.snap?.takenAt ?? null });
    const out = (status: ReportChangeResponse['status'], reason: ReportChangeResponse['reason'], items: ReportChangeItem[] = [], samePeriod = false): ReportChangeResponse => ({ status, reason, older: side(older), newer: side(newer), samePeriod, items, checkedAt });
    if (x.id === y.id) return out('cannot_compare', 'same_report');
    if (older.status !== 'completed' || newer.status !== 'completed') return out('cannot_compare', 'not_completed');
    if (!older.snap || !newer.snap || !older.period?.from || !newer.period?.from) return out('cannot_compare', 'no_snapshot');
    let now: Row;
    try { now = (await this.d.sales.getSales({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions }, { from: older.period.from, to: older.period.to })).kpis as Row; }
    catch (e) { if (e instanceof BusinessCenterError) throw e; return out('cannot_compare', 'no_permission'); }   // no financial permission → nothing to compare
    const samePeriod = older.period.from === newer.period.from && older.period.to === newer.period.to;
    const keys: ReportChangeItem['metric'][] = ['netSalesCents', 'grossSalesCents', 'ticketsCount', 'averageTicketCents', 'refundsCents', 'discountsCents'];
    const items = keys.filter((k) => older.snap![k] != null && newer.snap![k] != null).map((k) => {
      const olderInReport = N(older.snap![k]), olderNow = N(now[k]), newerInReport = N(newer.snap![k]);
      return { metric: k, olderInReport, olderNow, newerInReport, dataCorrection: olderNow - olderInReport, businessChange: samePeriod ? null : newerInReport - olderNow };
    });
    return out('compared', null, items, samePeriod);
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
    left join users u on u.id = a.created_by_user_id and u.tenant_id = a.tenant_id
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
        count(*) filter (where a.active and ev.ev_id is null)::int as never, count(*) filter (where a.active and ev.ev_state = 'failed')::int as failed, max(ev.ev_at) as last_at
      from ${BusinessCenter.RULE_FROM(T)} where a.tenant_id = ${T} and a.archived_at is null and ${this.scope(ctx, 'a')}`.execute(this.db)).rows[0] ?? {};
    return { activeRules: N(r.active), pausedRules: N(r.paused), triggeredUnacknowledged: N(r.triggered), needsReview: N(r.needs_review), neverEvaluated: N(r.never), failedEvaluations: N(r.failed),
      lastEvaluatedAt: iso(r.last_at), automaticEvaluation: process.env.AI_BUSINESS_ALERTS_SCHEDULE !== 'off', notificationsSent: true };   // Nov 6: the evaluator (Nov 5) and notifications (826) exist
  }

  async alertRules(ctx: AiBusinessContext, f: Row = {}) {
    this.need(ctx);
    const T = ctx.tenantId; const { page, pageSize } = this.paging(f);
    const conds: any[] = [sql`a.tenant_id = ${T}`, sql`a.archived_at is null`, this.scope(ctx, 'a')];   // an archived (deleted) rule keeps only its history
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
  async alertEvaluate(ctx: AiBusinessContext, id: string, source: 'manual' | 'scheduled' = 'manual') {
    this.need(ctx);
    if (!isUuid(id)) throw new BusinessCenterError('Alert not found.', 'BC_ALERT_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const a = (await sql<Row>`select a.id, a.branch_id, a.metric_id, a.operator, a.threshold, a.preset, a.min_sample_size from ai_business_alerts a
      where a.tenant_id = ${T} and a.id = ${id}::uuid and a.archived_at is null and ${this.scope(ctx, 'a')}`.execute(this.db)).rows[0];
    if (!a) throw new BusinessCenterError('Alert not found.', 'BC_ALERT_NOT_FOUND', 404);
    const { tz } = await this.today({ ...ctx, branchId: a.branch_id ? String(a.branch_id) : ctx.branchId });
    const range = presetRangeOf(String(a.preset), new Date(this.now()), tz);
    let ev: any;
    try { ev = await this.d.alerts.evaluateNow(ctx, id); }
    catch (e) {
      // the numbers could not be read: RECORD a failed evaluation (it used to vanish), then report it
      const reason = `Could not read the numbers: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
      const row = (await sql<Row>`insert into ai_business_alert_events (tenant_id, branch_id, alert_id, source, metric_id, operator, threshold, preset, period_from, period_to, value, sample_size,
          min_sample_size, sample_ok, triggered, state_change, reason, actor_user_id)
        values (${T}, ${a.branch_id ?? null}, ${id}::uuid, ${source}, ${a.metric_id}, ${a.operator}, ${a.threshold}, ${a.preset}, ${range.from}::date, ${range.to}::date, null, null,
          ${N(a.min_sample_size)}, false, false, 'failed', ${reason}, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id, evaluated_at`.execute(this.db)).rows[0];
      // a failed run still counts as a check (the schedule does not retry it every few minutes)
      await sql`update ai_business_alerts set last_checked_at = now() where tenant_id = ${T} and id = ${id}::uuid`.execute(this.db);
      return { alertId: id, metricId: a.metric_id, operator: a.operator, threshold: N(a.threshold), preset: a.preset, value: null, sampleSize: null, sampleOk: false, triggered: false,
        reason, eventId: String(row.id), evaluatedAt: iso(row.evaluated_at), stateChange: 'failed', period: { from: range.from, to: range.to, timeZone: tz } };
    }
    const out = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('ai-business-alert:' || ${id}))`.execute(trx);
      const prev = (await sql<Row>`select e.triggered, e.sample_ok from ai_business_alert_events e where e.tenant_id = ${T} and e.alert_id = ${id}::uuid and e.sample_ok
        order by e.evaluated_at desc, e.id desc limit 1`.execute(trx)).rows[0];
      const change = !ev.sampleOk ? 'not_evaluated' : ev.triggered && !prev?.triggered ? 'triggered' : !ev.triggered && prev?.triggered ? 'recovered' : 'unchanged';
      const row = (await sql<Row>`insert into ai_business_alert_events (tenant_id, branch_id, alert_id, source, metric_id, operator, threshold, preset, period_from, period_to, value, sample_size,
          min_sample_size, sample_ok, triggered, state_change, reason, actor_user_id, incident_status)
        values (${T}, ${a.branch_id ?? null}, ${id}::uuid, ${source}, ${ev.metricId}, ${ev.operator}, ${ev.threshold}, ${ev.preset}, ${range.from}::date, ${range.to}::date, ${ev.value},
          ${ev.sampleSize}, ${N(a.min_sample_size)}, ${ev.sampleOk}, ${ev.triggered}, ${change}, ${ev.reason}, ${isUuid(ctx.userId) ? ctx.userId : null},
          ${change === 'triggered' ? AI_BUSINESS_INCIDENT_LIFECYCLE.initial![0] : null})   -- A2: a trigger IS a new incident (its initial state, written with the row)
        returning id, evaluated_at`.execute(trx)).rows[0];
      return { ...ev, eventId: String(row.id), evaluatedAt: iso(row.evaluated_at), stateChange: change, period: { from: range.from, to: range.to, timeZone: tz } };
    });
    // A2 (Nov 6 2026): a trigger opens an incident and notifies per the rule (after the commit; a failed send is a delivery row)
    if (out.stateChange === 'triggered' && this.d.incidents) {
      try { return { ...out, deliveries: await this.d.incidents.onTriggered(T, out.eventId) }; }
      catch (e) { return { ...out, deliveries: [], notifyError: String((e as Error)?.message ?? e).slice(0, 200) }; }
    }
    return out;
  }

  /** A2 (Nov 5 2026) — the background evaluator: every active rule is evaluated on its own schedule (hourly / daily) as the
   *  person who created it, with that person's role permissions (a rule whose owner can no longer use AI Business, or no
   *  longer works here, is recorded as a failed evaluation and not retried until its next turn). Each run is the same
   *  evaluation as "Evaluate now", recorded with source 'scheduled'. At most `limit` rules per sweep, oldest check first. */
  async scheduledSweep(permissionsForRole: (role: string) => string[], limit = 50): Promise<{ evaluated: number; failed: number }> {
    const due = (await sql<Row>`select a.id, a.tenant_id, a.branch_id, a.created_by_user_id, u.role, u.status as user_status, u.tenant_id as user_tenant
      from ai_business_alerts a left join users u on u.id = a.created_by_user_id
      where a.active and a.archived_at is null
        and (a.last_checked_at is null or a.last_checked_at < now() - (case when a.frequency = 'hourly' then interval '1 hour' else interval '24 hours' end))
      order by a.last_checked_at asc nulls first, a.id limit ${Math.max(1, Math.min(500, limit))}`.execute(this.db)).rows;
    let evaluated = 0, failed = 0;
    for (const a of due) {
      const T = String(a.tenant_id);
      const perms = a.role ? permissionsForRole(String(a.role)) : [];
      const active = !!a.user_tenant && String(a.user_tenant) === T && String(a.user_status ?? 'active') === 'active';
      const ctx: AiBusinessContext = { tenantId: T, branchId: a.branch_id ? String(a.branch_id) : '', userId: String(a.created_by_user_id), role: String(a.role ?? ''), permissions: perms };
      if (!active || !has(ctx, 'pos.ai_business.view')) {
        const reason = !active ? 'Not evaluated: the person who created this rule no longer works here — edit the rule to take it over.' : 'Not evaluated: the rule\'s owner can no longer use AI Business.';
        await sql`insert into ai_business_alert_events (tenant_id, branch_id, alert_id, source, metric_id, operator, threshold, preset, value, sample_size, min_sample_size, sample_ok, triggered, state_change, reason)
          select a.tenant_id, a.branch_id, a.id, 'scheduled', a.metric_id, a.operator, a.threshold, a.preset, null, null, a.min_sample_size, false, false, 'failed', ${reason}
          from ai_business_alerts a where a.id = ${String(a.id)}::uuid`.execute(this.db);
        await sql`update ai_business_alerts set last_checked_at = now() where id = ${String(a.id)}::uuid`.execute(this.db);
        failed++; continue;
      }
      const r = await this.alertEvaluate(ctx, String(a.id), 'scheduled');
      if (r.stateChange === 'failed') failed++; else evaluated++;
    }
    return { evaluated, failed };
  }

  async alertAcknowledge(ctx: AiBusinessContext, eventId: string, b: { note?: unknown }) {
    this.need(ctx);
    if (!isUuid(eventId)) throw new BusinessCenterError('Alert event not found.', 'BC_EVENT_NOT_FOUND', 404);
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';
    const r = (await sql<Row>`update ai_business_alert_events e set acknowledged_at = now(), acknowledged_by = ${isUuid(ctx.userId) ? ctx.userId : null}, ack_note = ${note || null},
        incident_status = case when e.incident_status = 'open' and ${canMoveToSql(AI_BUSINESS_INCIDENT_LIFECYCLE, 'investigating', 'e')} then 'investigating' else e.incident_status end, incident_version = e.incident_version + 1
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
      and branch_id is not distinct from ${B} and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
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
          count(*) filter (where a.active and a.min_sample_size < 1)::int as no_sample, (select count(*)::int from ai_business_alert_deliveries d where d.tenant_id = ${T} and d.status = 'failed' and d.created_at > now() - interval '7 days') as channel_rules
        from ${BusinessCenter.RULE_FROM(T)} where a.tenant_id = ${T} and a.archived_at is null and ${this.scope(ctx, 'a')}`);
      checks.push({ key: 'rules_readable', component: 'rules', state: N(r.active) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(r.active) });
      checks.push({ key: 'rules_evaluated', component: 'evaluation', state: N(r.stale) ? 'WARNING' : 'PASSED', count: N(r.stale), detail: { never: N(r.never) } });
      // A2 (Nov 5 2026): the background evaluator — an active rule overdue past twice its own period means it is not running
      const auto = await one(sql<Row>`select count(*) filter (where a.active and (a.last_checked_at is null or a.last_checked_at < now() - (case when a.frequency = 'hourly' then interval '2 hours' else interval '48 hours' end)))::int as overdue,
          (select max(e.evaluated_at) from ai_business_alert_events e where e.tenant_id = ${T} and e.source = 'scheduled') as last_auto
        from ai_business_alerts a where a.tenant_id = ${T} and a.archived_at is null and ${this.scope(ctx, 'a')}`);
      checks.push({ key: 'automatic_evaluation', component: 'evaluation', state: process.env.AI_BUSINESS_ALERTS_SCHEDULE === 'off' ? 'UNAVAILABLE' : N(auto.overdue) ? 'WARNING' : 'PASSED', count: N(auto.overdue), detail: { lastAutomaticAt: iso(auto.last_auto) } });
      checks.push({ key: 'sample_guard', component: 'rules', state: N(r.no_sample) ? 'WARNING' : 'PASSED', count: N(r.no_sample) });
      checks.push({ key: 'delivery_channels', component: 'notifications', state: N(r.channel_rules) ? 'WARNING' : 'PASSED', count: N(r.channel_rules) });   // failed email / SMS deliveries, last 7 days
    }
    const cross = await one(area === 'reports'
      ? sql<Row>`select count(*)::int as n from ai_business_report_jobs j join users u on u.id = j.requested_by_user_id where j.tenant_id = ${T} and u.tenant_id is not null and u.tenant_id <> j.tenant_id`
      : sql<Row>`select count(*)::int as n from ai_business_alert_events e join ai_business_alerts a on a.id = e.alert_id where e.tenant_id = ${T} and a.tenant_id <> e.tenant_id`);
    checks.push({ key: 'tenant_isolation', component: 'security', state: N(cross.n) ? 'FAILED' : 'PASSED', count: N(cross.n) });
    checks.push({ key: 'no_side_effects', component: 'security', state: 'PASSED' });
    const prev = (await sql<Row>`select c->>'key' as key, max(h.created_at) as at from ai_business_health_runs h cross join lateral jsonb_array_elements(h.checks) c
      where h.tenant_id = ${T} and h.area = ${area} and h.branch_id is not distinct from ${B} and c->>'state' = 'PASSED' group by 1`.execute(this.db)).rows;
    const checkedAt = new Date(this.now()).toISOString();
    for (const x of checks) x.lastPassedAt = x.state === 'PASSED' ? checkedAt : iso(prev.find((p) => p.key === x.key)?.at);
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    // a feature that is not built (UNAVAILABLE) is reported, but does not turn the system red on its own
    const overall = checks.some((x) => x.state === 'FAILED') ? 'FAILED' : checks.some((x) => x.state === 'WARNING' || (x.state === 'UNAVAILABLE' && x.component === 'metrics')) ? 'WARNING' : 'PASSED';
    const id = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('ai-business-health:' || ${T} || ${area} || ':' || coalesce(${B}::text, '')))`.execute(trx);
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
