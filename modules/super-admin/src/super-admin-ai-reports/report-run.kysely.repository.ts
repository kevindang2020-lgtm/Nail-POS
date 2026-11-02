// Kysely impl — real metrics snapshot SUMmed from the daily-summary tables over the scope + date range; idempotent insert
// via ON CONFLICT (idempotency_key). No numbers are invented: every metric is a SQL aggregate of real summary rows.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { ReportRunRepositoryPort, RunScope, MetricsSnapshotRow, ReportRunRow, InsertRunInput } from './report-run.repository';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const mapRun = (r: any): ReportRunRow => ({ id: String(r.id), reportReference: r.report_reference, reportKey: r.report_key, scopeType: r.scope_type, tenantId: r.tenant_id ? String(r.tenant_id) : null, branchId: r.branch_id ? String(r.branch_id) : null, dateRangeStart: String(r.date_range_start).slice(0, 10), dateRangeEnd: String(r.date_range_end).slice(0, 10), generationSource: r.generation_source, generationStatus: r.generation_status, metricsSnapshot: r.metrics_snapshot || {}, durationMs: r.duration_ms == null ? null : n(r.duration_ms), idempotencyKey: r.idempotency_key, createdAt: iso(r.created_at) });

export class KyselyReportRunRepository implements ReportRunRepositoryPort {
  constructor(private readonly db: AppDatabase) {}

  async getRunByIdem(k: string): Promise<ReportRunRow | null> {
    const r: any = await sql`select * from ai_report_runs where idempotency_key = ${k} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return r ? mapRun(r) : null;
  }

  async snapshotMetrics(scope: RunScope, start: string, end: string): Promise<MetricsSnapshotRow> {
    const scopeSql = scope.tenantId ? sql`and tenant_id = ${scope.tenantId}` : sql``;
    const branchSql = scope.branchId ? sql`and branch_id = ${scope.branchId}` : sql``;
    const sales: any = await sql`select coalesce(sum(revenue_cents),0)::bigint rev, coalesce(sum(refunds_cents),0)::bigint ref, count(*)::int rows from tenant_daily_sales_summary where summary_date between ${start} and ${end} ${scopeSql} ${branchSql}`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    const book: any = await sql`select coalesce(sum(bookings),0)::int b, coalesce(sum(completed),0)::int c, coalesce(sum(cancelled),0)::int x, coalesce(sum(no_show),0)::int ns, count(*)::int rows from tenant_daily_booking_summary where summary_date between ${start} and ${end} ${scopeSql} ${branchSql}`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    const cust: any = await sql`select coalesce(sum(new_customers),0)::int nc, coalesce(sum(returning_customers),0)::int rc, count(*)::int rows from tenant_daily_customer_summary where summary_date between ${start} and ${end} ${scopeSql} ${branchSql}`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    const rowsSeen = n(sales?.rows) + n(book?.rows) + n(cust?.rows);
    return { revenueCents: n(sales?.rev), refundsCents: n(sales?.ref), bookings: n(book?.b), completed: n(book?.c), cancelled: n(book?.x), noShow: n(book?.ns), newCustomers: n(cust?.nc), returningCustomers: n(cust?.rc), hasData: rowsSeen > 0 };
  }

  async insertRun(i: InsertRunInput): Promise<ReportRunRow> {
    const r: any = await sql`
      insert into ai_report_runs (report_reference, report_key, tenant_id, branch_id, scope_type, scope_snapshot, date_range_start, date_range_end, generation_source, generation_status, metrics_snapshot, requested_by, started_at, completed_at, duration_ms, idempotency_key)
      values (${i.reportReference}, ${i.reportKey}, ${i.scope.tenantId}, ${i.scope.branchId}, ${i.scope.scopeType}, ${JSON.stringify(i.scope)}::jsonb, ${i.dateRangeStart}, ${i.dateRangeEnd}, ${i.generationSource}, ${i.generationStatus}, ${JSON.stringify(i.metricsSnapshot)}::jsonb, ${i.requestedBy}, now() - (${i.durationMs} || ' milliseconds')::interval, now(), ${i.durationMs}, ${i.idempotencyKey})
      on conflict (idempotency_key) do update set updated_at = now()
      returning *`.execute(this.db as any).then((x) => x.rows[0]);
    return mapRun(r);
  }

  async getRun(id: string): Promise<ReportRunRow | null> {
    const r: any = await sql`select * from ai_report_runs where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return r ? mapRun(r) : null;
  }
}
