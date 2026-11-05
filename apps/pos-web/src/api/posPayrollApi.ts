// posPayrollApi.ts — payroll client. Reads tenant-scoped payroll state + period detail and drives periods/lines/
// lifecycle. All endpoints guarded + tenant-scoped server-side.
// Payroll mandate wave 2 (Oct 12 2026): prepare / send back / approve (step-up, expected version, approval hash) / reopen
// (reason, step-up) / pay (method, step-up) / payouts / export (CSV, XLSX — the bytes come back on this authorized
// response only, never a public link) / adjustments + decisions / exceptions / technician inquiries / pay plans /
// deduction types / provider status. The server decides every figure; this client never sends a computed amount except a
// payout the server bounds against what is owed.
import { api } from './client';
import type {
  PayrollScheduleView, PayrollScheduleRequest, PaycheckWeek, PaycheckOpenWeekResult, PayStatementDetail, PaycheckPlanRequest, PaycheckPayout, PaycheckVoidCheckResult,
  PaycheckPrepareCashRequest, PaycheckOwnerSummary, PaycheckReport, PaycheckPreparationReport, PaycheckHandoffToken, PayrollTechnicianDetail,
} from '@aipowersalon/api-contracts/tenant';

export const posPayrollApi = {
  getState: (q?: Record<string, unknown>) => api.get<any>('/pos/payroll/state', q),
  getPeriod: (id: string) => api.get<any>(`/pos/payroll/periods/${id}`),
  createPeriod: (body: Record<string, unknown>) => api.post<any>('/pos/payroll/periods', body),
  buildFromSales: (id: string) => api.post<any>(`/pos/payroll/periods/${id}/build-from-sales`),
  validation: (id: string) => api.get<any>(`/pos/payroll/periods/${id}/validation`),
  prepare: (id: string, expectedVersion?: number) => api.post<any>(`/pos/payroll/periods/${id}/prepare`, { expectedVersion: expectedVersion ?? null }),
  sendBack: (id: string, reason: string, expectedVersion?: number) => api.post<any>(`/pos/payroll/periods/${id}/send-back`, { reason, expectedVersion: expectedVersion ?? null }),
  finalize: (id: string, body: { expectedVersion?: number; calculationHash?: string | null } = {}) => api.post<any>(`/pos/payroll/periods/${id}/finalize`, { expectedVersion: body.expectedVersion ?? null, calculationHash: body.calculationHash ?? null }),
  pay: (id: string, body: { expectedVersion?: number; method: string; reference?: string }) => api.post<any>(`/pos/payroll/periods/${id}/pay`, { expectedVersion: body.expectedVersion ?? null, method: body.method, reference: body.reference || null }),
  reopen: (id: string, reason: string, expectedVersion?: number) => api.post<any>(`/pos/payroll/periods/${id}/reopen`, { reason, expectedVersion: expectedVersion ?? null }),
  payouts: (id: string) => api.get<any[]>(`/pos/payroll/periods/${id}/payouts`),
  recordPayout: (id: string, body: { technicianId: string; amountCents: number; method: string; status?: 'pending' | 'paid'; reference?: string; note?: string; idempotencyKey?: string }) => api.post<any>(`/pos/payroll/periods/${id}/payouts`, body as Record<string, unknown>),
  setPayoutStatus: (payoutId: string, body: { status: string; failureReason?: string; reference?: string }) => api.post<any>(`/pos/payroll/payouts/${payoutId}/status`, body as Record<string, unknown>),
  exportPeriod: (id: string, format: 'csv' | 'xlsx') => api.post<{ filename: string; mimeType: string; base64: string; sha256: string; rowCount: number }>(`/pos/payroll/periods/${id}/export`, { format }),
  exportHistory: (id: string) => api.get<any[]>(`/pos/payroll/periods/${id}/exports`),
  technician: (id: string, techId: string) => api.get<any>(`/pos/payroll/periods/${id}/technicians/${techId}`),
  createAdjustment: (id: string, body: { technicianId: string; category: string; amountCents: number; reasonCode: string; reason: string; deductionType?: string; idempotencyKey?: string }) => api.post<any>(`/pos/payroll/periods/${id}/adjustments`, body as Record<string, unknown>),
  carryForward: (id: string, techId: string) => api.post<any>(`/pos/payroll/periods/${id}/technicians/${techId}/carry-forward`),
  adjustments: (q?: Record<string, unknown>) => api.get<any[]>('/pos/payroll/adjustments', q),
  decideAdjustment: (adjId: string, decision: 'approve' | 'reject', reason?: string) => api.post<any>(`/pos/payroll/adjustments/${adjId}/decide`, { decision, reason: reason || null }),
  exceptions: (q?: Record<string, unknown>) => api.get<any[]>('/pos/payroll/exceptions', q),
  exceptionAction: (exId: string, action: 'resolve' | 'dismiss' | 'retry', note?: string) => api.post<any>(`/pos/payroll/exceptions/${exId}/action`, { action, note: note || null }),
  inquiries: (q?: Record<string, unknown>) => api.get<any[]>('/pos/payroll/inquiries', q),
  respondInquiry: (inqId: string, body: { response: string; privateNote?: string; close?: boolean }) => api.post<any>(`/pos/payroll/inquiries/${inqId}/respond`, body as Record<string, unknown>),
  provider: () => api.get<{ configured: boolean; provider: string | null; capabilities: string[]; reason: string | null }>('/pos/payroll/provider'),
  payPlans: (q?: Record<string, unknown>) => api.get<any[]>('/pos/payroll/pay-plans', q),
  createPayPlan: (body: Record<string, unknown>) => api.post<any>('/pos/payroll/pay-plans', body),
  archivePayPlan: (planId: string) => api.post<any>(`/pos/payroll/pay-plans/${planId}/archive`),
  deductionTypes: () => api.get<any[]>('/pos/payroll/deduction-types'),
  saveDeductionType: (body: { key: string; label: string; enabled?: boolean; maxCentsPerPeriod?: number | null }) => api.post<any>('/pos/payroll/deduction-types', body as Record<string, unknown>),
  // §28 manual tip split on a ticket (tips.adjust): the current split + who worked it, and the save (a paid ticket needs a reason)
  ticketTip: (ticketId: string) => api.get<{ ticketId: string; tipCents: number; status: string; locked: boolean; allocations: { technicianId: string; name: string | null; tipCents: number }[] }>(`/pos/tickets/${ticketId}/tip-allocation`),
  /** D15/D19 gaps (Nov 5 2026): a free-form tip adjustment on a paid ticket (one technician, signed amount, reason) — once per key */
  adjustTicketTip: (ticketId: string, body: { technicianId: string; amountCents: number; reason: string }, idempotencyKey: string) => api.post<{ ok: true; amountCents: number; earnedCents: number; routedToNextPeriod: boolean }>(`/pos/tickets/${ticketId}/tip-adjustments`, body as unknown as Record<string, unknown>, { 'Idempotency-Key': idempotencyKey }),
  setTicketTip: (ticketId: string, body: { allocations: { technicianId: string; tipCents: number }[]; reason?: string }) => api.post<any>(`/pos/tickets/${ticketId}/tip-allocation`, body as unknown as Record<string, unknown>),
  // ── Weekly Paycheck (Oct 21 2026): the week → statements → payout split → submit → owner → checks + cash ──────────
  paySchedule: () => api.get<PayrollScheduleView>('/pos/payroll/paychecks/schedule'),
  savePaySchedule: (body: PayrollScheduleRequest) => api.post<PayrollScheduleView>('/pos/payroll/paychecks/schedule', { ...body }),
  openWeek: () => api.post<PaycheckOpenWeekResult>('/pos/payroll/paychecks/open-week'),
  paySummary: () => api.get<PaycheckOwnerSummary>('/pos/payroll/paychecks/summary'),
  payReport: (q: { range: string; from?: string; to?: string }) => api.get<PaycheckReport>('/pos/payroll/paychecks/reports', q as Record<string, unknown>),
  // §66/§67 (200-technician mandate): the owner's review filter — exceptions only · a technician · a branch (totals stay the week's)
  payWeek: (periodId: string, f: { exceptionsOnly?: boolean; search?: string; branchId?: string } = {}) => {
    const q = new URLSearchParams();
    if (f.exceptionsOnly) q.set('exceptionsOnly', '1');
    if (f.search?.trim()) q.set('search', f.search.trim());
    if (f.branchId) q.set('branchId', f.branchId);
    const qs = q.toString();
    return api.get<PaycheckWeek>(`/pos/payroll/paychecks/periods/${periodId}${qs ? `?${qs}` : ''}`);
  },
  payCalculate: (periodId: string) => api.post<PaycheckWeek>(`/pos/payroll/paychecks/periods/${periodId}/calculate`),
  payApplyDefault: (periodId: string) => api.post<PaycheckWeek>(`/pos/payroll/paychecks/periods/${periodId}/apply-default`),
  paySubmit: (periodId: string, expectedVersion?: number) => api.post<PaycheckWeek>(`/pos/payroll/paychecks/periods/${periodId}/submit`, { expectedVersion: expectedVersion ?? null }),
  payApprove: (periodId: string, body: { expectedVersion?: number; holdTechnicianIds?: string[] }) => api.post<PaycheckWeek>(`/pos/payroll/paychecks/periods/${periodId}/approve`, { expectedVersion: body.expectedVersion ?? null, holdTechnicianIds: body.holdTechnicianIds ?? [] }),
  payReturn: (periodId: string, note: string, expectedVersion?: number) => api.post<PaycheckWeek>(`/pos/payroll/paychecks/periods/${periodId}/return`, { note, expectedVersion: expectedVersion ?? null }),
  payReject: (periodId: string, note: string, expectedVersion?: number) => api.post<PaycheckWeek>(`/pos/payroll/paychecks/periods/${periodId}/reject`, { note, expectedVersion: expectedVersion ?? null }),
  payStatement: (statementId: string) => api.get<PayStatementDetail>(`/pos/payroll/paychecks/statements/${statementId}`),
  /** 17.5 (Oct 27 2026): an approved statement's pay stub — the PDF built from the locked snapshot, in the POS language */
  payStub: (statementId: string, lang: string) => api.exportAsync<Blob>(`/pos/payroll/paychecks/statements/${encodeURIComponent(statementId)}/pay-stub.pdf`, { lang }, 'blob'),
  payPlan: (statementId: string, body: PaycheckPlanRequest) => api.post<PayStatementDetail>(`/pos/payroll/paychecks/statements/${statementId}/payout-plan`, { ...body }),
  payApproveHeld: (statementId: string) => api.post<PayStatementDetail>(`/pos/payroll/paychecks/statements/${statementId}/approve`),
  payAddPayout: (statementId: string, body: { method: 'check' | 'cash'; amountCents?: number | null }) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/statements/${statementId}/payouts`, { ...body }),
  checkIssue: (payoutId: string, checkNumber: string) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/check/issue`, { checkNumber }),
  checkDeliver: (payoutId: string) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/check/deliver`),
  checkClear: (payoutId: string) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/check/clear`),
  checkVoid: (payoutId: string, body: { reason: string; returned?: boolean; replacementCheckNumber?: string | null }) => api.post<PaycheckVoidCheckResult>(`/pos/payroll/paychecks/payouts/${payoutId}/check/void`, { ...body }),
  cashPrepare: (payoutId: string, body: PaycheckPrepareCashRequest) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/cash/prepare`, { ...body }),
  cashHandOff: (payoutId: string, deviceId?: string | null) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/cash/handoff`, { deviceId: deviceId ?? null }),
  cashAckPin: (payoutId: string, pin: string) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/cash/acknowledge-pin`, { pin }),
  cashResolve: (payoutId: string, body: { action: 'rehandoff' | 'cancel'; reason: string }) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/cash/resolve`, { ...body }),
  // Weekly Paycheck close-out (Oct 27 2026): cancel a draft period (§3.4); the preparation report (§12.4); the evidence behind a
  // statement (§8.4); the QR handoff code, PIN + signature and manager + technician confirmations (§11.5)
  payCancelPeriod: (periodId: string, reason: string, expectedVersion?: number) => api.post<PaycheckWeek>(`/pos/payroll/paychecks/periods/${periodId}/cancel`, { reason, expectedVersion: expectedVersion ?? null }),
  payPreparation: (periodId: string) => api.get<PaycheckPreparationReport>(`/pos/payroll/paychecks/periods/${periodId}/preparation`),
  payEvidence: (periodId: string, technicianId: string) => api.get<PayrollTechnicianDetail>(`/pos/payroll/paychecks/periods/${periodId}/technicians/${technicianId}/evidence`),
  cashHandoffToken: (payoutId: string) => api.post<PaycheckHandoffToken>(`/pos/payroll/paychecks/payouts/${payoutId}/cash/handoff-token`),
  cashAckSignature: (payoutId: string, body: { pin: string; signature: string }) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/cash/acknowledge-signature`, { ...body }),
  cashAckDual: (payoutId: string, pin: string) => api.post<PaycheckPayout>(`/pos/payroll/paychecks/payouts/${payoutId}/cash/acknowledge-dual`, { pin }),
};
