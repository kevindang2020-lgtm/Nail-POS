// payroll.service.ts — payroll-run business logic. Periods + per-technician lines (with commission/payable computed by
// the pure DTO helpers), a draft → finalized → paid lifecycle, KPI roll-ups, and durable audit on mutations. Lines can
// only be edited while a period is in draft. Permission-gated, tenant-scoped.
import type { PayrollContext, PayrollRepositoryPort, CanonicalLineInput } from './payroll.repository';
import { hasPermission } from '@aipowersalon/permissions';
import type { AuditService } from '@aipowersalon/audit';
import {
  type PayrollPeriodRow, type PayrollLineRow, type PeriodFilters, type CreatePeriodRequest, type PeriodStatus, type PayrollKpis,
  derivePayrollKpis, PAYROLL_PERIOD,
} from './payroll.dto';
import { assertTransition } from '@aipowersalon/database';
import { autoBuildPeriod, type AutoBuildPorts } from '../compensation/compensation-payroll-autobuild';
import { resolveEarningsWindow } from '../compensation/earnings-period';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export class NotFoundError extends Error { constructor(msg = 'Payroll period not found') { super(msg); this.name = 'NotFoundError'; } }

export interface PayrollState { kpis: PayrollKpis; periods: PayrollPeriodRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }
export interface PeriodDetail { period: PayrollPeriodRow; lines: PayrollLineRow[] }

/** Structural push port (kept minimal so Nest-free specs can pass a plain object). */
export type PayrollPushLike = { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body?: string; data?: Record<string, string>; reference?: string; category?: string }): Promise<unknown> };

export class PayrollService {
  constructor(private readonly repo: PayrollRepositoryPort, private readonly auditSvc?: AuditService, private readonly autoBuild?: AutoBuildPorts, private readonly push?: PayrollPushLike) {}

  private assertUser(ctx: PayrollContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated'); }
  private need(ctx: PayrollContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private audit(ctx: PayrollContext, action: string, id?: string, metadata?: any) {
    void this.auditSvc?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'payroll', action, resourceType: 'payroll_period', resourceId: id, metadata, severity: action.startsWith('period.paid') ? 'high' : 'low' },
    );
  }

  async getState(ctx: PayrollContext, f: PeriodFilters = {}): Promise<PayrollState> {
    this.need(ctx, 'pos.payroll.view');
    const page = await this.repo.listPeriods(ctx.tenantId, f);
    const all = (await this.repo.listPeriods(ctx.tenantId, {})).items;
    return { kpis: derivePayrollKpis(all), periods: page.items, pagination: page.pagination };
  }

  async getPeriod(ctx: PayrollContext, id: string): Promise<PeriodDetail> {
    this.need(ctx, 'pos.payroll.view');
    const period = await this.repo.getPeriod(ctx, id);
    if (!period) throw new NotFoundError();
    return { period, lines: await this.repo.getLines(ctx, id) };
  }

  async createPeriod(ctx: PayrollContext, req: CreatePeriodRequest): Promise<PayrollPeriodRow> {
    this.need(ctx, 'pos.payroll.manage');
    if (!req?.periodStart || !req?.periodEnd) throw withCode(new ValidationError('Period start and end are required'), 'PERIOD_DATES_REQUIRED');
    if (Date.parse(req.periodEnd) < Date.parse(req.periodStart)) throw withCode(new ValidationError('Period end cannot be before start'), 'PERIOD_DATES_REQUIRED');
    const p = await this.repo.createPeriod(ctx, req);
    this.audit(ctx, 'period.created', p.id, { periodStart: p.periodStart, periodEnd: p.periodEnd });
    return p;
  }

  // upsertLine / removeLine (the hand-typed "manual line": gross × rate, keyed like the canonical line and silently replaced
  // by PREPARE) were REMOVED Oct 13 2026 (FLOW duplicate D7). Off-POS money enters payroll as a ledger ADJUSTMENT
  // (payroll-workflow.service createAdjustment → PREPARE), the one path with a reason, approval and the period's hash.

