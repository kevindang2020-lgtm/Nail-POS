// payroll-paychecks.ts — the weekly paycheck wire types (Weekly Technician Paycheck, Cash Payout & Owner Approval mandate,
// Oct 21 2026). Server: modules/workforce PayrollPaycheckService (payroll.controller.ts /pos/payroll/paychecks/*, the Owner
// App's /owner/payroll/*, the Tech App's /tech/payroll/statements*). Clients: pos-web posPayrollApi, owner-web
// ownerPayrollApi, tech-web techApi. Money is integer cents; dates are YYYY-MM-DD, instants ISO strings.

export type PayStatementStatus = 'draft' | 'ready_for_review' | 'submitted' | 'held' | 'approved' | 'locked' | 'issued' | 'partially_paid' | 'paid' | 'voided';
export type PaycheckPolicyType = 'split_check_cash' | 'all_check' | 'all_cash' | 'manual_percent' | 'manual_amount';
export type PaycheckMethod = 'check' | 'cash' | 'ach' | 'direct_deposit' | 'external_transfer' | 'payroll_provider';
export type CheckPayoutStatus = 'planned' | 'issued' | 'delivered' | 'cleared' | 'voided' | 'returned';
export type CashPayoutStatus = 'planned' | 'ready_for_handoff' | 'handed_off' | 'acknowledged' | 'disputed' | 'canceled';
export type CashSource = 'register_drawer' | 'safe' | 'bank_withdrawal' | 'other_recorded_source';
export type PeriodPayoutStatus = 'none' | 'unpaid' | 'partially_paid' | 'paid';

export interface PayrollScheduleView {
  frequency: string; weekStartDay: number; payDayOffsetDays: number; timezone: string | null; active: boolean; autoPrepare: boolean;
  defaultPolicy: 'split_check_cash' | 'all_check' | 'all_cash'; defaultCheckBp: number; primaryMethod: 'check' | 'cash'; cashEnabled: boolean; maxCashBp: number;
  allowedMethods: string[]; manualSplitAllowed: boolean; cashTipsAlreadyPaid: boolean; cashPaidOn: 'acknowledged' | 'handed_off'; version: number;
}
export type PayrollScheduleRequest = Partial<Omit<PayrollScheduleView, 'version'>> & { version?: number | null };

