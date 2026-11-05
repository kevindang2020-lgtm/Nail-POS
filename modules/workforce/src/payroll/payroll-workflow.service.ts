/**
 * payroll-workflow.service.ts — THE payroll review / approval / lock / payout / export workflow (Payroll mandate §65–§84,
 * §119–§125, §143–§153, wave 2 Oct 12 2026). It extends the ONE payroll system (payroll_periods / payroll_lines, built
 * from the immutable compensation snapshot + the adjustments ledger by PayrollService.buildFromSales) — no second payroll.
 *
 *   OPEN (draft) ──prepare──▶ READY_FOR_REVIEW (review: lines rebuilt, validated, preview hash; lines DB-locked)
 *        ▲  ◀──send back──┘                     │approve (payroll.approve + step-up, expected version, hash, no blocking issue)
 *        └──reopen (reason, step-up)── APPROVED+LOCKED (finalized: approval hash) ──pay (payouts.manage + step-up)──▶ PAID
 *
 * Concurrency (§75–§77): every write takes the period row FOR UPDATE inside one transaction and compares the version —
 * ten concurrent approvals are one transition and nine PAYROLL_PERIOD_ALREADY_APPROVED; a stale expectedVersion is
 * PAYROLL_VERSION_CONFLICT. Payouts are bounded by the line's payable under the same lock (§149) and idempotent per key.
 * Events go through the transactional outbox in the same transaction (§114). Audit rows for every high-impact step (§122).
 * Money is integer cents; nothing here trusts a client-sent amount except a payout amount, which is bounded server-side.
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import { assertTransition, canMoveToSql, type DB } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import type { AuditService } from '@aipowersalon/audit';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import type { PayrollContext } from './payroll.repository';
import { PAYROLL_PERIOD, PAYROLL_PAYOUT, PAYROLL_INQUIRY, PAYOUT_METHODS, ymdOf, type PayrollPeriodRow, type PayrollLineRow, type PayoutMethod, type PayoutStatus } from './payroll.dto';
import { toLine, toPeriod } from './payroll.kysely.repository';
import { PayrollError, PAYROLL_CALCULATION_VERSION, canonicalLineHash, evaluateValidation, payoutHeadroom, type ValidationFacts, type ValidationResult } from './payroll-workflow';
import { buildPayrollExport, type PayrollExportFormat } from './payroll-export';
import { NotConfiguredPayrollProvider, type PayrollProviderPort } from './payroll-provider.port';
import { resolveEarningsWindow } from '../compensation/earnings-period';
import { CompensationSnapshotRepository } from '../compensation/compensation-snapshot.repository';
import { CompensationExceptionsRepository, EXCEPTION_KINDS } from '../compensation/compensation-exceptions.repository';
import { LARGE_ADJUSTMENT_CENTS } from '../compensation/compensation-adjustments';
import { PayPlansRepository, PAY_TYPES, type PayPlan, type PayType } from '../compensation/compensation-pay-plans';
import { COMPENSATION_ADJUSTMENT, COMPENSATION_EXCEPTION } from '../workforce-lifecycles';
import { autoBuildPeriod, type AutoBuildPorts } from '../compensation/compensation-payroll-autobuild';

type Db = Kysely<DB>;
type Trx = Transaction<DB>;
export type PayrollPushLike = { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body?: string; data?: Record<string, string>; reference?: string; category?: string }): Promise<unknown> };
/** The build step lives in PayrollService (the ONE build); the workflow calls it through this port. */
export interface PayrollBuilder { buildFromSales(ctx: PayrollContext, periodId: string): Promise<unknown> }
/** Retry a paid ticket's compensation snapshot (the recovery path, §196). */
export interface SnapshotRetrier { snapshotPaidTicket(ctx: { tenantId: string; branchId: string | null }, ticketId: string): Promise<{ ok: boolean; error?: string }> }

const PERIOD_COLS = ['id', 'tenant_id', 'branch_id', 'label', 'period_start', 'period_end', 'status', 'finalized_at', 'paid_at', 'total_gross_cents', 'total_commission_cents',
  'total_tips_cents', 'total_payable_cents', 'created_at', 'updated_at', 'reopen_reason', 'reopened_at', 'reopened_by', 'version', 'calculation_version', 'preview_hash',
  'approval_hash', 'prepared_at', 'prepared_by', 'approved_by', 'paid_by', 'blocking_count', 'warning_count', 'pay_date'] as const;
const LINE_COLS = ['id', 'tenant_id', 'period_id', 'technician_id', 'technician_name', 'services_count', 'gross_sales_cents', 'commission_type', 'commission_value', 'commission_cents',
  'tips_cents', 'adjustment_cents', 'payable_cents', 'created_at', 'updated_at', 'retail_commission_cents', 'card_tip_cents', 'cash_tip_cents', 'guarantee_topup_cents',
  'hourly_pay_cents', 'worked_minutes', 'potential_overtime_minutes', 'salary_pay_cents', 'bonus_cents', 'deduction_cents', 'net_cents', 'review_required'] as const;
const PAYOUT_COLS = ['id', 'period_id', 'technician_id', 'amount_cents', 'method', 'status', 'reference', 'note', 'failure_reason', 'paid_at', 'created_by', 'created_at', 'updated_at'] as const;
const ADJ_COLS = ['id', 'technician_id', 'ticket_id', 'service_line_id', 'period_id', 'original_period_id', 'category', 'amount_cents', 'reason', 'reason_code', 'deduction_type',
  'status', 'source', 'requested_by', 'approved_by', 'decided_by', 'decided_at', 'decision_reason', 'created_at', 'chargeback_id', 'refund_payment_id'] as const;

export interface PayoutRow { id: string; periodId: string; technicianId: string; amountCents: number; method: PayoutMethod; status: PayoutStatus; reference: string | null; note: string | null; failureReason: string | null; paidAt: string | null; createdBy: string | null; createdAt: string }
const toPayout = (r: any): PayoutRow => ({ id: r.id, periodId: r.period_id, technicianId: r.technician_id, amountCents: Number(r.amount_cents), method: r.method, status: r.status,
  reference: r.reference ?? null, note: r.note ?? null, failureReason: r.failure_reason ?? null, paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null, createdBy: r.created_by ?? null, createdAt: new Date(r.created_at).toISOString() });
export interface AdjustmentRow { id: string; technicianId: string | null; ticketId: string | null; periodId: string | null; originalPeriodId: string | null; category: string; amountCents: number; reason: string; reasonCode: string | null; deductionType: string | null; status: string; source: string; requestedBy: string | null; decidedBy: string | null; decidedAt: string | null; decisionReason: string | null; createdAt: string; chargebackId: string | null }
const toAdj = (r: any): AdjustmentRow => ({ id: r.id, technicianId: r.technician_id ?? null, ticketId: r.ticket_id ?? null, periodId: r.period_id ?? null, originalPeriodId: r.original_period_id ?? null,
  category: r.category, amountCents: Number(r.amount_cents), reason: r.reason, reasonCode: r.reason_code ?? null, deductionType: r.deduction_type ?? null, status: r.status, source: r.source,
  requestedBy: r.requested_by ?? null, decidedBy: r.decided_by ?? r.approved_by ?? null, decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null, decisionReason: r.decision_reason ?? null,
  createdAt: new Date(r.created_at).toISOString(), chargebackId: r.chargeback_id ?? null });

/** Manual adjustment categories a payroll user may create (§62–§64). Refund / void / chargeback / tip corrections come from their own flows. */
export const MANUAL_CATEGORIES = ['bonus', 'commission_correction', 'guarantee_correction', 'payroll_correction', 'deduction'] as const;
export type ManualCategory = typeof MANUAL_CATEGORIES[number];
export const REASON_CODES = ['performance_bonus', 'attendance_bonus', 'campaign_bonus', 'manual_bonus', 'missed_commission', 'commission_error', 'guarantee_error',
  'prior_period_correction', 'negative_carry_forward', 'supply_charge', 'equipment', 'advance_repayment', 'other'] as const;

