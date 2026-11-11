// payroll.repository.ts — port + in-memory adapter. Upserting a line recomputes the period totals so the summary is
// always consistent. The in-memory store starts EMPTY (no mock data). Lines are keyed unique per (period, technician).
import { randomUUID } from 'crypto';
import type { PayrollPeriodRow, PayrollLineRow, PeriodFilters, CreatePeriodRequest, UpsertLineRequest, PeriodStatus } from './payroll.dto';
import { computeLine, rollupPeriodTotals, applyPeriodFilters, technicianTerm } from './payroll.dto';
import { clampPage } from '@aipowersalon/api-contracts';
import { periodsOverlap, overlapError } from './payroll-workflow';

export interface PayrollContext {
  tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[];
  /** the request's authorization state (req.ctx.authz): a role template's access scope and the branches it may enter —
   *  §14 a BRANCH / SELECTED_BRANCHES manager sees and changes only their branches' contribution */
  authz?: { scope?: string | null; branchIds?: string[] | null } | null;
}
export interface PeriodPage { items: PayrollPeriodRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }

export interface CanonicalLineInput {
  technicianId: string; technicianName?: string | null; servicesCount: number; grossSalesCents: number;
  serviceCommissionCents: number; retailCommissionCents: number; cardTipCents: number; cashTipCents: number;
  tipsCents: number; guaranteeTopUpCents: number; adjustmentCents: number; payableCents: number;
  /** wave 2 (migration 610) — optional so legacy callers keep compiling; absent = 0 / net == payable. */
  hourlyPayCents?: number; workedMinutes?: number; potentialOvertimeMinutes?: number; salaryPayCents?: number;
  bonusCents?: number; deductionCents?: number; netCents?: number; reviewRequired?: boolean;
}

export interface PayrollRepositoryPort {
  persistCanonicalLine(ctx: PayrollContext, periodId: string, line: CanonicalLineInput): Promise<{ period: PayrollPeriodRow; line: PayrollLineRow } | null>;
  /** §65: persist the whole build at once (set-based). Optional — without it the service persists line by line. */
  persistCanonicalLines?(ctx: PayrollContext, periodId: string, lines: CanonicalLineInput[]): Promise<PayrollPeriodRow | null>;
  /** wave 2: drop CANONICAL (built-from-sales) lines whose technician is no longer in the build — manual lines are kept. */
  pruneCanonicalLines?(ctx: PayrollContext, periodId: string, keepTechnicianIds: string[]): Promise<void>;
  createPeriod(ctx: PayrollContext, req: CreatePeriodRequest): Promise<PayrollPeriodRow>;
  getPeriod(ctx: PayrollContext, id: string): Promise<PayrollPeriodRow | null>;
  listPeriods(tenantId: string, filters: PeriodFilters): Promise<PeriodPage>;
  listPlatform(filters: PeriodFilters & { tenantId?: string }): Promise<PeriodPage>;
  getLines(ctx: PayrollContext, periodId: string): Promise<PayrollLineRow[]>;
  /** test seeding only (in-memory): the API's manual-line write path was removed Oct 13 2026 (FLOW D7) — PREPARE writes lines. */
  upsertLine?(ctx: PayrollContext, periodId: string, req: UpsertLineRequest): Promise<{ period: PayrollPeriodRow; line: PayrollLineRow } | null>;
  removeLine?(ctx: PayrollContext, periodId: string, technicianId: string): Promise<PayrollPeriodRow | null>;
  setStatus(ctx: PayrollContext, periodId: string, status: PeriodStatus, meta?: { reopenReason?: string }): Promise<PayrollPeriodRow | null>;
  /** users.id per technician (tenant-scoped), for push dispatch on payout events. Unlinked techs are omitted. */
  technicianUserIds(ctx: PayrollContext, technicianIds: string[]): Promise<Record<string, string>>;
}

function paginate(rows: PayrollPeriodRow[], f: PeriodFilters): PeriodPage {
  const sorted = rows.slice().sort((a, b) => Date.parse(b.periodStart) - Date.parse(a.periodStart));
  const page = clampPage(f.page);
  const pageSize = Math.min(200, Math.max(1, Number(f.pageSize) || 50));
  const totalItems = sorted.length;
  return { items: sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) } };
}