export interface PaycheckPayout {
  id: string; statementId: string | null; technicianId: string; method: string; amountCents: number; status: string; paidAt: string | null;
  checkNumber: string | null; checkStatus: string | null; checkIssuedAt: string | null; checkDeliveredAt: string | null; checkClearedAt: string | null; checkVoidedAt: string | null; checkVoidReason: string | null; replacesPayoutId: string | null;
  cashSource: string | null; cashStatus: string | null; cashPreparedBy: string | null; cashPreparedAt: string | null; cashHandedOffBy: string | null; cashHandedOffAt: string | null;
  cashAcknowledgedAt: string | null; cashAckMethod: string | null; cashDisputeReason: string | null; drawerMovementId: string | null; version: number; createdAt: string | null;
  /** §11.5 (Oct 27 2026): a QR handoff code is live until then (never the code itself); the signature strokes; the co-confirming manager */
  cashHandoffTokenExpiresAt?: string | null; cashAckSignature?: string | null; cashAckConfirmedBy?: string | null;
}
export type CashAckMethod = 'technician_app' | 'technician_pin' | 'qr_handoff' | 'signature' | 'manager_dual';
export interface PaycheckPlan {
  id: string; policyType: PaycheckPolicyType; payableCents: number; status: string; differsFromDefault: boolean; overrideReason: string | null; version: number;
  instructions: Array<{ id: string; method: string; amountCents: number; basisPoints: number | null; sequence: number; status: string; payoutId: string | null }>;
  issues: Array<{ code: string; message: string }>;
}
export interface PayStatementBranchShare { branchId: string | null; branchName: string | null; serviceEarningsCents: number; tipsCents: number; services: number }
export interface PayStatement {
  id: string; periodId: string; technicianId: string; technicianName: string | null; statementNumber: string; status: string; reviewRequired: boolean; version: number;
  serviceCommissionCents: number; hourlyPayCents: number; salaryPayCents: number; tipsCents: number; cardTipCents: number; cashTipCents: number; retailCommissionCents: number;
  bonusCents: number; guaranteeTopUpCents: number; positiveAdjustmentsCents: number; deductionsCents: number; reversalsCents: number;
  /** §4.2 (Oct 27 2026): the reversals itemised — refund / void / chargeback, tip adjustments, retail reversals (each ≥ 0, together ≤ reversalsCents) */
  refundReversalCents?: number; tipAdjustmentCents?: number; retailReversalCents?: number;
  grossEarningsCents: number; linePayableCents: number; alreadyPaidCents: number; approvedPayableCents: number; paidCents: number; unpaidCents: number;
  branchBreakdown: PayStatementBranchShare[]; managerNote?: string | null;
  submittedAt: string | null; approvedAt: string | null; approvedBy: string | null; lockedAt: string | null; voidedAt: string | null; createdAt: string | null;
}
/** §67 (200-technician mandate): why a statement needs a look — its own figures + the week's last validation. */
export interface PaycheckStatementException { code: 'NEGATIVE_PAYABLE' | 'PAYOUT_SPLIT_MISMATCH' | 'MANUAL_ADJUSTMENT' | 'MISSING_CLOCK_OUT' | 'PENDING_ADJUSTMENT' | 'DEDUCTION_EXCEEDS_EARNINGS' | 'DEDUCTION_OVER_CAP' | 'CHANGED_SINCE_BUILD' | 'UNALLOCATED_TIP' | 'MISSING_COMMISSION_RULE'; message: string }
export interface PayStatementDetail extends PayStatement { plan: PaycheckPlan | null; payouts: PaycheckPayout[]; exceptions?: PaycheckStatementException[] }
/** §66: the review filter the week view answered (GET …/paychecks/periods/:id?exceptionsOnly=1&search=&branchId=). Totals stay the whole week's. */
export interface PaycheckWeekView {
  exceptionsOnly: boolean; search: string | null; branchId: string | null; matched: number; total: number; withExceptions: number; validatedAt: string | null;
  periodIssues: Array<{ code: string; severity: string; message: string; count: number }>;
}
export interface PaycheckWeekTotals { technicians: number; grossEarningsCents: number; alreadyPaidCents: number; payableCents: number; checkCents: number; cashCents: number; otherCents: number; paidCents: number; unpaidCents: number; exceptions: number; overrides: number }
export interface PaycheckWeek {
  period: { id: string; label: string | null; periodStart: string; periodEnd: string; payDate: string | null; status: string; payoutStatus: string; version: number; submittedBy: string | null; submittedAt: string | null;
    ownerDecision: string | null; ownerNote: string | null; approvedBy: string | null; approvalHash: string | null; previewHash: string | null; branchScope: string | null;
    /** §3.4 (Oct 27 2026): set when the period was canceled before anything was approved */
    canceledAt?: string | null; cancelReason?: string | null };
  statements: PayStatementDetail[]; totals: PaycheckWeekTotals; previousPayableCents: number | null; schedule: PayrollScheduleView; alreadySubmitted?: boolean;
  view?: PaycheckWeekView;
}
export interface PaycheckOpenWeekResult { periodId: string; created: boolean; periodStart: string; periodEnd: string; payDate: string; frequency?: string }
export interface PaycheckCancelPeriodRequest { reason: string; expectedVersion?: number | null }
/** §11.5: the technician's PIN + signature strokes (SVG path data: M/L x y …, ≤ 16 000 chars) on the manager's device */
export interface PaycheckSignatureAckRequest { pin: string; signature: string; deviceId?: string | null }
/** §11.5: the QR handoff code the manager's screen shows for one cash payout (the Tech App presents it) */
export interface PaycheckHandoffToken { payoutId: string; handoffCode: string; expiresAt: string }
/** the Tech App's confirmation body — with the handoff code when scanned / typed */
export interface PaycheckAckRequest { handoffCode?: string | null }
/** §12.4: the cash-envelope / check-run preparation report of an approved period */
export interface PaycheckPreparationLine { payoutId: string; statementId: string; statementNumber: string; technicianId: string; technicianName: string | null; method: string; amountCents: number; status: string; paid: boolean; checkNumber: string | null; checkStatus: string | null; cashSource: string | null; cashStatus: string | null; replacesPayoutId: string | null }
export interface PaycheckPreparationReport {
  period: PaycheckWeek['period']; technicians: number;
  checks: { lines: PaycheckPreparationLine[]; count: number; amountCents: number; toIssue: number; toDeliver: number; delivered: number };
  cash: { lines: PaycheckPreparationLine[]; count: number; amountCents: number; toPrepare: number; toHandOff: number; toAcknowledge: number; acknowledged: number; disputed: number; bySource: Record<string, { count: number; amountCents: number }> };
  other: { lines: PaycheckPreparationLine[]; count: number; amountCents: number };
  unplanned: Array<{ statementId: string; statementNumber: string; technicianId: string; technicianName: string | null; amountCents: number }>;
  totals: { payableCents: number; committedCents: number; unplannedCents: number; paidCents: number; unpaidCents: number; reconciles: boolean };
}

