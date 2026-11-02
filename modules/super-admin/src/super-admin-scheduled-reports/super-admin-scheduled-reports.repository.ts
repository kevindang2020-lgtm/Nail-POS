// super-admin-scheduled-reports.repository.ts — persistence for scheduled reports and their run history.
// In-memory + Kysely implementations behind one interface (project standard).

import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { ScheduleFormat, ScheduleFrequency, ScheduleSource } from '@aipowersalon/api-contracts/platform';
import type { ScheduleFormat, ScheduleFrequency, ScheduleSource } from '@aipowersalon/api-contracts/platform';


export type ScheduleRow = {
  id: string; name: string; source: ScheduleSource; reportDefinitionId: string | null; format: ScheduleFormat;
  rangeKey: string; scopeTenantId: string | null; frequency: ScheduleFrequency; recipients: string[]; deliveryMethod: 'in_app';
  enabled: boolean; nextRunAt: string; lastRunAt: string | null; createdByUserId: string | null; createdAt: string; updatedAt: string;
};
export type CreateSchedule = Omit<ScheduleRow, 'id' | 'lastRunAt' | 'createdAt' | 'updatedAt'>;
export type UpdateSchedule = Partial<Pick<ScheduleRow, 'name' | 'source' | 'reportDefinitionId' | 'format' | 'rangeKey' | 'scopeTenantId' | 'frequency' | 'recipients' | 'enabled' | 'nextRunAt'>>;

export type RunRow = {
  id: string; scheduleId: string; status: 'success' | 'error'; format: string; filename: string | null;
  artifactBase64: string | null; byteSize: number; error: string | null; trigger: 'run_due' | 'manual'; createdAt: string;
  /** B-18 (migration 677): the private-store key of the artifact; artifactBase64 stays for runs written before */
  artifactKey?: string | null;
};
export type CreateRun = Omit<RunRow, 'id' | 'createdAt'> & { /** B-18: the service names the run id so the private-store key carries it */ id?: string };

export interface SuperAdminScheduledReportRepo {
  list(): Promise<ScheduleRow[]>;
  get(id: string): Promise<ScheduleRow | null>;
  due(nowIso: string): Promise<ScheduleRow[]>;
  create(i: CreateSchedule): Promise<ScheduleRow>;
  update(id: string, patch: UpdateSchedule): Promise<ScheduleRow | null>;
  markRan(id: string, nextRunAtIso: string, ranAtIso: string): Promise<void>;
  remove(id: string): Promise<boolean>;
  insertRun(r: CreateRun): Promise<RunRow>;
  listRuns(scheduleId: string, limit?: number): Promise<RunRow[]>;
  getRun(runId: string): Promise<RunRow | null>;
}