  /** §20 build the whole period from REAL sales: snapshot earnings + resolved guarantee top-up + net ledger adjustments,
   *  persisted via the canonical (no-recompute) path. Draft only. */
  async buildFromSales(ctx: PayrollContext, periodId: string): Promise<PeriodDetail> {
    this.need(ctx, 'pos.payroll.manage');
    const period = await this.repo.getPeriod(ctx, periodId);
    if (!period) throw new NotFoundError();
    if (period.status !== 'draft') throw withCode(new ValidationError('A period can only be built from sales while in draft'), 'PERIOD_BUILD_DRAFT_ONLY');
    if (!this.autoBuild) throw withCode(new ValidationError('Auto-build is unavailable (no sales source connected)'), 'FEATURE_NOT_AVAILABLE');
    // §126: the period's DATE range is tenant-local [start 00:00, end+1 00:00) — it was passed as raw dates, which made the
    // window UTC midnights AND half-open on the end DATE: the last day of every period was never paid (fixed wave 2).
    const tz = this.autoBuild.timezone ? await this.autoBuild.timezone(ctx.tenantId, period.branchId ?? null).catch(() => 'UTC') : 'UTC';
    const w = resolveEarningsWindow({ period: 'pay_period', timezone: tz, payPeriod: { id: period.id, periodStart: period.periodStart, periodEnd: period.periodEnd } });
    const lines = await autoBuildPeriod(this.autoBuild, { tenantId: ctx.tenantId, fromIso: w.fromIso, toIso: w.toIso, branchId: period.branchId,
      periodId: period.id, periodStart: period.periodStart, periodEnd: period.periodEnd, timezone: tz });
    const canonical: CanonicalLineInput[] = lines.map((l) => ({
      technicianId: l.technicianId, servicesCount: l.servicesCount, grossSalesCents: l.grossSalesCents,
      serviceCommissionCents: l.serviceCommissionCents, retailCommissionCents: l.retailCommissionCents,
      cardTipCents: l.cardTipCents, cashTipCents: l.cashTipCents, tipsCents: l.tipsCents,
      guaranteeTopUpCents: l.guaranteeTopUpCents, adjustmentCents: l.adjustmentCents, payableCents: l.payableCents,
      hourlyPayCents: l.hourlyPayCents, workedMinutes: l.workedMinutes, potentialOvertimeMinutes: l.potentialOvertimeMinutes,
      salaryPayCents: l.salaryPayCents, bonusCents: l.bonusCents, deductionCents: l.deductionCents, netCents: l.netCents, reviewRequired: l.reviewRequired,
    }));
    // §65: one set-based write for the whole salon when the adapter has it (Postgres); line by line otherwise (in-memory)
    if (this.repo.persistCanonicalLines) await this.repo.persistCanonicalLines(ctx, periodId, canonical);
    else for (const l of canonical) await this.repo.persistCanonicalLine(ctx, periodId, l);
    await this.repo.pruneCanonicalLines?.(ctx, periodId, lines.map((l) => l.technicianId));
    this.audit(ctx, 'period.built_from_sales', periodId, { lines: lines.length });
    return { period: (await this.repo.getPeriod(ctx, periodId))!, lines: await this.repo.getLines(ctx, periodId) };
  }

