// payroll.dto.ts — types + pure payroll math for pay runs. Helpers are side-effect free and unit-tested: the percent/
// flat commission formula (consistent with the services/tech commission model), per-line payable, period roll-ups, and
// the period lifecycle. All money is integer cents.
import { defineStateMachine } from '@aipowersalon/database';
export type CommissionType = 'percent' | 'flat';
/** A Postgres DATE as 'YYYY-MM-DD'. node-postgres parses DATE into a JS Date at LOCAL midnight (no type parser is set),
 *  so String(date) is "Mon Jun 01 …" and toISOString() can shift the day in a zone east of UTC — read the local parts.
 *  (Wave 2 fix: period dates came back as "Mon Jun 01" on a real pg pool and broke every pay-period window.) */
export function ymdOf(v: unknown): string {
  if (v instanceof Date) {
    // node-postgres: local midnight → local parts. PGlite (and any driver that parses DATE as UTC midnight): local parts west of
    // UTC give the day BEFORE — read the UTC parts when the value is UTC midnight and not local midnight.
    const utcMidnight = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0;
    const localMidnight = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0;
    const [y, m, d] = utcMidnight && !localMidnight ? [v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()] : [v.getFullYear(), v.getMonth(), v.getDate()];
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return String(v ?? '').slice(0, 10);
}
export type PeriodStatus = 'draft' | 'review' | 'finalized' | 'paid' | 'canceled';

export interface PayrollLineRow {
  id: string;
  tenantId: string;
  periodId: string;
  technicianId: string;
  technicianName: string | null;
  servicesCount: number;
  grossSalesCents: number;
  commissionType: CommissionType;
  commissionValue: number;
  commissionCents: number;
  tipsCents: number;
  adjustmentCents: number;
  payableCents: number;
  createdAt: string;
  updatedAt: string;
  /** canonical breakdown (migrations 158 + 610) — present on Kysely-read lines; 0 on legacy manual lines. */
  retailCommissionCents?: number; cardTipCents?: number; cashTipCents?: number; guaranteeTopUpCents?: number;
  hourlyPayCents?: number; workedMinutes?: number; potentialOvertimeMinutes?: number; salaryPayCents?: number;
  bonusCents?: number; deductionCents?: number; netCents?: number; reviewRequired?: boolean;
  /** Σ payouts recorded PAID for this line, and what is still owed (payable − paid) — §78 earned ≠ paid. */
  paidCents?: number; outstandingCents?: number;
}

export interface PayrollPeriodRow {
  id: string;
  tenantId: string;
  branchId: string | null;
  label: string | null;
  periodStart: string;
  periodEnd: string;
  status: PeriodStatus;
  finalizedAt: string | null;
  paidAt: string | null;
  totalGrossCents: number;
  totalCommissionCents: number;
  totalTipsCents: number;
  totalPayableCents: number;
  createdAt: string;
  updatedAt: string;
  /** set when a finalized period was reopened (migration 589) — the reason is mandatory. */
  reopenReason?: string | null; reopenedAt?: string | null; reopenedBy?: string | null;
  /** migration 610 — optimistic version, calculation version, the prepare / approval integrity hashes, the last validation. */
  version?: number; calculationVersion?: string | null; previewHash?: string | null; approvalHash?: string | null;
  preparedAt?: string | null; preparedBy?: string | null; approvedBy?: string | null; paidBy?: string | null;
  blockingCount?: number; warningCount?: number; payDate?: string | null;
  /** §151 the owner-facing label (derived): OPEN · NEEDS_REVIEW · READY_TO_APPROVE · HAS_EXCEPTIONS · LOCKED · PAID */
  dashboardStatus?: DashboardStatus;
}
export type DashboardStatus = 'OPEN' | 'NEEDS_REVIEW' | 'READY_TO_APPROVE' | 'HAS_EXCEPTIONS' | 'LOCKED' | 'PAID' | 'CANCELED';
/** §151: one label per period — status + the last validation (blocking issues win over everything but locked / paid). */
export function dashboardStatusOf(p: { status: PeriodStatus; blockingCount?: number; warningCount?: number }): DashboardStatus {
  if (p.status === 'paid') return 'PAID';
  if (p.status === 'canceled') return 'CANCELED';
  if (p.status === 'finalized') return 'LOCKED';
  if ((p.blockingCount ?? 0) > 0) return 'HAS_EXCEPTIONS';
  if (p.status === 'review') return 'READY_TO_APPROVE';
  return (p.warningCount ?? 0) > 0 ? 'NEEDS_REVIEW' : 'OPEN';
}

export interface CreatePeriodRequest { label?: string; periodStart: string; periodEnd: string }
export interface UpsertLineRequest {
  technicianId: string;
  technicianName?: string;
  servicesCount?: number;
  grossSalesCents?: number;
  commissionType?: CommissionType;
  commissionValue?: number;
  tipsCents?: number;
  adjustmentCents?: number;
}

export interface PeriodFilters { status?: PeriodStatus; search?: string; technician?: string; page?: number; pageSize?: number }
export interface PayrollKpis { totalPeriods: number; openPeriods: number; unpaidPayableCents: number; lifetimePayableCents: number; lifetimeCommissionCents: number; lifetimeTipsCents: number }

const cents = (v: unknown): number => Math.max(0, Math.trunc(Number(v) || 0));
const intval = (v: unknown): number => Math.trunc(Number(v) || 0);

export function normalizeCommissionType(v: unknown): CommissionType {
  return v === 'flat' ? 'flat' : 'percent';
}

// The commission formula, matching the services/tech model: percent → grossSales × value%; flat → value(cents) ×
// services. Guards negatives; percent is clamped to [0,100]. Pure.
export function computeCommissionCents(input: { grossSalesCents: number; commissionType: CommissionType; commissionValue: number; servicesCount: number }): number {
  const gross = cents(input.grossSalesCents);
  const services = cents(input.servicesCount);
  if (input.commissionType === 'flat') return cents(input.commissionValue) * services;
  const pct = Math.min(100, Math.max(0, Number(input.commissionValue) || 0));
  return Math.round((gross * pct) / 100);
}

// Net payable for a line = commission + tips + adjustment (adjustment may be negative, e.g. a deduction). Floors at 0.
export function computePayableCents(input: { commissionCents: number; tipsCents: number; adjustmentCents: number }): number {
  return Math.max(0, cents(input.commissionCents) + cents(input.tipsCents) + intval(input.adjustmentCents));
}

// Build the fully-computed line numbers from raw inputs (used by adapters + tested).
export function computeLine(req: UpsertLineRequest) {
  const commissionType = normalizeCommissionType(req.commissionType);
  const grossSalesCents = cents(req.grossSalesCents);
  const servicesCount = cents(req.servicesCount);
  const commissionValue = Number(req.commissionValue) || 0;
  const tipsCents = cents(req.tipsCents);
  const adjustmentCents = intval(req.adjustmentCents);
  const commissionCents = computeCommissionCents({ grossSalesCents, commissionType, commissionValue, servicesCount });
  const payableCents = computePayableCents({ commissionCents, tipsCents, adjustmentCents });
  return { commissionType, grossSalesCents, servicesCount, commissionValue, tipsCents, adjustmentCents, commissionCents, payableCents };
}

export function rollupPeriodTotals(lines: PayrollLineRow[]) {
  return {
    totalGrossCents: lines.reduce((a, l) => a + l.grossSalesCents, 0),
    totalCommissionCents: lines.reduce((a, l) => a + l.commissionCents, 0),
    totalTipsCents: lines.reduce((a, l) => a + l.tipsCents, 0),
    totalPayableCents: lines.reduce((a, l) => a + l.payableCents, 0),
  };
}

/** BUILD_PLAN Phase 12 (#27): the payroll period lifecycle — the ONE transition table (payroll_periods.status). A paid period
 *  is terminal (locked). Every status write runs it (the repository, under the row lock). */
export const PAYROLL_PERIOD = defineStateMachine({
  name: 'payroll_period', table: 'payroll_periods', column: 'status',
  // Payroll mandate §66 (wave 2): draft = OPEN, review = READY_FOR_REVIEW (prepared: lines built, validated, preview hash
  // frozen — lines are locked at the DB), finalized = APPROVED + LOCKED (approval hash; corrections are adjustments in the
  // next open period), paid = PAID (payouts recorded; terminal). review → draft = "send back"; finalized → draft = the
  // reasoned, step-up reopen (§124). draft → finalized stays for the Owner App's one-step approve (it validates the same way).
  // Weekly Paycheck close-out (Oct 27 2026, §3.4): canceled = a period opened by mistake, closed before anything was
  // approved (draft only; its draft statements are voided, never deleted). Terminal — a new period is opened instead.
  states: ['draft', 'review', 'finalized', 'paid', 'canceled'],
  // Kevin's decision (Oct 28 2026): a PAID week whose payout is voided later (a returned check, a cancelled envelope) owes
  // money again → back to finalized (still approved, lines still locked). That move is the SYSTEM's only: it needs
  // PAYROLL_PAYOUT_REVERSAL, which no role holds — only recomputePeriod passes it; approve / reopen / mark paid refuse it.
  transitions: { draft: ['review', 'finalized', 'canceled'], review: ['draft', 'finalized'], finalized: ['paid', 'draft'], paid: ['finalized'] },
  permissions: { 'paid->finalized': 'system.payroll.payout_reversal' },
  initial: ['draft'],
});
/** payroll_payouts.status (migration 611, §80): pending → processing → paid / failed; pending or processing → canceled. */
export const PAYROLL_PAYOUT = defineStateMachine({
  name: 'payroll_payout', table: 'payroll_payouts', column: 'status',
  states: ['pending', 'processing', 'paid', 'failed', 'canceled'],
  transitions: { pending: ['processing', 'paid', 'failed', 'canceled'], processing: ['paid', 'failed', 'canceled'],
    // only a paycheck CHECK that was delivered and later voided / returned by the bank (the generic status route refuses it)
    paid: ['canceled'] },
  initial: ['pending', 'paid'],
});
export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'canceled';
export type PayoutMethod = 'cash' | 'check' | 'direct_deposit' | 'external_provider' | 'other';
export const PAYOUT_METHODS: readonly PayoutMethod[] = ['cash', 'check', 'direct_deposit', 'external_provider', 'other'];
/** payroll_inquiries.status (migration 612, §152). */
export const PAYROLL_INQUIRY = defineStateMachine({
  name: 'payroll_inquiry', table: 'payroll_inquiries', column: 'status',
  states: ['open', 'answered', 'closed'],
  transitions: { open: ['answered', 'closed'], answered: ['answered', 'closed', 'open'] },
  initial: ['open'],
});
/** May a PERSON move the period from → to? (the system-only paid → finalized reversal is not a person's move) */
export function canTransitionPeriod(from: PeriodStatus, to: PeriodStatus): boolean { return PAYROLL_PERIOD.can(from, to) && !PAYROLL_PERIOD.permissionFor(from, to); }
export function isPeriodLocked(status: PeriodStatus): boolean { return status === 'paid' || status === 'canceled'; }
/** Lines are frozen (DB trigger, migration 610) while the period is prepared, approved or paid. */
export function linesFrozen(status: PeriodStatus): boolean { return status === 'review' || status === 'finalized' || status === 'paid'; }

export function derivePayrollKpis(periods: PayrollPeriodRow[]): PayrollKpis {
  return {
    totalPeriods: periods.length,
    openPeriods: periods.filter((p) => p.status !== 'paid').length,
    unpaidPayableCents: periods.filter((p) => p.status !== 'paid').reduce((a, p) => a + p.totalPayableCents, 0),
    lifetimePayableCents: periods.reduce((a, p) => a + p.totalPayableCents, 0),
    lifetimeCommissionCents: periods.reduce((a, p) => a + p.totalCommissionCents, 0),
    lifetimeTipsCents: periods.reduce((a, p) => a + p.totalTipsCents, 0),
  };
}

/** A technician search term: its words (accent-free, lower case) and, when it holds 3+ digits, those digits for a phone. */
export function technicianTerm(raw: string | undefined): { text: string; digits: string } | null {
  const text = String(raw ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').trim().toLowerCase().slice(0, 100);
  if (!text) return null;
  const d = text.replace(/\D/g, '');
  return { text, digits: d.length >= 3 ? d : '' };
}

export function applyPeriodFilters(rows: PayrollPeriodRow[], f: PeriodFilters, technicianPeriodIds?: Set<string>): PayrollPeriodRow[] {
  let out = rows;
  if (f.status) out = out.filter((r) => r.status === f.status);
  if (f.search) { const s = f.search.toLowerCase(); out = out.filter((r) => (r.label || '').toLowerCase().includes(s)); }
  if (f.technician && technicianPeriodIds) out = out.filter((r) => technicianPeriodIds.has(r.id));
  return out;
}
