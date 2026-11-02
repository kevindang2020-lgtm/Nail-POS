// payroll.ts — the payroll review / approval / payout / export wire types (Payroll mandate wave 2, Oct 12 2026).
// Server: modules/workforce payroll (PayrollWorkflowService, payroll.controller.ts); clients: pos-web posPayrollApi,
// tech-web techApi (the Tech App's own payroll lives in ./tech). Money is integer cents; dates are ISO strings.

export type PayrollIssueSeverity = 'blocking' | 'warning';
export interface PayrollValidationIssue { code: string; severity: PayrollIssueSeverity; message: string; count: number; technicianIds?: string[]; ticketIds?: string[] }
/** §143–§145: the pre-approval checks — approval is refused while `blocking` > 0. */
export interface PayrollValidationResult { ok: boolean; blocking: number; warnings: number; issues: PayrollValidationIssue[]; checkedAt: string }

/** A period read with its lines, payouts and paid / outstanding totals (§78). Lines keep the existing line shape. */
export interface PayrollPeriodWorkflowResult {
  period: { id: string; status: string; version?: number; previewHash?: string | null; approvalHash?: string | null; dashboardStatus?: string };
  lines: { technicianId: string; payableCents: number; paidCents?: number; outstandingCents?: number }[];
  payouts?: PayrollPayout[];
  totals?: { payableCents: number; paidCents: number; outstandingCents: number; committedCents: number };
  validation?: PayrollValidationResult | unknown;
  alreadyPaid?: boolean; payoutsCreated?: number; alreadyPrepared?: boolean;
}
export interface PayrollPrepareRequest { expectedVersion?: number | null }
export interface PayrollSendBackRequest { reason?: string | null; expectedVersion?: number | null }
export interface PayrollApproveRequest { expectedVersion?: number | null; calculationHash?: string | null }
export interface PayrollPayRequest { expectedVersion?: number | null; method?: PayoutMethod | null; reference?: string | null }

export type PayoutMethod = 'cash' | 'check' | 'direct_deposit' | 'external_provider' | 'other';
export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'canceled';
export interface PayrollPayout { id: string; periodId: string; technicianId: string; amountCents: number; method: PayoutMethod; status: PayoutStatus; reference: string | null; note: string | null; failureReason: string | null; paidAt: string | null; createdBy: string | null; createdAt: string }
export interface PayrollPayoutRequest { technicianId: string; amountCents: number; method: PayoutMethod; status?: 'pending' | 'paid' | null; reference?: string | null; note?: string | null; idempotencyKey?: string | null }
export interface PayrollPayoutStatusRequest { status: 'processing' | 'paid' | 'failed' | 'canceled'; failureReason?: string | null; reference?: string | null }

export interface PayrollExportRequest { format: 'csv' | 'xlsx' }
/** §82–§84: the file comes back on the authorized response only (never a public URL); its sha256 is in the audit row. */
export interface PayrollExportFile { filename: string; mimeType: string; base64: string; sha256: string; rowCount: number }
export interface PayrollExportRecord { id: string; format: string; rowCount: number; sha256: string; periodStatus: string; periodVersion: number; exportedBy: string | null; createdAt: string }

export interface PayrollAdjustment {
  id: string; technicianId: string | null; ticketId: string | null; periodId: string | null; originalPeriodId: string | null; category: string; amountCents: number;
  reason: string; reasonCode: string | null; deductionType: string | null; status: string; source: string; requestedBy: string | null; decidedBy: string | null;
  decidedAt: string | null; decisionReason: string | null; createdAt: string; chargebackId: string | null;
}
export interface PayrollAdjustmentRequest { technicianId: string; category: 'bonus' | 'commission_correction' | 'guarantee_correction' | 'payroll_correction' | 'deduction'; amountCents: number; reasonCode: string; reason: string; deductionType?: string | null; idempotencyKey?: string | null }
export interface PayrollAdjustmentCreated { adjustment: PayrollAdjustment; replay: boolean; requiresApproval: boolean }
export interface PayrollAdjustmentDecisionRequest { decision: 'approve' | 'reject'; reason?: string | null }
export interface PayrollCarryForwardResult { n: number; nextPeriodId: string; amountCents: number }

