/**
 * payroll-paycheck.service.ts — the WEEKLY PAYCHECK layer of the one payroll system (Kevin's Weekly Technician Paycheck,
 * Cash Payout & Owner Approval mandate, Oct 21 2026). It adds, on top of payroll_periods / payroll_lines / payroll_payouts
 * and PayrollWorkflowService (never beside them):
 *
 *   EARNINGS (payroll_lines, the one build) → PAY PERIOD → PAY STATEMENT (immutable snapshot, PAY-YYYY-NNNNNN)
 *     → PAYOUT PLAN (50% check / 50% cash by default, or a permitted manual split; Σ = payable exactly)
 *     → MANAGER SUBMIT → OWNER APPROVE / RETURN / REJECT (separation of duties) → LOCK
 *     → PAYOUTS (one per instruction): CHECK planned → issued → delivered → cleared (void + replacement)
 *                                      CASH planned → ready (drawer movement) → handed off → acknowledged (dispute)
 *     → PAID / PARTIALLY PAID (paid + unpaid = approved payable, always)
 *
 * Every write takes the period / statement / payout row FOR UPDATE in one transaction, checks the version, moves status
 * only through its state machine, writes its domain event to the outbox in the same transaction, and is idempotent
 * (submit ×10 = one submission; approve ×N = one materialisation; a retried check issue or cash acknowledgment = one).
 * The frontend is never the authority: every amount here is computed from the database.
 */
import { createHash, randomBytes } from 'crypto';
import { addDays, businessDate } from '@aipowersalon/date-time';
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { assertTransition, type DB } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import type { AuditService } from '@aipowersalon/audit';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter, type DomainEventType } from '@aipowersalon/events';
import type { PayrollContext } from './payroll.repository';
import { PAYROLL_PERIOD, PAYROLL_PAYOUT, ymdOf } from './payroll.dto';
import { PayrollError, overlapError } from './payroll-workflow';
import { toLine } from './payroll.kysely.repository';
import { ClockPinLockedError } from '../technician-clock-pin/technician-clock-pin.service';
import { COUNTED_ADJUSTMENT_STATUSES } from '../compensation/compensation-adjustments';
import type { PayrollWorkflowService, PaycheckHooks, PayrollBuilder, PayrollPushLike } from './payroll-workflow.service';
import { buildPayStub, type PayStubFile } from './payroll-paystub.service';
import { PayStubRateLimiter } from './payroll-paystub';
import { Logger } from '@nestjs/common';
import { fitCashCap,
  PAY_STATEMENT, PAYOUT_PLAN, PAYOUT_INSTRUCTION, CHECK_PAYOUT, CASH_PAYOUT, PERIOD_PAYOUT, DEFAULT_POLICY, PLAN_ISSUE_TEXT,
  defaultInstructions, manualInstructions, validateInstructions, statementFigures, statementNumber, statementPaymentStatus, periodPayoutStatus,
  payoutStatusForCheck, payoutStatusForCash, lastCompletedPeriod, periodLabel, statementExceptions, matchesWeekFilter, itemiseReversals, ledgerFavourCents, validSignaturePath,
  CASH_HANDOFF_TOKEN_TTL_MS, type CashAckMethod, type ReversalItems,
  type WeekReviewFilter, type PayoutPolicy, type PolicyType, type Instruction, type InstructionMethod, type PlanIssue,
} from './payroll-paycheck';

type Db = Kysely<DB>;
type Trx = Transaction<DB>;
type Exec = Db | Trx;
type Row = Record<string, unknown>;

/** The register drawer, bound by apps/api (checkout owns cash_drawer_movements; workforce never imports checkout). */
export interface PayrollCashDrawerPort {
  availableCents(ctx: PayrollContext, x: { branchId: string; registerId: string }): Promise<number>;
  withdraw(trx: Trx, ctx: PayrollContext, x: { branchId: string; registerId: string; amountCents: number; payoutId: string; idempotencyKey: string; note: string }): Promise<{ movementId: string }>;
  reverse(trx: Trx, ctx: PayrollContext, movementId: string): Promise<void>;
}
/** The technician's 4-digit PIN (TechnicianClockPinService). */
export interface TechnicianPinPort { verifyPin(ctx: { tenantId: string; branchId?: string | null }, technicianId: string, pin: string): Promise<{ ok: boolean; reason?: string }> }

export interface PayrollScheduleView {
  frequency: string; weekStartDay: number; payDayOffsetDays: number; timezone: string | null; active: boolean; autoPrepare: boolean;
  defaultPolicy: PayoutPolicy['defaultPolicy']; defaultCheckBp: number; primaryMethod: 'check' | 'cash'; cashEnabled: boolean; maxCashBp: number;
  allowedMethods: string[]; manualSplitAllowed: boolean; cashTipsAlreadyPaid: boolean; cashPaidOn: 'acknowledged' | 'handed_off'; version: number;
}
const SCHEDULE_DEFAULTS: PayrollScheduleView = { frequency: 'weekly', weekStartDay: 1, payDayOffsetDays: 5, timezone: null, active: true, autoPrepare: false,
  defaultPolicy: 'split_check_cash', defaultCheckBp: 5000, primaryMethod: 'check', cashEnabled: true, maxCashBp: 10000, allowedMethods: ['check', 'cash'],
  manualSplitAllowed: true, cashTipsAlreadyPaid: false, cashPaidOn: 'acknowledged', version: 0 };

/** the acting user for an actor column (uuid) — the weekly worker acts as 'system:payroll-weekly', stored as NULL */
const actorOf = (ctx: { userId?: string | null }) => (ctx.userId && /^[0-9a-f-]{36}$/i.test(ctx.userId) ? ctx.userId : null);
const n = (v: unknown) => (v == null ? 0 : Number(v));
/** split a list for multi-row statements / IN lists (bind-parameter headroom on very large salons) */
const chunks = <T,>(xs: T[], size: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size)); return out; };
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
/** the itemised reversals are a breakdown of reversals_cents: never more than it (a positive correction in the same ledger
 *  can shrink the net reversal below the itemised sum — then the items are scaled down in a fixed order, refund first) */
const clampReversalItems = (it: ReversalItems, total: number): ReversalItems => {
  let left = Math.max(0, total);
  const take = (v: number) => { const x = Math.min(Math.max(0, v), left); left -= x; return x; };
  return { refundReversalCents: take(it.refundReversalCents), tipAdjustmentCents: take(it.tipAdjustmentCents), retailReversalCents: take(it.retailReversalCents) };
};
const LIVE_STATEMENT = ['draft', 'ready_for_review', 'submitted', 'held', 'approved', 'locked', 'issued', 'partially_paid', 'paid'];
const APPROVED_STATEMENT = ['locked', 'issued', 'partially_paid', 'paid'];
const PAYOUT_METHOD: Record<InstructionMethod, string> = { check: 'check', cash: 'cash', ach: 'ach', direct_deposit: 'direct_deposit', external_transfer: 'external_transfer', payroll_provider: 'payroll_provider' };
const CASH_SOURCES = ['register_drawer', 'safe', 'bank_withdrawal', 'other_recorded_source'] as const;
const PAYOUT_SELECT = ['id', 'tenant_id', 'branch_id', 'period_id', 'technician_id', 'statement_id', 'instruction_id', 'amount_cents', 'method', 'status', 'paid_at', 'reference', 'note',
  'check_number', 'check_status', 'check_issued_at', 'check_delivered_at', 'check_cleared_at', 'check_voided_at', 'check_void_reason', 'replaces_payout_id',
  'cash_source', 'cash_status', 'cash_register_id', 'cash_prepared_by', 'cash_prepared_at', 'cash_handed_off_by', 'cash_handed_off_at', 'cash_acknowledged_at', 'cash_ack_method',
  'cash_dispute_reason', 'drawer_movement_id', 'version', 'created_at', 'created_by', 'cash_handoff_token_expires_at', 'cash_ack_signature', 'cash_ack_confirmed_by'] as const;   // never the token hash (verified in its own read)

const STATEMENT_COLS = ['id', 'tenant_id', 'period_id', 'technician_id', 'branch_id', 'statement_number', 'service_commission_cents', 'hourly_pay_cents', 'salary_pay_cents', 'tips_cents', 'card_tip_cents',
  'cash_tip_cents', 'retail_commission_cents', 'bonus_cents', 'guarantee_topup_cents', 'positive_adjustments_cents', 'deductions_cents', 'reversals_cents', 'gross_earnings_cents', 'line_payable_cents',
  'already_paid_cents', 'approved_payable_cents', 'paid_cents', 'status', 'review_required', 'line_hash', 'branch_breakdown', 'manager_note', 'version', 'created_at', 'submitted_at', 'approved_at',
  'approved_by', 'locked_at', 'voided_at', 'void_reason', 'refund_reversal_cents', 'tip_adjustment_cents', 'retail_reversal_cents'] as const;
const PLAN_COLS = ['id', 'statement_id', 'policy_type', 'payable_cents', 'status', 'differs_from_default', 'override_reason', 'version'] as const;
const INSTRUCTION_COLS = ['id', 'plan_id', 'statement_id', 'method', 'amount_cents', 'basis_points', 'sequence', 'status', 'payout_id'] as const;
const LINE_COLS = ['id', 'tenant_id', 'period_id', 'technician_id', 'services_count', 'gross_sales_cents', 'commission_type', 'commission_value', 'commission_cents', 'retail_commission_cents', 'card_tip_cents',
  'cash_tip_cents', 'tips_cents', 'guarantee_topup_cents', 'hourly_pay_cents', 'worked_minutes', 'potential_overtime_minutes', 'salary_pay_cents', 'bonus_cents', 'adjustment_cents', 'deduction_cents',
  'net_cents', 'payable_cents', 'review_required', 'created_at', 'updated_at'] as const;
const PERIOD_VIEW_COLS = ['id', 'label', 'period_start', 'period_end', 'pay_date', 'status', 'payout_status', 'version', 'submitted_by', 'submitted_at', 'owner_decision', 'owner_note', 'approved_by', 'approval_hash', 'preview_hash', 'canceled_at', 'cancel_reason'] as const;

export interface PayoutView {
  id: string; statementId: string | null; technicianId: string; method: string; amountCents: number; status: string; paidAt: string | null;
  checkNumber: string | null; checkStatus: string | null; checkIssuedAt: string | null; checkDeliveredAt: string | null; checkClearedAt: string | null; checkVoidedAt: string | null; checkVoidReason: string | null; replacesPayoutId: string | null;
  cashSource: string | null; cashStatus: string | null; cashPreparedBy: string | null; cashPreparedAt: string | null; cashHandedOffBy: string | null; cashHandedOffAt: string | null;
  cashAcknowledgedAt: string | null; cashAckMethod: string | null; cashDisputeReason: string | null; drawerMovementId: string | null; version: number; createdAt: string | null;
  /** §11.5: a QR handoff token is live on the manager's screen (never the token itself); the signature strokes; the co-confirming manager */
  cashHandoffTokenExpiresAt: string | null; cashAckSignature: string | null; cashAckConfirmedBy: string | null;
}
const toPayoutView = (r: Row): PayoutView => ({
  id: String(r.id), statementId: (r.statement_id as string) ?? null, technicianId: String(r.technician_id), method: String(r.method), amountCents: n(r.amount_cents), status: String(r.status), paidAt: iso(r.paid_at),
  checkNumber: (r.check_number as string) ?? null, checkStatus: (r.check_status as string) ?? null, checkIssuedAt: iso(r.check_issued_at), checkDeliveredAt: iso(r.check_delivered_at), checkClearedAt: iso(r.check_cleared_at),
  checkVoidedAt: iso(r.check_voided_at), checkVoidReason: (r.check_void_reason as string) ?? null, replacesPayoutId: (r.replaces_payout_id as string) ?? null,
  cashSource: (r.cash_source as string) ?? null, cashStatus: (r.cash_status as string) ?? null, cashPreparedBy: (r.cash_prepared_by as string) ?? null, cashPreparedAt: iso(r.cash_prepared_at),
  cashHandedOffBy: (r.cash_handed_off_by as string) ?? null, cashHandedOffAt: iso(r.cash_handed_off_at), cashAcknowledgedAt: iso(r.cash_acknowledged_at), cashAckMethod: (r.cash_ack_method as string) ?? null,
  cashDisputeReason: (r.cash_dispute_reason as string) ?? null, drawerMovementId: (r.drawer_movement_id as string) ?? null, version: n(r.version) || 1, createdAt: iso(r.created_at),
  cashHandoffTokenExpiresAt: iso(r.cash_handoff_token_expires_at), cashAckSignature: (r.cash_ack_signature as string) ?? null, cashAckConfirmedBy: (r.cash_ack_confirmed_by as string) ?? null,
});

export interface StatementView {
  id: string; periodId: string; technicianId: string; technicianName: string | null; statementNumber: string; status: string; reviewRequired: boolean; version: number;
  serviceCommissionCents: number; hourlyPayCents: number; salaryPayCents: number; tipsCents: number; cardTipCents: number; cashTipCents: number; retailCommissionCents: number;
  bonusCents: number; guaranteeTopUpCents: number; positiveAdjustmentsCents: number; deductionsCents: number; reversalsCents: number;
  /** §4.2 the reversals itemised (each ≥ 0; together ≤ reversalsCents — the rest are other negative corrections) */
  refundReversalCents: number; tipAdjustmentCents: number; retailReversalCents: number;
  grossEarningsCents: number; linePayableCents: number; alreadyPaidCents: number; approvedPayableCents: number; paidCents: number; unpaidCents: number;
  branchBreakdown: Array<{ branchId: string | null; branchName: string | null; serviceEarningsCents: number; tipsCents: number; services: number }>;
  managerNote?: string | null; submittedAt: string | null; approvedAt: string | null; approvedBy: string | null; lockedAt: string | null; voidedAt: string | null; createdAt: string | null;
}
export interface PlanView { id: string; policyType: PolicyType; payableCents: number; status: string; differsFromDefault: boolean; overrideReason: string | null; version: number;
  instructions: Array<{ id: string; method: string; amountCents: number; basisPoints: number | null; sequence: number; status: string; payoutId: string | null }>; issues: Array<{ code: PlanIssue; message: string }> }

export class PayrollPaycheckService implements PaycheckHooks {
  /** bound by apps/api: the register drawer (cash from a POS drawer becomes a linked PAYROLL_CASH_PAYOUT movement) */
  cashDrawer: PayrollCashDrawerPort | null = null;
  constructor(private readonly db: Db, private readonly opts: {
    workflow: PayrollWorkflowService; builder?: PayrollBuilder | null; outbox?: OutboxWriter | null; audit?: AuditService | null; pins?: TechnicianPinPort | null; now?: () => Date;
    /** §18 notifications (the PushService the payroll already uses): best-effort, never fails a money step */
    push?: PayrollPushLike | null;
  }) {}

  private readonly log = new Logger('PayrollPaycheck');
  /** statements a transaction made fully PAID — told to their technicians once that transaction has committed */
  private readonly justPaid = new WeakMap<object, Array<{ technicianId: string; statementId: string; periodId: string }>>();
  private paidNotices(trx: object) { let l = this.justPaid.get(trx); if (!l) { l = []; this.justPaid.set(trx, l); } return l; }
  /** §17.7 "payout completed": one push per technician whose statement this committed transaction paid in full. No amount
   *  in the push (§17 privacy) — the Tech App shows it. Best-effort (notify never throws). */
  private async sendPaidNotices(ctx: PayrollContext, notices: Array<{ technicianId: string; statementId: string; periodId: string }> | undefined): Promise<void> {
    for (const x of notices ?? []) await this.notify(ctx.tenantId, { technicianIds: [x.technicianId] }, { title: 'Your pay is complete', body: 'This week\'s pay has been paid in full. Open the app for details.', kind: 'payroll_payout_completed', data: { statementId: x.statementId, periodId: x.periodId } });
  }
  /** §18: tell a person (owner / submitter / technician) in-app. Best-effort AFTER the commit — logged, never thrown. */
  private async notify(tenantId: string, who: { userIds?: Array<string | null | undefined>; technicianIds?: string[]; owner?: boolean; managers?: boolean }, msg: { title: string; body: string; kind: string; data?: Record<string, string> }) {
    if (!this.opts.push) return;
    try {
      const users = new Set<string>((who.userIds ?? []).filter((u): u is string => !!u && /^[0-9a-f-]{36}$/i.test(u)));
      if (who.owner) { const t = await this.db.selectFrom('tenants').select('owner_user_id').where('id', '=', tenantId).executeTakeFirst(); if (t?.owner_user_id) users.add(String(t.owner_user_id)); }
      if (who.managers) {
        // §17.7 "weekly payroll is ready for review": the salon's active managers (they hold pos.payroll.manage by role);
        // a salon without a manager tells its owner, who prepares payroll herself
        const ms = await this.db.selectFrom('users').select('id').where('tenant_id', '=', tenantId).where('role', '=', 'MANAGER').where('status', '=', 'active').execute();
        for (const m of ms) users.add(String(m.id));
        if (!ms.length) { const t = await this.db.selectFrom('tenants').select('owner_user_id').where('id', '=', tenantId).executeTakeFirst(); if (t?.owner_user_id) users.add(String(t.owner_user_id)); }
      }
      if (who.technicianIds?.length) for (const r of await this.db.selectFrom('technicians').select(['user_id']).where('tenant_id', '=', tenantId).where('id', 'in', [...new Set(who.technicianIds)]).execute()) if (r.user_id) users.add(String(r.user_id));
      for (const u of users) await this.opts.push.dispatchToUser(tenantId, u, { title: msg.title, body: msg.body, data: { kind: msg.kind, ...(msg.data ?? {}) }, reference: msg.kind, category: 'PAYROLL' });
    } catch (e) { this.log.warn(`paycheck notification ${msg.kind} not sent: ${(e as Error).message}`); }
  }

