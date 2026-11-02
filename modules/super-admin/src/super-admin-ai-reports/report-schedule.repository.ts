// Repository port for report schedules (port + in-memory + Kysely). Writes to ai_report_schedules; the service validates
// every change through report-schedule-core first.
export interface ScheduleRow {
  id: string; name: string; reportKey: string; frequency: string; runAtTime: string; timezone: string;
  scopeType: string; tenantId: string | null; branchId: string | null; nextRunAt: string | null; status: string; owner: string; createdAt: string | null;
}
export interface InsertScheduleInput {
  name: string; reportKey: string; frequency: string; runAtTime: string; timezone: string; scopeType: string;
  tenantId: string | null; branchId: string | null; nextRunAt: string | null; owner: string; createdBy: string | null;
}
export interface ReportScheduleRepositoryPort {
  insert(input: InsertScheduleInput): Promise<ScheduleRow>;
  get(id: string): Promise<ScheduleRow | null>;
  setStatus(id: string, status: string): Promise<ScheduleRow | null>;
  setNextRun(id: string, nextRunAt: string): Promise<ScheduleRow | null>;
  list(limit: number): Promise<ScheduleRow[]>;
}

export class InMemoryReportScheduleRepository implements ReportScheduleRepositoryPort {
  rows: ScheduleRow[] = [];
  private seq = 1;
  async insert(i: InsertScheduleInput): Promise<ScheduleRow> {
    const row: ScheduleRow = { id: `sch${this.seq++}`, name: i.name, reportKey: i.reportKey, frequency: i.frequency, runAtTime: i.runAtTime, timezone: i.timezone, scopeType: i.scopeType, tenantId: i.tenantId, branchId: i.branchId, nextRunAt: i.nextRunAt, status: 'active', owner: i.owner, createdAt: new Date().toISOString() };
    this.rows.push(row); return row;
  }
  async get(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async setStatus(id: string, status: string) { const r = this.rows.find((x) => x.id === id); if (!r) return null; r.status = status; return r; }
  async setNextRun(id: string, nextRunAt: string) { const r = this.rows.find((x) => x.id === id); if (!r) return null; r.nextRunAt = nextRunAt; return r; }
  async list(limit: number) { return this.rows.slice(0, limit); }
}
