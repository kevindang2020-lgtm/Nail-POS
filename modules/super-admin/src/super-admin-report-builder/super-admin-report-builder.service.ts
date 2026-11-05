// super-admin-report-builder.service.ts — validates a report spec against the allow-list, then RUNS it by
// composing from the platform analytics aggregates the service already computes (no ad-hoc cross-tenant SQL).
// Also persists/loads saved definitions (CRUD), all audited. Honest: allow-listed-but-unmapped specs, and
// specs whose backing aggregate has no source, return available:false with a reason rather than fabricated rows.

import { type OverviewScope, DATABASE, type AppDatabase } from '@aipowersalon/database';
import type { RunResult } from '@aipowersalon/api-contracts/platform';
export type { RunResult };   // owned by packages/api-contracts (Constitution 13 §13)
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { SuperAdminAnalyticsService, type AnalyticsRange } from '../super-admin-analytics/super-admin-analytics.service';
import { MEASURES, validateReportSpec, type MeasureKey, type DimensionKey } from './report-builder-catalog';
import type { SuperAdminReportRepo, CreateReportDefinition, UpdateReportDefinition } from './super-admin-report-builder.repository';

export interface ReportCtx { userId?: string; email?: string }
const RANGES = new Set<AnalyticsRange>(['7d', '30d', '90d', '6m', '12m']);
const asRange = (r: unknown): AnalyticsRange => (RANGES.has(String(r) as AnalyticsRange) ? (String(r) as AnalyticsRange) : '30d');
const measureFormat = (m: MeasureKey) => MEASURES.find((x) => x.key === m)?.format ?? 'count';
const chronological = new Set<DimensionKey>(['month', 'hour_of_day']);


@Injectable()
export class SuperAdminReportBuilderService {
  constructor(
    @Inject('SuperAdminReportRepo') private readonly repo: SuperAdminReportRepo,
    private readonly analytics: SuperAdminAnalyticsService,
    @Inject(DATABASE) private readonly db: AppDatabase,
  ) {}