export class InMemorySuperAdminScheduledReportRepo implements SuperAdminScheduledReportRepo {
  private schedules = new Map<string, ScheduleRow>();
  private runs = new Map<string, RunRow>();
  private s = 0; private r = 0;
  async list() { return [...this.schedules.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async get(id: string) { return this.schedules.get(id) ?? null; }
  async due(nowIso: string) { return [...this.schedules.values()].filter((x) => x.enabled && x.nextRunAt <= nowIso); }
  async create(i: CreateSchedule) {
    const now = new Date().toISOString();
    const row: ScheduleRow = { ...i, id: `sch_${++this.s}_${Math.random().toString(36).slice(2, 8)}`, lastRunAt: null, createdAt: now, updatedAt: now };
    this.schedules.set(row.id, row); return row;
  }
  async update(id: string, patch: UpdateSchedule) {
    const cur = this.schedules.get(id); if (!cur) return null;
    const next = { ...cur, ...patch, recipients: patch.recipients ?? cur.recipients, updatedAt: new Date().toISOString() };
    this.schedules.set(id, next); return next;
  }
  async markRan(id: string, nextRunAtIso: string, ranAtIso: string) {
    const cur = this.schedules.get(id); if (!cur) return;
    this.schedules.set(id, { ...cur, nextRunAt: nextRunAtIso, lastRunAt: ranAtIso, updatedAt: new Date().toISOString() });
  }
  async remove(id: string) { return this.schedules.delete(id); }
  async insertRun(r: CreateRun) {
    const row: RunRow = { ...r, id: r.id ?? `run_${++this.r}_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() };   // B-18: a named id is honoured
    this.runs.set(row.id, row); return row;
  }
  async listRuns(scheduleId: string, limit = 50) { return [...this.runs.values()].filter((x) => x.scheduleId === scheduleId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); }
  async getRun(runId: string) { return this.runs.get(runId) ?? null; }
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : (v == null ? null : String(v)));
const mapSchedule = (r: any): ScheduleRow => ({
  id: r.id, name: r.name, source: r.source, reportDefinitionId: r.report_definition_id ?? null, format: r.format,
  rangeKey: r.range_key, scopeTenantId: r.scope_tenant_id ?? null, frequency: r.frequency,
  recipients: typeof r.recipients_json === 'string' ? JSON.parse(r.recipients_json) : (r.recipients_json ?? []),
  deliveryMethod: 'in_app', enabled: !!r.enabled, nextRunAt: iso(r.next_run_at)!, lastRunAt: iso(r.last_run_at),
  createdByUserId: r.created_by_user_id ?? null, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
});
const mapRun = (r: any): RunRow => ({
  id: r.id, scheduleId: r.schedule_id, status: r.status, format: r.format, filename: r.filename ?? null,
  artifactBase64: r.artifact_base64 ?? null, artifactKey: r.artifact_key ?? null, byteSize: Number(r.byte_size ?? 0), error: r.error ?? null,
  trigger: r.trigger ?? 'run_due', createdAt: iso(r.created_at)!,
});

export class KyselySuperAdminScheduledReportRepo implements SuperAdminScheduledReportRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async list() { return (await this.db.selectFrom('super_admin_scheduled_reports').selectAll().orderBy('created_at', 'desc').limit(500).execute()).map(mapSchedule); }
  async get(id: string) { const r = await this.db.selectFrom('super_admin_scheduled_reports').selectAll().where('id', '=', id).executeTakeFirst(); return r ? mapSchedule(r) : null; }
  async due(nowIso: string) { return (await this.db.selectFrom('super_admin_scheduled_reports').selectAll().where('enabled', '=', true).where('next_run_at', '<=', new Date(nowIso)).orderBy('next_run_at', 'asc').limit(200).execute()).map(mapSchedule); }
  async create(i: CreateSchedule) {
    const r = await this.db.insertInto('super_admin_scheduled_reports').values({
      name: i.name, source: i.source, report_definition_id: i.reportDefinitionId, format: i.format, range_key: i.rangeKey,
      scope_tenant_id: i.scopeTenantId, frequency: i.frequency, recipients_json: JSON.stringify(i.recipients),
      delivery_method: i.deliveryMethod, enabled: i.enabled, next_run_at: new Date(i.nextRunAt), created_by_user_id: i.createdByUserId,
    }).returningAll().executeTakeFirstOrThrow();
    return mapSchedule(r);
  }
  async update(id: string, patch: UpdateSchedule) {
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.source !== undefined) set.source = patch.source;
    if (patch.reportDefinitionId !== undefined) set.report_definition_id = patch.reportDefinitionId;
    if (patch.format !== undefined) set.format = patch.format;
    if (patch.rangeKey !== undefined) set.range_key = patch.rangeKey;
    if (patch.scopeTenantId !== undefined) set.scope_tenant_id = patch.scopeTenantId;
    if (patch.frequency !== undefined) set.frequency = patch.frequency;
    if (patch.recipients !== undefined) set.recipients_json = JSON.stringify(patch.recipients);
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.nextRunAt !== undefined) set.next_run_at = new Date(patch.nextRunAt);
    const r = await this.db.updateTable('super_admin_scheduled_reports').set(set).where('id', '=', id).returningAll().executeTakeFirst();
    return r ? mapSchedule(r) : null;
  }
  async markRan(id: string, nextRunAtIso: string, ranAtIso: string) {
    await this.db.updateTable('super_admin_scheduled_reports').set({ next_run_at: new Date(nextRunAtIso), last_run_at: new Date(ranAtIso), updated_at: new Date() }).where('id', '=', id).execute();
  }
  async remove(id: string) { const r = await this.db.deleteFrom('super_admin_scheduled_reports').where('id', '=', id).executeTakeFirst(); return Number(r?.numDeletedRows ?? 0) > 0; }
  async insertRun(rr: CreateRun) {
    const r = await this.db.insertInto('super_admin_scheduled_report_runs').values({
      ...(rr.id ? { id: rr.id } : {}),   // B-18: the service names the run id so the private-store key carries it
      schedule_id: rr.scheduleId, status: rr.status, format: rr.format, filename: rr.filename, artifact_base64: rr.artifactBase64, artifact_key: rr.artifactKey ?? null,
      byte_size: rr.byteSize, error: rr.error, trigger: rr.trigger,
    }).returningAll().executeTakeFirstOrThrow();
    return mapRun(r);
  }
  async listRuns(scheduleId: string, limit = 50) { return (await this.db.selectFrom('super_admin_scheduled_report_runs').selectAll().where('schedule_id', '=', scheduleId).orderBy('created_at', 'desc').limit(limit).execute()).map(mapRun); }
  async getRun(runId: string) { const r = await this.db.selectFrom('super_admin_scheduled_report_runs').selectAll().where('id', '=', runId).executeTakeFirst(); return r ? mapRun(r) : null; }
}