  private async transition(ctx: PayrollContext, periodId: string, to: PeriodStatus, meta?: { reopenReason?: string }): Promise<PayrollPeriodRow> {
    this.need(ctx, 'pos.payroll.manage');
    const period = await this.repo.getPeriod(ctx, periodId);
    if (!period) throw new NotFoundError();
    // Phase 12 (#27): one transition table (PAYROLL_PERIOD) — refused moves are 409 INVALID_STATE_TRANSITION; the
    // repository asserts it again on the locked row, so a concurrent move cannot slip past this read
    assertTransition(PAYROLL_PERIOD, period.status, to, { permissions: ctx.permissions ?? [] });   // paid → finalized is system-only
    // Reopening a FINALIZED period rewinds a reviewed pay run (Payroll mandate §124) — it requires a written reason, which
    // is stored on the row (migration 589) and audited at high severity. (A PAID period never reopens: the machine refuses.)
    const reopenReason = to === 'draft' ? String(meta?.reopenReason ?? '').trim() : '';
    if (to === 'draft' && reopenReason.length < 3) throw withCode(new ValidationError('Reopening a finalized period requires a reason'), 'PERIOD_REOPEN_REASON_REQUIRED');
    const p = await this.repo.setStatus(ctx, periodId, to, to === 'draft' ? { reopenReason } : undefined);
    if (!p) throw new NotFoundError();
    if (to === 'draft') {
      void this.auditSvc?.record(
        { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
        { module: 'payroll', action: 'period.reopened', resourceType: 'payroll_period', resourceId: periodId, severity: 'high', metadata: { reason: reopenReason, previousStatus: period.status, totalPayableCents: p.totalPayableCents } },
      );
    } else {
      this.audit(ctx, to === 'paid' ? 'period.paid' : 'period.finalized', periodId, { totalPayableCents: p.totalPayableCents });
    }
    // Payout push to each technician with a line in this period (§6.2 "payout events"). No amounts in the push —
    // a lock screen is not a payslip; the app shows the figures. Best-effort: never fails the transition.
    if (to === 'paid' && this.push) {
      try {
        const lines = await this.repo.getLines(ctx, periodId);
        const techIds = [...new Set(lines.map((l) => l.technicianId).filter(Boolean))];
        const users = await this.repo.technicianUserIds(ctx, techIds);
        for (const t of techIds) {
          const uid = users[t]; if (!uid) continue;
          await this.push.dispatchToUser(ctx.tenantId, uid, { title: 'Payroll paid', body: 'Your earnings for this pay period have been paid — open Payroll to view.', data: { kind: 'payroll_paid', periodId }, reference: 'payroll_paid', category: 'PAYROLL' });
        }
      } catch { /* best-effort */ }
    }
    return p;
  }
  /** The owner layer asks this before pushing: when true the projection delivers the period transition. */
  emitsDomainEvents(): boolean { return !!this.workflow || !!(this.repo as any).emitsDomainEvents?.(); }
  /** Wave 2: with a database the review / approval / lock workflow owns every transition (validation, approval hash,
   *  payouts, versioned CAS, outbox). The plain transition below stays for the database-less (in-memory) deployment. */
  private workflow: { approve(c: PayrollContext, id: string, b?: any): Promise<any>; markPaid(c: PayrollContext, id: string, b?: any): Promise<any>; reopen(c: PayrollContext, id: string, b?: any): Promise<any> } | null = null;
  useWorkflow(wf: PayrollService['workflow']): void { this.workflow = wf; }
  async finalize(ctx: PayrollContext, id: string) { return this.workflow ? (await this.workflow.approve(ctx, id)).period : this.transition(ctx, id, 'finalized'); }
  async markPaid(ctx: PayrollContext, id: string) { return this.workflow ? (await this.workflow.markPaid(ctx, id, { method: 'other' })).period : this.transition(ctx, id, 'paid'); }
  async reopen(ctx: PayrollContext, id: string, reason?: string) { return this.workflow ? (await this.workflow.reopen(ctx, id, { reason })).period : this.transition(ctx, id, 'draft', { reopenReason: reason }); }

  async getPlatformState(f: PeriodFilters & { tenantId?: string } = {}): Promise<PayrollState> {
    const all = (await this.repo.listPlatform({ tenantId: f.tenantId })).items;
    const page = await this.repo.listPlatform(f);
    return { kpis: derivePayrollKpis(all), periods: page.items, pagination: page.pagination };
  }
}