/** The technician drill-down (§86–§88, §93): services from the snapshot, tips by ticket, adjustments, payouts. */
export interface PayrollTechnicianDetail {
  period: { id: string; status: string }; window: { fromIso: string; toIso: string; timezone: string };
  line: { technicianId: string; payableCents: number } | null;
  services: { serviceName: string; lineTotalCents: number; commissionCents: number; completedAt: string; ticketId: string; ruleSource: string | null }[];
  tips: { ticketId: string; cardTipCents: number; cashTipCents: number }[];
  /** Weekly Paycheck §8.4 (Oct 27 2026): the time-clock evidence behind hourly pay */
  hours?: PayrollHoursEvidence;
  adjustments: PayrollAdjustment[]; payouts: PayrollPayout[];
}
export interface PayrollHoursEntry {
  shiftId: string; branchId: string | null; shiftDate: string; clockedInAt: string | null; clockedOutAt: string | null; open: boolean; status: string;
  scheduledMinutes: number; workedMinutes: number; breakMinutes: number; paidMinutes: number;
  breaks: Array<{ id: string; kind: string; startedAt: string; endedAt: string | null }>;
}
export interface PayrollHoursEvidence {
  technicianName: string | null;
  plan: { id: string; payType: string; hourlyRateCents: number | null; salaryCentsPerPeriod: number | null; breaksPaid: boolean; overtimeWeeklyMinutes: number; effectiveStart: string; effectiveEnd: string | null } | null;
  entries: PayrollHoursEntry[]; openEntries: number;
  totals: { scheduledMinutes: number; workedMinutes: number; breakMinutes: number; paidMinutes: number; potentialOvertimeMinutes: number; computedHourlyPayCents: number; lineHourlyPayCents: number; lineWorkedMinutes: number; lineSalaryPayCents: number; matchesLine: boolean };
}

export interface PayrollExceptionRow {
  id: string; kind: string; severity: PayrollIssueSeverity; status: 'open' | 'retrying' | 'resolved' | 'dismissed'; ticketId: string | null; periodId: string | null;
  technicianId: string | null; attempts: number; lastError: string | null; nextAttemptAt: string | null; detail: Record<string, unknown> | null;
  resolutionNote: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
}
export interface PayrollExceptionActionRequest { action: 'resolve' | 'dismiss' | 'retry'; note?: string | null }
export interface PayrollExceptionActionResult { ok: boolean; exception: PayrollExceptionRow | null }

export interface PayrollInquiryView { id: string; technicianId: string; technicianName: string | null; periodId: string | null; subjectType: string; subjectId: string | null; message: string; status: string; response: string | null; privateNote: string | null; respondedAt: string | null; createdAt: string }
export interface PayrollInquiryRespondRequest { response: string; privateNote?: string | null; close?: boolean | null }
export interface PayrollInquiryRespondResult { id: string; status: string }
/** §152: what the Tech App sends (the technician is the session's). */
export interface TechPayrollInquiryRequest { message: string; periodId?: string | null; subjectType?: string | null; subjectId?: string | null }

export interface PayrollPayPlan { id: string; technicianId: string; branchId: string | null; payType: 'commission' | 'hourly' | 'salary' | 'hybrid'; hourlyRateCents: number | null; salaryCentsPerPeriod: number | null; breaksPaid: boolean; overtimeWeeklyMinutes: number; effectiveStart: string; effectiveEnd: string | null; status: 'active' | 'archived'; note: string | null; createdAt?: string }
export interface PayrollPayPlanRequest { technicianId: string; branchId?: string | null; payType: string; hourlyRateCents?: number | null; salaryCentsPerPeriod?: number | null; breaksPaid?: boolean | null; overtimeWeeklyMinutes?: number | null; effectiveStart: string; effectiveEnd?: string | null; note?: string | null }
export interface PayrollDeductionType { id: string; key: string; label: string; enabled: boolean; maxCentsPerPeriod: number | null }
export interface PayrollDeductionTypeRequest { key: string; label: string; enabled?: boolean | null; maxCentsPerPeriod?: number | null }
export interface PayrollProviderStatus { configured: boolean; provider: string | null; capabilities: string[]; reason: string | null }

/** §28: a ticket's current tip split + every technician who worked it (the POS re-split editor). */
export interface TicketTipAllocationView { ticketId: string; tipCents: number; status: string; locked: boolean; allocations: { technicianId: string; name: string | null; tipCents: number }[] }