  // ── guards / helpers ────────────────────────────────────────────────────────────────────────────────────────────────
  private need(ctx: PayrollContext, perm: string) {
    if (!ctx?.tenantId || !ctx?.userId) throw new PayrollError('PERMISSION_DENIED', 'Sign in to a salon first.');
    if (!hasPermission(ctx as never, perm)) throw new PayrollError('PERMISSION_DENIED', `You need the ${perm} permission for this payroll action.`, { permission: perm });
  }
  private async audit(ctx: PayrollContext, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown>, reason?: string | null, severity: 'low' | 'medium' | 'high' = 'high') {
    if (!this.opts.audit) return;
    try {
      await this.opts.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: actorOf(ctx), role: ctx.role ?? null } as never,
        { module: 'payroll', action, resourceType, resourceId, severity, metadata, reason: reason ?? null } as never);
    } catch (e) { void e; /* AuditService.record is resilient by contract (it logs its own failures); an audit hiccup never undoes a payout */ }
  }
  private domainEvent(ctx: PayrollContext, type: DomainEventType, aggregate: { type: string; id: string; branchId?: string | null }, payload: Record<string, unknown>) {
    const uuid = /^[0-9a-f-]{36}$/i;
    return createDomainEvent({ eventType: type, tenantId: ctx.tenantId, branchId: aggregate.branchId && uuid.test(aggregate.branchId) ? aggregate.branchId : undefined,
      aggregateType: aggregate.type, aggregateId: aggregate.id, actorId: ctx.userId && uuid.test(ctx.userId) ? ctx.userId : undefined, actorType: ctx.userId && uuid.test(ctx.userId) ? 'user' : 'system', payload });
  }
  private async event(trx: Trx, ctx: PayrollContext, type: DomainEventType, aggregate: { type: string; id: string; branchId?: string | null }, payload: Record<string, unknown>) {
    if (!this.opts.outbox) return;
    await this.opts.outbox.write(trx as never, this.domainEvent(ctx, type, aggregate, payload));
  }
  /** §14 / §16.6: a manager whose role template confines them to a branch (BRANCH / SELECTED_BRANCHES) may review and
   *  change the splits of their branch's technicians, but the salon-wide steps (open, calculate, default-for-all, submit,
   *  cancel) belong to a salon-wide manager or the owner. */
  private assertSalonWide(ctx: PayrollContext, step: string) {
    if (this.branchScope(ctx)) throw new PayrollError('PERMISSION_DENIED', `Payroll is prepared for the whole salon — a branch manager cannot ${step}. Ask a salon-wide manager or the owner.`, { reason: 'branch_scoped', step });
  }
  private async lockPeriod(trx: Exec, ctx: PayrollContext, id: string): Promise<Row> {
    const p = await trx.selectFrom('payroll_periods').select(['id', 'tenant_id', 'branch_id', 'label', 'period_start', 'period_end', 'status', 'version', 'payout_status', 'submitted_by', 'submitted_at', 'prepared_by', 'pay_date', 'owner_decision', 'owner_note'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw new PayrollError('PAYROLL_PERIOD_NOT_FOUND', 'That pay period could not be found.');
    return p as Row;
  }
  private async technicianOfUser(exec: Exec, tenantId: string, userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const t = await exec.selectFrom('technicians').select(['id']).where('tenant_id', '=', tenantId).where('user_id', '=', userId).executeTakeFirst();
    return t ? String(t.id) : null;
  }

  // ── schedule & policy (§3, §6–§7) ───────────────────────────────────────────────────────────────────────────────────
  async schedule(ctx: PayrollContext): Promise<PayrollScheduleView> {
    this.need(ctx, 'pos.payroll.view');
    return this.scheduleOf(this.db, ctx.tenantId);
  }
  private async scheduleOf(exec: Exec, tenantId: string): Promise<PayrollScheduleView> {
    const r = await exec.selectFrom('payroll_schedules').select(['frequency', 'week_start_day', 'pay_day_offset_days', 'timezone', 'active', 'auto_prepare', 'default_policy', 'default_check_bp', 'primary_method',
      'cash_enabled', 'max_cash_bp', 'allowed_methods', 'manual_split_allowed', 'cash_tips_already_paid', 'cash_paid_on', 'version']).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (!r) return { ...SCHEDULE_DEFAULTS };
    return { frequency: r.frequency, weekStartDay: n(r.week_start_day), payDayOffsetDays: n(r.pay_day_offset_days), timezone: r.timezone ?? null, active: !!r.active, autoPrepare: !!r.auto_prepare,
      defaultPolicy: r.default_policy as PayoutPolicy['defaultPolicy'], defaultCheckBp: n(r.default_check_bp), primaryMethod: r.primary_method as 'check' | 'cash', cashEnabled: !!r.cash_enabled,
      maxCashBp: n(r.max_cash_bp), allowedMethods: (r.allowed_methods as string[]) ?? ['check', 'cash'], manualSplitAllowed: !!r.manual_split_allowed, cashTipsAlreadyPaid: !!r.cash_tips_already_paid,
      cashPaidOn: r.cash_paid_on as 'acknowledged' | 'handed_off', version: n(r.version) };
  }
  private policyOf(s: PayrollScheduleView): PayoutPolicy {
    return { defaultPolicy: s.defaultPolicy, defaultCheckBp: s.defaultCheckBp, primaryMethod: s.primaryMethod, cashEnabled: s.cashEnabled, maxCashBp: s.maxCashBp, allowedMethods: s.allowedMethods, manualSplitAllowed: s.manualSplitAllowed };
  }
  /** The OWNER sets the pay schedule and the payout policy (the 50 / 50 default, the cash cap, which methods are on). */
  async saveSchedule(ctx: PayrollContext, b: Partial<Omit<PayrollScheduleView, 'version'>> & { version?: number | null }): Promise<PayrollScheduleView> {
    this.need(ctx, 'payroll.approve');
    const cur = await this.scheduleOf(this.db, ctx.tenantId);
    const next = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== null)) } as PayrollScheduleView;
    if (!['weekly', 'biweekly', 'semimonthly', 'monthly'].includes(next.frequency)) throw new PayrollError('VALIDATION_FAILED', 'Choose weekly, every two weeks, twice a month or monthly.');
    if (!Number.isInteger(next.weekStartDay) || next.weekStartDay < 0 || next.weekStartDay > 6) throw new PayrollError('VALIDATION_FAILED', 'The week starts on a day of the week.');
    if (!Number.isInteger(next.payDayOffsetDays) || next.payDayOffsetDays < 0 || next.payDayOffsetDays > 31) throw new PayrollError('VALIDATION_FAILED', 'Pay day must be 0–31 days after the week ends.');
    for (const bp of [next.defaultCheckBp, next.maxCashBp]) if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new PayrollError('VALIDATION_FAILED', 'Percentages are 0–100%.');
    const methods = [...new Set(next.allowedMethods)].filter((m) => ['check', 'cash', 'ach', 'direct_deposit', 'external_transfer', 'payroll_provider'].includes(m));
    if (!methods.length) throw new PayrollError('VALIDATION_FAILED', 'Turn on at least one payout method.');
    const vals = { frequency: next.frequency, week_start_day: next.weekStartDay, pay_day_offset_days: next.payDayOffsetDays, timezone: next.timezone ?? null, active: next.active, auto_prepare: next.autoPrepare,
      default_policy: next.defaultPolicy, default_check_bp: next.defaultCheckBp, primary_method: next.primaryMethod, cash_enabled: next.cashEnabled, max_cash_bp: next.maxCashBp,
      allowed_methods: methods, manual_split_allowed: next.manualSplitAllowed, cash_tips_already_paid: next.cashTipsAlreadyPaid, cash_paid_on: next.cashPaidOn, updated_by: actorOf(ctx) };
    const ok = await this.db.transaction().execute(async (trx) => {
      if (cur.version === 0) {
        const ins = await trx.insertInto('payroll_schedules').values({ tenant_id: ctx.tenantId, ...vals }).onConflict((oc) => oc.column('tenant_id').doNothing()).returning('tenant_id').executeTakeFirst();
        return !!ins;
      }
      if (b.version != null && Number(b.version) !== cur.version) return false;
      const up = await trx.updateTable('payroll_schedules').set({ ...vals, version: sql`version + 1`, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('version', '=', cur.version).executeTakeFirst();
      return Number(up.numUpdatedRows) === 1;
    });
    if (!ok) throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'Someone else changed the pay schedule. Reload it and try again.');
    await this.audit(ctx, 'schedule.saved', 'payroll_schedule', ctx.tenantId, { before: cur, after: vals });
    return this.scheduleOf(this.db, ctx.tenantId);
  }

  // ── the weekly period (§3) ──────────────────────────────────────────────────────────────────────────────────────────
  private async salonToday(tenantId: string, tz: string | null): Promise<{ today: string; tz: string }> {
    let zone = tz;
    if (!zone) {
      const r = await sql<{ tz: string | null }>`SELECT settings_json->>'timezone' AS tz FROM tenant_settings WHERE tenant_id = ${tenantId} AND branch_id IS NULL AND category = 'business-branch' LIMIT 1`.execute(this.db);
      zone = r.rows[0]?.tz || 'America/New_York';
    }
    const now = this.opts.now ? this.opts.now() : new Date();
    let today: string;
    try { today = businessDate(zone, now); }
    catch (e) { this.log.warn(`salon time zone ${zone} unusable (${(e as Error).message}); using America/New_York`); zone = 'America/New_York'; today = businessDate(zone, now); }
    return { today, tz: zone };
  }
  /** Open (or find) the salon's last completed week as ONE tenant-wide period, and calculate it. The weekly worker calls
   *  this when the salon turned automatic preparation on; a manager can press "Open last week" any time. Never approves. */
  async openWeek(ctx: PayrollContext): Promise<{ periodId: string; created: boolean; periodStart: string; periodEnd: string; payDate: string; frequency: string }> {
    this.need(ctx, 'pos.payroll.manage');
    this.assertSalonWide(ctx, 'open a pay period');
    const s = await this.scheduleOf(this.db, ctx.tenantId);
    const { today } = await this.salonToday(ctx.tenantId, s.timezone);
    // §3.3: the last completed period of the salon's frequency — a week, two weeks, half a month or a month
    const w = lastCompletedPeriod(s.frequency, today, s.weekStartDay, s.payDayOffsetDays);
    const label = periodLabel(s.frequency, w.periodStart, w.periodEnd);
    const res = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'pay-period-create:' + ctx.tenantId}))`.execute(trx);
      // a salon-wide week may not cover days another period already holds (they would be paid twice) — its OWN earlier
      // generation of this same week is the on-conflict below, not a clash
      const clash = await trx.selectFrom('payroll_periods').select(['id', 'label', sql<string>`period_start::text`.as('ps'), sql<string>`period_end::text`.as('pe')])
        .where('tenant_id', '=', ctx.tenantId).where('status', '<>', 'canceled').where(sql<boolean>`period_start <= ${w.periodEnd}::date AND period_end >= ${w.periodStart}::date`)
        .where(sql<boolean>`NOT (schedule_generated AND branch_id IS NULL AND period_start = ${w.periodStart}::date AND period_end = ${w.periodEnd}::date)`).executeTakeFirst();
      if (clash) throw overlapError({ id: String(clash.id), periodStart: clash.ps, periodEnd: clash.pe, label: (clash.label as string | null) ?? null });
      const ins = await trx.insertInto('payroll_periods').values({ tenant_id: ctx.tenantId, branch_id: null, label, period_start: w.periodStart, period_end: w.periodEnd, status: 'draft',
        pay_date: w.payDate, schedule_generated: true, created_by: actorOf(ctx) } as never)
        .onConflict((oc) => oc.columns(['tenant_id', 'period_start', 'period_end']).where('schedule_generated', '=', true).where('branch_id', 'is', null).where('status', '<>', 'canceled').doNothing()).returning('id').executeTakeFirst();
      if (ins) {
        await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PERIOD_OPENED, { type: 'payroll_period', id: String(ins.id) }, { periodId: String(ins.id), periodStart: w.periodStart, periodEnd: w.periodEnd, payDate: w.payDate });
        return { id: String(ins.id), created: true };
      }
      const ex = await trx.selectFrom('payroll_periods').select('id').where('tenant_id', '=', ctx.tenantId).where('period_start', '=', w.periodStart).where('period_end', '=', w.periodEnd).where('schedule_generated', '=', true).where('branch_id', 'is', null).where('status', '<>', 'canceled').executeTakeFirstOrThrow();
      return { id: String(ex.id), created: false };
    });
    if (res.created) {
      const week = await this.calculate(ctx, res.id);
      await this.audit(ctx, 'week.opened', 'payroll_period', res.id, { ...w }, null, 'medium');
      // §17.7 the manager is told the period is ready for review — no amounts in a push (§17 privacy), the POS shows them
      await this.notify(ctx.tenantId, { managers: true }, { title: 'Payroll is ready for review', kind: 'payroll_ready_for_review', data: { periodId: res.id },
        body: `${w.periodStart} – ${w.periodEnd}: ${week.totals.technicians} technician${week.totals.technicians === 1 ? '' : 's'} calculated. Open Payroll to review and submit to the owner.` });
    }
    return { periodId: res.id, created: res.created, ...w };
  }

  /** §3.4: cancel a period opened by mistake — draft only, nothing approved, no payout in motion. Its draft statements are
   *  VOIDED (kept, never deleted), their plans superseded; the period is terminal CANCELED and holds no days any more. */
  async cancelPeriod(ctx: PayrollContext, periodId: string, b: { reason: string; expectedVersion?: number | null }) {
    this.need(ctx, 'pos.payroll.manage');
    this.assertSalonWide(ctx, 'cancel a pay period');
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw new PayrollError('VALIDATION_FAILED', 'Say why this pay period is canceled.');
    const out = await this.db.transaction().execute(async (trx) => {
      const p = await this.lockPeriod(trx, ctx, periodId);
      if (p.status === 'canceled') return { already: true, statements: 0, branchId: (p.branch_id as string) ?? null };
      if (p.status !== 'draft') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', p.status === 'review' ? 'This payroll is with the owner — ask the owner to return it first.' : 'An approved pay period cannot be canceled; reopen it with a reason instead.');
      if (b.expectedVersion != null && Number(b.expectedVersion) !== n(p.version)) throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'Someone else changed this pay period. Reload it and try again.', { currentVersion: n(p.version) });
      const sts = await trx.selectFrom('payroll_statements').select(['id', 'status']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '<>', 'voided').execute();
      if (sts.some((x) => !['draft', 'ready_for_review'].includes(String(x.status)))) throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'A statement of this period was already submitted or approved — it cannot be canceled.');
      const moving = await trx.selectFrom('payroll_payouts').select('id').where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', 'not in', ['canceled', 'failed']).limit(1).executeTakeFirst();
      if (moving) throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'A payout was recorded on this period — it cannot be canceled.');
      assertTransition(PAYROLL_PERIOD, String(p.status), 'canceled');
      for (const x of sts) assertTransition(PAY_STATEMENT, String(x.status), 'voided');
      const ids = sts.map((x) => String(x.id));
      for (const part of chunks(ids, 1000)) {
        await trx.updateTable('payroll_statements').set({ status: 'voided', voided_at: sql`now()`, void_reason: `Pay period canceled: ${reason}`.slice(0, 300), version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', part).execute();
      }
      await this.supersedeMany(trx, ctx, ids);
      await trx.updateTable('payroll_periods').set({ status: 'canceled', canceled_at: sql`now()`, canceled_by: actorOf(ctx), cancel_reason: reason.slice(0, 500), version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) } as never)
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId).execute();
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PERIOD_CANCELED, { type: 'payroll_period', id: periodId, branchId: (p.branch_id as string) ?? null }, { periodId, statementsVoided: ids.length, periodStart: ymdOf(p.period_start), periodEnd: ymdOf(p.period_end) });
      return { already: false, statements: ids.length, branchId: (p.branch_id as string) ?? null };
    });
    if (!out.already) await this.audit(ctx, 'period.canceled', 'payroll_period', periodId, { statementsVoided: out.statements }, reason);
    return this.periodStatements(ctx, periodId);
  }

  /** Calculate (draft only): the ONE build from sales, then the statements and their default payout plans. */
  async calculate(ctx: PayrollContext, periodId: string) {
    this.need(ctx, 'pos.payroll.manage');
    this.assertSalonWide(ctx, 'calculate the period');
    const p = await this.lockPeriod(this.db, ctx, periodId);
    if (p.status === 'canceled') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'This pay period was canceled. Open a new one.');
    if (p.status !== 'draft') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'Only a week that has not been submitted can be recalculated. Ask the owner to return it first.');
    if (this.opts.builder) await this.opts.builder.buildFromSales(ctx, periodId);
    const r = await this.syncStatements(ctx, periodId);
    await this.db.transaction().execute(async (trx) => {
      const aggregate = { type: 'payroll_period', id: periodId, branchId: (p.branch_id as string) ?? null };
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_CALCULATED, aggregate, { periodId, statements: r.statements, technicianIds: r.technicianIds });
      // §17.1: the calculated period is now with the manager (its statements are drafts awaiting their review)
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_MANAGER_REVIEW_STARTED, aggregate, { periodId, statements: r.statements, technicianIds: r.technicianIds });
    });
    // §19.4: the calculation itself is audited (who, when, how many statements, which technicians)
    await this.audit(ctx, 'period.calculated', 'payroll_period', periodId, { statements: r.statements, technicianIds: r.technicianIds, periodStart: ymdOf(p.period_start), periodEnd: ymdOf(p.period_end) }, null, 'medium');
    return this.periodStatements(ctx, periodId);
  }

  // ── statements (§4–§5, §14) ─────────────────────────────────────────────────────────────────────────────────────────
  private lineHash(l: Row): string {
    const keys = ['commission_cents', 'retail_commission_cents', 'card_tip_cents', 'cash_tip_cents', 'tips_cents', 'guarantee_topup_cents', 'hourly_pay_cents', 'salary_pay_cents', 'bonus_cents', 'adjustment_cents', 'deduction_cents', 'net_cents', 'payable_cents'];
    return createHash('sha256').update(keys.map((k) => `${k}=${n(l[k])}`).join('|')).digest('hex').slice(0, 32);
  }
  /** Reserve `count` consecutive statement numbers for the year in ONE counter bump (the same numbers, in the same order,
   *  that `count` single bumps would have handed out). */
  private async nextNumbers(trx: Trx, tenantId: string, year: number, count: number): Promise<string[]> {
    if (count <= 0) return [];
    const r = await sql<{ last_number: number }>`INSERT INTO payroll_statement_counters (tenant_id, year, last_number) VALUES (${tenantId}, ${year}, ${count})
      ON CONFLICT (tenant_id, year) DO UPDATE SET last_number = payroll_statement_counters.last_number + ${count} RETURNING last_number`.execute(trx);
    const last = n(r.rows[0]?.last_number);
    return Array.from({ length: count }, (_, k) => statementNumber(year, last - count + 1 + k));
  }
  /** Each technician's earnings by branch for the week, for all the week's technicians in one grouped query (per
   *  technician: the same rows and the same order as before — by the earnings TEXT, descending). */
  private async branchBreakdowns(exec: Exec, tenantId: string, technicianIds: string[], w: { fromIso: string; toIso: string }) {
    type Breakdown = Array<{ branchId: string | null; branchName: string | null; serviceEarningsCents: number; tipsCents: number; services: number }>;
    const out = new Map<string, Breakdown>();
    for (const ids of chunks([...new Set(technicianIds)], 1000)) {
      const r = await sql<{ technician_id: string; branch_id: string | null; name: string | null; earn: string; tips: string; services: string }>`SELECT s.technician_id, s.branch_id, b.name,
          COALESCE(SUM(s.tech_service_earnings_cents),0)::text AS earn, COALESCE(SUM(s.card_tip_cents + s.cash_tip_cents),0)::text AS tips, count(*)::text AS services
        FROM ticket_compensation_snapshots s LEFT JOIN branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
        WHERE s.tenant_id = ${tenantId} AND s.technician_id IN (${sql.join(ids)}) AND s.snapshot_at >= ${w.fromIso} AND s.snapshot_at < ${w.toIso}
        GROUP BY s.technician_id, s.branch_id, b.name ORDER BY s.technician_id, 4 DESC`.execute(exec);
      for (const x of r.rows) {
        const k = String(x.technician_id);
        const list = out.get(k) ?? [];
        list.push({ branchId: x.branch_id ?? null, branchName: x.name ?? null, serviceEarningsCents: n(x.earn), tipsCents: n(x.tips), services: n(x.services) });
        out.set(k, list);
      }
    }
    return out;
  }
  /** §4.2: each technician's negative ledger entries of the period, itemised by reversal kind (refund / void / chargeback,
   *  tip corrections, retail reversals) — the same rows and routing the one build counted (posted / approved / applied;
   *  routed to the period, or unrouted and created in its window). One query per 1000 technicians. */
  private async reversalItems(exec: Exec, tenantId: string, periodId: string, technicianIds: string[], w: { fromIso: string; toIso: string }): Promise<Map<string, ReversalItems & { favourCents: number }>> {
    const out = new Map<string, ReversalItems & { favourCents: number }>();
    const byTech = new Map<string, Array<{ category: string; amountCents: number }>>();
    for (const ids of chunks([...new Set(technicianIds)], 1000)) {
      const r = await sql<{ technician_id: string; category: string; amount: string }>`SELECT technician_id, category, COALESCE(SUM(amount_cents),0)::text AS amount
        FROM compensation_adjustments WHERE tenant_id = ${tenantId} AND technician_id IN (${sql.join(ids)}) AND status IN (${sql.join([...COUNTED_ADJUSTMENT_STATUSES])})
          AND (period_id = ${periodId} OR (period_id IS NULL AND created_at >= ${w.fromIso} AND created_at < ${w.toIso}))
        GROUP BY technician_id, category`.execute(exec);
      for (const x of r.rows) { const k = String(x.technician_id); const l = byTech.get(k) ?? []; l.push({ category: String(x.category), amountCents: n(x.amount) }); byTech.set(k, l); }
    }
    for (const [k, entries] of byTech) out.set(k, { ...itemiseReversals(entries), favourCents: ledgerFavourCents(entries) });
    return out;
  }
  /** Create / refresh the draft statements of a draft week from its payroll lines, and give each a default payout plan.
   *  Approved statements are never touched (they are locked snapshots). */
  async syncStatements(ctx: PayrollContext, periodId: string): Promise<{ statements: number; technicianIds: string[] }> {
    const p0 = await this.lockPeriod(this.db, ctx, periodId);
    const w = await this.opts.workflow.windowOf(ctx, p0 as never);
    const lines = await this.db.selectFrom('payroll_lines').select([...LINE_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).execute();
    const breakdowns = await this.branchBreakdowns(this.db, ctx.tenantId, lines.map((l) => String(l.technician_id)), w);
    const reversals = await this.reversalItems(this.db, ctx.tenantId, periodId, lines.map((l) => String(l.technician_id)), w);
    const sched = await this.scheduleOf(this.db, ctx.tenantId);
    const policy = this.policyOf(sched);
    const year = Number(ymdOf(p0.period_end).slice(0, 4));
    return this.db.transaction().execute(async (trx) => {
      const p = await this.lockPeriod(trx, ctx, periodId);
      if (p.status !== 'draft') return { statements: 0, technicianIds: [] };
      const existing = await trx.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '<>', 'voided').execute();
      const byTech = new Map(existing.map((s) => [String(s.technician_id), s]));
      // the payouts already recorded on this period for a technician (an advance, the older one-off payout) are "already paid"
      const prior = await trx.selectFrom('payroll_payouts').select(['technician_id', sql<string>`COALESCE(SUM(amount_cents),0)::text`.as('paid')])
        .where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '=', 'paid').where('statement_id', 'is', null).groupBy('technician_id').execute();
      const priorBy = new Map(prior.map((r) => [String(r.technician_id), n(r.paid)]));
      const seen = new Set<string>();
      const branchId = (p.branch_id as string) ?? null;
      // pass 1 (no queries): what each technician's statement becomes — a new one, a changed one, or unchanged
      const statementVals = (fig: ReturnType<typeof statementFigures>, raw: Row, techId: string) => {
        // §4.2 the itemised reversals never exceed the statement's reversal total (the ledger categories are a breakdown of it)
        const it = reversals.get(techId) ?? { refundReversalCents: 0, tipAdjustmentCents: 0, retailReversalCents: 0 };
        const items = clampReversalItems(it, fig.reversalsCents);
        return { service_commission_cents: fig.serviceCommissionCents, hourly_pay_cents: fig.hourlyPayCents, salary_pay_cents: fig.salaryPayCents, tips_cents: fig.tipsCents, card_tip_cents: fig.cardTipCents,
        cash_tip_cents: fig.cashTipCents, retail_commission_cents: fig.retailCommissionCents, bonus_cents: fig.bonusCents, guarantee_topup_cents: fig.guaranteeTopUpCents,
        positive_adjustments_cents: fig.positiveAdjustmentsCents, deductions_cents: fig.deductionsCents, reversals_cents: fig.reversalsCents, gross_earnings_cents: fig.grossEarningsCents,
        refund_reversal_cents: items.refundReversalCents, tip_adjustment_cents: items.tipAdjustmentCents, retail_reversal_cents: items.retailReversalCents,
        line_payable_cents: fig.linePayableCents, already_paid_cents: fig.alreadyPaidCents, approved_payable_cents: fig.approvedPayableCents, review_required: fig.reviewRequired,
        line_hash: this.lineHash(raw), branch_breakdown: JSON.stringify(breakdowns.get(techId) ?? []) };
      };
      type Vals = ReturnType<typeof statementVals>;
      // in line order: the plan to keep in step with each statement (a new statement's id is filled in after its insert)
      const plans: Array<{ techId: string; statementId: string | null; payable: number; fresh: boolean }> = [];
      const inserts: Array<{ techId: string; vals: Vals }> = [];
      const changed: Array<{ id: string; vals: Vals }> = [];
      for (const raw of lines) {
        const techId = String(raw.technician_id); seen.add(techId);
        const fig = statementFigures(toLine(raw) as never, { cashTipsHandedOver: sched.cashTipsAlreadyPaid, priorPaidCents: priorBy.get(techId) ?? 0 }, { favourCents: reversals.get(techId)?.favourCents ?? 0 });
        const vals = statementVals(fig, raw as Row, techId);
        const cur = byTech.get(techId);
        if (!cur) { inserts.push({ techId, vals }); plans.push({ techId, statementId: null, payable: fig.approvedPayableCents, fresh: true }); continue; }
        if (cur.status !== 'draft' && cur.status !== 'ready_for_review') continue;
        let payable = fig.approvedPayableCents;
        if (cur.line_hash === vals.line_hash && n(cur.already_paid_cents) === fig.alreadyPaidCents) payable = n(cur.approved_payable_cents);
        else changed.push({ id: String(cur.id), vals });
        plans.push({ techId, statementId: String(cur.id), payable, fresh: false });
      }
      // pass 2: the new statements — one counter bump for their numbers, one multi-row insert, one event each (outbox)
      const created = new Map<string, { id: string; number: string }>();
      const numbers = await this.nextNumbers(trx, ctx.tenantId, year, inserts.length);
      const numbered = inserts.map((x, k) => ({ ...x, number: numbers[k] }));
      for (const part of chunks(numbered, 500)) {
        const rows = await trx.insertInto('payroll_statements').values(part.map((x) => ({ tenant_id: ctx.tenantId, period_id: periodId, technician_id: x.techId, branch_id: branchId, statement_number: x.number, status: 'draft', created_by: actorOf(ctx), ...x.vals })))
          .returning(['id', 'technician_id', 'statement_number']).execute();
        for (const r of rows) created.set(String(r.technician_id), { id: String(r.id), number: String(r.statement_number) });
      }
      await this.events(trx, ctx, numbered.map((x) => {
        const c = created.get(x.techId) as { id: string; number: string };
        return { type: DOMAIN_EVENTS.PAY_STATEMENT_CREATED, aggregate: { type: 'payroll_statement', id: c.id, branchId }, payload: { periodId, statementId: c.id, technicianId: x.techId, statementNumber: c.number } };
      }));
      // the changed statements — one UPDATE for all of them, each with its own figures
      const STATEMENT_FIGURES: ReadonlyArray<readonly [keyof Vals, 'bigint' | 'boolean' | 'text' | 'jsonb']> = [['service_commission_cents', 'bigint'], ['hourly_pay_cents', 'bigint'], ['salary_pay_cents', 'bigint'],
        ['tips_cents', 'bigint'], ['card_tip_cents', 'bigint'], ['cash_tip_cents', 'bigint'], ['retail_commission_cents', 'bigint'], ['bonus_cents', 'bigint'], ['guarantee_topup_cents', 'bigint'],
        ['positive_adjustments_cents', 'bigint'], ['deductions_cents', 'bigint'], ['reversals_cents', 'bigint'], ['gross_earnings_cents', 'bigint'], ['line_payable_cents', 'bigint'],
        ['refund_reversal_cents', 'bigint'], ['tip_adjustment_cents', 'bigint'], ['retail_reversal_cents', 'bigint'],
        ['already_paid_cents', 'bigint'], ['approved_payable_cents', 'bigint'], ['review_required', 'boolean'], ['line_hash', 'text'], ['branch_breakdown', 'jsonb']];
      if (changed.length) await this.bulkUpdate(trx, 'payroll_statements', ctx.tenantId, STATEMENT_FIGURES, changed.map((c) => ({ id: c.id, values: STATEMENT_FIGURES.map(([k]) => c.vals[k]) })),
        sql`version = t.version + 1, updated_at = now(), updated_by = ${actorOf(ctx)}::uuid`);
      // pass 3: every statement's payout plan, set-based
      await this.ensurePlans(trx, ctx, plans.map((x) => ({ statementId: x.statementId ?? (created.get(x.techId) as { id: string }).id, payable: x.payable, fresh: x.fresh })), policy);
      // a technician who no longer has a line this week: their draft statement is voided, never deleted
      const gone = existing.filter((s) => !seen.has(String(s.technician_id)) && (s.status === 'draft' || s.status === 'ready_for_review'));
      for (const s of gone) assertTransition(PAY_STATEMENT, String(s.status), 'voided');
      for (const ids of chunks(gone.map((s) => String(s.id)), 1000)) {
        await trx.updateTable('payroll_statements').set({ status: 'voided', voided_at: sql`now()`, void_reason: 'No earnings in this week any more', version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
      }
      await this.supersedeMany(trx, ctx, gone.map((s) => String(s.id)));
      return { statements: seen.size, technicianIds: [...seen] };
    });
  }

  // ── set-based helpers (§65: a 200-technician week is a handful of queries, never 200 query chains) ────────────────────
  /** One UPDATE for many rows that each get their OWN values: `UPDATE t SET c = v.c … FROM (VALUES …) v(id, c…)`.
   *  Columns and casts are constants of this file (never input); every value is a bound parameter; tenant-scoped. */
  private async bulkUpdate(exec: Exec, table: 'payroll_statements' | 'payroll_payout_plans' | 'payroll_payout_instructions', tenantId: string,
    cols: ReadonlyArray<readonly [string, 'text' | 'bigint' | 'boolean' | 'jsonb' | 'uuid']>, rows: Array<{ id: string; values: unknown[] }>, extra: RawBuilder<unknown> | null): Promise<void> {
    for (const part of chunks(rows, 500)) {
      const values = sql.join(part.map((r) => sql`(${sql.join([sql`${r.id}::uuid`, ...cols.map(([, type], k) => sql`${r.values[k]}::${sql.raw(type)}`)])})`));
      const sets = sql.join([...cols.map(([c]) => sql`${sql.ref(c)} = v.${sql.ref(c)}`), ...(extra ? [extra] : [])]);
      await sql`UPDATE ${sql.table(table)} AS t SET ${sets} FROM (VALUES ${values}) AS v(id, ${sql.join(cols.map(([c]) => sql.ref(c)))})
        WHERE t.tenant_id = ${tenantId} AND t.id = v.id`.execute(exec);
    }
  }
  /** the live (not superseded) plan of each statement — one query per 1000 statements */
  private async livePlansOf(exec: Exec, tenantId: string, statementIds: string[]): Promise<Map<string, Row>> {
    const out = new Map<string, Row>();
    for (const ids of chunks([...new Set(statementIds)], 1000)) {
      const rows = await exec.selectFrom('payroll_payout_plans').select([...PLAN_COLS]).where('tenant_id', '=', tenantId).where('statement_id', 'in', ids).where('status', '<>', 'superseded').execute();
      for (const r of rows) out.set(String(r.statement_id), r as Row);
    }
    return out;
  }
  /** every instruction of each plan, in sequence order — one query per 1000 plans */
  private async instructionsOfPlans(exec: Exec, tenantId: string, planIds: string[]): Promise<Map<string, Row[]>> {
    const out = new Map<string, Row[]>(planIds.map((id) => [id, [] as Row[]]));
    for (const ids of chunks([...new Set(planIds)], 1000)) {
      const rows = await exec.selectFrom('payroll_payout_instructions').select([...INSTRUCTION_COLS]).where('tenant_id', '=', tenantId).where('plan_id', 'in', ids).orderBy('plan_id').orderBy('sequence').execute();
      for (const r of rows) out.get(String(r.plan_id))?.push(r as Row);
    }
    return out;
  }
  /** Domain events of one step, written through the outbox in the same transaction (one outbox row per event) — §65: as
   *  one multi-row insert per 500 (OutboxWriter.writeAll validates every envelope first), not one insert per statement. */
  private async events(trx: Trx, ctx: PayrollContext, list: Array<{ type: DomainEventType; aggregate: { type: string; id: string; branchId?: string | null }; payload: Record<string, unknown> }>) {
    if (!this.opts.outbox || !list.length) return;
    // a structural outbox without writeAll (spec fakes) keeps the per-event writes
    if (typeof this.opts.outbox.writeAll !== 'function') { for (const e of list) await this.event(trx, ctx, e.type, e.aggregate, e.payload); return; }
    await this.opts.outbox.writeAll(trx as never, list.map((e) => this.domainEvent(ctx, e.type, e.aggregate, e.payload)));
  }

  // ── payout plans (§6–§7) ────────────────────────────────────────────────────────────────────────────────────────────
  private async livePlan(exec: Exec, tenantId: string, statementId: string): Promise<Row | null> {
    return ((await exec.selectFrom('payroll_payout_plans').select([...PLAN_COLS]).where('tenant_id', '=', tenantId).where('statement_id', '=', statementId).where('status', '<>', 'superseded').executeTakeFirst()) as Row) ?? null;
  }
  private async instructionsOf(exec: Exec, tenantId: string, planId: string): Promise<Row[]> {
    return (await exec.selectFrom('payroll_payout_instructions').select([...INSTRUCTION_COLS]).where('tenant_id', '=', tenantId).where('plan_id', '=', planId).orderBy('sequence').execute()) as Row[];
  }
  private async supersedePlans(trx: Trx, ctx: PayrollContext, statementId: string) {
    await this.supersedeMany(trx, ctx, [statementId]);
  }
  /** Supersede the live plan of each statement and cancel its still-planned instructions (two UPDATEs for the set). */
  private async supersedeMany(trx: Trx, ctx: PayrollContext, statementIds: string[], known?: Map<string, Row>) {
    if (!statementIds.length) return;
    const plans = known ?? await this.livePlansOf(trx, ctx.tenantId, statementIds);
    const live = statementIds.map((id) => plans.get(id)).filter((x): x is Row => !!x);
    if (!live.length) return;
    for (const plan of live) assertTransition(PAYOUT_PLAN, String(plan.status), 'superseded');
    const planIds = live.map((x) => String(x.id));
    for (const ids of chunks(planIds, 1000)) {
      await trx.updateTable('payroll_payout_plans').set({ status: 'superseded', version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
    }
    assertTransition(PAYOUT_INSTRUCTION, 'planned', 'canceled');
    for (const ids of chunks(planIds, 1000)) {
      await trx.updateTable('payroll_payout_instructions').set({ status: 'canceled' }).where('tenant_id', '=', ctx.tenantId).where('plan_id', 'in', ids).where('status', '=', 'planned').execute();
    }
  }
  private async writePlan(trx: Trx, ctx: PayrollContext, statementId: string, payable: number, policyType: PolicyType, ins: Instruction[], differs: boolean, reason: string | null) {
    const ids = await this.writePlans(trx, ctx, [{ statementId, payable, policyType, ins, differs, reason }]);
    return ids.get(statementId) as string;
  }
  /** New draft plans with their instructions (sequence 1…n per plan): one multi-row INSERT for the plans, one for the
   *  instructions. Returns statementId → planId. */
  private async writePlans(trx: Trx, ctx: PayrollContext, items: Array<{ statementId: string; payable: number; policyType: PolicyType; ins: Instruction[]; differs: boolean; reason: string | null }>): Promise<Map<string, string>> {
    const planIds = new Map<string, string>();
    if (!items.length) return planIds;
    for (const part of chunks(items, 500)) {
      const rows = await trx.insertInto('payroll_payout_plans').values(part.map((it) => ({ tenant_id: ctx.tenantId, statement_id: it.statementId, policy_type: it.policyType, payable_cents: it.payable, status: 'draft',
        differs_from_default: it.differs, override_reason: it.reason, created_by: actorOf(ctx), updated_by: actorOf(ctx) }))).returning(['id', 'statement_id']).execute();
      for (const r of rows) planIds.set(String(r.statement_id), String(r.id));
    }
    const instructions = items.flatMap((it) => it.ins.map((i, k) => ({ tenant_id: ctx.tenantId, plan_id: planIds.get(it.statementId) as string, statement_id: it.statementId, method: i.method,
      amount_cents: i.amountCents, basis_points: i.basisPoints, sequence: k + 1, status: 'planned' })));
    for (const part of chunks(instructions, 500)) await trx.insertInto('payroll_payout_instructions').values(part).execute();
    return planIds;
  }
  /** Keep each draft plan in step with its statement's payable: a percent-based plan is re-split exactly; a dollar plan is
   *  kept as the manager typed it (it will show UNDER / OVER_ALLOCATED until they fix it — never silently rescaled).
   *  `fresh` = the statement was just created (it has no plan yet). Set-based over the whole week. */
  private async ensurePlans(trx: Trx, ctx: PayrollContext, entries: Array<{ statementId: string; payable: number; fresh: boolean }>, policy: PayoutPolicy) {
    if (!entries.length) return;
    const existing = await this.livePlansOf(trx, ctx.tenantId, entries.filter((e) => !e.fresh).map((e) => e.statementId));
    type PlanWrite = Parameters<PayrollPaycheckService['writePlans']>[2][number];
    const writes: PlanWrite[] = [];
    const amountUpdates: Array<{ id: string; values: unknown[] }> = [];
    const resplit: Array<{ e: typeof entries[number]; plan: Row; kind: PolicyType }> = [];
    for (const e of entries) {
      const plan = e.fresh ? null : existing.get(e.statementId) ?? null;
      if (!plan) { const d = defaultInstructions(e.payable, policy); writes.push({ statementId: e.statementId, payable: e.payable, policyType: d.policyType, ins: d.instructions, differs: false, reason: null }); continue; }
      if (plan.status !== 'draft' || n(plan.payable_cents) === e.payable) continue;
      const kind = String(plan.policy_type) as PolicyType;
      if (kind === 'manual_amount') { amountUpdates.push({ id: String(plan.id), values: [e.payable] }); continue; }
      resplit.push({ e, plan, kind });
    }
    if (amountUpdates.length) await this.bulkUpdate(trx, 'payroll_payout_plans', ctx.tenantId, [['payable_cents', 'bigint']], amountUpdates, sql`version = t.version + 1, updated_at = now()`);
    if (resplit.length) {
      const old = await this.instructionsOfPlans(trx, ctx.tenantId, resplit.map((r) => String(r.plan.id)));
      await this.supersedeMany(trx, ctx, resplit.map((r) => r.e.statementId), existing);
      for (const { e, plan, kind } of resplit) {
        const prev = old.get(String(plan.id)) ?? [];
        const ins = kind === 'manual_percent' ? fitCashCap(e.payable, manualInstructions(e.payable, 'manual_percent', prev.map((i) => ({ method: String(i.method), basisPoints: n(i.basis_points) }))).instructions, policy.maxCashBp) : defaultInstructions(e.payable, policy).instructions;
        writes.push({ statementId: e.statementId, payable: e.payable, policyType: kind === 'manual_percent' ? kind : defaultInstructions(e.payable, policy).policyType, ins, differs: !!plan.differs_from_default, reason: (plan.override_reason as string) ?? null });
      }
    }
    await this.writePlans(trx, ctx, writes);
  }
  /** The manager chooses how ONE technician is paid: the salon default, all check, all cash, a percent split or dollar
   *  amounts. Validated exactly (Σ = payable, methods on, the cash cap); a split that differs from the default needs a reason
   *  and is highlighted to the owner. Only before submission. */
  async setPayoutPlan(ctx: PayrollContext, statementId: string, b: { policyType: PolicyType; entries?: Array<{ method: string; basisPoints?: number | null; amountCents?: number | null }> | null; overrideReason?: string | null; expectedVersion?: number | null }) {
    this.need(ctx, 'pos.payroll.manage');
    const out = await this.db.transaction().execute(async (trx) => {
      const st = await trx.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', statementId).forUpdate().executeTakeFirst();
      if (!st || st.status === 'voided') throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
      // §14 / §20.3: a branch manager changes only their own branch's technicians (another branch's statement is not theirs to see)
      const scope = this.branchScope(ctx);
      if (scope && !(await this.inScope(trx, ctx.tenantId, scope, st as Row))) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
      const p = await this.lockPeriod(trx, ctx, String(st.period_id));
      if (p.status !== 'draft' || (st.status !== 'draft' && st.status !== 'ready_for_review')) throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'The payout split can only change before the week is submitted. Ask the owner to return it.');
      if (b.expectedVersion != null && Number(b.expectedVersion) !== n(st.version)) throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'This statement changed. Reload it and choose the split again.');
      const sched = await this.scheduleOf(trx, ctx.tenantId);
      const policy = this.policyOf(sched);
      const payable = n(st.approved_payable_cents);
      let ins: Instruction[]; let issues: PlanIssue[] = [];
      const t = b.policyType;
      if (t === 'split_check_cash' || t === 'all_check' || t === 'all_cash') {
        ins = defaultInstructions(payable, { ...policy, defaultPolicy: t, cashEnabled: policy.cashEnabled, maxCashBp: t === 'all_cash' ? 10000 : policy.maxCashBp }).instructions;
        if (t === 'all_cash') ins = payable > 0 ? [{ method: 'cash', amountCents: payable, basisPoints: 10000 }] : [];
        if (t === 'all_check') ins = payable > 0 ? [{ method: 'check', amountCents: payable, basisPoints: 10000 }] : [];
      } else if (t === 'manual_percent' || t === 'manual_amount') {
        const m = manualInstructions(payable, t, b.entries ?? []); ins = t === 'manual_percent' ? fitCashCap(payable, m.instructions, policy.maxCashBp) : m.instructions; issues = m.issues;   // rounding never crosses the cash cap
      } else throw new PayrollError('VALIDATION_FAILED', 'Choose how this technician is paid.');
      issues = [...new Set([...issues, ...validateInstructions(payable, ins, policy, t)])];
      if (issues.length) throw new PayrollError('PAYOUT_PLAN_INVALID', PLAN_ISSUE_TEXT[issues[0]], { issues: issues.map((c) => ({ code: c, message: PLAN_ISSUE_TEXT[c] })) });
      const def = defaultInstructions(payable, policy);
      const differs = JSON.stringify(def.instructions.map((i) => [i.method, i.amountCents])) !== JSON.stringify(ins.map((i) => [i.method, i.amountCents]));
      const reason = String(b.overrideReason ?? '').trim();
      if (differs && reason.length < 3) throw new PayrollError('PAYOUT_PLAN_INVALID', 'Say why this technician is paid differently from the salon\'s default split — the owner sees it.', { issues: [{ code: 'OVERRIDE_REASON_REQUIRED', message: 'A reason is required.' }] });
      await this.supersedePlans(trx, ctx, statementId);
      const planId = await this.writePlan(trx, ctx, statementId, payable, t, ins, differs, differs ? reason.slice(0, 500) : null);
      await trx.updateTable('payroll_statements').set({ version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', '=', statementId).execute();
      return { planId, differs, ins, techId: String(st.technician_id), periodId: String(st.period_id) };
    });
    await this.audit(ctx, 'payout_plan.changed', 'payroll_statement', statementId, { policyType: b.policyType, instructions: out.ins, differsFromDefault: out.differs }, b.overrideReason ?? null, 'medium');
    return this.statement(ctx, statementId);
  }
  /** Apply the salon's default split to every draft statement of the week (the "50 / 50 for everyone" button). */
  async applyDefaultToAll(ctx: PayrollContext, periodId: string) {
    this.need(ctx, 'pos.payroll.manage');
    this.assertSalonWide(ctx, 'apply the default split to the whole salon');
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockPeriod(trx, ctx, periodId);
      if (p.status !== 'draft') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'The payout split can only change before the week is submitted.');
      const policy = this.policyOf(await this.scheduleOf(trx, ctx.tenantId));
      const sts = await trx.selectFrom('payroll_statements').select(['id', 'approved_payable_cents', 'status']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', 'in', ['draft', 'ready_for_review']).execute();
      // set-based: supersede every live plan of the week (2 UPDATEs), then one insert of the new plans + their instructions
      await this.supersedeMany(trx, ctx, sts.map((s) => String(s.id)));
      await this.writePlans(trx, ctx, sts.map((s) => {
        const d = defaultInstructions(n(s.approved_payable_cents), policy);
        return { statementId: String(s.id), payable: n(s.approved_payable_cents), policyType: d.policyType, ins: d.instructions, differs: false, reason: null };
      }));
    });
    await this.audit(ctx, 'payout_plan.default_applied', 'payroll_period', periodId, {}, null, 'medium');
    return this.periodStatements(ctx, periodId);
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  private toStatement(s: Row, names: Map<string, string>, opts: { includeNote: boolean; branchOnly?: string[] | null }): StatementView {
    let bd = (Array.isArray(s.branch_breakdown) ? s.branch_breakdown : JSON.parse(String(s.branch_breakdown ?? '[]'))) as StatementView['branchBreakdown'];
    if (opts.branchOnly) { const only = opts.branchOnly; bd = bd.filter((b) => !!b.branchId && only.includes(b.branchId)); }
    return {
      id: String(s.id), periodId: String(s.period_id), technicianId: String(s.technician_id), technicianName: names.get(String(s.technician_id)) ?? null, statementNumber: String(s.statement_number),
      status: String(s.status), reviewRequired: !!s.review_required, version: n(s.version),
      serviceCommissionCents: n(s.service_commission_cents), hourlyPayCents: n(s.hourly_pay_cents), salaryPayCents: n(s.salary_pay_cents), tipsCents: n(s.tips_cents), cardTipCents: n(s.card_tip_cents),
      cashTipCents: n(s.cash_tip_cents), retailCommissionCents: n(s.retail_commission_cents), bonusCents: n(s.bonus_cents), guaranteeTopUpCents: n(s.guarantee_topup_cents),
      positiveAdjustmentsCents: n(s.positive_adjustments_cents), deductionsCents: n(s.deductions_cents), reversalsCents: n(s.reversals_cents), grossEarningsCents: n(s.gross_earnings_cents),
      refundReversalCents: n(s.refund_reversal_cents), tipAdjustmentCents: n(s.tip_adjustment_cents), retailReversalCents: n(s.retail_reversal_cents),
      linePayableCents: n(s.line_payable_cents), alreadyPaidCents: n(s.already_paid_cents), approvedPayableCents: n(s.approved_payable_cents), paidCents: n(s.paid_cents),
      unpaidCents: Math.max(0, n(s.approved_payable_cents) - n(s.paid_cents)), branchBreakdown: bd,
      ...(opts.includeNote ? { managerNote: (s.manager_note as string) ?? null } : {}),
      submittedAt: iso(s.submitted_at), approvedAt: iso(s.approved_at), approvedBy: (s.approved_by as string) ?? null, lockedAt: iso(s.locked_at), voidedAt: iso(s.voided_at), createdAt: iso(s.created_at),
    };
  }
  private async planView(exec: Exec, tenantId: string, statementId: string, payable: number, policy: PayoutPolicy): Promise<PlanView | null> {
    return (await this.planViews(exec, tenantId, [{ id: statementId, payable }], policy)).get(statementId) ?? null;
  }
  /** The plan views of many statements: two queries for the whole week (live plans, then their instructions). */
  private async planViews(exec: Exec, tenantId: string, statements: Array<{ id: string; payable: number }>, policy: PayoutPolicy): Promise<Map<string, PlanView>> {
    const plans = await this.livePlansOf(exec, tenantId, statements.map((s) => s.id));
    const ins = await this.instructionsOfPlans(exec, tenantId, [...plans.values()].map((p) => String(p.id)));
    const out = new Map<string, PlanView>();
    for (const s of statements) {
      const plan = plans.get(s.id);
      if (plan) out.set(s.id, this.planViewOf(plan, ins.get(String(plan.id)) ?? [], s.payable, policy));
    }
    return out;
  }
  private planViewOf(plan: Row, ins: Row[], payable: number, policy: PayoutPolicy): PlanView {
    const live = ins.filter((i) => i.status !== 'canceled').map((i) => ({ method: String(i.method) as InstructionMethod, amountCents: n(i.amount_cents), basisPoints: i.basis_points == null ? null : n(i.basis_points) }));
    const issues = plan.status === 'draft' ? validateInstructions(payable, live, policy, String(plan.policy_type) as PolicyType) : [];
    return { id: String(plan.id), policyType: String(plan.policy_type) as PolicyType, payableCents: n(plan.payable_cents), status: String(plan.status), differsFromDefault: !!plan.differs_from_default,
      overrideReason: (plan.override_reason as string) ?? null, version: n(plan.version),
      instructions: ins.map((i) => ({ id: String(i.id), method: String(i.method), amountCents: n(i.amount_cents), basisPoints: i.basis_points == null ? null : n(i.basis_points), sequence: n(i.sequence), status: String(i.status), payoutId: (i.payout_id as string) ?? null })),
      issues: issues.map((c) => ({ code: c, message: PLAN_ISSUE_TEXT[c] })) };
  }
  private async names(exec: Exec, tenantId: string, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await exec.selectFrom('technicians').select(['id', 'full_name']).where('tenant_id', '=', tenantId).where('id', 'in', [...new Set(ids)]).execute();
    return new Map(rows.map((r) => [String(r.id), String(r.full_name ?? '')]));
  }
  /** §14: running payroll (payroll.manage) and approving it (payroll.approve) are salon-wide keys — those people see the
   *  consolidated statement. Someone who may only VIEW payroll (a branch-scoped key) sees the statements of technicians
   *  who work at their branch (home branch, or earnings there this week), and only their branch's contribution detail. */
  private branchScope(ctx: PayrollContext): string[] | null {
    if (hasPermission(ctx as never, 'payroll.approve')) return null;
    const confined = ctx.authz?.scope === 'BRANCH' || ctx.authz?.scope === 'SELECTED_BRANCHES';
    if (hasPermission(ctx as never, 'payroll.manage')) {
      // §14.3 / §16.6 / §24.2: a MANAGER whose role template confines them to a branch (or a set of branches) sees and
      // changes only those branches' contribution; a salon-wide manager sees the consolidated statement
      if (!confined) return null;
      const ids = (ctx.authz?.branchIds ?? []).filter((b): b is string => !!b);
      if (ids.length) return ids;
      return ctx.branchId ? [ctx.branchId] : [];
    }
    if (confined && ctx.authz?.branchIds?.length) return ctx.authz.branchIds.filter((b): b is string => !!b);
    return ctx.branchId ? [ctx.branchId] : null;
  }
  /** Oct 28 2026 (Weekly Paycheck mandate audit, §14.3 / §16.6 / §20.3 / §24.2): the branches a payout MUTATION is confined
   *  to. Only an actor whose role template confines them (BRANCH / SELECTED_BRANCHES — e.g. BRANCH_MANAGER, who inherits
   *  payroll.issue_check / payroll.cash_handoff) is limited; an approver or a salon-wide role acts salon-wide as before. */
  private payoutScope(ctx: PayrollContext): string[] | null {
    if (hasPermission(ctx as never, 'payroll.approve')) return null;
    const confined = ctx.authz?.scope === 'BRANCH' || ctx.authz?.scope === 'SELECTED_BRANCHES';
    if (!confined) return null;
    const ids = (ctx.authz?.branchIds ?? []).filter((b): b is string => !!b);
    return ids.length ? ids : ctx.branchId ? [ctx.branchId] : [];
  }
  /** a payout / statement outside the actor's branches answers exactly like one that does not exist (no leak) */
  private async assertStatementInPayoutScope(exec: Exec, ctx: PayrollContext, statementId: string, notFound: () => PayrollError): Promise<void> {
    const scope = this.payoutScope(ctx);
    if (!scope) return;
    const st = (await exec.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', statementId).executeTakeFirst()) as Row | undefined;
    if (!st || !(await this.inScope(exec, ctx.tenantId, scope, st))) throw notFound();
  }
  private async inScope(exec: Exec, tenantId: string, scope: string[], s: Row, homes?: Map<string, string | null>): Promise<boolean> {
    if (!scope.length) return false;
    if (s.branch_id && scope.includes(String(s.branch_id))) return true;
    if (((s.branch_breakdown ?? []) as Array<{ branchId: string | null }>).some((b) => !!b.branchId && scope.includes(b.branchId))) return true;
    const home = homes ? homes.get(String(s.technician_id)) : (await exec.selectFrom('technicians').select('branch_id').where('tenant_id', '=', tenantId).where('id', '=', String(s.technician_id)).executeTakeFirst())?.branch_id;
    return !!home && scope.includes(String(home));
  }

  /** The manager's / owner's week: every statement with its plan, payouts and the totals by method (§8–§9). */
  async periodStatements(ctx: PayrollContext, periodId: string) {
    this.need(ctx, 'pos.payroll.view');
    const p = await this.db.selectFrom('payroll_periods').select([...PERIOD_VIEW_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId).executeTakeFirst();
    if (!p) throw new PayrollError('PAYROLL_PERIOD_NOT_FOUND', 'That pay period could not be found.');
    const sched = await this.scheduleOf(this.db, ctx.tenantId);
    const policy = this.policyOf(sched);
    const rows = (await this.db.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '<>', 'voided').orderBy('approved_payable_cents', 'desc').execute()) as Row[];
    const scope = this.branchScope(ctx);
    let visible = rows;
    if (scope) {
      const homes = new Map((rows.length ? await this.db.selectFrom('technicians').select(['id', 'branch_id']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', rows.map((r) => String(r.technician_id))).execute() : []).map((t) => [String(t.id), (t.branch_id as string) ?? null]));
      const keep: Row[] = [];
      for (const r of rows) if (await this.inScope(this.db, ctx.tenantId, scope, r, homes)) keep.push(r);
      visible = keep;
    }
    const names = await this.names(this.db, ctx.tenantId, visible.map((s) => String(s.technician_id)));
    const payouts = (await this.db.selectFrom('payroll_payouts').select([...PAYOUT_SELECT]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).orderBy('created_at').execute()) as Row[];
    const statements = [];
    const totals = { technicians: 0, grossEarningsCents: 0, alreadyPaidCents: 0, payableCents: 0, checkCents: 0, cashCents: 0, otherCents: 0, paidCents: 0, unpaidCents: 0, exceptions: 0, overrides: 0 };
    // §65: every statement's plan + instructions in two queries, payouts grouped once (no per-statement reads)
    const views = visible.map((s) => this.toStatement(s, names, { includeNote: true, branchOnly: scope }));
    const plans = await this.planViews(this.db, ctx.tenantId, views.map((st) => ({ id: st.id, payable: st.approvedPayableCents })), policy);
    const payoutsBy = new Map<string, PayoutView[]>();
    for (const x of payouts) if (x.statement_id != null) { const k = String(x.statement_id); const l = payoutsBy.get(k) ?? []; l.push(toPayoutView(x)); payoutsBy.set(k, l); }
    for (const st of views) {
      const plan = plans.get(st.id) ?? null;
      const mine = payoutsBy.get(st.id) ?? [];
      statements.push({ ...st, plan, payouts: mine });
      totals.technicians++; totals.grossEarningsCents += st.grossEarningsCents; totals.alreadyPaidCents += st.alreadyPaidCents; totals.payableCents += st.approvedPayableCents;
      totals.paidCents += st.paidCents; totals.unpaidCents += st.unpaidCents;
      for (const i of plan?.instructions.filter((x) => x.status !== 'canceled') ?? []) { if (i.method === 'check') totals.checkCents += i.amountCents; else if (i.method === 'cash') totals.cashCents += i.amountCents; else totals.otherCents += i.amountCents; }
      if (st.reviewRequired || (plan?.issues.length ?? 0) > 0) totals.exceptions++;
      if (plan?.differsFromDefault) totals.overrides++;
    }
    // the previous week, for the owner's "changes from prior week"
    const prev = await this.db.selectFrom('payroll_periods').select(['id', 'total_payable_cents']).where('tenant_id', '=', ctx.tenantId).where('period_end', '<', p.period_start).orderBy('period_end', 'desc').limit(1).executeTakeFirst();
    return {
      period: { id: String(p.id), label: p.label ?? null, periodStart: ymdOf(p.period_start), periodEnd: ymdOf(p.period_end), payDate: p.pay_date ? ymdOf(p.pay_date) : null, status: String(p.status),
        payoutStatus: String(p.payout_status), version: n(p.version), submittedBy: p.submitted_by ?? null, submittedAt: iso(p.submitted_at), ownerDecision: p.owner_decision ?? null,
        ownerNote: p.owner_note ?? null, approvedBy: p.approved_by ?? null, approvalHash: p.approval_hash ?? null, previewHash: p.preview_hash ?? null, branchScope: scope ? scope.join(',') : null,
        canceledAt: iso(p.canceled_at), cancelReason: (p.cancel_reason as string) ?? null },
      statements, totals, previousPayableCents: prev ? n(prev.total_payable_cents) : null, schedule: sched,
    };
  }
  /** §66/§67 (M5 pilot, Oct 24 2026): the week as the owner / manager reviews it — every statement carries its exceptions
   *  (its own figures + the week's LAST stored validation; this read never re-validates), and the list can be narrowed to
   *  the exceptions only, a technician (name / statement number) or a branch. The totals stay the WHOLE week's (approve
   *  acts on the whole week); `view` says how many matched. */
  async reviewWeek(ctx: PayrollContext, periodId: string, f: WeekReviewFilter = {}) {
    const week = await this.periodStatements(ctx, periodId);
    const stored = await this.db.selectFrom('payroll_periods').select(['validation_json']).where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId).executeTakeFirst();
    const raw = (stored as { validation_json?: unknown } | undefined)?.validation_json;
    const validation = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { issues?: Array<{ code: string; severity: string; message: string; count: number; technicianIds?: string[] }>; checkedAt?: string } | null;
    const issues = validation?.issues ?? [];
    const ids = week.statements.map((s) => s.technicianId);
    const homes = f.branchId && ids.length
      ? new Map((await this.db.selectFrom('technicians').select(['id', 'branch_id']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute()).map((t) => [String(t.id), (t.branch_id as string | null) ?? null]))
      : new Map<string, string | null>();
    const decorated = week.statements.map((s) => ({ ...s, exceptions: statementExceptions({ technicianId: s.technicianId, reviewRequired: s.reviewRequired, planIssues: s.plan?.issues.length ?? 0,
      bonusCents: s.bonusCents, positiveAdjustmentsCents: s.positiveAdjustmentsCents, deductionsCents: s.deductionsCents }, issues) }));
    const statements = decorated.filter((s) => matchesWeekFilter(s, homes.get(s.technicianId) ?? null, f));
    return { ...week, statements, view: { exceptionsOnly: !!f.exceptionsOnly, search: f.search?.trim() || null, branchId: f.branchId || null, matched: statements.length, total: decorated.length,
      withExceptions: decorated.filter((s) => s.exceptions.length > 0).length, validatedAt: validation?.checkedAt ?? null,
      periodIssues: issues.filter((i) => !(i.technicianIds ?? []).length).map((i) => ({ code: i.code, severity: i.severity, message: i.message, count: i.count })) } };
  }
  async statement(ctx: PayrollContext, statementId: string) {
    this.need(ctx, 'pos.payroll.view');
    const s = (await this.db.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', statementId).executeTakeFirst()) as Row | undefined;
    if (!s) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
    const scope = this.branchScope(ctx);
    if (scope && !(await this.inScope(this.db, ctx.tenantId, scope, s))) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
    const names = await this.names(this.db, ctx.tenantId, [String(s.technician_id)]);
    const policy = this.policyOf(await this.scheduleOf(this.db, ctx.tenantId));
    const st = this.toStatement(s, names, { includeNote: true, branchOnly: scope });
    const payouts = (await this.db.selectFrom('payroll_payouts').select([...PAYOUT_SELECT]).where('tenant_id', '=', ctx.tenantId).where('statement_id', '=', statementId).orderBy('created_at').execute()) as Row[];
    return { ...st, plan: await this.planView(this.db, ctx.tenantId, statementId, st.approvedPayableCents, policy), payouts: payouts.map(toPayoutView) };
  }

  // ── manager submit (§8) ─────────────────────────────────────────────────────────────────────────────────────────────
  /** The manager submits the week to the Owner App: blocking exceptions, a negative payable, a statement out of step with
   *  its line or a payout split that does not equal the payable stop it. Submitting twice is one submission. */
  async submit(ctx: PayrollContext, periodId: string, b: { expectedVersion?: number | null } = {}) {
    this.need(ctx, 'pos.payroll.manage');
    this.assertSalonWide(ctx, 'submit the salon\'s payroll');
    const p0 = await this.lockPeriod(this.db, ctx, periodId);
    if (p0.status === 'canceled') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'This pay period was canceled.');
    if (p0.status === 'review' && p0.submitted_at) return { ...(await this.periodStatements(ctx, periodId)), alreadySubmitted: true };
    if (p0.status !== 'draft' && p0.status !== 'review') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'This week is already approved.');
    if (b.expectedVersion != null && Number(b.expectedVersion) !== n(p0.version)) throw new PayrollError('PAYROLL_VERSION_CONFLICT', 'Someone else changed this week. Reload it and review the latest figures.', { currentVersion: n(p0.version) });
    // the statements must exist and match the lines exactly (no recalculation at submit — the manager submits what they saw)
    const lines = await this.db.selectFrom('payroll_lines').select([...LINE_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).execute();
    const sts = await this.db.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', 'in', ['draft', 'ready_for_review']).execute();
    const stBy = new Map(sts.map((s) => [String(s.technician_id), s]));
    const stale = lines.filter((l) => stBy.get(String(l.technician_id))?.line_hash !== this.lineHash(l as Row)).map((l) => String(l.technician_id));
    if (!lines.length) throw new PayrollError('PAYROLL_SUBMIT_BLOCKED', 'There is nothing to submit — calculate the week first.', { issues: [{ code: 'NO_LINES', message: 'No technician earnings in this week.' }] });
    if (stale.length) throw new PayrollError('PAYROLL_SUBMIT_BLOCKED', 'The earnings changed since the statements were made. Recalculate, review and submit again.', { issues: [{ code: 'STATEMENTS_OUT_OF_DATE', message: 'Recalculate the week.', technicianIds: stale }] });
    const policy = this.policyOf(await this.scheduleOf(this.db, ctx.tenantId));
    const issues: Array<{ code: string; message: string; technicianIds?: string[] }> = [];
    const negative = sts.filter((s) => s.review_required).map((s) => String(s.technician_id));
    if (negative.length) issues.push({ code: 'NEGATIVE_PAYABLE', message: 'A technician owes more than they earned this week. Review the deductions before paying.', technicianIds: negative });
    const badPlans: string[] = [];
    const pvs = await this.planViews(this.db, ctx.tenantId, sts.map((s) => ({ id: String(s.id), payable: n(s.approved_payable_cents) })), policy);
    for (const s of sts) {
      const pv = pvs.get(String(s.id));
      if (!pv || pv.issues.length || pv.payableCents !== n(s.approved_payable_cents)) badPlans.push(String(s.technician_id));
    }
    if (badPlans.length) issues.push({ code: 'PAYOUT_SPLIT_MISMATCH', message: 'The payout split is not equal to the amount payable.', technicianIds: badPlans });
    const v = await this.opts.workflow.validate(ctx, periodId);
    for (const i of v.issues.filter((x) => x.severity === 'blocking')) issues.push({ code: i.code, message: i.message, technicianIds: i.technicianIds });
    if (issues.length) throw new PayrollError('PAYROLL_SUBMIT_BLOCKED', 'Payroll still has problems that must be fixed before it can go to the owner.', { issues });
    await this.opts.workflow.prepare(ctx, periodId, { expectedVersion: n(p0.version), rebuild: false, validated: v });
    const submitted = await this.db.transaction().execute(async (trx) => {
      const p = await this.lockPeriod(trx, ctx, periodId);
      if (p.submitted_at && p.status === 'review') return null;   // a concurrent submit already did it
      const rows = await trx.selectFrom('payroll_statements').select(['id', 'status']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', 'in', ['draft', 'ready_for_review']).execute();
      // set-based: every statement → submitted (one UPDATE), every draft plan → submitted (one UPDATE)
      for (const s of rows) assertTransition(PAY_STATEMENT, String(s.status), 'submitted');
      const ids = rows.map((s) => String(s.id));
      for (const part of chunks(ids, 1000)) {
        await trx.updateTable('payroll_statements').set({ status: 'submitted', submitted_at: sql`now()`, version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', part).execute();
      }
      const draftPlans = [...(await this.livePlansOf(trx, ctx.tenantId, ids)).values()].filter((plan) => plan.status === 'draft').map((plan) => String(plan.id));
      if (draftPlans.length) assertTransition(PAYOUT_PLAN, 'draft', 'submitted');
      for (const part of chunks(draftPlans, 1000)) {
        await trx.updateTable('payroll_payout_plans').set({ status: 'submitted', submitted_by: actorOf(ctx), version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', part).execute();
      }
      await trx.updateTable('payroll_periods').set({ submitted_by: actorOf(ctx), submitted_at: sql`now()`, owner_decision: null, owner_note: null, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId).execute();
      return { branchId: (p.branch_id as string) ?? null };
    });
    const view = await this.periodStatements(ctx, periodId);
    if (submitted) {
      await this.db.transaction().execute(async (trx) => {
        await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_SUBMITTED_TO_OWNER, { type: 'payroll_period', id: periodId, branchId: submitted.branchId }, {
          periodId, technicians: view.totals.technicians, totalPayableCents: view.totals.payableCents, checkCents: view.totals.checkCents, cashCents: view.totals.cashCents, otherCents: view.totals.otherCents,
          overrides: view.totals.overrides, periodStart: view.period.periodStart, periodEnd: view.period.periodEnd, technicianIds: view.statements.map((s) => s.technicianId) });
      });
      await this.audit(ctx, 'period.submitted', 'payroll_period', periodId, { totals: view.totals });
      await this.notify(ctx.tenantId, { owner: true }, { title: 'Payroll approval required', kind: 'payroll_submitted', data: { periodId },
        body: `${view.period.periodStart} – ${view.period.periodEnd}: ${view.totals.technicians} technicians are ready for your approval.` });
    }
    return { ...view, alreadySubmitted: !submitted };
  }

  // ── owner decision (§9) ─────────────────────────────────────────────────────────────────────────────────────────────
  /** APPROVE ALL / APPROVE SELECTED (hold the rest). Step-up is enforced by the route; separation of duties in onApproved. */
  async approve(ctx: PayrollContext, periodId: string, b: { expectedVersion?: number | null; calculationHash?: string | null; holdTechnicianIds?: string[] | null } = {}) {
    this.need(ctx, 'payroll.approve');
    // Deep-scan (Oct 22 2026, extended pilot day): a week the manager never submitted — e.g. one with no statements at all —
    // fell through to the one-step approve and was FINALIZED empty (locked against its own adjustments). The weekly
    // paycheck is approved only after the manager submits it (the week is in review); a repeat on an approved week replays.
    const st = String((await this.lockPeriod(this.db, ctx, periodId)).status);
    if (st === 'draft') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'The manager has not submitted this week yet — there is nothing to approve.');
    const waiting = (await this.db.selectFrom('payroll_statements').select('technician_id').where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '=', 'submitted').execute()).map((r) => String(r.technician_id));
    try { await this.opts.workflow.approve(ctx, periodId, { expectedVersion: b.expectedVersion, calculationHash: b.calculationHash, holdTechnicianIds: b.holdTechnicianIds ?? [] }); }
    catch (e) {
      // approve ×N = one approval, one materialisation: a repeat (or the loser of a simultaneous approve) answers with the
      // approved week; a real change by someone else stays a conflict
      const done = e instanceof PayrollError && (e.code === 'PAYROLL_PERIOD_ALREADY_APPROVED'
        || (e.code === 'PAYROLL_VERSION_CONFLICT' && ['finalized', 'paid'].includes(String((await this.lockPeriod(this.db, ctx, periodId)).status))));
      if (!done) throw e;
    }
    const nowApproved = (await this.db.selectFrom('payroll_statements').select('technician_id').where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', 'in', APPROVED_STATEMENT).where('technician_id', 'in', waiting.length ? waiting : ['00000000-0000-0000-0000-000000000000']).execute()).map((r) => String(r.technician_id));
    if (nowApproved.length) await this.notify(ctx.tenantId, { technicianIds: nowApproved }, { title: 'Your pay statement is ready', body: 'This week\'s pay was approved — open Payroll to see your statement and how you are paid.', kind: 'pay_statement_ready', data: { periodId } });
    return this.periodStatements(ctx, periodId);
  }
  /** RETURN FOR CHANGES / REJECT: the owner's note is required; the week goes back to the manager (statements → draft). */
  async decide(ctx: PayrollContext, periodId: string, decision: 'returned' | 'rejected', b: { note: string; expectedVersion?: number | null }) {
    this.need(ctx, 'payroll.approve');
    const note = String(b.note ?? '').trim();
    if (note.length < 3) throw new PayrollError('VALIDATION_FAILED', decision === 'rejected' ? 'Say why this payroll is rejected.' : 'Tell the manager what to change.');
    const before = await this.db.selectFrom('payroll_periods').select(['submitted_by']).where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId).executeTakeFirst();
    await this.opts.workflow.sendBack(ctx, periodId, { reason: note, expectedVersion: b.expectedVersion, ownerDecision: decision });
    await this.notify(ctx.tenantId, { userIds: [before?.submitted_by] }, { title: decision === 'rejected' ? 'Payroll rejected' : 'Payroll returned for changes', body: 'Open Payroll to see the owner\'s note.', kind: `payroll_${decision}`, data: { periodId } });
    return this.periodStatements(ctx, periodId);
  }
  /** Approve ONE held statement later (the owner held it while approving the week). */
  async approveHeld(ctx: PayrollContext, statementId: string) {
    this.need(ctx, 'payroll.approve');
    await this.db.transaction().execute(async (trx) => {
      const s = await trx.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', statementId).forUpdate().executeTakeFirst();
      if (!s) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
      if (s.status !== 'held') return;
      const p = await this.lockPeriod(trx, ctx, String(s.period_id));
      if (p.status !== 'finalized' && p.status !== 'paid') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'Approve the week first.');
      await this.assertNotSelf(trx, ctx, p, [String(s.technician_id)]);
      await this.lockAndMaterialize(trx, ctx, p, s as Row);
      await this.recomputePeriod(trx, ctx, String(s.period_id));
    });
    await this.audit(ctx, 'statement.approved', 'payroll_statement', statementId, {});
    const held = await this.db.selectFrom('payroll_statements').select(['technician_id', 'period_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', statementId).executeTakeFirst();
    if (held) await this.notify(ctx.tenantId, { technicianIds: [String(held.technician_id)] }, { title: 'Your pay statement is ready', body: 'Your pay was approved — open Payroll to see your statement.', kind: 'pay_statement_ready', data: { periodId: String(held.period_id) } });
    return this.statement(ctx, statementId);
  }
  /** §16 separation of duties: the person approving may not be paid on this payroll (unless they are the salon's owner),
   *  and a delegated approver may not approve what they submitted themselves. */
  private async assertNotSelf(trx: Exec, ctx: PayrollContext, p: Row, technicianIds: string[]) {
    // the salon's account owner (tenants.owner_user_id — an identity, not a role name) approves their own payroll by definition
    const owner = await trx.selectFrom('tenants').select('owner_user_id').where('id', '=', ctx.tenantId).executeTakeFirst();
    if (owner?.owner_user_id && ctx.userId && owner.owner_user_id === ctx.userId) return;
    const mine = await this.technicianOfUser(trx, ctx.tenantId, ctx.userId);
    if (mine && technicianIds.includes(mine)) throw new PayrollError('PAYROLL_SELF_APPROVAL', 'You are paid on this payroll, so you cannot approve it. Ask the owner.');
    if (p.submitted_by && p.submitted_by === ctx.userId) throw new PayrollError('PAYROLL_SELF_APPROVAL', 'You submitted this payroll, so someone else must approve it.');
  }

  // ── workflow hooks (run INSIDE the workflow's transaction) ──────────────────────────────────────────────────────────
  async usesStatements(trx: Trx, ctx: PayrollContext, periodId: string): Promise<boolean> {
    const r = await trx.selectFrom('payroll_statements').select('id').where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '<>', 'voided').limit(1).executeTakeFirst();
    return !!r;
  }
  async onApproved(trx: Trx, ctx: PayrollContext, p: Row, opts: { holdTechnicianIds?: string[] }): Promise<void> {
    // every statement of the week locked in ONE select, in id order (a stable lock order — no deadlock between two writers)
    const sts = (await trx.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', String(p.id)).where('status', '<>', 'voided').orderBy('id').forUpdate().execute()) as Row[];
    if (!sts.length) return;   // a week without statements (the older one-step flow) approves as before
    const unsubmitted = sts.filter((s) => s.status === 'draft' || s.status === 'ready_for_review');
    if (unsubmitted.length) throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'The manager has not submitted this week yet — the owner approves what the manager submitted.');
    await this.assertNotSelf(trx, ctx, p, sts.map((s) => String(s.technician_id)));
    const hold = new Set(opts.holdTechnicianIds ?? []);
    const submitted = sts.filter((s) => s.status === 'submitted');
    const held = submitted.filter((s) => hold.has(String(s.technician_id)));
    if (held.length) assertTransition(PAY_STATEMENT, 'submitted', 'held');
    for (const ids of chunks(held.map((s) => String(s.id)), 1000)) {
      await trx.updateTable('payroll_statements').set({ status: 'held', version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
    }
    await this.lockAndMaterializeMany(trx, ctx, p, submitted.filter((s) => !hold.has(String(s.technician_id))));
    await trx.updateTable('payroll_periods').set({ owner_decision: 'approved', owner_decided_by: actorOf(ctx), owner_decided_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', String(p.id)).execute();
    await this.recomputePeriod(trx, ctx, String(p.id));
  }
  /** APPROVED + LOCKED, the plan approved, and one payout per instruction (idempotent per instruction). */
  private async lockAndMaterialize(trx: Trx, ctx: PayrollContext, p: Row, s: Row) {
    await this.lockAndMaterializeMany(trx, ctx, p, [s]);
  }
  /** Set-based over the week: the statements → approved → locked (two UPDATEs, the same two steps the immutability trigger
   *  sees per row), their plans → approved (one UPDATE), one payout per planned instruction (one multi-row idempotent
   *  INSERT + one read-back + one UPDATE of the instructions), then one PAYOUT_PLANNED event per statement. */
  private async lockAndMaterializeMany(trx: Trx, ctx: PayrollContext, p: Row, sts: Row[]) {
    if (!sts.length) return;
    for (const s of sts) assertTransition(PAY_STATEMENT, String(s.status), 'approved');
    assertTransition(PAY_STATEMENT, 'approved', 'locked');
    const ids = sts.map((s) => String(s.id));
    for (const part of chunks(ids, 1000)) {
      await trx.updateTable('payroll_statements').set({ status: 'approved', approved_at: sql`now()`, approved_by: actorOf(ctx), updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', part).execute();
    }
    for (const part of chunks(ids, 1000)) {
      await trx.updateTable('payroll_statements').set({ status: 'locked', locked_at: sql`now()`, version: sql`version + 1` }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', part).execute();
    }
    const plans = await this.livePlansOf(trx, ctx.tenantId, ids);
    for (const plan of plans.values()) assertTransition(PAYOUT_PLAN, String(plan.status), 'approved');
    const planIds = [...plans.values()].map((plan) => String(plan.id));
    for (const part of chunks(planIds, 1000)) {
      await trx.updateTable('payroll_payout_plans').set({ status: 'approved', approved_by: actorOf(ctx), version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', part).execute();
    }
    const ins = await this.instructionsOfPlans(trx, ctx.tenantId, planIds);
    const work: Array<{ s: Row; i: Row }> = [];
    for (const s of sts) { const plan = plans.get(String(s.id)); if (plan) for (const i of ins.get(String(plan.id)) ?? []) if (i.status === 'planned') work.push({ s, i }); }
    await this.materializeMany(trx, ctx, p, work);
    await this.events(trx, ctx, sts.map((s) => ({ type: DOMAIN_EVENTS.PAYOUT_PLANNED, aggregate: { type: 'payroll_statement', id: String(s.id), branchId: (p.branch_id as string) ?? null },
      payload: { periodId: String(p.id), statementId: String(s.id), technicianId: String(s.technician_id), statementNumber: String(s.statement_number) } })));
  }
  private async materialize(trx: Trx, ctx: PayrollContext, p: Row, s: Row, i: Row): Promise<string> {
    return (await this.materializeMany(trx, ctx, p, [{ s, i }]))[0];
  }
  /** One payout per instruction, idempotent per instruction (key stmt:<statement>:instr:<sequence>): a retried approve
   *  inserts nothing new and links the same payouts. Returns the payout id of each item, in order. */
  private async materializeMany(trx: Trx, ctx: PayrollContext, p: Row, work: Array<{ s: Row; i: Row }>): Promise<string[]> {
    if (!work.length) return [];
    const items = work.map(({ s, i }) => ({ s, i, method: PAYOUT_METHOD[String(i.method) as InstructionMethod] ?? 'other', key: `stmt:${s.id}:instr:${i.sequence}` }));
    if (!PAYROLL_PAYOUT.initial?.includes('pending')) throw new PayrollError('VALIDATION_FAILED', 'A payout starts pending.');
    if (items.some((x) => x.method === 'check') && !CHECK_PAYOUT.initial?.includes('planned')) throw new PayrollError('VALIDATION_FAILED', 'A check starts planned.');
    if (items.some((x) => x.method === 'cash') && !CASH_PAYOUT.initial?.includes('planned')) throw new PayrollError('VALIDATION_FAILED', 'Cash starts planned.');
    for (const part of chunks(items, 500)) {
      await trx.insertInto('payroll_payouts').values(part.map(({ s, i, method, key }) => ({ tenant_id: ctx.tenantId, branch_id: (p.branch_id as string) ?? null, period_id: String(p.id), technician_id: String(s.technician_id), amount_cents: n(i.amount_cents),
        method, status: 'pending', statement_id: String(s.id), instruction_id: String(i.id), check_status: method === 'check' ? 'planned' : null, cash_status: method === 'cash' ? 'planned' : null,
        idempotency_key: key, created_by: actorOf(ctx), updated_by: actorOf(ctx) }))).onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing()).execute();
    }
    const byKey = new Map<string, string>();
    for (const keys of chunks(items.map((x) => x.key), 1000)) {
      for (const r of await trx.selectFrom('payroll_payouts').select(['id', 'idempotency_key']).where('tenant_id', '=', ctx.tenantId).where('idempotency_key', 'in', keys).execute()) byKey.set(String(r.idempotency_key), String(r.id));
    }
    const ids = items.map((x) => {
      const id = byKey.get(x.key);
      if (!id) throw new PayrollError('VALIDATION_FAILED', 'A payout could not be recorded for this statement.');
      assertTransition(PAYOUT_INSTRUCTION, String(x.i.status), 'materialized');
      return id;
    });
    await this.bulkUpdate(trx, 'payroll_payout_instructions', ctx.tenantId, [['payout_id', 'uuid']], items.map((x, k) => ({ id: String(x.i.id), values: [ids[k]] })), sql`status = ${'materialized'}`);
    return ids;
  }
  async onSentBack(trx: Trx, ctx: PayrollContext, p: Row): Promise<void> {
    const sts = await trx.selectFrom('payroll_statements').select(['id', 'status']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', String(p.id)).where('status', 'in', ['submitted', 'held']).execute();
    // set-based: the statements → draft (one UPDATE), their submitted plans → draft (one UPDATE)
    for (const s of sts) assertTransition(PAY_STATEMENT, String(s.status), 'draft');
    const ids = sts.map((s) => String(s.id));
    for (const part of chunks(ids, 1000)) {
      await trx.updateTable('payroll_statements').set({ status: 'draft', submitted_at: null, version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', part).execute();
    }
    const back = [...(await this.livePlansOf(trx, ctx.tenantId, ids)).values()].filter((plan) => plan.status === 'submitted').map((plan) => String(plan.id));
    if (back.length) assertTransition(PAYOUT_PLAN, 'submitted', 'draft');
    for (const part of chunks(back, 1000)) {
      await trx.updateTable('payroll_payout_plans').set({ status: 'draft', version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', part).execute();
    }
    await trx.updateTable('payroll_periods').set({ submitted_at: null }).where('tenant_id', '=', ctx.tenantId).where('id', '=', String(p.id)).execute();
  }
  /** Reopening an approved week (no payout in motion — the workflow refuses otherwise): the statements are VOIDED (kept,
   *  never deleted), their planned payouts canceled; the next submission makes new statements with new numbers. */
  async onReopened(trx: Trx, ctx: PayrollContext, p: Row): Promise<void> {
    const pos = await trx.selectFrom('payroll_payouts').select(['id', 'status', 'check_status', 'cash_status']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', String(p.id)).where('status', 'in', ['pending', 'processing']).execute();
    // validate every payout first (the same refusals), then cancel them set-based: one UPDATE per lifecycle shape
    const groups: Record<'check' | 'cash' | 'plain', string[]> = { check: [], cash: [], plain: [] };
    for (const x of pos) {
      if (x.check_status && x.check_status !== 'planned') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'A check has already been issued for this week. Void it before reopening.');
      if (x.cash_status && x.cash_status !== 'planned') throw new PayrollError('PAYROLL_PERIOD_LOCKED', 'Cash has already been prepared for this week. Cancel it before reopening.');
      assertTransition(PAYROLL_PAYOUT, String(x.status), 'canceled');
      if (x.check_status) assertTransition(CHECK_PAYOUT, String(x.check_status), 'voided');
      if (x.cash_status) assertTransition(CASH_PAYOUT, String(x.cash_status), 'canceled');
      groups[x.check_status ? 'check' : x.cash_status ? 'cash' : 'plain'].push(String(x.id));
    }
    for (const [shape, all] of Object.entries(groups) as Array<['check' | 'cash' | 'plain', string[]]>) for (const ids of chunks(all, 1000)) {
      await trx.updateTable('payroll_payouts').set({ status: 'canceled', check_status: shape === 'check' ? 'voided' : null, cash_status: shape === 'cash' ? 'canceled' : null, check_void_reason: shape === 'check' ? 'Week reopened' : null,
        failure_reason: 'Week reopened before payment', version: sql`version + 1`, updated_by: actorOf(ctx), updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
    }
    const sts = await trx.selectFrom('payroll_statements').select(['id', 'status']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', String(p.id)).where('status', '<>', 'voided').execute();
    for (const s of sts) assertTransition(PAY_STATEMENT, String(s.status), 'voided');
    const stIds = sts.map((s) => String(s.id));
    for (const ids of chunks(stIds, 1000)) {
      await trx.updateTable('payroll_statements').set({ status: 'voided', voided_at: sql`now()`, void_reason: 'Week reopened', version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
    }
    const plans = [...(await this.livePlansOf(trx, ctx.tenantId, stIds)).values()];
    for (const plan of plans) assertTransition(PAYOUT_PLAN, String(plan.status), 'superseded');
    const planIds = plans.map((plan) => String(plan.id));
    for (const ids of chunks(planIds, 1000)) {
      await trx.updateTable('payroll_payout_plans').set({ status: 'superseded', version: sql`version + 1`, updated_at: sql`now()`, updated_by: actorOf(ctx) }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
    }
    const open = [...(await this.instructionsOfPlans(trx, ctx.tenantId, planIds)).values()].flat().filter((i) => i.status !== 'canceled');
    for (const i of open) assertTransition(PAYOUT_INSTRUCTION, String(i.status), 'canceled');
    for (const ids of chunks(open.map((i) => String(i.id)), 1000)) {
      await trx.updateTable('payroll_payout_instructions').set({ status: 'canceled' }).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute();
    }
    const cur = await trx.selectFrom('payroll_periods').select('payout_status').where('tenant_id', '=', ctx.tenantId).where('id', '=', String(p.id)).executeTakeFirst();
    if (cur && cur.payout_status !== 'none') {
      assertTransition(PERIOD_PAYOUT, String(cur.payout_status), 'none');
      await trx.updateTable('payroll_periods').set({ payout_status: 'none', submitted_at: null, owner_decision: null }).where('tenant_id', '=', ctx.tenantId).where('id', '=', String(p.id)).execute();
    }
  }

  // ── paid / unpaid (§13) ─────────────────────────────────────────────────────────────────────────────────────────────
  private async recomputeStatement(trx: Trx, ctx: PayrollContext, statementId: string): Promise<void> {
    await this.recomputeStatements(trx, ctx, [statementId]);
  }
  /** recomputeStatement for many statements at once: ONE `select … for update` of the set in id order, ONE read of their
   *  payouts, ONE UPDATE of the statements whose status / paid amount moved — the same rule, row by row, in memory. */
  private async recomputeStatements(trx: Trx, ctx: PayrollContext, statementIds: string[]): Promise<void> {
    if (!statementIds.length) return;
    const changes: Array<{ id: string; values: unknown[] }> = [];
    for (const ids of chunks([...new Set(statementIds)].sort(), 1000)) {
      const locked = await trx.selectFrom('payroll_statements').select(['id', 'status', 'approved_payable_cents', 'paid_cents', 'technician_id', 'period_id']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).orderBy('id').forUpdate().execute();
      const pos = await trx.selectFrom('payroll_payouts').select(['statement_id', 'amount_cents', 'status', 'check_status', 'cash_status']).where('tenant_id', '=', ctx.tenantId).where('statement_id', 'in', ids).execute();
      const byStatement = new Map<string, typeof pos>();
      for (const x of pos) { const k = String(x.statement_id); const l = byStatement.get(k) ?? []; l.push(x); byStatement.set(k, l); }
      for (const s of locked) {
        if (!APPROVED_STATEMENT.includes(String(s.status))) continue;
        const mine = byStatement.get(String(s.id)) ?? [];
        const paid = mine.filter((x) => x.status === 'paid').reduce((a, x) => a + n(x.amount_cents), 0);
        const moving = mine.some((x) => (x.check_status && ['issued'].includes(String(x.check_status))) || (x.cash_status && ['ready_for_handoff', 'handed_off', 'disputed'].includes(String(x.cash_status))) || x.status === 'processing');
        const to = statementPaymentStatus(n(s.approved_payable_cents), paid, moving);
        if (paid > n(s.approved_payable_cents)) throw new PayrollError('PAYOUT_EXCEEDS_PAYABLE', 'Payouts would exceed the approved payable.');
        if (to !== s.status) assertTransition(PAY_STATEMENT, String(s.status), to);
        if (to !== s.status || paid !== n(s.paid_cents)) changes.push({ id: String(s.id), values: [to, paid] });
        // §17.7 (Kevin's decision, Oct 28 2026): the technician is told when a statement becomes fully PAID — after the commit
        if (to === 'paid' && s.status !== 'paid') this.paidNotices(trx).push({ technicianId: String(s.technician_id), statementId: String(s.id), periodId: String(s.period_id) });
      }
    }
    if (changes.length) await this.bulkUpdate(trx, 'payroll_statements', ctx.tenantId, [['status', 'text'], ['paid_cents', 'bigint']], changes, sql`version = t.version + 1, updated_at = now(), updated_by = ${actorOf(ctx)}::uuid`);
  }
  private async recomputePeriod(trx: Trx, ctx: PayrollContext, periodId: string): Promise<void> {
    const p = await this.lockPeriod(trx, ctx, periodId);
    const sts = await trx.selectFrom('payroll_statements').select(['id', 'status', 'approved_payable_cents', 'paid_cents']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '<>', 'voided').execute();
    await this.recomputeStatements(trx, ctx, sts.filter((s) => APPROVED_STATEMENT.includes(String(s.status))).map((s) => String(s.id)));
    const fresh = await trx.selectFrom('payroll_statements').select(['status', 'approved_payable_cents', 'paid_cents']).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '<>', 'voided').execute();
    const to = periodPayoutStatus(fresh.map((s) => ({ status: String(s.status), approvedPayableCents: n(s.approved_payable_cents), paidCents: n(s.paid_cents) })));
    const from = String(p.payout_status);
    if (to === from) return;
    assertTransition(PERIOD_PAYOUT, from, to);
    await trx.updateTable('payroll_periods').set({ payout_status: to, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId).execute();
    const techIds = (await trx.selectFrom('payroll_statements').select('technician_id').where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('status', '<>', 'voided').execute()).map((r) => String(r.technician_id));
    // Oct 28 2026 decision: a paid week whose payout is voided later is NOT paid any more — back to finalized (still approved,
    // still locked), so the week list, the owner summary and the next payout all see what is owed again
    const reverted = p.status === 'paid' && to !== 'paid';
    if (reverted) {
      // the ONE system move out of paid (the machine requires a permission no role holds), only when the payouts no longer
      // cover the week; conditional on the locked row
      assertTransition(PAYROLL_PERIOD, 'paid', 'finalized', { permissions: ['system.payroll.payout_reversal'] });
      await trx.updateTable('payroll_periods').set({ status: 'finalized', paid_at: null, paid_by: null, version: sql`version + 1`, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId).where('status', '=', 'paid').execute();
    }
    if (to === 'partially_paid' || (reverted && to === 'unpaid')) await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PARTIALLY_PAID, { type: 'payroll_period', id: periodId, branchId: (p.branch_id as string) ?? null }, { periodId, status: to, technicianIds: techIds, ...(reverted ? { previousStatus: 'paid', periodStatus: 'finalized' } : {}) });
    if (to === 'paid' && p.status === 'finalized') {
      // every required payout is complete: the week itself is PAID (the one place, besides the older settle-all, that does it)
      assertTransition(PAYROLL_PERIOD, 'finalized', 'paid');
      await trx.updateTable('payroll_periods').set({ status: 'paid', paid_at: sql`now()`, paid_by: actorOf(ctx), version: sql`version + 1`, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId).execute();
      await this.event(trx, ctx, DOMAIN_EVENTS.PAYROLL_PERIOD_PAID, { type: 'payroll_period', id: periodId, branchId: (p.branch_id as string) ?? null }, { periodId, status: 'paid', previousStatus: 'finalized', technicianIds: techIds });
    }
  }

  // ── payouts: check lifecycle (§10) ──────────────────────────────────────────────────────────────────────────────────
  private async withPayout<T>(ctx: PayrollContext, payoutId: string, perm: string, fn: (trx: Trx, x: Row, p: Row, sched: PayrollScheduleView) => Promise<T>, opts: { technicianId?: string } = {}): Promise<T> {
    if (perm) this.need(ctx, perm);
    let notices: Array<{ technicianId: string; statementId: string; periodId: string }> | undefined;
    const out = await this.db.transaction().execute(async (trx) => {
      const x = (await trx.selectFrom('payroll_payouts').select([...PAYOUT_SELECT]).where('tenant_id', '=', ctx.tenantId).where('id', '=', payoutId).forUpdate().executeTakeFirst()) as Row | undefined;
      if (!x || (opts.technicianId && x.technician_id !== opts.technicianId)) throw new PayrollError('RESOURCE_NOT_FOUND', 'That payout could not be found.');
      if (!x.statement_id) throw new PayrollError('PAYOUT_INVALID_STATE', 'This payout is not part of a pay statement.');
      // the technician's own steps (acknowledge / dispute) are bound to the technician; every other payout step by a
      // branch-confined actor is confined to their branches' technicians (it was salon-wide: void / prepare / hand-off)
      if (!opts.technicianId) await this.assertStatementInPayoutScope(trx, ctx, String(x.statement_id), () => new PayrollError('RESOURCE_NOT_FOUND', 'That payout could not be found.'));
      const p = await this.lockPeriod(trx, ctx, String(x.period_id));
      if (p.status !== 'finalized' && p.status !== 'paid') throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'The owner has not approved this week yet.');
      const r = await fn(trx, x, p, await this.scheduleOf(trx, ctx.tenantId));
      await this.recomputeStatement(trx, ctx, String(x.statement_id));
      await this.recomputePeriod(trx, ctx, String(x.period_id));
      notices = this.justPaid.get(trx);
      return r;
    });
    await this.sendPaidNotices(ctx, notices);   // only after the commit: a rolled-back payment tells no one
    return out;
  }
  private async setPayout(trx: Trx, ctx: PayrollContext, x: Row, patch: Record<string, unknown>, to: { status?: string; check?: string; cash?: string }) {
    if (to.status && to.status !== x.status) assertTransition(PAYROLL_PAYOUT, String(x.status), to.status);
    if (to.check && to.check !== x.check_status) assertTransition(CHECK_PAYOUT, String(x.check_status), to.check);
    if (to.cash && to.cash !== x.cash_status) assertTransition(CASH_PAYOUT, String(x.cash_status), to.cash);
    await trx.updateTable('payroll_payouts').set({ ...patch, ...(to.status ? { status: to.status } : {}), ...(to.check ? { check_status: to.check } : {}), ...(to.cash ? { cash_status: to.cash } : {}),
      ...(to.status === 'paid' && x.status !== 'paid' ? { paid_at: sql`now()` } : {}), version: sql`version + 1`, updated_by: actorOf(ctx), updated_at: sql`now()` } as never)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', String(x.id)).execute();
  }
  private payoutEvent(trx: Trx, ctx: PayrollContext, type: DomainEventType, x: Row, extra: Record<string, unknown> = {}) {
    return this.event(trx, ctx, type, { type: 'payroll_payout', id: String(x.id), branchId: (x.branch_id as string) ?? null },
      { payoutId: String(x.id), periodId: String(x.period_id), statementId: String(x.statement_id), technicianId: String(x.technician_id), method: String(x.method), ...extra });
  }
  private checkNumberOf(v: unknown): string {
    const s = String(v ?? '').trim();
    if (!/^[A-Za-z0-9-]{1,20}$/.test(s)) throw new PayrollError('VALIDATION_FAILED', 'Enter the check number (letters, digits or dashes).');
    return s;
  }
  private async uniqueCheck<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e) { if (String((e as { code?: string })?.code) === '23505' && /check_number/.test(String((e as Error).message))) throw new PayrollError('CHECK_NUMBER_IN_USE', 'That check number is already used on another live check.'); throw e; }
  }
  /** Issue (print / hand-write) the check: its number is recorded; a retry with the same number is the same issue. */
  async issueCheck(ctx: PayrollContext, payoutId: string, b: { checkNumber: string }) {
    const num = this.checkNumberOf(b.checkNumber);
    const out = await this.uniqueCheck(() => this.withPayout(ctx, payoutId, 'payroll.issue_check', async (trx, x) => {
      if (x.method !== 'check') throw new PayrollError('PAYOUT_INVALID_STATE', 'This payout is not a check.');
      if (x.check_status === 'issued' && x.check_number === num) return { replay: true };
      if (x.check_status !== 'planned') throw new PayrollError('PAYOUT_INVALID_STATE', `This check is already ${x.check_status}.`);
      await this.setPayout(trx, ctx, x, { check_number: num, check_issued_at: sql`now()`, check_issued_by: actorOf(ctx) }, { check: 'issued' });
      await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CHECK_ISSUED, x, { checkNumber: num });
      return { replay: false };
    }));
    if (!out.replay) await this.audit(ctx, 'check.issued', 'payroll_payout', payoutId, { checkNumber: num });
    return this.payout(ctx, payoutId);
  }
  /** Handed to the technician — a delivered check counts as PAID for payroll (bank clearance stays separate, §10). */
  async deliverCheck(ctx: PayrollContext, payoutId: string) {
    await this.withPayout(ctx, payoutId, 'payroll.issue_check', async (trx, x) => {
      if (x.check_status === 'delivered' || x.check_status === 'cleared') return;
      if (x.check_status !== 'issued') throw new PayrollError('PAYOUT_INVALID_STATE', 'Issue the check (with its number) before delivering it.');
      await this.setPayout(trx, ctx, x, { check_delivered_at: sql`now()` }, { check: 'delivered', status: payoutStatusForCheck('delivered') });
      await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CHECK_DELIVERED, x, { checkNumber: x.check_number });
    });
    await this.audit(ctx, 'check.delivered', 'payroll_payout', payoutId, {});
    return this.payout(ctx, payoutId);
  }
  async clearCheck(ctx: PayrollContext, payoutId: string) {
    await this.withPayout(ctx, payoutId, 'payroll.issue_check', async (trx, x) => {
      if (x.check_status === 'cleared') return;
      if (x.check_status !== 'delivered') throw new PayrollError('PAYOUT_INVALID_STATE', 'Only a delivered check can clear the bank.');
      await this.setPayout(trx, ctx, x, { check_cleared_at: sql`now()` }, { check: 'cleared' });
    });
    await this.audit(ctx, 'check.cleared', 'payroll_payout', payoutId, {}, null, 'medium');
    return this.payout(ctx, payoutId);
  }
  /** Void a check (lost, misprinted) or record it RETURNED by the bank. It stays in history; a replacement check (new number)
   *  references the original. Without a replacement the amount is unpaid again and shows on the statement. */
  async voidCheck(ctx: PayrollContext, payoutId: string, b: { reason: string; returned?: boolean | null; replacementCheckNumber?: string | null }) {
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw new PayrollError('VALIDATION_FAILED', 'Say why the check is voided.');
    const repl = b.replacementCheckNumber ? this.checkNumberOf(b.replacementCheckNumber) : null;
    const out = await this.uniqueCheck(() => this.withPayout(ctx, payoutId, 'payroll.issue_check', async (trx, x) => {
      if (x.method !== 'check') throw new PayrollError('PAYOUT_INVALID_STATE', 'This payout is not a check.');
      const to = b.returned ? 'returned' : 'voided';
      if (x.check_status === to) return { replacementId: null as string | null };
      await this.setPayout(trx, ctx, x, { check_voided_at: sql`now()`, check_void_reason: reason.slice(0, 300), failure_reason: `Check ${to}: ${reason}`.slice(0, 300) }, { check: to, status: 'canceled' });
      await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CHECK_VOIDED, x, { checkNumber: x.check_number, returned: !!b.returned });
      let replacementId: string | null = null;
      if (repl) {
        const ins = await trx.insertInto('payroll_payouts').values({ tenant_id: ctx.tenantId, branch_id: (x.branch_id as string) ?? null, period_id: String(x.period_id), technician_id: String(x.technician_id),
          amount_cents: n(x.amount_cents), method: 'check', status: 'pending', statement_id: String(x.statement_id), instruction_id: (x.instruction_id as string) ?? null, check_status: 'issued', check_number: repl,
          check_issued_at: sql`now()`, check_issued_by: actorOf(ctx), replaces_payout_id: String(x.id), idempotency_key: `replace:${x.id}`, created_by: actorOf(ctx), updated_by: actorOf(ctx) } as never)
          .onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing()).returning('id').executeTakeFirst();
        replacementId = ins ? String(ins.id) : null;
        if (replacementId && x.instruction_id) await trx.updateTable('payroll_payout_instructions').set({ payout_id: replacementId }).where('tenant_id', '=', ctx.tenantId).where('id', '=', String(x.instruction_id)).execute();
        if (replacementId) await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CHECK_ISSUED, { ...x, id: replacementId }, { checkNumber: repl, replacesPayoutId: String(x.id) });
      }
      return { replacementId };
    }));
    await this.audit(ctx, b.returned ? 'check.returned' : 'check.voided', 'payroll_payout', payoutId, { replacementCheckNumber: repl, replacementPayoutId: out.replacementId }, reason);
    return { voided: await this.payout(ctx, payoutId), replacement: out.replacementId ? await this.payout(ctx, out.replacementId) : null };
  }

  // ── payouts: cash lifecycle (§11–§12) ───────────────────────────────────────────────────────────────────────────────
  /** Prepare the cash: from which source; from a register drawer it is a linked PAYROLL_CASH_PAYOUT movement (never a
   *  silent negative drawer — INSUFFICIENT_CASH). Prepared cash is NOT paid. */
  async prepareCash(ctx: PayrollContext, payoutId: string, b: { cashSource: string; registerId?: string | null; branchId?: string | null }) {
    const source = String(b.cashSource ?? '');
    if (!(CASH_SOURCES as readonly string[]).includes(source)) throw new PayrollError('VALIDATION_FAILED', 'Choose where the cash comes from: the register drawer, the safe, a bank withdrawal or another recorded source.');
    await this.withPayout(ctx, payoutId, 'payroll.cash_handoff', async (trx, x) => {
      if (x.method !== 'cash') throw new PayrollError('PAYOUT_INVALID_STATE', 'This payout is not cash.');
      if (x.cash_status === 'ready_for_handoff' && x.cash_source === source) return;
      if (x.cash_status !== 'planned') throw new PayrollError('PAYOUT_INVALID_STATE', `This cash payout is already ${String(x.cash_status).replace(/_/g, ' ')}.`);
      let movementId: string | null = null; let register: string | null = null;
      if (source === 'register_drawer') {
        if (!this.cashDrawer) throw new PayrollError('SERVICE_UNAVAILABLE', 'The register drawer is not available on this server. Choose another cash source.');
        const branchId = (x.branch_id as string) ?? b.branchId ?? ctx.branchId ?? null;
        if (!branchId) throw new PayrollError('VALIDATION_FAILED', 'Choose the branch whose drawer the cash comes from.');
        register = String(b.registerId ?? 'main').slice(0, 40);
        // Oct 28 2026 (mandate audit §12.3 / §20.4 "no silent negative drawer"): two payouts prepared at once from the same
        // drawer both read the balance before either withdrew and could take it negative. One preparation per drawer at a
        // time: this transaction-scoped lock is held until commit, so the next one reads the drawer WITH this withdrawal.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll_drawer:${ctx.tenantId}:${branchId}:${register}`}, 0))`.execute(trx);
        const available = await this.cashDrawer.availableCents(ctx, { branchId, registerId: register });
        if (available < n(x.amount_cents)) throw new PayrollError('INSUFFICIENT_CASH', 'There is not enough cash in that drawer for this payout.', { availableCents: available, requiredCents: n(x.amount_cents) });
        const name = await this.names(trx, ctx.tenantId, [String(x.technician_id)]);
        movementId = (await this.cashDrawer.withdraw(trx, ctx, { branchId, registerId: register, amountCents: n(x.amount_cents), payoutId: String(x.id), idempotencyKey: `payroll_cash:${x.id}`, note: `Payroll cash — ${name.get(String(x.technician_id)) ?? 'technician'}` })).movementId;
      }
      await this.setPayout(trx, ctx, x, { cash_source: source, cash_register_id: register, cash_prepared_by: actorOf(ctx), cash_prepared_at: sql`now()`, drawer_movement_id: movementId }, { cash: 'ready_for_handoff' });
      await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CASH_READY, x, { cashSource: source });
    });
    await this.audit(ctx, 'cash.prepared', 'payroll_payout', payoutId, { cashSource: source, registerId: b.registerId ?? null });
    const prepared = await this.payout(ctx, payoutId);
    await this.notify(ctx.tenantId, { technicianIds: [prepared.technicianId] }, { title: 'Your cash pay is ready', body: 'Your cash pay is ready. Confirm in the app when you receive it.', kind: 'payroll_cash_ready', data: { payoutId } });
    return prepared;
  }
  /** The manager hands the envelope over. Paid only once the technician confirms (unless the salon counts a handoff as paid). */
  async handOffCash(ctx: PayrollContext, payoutId: string, b: { deviceId?: string | null } = {}) {
    await this.withPayout(ctx, payoutId, 'payroll.cash_handoff', async (trx, x, _p, sched) => {
      if (x.cash_status === 'handed_off' || x.cash_status === 'acknowledged') return;
      if (x.cash_status !== 'ready_for_handoff') throw new PayrollError('PAYOUT_INVALID_STATE', 'Prepare the cash before handing it over.');
      await this.setPayout(trx, ctx, x, { cash_handed_off_by: actorOf(ctx), cash_handed_off_at: sql`now()`, device_id: b.deviceId ? String(b.deviceId).slice(0, 80) : null }, { cash: 'handed_off', status: payoutStatusForCash('handed_off', sched.cashPaidOn) });
      await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CASH_HANDED_OFF, x, {});
    });
    await this.audit(ctx, 'cash.handed_off', 'payroll_payout', payoutId, { deviceId: b.deviceId ?? null });
    return this.payout(ctx, payoutId);
  }
  /** At the POS: the technician types their 4-digit PIN on the manager's device to confirm they received the cash. */
  async acknowledgeCashByPin(ctx: PayrollContext, payoutId: string, b: { pin: string; deviceId?: string | null }) {
    await this.verifyTechnicianPin(ctx, payoutId, b.pin);
    return this.acknowledge(ctx, payoutId, 'technician_pin', b.deviceId ?? null, null);
  }
  /** In the Tech App: the technician confirms their own cash (session-resolved technician — never another's). With the
   *  QR handoff token the manager's screen showed (§11.5), the confirmation also proves the technician stood at the
   *  desk: the token must match the payout's live token (hash) and not have expired. */
  async acknowledgeCashByTechnician(ctx: PayrollContext, technicianId: string, payoutId: string, b: { handoffCode?: string | null } = {}) {
    const token = String(b.handoffCode ?? '').trim();
    if (!token) return this.acknowledge(ctx, payoutId, 'technician_app', null, technicianId);
    const x0 = (await this.db.selectFrom('payroll_payouts').select(['cash_handoff_token_hash', 'cash_handoff_token_expires_at', 'cash_status']).where('tenant_id', '=', ctx.tenantId).where('id', '=', payoutId).where('technician_id', '=', technicianId).executeTakeFirst()) as Row | undefined;
    if (!x0) throw new PayrollError('RESOURCE_NOT_FOUND', 'That payout could not be found.');
    if (x0.cash_status === 'acknowledged') return this.payout(ctx, payoutId, technicianId);   // a retried confirmation is one confirmation
    const now = this.opts.now ? this.opts.now() : new Date();
    const live = !!x0.cash_handoff_token_hash && !!x0.cash_handoff_token_expires_at && new Date(x0.cash_handoff_token_expires_at as string).getTime() > now.getTime();
    if (!live || this.tokenHash(token) !== String(x0.cash_handoff_token_hash)) throw new PayrollError('HANDOFF_TOKEN_INVALID', 'That handoff code is not valid any more — ask the manager to show a new one, or confirm without it.');
    return this.acknowledge(ctx, payoutId, 'qr_handoff', null, technicianId);
  }
  private tokenHash(token: string): string { return createHash('sha256').update(token.trim().toUpperCase()).digest('hex'); }
  /** §11.5 QR handoff: the manager's screen shows a short-lived code (as a QR and as text) for ONE cash payout; the Tech App
   *  presents it with the technician's own confirmation. Only the hash is stored; a new code replaces the old one. */
  async issueHandoffToken(ctx: PayrollContext, payoutId: string): Promise<{ payoutId: string; handoffCode: string; expiresAt: string }> {
    const token = randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
    const now = this.opts.now ? this.opts.now() : new Date();
    const expiresAt = new Date(now.getTime() + CASH_HANDOFF_TOKEN_TTL_MS);
    await this.withPayout(ctx, payoutId, 'payroll.cash_handoff', async (trx, x) => {
      if (x.method !== 'cash') throw new PayrollError('PAYOUT_INVALID_STATE', 'This payout is not cash.');
      if (!['ready_for_handoff', 'handed_off', 'disputed'].includes(String(x.cash_status))) throw new PayrollError('PAYOUT_INVALID_STATE', 'Prepare the cash before showing a handoff code.');
      await trx.updateTable('payroll_payouts').set({ cash_handoff_token_hash: this.tokenHash(token), cash_handoff_token_expires_at: expiresAt, updated_by: actorOf(ctx), updated_at: sql`now()` } as never)
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', String(x.id)).execute();
    });
    await this.audit(ctx, 'cash.handoff_token_issued', 'payroll_payout', payoutId, { expiresAt: expiresAt.toISOString() }, null, 'medium');
    return { payoutId, handoffCode: token, expiresAt: expiresAt.toISOString() };
  }
  /** §11.5 signature: on the manager's device the technician types their PIN AND signs; the strokes are kept with the payout. */
  async acknowledgeCashBySignature(ctx: PayrollContext, payoutId: string, b: { pin: string; signature: string; deviceId?: string | null }) {
    if (!validSignaturePath(b.signature)) throw new PayrollError('VALIDATION_FAILED', 'Ask the technician to sign in the box (a signature is needed).');
    await this.verifyTechnicianPin(ctx, payoutId, b.pin);
    return this.acknowledge(ctx, payoutId, 'signature', b.deviceId ?? null, null, { cash_ack_signature: b.signature.trim() });
  }
  /** §11.5 manager + technician dual confirmation: the manager's FRESH step-up (the route) and the technician's PIN on
   *  the same device, both recorded — the manager as the co-confirmer. */
  async acknowledgeCashDual(ctx: PayrollContext, payoutId: string, b: { pin: string; deviceId?: string | null }) {
    await this.verifyTechnicianPin(ctx, payoutId, b.pin);
    return this.acknowledge(ctx, payoutId, 'manager_dual', b.deviceId ?? null, null, { cash_ack_confirmed_by: actorOf(ctx) });
  }
  /** the technician's 4-digit PIN (TechnicianClockPinService, with its lockout) proves the technician for a cash confirmation */
  private async verifyTechnicianPin(ctx: PayrollContext, payoutId: string, pin: string) {
    this.need(ctx, 'payroll.cash_handoff');
    const x0 = await this.db.selectFrom('payroll_payouts').select(['technician_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', payoutId).executeTakeFirst();
    if (!x0) throw new PayrollError('RESOURCE_NOT_FOUND', 'That payout could not be found.');
    if (!this.opts.pins) throw new PayrollError('SERVICE_UNAVAILABLE', 'PIN confirmation is not available on this server — ask the technician to confirm in the Tech App.');
    let v: { ok: boolean; reason?: string };
    try { v = await this.opts.pins.verifyPin({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null }, String(x0.technician_id), String(pin ?? '')); }
    catch (e) {
      // the clock PIN's own lockout (too many wrong tries) applies here too — never a way around it
      if (e instanceof ClockPinLockedError) throw new PayrollError('PIN_INVALID', 'Too many wrong PIN tries — the PIN is locked for a while. The technician can confirm in the Tech App.', { locked: true });
      throw e;
    }
    if (!v.ok) throw new PayrollError('PIN_INVALID', v.reason === 'no_pin' ? 'This technician has no PIN yet — set one, or confirm in the Tech App.' : 'That PIN did not match.');
  }
  private async acknowledge(ctx: PayrollContext, payoutId: string, method: CashAckMethod, deviceId: string | null, technicianId: string | null, extra: Record<string, unknown> = {}) {
    const byManager = method === 'technician_pin' || method === 'signature' || method === 'manager_dual';
    await this.withPayout(ctx, payoutId, '', async (trx, x) => {
      if (x.cash_status === 'acknowledged') return;   // a retried confirmation is one confirmation
      if (!['ready_for_handoff', 'handed_off', 'disputed'].includes(String(x.cash_status))) throw new PayrollError('PAYOUT_INVALID_STATE', 'There is no cash waiting for this technician.');
      await this.setPayout(trx, ctx, x, { cash_acknowledged_at: sql`now()`, cash_ack_method: method, cash_handed_off_at: x.cash_handed_off_at ? (x.cash_handed_off_at as never) : sql`now()`,
        cash_handed_off_by: x.cash_handed_off_by ?? (byManager ? actorOf(ctx) : null), cash_handoff_token_hash: null, cash_handoff_token_expires_at: null,
        ...(deviceId ? { device_id: deviceId.slice(0, 80) } : {}), ...extra }, { cash: 'acknowledged', status: 'paid' });
      await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CASH_ACKNOWLEDGED, x, { ackMethod: method });
    }, technicianId ? { technicianId } : {});
    await this.audit(ctx, 'cash.acknowledged', 'payroll_payout', payoutId, { method, technicianId, ...(method === 'manager_dual' ? { coConfirmedBy: actorOf(ctx) } : {}) });
    return this.payout(ctx, payoutId, technicianId);
  }
  /** The technician says the cash is wrong / not received. The owner is alerted; the manager re-hands or cancels it. */
  async disputeCash(ctx: PayrollContext, technicianId: string, payoutId: string, b: { reason: string }) {
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw new PayrollError('VALIDATION_FAILED', 'Tell the manager what is wrong.');
    await this.withPayout(ctx, payoutId, '', async (trx, x) => {
      if (x.cash_status === 'disputed') return;
      if (x.cash_status !== 'handed_off') throw new PayrollError('PAYOUT_INVALID_STATE', 'Only cash that was handed to you can be disputed.');
      // a salon that counts a handoff as paid keeps the payout paid, flagged as an exception on the owner dashboard
      await this.setPayout(trx, ctx, x, { cash_dispute_reason: reason.slice(0, 500) }, { cash: 'disputed', ...(x.status === 'paid' ? {} : { status: 'processing' }) });
      await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CASH_DISPUTED, x, {});
    }, { technicianId });
    await this.audit(ctx, 'cash.disputed', 'payroll_payout', payoutId, { technicianId }, reason);
    await this.notify(ctx.tenantId, { owner: true }, { title: 'Cash payout disputed', body: 'A technician reported a problem with their payroll cash. Open Payroll to see it.', kind: 'payroll_cash_disputed', data: { payoutId } });
    return this.payout(ctx, payoutId, technicianId);
  }
  /** Re-hand a disputed envelope, or cancel the cash (planned / prepared / disputed): a drawer withdrawal is reversed and
   *  the amount is unpaid again — it never counts as paid. */
  async resolveCash(ctx: PayrollContext, payoutId: string, b: { action: 'rehandoff' | 'cancel'; reason: string }) {
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw new PayrollError('VALIDATION_FAILED', 'Give a reason.');
    await this.withPayout(ctx, payoutId, 'payroll.cash_handoff', async (trx, x) => {
      if (b.action === 'rehandoff') {
        if (x.cash_status !== 'disputed') throw new PayrollError('PAYOUT_INVALID_STATE', 'Only disputed cash can be handed over again.');
        // Oct 28 2026 (mandate audit §11.4 / §20.4): in a salon where a hand-off counts as PAID, a re-hand-off moved the cash
        // back to "ready" but left the payout PAID — cash nobody held counted as paid. A paid payout cannot go back to
        // processing, so here the envelope is canceled (the amount is unpaid again) and a new cash payout is prepared.
        if (x.status === 'paid') throw new PayrollError('PAYOUT_INVALID_STATE', 'In this salon a handed-over envelope counts as paid. Cancel this cash payout (the amount becomes unpaid again), then prepare a new cash payout for the technician.', { action: 'cancel_then_add_payout' });
        await this.setPayout(trx, ctx, x, { cash_handed_off_at: null, cash_handed_off_by: null, note: reason.slice(0, 500) }, { cash: 'ready_for_handoff' });   // stays 'processing' until the technician confirms
        await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CASH_READY, x, { reprepared: true });
        return;
      }
      if (x.cash_status === 'canceled') return;
      if (!['planned', 'ready_for_handoff', 'disputed'].includes(String(x.cash_status))) throw new PayrollError('PAYOUT_INVALID_STATE', 'Cash that was handed over cannot be canceled — dispute it first.');
      if (x.drawer_movement_id && this.cashDrawer) await this.cashDrawer.reverse(trx, ctx, String(x.drawer_movement_id));
      await this.setPayout(trx, ctx, x, { failure_reason: `Cash canceled: ${reason}`.slice(0, 300) }, { cash: 'canceled', status: 'canceled' });
      await this.payoutEvent(trx, ctx, DOMAIN_EVENTS.PAYOUT_CANCELED, x, {});
    });
    await this.audit(ctx, b.action === 'cancel' ? 'cash.canceled' : 'cash.rehandoff', 'payroll_payout', payoutId, {}, reason);
    return this.payout(ctx, payoutId);
  }
  /** After a canceled cash payout or a voided check: plan the statement's still-uncommitted amount again (by check or cash). */
  async addPayout(ctx: PayrollContext, statementId: string, b: { method: 'check' | 'cash'; amountCents?: number | null }) {
    // whoever may pay out by that method may re-plan the unpaid remainder by it (never more than is still owed)
    this.need(ctx, b.method === 'cash' ? 'payroll.cash_handoff' : 'payroll.issue_check');
    let addNotices: Array<{ technicianId: string; statementId: string; periodId: string }> | undefined;
    const id = await this.db.transaction().execute(async (trx) => {
      const s = (await trx.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', statementId).forUpdate().executeTakeFirst()) as Row | undefined;
      if (!s || !APPROVED_STATEMENT.includes(String(s.status))) throw new PayrollError('STATEMENT_NOT_FOUND', 'Only an approved statement can get another payout.');
      await this.assertStatementInPayoutScope(trx, ctx, statementId, () => new PayrollError('STATEMENT_NOT_FOUND', 'Only an approved statement can get another payout.'));
      const p = await this.lockPeriod(trx, ctx, String(s.period_id));
      const sched = await this.scheduleOf(trx, ctx.tenantId);
      if (!sched.allowedMethods.includes(b.method) || (b.method === 'cash' && !sched.cashEnabled)) throw new PayrollError('PAYOUT_PLAN_INVALID', 'That payout method is not turned on for this salon.');
      const live = await trx.selectFrom('payroll_payouts').select(['amount_cents']).where('tenant_id', '=', ctx.tenantId).where('statement_id', '=', statementId).where('status', 'not in', ['failed', 'canceled']).execute();
      const headroom = n(s.approved_payable_cents) - live.reduce((a, x) => a + n(x.amount_cents), 0);
      const amount = b.amountCents == null ? headroom : Math.round(Number(b.amountCents));
      if (!Number.isInteger(amount) || amount <= 0 || amount > headroom) throw new PayrollError('PAYOUT_EXCEEDS_PAYABLE', 'That is more than this technician is still owed (or nothing is left to pay).', { headroomCents: headroom });
      const plan = await this.livePlan(trx, ctx.tenantId, statementId);
      if (!plan) throw new PayrollError('PAYOUT_INVALID_STATE', 'This statement has no approved payout plan.');
      const seq = (await this.instructionsOf(trx, ctx.tenantId, String(plan.id))).reduce((a, i) => Math.max(a, n(i.sequence)), 0) + 1;
      const ins = await trx.insertInto('payroll_payout_instructions').values({ tenant_id: ctx.tenantId, plan_id: String(plan.id), statement_id: statementId, method: b.method, amount_cents: amount, basis_points: null, sequence: seq, status: 'planned' }).returning(['id', 'sequence', 'status', 'amount_cents', 'method']).executeTakeFirstOrThrow();
      const pid = await this.materialize(trx, ctx, p, s, ins as Row);
      await this.recomputeStatement(trx, ctx, statementId);
      await this.recomputePeriod(trx, ctx, String(s.period_id));
      addNotices = this.justPaid.get(trx);
      return pid;
    });
    await this.sendPaidNotices(ctx, addNotices);
    await this.audit(ctx, 'payout.added', 'payroll_payout', id, { statementId, method: b.method });
    return this.payout(ctx, id);
  }
  async payout(ctx: PayrollContext, payoutId: string, technicianId?: string | null): Promise<PayoutView> {
    let q = this.db.selectFrom('payroll_payouts').select([...PAYOUT_SELECT]).where('tenant_id', '=', ctx.tenantId).where('id', '=', payoutId);
    if (technicianId) q = q.where('technician_id', '=', technicianId);
    const r = await q.executeTakeFirst();
    if (!r) throw new PayrollError('RESOURCE_NOT_FOUND', 'That payout could not be found.');
    return toPayoutView(r as Row);
  }
  /** Other methods (ACH, direct deposit, an external transfer) are confirmed by the existing payout status route; this
   *  is the statement recompute it triggers (bound as the workflow's payout-change hook). */
  async onPayoutChanged(trx: Trx, ctx: PayrollContext, payoutId: string): Promise<void> {
    const x = await trx.selectFrom('payroll_payouts').select(['statement_id', 'period_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', payoutId).executeTakeFirst();
    if (!x?.statement_id) return;
    await this.recomputeStatement(trx, ctx, String(x.statement_id));
    await this.recomputePeriod(trx, ctx, String(x.period_id));
  }

  // ── §12.4 the preparation report (cash envelopes / check run) ───────────────────────────────────────────────────────
  /** After the owner approved the period: what to prepare — every check to issue / deliver and every cash envelope to
   *  prepare / hand over, by technician, with the totals by method, the cash by source, and what is still unplanned.
   *  For the people who do the paying (payroll.issue_check / payroll.cash_handoff) and the approver. Branch-scoped
   *  viewers see their statements only; every figure is computed here from the payouts (never the client). */
  async preparation(ctx: PayrollContext, periodId: string) {
    this.need(ctx, 'pos.payroll.view');
    if (!['payroll.issue_check', 'payroll.cash_handoff', 'payroll.approve'].some((k) => hasPermission(ctx as never, k))) throw new PayrollError('PERMISSION_DENIED', 'The preparation report is for the people who issue checks or hand over cash.', { permission: 'payroll.issue_check' });
    const week = await this.periodStatements(ctx, periodId);
    if (!['finalized', 'paid'].includes(week.period.status)) throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'The owner has not approved this pay period yet — there is nothing to prepare.');
    const sts = week.statements.filter((s) => APPROVED_STATEMENT.includes(s.status));
    type Line = { payoutId: string; statementId: string; statementNumber: string; technicianId: string; technicianName: string | null; method: string; amountCents: number; status: string; paid: boolean;
      checkNumber: string | null; checkStatus: string | null; cashSource: string | null; cashStatus: string | null; replacesPayoutId: string | null };
    const lines: Line[] = [];
    const unplanned: Array<{ statementId: string; statementNumber: string; technicianId: string; technicianName: string | null; amountCents: number }> = [];
    let payable = 0, paid = 0;
    for (const s of sts) {
      payable += s.approvedPayableCents; paid += s.paidCents;
      let committed = 0;
      for (const x of s.payouts) {
        if (x.status === 'canceled' || x.status === 'failed') continue;
        committed += x.amountCents;
        lines.push({ payoutId: x.id, statementId: s.id, statementNumber: s.statementNumber, technicianId: s.technicianId, technicianName: s.technicianName, method: x.method, amountCents: x.amountCents, status: x.status, paid: x.status === 'paid',
          checkNumber: x.checkNumber, checkStatus: x.checkStatus, cashSource: x.cashSource, cashStatus: x.cashStatus, replacesPayoutId: x.replacesPayoutId });
      }
      const left = s.approvedPayableCents - committed;
      if (left > 0) unplanned.push({ statementId: s.id, statementNumber: s.statementNumber, technicianId: s.technicianId, technicianName: s.technicianName, amountCents: left });
    }
    const byName = (a: Line, b: Line) => String(a.technicianName ?? '').localeCompare(String(b.technicianName ?? '')) || a.statementNumber.localeCompare(b.statementNumber);
    const checks = lines.filter((l) => l.method === 'check').sort(byName);
    const cash = lines.filter((l) => l.method === 'cash').sort(byName);
    const other = lines.filter((l) => l.method !== 'check' && l.method !== 'cash').sort(byName);
    const sum = (xs: Line[]) => xs.reduce((a, x) => a + x.amountCents, 0);
    const count = (xs: Line[], f: (x: Line) => boolean) => xs.filter(f).length;
    const bySource: Record<string, { count: number; amountCents: number }> = {};
    for (const c of cash) { const k = c.cashSource ?? 'not_prepared'; const v = bySource[k] ?? { count: 0, amountCents: 0 }; v.count++; v.amountCents += c.amountCents; bySource[k] = v; }
    const committedCents = sum(lines), unplannedCents = unplanned.reduce((a, x) => a + x.amountCents, 0);
    return {
      period: week.period, technicians: sts.length,
      checks: { lines: checks, count: checks.length, amountCents: sum(checks), toIssue: count(checks, (x) => x.checkStatus === 'planned'), toDeliver: count(checks, (x) => x.checkStatus === 'issued'), delivered: count(checks, (x) => x.checkStatus === 'delivered' || x.checkStatus === 'cleared') },
      cash: { lines: cash, count: cash.length, amountCents: sum(cash), toPrepare: count(cash, (x) => x.cashStatus === 'planned'), toHandOff: count(cash, (x) => x.cashStatus === 'ready_for_handoff'), toAcknowledge: count(cash, (x) => x.cashStatus === 'handed_off'), acknowledged: count(cash, (x) => x.cashStatus === 'acknowledged'), disputed: count(cash, (x) => x.cashStatus === 'disputed'), bySource },
      other: { lines: other, count: other.length, amountCents: sum(other) },
      unplanned,
      totals: { payableCents: payable, committedCents, unplannedCents, paidCents: paid, unpaidCents: Math.max(0, payable - paid),
        // every cent of the approved payable is either planned on a payout or still unplanned; paid + unpaid = payable
        reconciles: committedCents + unplannedCents === payable && paid + Math.max(0, payable - paid) === payable },
    };
  }

  /** §8.4 / §9.5: the evidence behind one statement (services, tips, hours, adjustments, payouts — the workflow's
   *  technician drill-down), under the paycheck's branch scope so a branch viewer never opens another branch's technician. */
  async technicianEvidence(ctx: PayrollContext, periodId: string, technicianId: string) {
    this.need(ctx, 'pos.payroll.view');
    const scope = this.branchScope(ctx);
    if (scope) {
      const s = (await this.db.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('technician_id', '=', technicianId).where('status', '<>', 'voided').executeTakeFirst()) as Row | undefined;
      if (!s || !(await this.inScope(this.db, ctx.tenantId, scope, s))) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
    }
    return this.opts.workflow.technicianDetail(ctx, periodId, technicianId);
  }

  // ── the technician's own payroll (§15) ──────────────────────────────────────────────────────────────────────────────
  async myPayroll(ctx: PayrollContext, technicianId: string) {
    const rows = (await this.db.selectFrom('payroll_statements as s').innerJoin('payroll_periods as p', (j) => j.onRef('p.id', '=', 's.period_id').onRef('p.tenant_id', '=', 's.tenant_id'))
      .select(['s.id', 's.period_id', 's.statement_number', 's.status', 's.approved_payable_cents', 's.paid_cents', 's.gross_earnings_cents', 'p.label', 'p.period_start', 'p.period_end', 'p.pay_date', 'p.status as period_status'])
      .where('s.tenant_id', '=', ctx.tenantId).where('s.technician_id', '=', technicianId).where('s.status', '<>', 'voided').orderBy('p.period_end', 'desc').limit(52).execute()) as Row[];
    const approved = (s: Row) => APPROVED_STATEMENT.includes(String(s.status));
    const items = rows.map((s) => ({ id: String(s.id), periodId: String(s.period_id), statementNumber: String(s.statement_number), periodStart: ymdOf(s.period_start), periodEnd: ymdOf(s.period_end),
      payDate: s.pay_date ? ymdOf(s.pay_date) : null, label: (s.label as string) ?? null, status: String(s.status), estimated: !approved(s),
      stage: approved(s) ? 'approved' : s.status === 'submitted' || s.status === 'held' ? 'owner_review' : 'manager_review',
      amountCents: n(s.approved_payable_cents), paidCents: approved(s) ? n(s.paid_cents) : 0, unpaidCents: approved(s) ? Math.max(0, n(s.approved_payable_cents) - n(s.paid_cents)) : 0 }));
    const cashWaiting = (await this.db.selectFrom('payroll_payouts').select([...PAYOUT_SELECT]).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
      .where('cash_status', 'in', ['ready_for_handoff', 'handed_off', 'disputed']).execute()).map((r) => toPayoutView(r as Row));
    return { current: items[0] ?? null, statements: items, cashWaiting };
  }
  async myStatement(ctx: PayrollContext, technicianId: string, statementId: string) {
    const s = (await this.db.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('id', '=', statementId).where('status', '<>', 'voided').executeTakeFirst()) as Row | undefined;
    if (!s) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
    const names = await this.names(this.db, ctx.tenantId, [technicianId]);
    const st = this.toStatement(s, names, { includeNote: false });   // a manager's private note is never shown to the technician
    const p = await this.db.selectFrom('payroll_periods').select(['label', 'period_start', 'period_end', 'pay_date']).where('tenant_id', '=', ctx.tenantId).where('id', '=', st.periodId).executeTakeFirst();
    const tenant = await this.db.selectFrom('tenants').select(['display_name']).where('id', '=', ctx.tenantId).executeTakeFirst();
    const approved = APPROVED_STATEMENT.includes(st.status);
    const payouts = approved ? (await this.db.selectFrom('payroll_payouts').select([...PAYOUT_SELECT]).where('tenant_id', '=', ctx.tenantId).where('statement_id', '=', statementId).where('technician_id', '=', technicianId).orderBy('created_at').execute()).map((r) => toPayoutView(r as Row)) : [];
    return { ...st, salonName: tenant?.display_name ?? null, periodStart: p ? ymdOf(p.period_start) : null, periodEnd: p ? ymdOf(p.period_end) : null, payDate: p?.pay_date ? ymdOf(p.pay_date) : null,
      estimated: !approved, payouts, paidCents: approved ? st.paidCents : 0, unpaidCents: approved ? st.unpaidCents : 0 };
  }

  // ── the pay stub PDF (17.5, Oct 27 2026) ───────────────────────────────────────────────────────────────────────────
  /** one download budget per person per API process (rate-limited, Constitution 12 §57) */
  readonly payStubLimiter = new PayStubRateLimiter();
  /** The manager's / owner's download: the statement exactly as the statement read reaches it (tenant + branch scope). */
  async payStub(ctx: PayrollContext, statementId: string, opts: { lang?: string | null; surface: 'pos' | 'owner' }): Promise<PayStubFile> {
    this.need(ctx, 'pos.payroll.view');
    const s = (await this.db.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('id', '=', statementId).where('status', '<>', 'voided').executeTakeFirst()) as Row | undefined;
    if (!s) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
    const scope = this.branchScope(ctx);
    if (scope && !(await this.inScope(this.db, ctx.tenantId, scope, s))) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
    return this.payStubOf(ctx, s, opts);
  }
  /** The technician's own download (Tech App): only her statement — another technician's id is 404, like the read. */
  async myPayStub(ctx: PayrollContext, technicianId: string, statementId: string, opts: { lang?: string | null } = {}): Promise<PayStubFile> {
    const s = (await this.db.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('id', '=', statementId).where('status', '<>', 'voided').executeTakeFirst()) as Row | undefined;
    if (!s) throw new PayrollError('STATEMENT_NOT_FOUND', 'That pay statement could not be found.');
    return this.payStubOf(ctx, s, { ...opts, surface: 'tech' });
  }
  /** Only an APPROVED (locked) statement has a stub — before that the figures are an estimate and can still change. The
   *  stub reads the stored snapshot (never recalculates); the download is audited without amounts. */
  private async payStubOf(ctx: PayrollContext, s: Row, opts: { lang?: string | null; surface: 'pos' | 'owner' | 'tech' }): Promise<PayStubFile> {
    if (!APPROVED_STATEMENT.includes(String(s.status))) throw new PayrollError('PAYROLL_PERIOD_NOT_READY', 'The pay stub is ready once the owner approves this week — until then the statement is an estimate.', { status: String(s.status) });
    if (!this.payStubLimiter.take(`${ctx.tenantId}:${ctx.userId ?? '-'}`)) throw new PayrollError('RATE_LIMITED', 'Too many pay stub downloads — wait a minute and try again.');
    // POSLanguage.pdf §11 / §12 (Oct 28 2026): the Technician App and the Owner App are English only — a stub downloaded there
    // is English whatever the person's POS language (or a ?lang= in the request). Only the Front Desk POS follows the POS language.
    const lang = opts.surface === 'pos' ? (opts.lang ?? null) : 'en';
    const file = await buildPayStub(this.db, ctx, s, { now: this.opts.now?.() ?? new Date(), lang });
    await this.audit(ctx, 'pay_stub.downloaded', 'payroll_statement', String(s.id), { statementNumber: file.statementNumber, version: file.version, technicianId: String(s.technician_id), periodId: String(s.period_id), language: file.language, surface: opts.surface, bytes: file.buffer.length }, null, 'low');
    return file;
  }

  // ── owner dashboard + reports (§19) ─────────────────────────────────────────────────────────────────────────────────
  async ownerSummary(ctx: PayrollContext) {
    this.need(ctx, 'pos.payroll.view');
    // Oct 28 2026 (mandate audit): a branch-scoped viewer gets the summary of their branches' technicians, not the salon's
    const scope = this.branchScope(ctx);
    if (scope) return this.scopedSummary(ctx, scope);
    const t = ctx.tenantId;
    const r = await sql<Record<string, string>>`SELECT
        (SELECT count(*) FROM payroll_periods WHERE tenant_id = ${t} AND status = 'review' AND submitted_at IS NOT NULL)::text AS pending_approval,
        (SELECT COALESCE(SUM(approved_payable_cents),0) FROM payroll_statements WHERE tenant_id = ${t} AND status IN ('locked','issued','partially_paid','paid'))::text AS approved_payable,
        (SELECT COALESCE(SUM(paid_cents),0) FROM payroll_statements WHERE tenant_id = ${t} AND status IN ('locked','issued','partially_paid','paid'))::text AS paid,
        (SELECT COALESCE(SUM(amount_cents),0) FROM payroll_payouts WHERE tenant_id = ${t} AND statement_id IS NOT NULL AND method = 'check' AND status NOT IN ('failed','canceled'))::text AS check_total,
        (SELECT COALESCE(SUM(amount_cents),0) FROM payroll_payouts WHERE tenant_id = ${t} AND statement_id IS NOT NULL AND method = 'cash' AND status NOT IN ('failed','canceled'))::text AS cash_total,
        (SELECT count(*) FROM payroll_payouts WHERE tenant_id = ${t} AND cash_status IN ('planned','ready_for_handoff','handed_off'))::text AS cash_awaiting,
        (SELECT COALESCE(SUM(amount_cents),0) FROM payroll_payouts WHERE tenant_id = ${t} AND cash_status IN ('planned','ready_for_handoff','handed_off'))::text AS cash_awaiting_cents,
        (SELECT count(*) FROM payroll_payouts WHERE tenant_id = ${t} AND check_status IN ('planned','issued'))::text AS checks_awaiting,
        (SELECT count(*) FROM payroll_payouts WHERE tenant_id = ${t} AND (cash_status = 'disputed' OR check_status = 'returned' OR status = 'failed'))::text AS exceptions`.execute(this.db);
    const x = r.rows[0] ?? {};
    const approvedPayable = n(x.approved_payable), paid = n(x.paid);
    return { pendingOwnerApproval: n(x.pending_approval), approvedPayableCents: approvedPayable, paidCents: paid, unpaidCents: Math.max(0, approvedPayable - paid), checkTotalCents: n(x.check_total),
      cashTotalCents: n(x.cash_total), cashAwaitingHandoff: n(x.cash_awaiting), cashAwaitingHandoffCents: n(x.cash_awaiting_cents), checksAwaitingDelivery: n(x.checks_awaiting), exceptionPayouts: n(x.exceptions) };
  }
  private async scopedSummary(ctx: PayrollContext, scope: string[]) {
    const t = ctx.tenantId;
    const all = (await this.db.selectFrom('payroll_statements').select([...STATEMENT_COLS]).where('tenant_id', '=', t).where('status', '<>', 'voided').execute()) as Row[];
    const homes = new Map((all.length ? await this.db.selectFrom('technicians').select(['id', 'branch_id']).where('tenant_id', '=', t).where('id', 'in', [...new Set(all.map((r) => String(r.technician_id)))]).execute() : []).map((x) => [String(x.id), (x.branch_id as string) ?? null]));
    const mine: Row[] = [];
    for (const r of all) if (await this.inScope(this.db, t, scope, r, homes)) mine.push(r);
    const approved = mine.filter((r) => ['locked', 'issued', 'partially_paid', 'paid'].includes(String(r.status)));
    const ids = mine.map((r) => String(r.id));
    const pos = ids.length ? ((await this.db.selectFrom('payroll_payouts').select([...PAYOUT_SELECT]).where('tenant_id', '=', t).where('statement_id', 'in', ids).execute()) as Row[]) : [];
    const live = pos.filter((x) => x.status !== 'failed' && x.status !== 'canceled');
    const cashWaiting = pos.filter((x) => ['planned', 'ready_for_handoff', 'handed_off'].includes(String(x.cash_status)));
    const periods = [...new Set(mine.map((r) => String(r.period_id)))];
    const pending = periods.length ? Number((await this.db.selectFrom('payroll_periods').select((eb) => eb.fn.countAll().as('c')).where('tenant_id', '=', t).where('id', 'in', periods).where('status', '=', 'review').where('submitted_at', 'is not', null).executeTakeFirst())?.c ?? 0) : 0;
    const approvedPayable = approved.reduce((a, r) => a + n(r.approved_payable_cents), 0), paid = approved.reduce((a, r) => a + n(r.paid_cents), 0);
    return { pendingOwnerApproval: pending, approvedPayableCents: approvedPayable, paidCents: paid, unpaidCents: Math.max(0, approvedPayable - paid),
      checkTotalCents: live.filter((x) => x.method === 'check').reduce((a, x) => a + n(x.amount_cents), 0), cashTotalCents: live.filter((x) => x.method === 'cash').reduce((a, x) => a + n(x.amount_cents), 0),
      cashAwaitingHandoff: cashWaiting.length, cashAwaitingHandoffCents: cashWaiting.reduce((a, x) => a + n(x.amount_cents), 0),
      checksAwaitingDelivery: pos.filter((x) => ['planned', 'issued'].includes(String(x.check_status))).length,
      exceptionPayouts: pos.filter((x) => x.cash_status === 'disputed' || x.check_status === 'returned' || x.status === 'failed').length };
  }
  /** Weekly / monthly / year-to-date payroll by technician, by branch contribution and by payout method, the cash payout
   *  report and the check register. Accounting: the compensation expense is the statements' line payable ONCE; check and
   *  cash are how that one liability was settled — never added as more expense (§19). */
  async report(ctx: PayrollContext, q: { range?: 'week' | 'month' | 'ytd' | 'custom'; from?: string | null; to?: string | null }) {
    this.need(ctx, 'pos.payroll.view');
    const { today } = await this.salonToday(ctx.tenantId, (await this.scheduleOf(this.db, ctx.tenantId)).timezone);
    const range = q.range ?? 'month';
    let from: string, to = today;
    if (range === 'custom') { if (!q.from || !q.to || !/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to) || q.from > q.to) throw new PayrollError('VALIDATION_FAILED', 'Choose a from and to date.'); from = q.from; to = q.to; }
    else if (range === 'week') from = addDays(today, -6);
    else if (range === 'ytd') from = `${today.slice(0, 4)}-01-01`;
    else from = `${today.slice(0, 7)}-01`;
    const sts = (await this.db.selectFrom('payroll_statements as s').innerJoin('payroll_periods as p', (j) => j.onRef('p.id', '=', 's.period_id').onRef('p.tenant_id', '=', 's.tenant_id'))
      .select(['s.id', 's.technician_id', 's.statement_number', 's.status', 's.gross_earnings_cents', 's.line_payable_cents', 's.already_paid_cents', 's.approved_payable_cents', 's.paid_cents', 's.branch_breakdown',
        's.service_commission_cents', 's.tips_cents', 's.hourly_pay_cents', 's.salary_pay_cents', 's.retail_commission_cents', 's.bonus_cents', 's.guarantee_topup_cents', 's.deductions_cents', 'p.period_end', 'p.label'])
      .where('s.tenant_id', '=', ctx.tenantId).where('s.status', 'in', APPROVED_STATEMENT).where('p.period_end', '>=', from).where('p.period_end', '<=', to).execute()) as Row[];
    // Oct 28 2026 (mandate audit §14.3 / §24.2): a branch-scoped viewer sees their branches' technicians only — the report
    // (check register, cash payouts, totals) was salon-wide, with amounts and names, for anyone with pos.payroll.view
    const scope = this.branchScope(ctx);
    if (scope) {
      const homes = new Map((sts.length ? await this.db.selectFrom('technicians').select(['id', 'branch_id']).where('tenant_id', '=', ctx.tenantId).where('id', 'in', [...new Set(sts.map((r) => String(r.technician_id)))]).execute() : []).map((t) => [String(t.id), (t.branch_id as string) ?? null]));
      const keep: Row[] = [];
      for (const r of sts) if (await this.inScope(this.db, ctx.tenantId, scope, r, homes)) keep.push(r);
      sts.splice(0, sts.length, ...keep);
    }
    const ids = sts.map((s) => String(s.id));
    const pos = ids.length ? ((await this.db.selectFrom('payroll_payouts').select([...PAYOUT_SELECT]).where('tenant_id', '=', ctx.tenantId).where('statement_id', 'in', ids).orderBy('created_at').execute()) as Row[]) : [];
    const names = await this.names(this.db, ctx.tenantId, sts.map((s) => String(s.technician_id)));
    const byTech = new Map<string, { technicianId: string; technicianName: string | null; statements: number; grossEarningsCents: number; payableCents: number; paidCents: number; unpaidCents: number }>();
    const byBranch = new Map<string, { branchId: string | null; branchName: string | null; serviceEarningsCents: number; tipsCents: number }>();
    for (const s of sts) {
      const k = String(s.technician_id);
      const t = byTech.get(k) ?? { technicianId: k, technicianName: names.get(k) ?? null, statements: 0, grossEarningsCents: 0, payableCents: 0, paidCents: 0, unpaidCents: 0 };
      t.statements++; t.grossEarningsCents += n(s.gross_earnings_cents); t.payableCents += n(s.approved_payable_cents); t.paidCents += n(s.paid_cents); t.unpaidCents += Math.max(0, n(s.approved_payable_cents) - n(s.paid_cents));
      byTech.set(k, t);
      for (const b of (s.branch_breakdown ?? []) as StatementView['branchBreakdown']) {
        if (scope && !(b.branchId && scope.includes(b.branchId))) continue;   // another branch's contribution is not shown
        const bk = String(b.branchId ?? 'none');
        const v = byBranch.get(bk) ?? { branchId: b.branchId, branchName: b.branchName, serviceEarningsCents: 0, tipsCents: 0 };
        v.serviceEarningsCents += n(b.serviceEarningsCents); v.tipsCents += n(b.tipsCents); byBranch.set(bk, v);
      }
    }
    const byMethod: Record<string, { committedCents: number; paidCents: number; count: number }> = {};
    for (const x of pos) {
      if (x.status === 'failed' || x.status === 'canceled') continue;
      const m = byMethod[String(x.method)] ?? { committedCents: 0, paidCents: 0, count: 0 };
      m.committedCents += n(x.amount_cents); m.count++; if (x.status === 'paid') m.paidCents += n(x.amount_cents);
      byMethod[String(x.method)] = m;
    }
    const sum = (f: (s: Row) => number) => sts.reduce((a, s) => a + f(s), 0);
    const compensation = sum((s) => n(s.line_payable_cents));
    const settledCheck = byMethod.check?.paidCents ?? 0, settledCash = byMethod.cash?.paidCents ?? 0;
    const settledOther = Object.entries(byMethod).filter(([k]) => k !== 'check' && k !== 'cash').reduce((a, [, v]) => a + v.paidCents, 0);
    const already = sum((s) => n(s.already_paid_cents)), unpaid = sum((s) => Math.max(0, n(s.approved_payable_cents) - n(s.paid_cents)));
    return {
      range, from, to, statements: sts.length,
      totals: { grossEarningsCents: sum((s) => n(s.gross_earnings_cents)), approvedPayableCents: sum((s) => n(s.approved_payable_cents)), paidCents: sum((s) => n(s.paid_cents)), unpaidCents: unpaid, alreadyPaidCents: already,
        serviceCommissionCents: sum((s) => n(s.service_commission_cents)), tipsCents: sum((s) => n(s.tips_cents)), hourlyCents: sum((s) => n(s.hourly_pay_cents)) + sum((s) => n(s.salary_pay_cents)),
        retailCommissionCents: sum((s) => n(s.retail_commission_cents)), bonusCents: sum((s) => n(s.bonus_cents)), guaranteeTopUpCents: sum((s) => n(s.guarantee_topup_cents)), deductionsCents: sum((s) => n(s.deductions_cents)) },
      byTechnician: [...byTech.values()].sort((a, b) => b.payableCents - a.payableCents),
      byBranch: [...byBranch.values()].sort((a, b) => b.serviceEarningsCents - a.serviceEarningsCents),
      byMethod,
      accounting: { compensationExpenseCents: compensation, settledByCheckCents: settledCheck, settledByCashCents: settledCash, settledOtherCents: settledOther, alreadyReceivedCents: already, unpaidCents: unpaid,
        reconciles: compensation === settledCheck + settledCash + settledOther + already + unpaid,
        rule: 'Payroll expense is the compensation liability (each statement once). Check and cash are how that liability was settled; they are not added again as expense.' },
      checkRegister: pos.filter((x) => x.method === 'check').map((x) => ({ ...toPayoutView(x), technicianName: names.get(String(x.technician_id)) ?? null })),
      cashPayouts: pos.filter((x) => x.method === 'cash').map((x) => ({ ...toPayoutView(x), technicianName: names.get(String(x.technician_id)) ?? null })),
    };
  }
}