export interface PaycheckPlanRequest { policyType: PaycheckPolicyType; entries?: Array<{ method: string; basisPoints?: number | null; amountCents?: number | null }> | null; overrideReason?: string | null; expectedVersion?: number | null }
export interface PaycheckSubmitRequest { expectedVersion?: number | null }
export interface PaycheckApproveRequest { expectedVersion?: number | null; calculationHash?: string | null; holdTechnicianIds?: string[] | null }
export interface PaycheckDecisionRequest { note: string; expectedVersion?: number | null }
export interface PaycheckIssueCheckRequest { checkNumber: string }
export interface PaycheckVoidCheckRequest { reason: string; returned?: boolean | null; replacementCheckNumber?: string | null }
export interface PaycheckVoidCheckResult { voided: PaycheckPayout; replacement: PaycheckPayout | null }
export interface PaycheckPrepareCashRequest { cashSource: CashSource; registerId?: string | null; branchId?: string | null }
export interface PaycheckHandOffRequest { deviceId?: string | null }
export interface PaycheckPinAckRequest { pin: string; deviceId?: string | null }
export interface PaycheckResolveCashRequest { action: 'rehandoff' | 'cancel'; reason: string }
export interface PaycheckAddPayoutRequest { method: 'check' | 'cash'; amountCents?: number | null }
export interface PaycheckDisputeRequest { reason: string }

export interface PaycheckOwnerSummary { pendingOwnerApproval: number; approvedPayableCents: number; paidCents: number; unpaidCents: number; checkTotalCents: number; cashTotalCents: number; cashAwaitingHandoff: number; cashAwaitingHandoffCents: number; checksAwaitingDelivery: number; exceptionPayouts: number }
export interface PaycheckReport {
  range: string; from: string; to: string; statements: number;
  totals: { grossEarningsCents: number; approvedPayableCents: number; paidCents: number; unpaidCents: number; alreadyPaidCents: number; serviceCommissionCents: number; tipsCents: number; hourlyCents: number; retailCommissionCents: number; bonusCents: number; guaranteeTopUpCents: number; deductionsCents: number };
  byTechnician: Array<{ technicianId: string; technicianName: string | null; statements: number; grossEarningsCents: number; payableCents: number; paidCents: number; unpaidCents: number }>;
  byBranch: Array<{ branchId: string | null; branchName: string | null; serviceEarningsCents: number; tipsCents: number }>;
  byMethod: Record<string, { committedCents: number; paidCents: number; count: number }>;
  accounting: { compensationExpenseCents: number; settledByCheckCents: number; settledByCashCents: number; settledOtherCents: number; alreadyReceivedCents: number; unpaidCents: number; reconciles: boolean; rule: string };
  checkRegister: Array<PaycheckPayout & { technicianName: string | null }>;
  cashPayouts: Array<PaycheckPayout & { technicianName: string | null }>;
}

/** The Tech App (§15): estimated until the owner approves; then the approved, immutable statement. */
export interface TechPayStatementItem { id: string; periodId: string; statementNumber: string; periodStart: string; periodEnd: string; payDate: string | null; label: string | null; status: string; estimated: boolean; stage: string; amountCents: number; paidCents: number; unpaidCents: number }
export interface TechPayStatements { current: TechPayStatementItem | null; statements: TechPayStatementItem[]; cashWaiting: PaycheckPayout[] }
export interface TechPayStatementDetail extends PayStatement { salonName: string | null; periodStart: string | null; periodEnd: string | null; payDate: string | null; estimated: boolean; payouts: PaycheckPayout[] }

/** Weekly Paycheck 17.5 (Oct 27 2026): GET …/statements/{statementId}/pay-stub.pdf (POS, Owner App, Tech App) — the query.
 *  `lang` is the app's language; without it the signed-in person's (then the technician's) language is used. */
export interface PayStubQuery { lang?: 'en' | 'vi' }
/** The response: the PDF bytes (Content-Type application/pdf, Content-Disposition attachment, Cache-Control no-store),
 *  built by the server from the approved, locked statement. A client reads it as a Blob (api.exportAsync(…, 'blob')). */
export type PayStubPdf = Uint8Array;