export class InMemoryPayrollRepository implements PayrollRepositoryPort {
  async technicianUserIds(_ctx: PayrollContext, technicianIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}; for (const t of technicianIds) out[t] = 'user_' + t; return out;
  }
  private periods: PayrollPeriodRow[] = [];
  private lines: PayrollLineRow[] = [];

  private recompute(period: PayrollPeriodRow) {
    const totals = rollupPeriodTotals(this.lines.filter((l) => l.periodId === period.id));
    period.totalGrossCents = totals.totalGrossCents; period.totalCommissionCents = totals.totalCommissionCents;
    period.totalTipsCents = totals.totalTipsCents; period.totalPayableCents = totals.totalPayableCents;
    period.updatedAt = new Date().toISOString();
  }

  async createPeriod(ctx: PayrollContext, req: CreatePeriodRequest): Promise<PayrollPeriodRow> {
    const clash = this.periods.find((p) => p.tenantId === ctx.tenantId && periodsOverlap(p, { periodStart: req.periodStart, periodEnd: req.periodEnd, branchId: ctx.branchId ?? null }));
    if (clash) throw overlapError(clash);
    const now = new Date().toISOString();
    const p: PayrollPeriodRow = {
      id: randomUUID(), tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, label: req.label ?? null,
      periodStart: req.periodStart, periodEnd: req.periodEnd, status: 'draft', finalizedAt: null, paidAt: null,
      totalGrossCents: 0, totalCommissionCents: 0, totalTipsCents: 0, totalPayableCents: 0, createdAt: now, updatedAt: now,
    };
    this.periods.push(p);
    return p;
  }

  async getPeriod(ctx: PayrollContext, id: string): Promise<PayrollPeriodRow | null> {
    return this.periods.find((p) => p.id === id && p.tenantId === ctx.tenantId) ?? null;
  }

  async listPeriods(tenantId: string, filters: PeriodFilters): Promise<PeriodPage> {
    const term = technicianTerm(filters.technician);
    const hit = term ? new Set(this.lines.filter((l) => l.tenantId === tenantId && technicianTerm(l.technicianName ?? '')?.text.includes(term.text)).map((l) => l.periodId)) : undefined;
    return paginate(applyPeriodFilters(this.periods.filter((p) => p.tenantId === tenantId), filters, hit), filters);
  }
  async listPlatform(filters: PeriodFilters & { tenantId?: string }): Promise<PeriodPage> {
    const all = filters.tenantId ? this.periods.filter((p) => p.tenantId === filters.tenantId) : this.periods;
    return paginate(applyPeriodFilters(all, filters), filters);
  }

  async getLines(ctx: PayrollContext, periodId: string): Promise<PayrollLineRow[]> {
    const p = await this.getPeriod(ctx, periodId);
    if (!p) return [];
    return this.lines.filter((l) => l.periodId === periodId).sort((a, b) => (b.payableCents - a.payableCents));
  }

  async persistCanonicalLine(ctx: PayrollContext, periodId: string, l: CanonicalLineInput) {
    const p = await this.getPeriod(ctx, periodId); if (!p) return null;
    let line = this.lines.find((x) => x.periodId === periodId && x.technicianId === l.technicianId);
    const row = { periodId, tenantId: ctx.tenantId, technicianId: l.technicianId, technicianName: l.technicianName ?? null,
      servicesCount: l.servicesCount, grossSalesCents: l.grossSalesCents, commissionType: 'canonical' as any, commissionValue: 0,
      commissionCents: l.serviceCommissionCents, tipsCents: l.tipsCents, adjustmentCents: l.adjustmentCents, payableCents: l.payableCents } as any;
    if (line) Object.assign(line, row); else { line = { id: 'pl_' + (this.lines.length + 1), ...row, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any; this.lines.push(line!); }
    const period = await this.recompute(p); return { period: period!, line: line! };
  }

  async upsertLine(ctx: PayrollContext, periodId: string, req: UpsertLineRequest) {
    const p = await this.getPeriod(ctx, periodId);
    if (!p) return null;
    const c = computeLine(req);
    const now = new Date().toISOString();
    let line = this.lines.find((l) => l.periodId === periodId && l.technicianId === req.technicianId);
    if (line) {
      Object.assign(line, { technicianName: req.technicianName ?? line.technicianName, ...c, updatedAt: now });
    } else {
      line = { id: randomUUID(), tenantId: ctx.tenantId, periodId, technicianId: req.technicianId, technicianName: req.technicianName ?? null, ...c, createdAt: now, updatedAt: now };
      this.lines.push(line);
    }
    this.recompute(p);
    return { period: p, line };
  }

  async removeLine(ctx: PayrollContext, periodId: string, technicianId: string): Promise<PayrollPeriodRow | null> {
    const p = await this.getPeriod(ctx, periodId);
    if (!p) return null;
    this.lines = this.lines.filter((l) => !(l.periodId === periodId && l.technicianId === technicianId));
    this.recompute(p);
    return p;
  }

  async setStatus(ctx: PayrollContext, periodId: string, status: PeriodStatus, meta?: { reopenReason?: string }): Promise<PayrollPeriodRow | null> {
    const p = await this.getPeriod(ctx, periodId);
    if (!p) return null;
    p.status = status;
    const now = new Date().toISOString();
    if (status === 'finalized') p.finalizedAt = now;
    if (status === 'paid') p.paidAt = now;
    if (status === 'draft' && meta?.reopenReason) { p.reopenReason = meta.reopenReason; p.reopenedAt = now; p.reopenedBy = ctx.userId ?? null; }
    p.updatedAt = now;
    return p;
  }
}
