// POSPayrollScreen.test.tsx — Team › Payroll (Payroll mandate wave 2): the period workspace drives the review → approve
// (step-up, expected version + the preview hash) → pay flow, reopen asks for a reason, exports download through the
// authorized response, payouts / adjustments parse money with the shared parser, the tip re-split needs a reason once the
// ticket is paid, and the review / exceptions tabs act on their queues. Mocked API; no network.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { POSPayrollScreen } from './POSPayrollScreen';
import { posPayrollApi } from '../api/posPayrollApi';
import { posStepUpApi } from '../api/posStepUpApi';

vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { directory: vi.fn().mockResolvedValue([{ id: 'sam', fullName: 'Sam Lee' }, { id: 'ava', fullName: 'Ava Kim' }]) } }));
vi.mock('../api/posStepUpApi', () => ({ posStepUpApi: { stepUp: vi.fn().mockResolvedValue({ ok: true }) } }));
vi.mock('../api/posPayrollApi', () => ({
  posPayrollApi: {
    getState: vi.fn(), getPeriod: vi.fn(), createPeriod: vi.fn(), buildFromSales: vi.fn(), validation: vi.fn(), prepare: vi.fn(), sendBack: vi.fn(),
    finalize: vi.fn(), pay: vi.fn(), reopen: vi.fn(), payouts: vi.fn(), recordPayout: vi.fn(), setPayoutStatus: vi.fn(), exportPeriod: vi.fn(), exportHistory: vi.fn(), technician: vi.fn(),
    createAdjustment: vi.fn(), carryForward: vi.fn(), adjustments: vi.fn(), decideAdjustment: vi.fn(), exceptions: vi.fn(), exceptionAction: vi.fn(), inquiries: vi.fn(), respondInquiry: vi.fn(),
    provider: vi.fn(), payPlans: vi.fn(), createPayPlan: vi.fn(), archivePayPlan: vi.fn(), deductionTypes: vi.fn(), saveDeductionType: vi.fn(), ticketTip: vi.fn(), setTicketTip: vi.fn(),
  },
}));

const P = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'p1', label: 'Jun 1–15', periodStart: '2026-06-01', periodEnd: '2026-06-15', status, version: 4, previewHash: 'h'.repeat(64),
  dashboardStatus: status === 'review' ? 'READY_TO_APPROVE' : status === 'finalized' ? 'LOCKED' : status === 'paid' ? 'PAID' : 'OPEN', totalGrossCents: 200000, totalCommissionCents: 100000, totalTipsCents: 30000, totalPayableCents: 130000, ...extra });
const LINE = { id: 'l1', technicianId: 'sam', technicianName: 'Sam Lee', servicesCount: 8, grossSalesCents: 100000, commissionType: 'canonical', commissionValue: 0, commissionCents: 50000, tipsCents: 15000,
  adjustmentCents: 0, payableCents: 65000, netCents: 65000, paidCents: 0, outstandingCents: 65000 };
const detail = (status: string, extra: Record<string, unknown> = {}) => ({ period: P(status, extra), lines: [LINE], payouts: [], totals: { payableCents: 65000, paidCents: 0, outstandingCents: 65000 } });
const api = posPayrollApi as any;

beforeEach(() => {
  vi.clearAllMocks();
  api.getState.mockResolvedValue({ kpis: { totalPeriods: 1, openPeriods: 1, unpaidPayableCents: 130000, lifetimePayableCents: 130000, lifetimeCommissionCents: 100000, lifetimeTipsCents: 30000 }, periods: [P('review')], pagination: {} });
  api.getPeriod.mockResolvedValue(detail('review'));
  api.validation.mockResolvedValue({ ok: true, blocking: 0, warnings: 1, issues: [{ code: 'PENDING_ADJUSTMENTS', severity: 'warning', message: 'Some adjustments are waiting for a decision.', count: 1 }] });
  api.exportHistory.mockResolvedValue([]); api.provider.mockResolvedValue({ configured: false, provider: null, capabilities: [], reason: 'none' });
  api.adjustments.mockResolvedValue([]); api.exceptions.mockResolvedValue([]); api.inquiries.mockResolvedValue([]); api.payPlans.mockResolvedValue([]); api.deductionTypes.mockResolvedValue([]);
});

async function openPeriod() { render(<POSPayrollScreen />); fireEvent.click(await screen.findByText('Jun 1–15')); await screen.findByText('Sam Lee'); }

