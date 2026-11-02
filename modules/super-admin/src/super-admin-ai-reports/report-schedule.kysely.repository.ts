import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { ReportScheduleRepositoryPort, ScheduleRow, InsertScheduleInput } from './report-schedule.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_REPORT_SCHEDULE } from '../lifecycles';

const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const map = (r: any): ScheduleRow => ({ id: String(r.id), name: r.name, reportKey: r.report_key, frequency: r.frequency, runAtTime: r.run_at_time, timezone: r.timezone, scopeType: r.scope_type, tenantId: r.tenant_id ? String(r.tenant_id) : null, branchId: r.branch_id ? String(r.branch_id) : null, nextRunAt: iso(r.next_run_at), status: r.status, owner: r.owner, createdAt: iso(r.created_at) });

export class KyselyReportScheduleRepository implements ReportScheduleRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async insert(i: InsertScheduleInput): Promise<ScheduleRow> {
    const r: any = await sql`
      insert into ai_report_schedules (name, report_key, frequency, run_at_time, timezone, scope_type, tenant_id, branch_id, next_run_at, owner, created_by, status)
      values (${i.name}, ${i.reportKey}, ${i.frequency}, ${i.runAtTime}, ${i.timezone}, ${i.scopeType}, ${i.tenantId}, ${i.branchId}, ${i.nextRunAt}, ${i.owner}, ${i.createdBy}, 'active')
      returning *`.execute(this.db as any).then((x) => x.rows[0]);
    return map(r);
  }
  async get(id: string) { const r: any = await sql`select * from ai_report_schedules where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async setStatus(id: string, status: string) { const r: any = await sql`update ai_report_schedules set status = ${status}, updated_at = now() where id = ${id} and ${canMoveToSql(AI_REPORT_SCHEDULE, status)} returning *`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async setNextRun(id: string, nextRunAt: string) { const r: any = await sql`update ai_report_schedules set next_run_at = ${nextRunAt}, updated_at = now() where id = ${id} returning *`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async list(limit: number) { const rows: any[] = await sql`select * from ai_report_schedules order by created_at desc limit ${limit}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
}
