/**
 * compensation-compliance.service.ts — §18 owner-facing compliance surface. Manages the per-technician classification
 * (via the repo) and the salon's minimum-wage / overtime thresholds (in tenant_settings category 'compensation', key
 * 'wageCompliance'), and evaluates checkCompliance to surface exceptions for a technician's period pay. It only records
 * inputs and FLAGS exceptions for review — it never changes pay, auto-classifies, or enforces anything.
 */
import { notifySettingsChanged, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import type { WageConfig, CompliancePreview, PeriodComplianceRow } from '@aipowersalon/api-contracts/tenant';
export type { WageConfig, CompliancePreview, PeriodComplianceRow };   // owned by packages/api-contracts (Constitution 13 §13)
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { checkCompliance, type ComplianceFlag, type WorkerClassification } from './compensation-compliance';
import { normalizeClassification, type ClassificationRepo } from './compensation-classification.repository';

export interface ComplianceCtx { tenantId: string; branchId: string | null; userId?: string | null }

export class ComplianceServiceError extends Error {
  constructor(msg: string, public status = 400) { super(msg); this.name = 'ComplianceServiceError'; }
}

export function cleanWageConfig(j: any): WageConfig {
  let min = Number(j?.minHourlyWageCents); if (!Number.isFinite(min) || min < 0) min = 0;
  let ot = Number(j?.overtimeThresholdHours); if (!Number.isFinite(ot) || ot < 0) ot = 0;
  return { minHourlyWageCents: Math.round(min), overtimeThresholdHours: Math.round(ot) };
}

export class ComplianceService {
  constructor(private readonly repo: ClassificationRepo, private readonly db: Kysely<DB> | null, private readonly rt?: RealtimeEmitter) {}

  listClassifications(ctx: ComplianceCtx) { return this.repo.list(ctx); }

  async setClassification(ctx: ComplianceCtx, technicianId: string, classification: unknown) {
    if (!technicianId) throw new ComplianceServiceError('technicianId is required');
    const c = normalizeClassification(classification);
    if (!c) throw new ComplianceServiceError('classification must be employee, contractor, or booth_renter');
    return this.repo.set(ctx, technicianId, c);
  }

  private async settingsRow(ctx: ComplianceCtx): Promise<{ id?: string; json: any } | null> {
    if (!this.db) return null;
    const s: any = await (this.db as any).selectFrom('tenant_settings').select(['id', 'settings_json'])
      .where('tenant_id', '=', ctx.tenantId).where('category', '=', 'compensation')
      .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]))
      .orderBy('branch_id', 'desc').executeTakeFirst().catch(() => null);
    if (!s) return null;
    const json = s.settings_json ? (typeof s.settings_json === 'string' ? JSON.parse(s.settings_json) : s.settings_json) : {};
    return { id: s.id, json };
  }

  async getWageConfig(ctx: ComplianceCtx): Promise<WageConfig> {
    try { const r = await this.settingsRow(ctx); return cleanWageConfig(r?.json?.wageCompliance || {}); }
    catch { return { minHourlyWageCents: 0, overtimeThresholdHours: 0 }; }
  }

  async setWageConfig(ctx: ComplianceCtx, input: unknown): Promise<WageConfig> {
    const wc = cleanWageConfig(input || {});
    if (this.db) {
      // NOT best-effort any more. This block used to sit inside `try { … } catch { /* best-effort */ }`, so a
      // failed write was swallowed and the method still returned the NEW value as if it had been saved. The owner
      // was told the policy changed while the database kept the old one, and payroll computed against the old
      // one. A failed save of a payroll setting must fail visibly. Only the audit write stays best-effort.
      {
        const existing = await this.settingsRow(ctx);
        const json = { ...(existing?.json || {}), wageCompliance: wc };
        if (existing?.id) await (this.db as any).updateTable('tenant_settings').set({ settings_json: json as any, updated_by_user_id: ctx.userId ?? null, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', existing.id).execute();
        else await (this.db as any).insertInto('tenant_settings').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, category: 'compensation', settings_json: json as any, updated_by_user_id: ctx.userId ?? null } as any).execute();
        notifySettingsChanged(this.rt, ctx.tenantId, 'compensation.wage_compliance');   // after the write succeeded — never on failure
      }
    }
    return wc;
  }

  /** Evaluate wage-compliance flags for a technician's period pay + hours (a review tool, not enforcement). */
  async previewCompliance(ctx: ComplianceCtx, args: { technicianId?: string; periodPayCents?: number; hoursWorked?: number }): Promise<CompliancePreview> {
    if (!args?.technicianId) throw new ComplianceServiceError('technicianId is required');
    const stored = await this.repo.get(ctx, args.technicianId);
    const classification = stored ?? 'employee'; // unclassified defaults to employee for the check (most protective)
    const wageConfig = await this.getWageConfig(ctx);
    const flags = checkCompliance({
      classification,
      periodPayCents: Math.max(0, Math.round(Number(args.periodPayCents) || 0)),
      hoursWorked: Math.max(0, Number(args.hoursWorked) || 0),
      minHourlyWageCents: wageConfig.minHourlyWageCents,
      overtimeThresholdHours: wageConfig.overtimeThresholdHours,
    });
    return { technicianId: args.technicianId, classification, classificationSet: stored != null, wageConfig, flags };
  }

  /**
   * Read-only compliance review for an already-built payroll period: for each technician's persisted line, pull their
   * actual payable amount and sum their worked hours from the time-clock shifts, then flag exceptions. Changes nothing —
   * it reports flags for the owner to review before finalizing. Does not touch pay or the guarantee's hours proration.
   */
  async reviewPeriod(ctx: ComplianceCtx, periodId: string): Promise<PeriodComplianceRow[]> {
    if (!periodId) throw new ComplianceServiceError('periodId is required');
    if (!this.db) return [];
    const db = this.db as any;
    const period: any = await db.selectFrom('payroll_periods').select(['period_start', 'period_end']).where('id', '=', periodId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst().catch(() => null);
    if (!period) throw new ComplianceServiceError('Payroll period not found', 404);
    const toDateStr = (v: any): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    const fromDate = toDateStr(period.period_start);
    const toDate = toDateStr(period.period_end);
    const lines: any[] = await db.selectFrom('payroll_lines').select(['technician_id', 'technician_name', 'payable_cents']).where('period_id', '=', periodId).where('tenant_id', '=', ctx.tenantId).execute().catch(() => []);
    if (lines.length === 0) return [];
    const hoursRes: any = await sql`
      SELECT technician_id, COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0), 0) AS hours
      FROM technician_shifts
      WHERE tenant_id = ${ctx.tenantId} AND shift_date >= ${fromDate} AND shift_date <= ${toDate}
        AND start_time IS NOT NULL AND end_time IS NOT NULL
      GROUP BY technician_id
    `.execute(db).catch(() => ({ rows: [] }));
    const hoursRows: any[] = hoursRes?.rows ?? [];
    const hoursByTech = new Map<string, number>(hoursRows.map((r: any) => [r.technician_id, Number(r.hours || 0)]));
    const classes = await this.repo.list(ctx).catch(() => []);
    const classByTech = new Map<string, WorkerClassification>(classes.map((c) => [c.technicianId, c.classification as WorkerClassification]));
    const wageConfig = await this.getWageConfig(ctx);
    return lines.map((l: any) => {
      const classification = classByTech.get(l.technician_id) ?? 'employee';
      const hoursWorked = hoursByTech.get(l.technician_id) ?? 0;
      const payableCents = Number(l.payable_cents || 0);
      const flags = checkCompliance({ classification, periodPayCents: payableCents, hoursWorked, minHourlyWageCents: wageConfig.minHourlyWageCents, overtimeThresholdHours: wageConfig.overtimeThresholdHours });
      return { technicianId: l.technician_id, technicianName: l.technician_name ?? null, classification, payableCents, hoursWorked, flags };
    });
  }
}