export class PayrollWorkflowService {
  private readonly snap: CompensationSnapshotRepository;
  private readonly exceptions: CompensationExceptionsRepository;
  private readonly plans: PayPlansRepository;
  private readonly provider: PayrollProviderPort;
  constructor(private readonly db: Db, private readonly opts: {
    outbox?: OutboxWriter; audit?: AuditService; push?: PayrollPushLike; builder?: PayrollBuilder; autoBuild?: AutoBuildPorts;
    snapshots?: SnapshotRetrier; provider?: PayrollProviderPort; now?: () => number;
  } = {}) {
    this.snap = new CompensationSnapshotRepository(db);
    this.exceptions = new CompensationExceptionsRepository(db);
    this.plans = new PayPlansRepository(db);
    this.provider = opts.provider ?? new NotConfiguredPayrollProvider();
  }

  // ── guards / helpers ────────────────────────────────────────────────────────────────────────────────────────────────
  private need(ctx: PayrollContext, perm: string) {
    if (!ctx?.tenantId || !ctx?.userId) throw new PayrollError('PERMISSION_DENIED', 'Sign in to a salon first.');
    if (!hasPermission(ctx as any, perm)) throw new PayrollError('PERMISSION_DENIED', `You need the ${perm} permission for this payroll action.`, { permission: perm });
  }
  private nowIso() { return new Date(this.opts.now ? this.opts.now() : Date.now()).toISOString(); }
  private async audit(ctx: PayrollContext, action: string, resourceId: string, severity: 'low' | 'medium' | 'high', metadata: Record<string, unknown>, reason?: string | null, resourceType = 'payroll_period') {
    await this.opts.audit?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null } as any,
      { module: 'payroll', action, resourceType, resourceId, severity, metadata, reason: reason ?? null } as any).catch(() => undefined);
  }
  private async event(trx: Trx, ctx: PayrollContext, type: string, period: { id: string; branch_id?: string | null }, payload: Record<string, unknown>) {
    if (!this.opts.outbox) return;
    await this.opts.outbox.write(trx as any, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: (period.branch_id as string) ?? undefined,
      aggregateType: 'payroll_period', aggregateId: period.id, actorId: ctx.userId || undefined, actorType: 'user', payload: { periodId: period.id, ...payload } }));
  }
  private async periodRaw(db: Db | Trx, ctx: PayrollContext, id: string, lock = false): Promise<any | null> {
    let q = (db as Db).selectFrom('payroll_periods').select([...PERIOD_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    return (await q.executeTakeFirst()) ?? null;
  }
  private async mustPeriod(db: Db | Trx, ctx: PayrollContext, id: string, lock = false): Promise<any> {
    const p = await this.periodRaw(db, ctx, id, lock);
    if (!p) throw new PayrollError('PAYROLL_PERIOD_NOT_FOUND', 'That pay period could not be found.');
    return p;
  }
  private async linesRaw(db: Db | Trx, ctx: PayrollContext, periodId: string): Promise<any[]> {
    return (db as Db).selectFrom('payroll_lines').select([...LINE_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).orderBy('payable_cents', 'desc').execute();
  }
  private async payoutsRaw(db: Db | Trx, ctx: PayrollContext, periodId: string): Promise<any[]> {
    return (db as Db).selectFrom('payroll_payouts').select([...PAYOUT_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).orderBy('created_at', 'asc').execute();
  }
  private hashOf(periodId: string, lines: any[]): string { return canonicalLineHash(periodId, lines.map(toLine) as any); }
  private checkVersion(row: any, expected?: number | null) {
    if (expected != null && Number(row.version) !== Number(expected)) {
      throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'Someone else changed this payroll period. Reload it and review the latest figures.', { expectedVersion: expected, currentVersion: Number(row.version) });
    }
  }
  /** The period's half-open window in the salon's zone (§126). */
  async windowOf(ctx: PayrollContext, p: { id: string; period_start: any; period_end: any; branch_id?: string | null }): Promise<{ fromIso: string; toIso: string; timezone: string }> {
    const tz = await this.snap.tenantTimezone(ctx.tenantId, p.branch_id ?? null);
    const d = (v: any) => ymdOf(v);
    const w = resolveEarningsWindow({ period: 'pay_period', timezone: tz, payPeriod: { id: p.id, periodStart: d(p.period_start), periodEnd: d(p.period_end) } });
    return { fromIso: w.fromIso, toIso: w.toIso, timezone: tz };
  }

  // ── read ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Period + lines with paid / outstanding per line (§78, §92–§93). */
  async detail(ctx: PayrollContext, id: string): Promise<{ period: PayrollPeriodRow; lines: PayrollLineRow[]; payouts: PayoutRow[]; totals: { payableCents: number; paidCents: number; outstandingCents: number; committedCents: number } }> {
    this.need(ctx, 'pos.payroll.view');
    const p = await this.mustPeriod(this.db, ctx, id);
    const [lines, payouts] = await Promise.all([this.linesRaw(this.db, ctx, id), this.payoutsRaw(this.db, ctx, id)]);
    const pos = payouts.map(toPayout);
    // canonical (built) lines carry no name — the roster name, tenant-scoped (the line keeps its own when it has one)
    const unnamed = [...new Set(lines.filter((l) => !l.technician_name).map((l) => String(l.technician_id)))];
    const names = new Map<string, string>(unnamed.length ? (await this.db.selectFrom('technicians').select(['id', 'full_name']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', unnamed).execute()).map((t: any) => [String(t.id), String(t.full_name)]) : []);
    let paid = 0, committed = 0, payable = 0;
    const out = lines.map((r) => {
      const l = { ...toLine(r), technicianName: r.technician_name ?? names.get(String(r.technician_id)) ?? null }; const mine = pos.filter((x) => x.technicianId === l.technicianId);
      const h = payoutHeadroom(l.payableCents, mine);
      paid += h.paidCents; committed += h.committedCents; payable += l.payableCents;
      return { ...l, paidCents: h.paidCents, outstandingCents: Math.max(0, l.payableCents - h.paidCents) };
    });
    return { period: toPeriod(p), lines: out, payouts: pos, totals: { payableCents: payable, paidCents: paid, outstandingCents: Math.max(0, payable - paid), committedCents: committed } };
  }

  // ── validation (§143–§145) ──────────────────────────────────────────────────────────────────────────────────────────
  async gatherFacts(ctx: PayrollContext, p: any): Promise<ValidationFacts> {
    const w = await this.windowOf(ctx, p);
    const t = ctx.tenantId; const b: string | null = p.branch_id ?? null;
    const lines = await this.linesRaw(this.db, ctx, p.id);
    const branchSnap = b ? sql`and s.branch_id = ${b}` : sql``;
    const branchTicket = b ? sql`and t.branch_id = ${b}` : sql``;
    const branchAny = (col: string) => (b ? sql`and (${sql.ref(col)} = ${b} or ${sql.ref(col)} is null)` : sql``);
    const q = async <T,>(x: any): Promise<T[]> => ((await x.execute(this.db)) as any).rows as T[];
    const [unassigned, noSnap, tips, dup, pending, open, exc, legacy, deductions] = await Promise.all([
      q<{ ticket_id: string }>(sql`select s.ticket_id from ticket_compensation_snapshots s where s.tenant_id = ${t} ${branchSnap} and s.snapshot_at >= ${w.fromIso} and s.snapshot_at < ${w.toIso}
        and s.technician_id is null and s.tech_service_earnings_cents <> 0 limit 200`),
      q<{ ticket_id: string }>(sql`select t.id as ticket_id from tickets t where t.tenant_id = ${t} ${branchTicket} and t.status = 'paid' and t.paid_at >= ${w.fromIso} and t.paid_at < ${w.toIso}
        and exists (select 1 from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null)
        and not exists (select 1 from ticket_compensation_snapshots s where s.tenant_id = t.tenant_id and s.ticket_id = t.id) limit 200`),
      q<{ ticket_id: string; tip_cents: number; allocated: number }>(sql`select t.id as ticket_id, t.tip_cents, coalesce(sum(a.tip_cents), 0)::bigint as allocated from tickets t
        left join ticket_tip_allocations a on a.tenant_id = t.tenant_id and a.ticket_id = t.id
        where t.tenant_id = ${t} ${branchTicket} and t.status = 'paid' and t.paid_at >= ${w.fromIso} and t.paid_at < ${w.toIso} and coalesce(t.tip_cents, 0) > 0
        group by t.id, t.tip_cents having coalesce(sum(a.tip_cents), 0) <> t.tip_cents limit 200`),
      q<{ n: number }>(sql`select count(*)::int as n from (select 1 from ticket_compensation_snapshots s where s.tenant_id = ${t} ${branchSnap} and s.snapshot_at >= ${w.fromIso} and s.snapshot_at < ${w.toIso}
        group by s.ticket_id, s.service_line_id, s.technician_id having count(*) > 1) d`),
      q<{ technician_id: string | null; category: string; status: string }>(sql`select technician_id, category, status from compensation_adjustments where tenant_id = ${t}
        and status in ('pending', 'pending_review') and (period_id = ${p.id} or (period_id is null and created_at >= ${w.fromIso} and created_at < ${w.toIso})) ${branchAny('branch_id')} limit 500`),
      q<{ technician_id: string; hourly: boolean }>(sql`select sh.technician_id, exists (select 1 from technician_pay_plans pp where pp.tenant_id = sh.tenant_id and pp.technician_id = sh.technician_id
          and pp.status = 'active' and pp.pay_type in ('hourly', 'hybrid') and pp.hourly_rate_cents is not null) as hourly
        from technician_shifts sh where sh.tenant_id = ${t} and sh.end_time is null and sh.start_time >= ${w.fromIso} and sh.start_time < ${w.toIso} ${branchAny('sh.branch_id')} limit 200`),
      q<{ kind: string; severity: 'blocking' | 'warning' }>(sql`select e.kind, e.severity from compensation_exceptions e where e.tenant_id = ${t} and e.status in ('open', 'retrying') ${branchAny('e.branch_id')}
        and (e.period_id = ${p.id} or exists (select 1 from tickets t where t.tenant_id = e.tenant_id and t.id = e.ticket_id and t.paid_at >= ${w.fromIso} and t.paid_at < ${w.toIso})) limit 500`),
      q<{ n: number }>(sql`select count(*)::int as n from ticket_compensation_snapshots s where s.tenant_id = ${t} ${branchSnap} and s.snapshot_at >= ${w.fromIso} and s.snapshot_at < ${w.toIso} and s.rule_source is null`),
      q<{ technician_id: string; deduction_type: string; total: number; cap: number | null }>(sql`select a.technician_id, a.deduction_type, (-sum(a.amount_cents))::bigint as total, d.max_cents_per_period as cap
        from compensation_adjustments a left join compensation_deduction_types d on d.tenant_id = a.tenant_id and d.key = a.deduction_type
        where a.tenant_id = ${t} and a.category = 'deduction' and a.status in ('posted', 'approved', 'applied') and a.period_id = ${p.id}
        group by a.technician_id, a.deduction_type, d.max_cents_per_period`),
    ]);
    // §145 reconciliation: recompute (dry) what the build would produce now and compare per technician — only before approval
    const drift: ValidationFacts['reconciliationDrift'] = [];
    if (this.opts.autoBuild && (p.status === 'draft' || p.status === 'review')) {
      const d = (v: any) => ymdOf(v);
      const rebuilt = await autoBuildPeriod(this.opts.autoBuild, { tenantId: t, fromIso: w.fromIso, toIso: w.toIso, branchId: b, periodId: p.id, periodStart: d(p.period_start), periodEnd: d(p.period_end), timezone: w.timezone }).catch(() => null);
      if (rebuilt) {
        const persisted = new Map(lines.filter((l) => l.commission_type === 'canonical').map((l) => [String(l.technician_id), Number(l.payable_cents)]));
        for (const r of rebuilt) {
          const have = persisted.get(r.technicianId);
          if (have == null || have !== r.payableCents) drift.push({ technicianId: r.technicianId, persistedPayableCents: have ?? 0, recomputedPayableCents: r.payableCents });
          persisted.delete(r.technicianId);
        }
        for (const [technicianId, v] of persisted) drift.push({ technicianId, persistedPayableCents: v, recomputedPayableCents: 0 });
      }
    }
    return {
      lines: lines.map((l) => ({ technicianId: String(l.technician_id), netCents: Number(l.net_cents ?? l.payable_cents), deductionCents: Number(l.deduction_cents || 0),
        nonTipCents: Number(l.commission_cents || 0) + Number(l.retail_commission_cents || 0) + Number(l.guarantee_topup_cents || 0) + Number(l.hourly_pay_cents || 0)
          + Number(l.salary_pay_cents || 0) + Number(l.bonus_cents || 0) + Number(l.adjustment_cents || 0) })),
      unassignedSnapshotRows: unassigned.map((r) => ({ ticketId: r.ticket_id })),
      paidTicketsWithoutSnapshot: noSnap.map((r) => ({ ticketId: r.ticket_id })),
      tipMismatches: tips.map((r) => ({ ticketId: r.ticket_id, tipCents: Number(r.tip_cents), allocatedCents: Number(r.allocated) })),
      duplicateSnapshotKeys: Number(dup[0]?.n || 0),
      pendingAdjustments: pending.map((r) => ({ technicianId: r.technician_id, category: r.category, status: r.status })),
      openTimeEntries: open.map((r) => ({ technicianId: r.technician_id, hourly: !!r.hourly })),
      openExceptions: exc,
      legacyRuleLines: Number(legacy[0]?.n || 0),
      reconciliationDrift: drift,
      deductionOverCap: deductions.filter((r) => r.cap != null && Number(r.total) > Number(r.cap)).map((r) => ({ technicianId: r.technician_id, type: r.deduction_type, capCents: Number(r.cap), totalCents: Number(r.total) })),
    };
  }

  /** Validate now and remember the result on the period (no version bump — it is derived). */
  async validate(ctx: PayrollContext, id: string): Promise<ValidationResult> {
    this.need(ctx, 'pos.payroll.view');
    const p = await this.mustPeriod(this.db, ctx, id);
    const v = evaluateValidation(await this.gatherFacts(ctx, p), this.nowIso());
    await this.db.updateTable('payroll_periods').set({ validation_json: JSON.stringify(v), blocking_count: v.blocking, warning_count: v.warnings } as any)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).execute();
    return v;
  }

  // ── workflow ────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** §68–§70: OPEN → READY_FOR_REVIEW. Rebuilds the lines from sales (the ONE build), validates, freezes the preview hash. */
  async prepare(ctx: PayrollContext, id: string, b: { expectedVersion?: number | null } = {}) {
    this.need(ctx, 'pos.payroll.manage');
    const before = await this.mustPeriod(this.db, ctx, id);
    if (before.status === 'review') return { ...(await this.detail(ctx, id)), validation: before.validation_json ?? null, alreadyPrepared: true };
    if (before.status !== 'draft') throw new PayrollError(before.status === 'paid' ? 'PAYROLL_PERIOD_LOCKED' : 'PAYROLL_PERIOD_NOT_READY', before.status === 'paid' ? 'This payroll period has already been locked. Create an adjustment instead of editing historical payroll.' : 'This period is already approved — reopen it to prepare it again.');
    this.checkVersion(before, b.expectedVersion);
    if (this.opts.builder) await this.opts.builder.buildFromSales(ctx, id);
    const built = await this.mustPeriod(this.db, ctx, id);
    const v = evaluateValidation(await this.gatherFacts(ctx, built), this.nowIso());
    const out = await this.db.transaction().execute(async (trx) => {
      const p = await this.mustPeriod(trx, ctx, id, true);
      if (p.status !== 'draft' || Number(p.version) !== Number(built.version)) throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'The period changed while it was being prepared. Reload and prepare it again.');
      assertTransition(PAYROLL_PERIOD, 'draft', 'review');
      const lines = await this.linesRaw(trx, ctx, id);
      const hash = this.hashOf(id, lines);
      const r = await trx.updateTable('payroll_periods').set({ status: 'review', version: sql`version + 1`, preview_hash: hash, calculation_version: PAYROLL_CALCULATION_VERSION,
        prepared_at: sql`now()`, prepared_by: ctx.userId ?? null, validation_json: JSON.stringify(v), blocking_count: v.blocking, warning_count: v.warnings, updated_at: sql`now()` } as any)
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('version', '=', p.version).returning([...PERIOD_COLS]).executeTakeFirstOrThrow();
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PERIOD_PREPARED, p, { status: 'review', previousStatus: 'draft', technicianIds: lines.map((l) => String(l.technician_id)), blocking: v.blocking, warnings: v.warnings });
      return { row: r, hash };
    });
    await this.audit(ctx, 'period.prepared', id, 'medium', { previewHash: out.hash, blocking: v.blocking, warnings: v.warnings, version: Number(out.row.version) });
    return { ...(await this.detail(ctx, id)), validation: v };
  }

  /** READY_FOR_REVIEW → OPEN (the reviewer wants changes). */
  async sendBack(ctx: PayrollContext, id: string, b: { reason?: string | null; expectedVersion?: number | null } = {}) {
    this.need(ctx, 'pos.payroll.manage');
    await this.db.transaction().execute(async (trx) => {
      const p = await this.mustPeriod(trx, ctx, id, true);
      if (p.status !== 'review') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'Only a period in review can be sent back.');
      this.checkVersion(p, b.expectedVersion);
      assertTransition(PAYROLL_PERIOD, 'review', 'draft');
      await trx.updateTable('payroll_periods').set({ status: 'draft', version: sql`version + 1`, preview_hash: null, updated_at: sql`now()` } as any)
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('version', '=', p.version).execute();
    });
    await this.audit(ctx, 'period.sent_back', id, 'low', {}, b.reason ?? null);
    return this.detail(ctx, id);
  }

  /** §71–§77, §119–§121: approve (READY_FOR_REVIEW or OPEN → APPROVED + LOCKED). Step-up is enforced by the route. */
  async approve(ctx: PayrollContext, id: string, b: { expectedVersion?: number | null; calculationHash?: string | null } = {}) {
    this.need(ctx, 'payroll.approve');
    const before = await this.mustPeriod(this.db, ctx, id);
    if (before.status === 'finalized') throw new PayrollError('PAYROLL_PERIOD_ALREADY_APPROVED', 'This payroll period was already approved.');
    if (before.status === 'paid') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'This payroll period has already been locked. Create an adjustment instead of editing historical payroll.');
    this.checkVersion(before, b.expectedVersion);
    const v = evaluateValidation(await this.gatherFacts(ctx, before), this.nowIso());
    await this.db.updateTable('payroll_periods').set({ validation_json: JSON.stringify(v), blocking_count: v.blocking, warning_count: v.warnings } as any)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).execute();
    if (v.blocking > 0) throw new PayrollError('PAYROLL_VALIDATION_FAILED', 'Payroll has problems that must be fixed before it can be approved.', { issues: v.issues.filter((i) => i.severity === 'blocking') });
    const out = await this.db.transaction().execute(async (trx) => {
      const p = await this.mustPeriod(trx, ctx, id, true);
      if (p.status === 'finalized') throw new PayrollError('PAYROLL_PERIOD_ALREADY_APPROVED', 'This payroll period was already approved.');
      if (p.status === 'paid') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'This payroll period has already been locked.');
      // the figures validated above are the figures approved: any write in between is a conflict, never a silent approval
      if (Number(p.version) !== Number(before.version)) throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'Someone else changed this payroll period. Reload it and review the latest figures.', { currentVersion: Number(p.version) });
      assertTransition(PAYROLL_PERIOD, String(p.status), 'finalized');
      const lines = await this.linesRaw(trx, ctx, id);
      const hash = this.hashOf(id, lines);
      if (b.calculationHash && b.calculationHash !== hash) throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'The figures changed since you reviewed them. Reload and review again.', { calculationHash: hash });
      const r = await trx.updateTable('payroll_periods').set({ status: 'finalized', finalized_at: sql`now()`, approved_by: ctx.userId ?? null, approval_hash: hash,
        calculation_version: PAYROLL_CALCULATION_VERSION, version: sql`version + 1`, updated_at: sql`now()` } as any)
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('version', '=', p.version).returning([...PERIOD_COLS]).executeTakeFirst();
      if (!r) throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'Someone else changed this payroll period.');
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PERIOD_FINALIZED, p, { status: 'finalized', previousStatus: String(p.status), totalPayableCents: Number(p.total_payable_cents ?? 0), technicianIds: lines.map((l) => String(l.technician_id)), approvalHash: hash });
      return { row: r, hash, from: String(p.status) };
    });
    await this.audit(ctx, 'period.approved', id, 'high', { approvalHash: out.hash, fromStatus: out.from, totalPayableCents: Number(out.row.total_payable_cents), version: Number(out.row.version), warnings: v.warnings });
    return { ...(await this.detail(ctx, id)), validation: v };
  }

  /** §124: APPROVED → OPEN with a written reason (step-up at the route). Refused once a payout is recorded — correct with an adjustment. */
  async reopen(ctx: PayrollContext, id: string, b: { reason?: string | null; expectedVersion?: number | null } = {}) {
    this.need(ctx, 'payroll.approve');
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw new PayrollError('VALIDATION_FAILED', 'Reopening an approved period requires a reason.');
    const out = await this.db.transaction().execute(async (trx) => {
      const p = await this.mustPeriod(trx, ctx, id, true);
      if (p.status === 'paid') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'This payroll period is paid and locked. Create an adjustment in the next open period instead.');
      if (p.status !== 'finalized') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'Only an approved period can be reopened.');
      this.checkVersion(p, b.expectedVersion);
      const live = (await this.payoutsRaw(trx, ctx, id)).filter((x) => x.status !== 'failed' && x.status !== 'canceled');
      if (live.length) throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'Payouts are already recorded for this period. Correct it with an adjustment in the next open period.', { payouts: live.length });
      assertTransition(PAYROLL_PERIOD, 'finalized', 'draft');
      await trx.updateTable('payroll_periods').set({ status: 'draft', reopen_reason: reason, reopened_by: ctx.userId ?? null, reopened_at: sql`now()`, approval_hash: null, approved_by: null,
        preview_hash: null, version: sql`version + 1`, updated_at: sql`now()` } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('version', '=', p.version).execute();
      const techs = (await this.linesRaw(trx, ctx, id)).map((l) => String(l.technician_id));
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PERIOD_REOPENED, p, { status: 'draft', previousStatus: 'finalized', totalPayableCents: Number(p.total_payable_cents ?? 0), technicianIds: techs });
      return { previousHash: p.approval_hash as string | null, total: Number(p.total_payable_cents ?? 0) };
    });
    await this.audit(ctx, 'period.reopened', id, 'high', { previousStatus: 'finalized', previousApprovalHash: out.previousHash, totalPayableCents: out.total }, reason);
    return this.detail(ctx, id);
  }

  /** §73–§80: APPROVED → PAID. Settles every line's outstanding amount as a PAID payout (method + reference) in the same
   *  transaction; the approval hash must still match the lines (tamper check); idempotent — a second call is a no-op. */
  async markPaid(ctx: PayrollContext, id: string, b: { expectedVersion?: number | null; method?: string | null; reference?: string | null } = {}) {
    this.need(ctx, 'payouts.manage');
    const method = (b.method || 'other') as PayoutMethod;
    if (!PAYOUT_METHODS.includes(method)) throw new PayrollError('VALIDATION_FAILED', 'Choose how the technicians were paid.');
    const out = await this.db.transaction().execute(async (trx) => {
      const p = await this.mustPeriod(trx, ctx, id, true);
      if (p.status === 'paid') return { already: true, created: 0, lines: [] as any[], p };
      if (p.status !== 'finalized') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'Approve this payroll period before paying it.');
      this.checkVersion(p, b.expectedVersion);
      const lines = await this.linesRaw(trx, ctx, id);
      if (p.approval_hash && this.hashOf(id, lines) !== p.approval_hash) {
        throw new PayrollError('PAYROLL_VALIDATION_FAILED', 'The approved figures no longer match this period. Reopen and approve it again.', { reason: 'approved_figures_changed' });
      }
      const payouts = await this.payoutsRaw(trx, ctx, id);
      if (payouts.some((x) => x.status === 'pending' || x.status === 'processing')) throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'Some payouts are still in progress. Mark them paid, failed or canceled first.');
      let created = 0;
      for (const l of lines) {
        const h = payoutHeadroom(Number(l.payable_cents), payouts.filter((x) => x.technician_id === l.technician_id).map((x) => ({ amountCents: Number(x.amount_cents), status: x.status })));
        if (h.headroomCents <= 0) continue;
        await trx.insertInto('payroll_payouts').values({ tenant_id: ctx.tenantId, branch_id: p.branch_id ?? null, period_id: id, technician_id: l.technician_id, amount_cents: h.headroomCents,
          method, status: 'paid', reference: b.reference ? String(b.reference).slice(0, 120) : null, paid_at: sql`now()`, idempotency_key: `period:${id}:settle:${l.technician_id}`,
          created_by: ctx.userId ?? null, updated_by: ctx.userId ?? null } as any).onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing()).execute();
        created++;
      }
      assertTransition(PAYROLL_PERIOD, 'finalized', 'paid');
      await trx.updateTable('payroll_periods').set({ status: 'paid', paid_at: sql`now()`, paid_by: ctx.userId ?? null, version: sql`version + 1`, updated_at: sql`now()` } as any)
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('version', '=', p.version).execute();
      const techs = lines.map((l) => String(l.technician_id));
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PERIOD_PAID, p, { status: 'paid', previousStatus: 'finalized', totalPayableCents: Number(p.total_payable_cents ?? 0), technicianIds: techs });
      if (created) await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PAYOUT_RECORDED, p, { payouts: created, technicianIds: techs });
      return { already: false, created, lines, p };
    });
    if (!out.already) {
      await this.audit(ctx, 'period.paid', id, 'high', { payoutsCreated: out.created, method, totalPayableCents: Number(out.p.total_payable_cents ?? 0) });
      await this.pushPaid(ctx, id, out.lines.map((l: any) => String(l.technician_id)));
    }
    return { ...(await this.detail(ctx, id)), alreadyPaid: out.already, payoutsCreated: out.created };
  }

  private async pushPaid(ctx: PayrollContext, periodId: string, techIds: string[]) {
    if (!this.opts.push || !techIds.length) return;
    try {
      const rows = await this.db.selectFrom('technicians').select(['id', 'user_id']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', [...new Set(techIds)]).execute();
      for (const r of rows as any[]) if (r.user_id) await this.opts.push.dispatchToUser(ctx.tenantId, r.user_id, { title: 'Payroll paid', body: 'Your earnings for this pay period have been paid — open Payroll to view.', data: { kind: 'payroll_paid', periodId }, reference: 'payroll_paid', category: 'PAYROLL' });
    } catch { /* best-effort: a push never fails a payout */ }
  }

  /** §79–§80, §149: record ONE payout on an approved period (partial payments, a check, a direct deposit run). */
  async recordPayout(ctx: PayrollContext, periodId: string, b: { technicianId: string; amountCents: number; method: string; status?: 'pending' | 'paid' | null; reference?: string | null; note?: string | null; idempotencyKey?: string | null }) {
    this.need(ctx, 'payouts.manage');
    if (!Number.isInteger(b.amountCents) || b.amountCents <= 0) throw new PayrollError('VALIDATION_FAILED', 'A payout must be a positive whole-cents amount.');
    if (!PAYOUT_METHODS.includes(b.method as PayoutMethod)) throw new PayrollError('VALIDATION_FAILED', 'Choose how the technician was paid.');
    const status = b.status === 'pending' ? 'pending' : 'paid';
    const res = await this.db.transaction().execute(async (trx) => {
      const p = await this.mustPeriod(trx, ctx, periodId, true);
      if (b.idempotencyKey) {
        const prior = await trx.selectFrom('payroll_payouts').select([...PAYOUT_COLS]).where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', b.idempotencyKey).executeTakeFirst();
        if (prior) return { payout: toPayout(prior), replay: true, p };
      }
      if (p.status !== 'finalized') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', p.status === 'paid' ? 'This period is already paid.' : 'Approve this payroll period before recording payouts.');
      const line = await trx.selectFrom('payroll_lines').select(['payable_cents']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('technician_id', '=', b.technicianId).executeTakeFirst();
      if (!line) throw new PayrollError('RESOURCE_NOT_FOUND', 'That technician has no line in this period.');
      const mine = (await this.payoutsRaw(trx, ctx, periodId)).filter((x) => x.technician_id === b.technicianId).map((x) => ({ amountCents: Number(x.amount_cents), status: x.status }));
      const h = payoutHeadroom(Number(line.payable_cents), mine);
      if (b.amountCents > h.headroomCents) throw new PayrollError('PAYOUT_EXCEEDS_PAYABLE', 'That payout is more than this technician is still owed for the period.', { headroomCents: h.headroomCents });
      if (!PAYROLL_PAYOUT.initial?.includes(status)) throw new PayrollError('VALIDATION_FAILED', 'A payout starts pending or paid.');   // inserts: the machine's initial states
      const r = await trx.insertInto('payroll_payouts').values({ tenant_id: ctx.tenantId, branch_id: p.branch_id ?? null, period_id: periodId, technician_id: b.technicianId, amount_cents: b.amountCents,
        method: b.method, status, reference: b.reference ? String(b.reference).slice(0, 120) : null, note: b.note ? String(b.note).slice(0, 500) : null,
        paid_at: status === 'paid' ? sql`now()` : null, idempotency_key: b.idempotencyKey ?? null, created_by: ctx.userId ?? null, updated_by: ctx.userId ?? null } as any)
        .returning([...PAYOUT_COLS]).executeTakeFirstOrThrow();
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PAYOUT_RECORDED, p, { payouts: 1, technicianIds: [b.technicianId] });
      return { payout: toPayout(r), replay: false, p };
    });
    if (!res.replay) await this.audit(ctx, 'payout.recorded', res.payout.id, 'high', { periodId, technicianId: b.technicianId, amountCents: b.amountCents, method: b.method, status }, null, 'payroll_payout');
    return res.payout;
  }

  /** §80: move a payout (processing / paid / failed / canceled). */
  async setPayoutStatus(ctx: PayrollContext, payoutId: string, b: { status: string; failureReason?: string | null; reference?: string | null }) {
    this.need(ctx, 'payouts.manage');
    const to = b.status as PayoutStatus;
    if (to === 'failed' && !String(b.failureReason ?? '').trim()) throw new PayrollError('VALIDATION_FAILED', 'Say why the payout failed.');
    const r = await this.db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('payroll_payouts').select([...PAYOUT_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', payoutId).forUpdate().executeTakeFirst();
      if (!cur) throw new PayrollError('RESOURCE_NOT_FOUND', 'That payout could not be found.');
      await this.mustPeriod(trx, ctx, cur.period_id, true);
      assertTransition(PAYROLL_PAYOUT, String(cur.status), to);
      return trx.updateTable('payroll_payouts').set({ status: to, failure_reason: to === 'failed' ? String(b.failureReason).slice(0, 300) : cur.failure_reason, reference: b.reference ? String(b.reference).slice(0, 120) : cur.reference,
        paid_at: to === 'paid' ? sql`now()` : cur.paid_at, updated_by: ctx.userId ?? null, updated_at: sql`now()` } as any)
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', payoutId).where(canMoveToSql(PAYROLL_PAYOUT, to) as any).returning([...PAYOUT_COLS]).executeTakeFirstOrThrow();
    });
    await this.audit(ctx, 'payout.status_changed', payoutId, 'high', { to, periodId: r.period_id }, b.failureReason ?? null, 'payroll_payout');
    return toPayout(r);
  }

  async payouts(ctx: PayrollContext, periodId: string): Promise<PayoutRow[]> {
    this.need(ctx, 'pos.payroll.view');
    await this.mustPeriod(this.db, ctx, periodId);
    return (await this.payoutsRaw(this.db, ctx, periodId)).map(toPayout);
  }

  // ── export (§82–§84) ────────────────────────────────────────────────────────────────────────────────────────────────
  async exportPeriod(ctx: PayrollContext, periodId: string, format: PayrollExportFormat) {
    this.need(ctx, 'payroll.export');
    if (format !== 'csv' && format !== 'xlsx') throw new PayrollError('VALIDATION_FAILED', 'Export as csv or xlsx.');
    const d = await this.detail(ctx, periodId);
    if (d.period.status === 'draft') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'Prepare the period for review before exporting it — exports are a stable snapshot.');
    const exp = buildPayrollExport(format, { id: d.period.id, label: d.period.label, periodStart: d.period.periodStart, periodEnd: d.period.periodEnd, status: d.period.status, version: d.period.version ?? 1, approvalHash: d.period.approvalHash ?? null },
      d.lines.map((l) => ({ technicianId: l.technicianId, technicianName: l.technicianName, servicesCount: l.servicesCount, grossSalesCents: l.grossSalesCents, commissionCents: l.commissionCents,
        retailCommissionCents: l.retailCommissionCents ?? 0, cardTipCents: l.cardTipCents ?? 0, cashTipCents: l.cashTipCents ?? 0, tipsCents: l.tipsCents, guaranteeTopUpCents: l.guaranteeTopUpCents ?? 0,
        hourlyPayCents: l.hourlyPayCents ?? 0, workedMinutes: l.workedMinutes ?? 0, potentialOvertimeMinutes: l.potentialOvertimeMinutes ?? 0, salaryPayCents: l.salaryPayCents ?? 0,
        bonusCents: l.bonusCents ?? 0, deductionCents: l.deductionCents ?? 0, adjustmentCents: l.adjustmentCents, netCents: l.netCents ?? l.payableCents, payableCents: l.payableCents, paidCents: l.paidCents ?? 0 })));
    await this.db.insertInto('payroll_exports').values({ tenant_id: ctx.tenantId, branch_id: d.period.branchId ?? null, period_id: periodId, format, row_count: exp.rowCount, content_sha256: exp.sha256,
      period_status: d.period.status, period_version: d.period.version ?? 1, exported_by: ctx.userId ?? null } as any).execute();
    await this.audit(ctx, 'period.exported', periodId, 'high', { format, rows: exp.rowCount, sha256: exp.sha256, periodVersion: d.period.version ?? 1 });
    return { filename: exp.filename, mimeType: exp.mimeType, base64: exp.bytes.toString('base64'), sha256: exp.sha256, rowCount: exp.rowCount };
  }

  async exportHistory(ctx: PayrollContext, periodId: string) {
    this.need(ctx, 'pos.payroll.view');
    const rows = await this.db.selectFrom('payroll_exports').select(['id', 'format', 'row_count', 'content_sha256', 'period_status', 'period_version', 'exported_by', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).orderBy('created_at', 'desc').limit(50).execute();
    return rows.map((r: any) => ({ id: r.id, format: r.format, rowCount: Number(r.row_count), sha256: r.content_sha256, periodStatus: r.period_status, periodVersion: Number(r.period_version), exportedBy: r.exported_by ?? null, createdAt: new Date(r.created_at).toISOString() }));
  }

  // ── technician drill-down (§86–§88, §93, §107) ─────────────────────────────────────────────────────────────────────
  async technicianDetail(ctx: PayrollContext, periodId: string, technicianId: string) {
    this.need(ctx, 'pos.payroll.view');
    const p = await this.mustPeriod(this.db, ctx, periodId);
    const w = await this.windowOf(ctx, p);
    const line = await this.db.selectFrom('payroll_lines').select([...LINE_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('technician_id', '=', technicianId).executeTakeFirst();
    const [services, adjustments, payouts, tips] = await Promise.all([
      this.snap.linesByTechnicianPeriod(ctx.tenantId, technicianId, w.fromIso, w.toIso),
      this.db.selectFrom('compensation_adjustments').select([...ADJ_COLS]).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
        .where((eb) => eb.or([eb('period_id', '=', periodId), eb.and([eb('period_id', 'is', null), eb('created_at', '>=', w.fromIso as any), eb('created_at', '<', w.toIso as any)])]))
        .orderBy('created_at', 'asc').limit(500).execute(),
      this.db.selectFrom('payroll_payouts').select([...PAYOUT_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('technician_id', '=', technicianId).orderBy('created_at', 'asc').execute(),
      this.snap.tipReport(ctx.tenantId, w.fromIso, w.toIso, p.branch_id ?? null).then((rows) => rows.filter((r: any) => r.technicianId === technicianId)),
    ]);
    return { period: toPeriod(p), window: w, line: line ? toLine(line) : null, services, tips, adjustments: adjustments.map(toAdj), payouts: payouts.map(toPayout) };
  }

  // ── adjustments (§59–§64, §150) ─────────────────────────────────────────────────────────────────────────────────────
  async createAdjustment(ctx: PayrollContext, periodId: string, b: { technicianId: string; category: string; amountCents: number; reasonCode: string; reason: string; deductionType?: string | null; idempotencyKey?: string | null }) {
    this.need(ctx, 'payroll.adjust');
    const category = b.category as ManualCategory;
    if (!MANUAL_CATEGORIES.includes(category)) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'That adjustment type is not allowed here.');
    if (!(REASON_CODES as readonly string[]).includes(b.reasonCode)) throw new PayrollError('VALIDATION_FAILED', 'Choose a reason code.');
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw new PayrollError('VALIDATION_FAILED', 'Explain the adjustment.');
    if (!Number.isInteger(b.amountCents) || b.amountCents === 0) throw new PayrollError('VALIDATION_FAILED', 'Enter a non-zero amount.');
    // a bonus is always positive; a deduction is entered positive and stored NEGATIVE; corrections may be either sign
    if (category === 'bonus' && b.amountCents < 0) throw new PayrollError('VALIDATION_FAILED', 'A bonus must be positive.');
    let amount = b.amountCents;
    let deductionType: string | null = null;
    if (category === 'deduction') {
      const t = (await this.plans.deductionTypes(ctx.tenantId)).find((d) => d.key === b.deductionType && d.enabled);
      if (!t) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'Deductions need a deduction type this salon has turned on.');
      deductionType = t.key; amount = -Math.abs(b.amountCents);
    }
    const tech = await this.db.selectFrom('technicians').select(['id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', b.technicianId).executeTakeFirst();
    if (!tech) throw new PayrollError('RESOURCE_NOT_FOUND', 'That technician is not in this salon.');
    const large = Math.abs(amount) >= LARGE_ADJUSTMENT_CENTS;
    const status = large ? 'pending' : 'approved';
    const res = await this.db.transaction().execute(async (trx) => {
      const p = await this.mustPeriod(trx, ctx, periodId, true);
      if (b.idempotencyKey) {
        const prior = await trx.selectFrom('compensation_adjustments').select([...ADJ_COLS]).where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', b.idempotencyKey).executeTakeFirst();
        if (prior) return { row: prior, replay: true };
      }
      if (p.status !== 'draft') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'This payroll period is no longer open. Add the adjustment to the next open period instead.');
      if (!COMPENSATION_ADJUSTMENT.initial?.includes(status)) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'Unsupported adjustment status.');   // inserts: the machine's initial states
      const row = await trx.insertInto('compensation_adjustments').values({ tenant_id: ctx.tenantId, branch_id: p.branch_id ?? null, technician_id: b.technicianId, ticket_id: null, service_line_id: null,
        period_id: periodId, category, amount_cents: amount, reason: reason.slice(0, 500), reason_code: b.reasonCode, deduction_type: deductionType, status, source: 'manual',
        targets_future_period: false, requested_by: ctx.userId ?? null, approved_by: large ? null : ctx.userId ?? null, idempotency_key: b.idempotencyKey ?? null } as any)
        .onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing())
        .returning([...ADJ_COLS]).executeTakeFirst();
      if (!row) {   // a concurrent request with the same key won the insert — return its row (§186: one adjustment)
        const won = await trx.selectFrom('compensation_adjustments').select([...ADJ_COLS]).where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', b.idempotencyKey!).executeTakeFirstOrThrow();
        return { row: won, replay: true };
      }
      return { row, replay: false };
    });
    if (!res.replay) {
      await this.audit(ctx, category === 'deduction' ? 'adjustment.deduction_created' : 'adjustment.created', res.row.id, Math.abs(amount) >= LARGE_ADJUSTMENT_CENTS ? 'high' : 'medium',
        { periodId, technicianId: b.technicianId, category, amountCents: amount, reasonCode: b.reasonCode, deductionType, status }, reason, 'compensation_adjustment');
      if (this.opts.builder) await this.opts.builder.buildFromSales(ctx, periodId).catch(() => undefined);   // lines follow the ledger
    }
    return { adjustment: toAdj(res.row), replay: res.replay, requiresApproval: res.row.status === 'pending' };
  }

  async listAdjustments(ctx: PayrollContext, f: { status?: string; periodId?: string } = {}) {
    this.need(ctx, 'pos.payroll.view');
    let q = this.db.selectFrom('compensation_adjustments').select([...ADJ_COLS]).where('tenant_id', '=', ctx.tenantId);
    if (f.status === 'pending') q = q.where('status', 'in', ['pending', 'pending_review']);
    else if (f.status) q = q.where('status', '=', f.status);
    if (f.periodId) q = q.where('period_id', '=', f.periodId);
    return (await q.orderBy('created_at', 'desc').limit(200).execute()).map(toAdj);
  }

  /** Owner decision on a pending / pending-review entry (§63–§64; chargebacks §55; refunds against a locked period §54). */
  async decideAdjustment(ctx: PayrollContext, id: string, b: { decision: 'approve' | 'reject'; reason?: string | null }) {
    this.need(ctx, 'payroll.approve');
    const to = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : null;
    if (!to) throw new PayrollError('VALIDATION_FAILED', 'Approve or reject.');
    const reason = String(b.reason ?? '').trim();
    if (to === 'rejected' && reason.length < 3) throw new PayrollError('VALIDATION_FAILED', 'Say why the adjustment is rejected.');
    const row = await this.db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('compensation_adjustments').select([...ADJ_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!cur) throw new PayrollError('RESOURCE_NOT_FOUND', 'That adjustment could not be found.');
      if (!COMPENSATION_ADJUSTMENT.can(String(cur.status) as any, to as any)) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'This adjustment was already decided.');
      if (cur.period_id) {
        const p = await this.mustPeriod(trx, ctx, cur.period_id, true);
        if (p.status !== 'draft' && to === 'approved') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'Its pay period is no longer open — approve it into the next open period instead.');
      }
      return trx.updateTable('compensation_adjustments').set({ status: to, decided_by: ctx.userId ?? null, decided_at: sql`now()`, decision_reason: reason || null, approved_by: to === 'approved' ? ctx.userId ?? null : cur.approved_by } as any)
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where(canMoveToSql(COMPENSATION_ADJUSTMENT, to) as any).returning([...ADJ_COLS]).executeTakeFirstOrThrow();
    });
    await this.audit(ctx, `adjustment.${to}`, id, 'high', { technicianId: row.technician_id, category: row.category, amountCents: Number(row.amount_cents), periodId: row.period_id }, reason || null, 'compensation_adjustment');
    if (row.period_id && this.opts.builder) await this.opts.builder.buildFromSales(ctx, row.period_id).catch(() => undefined);
    if (row.chargeback_id && to) await this.exceptions.resolveByKey(ctx.tenantId, 'chargeback_review', String(row.chargeback_id), `adjustment ${to}`).catch(() => undefined);
    return toAdj(row);
  }

  /** §150: a technician nets below zero → carry the balance into the next OPEN period (never a negative payment). Two linked
   *  entries: +X here (the line nets 0) and −X in the next period, both with reason code negative_carry_forward. */
  async carryForward(ctx: PayrollContext, periodId: string, technicianId: string) {
    this.need(ctx, 'payroll.adjust');
    const created = await this.db.transaction().execute(async (trx) => {
      const p = await this.mustPeriod(trx, ctx, periodId, true);
      if (p.status !== 'draft') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'Carry a negative balance forward while the period is open.');
      const line = await trx.selectFrom('payroll_lines').select(['net_cents']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('technician_id', '=', technicianId).executeTakeFirst();
      const net = Number(line?.net_cents ?? 0);
      if (net >= 0) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'This technician does not net below zero for the period.');
      const next = await trx.selectFrom('payroll_periods').select(['id']).where('tenant_id', '=', ctx.tenantId).where('status', '=', 'draft').where('period_start', '>', p.period_end)
        .where((eb) => (p.branch_id ? eb.or([eb('branch_id', '=', p.branch_id), eb('branch_id', 'is', null)]) : eb('branch_id', 'is', null))).orderBy('period_start', 'asc').executeTakeFirst();
      if (!next) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'Create the next pay period first — the balance is carried into it.');
      const key = `carry:${periodId}:${technicianId}`;
      const base = { tenant_id: ctx.tenantId, branch_id: p.branch_id ?? null, technician_id: technicianId, ticket_id: null, service_line_id: null, category: 'payroll_correction', reason_code: 'negative_carry_forward',
        status: 'approved', source: 'manual', targets_future_period: false, requested_by: ctx.userId ?? null, approved_by: ctx.userId ?? null };
      const ins = await trx.insertInto('compensation_adjustments').values([
        { ...base, period_id: periodId, amount_cents: -net, reason: 'Negative balance carried to the next pay period', idempotency_key: key + ':out' },
        { ...base, period_id: next.id, original_period_id: periodId, amount_cents: net, reason: 'Negative balance carried from the previous pay period', idempotency_key: key + ':in' },
      ] as any).onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing()).returning(['id']).execute();
      return { n: ins.length, nextPeriodId: next.id, amountCents: -net };
    });
    await this.audit(ctx, 'adjustment.negative_carried_forward', periodId, 'high', { technicianId, ...created });
    if (this.opts.builder) await this.opts.builder.buildFromSales(ctx, periodId).catch(() => undefined);
    return created;
  }

  // ── financial exceptions (§196–§198) ────────────────────────────────────────────────────────────────────────────────
  async listExceptions(ctx: PayrollContext, f: { status?: string; kind?: string } = {}) {
    this.need(ctx, 'pos.payroll.view');
    if (f.kind && !(EXCEPTION_KINDS as readonly string[]).includes(f.kind)) throw new PayrollError('VALIDATION_FAILED', 'Unknown exception kind.');
    return this.exceptions.list(ctx.tenantId, { status: f.status || 'open', kind: f.kind });
  }

  async actOnException(ctx: PayrollContext, id: string, b: { action: 'resolve' | 'dismiss' | 'retry'; note?: string | null }) {
    this.need(ctx, 'pos.payroll.manage');
    const e = await this.exceptions.get(ctx.tenantId, id);
    if (!e) throw new PayrollError('RESOURCE_NOT_FOUND', 'That exception could not be found.');
    if (b.action === 'retry') {
      if (e.kind !== 'missing_snapshot' || !e.ticketId) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'Only a missing commission record can be retried.');
      if (!this.opts.snapshots) throw new PayrollError('SERVICE_UNAVAILABLE', 'The commission engine is not connected.');
      const t = await this.db.selectFrom('tickets').select(['branch_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', e.ticketId).executeTakeFirst();
      const r = await this.opts.snapshots.snapshotPaidTicket({ tenantId: ctx.tenantId, branchId: (t as any)?.branch_id ?? null }, e.ticketId);
      if (r.ok) await this.exceptions.setStatus(ctx.tenantId, id, 'resolved', { userId: ctx.userId, note: 'Commission record written on manual retry.' });
      else await this.exceptions.setStatus(ctx.tenantId, id, 'retrying', { userId: ctx.userId, lastError: r.error ?? 'retry failed', bumpAttempt: true });
      await this.audit(ctx, 'exception.retried', id, 'medium', { kind: e.kind, ok: r.ok }, null, 'compensation_exception');
      return { ok: r.ok, exception: await this.exceptions.get(ctx.tenantId, id) };
    }
    const note = String(b.note ?? '').trim();
    if (note.length < 3) throw new PayrollError('VALIDATION_FAILED', 'Add a note explaining the decision.');
    const to = b.action === 'dismiss' ? 'dismissed' : 'resolved';
    if (!COMPENSATION_EXCEPTION.can(e.status as any, to as any)) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'This exception is already closed.');
    await this.exceptions.setStatus(ctx.tenantId, id, to, { userId: ctx.userId, note });
    await this.audit(ctx, `exception.${to}`, id, 'medium', { kind: e.kind }, note, 'compensation_exception');
    return { ok: true, exception: await this.exceptions.get(ctx.tenantId, id) };
  }

  // ── technician inquiries (§152–§153) ────────────────────────────────────────────────────────────────────────────────
  async listInquiries(ctx: PayrollContext, f: { status?: string } = {}) {
    this.need(ctx, 'pos.payroll.view');
    let q = this.db.selectFrom('payroll_inquiries as i').leftJoin('technicians as t', (j) => j.onRef('t.id', '=', 'i.technician_id').onRef('t.tenant_id', '=', 'i.tenant_id'))
      .select(['i.id', 'i.technician_id', 'i.period_id', 'i.subject_type', 'i.subject_id', 'i.message', 'i.status', 'i.response', 'i.private_note', 'i.responded_at', 'i.created_at', 't.full_name as technician_name'] as any)
      .where('i.tenant_id', '=', ctx.tenantId);
    if (f.status) q = q.where('i.status', '=', f.status);
    const rows = await q.orderBy('i.created_at', 'desc').limit(200).execute();
    return (rows as any[]).map((r) => ({ id: r.id, technicianId: r.technician_id, technicianName: r.technician_name ?? null, periodId: r.period_id ?? null, subjectType: r.subject_type, subjectId: r.subject_id ?? null,
      message: r.message, status: r.status, response: r.response ?? null, privateNote: r.private_note ?? null, respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() }));
  }

  async respondInquiry(ctx: PayrollContext, id: string, b: { response: string; privateNote?: string | null; close?: boolean | null }) {
    this.need(ctx, 'pos.payroll.manage');
    const response = String(b.response ?? '').trim();
    if (response.length < 2) throw new PayrollError('VALIDATION_FAILED', 'Write a response for the technician.');
    const to = b.close ? 'closed' : 'answered';
    const r = await this.db.updateTable('payroll_inquiries').set({ status: to, response: response.slice(0, 1000), private_note: b.privateNote ? String(b.privateNote).slice(0, 1000) : null,
      responded_by: ctx.userId ?? null, responded_at: sql`now()`, updated_by: ctx.userId ?? null, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where(canMoveToSql(PAYROLL_INQUIRY, to) as any).returning(['id', 'status']).executeTakeFirst();
    if (!r) throw new PayrollError('ADJUSTMENT_NOT_ALLOWED', 'That inquiry could not be answered (closed or not found).');
    await this.audit(ctx, 'inquiry.answered', id, 'low', { status: to }, null, 'payroll_inquiry');
    return { id, status: to };
  }

  // ── pay plans + deduction types (§38–§45, §59–§61, §139–§142) ───────────────────────────────────────────────────────
  async listPayPlans(ctx: PayrollContext, technicianId?: string) { this.need(ctx, 'compensation.view_all'); return this.plans.list(ctx.tenantId, technicianId); }

  async createPayPlan(ctx: PayrollContext, b: { technicianId: string; branchId?: string | null; payType: string; hourlyRateCents?: number | null; salaryCentsPerPeriod?: number | null; breaksPaid?: boolean | null; overtimeWeeklyMinutes?: number | null; effectiveStart: string; effectiveEnd?: string | null; note?: string | null }): Promise<PayPlan> {
    this.need(ctx, 'compensation.manage');
    if (!(PAY_TYPES as readonly string[]).includes(b.payType)) throw new PayrollError('VALIDATION_FAILED', 'Choose commission, hourly, salary or hybrid.');
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (!ymd.test(String(b.effectiveStart)) || (b.effectiveEnd && !ymd.test(String(b.effectiveEnd)))) throw new PayrollError('VALIDATION_FAILED', 'Dates must be YYYY-MM-DD.');
    if (b.effectiveEnd && b.effectiveEnd <= b.effectiveStart) throw new PayrollError('VALIDATION_FAILED', 'The end date must be after the start date.');
    const intOrNull = (v: any, label: string) => { if (v == null || v === '') return null; if (!Number.isInteger(v) || v < 0) throw new PayrollError('VALIDATION_FAILED', `${label} must be whole cents.`); return v as number; };
    const hourly = intOrNull(b.hourlyRateCents, 'The hourly rate'); const salary = intOrNull(b.salaryCentsPerPeriod, 'The salary');
    const payType = b.payType as PayType;
    if (payType === 'hourly' && hourly == null) throw new PayrollError('VALIDATION_FAILED', 'An hourly plan needs an hourly rate.');
    if (payType === 'salary' && salary == null) throw new PayrollError('VALIDATION_FAILED', 'A salary plan needs the salary per pay period.');
    if (payType === 'hybrid' && hourly == null && salary == null) throw new PayrollError('VALIDATION_FAILED', 'A hybrid plan adds an hourly rate and/or a salary to commission.');
    const tech = await this.db.selectFrom('technicians').select(['id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', b.technicianId).executeTakeFirst();
    if (!tech) throw new PayrollError('RESOURCE_NOT_FOUND', 'That technician is not in this salon.');
    try {
      const plan = await this.plans.create(ctx.tenantId, ctx.userId ?? null, { technicianId: b.technicianId, branchId: b.branchId ?? null, payType, hourlyRateCents: hourly, salaryCentsPerPeriod: salary,
        breaksPaid: !!b.breaksPaid, overtimeWeeklyMinutes: Number.isInteger(b.overtimeWeeklyMinutes) && (b.overtimeWeeklyMinutes as number) > 0 ? (b.overtimeWeeklyMinutes as number) : 2400,
        effectiveStart: b.effectiveStart, effectiveEnd: b.effectiveEnd ?? null, note: b.note ? String(b.note).slice(0, 300) : null });
      await this.audit(ctx, 'pay_plan.created', plan.id, 'high', { technicianId: plan.technicianId, payType, hourlyRateCents: hourly, salaryCentsPerPeriod: salary, effectiveStart: plan.effectiveStart, effectiveEnd: plan.effectiveEnd }, null, 'technician_pay_plan');
      return plan;
    } catch (e: any) {
      if (e?.code === '23P01') throw new PayrollError('PAY_PLAN_CONFLICT', 'This technician already has a pay plan for those dates. End it first.');
      throw e;
    }
  }

  async archivePayPlan(ctx: PayrollContext, id: string) {
    this.need(ctx, 'compensation.manage');
    const r = await this.plans.archive(ctx.tenantId, ctx.userId ?? null, id);
    if (!r) throw new PayrollError('RESOURCE_NOT_FOUND', 'That pay plan could not be found or is already ended.');
    await this.audit(ctx, 'pay_plan.archived', id, 'high', { technicianId: r.technicianId }, null, 'technician_pay_plan');
    return r;
  }

  async listDeductionTypes(ctx: PayrollContext) { this.need(ctx, 'pos.payroll.view'); return this.plans.deductionTypes(ctx.tenantId); }
  async upsertDeductionType(ctx: PayrollContext, b: { key: string; label: string; enabled?: boolean | null; maxCentsPerPeriod?: number | null }) {
    this.need(ctx, 'compensation.manage');
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(String(b.key ?? ''))) throw new PayrollError('VALIDATION_FAILED', 'The key is lowercase letters, digits and underscores.');
    const label = String(b.label ?? '').trim(); if (label.length < 2) throw new PayrollError('VALIDATION_FAILED', 'Give the deduction type a name.');
    const cap = b.maxCentsPerPeriod == null ? null : b.maxCentsPerPeriod;
    if (cap != null && (!Number.isInteger(cap) || cap <= 0)) throw new PayrollError('VALIDATION_FAILED', 'The limit must be positive whole cents.');
    const d = await this.plans.upsertDeductionType(ctx.tenantId, ctx.userId ?? null, { key: b.key, label: label.slice(0, 80), enabled: b.enabled !== false, maxCentsPerPeriod: cap });
    await this.audit(ctx, 'deduction_type.saved', d.id, 'medium', { key: d.key, enabled: d.enabled, maxCentsPerPeriod: d.maxCentsPerPeriod }, null, 'compensation_deduction_type');
    return d;
  }

  // ── external provider (§137–§138) ───────────────────────────────────────────────────────────────────────────────────
  async providerStatus(ctx: PayrollContext) { this.need(ctx, 'pos.payroll.view'); return this.provider.status(ctx.tenantId); }

  // ── Super Admin (§166): safe platform status only — no technician, no money ─────────────────────────────────────────
  async platformStatus() {
    const periods = await this.db.selectFrom('payroll_periods').select(['tenant_id', 'status', 'blocking_count']).limit(20000).execute();
    const exc = await this.db.selectFrom('compensation_exceptions').select(['tenant_id', 'kind']).where('status', 'in', ['open', 'retrying']).limit(20000).execute();
    const byTenant = new Map<string, { tenantId: string; periods: number; open: number; inReview: number; approved: number; paid: number; withBlockingIssues: number; openExceptions: number }>();
    const row = (t: string) => { let r = byTenant.get(t); if (!r) { r = { tenantId: t, periods: 0, open: 0, inReview: 0, approved: 0, paid: 0, withBlockingIssues: 0, openExceptions: 0 }; byTenant.set(t, r); } return r; };
    for (const p of periods as any[]) { const r = row(p.tenant_id); r.periods++; if (p.status === 'draft') r.open++; else if (p.status === 'review') r.inReview++; else if (p.status === 'finalized') r.approved++; else if (p.status === 'paid') r.paid++; if (Number(p.blocking_count) > 0) r.withBlockingIssues++; }
    for (const e of exc as any[]) row(e.tenant_id).openExceptions++;
    const tenants = [...byTenant.values()];
    return { tenantsUsingPayroll: tenants.length, periodsInReview: tenants.reduce((a, t) => a + t.inReview, 0), openExceptions: exc.length, providerConfigured: false, tenants };
  }
}
