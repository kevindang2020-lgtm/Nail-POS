// Kysely implementation — reads the real `report_exports` log (+ tenants/branches for scope labels). No writes.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { AiReportsRepositoryPort, KeyCount, FormatCount, DailyCount, KpiTotals, RecentExportRow, EngineTotals, DeliveryStatusCounts, RunSourceCounts, RecentRunRow, RecentScheduleRow, PublishedTemplateRow } from './ai-reports.repository';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };

export class KyselyAiReportsRepository implements AiReportsRepositoryPort {
  constructor(private readonly db: AppDatabase) {}

  async kpiTotals(): Promise<KpiTotals> {
    const r: any = await sql`
      select
        count(*) filter (where created_at::date = current_date)::int as generated_today,
        count(*)::int as on_demand_total,
        count(*) filter (where created_at >= current_date - interval '6 days')::int as weekly,
        count(*) filter (where created_at >= current_date - interval '29 days')::int as monthly
      from report_exports`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { generatedToday: n(r?.generated_today), onDemandTotal: n(r?.on_demand_total), weekly: n(r?.weekly), monthly: n(r?.monthly) };
  }

  async byType(): Promise<KeyCount[]> {
    return sql<KeyCount>`select report_key as "reportKey", count(*)::int as count from report_exports group by report_key`.execute(this.db as any).then((r) => r.rows).catch(() => []);
  }

  async byFormat(): Promise<FormatCount[]> {
    return sql<FormatCount>`select format, count(*)::int as count from report_exports group by format`.execute(this.db as any).then((r) => r.rows).catch(() => []);
  }

  async daily7(): Promise<DailyCount[]> {
    const rows: any[] = await sql`
      select created_at::date as day, count(*)::int as count from report_exports
      where created_at >= current_date - interval '6 days' group by created_at::date order by created_at::date`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((d) => ({ day: iso(d.day) || String(d.day), count: n(d.count) }));
  }

  async recentExports(limit: number): Promise<RecentExportRow[]> {
    const rows: any[] = await sql`
      select e.id, e.report_key, e.format, t.display_name as tenant, b.name as branch, e.role, e.start_date, e.end_date, e.file_url, e.created_at
      from report_exports e left join tenants t on t.id = e.tenant_id left join branches b on b.id = e.branch_id
      order by e.created_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ id: String(r.id), reportKey: r.report_key, format: r.format, tenant: r.tenant ?? null, branch: r.branch ?? null, role: r.role ?? null, startDate: iso(r.start_date), endDate: iso(r.end_date), hasFile: !!r.file_url, createdAt: iso(r.created_at) }));
  }

  async engineTotals(): Promise<EngineTotals> {
    const sch: any = await sql`select count(*) filter (where status = 'active')::int active from ai_report_schedules`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    const runs: any = await sql`select count(*) filter (where generation_status = 'failed')::int failed, coalesce(avg(duration_ms) filter (where generation_status in ('completed','partial')),0)::int avg_ms from ai_report_runs`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    const del: any = await sql`select count(*) filter (where status = 'delivered')::int delivered, count(*) filter (where status <> 'excluded')::int total from ai_report_deliveries`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { scheduleActive: n(sch?.active), runsFailed: n(runs?.failed), avgGenDurationMs: n(runs?.avg_ms), deliveredCount: n(del?.delivered), deliveryTotal: n(del?.total) };
  }

  async deliveryStatusCounts(): Promise<DeliveryStatusCounts> {
    const r: any = await sql`select count(*) filter (where status='delivered')::int delivered, count(*) filter (where status='failed')::int failed, count(*) filter (where status='bounced')::int bounced, count(*) filter (where status in ('pending','queued','in_progress'))::int pending from ai_report_deliveries`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { delivered: n(r?.delivered), failed: n(r?.failed), bounced: n(r?.bounced), pending: n(r?.pending) };
  }

  async runSourceCounts(): Promise<RunSourceCounts> {
    const r: any = await sql`select count(*) filter (where generation_source='scheduled')::int scheduled, count(*) filter (where generation_source='on_demand')::int on_demand from ai_report_runs`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { scheduled: n(r?.scheduled), onDemand: n(r?.on_demand) };
  }

  async recentRuns(limit: number): Promise<RecentRunRow[]> {
    const rows: any[] = await sql`select report_key, generation_status, duration_ms, created_at from ai_report_runs order by created_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ reportKey: r.report_key, status: r.generation_status, durationMs: r.duration_ms == null ? null : n(r.duration_ms), createdAt: iso(r.created_at) }));
  }

  async recentSchedules(limit: number): Promise<RecentScheduleRow[]> {
    const rows: any[] = await sql`select name, report_key, frequency, run_at_time, scope_type, next_run_at, owner, status from ai_report_schedules order by created_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ name: r.name, reportKey: r.report_key, frequency: r.frequency, runAtTime: r.run_at_time, scopeType: r.scope_type, nextRunAt: iso(r.next_run_at), owner: r.owner, status: r.status }));
  }

  async publishedTemplates(): Promise<PublishedTemplateRow[]> {
    const rows: any[] = await sql`select distinct on (report_key) report_key, name, version from ai_report_templates where status = 'published' order by report_key, version desc`.execute(this.db as any).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ reportKey: r.report_key, name: r.name, version: Number(r.version) || 0 }));
  }


}