describe('POSPayrollScreen (wave 2)', () => {
  it('shows the dashboard status, the checks and per-technician paid / outstanding', async () => {
    await openPeriod();
    expect(screen.getAllByText('Ready to approve').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Some adjustments are waiting/)).toBeInTheDocument();
    expect(screen.getByText('No payroll provider connected — use the CSV / Excel export')).toBeInTheDocument();
    expect(screen.getAllByText('$650.00').length).toBeGreaterThanOrEqual(2);   // payable + outstanding
  });

  it('approve sends the version + the preview hash; a STEP_UP_REQUIRED answer asks for the password and retries once', async () => {
    api.finalize.mockRejectedValueOnce(Object.assign(new Error('confirm'), { code: 'STEP_UP_REQUIRED', status: 403 })).mockResolvedValueOnce({ period: P('finalized') });
    await openPeriod();
    fireEvent.click(screen.getByText('Approve'));
    fireEvent.change(await screen.findByLabelText('Your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(api.finalize).toHaveBeenCalledTimes(2));
    expect(api.finalize).toHaveBeenLastCalledWith('p1', { expectedVersion: 4, calculationHash: 'h'.repeat(64) });
    expect(posStepUpApi.stepUp).toHaveBeenCalledWith({ password: 'pw' });
  });

  it('a version conflict is explained and the period reloads', async () => {
    api.finalize.mockRejectedValue(Object.assign(new Error('Someone else changed this payroll period.'), { code: 'PAYROLL_VERSION_CONFLICT', status: 409 }));
    await openPeriod();
    fireEvent.click(screen.getByText('Approve'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/someone else changed/i);
    await waitFor(() => expect(api.getPeriod).toHaveBeenCalledTimes(2));   // opened, then re-read after the conflict
  });

  it('reopen requires a written reason (inline, no native dialog)', async () => {
    api.getPeriod.mockResolvedValue(detail('finalized'));
    api.reopen.mockResolvedValue({});
    await openPeriod();
    fireEvent.click(screen.getByText('Reopen…'));
    const input = screen.getByLabelText('Why is this approved period being reopened?');
    fireEvent.click(screen.getByText('Reopen'));
    expect(await screen.findByText('Write a short reason.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Missed a refund' } });
    fireEvent.click(screen.getByText('Reopen'));
    await waitFor(() => expect(api.reopen).toHaveBeenCalledWith('p1', 'Missed a refund', 4));
  });

  it('a payout amount goes through the shared money parser and cannot exceed what is owed', async () => {
    api.getPeriod.mockResolvedValue(detail('finalized'));
    api.recordPayout.mockResolvedValue({});
    await openPeriod();
    fireEvent.click(screen.getByText('Record payout'));
    fireEvent.change(screen.getByLabelText('Payout amount'), { target: { value: '1e3' } });
    fireEvent.click(screen.getByText('Record'));
    expect(await screen.findByText('Enter a valid amount.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payout amount'), { target: { value: '700.00' } });
    fireEvent.click(screen.getByText('Record'));
    expect(await screen.findByText('That is more than this technician is owed.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payout amount'), { target: { value: '200.05' } });
    fireEvent.click(screen.getByText('Record'));
    await waitFor(() => expect(api.recordPayout).toHaveBeenCalledWith('p1', expect.objectContaining({ technicianId: 'sam', amountCents: 20005, method: 'cash', status: 'paid' })));
  });

  it('mark paid sends the method and reference', async () => {
    api.getPeriod.mockResolvedValue(detail('finalized'));
    api.pay.mockResolvedValue({});
    await openPeriod();
    fireEvent.click(screen.getByText('Mark paid…'));
    fireEvent.change(screen.getByLabelText('Payment reference'), { target: { value: 'ACH-0612' } });
    fireEvent.click(screen.getByText('Mark paid'));
    await waitFor(() => expect(api.pay).toHaveBeenCalledWith('p1', { expectedVersion: 4, method: 'direct_deposit', reference: 'ACH-0612' }));
  });

  it('export downloads the bytes from the authorized response (no public link)', async () => {
    api.exportPeriod.mockResolvedValue({ filename: 'payroll.csv', mimeType: 'text/csv', base64: btoa('a,b\r\n'), sha256: 'x', rowCount: 1 });
    const create = vi.fn(() => 'blob:x'); (URL as any).createObjectURL = create; (URL as any).revokeObjectURL = vi.fn();
    await openPeriod();
    fireEvent.click(screen.getByText('Export CSV'));
    await waitFor(() => expect(api.exportPeriod).toHaveBeenCalledWith('p1', 'csv'));
    await waitFor(() => expect(create).toHaveBeenCalled());
  });

  it('a draft period offers build / prepare and an adjustment form with a reason code (a deduction needs a type)', async () => {
    api.getPeriod.mockResolvedValue(detail('draft'));
    api.prepare.mockResolvedValue({ validation: { ok: true, blocking: 0, warnings: 0, issues: [] } });
    api.createAdjustment.mockResolvedValue({});
    await openPeriod();
    fireEvent.click(screen.getByText('Prepare for review'));
    await waitFor(() => expect(api.prepare).toHaveBeenCalledWith('p1', 4));
    fireEvent.click(screen.getByText('+ Adjustment / bonus / deduction'));
    fireEvent.change(screen.getByLabelText('Adjustment type'), { target: { value: 'deduction' } });
    fireEvent.change(screen.getByLabelText('Adjustment amount'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Adjustment explanation'), { target: { value: 'Kit' } });
    fireEvent.click(screen.getByText('Add'));
    expect(await screen.findByText(/Turn on a deduction type/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Adjustment type'), { target: { value: 'commission_correction' } });
    fireEvent.change(screen.getByLabelText('Adjustment direction'), { target: { value: '-1' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(api.createAdjustment).toHaveBeenCalledWith('p1', expect.objectContaining({ category: 'commission_correction', amountCents: -1200, reasonCode: 'performance_bonus', reason: 'Kit' })));
  });

  it('the technician drawer re-splits a PAID ticket tip only with a reason, and the split must add up', async () => {
    api.technician.mockResolvedValue({ line: { ...LINE, cardTipCents: 2101 }, services: [], tips: [{ ticketId: 't1', day: '2026-06-10', cardTipCents: 2101, cashTipCents: 0 }], adjustments: [], payouts: [] });
    api.ticketTip.mockResolvedValue({ ticketId: 't1', tipCents: 2101, status: 'paid', locked: true, allocations: [{ technicianId: 'sam', name: 'Sam Lee', tipCents: 1051 }, { technicianId: 'ava', name: 'Ava Kim', tipCents: 1050 }] });
    api.setTicketTip.mockResolvedValue({});
    await openPeriod();
    fireEvent.click(screen.getAllByText('Sam Lee')[0]);
    fireEvent.click(await screen.findByText('Re-split'));
    fireEvent.change(await screen.findByLabelText('Tip for Sam Lee'), { target: { value: '15.00' } });
    fireEvent.click(screen.getByText('Save split'));
    expect(await screen.findByText('The split must add up to the ticket tip exactly.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tip for Ava Kim'), { target: { value: '6.01' } });
    fireEvent.click(screen.getByText('Save split'));
    expect(await screen.findByText('Give a reason for the tip adjustment.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tip adjustment reason'), { target: { value: 'Customer asked' } });
    fireEvent.click(screen.getByText('Save split'));
    await waitFor(() => expect(api.setTicketTip).toHaveBeenCalledWith('t1', { allocations: [{ technicianId: 'sam', tipCents: 1500 }, { technicianId: 'ava', tipCents: 601 }], reason: 'Customer asked' }));
  });

  it('review and exceptions tabs act on their queues', async () => {
    api.adjustments.mockResolvedValue([{ id: 'a1', technicianId: 'sam', category: 'chargeback_reversal', amountCents: -1200, source: 'chargeback', chargebackId: 'cb', reason: 'Chargeback received', status: 'pending_review' }]);
    api.decideAdjustment.mockResolvedValue({});
    api.exceptions.mockResolvedValue([{ id: 'e1', kind: 'missing_snapshot', severity: 'blocking', ticketId: 'abcdef1234', attempts: 2, lastError: 'db timeout' }]);
    api.exceptionAction.mockResolvedValue({});
    render(<POSPayrollScreen />);
    fireEvent.click(await screen.findByText('Adjustments to review'));
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(api.decideAdjustment).toHaveBeenCalledWith('a1', 'approve', undefined));
    fireEvent.click(screen.getByText('Exceptions'));
    expect(await screen.findByText('Paid ticket without a commission record')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry now'));
    await waitFor(() => expect(api.exceptionAction).toHaveBeenCalledWith('e1', 'retry', undefined));
  });
  it('searching a technician name asks the server which periods pay them (batch 9)', async () => {
    render(<POSPayrollScreen />);
    await screen.findByText('Jun 1–15');
    api.getState.mockResolvedValueOnce({ kpis: {}, periods: [{ id: 'p1' }], pagination: {} });
    fireEvent.change(screen.getByTestId('payroll-search'), { target: { value: 'Sam Lee' } });
    await waitFor(() => expect(api.getState).toHaveBeenCalledWith({ technician: 'Sam Lee', pageSize: 200 }));
    expect(await screen.findByText('Jun 1–15')).toBeInTheDocument();   // not in the label — shown because Sam is paid in it
  });
});
