// super-admin-scheduled-reports.service.ts — schedule CRUD + execution. Execution reuses the existing analytics
// export (Unit 3) and the report builder run (Unit 4) to produce the artifact; nothing is re-aggregated here.
//
// Honesty (no in-process cron, no mailer):
//   * runDue() is called by an EXTERNAL scheduler; each due schedule is executed once and its next_run_at advanced.
//   * Delivery is IN-APP: the run row stores the artifact for download. recipients are stored but email is not sent.

import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { SuperAdminAnalyticsService, type AnalyticsRange, type ExportFormat } from '../super-admin-analytics/super-admin-analytics.service';
import { SuperAdminReportBuilderService } from '../super-admin-report-builder/super-admin-report-builder.service';
import { toCsv, toXlsx, toPdf, type ExportRow } from '../super-admin-analytics/analytics-export';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import type { SuperAdminScheduledReportRepo, ScheduleRow, ScheduleSource, ScheduleFormat, ScheduleFrequency, CreateSchedule } from './super-admin-scheduled-reports.repository';

export interface SchedCtx { userId?: string; email?: string }
const FORMATS = new Set<ScheduleFormat>(['csv', 'xlsx', 'pdf']);
const FREQS = new Set<ScheduleFrequency>(['daily', 'weekly', 'monthly']);
const SOURCES = new Set<ScheduleSource>(['analytics_export', 'saved_report']);
const RANGES = new Set<AnalyticsRange>(['7d', '30d', '90d', '6m', '12m']);
const MIME: Record<ScheduleFormat, string> = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };

export function computeNextRun(fromIso: string, freq: ScheduleFrequency): string {
  const d = new Date(fromIso);
  if (freq === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (freq === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

@Injectable()
export class SuperAdminScheduledReportsService {
  constructor(
    @Inject('SuperAdminScheduledReportRepo') private readonly repo: SuperAdminScheduledReportRepo,
    private readonly analytics: SuperAdminAnalyticsService,
    private readonly reports: SuperAdminReportBuilderService,
    @Inject(DATABASE) private readonly db: AppDatabase,
  ) {}

  private async audit(ctx: SchedCtx, action: string, entityId: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: null, user_id: ctx.userId || null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'scheduled_report', entity_id: entityId, metadata_json: JSON.stringify(meta || {}),
    }).execute().catch(() => { /* auditing never breaks the action */ });
  }

  list() { return this.repo.list(); }
  get(id: string) { return this.repo.get(id); }
  listRuns(id: string) { return this.repo.listRuns(id); }

  async create(ctx: SchedCtx, input: any): Promise<ScheduleRow> {
    const name = String(input?.name ?? '').trim();
    if (!name) throw new Error('A schedule name is required.');
    const source = (SOURCES.has(input?.source) ? input.source : 'analytics_export') as ScheduleSource;
    const format = (FORMATS.has(input?.format) ? input.format : 'csv') as ScheduleFormat;
    const frequency = (FREQS.has(input?.frequency) ? input.frequency : 'weekly') as ScheduleFrequency;
    const rangeKey = (RANGES.has(input?.range) ? input.range : '30d') as AnalyticsRange;
    if (source === 'saved_report' && !input?.reportDefinitionId) throw new Error('A saved_report schedule requires reportDefinitionId.');
    const recipients = Array.isArray(input?.recipients) ? input.recipients.map((x: any) => String(x)).filter(Boolean).slice(0, 50) : [];
    const now = new Date().toISOString();
    const payload: CreateSchedule = {
      name, source, reportDefinitionId: input?.reportDefinitionId ? String(input.reportDefinitionId) : null, format, rangeKey,
      scopeTenantId: input?.tenantId ? String(input.tenantId) : null, frequency, recipients, deliveryMethod: 'in_app',
      enabled: input?.enabled !== false, nextRunAt: input?.nextRunAt ? new Date(input.nextRunAt).toISOString() : computeNextRun(now, frequency),
      createdByUserId: ctx.userId ?? null,
    };
    const row = await this.repo.create(payload);
    await this.audit(ctx, 'scheduled_report.create', row.id, { name, source, format, frequency });
    return row;
  }

  async update(ctx: SchedCtx, id: string, input: any): Promise<ScheduleRow | null> {
    const patch: any = {};
    if (input?.name !== undefined) patch.name = String(input.name).trim();
    if (input?.source !== undefined && SOURCES.has(input.source)) patch.source = input.source;
    if (input?.reportDefinitionId !== undefined) patch.reportDefinitionId = input.reportDefinitionId ? String(input.reportDefinitionId) : null;
    if (input?.format !== undefined && FORMATS.has(input.format)) patch.format = input.format;
    if (input?.range !== undefined && RANGES.has(input.range)) patch.rangeKey = input.range;
    if (input?.tenantId !== undefined) patch.scopeTenantId = input.tenantId ? String(input.tenantId) : null;
    if (input?.frequency !== undefined && FREQS.has(input.frequency)) patch.frequency = input.frequency;
    if (input?.recipients !== undefined && Array.isArray(input.recipients)) patch.recipients = input.recipients.map((x: any) => String(x)).filter(Boolean).slice(0, 50);
    if (input?.enabled !== undefined) patch.enabled = !!input.enabled;
    if (input?.nextRunAt !== undefined) patch.nextRunAt = new Date(input.nextRunAt).toISOString();
    const row = await this.repo.update(id, patch);
    if (row) await this.audit(ctx, 'scheduled_report.update', id, { fields: Object.keys(patch) });
    return row;
  }

  async remove(ctx: SchedCtx, id: string) {
    const ok = await this.repo.remove(id);
    if (ok) await this.audit(ctx, 'scheduled_report.delete', id);
    return ok;
  }

  // Build the artifact bytes for a schedule by reusing existing export / run paths.
  private async generate(ctx: SchedCtx, s: ScheduleRow): Promise<{ filename: string; mimeType: string; base64: string }> {
    const scope = s.scopeTenantId ? { tenantId: s.scopeTenantId } : {};
    if (s.source === 'analytics_export') {
      return this.analytics.exportData(ctx, s.format as ExportFormat, s.rangeKey as AnalyticsRange, scope, 'none');
    }
    // saved_report → run the definition, serialize its rows in the requested format.
    if (!s.reportDefinitionId) throw new Error('Missing report definition for saved_report schedule.');
    const def: any = await this.reports.get(s.reportDefinitionId);
    if (!def) throw new Error('Referenced report definition no longer exists.');
    const res: any = await this.reports.run(ctx, { dimension: def.dimension, measure: def.measure, visualization: def.visualization, range: s.rangeKey, tenantId: s.scopeTenantId, limit: def.rowLimit });
    if (!res.available) throw new Error(res.reason || 'Report has no available data source.');
    const usd = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows: ExportRow[] = [[res.columns[0], res.columns[1]], ...res.rows.map((r: any) => [r.label, res.format === 'money' ? usd(r.value) : String(r.value)] as ExportRow)];
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `report-${def.dimension}-${def.measure}-${stamp}`;
    if (s.format === 'csv') return { filename: `${base}.csv`, mimeType: MIME.csv, base64: Buffer.from(toCsv(rows), 'utf8').toString('base64') };
    if (s.format === 'xlsx') return { filename: `${base}.xlsx`, mimeType: MIME.xlsx, base64: toXlsx(rows).toString('base64') };
    const lines = rows.slice(1).map((r) => `${r[0]}: ${r[1]}`);
    return { filename: `${base}.pdf`, mimeType: MIME.pdf, base64: toPdf(`AIPowerSalon - ${def.name}`, lines.slice(0, 46)).toString('base64') };
  }

  // Execute one schedule (records a run). `trigger` distinguishes due-driven vs manual "run now".
  private async execute(ctx: SchedCtx, s: ScheduleRow, trigger: 'run_due' | 'manual') {
    try {
      const art = await this.generate(ctx, s);
      const run = await this.repo.insertRun({ scheduleId: s.id, status: 'success', format: s.format, filename: art.filename, artifactBase64: art.base64, byteSize: Buffer.byteLength(art.base64, 'base64'), error: null, trigger });
      await this.audit(ctx, 'scheduled_report.run', s.id, { runId: run.id, status: 'success', trigger, format: s.format });
      return { scheduleId: s.id, runId: run.id, status: 'success' as const, filename: art.filename };
    } catch (e: any) {
      const run = await this.repo.insertRun({ scheduleId: s.id, status: 'error', format: s.format, filename: null, artifactBase64: null, byteSize: 0, error: String(e?.message || e), trigger });
      await this.audit(ctx, 'scheduled_report.run', s.id, { runId: run.id, status: 'error', trigger, error: String(e?.message || e) });
      return { scheduleId: s.id, runId: run.id, status: 'error' as const, error: String(e?.message || e) };
    }
  }

  // Called by an external scheduler. Idempotent in effect: each due schedule runs once and advances next_run_at.
  async runDue(ctx: SchedCtx, nowIso = new Date().toISOString()) {
    const due = await this.repo.due(nowIso);
    const results = [];
    for (const s of due) {
      const r = await this.execute(ctx, s, 'run_due');
      // Advance next_run_at from the scheduled time (not "now") so cadence doesn't drift; skip any missed windows.
      let next = computeNextRun(s.nextRunAt, s.frequency);
      while (next <= nowIso) next = computeNextRun(next, s.frequency);
      await this.repo.markRan(s.id, next, nowIso);
      results.push(r);
    }
    return { ranAt: nowIso, dueCount: due.length, results };
  }

  async runNow(ctx: SchedCtx, id: string) {
    const s = await this.repo.get(id);
    if (!s) return null;
    return this.execute(ctx, s, 'manual');
  }

  async getRunArtifact(runId: string): Promise<{ filename: string; mimeType: string; base64: string } | null> {
    const run = await this.repo.getRun(runId);
    if (!run || run.status !== 'success' || !run.artifactBase64) return null;
    return { filename: run.filename || `report.${run.format}`, mimeType: MIME[(run.format as ScheduleFormat)] || 'application/octet-stream', base64: run.artifactBase64 };
  }
}