  private async audit(ctx: ReportCtx, action: string, entityId: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: null, user_id: ctx.userId || null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'report_definition', entity_id: entityId, metadata_json: JSON.stringify(meta || {}),
    }).execute().catch(() => { /* auditing never breaks the action */ });
  }

  // ---- run a validated spec by composing from existing analytics aggregates ----
  async run(ctx: ReportCtx, input: any): Promise<RunResult> {
    const v = validateReportSpec(input);
    if (!v.ok) throw new Error(v.error);
    const { dimension, measure, visualization, limit } = v.spec;
    const generatedAt = new Date().toISOString();
    const specOut = { dimension, measure, visualization, limit };
    if (!v.supported) return { ok: true, available: false, reason: v.reason!, spec: specOut, generatedAt };

    const range = asRange(input?.range);
    const scope: OverviewScope = input?.tenantId ? { tenantId: String(input.tenantId) } : {};
    const data: any = await this.analytics.analytics(ctx, range, scope, 'none');
    const m = data.modules;
    const gap = (mod: any): string | null => (mod && mod.available === false ? (mod.reason || 'Not available.') : null);

    let rows: { label: string; value: number }[] = [];
    let source = '';
    switch (dimension) {
      case 'month': { source = 'revenueTransactionsTrend'; const mod = m.revenueTransactionsTrend; const g = gap(mod); if (g) return { ok: true, available: false, reason: g, spec: specOut, generatedAt }; rows = mod.series.map((p: any) => ({ label: p.label, value: measure === 'revenue_cents' ? p.revenueCents : p.transactions })); break; }
      case 'payment_method': { source = 'paymentMethods'; const mod = m.paymentMethods; const g = gap(mod); if (g) return { ok: true, available: false, reason: g, spec: specOut, generatedAt }; rows = mod.byMethod.map((s: any) => ({ label: s.method, value: s.cents })); break; }
      case 'branch': { source = 'branchComparison'; const mod = m.branchComparison; const g = gap(mod); if (g) return { ok: true, available: false, reason: g, spec: specOut, generatedAt }; rows = mod.rows.map((b: any) => ({ label: b.branch, value: b.volumeCents })); break; }
      case 'tenant': { source = 'topTenants'; const mod = m.topTenants; const g = gap(mod); if (g) return { ok: true, available: false, reason: g, spec: specOut, generatedAt }; rows = mod.rows.map((t: any) => ({ label: t.tenantName ?? t.name ?? t.salonName ?? t.tenantId ?? '-', value: t.amountCents ?? t.revenueCents ?? t.monthlyCardVolume ?? 0 })); break; }
      case 'us_state': { source = 'regionalPerformance'; const mod = m.regionalPerformance; const g = gap(mod); if (g) return { ok: true, available: false, reason: g, spec: specOut, generatedAt }; rows = mod.byState.map((s: any) => ({ label: s.state, value: s.tenants })); break; }
      case 'hour_of_day': { source = 'peakHours'; const mod = m.peakHours; const g = gap(mod); if (g) return { ok: true, available: false, reason: g, spec: specOut, generatedAt }; rows = mod.byHour.map((h: any) => ({ label: `${String(h.hour).padStart(2, '0')}:00`, value: h.count })); break; }
      case 'device_status': { source = 'deviceStatus'; const mod = m.deviceStatus; const g = gap(mod); if (g) return { ok: true, available: false, reason: g, spec: specOut, generatedAt }; rows = [{ label: 'Online', value: mod.online }, { label: 'Offline', value: mod.offline }]; break; }
    }

    if (!chronological.has(dimension)) rows = rows.sort((a, b) => b.value - a.value);
    rows = rows.slice(0, limit);
    await this.audit(ctx, 'report.run', 'ad-hoc', { dimension, measure, visualization, range, scoped: !!scope.tenantId, rows: rows.length });
    const dimLabel = dimension.replace(/_/g, ' ');
    const meaLabel = MEASURES.find((x) => x.key === measure)!.label;
    return { ok: true, available: true, spec: specOut, columns: [dimLabel, meaLabel], format: measureFormat(measure), source, rows, generatedAt };
  }

  // ---- saved definitions (CRUD) ----
  list() { return this.repo.list(); }
  get(id: string) { return this.repo.get(id); }

  async create(ctx: ReportCtx, input: any) {
    const v = validateReportSpec(input);
    if (!v.ok) throw new Error(v.error);
    const name = String(input?.name ?? '').trim();
    if (!name) throw new Error('A report name is required.');
    const payload: CreateReportDefinition = {
      name, dimension: v.spec.dimension, measure: v.spec.measure, visualization: v.spec.visualization,
      rangeKey: asRange(input?.range), scopeTenantId: input?.tenantId ? String(input.tenantId) : null,
      filters: input?.filters && typeof input.filters === 'object' ? input.filters : {}, rowLimit: v.spec.limit,
      createdByUserId: ctx.userId ?? null,
    };
    const row = await this.repo.create(payload);
    await this.audit(ctx, 'report.save', row.id, { name, dimension: row.dimension, measure: row.measure });
    return row;
  }

  async update(ctx: ReportCtx, id: string, input: any) {
    // If dimension/measure/visualization present, re-validate the resulting spec.
    if (input?.dimension || input?.measure || input?.visualization) {
      const existing = await this.repo.get(id);
      if (!existing) return null;
      const v = validateReportSpec({ dimension: input?.dimension ?? existing.dimension, measure: input?.measure ?? existing.measure, visualization: input?.visualization ?? existing.visualization, limit: input?.limit ?? existing.rowLimit });
      if (!v.ok) throw new Error(v.error);
    }
    const patch: UpdateReportDefinition = {};
    if (input?.name !== undefined) patch.name = String(input.name).trim();
    if (input?.dimension !== undefined) patch.dimension = String(input.dimension);
    if (input?.measure !== undefined) patch.measure = String(input.measure);
    if (input?.visualization !== undefined) patch.visualization = String(input.visualization);
    if (input?.range !== undefined) patch.rangeKey = asRange(input.range);
    if (input?.tenantId !== undefined) patch.scopeTenantId = input.tenantId ? String(input.tenantId) : null;
    if (input?.filters !== undefined) patch.filters = input.filters;
    if (input?.limit !== undefined) patch.rowLimit = Math.min(500, Math.max(1, Math.trunc(Number(input.limit) || 50)));
    const row = await this.repo.update(id, patch);
    if (row) await this.audit(ctx, 'report.update', id, { fields: Object.keys(patch) });
    return row;
  }

  async remove(ctx: ReportCtx, id: string) {
    const ok = await this.repo.remove(id);
    if (ok) await this.audit(ctx, 'report.delete', id);
    return ok;
  }
}
