// OwnerPaycheckPanel — Weekly Paycheck §9 in the Owner App: what the manager submitted (payable, check / cash, the
// custom split and its reason), APPROVE ALL or hold selected with the PIN, RETURN / REJECT with a note. Mocked API.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/ownerApi', () => ({ ownerPayrollApi: { paycheckWeek: vi.fn(), paycheckApprove: vi.fn(), paycheckReturn: vi.fn(), paycheckReject: vi.fn(), paycheckApproveHeld: vi.fn(), paycheckSummary: vi.fn(), paycheckEvidence: vi.fn(), paycheckPayStub: vi.fn() }, ownerContextApi: { context: vi.fn() } }));
import { ownerPayrollApi, ownerContextApi } from '../api/ownerApi';
import '../i18n/catalog';
import { OwnerPaycheckPanel } from './OwnerPaycheckPanel';

const api = ownerPayrollApi as any;
const plan = (check: number, cash: number, differs = false) => ({ id: 'pl', policyType: differs ? 'manual_amount' : 'split_check_cash', payableCents: check + cash, status: 'submitted', differsFromDefault: differs, overrideReason: differs ? 'Ana asked for more on the check' : null, version: 1,
  instructions: [{ id: 'i1', method: 'check', amountCents: check, basisPoints: null, sequence: 1, status: 'planned', payoutId: null }, { id: 'i2', method: 'cash', amountCents: cash, basisPoints: null, sequence: 2, status: 'planned', payoutId: null }], issues: [] });
const st = (id: string, tech: string, name: string, check: number, cash: number, differs = false) => ({ id, periodId: 'p1', technicianId: tech, technicianName: name, statementNumber: `PAY-2026-00012${id.slice(-1)}`, status: 'submitted', reviewRequired: false, version: 2,
  serviceCommissionCents: check + cash, hourlyPayCents: 0, salaryPayCents: 0, tipsCents: 0, cardTipCents: 0, cashTipCents: 0, retailCommissionCents: 0, bonusCents: 0, guaranteeTopUpCents: 0, positiveAdjustmentsCents: 0, deductionsCents: 0, reversalsCents: 0,
  grossEarningsCents: check + cash, linePayableCents: check + cash, alreadyPaidCents: 0, approvedPayableCents: check + cash, paidCents: 0, unpaidCents: check + cash, branchBreakdown: [], submittedAt: '2026-10-20T12:00:00Z', approvedAt: null, approvedBy: null, lockedAt: null, voidedAt: null, createdAt: null,
  plan: plan(check, cash, differs), payouts: [] });
const week = () => ({ period: { id: 'p1', label: null, periodStart: '2026-10-12', periodEnd: '2026-10-18', payDate: '2026-10-23', status: 'review', payoutStatus: 'none', version: 4, submittedBy: 'm1', submittedAt: '2026-10-20T12:00:00Z', ownerDecision: null, ownerNote: null, approvedBy: null, approvalHash: null, previewHash: 'h', branchScope: null },
  statements: [st('s1', 't1', 'Mia Chen', 75000, 75000), st('s2', 't2', 'Ana Ruiz', 30000, 20000, true)],
  totals: { technicians: 2, grossEarningsCents: 200000, alreadyPaidCents: 0, payableCents: 200000, checkCents: 105000, cashCents: 95000, otherCents: 0, paidCents: 0, unpaidCents: 200000, exceptions: 0, overrides: 1 }, previousPayableCents: 180000, schedule: {} as any });
const onChanged = vi.fn();
beforeEach(() => { vi.clearAllMocks(); api.paycheckWeek.mockResolvedValue(week()); api.paycheckApprove.mockResolvedValue(week()); api.paycheckReturn.mockResolvedValue(week()); api.paycheckReject.mockResolvedValue(week()); api.paycheckSummary.mockResolvedValue({ pendingOwnerApproval: 1, approvedPayableCents: 0, paidCents: 0, unpaidCents: 0, checkTotalCents: 0, cashTotalCents: 0, cashAwaitingHandoff: 2, cashAwaitingHandoffCents: 95000, checksAwaitingDelivery: 1, exceptionPayouts: 0 }); });

describe('OwnerPaycheckPanel', () => {
  it('shows what the manager submitted: payable, check / cash and the custom split', () => {
    render(<OwnerPaycheckPanel week={week() as any} onChanged={onChanged} />);
    expect(screen.getByText('Payroll approval required')).toBeInTheDocument();
    expect(screen.getAllByText('$2,000.00').length).toBeGreaterThan(0);   // payable (and unpaid)
    expect(screen.getByText('$1,050.00')).toBeInTheDocument();          // by check
    expect(screen.getByText(/1 custom split/)).toBeInTheDocument();
    return screen.findByText(/2 cash envelopes \(\$950\.00\) to hand over/);
    fireEvent.click(screen.getByText(/Ana Ruiz/));
    expect(screen.getByText('Ana asked for more on the check')).toBeInTheDocument();
  });
  it('§66/§67: "Show exceptions only" asks the server for the narrowed week; each exception is named on its row', async () => {
    const w = week(); (w.statements[0] as Record<string, unknown>).exceptions = [{ code: 'MISSING_CLOCK_OUT', message: 'Still clocked in for this week (no clock-out).' }];
    render(<OwnerPaycheckPanel week={w as any} onChanged={onChanged} />);
    expect(screen.getByText(/Still clocked in for this week/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show exceptions only'));
    await waitFor(() => expect(api.paycheckWeek).toHaveBeenCalledWith('p1', { exceptionsOnly: true, search: '', branchId: '' }));
    fireEvent.change(screen.getByLabelText('Search technician'), { target: { value: 'Mia' } });
    fireEvent.keyDown(screen.getByLabelText('Search technician'), { key: 'Enter' });
    await waitFor(() => expect(api.paycheckWeek).toHaveBeenLastCalledWith('p1', { exceptionsOnly: true, search: 'Mia', branchId: '' }));
    expect(onChanged).toHaveBeenCalled();
  });
  it('§66: Filter Branch — the owner\'s assigned branches; picking one asks the server for that branch', async () => {
    (ownerContextApi as any).context.mockResolvedValue({ ownerUserId: 'o', tenantId: 't', canViewAllAssignedBranches: true, allowedBranches: [
      { branchId: 'b1', tenantId: 't', salonName: 'Lux', branchName: 'Cherry Hill', timezone: 'America/New_York', accessLevel: 'owner', isPrimaryOwner: true, hasSwitchPin: false },
      { branchId: 'b2', tenantId: 't', salonName: 'Lux', branchName: 'Moorestown', timezone: 'America/New_York', accessLevel: 'owner', isPrimaryOwner: true, hasSwitchPin: false }] });
    render(<OwnerPaycheckPanel week={week() as any} onChanged={onChanged} />);
    const sel = await screen.findByLabelText('Filter branch');
    expect(screen.getByRole('option', { name: 'All branches' })).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'b2' } });
    await waitFor(() => expect(api.paycheckWeek).toHaveBeenLastCalledWith('p1', { exceptionsOnly: false, search: '', branchId: 'b2' }));
  });
  it('one branch → no branch select', async () => {
    (ownerContextApi as any).context.mockResolvedValue({ allowedBranches: [{ branchId: 'b1', branchName: 'Cherry Hill' }] });
    render(<OwnerPaycheckPanel week={week() as any} onChanged={onChanged} />);
    await waitFor(() => expect((ownerContextApi as any).context).toHaveBeenCalled());
    expect(screen.queryByLabelText('Filter branch')).toBeNull();
  });
  it('approves all with the PIN and the version seen', async () => {
    render(<OwnerPaycheckPanel week={week() as any} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('Approve all'));
    fireEvent.change(screen.getByLabelText('Security PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(api.paycheckApprove).toHaveBeenCalledWith('p1', '2468', { expectedVersion: 4, holdTechnicianIds: [] }));
    expect(onChanged).toHaveBeenCalled();
  });
  it('holds a selected technician and approves the rest', async () => {
    render(<OwnerPaycheckPanel week={week() as any} onChanged={onChanged} />);
    fireEvent.click(screen.getByLabelText('Hold Ana Ruiz'));
    fireEvent.click(screen.getByText('Approve, hold 1'));
    fireEvent.change(screen.getByLabelText('Security PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(api.paycheckApprove).toHaveBeenCalledWith('p1', '2468', { expectedVersion: 4, holdTechnicianIds: ['t2'] }));
  });
  it('returns for changes with a note (required)', async () => {
    render(<OwnerPaycheckPanel week={week() as any} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('Return for changes'));
    expect(screen.getByText('Send')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note for the manager'), { target: { value: 'Check Leo bonus' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(api.paycheckReturn).toHaveBeenCalledWith('p1', 'Check Leo bonus', 4));
  });
  it('shows the server refusal (self-approval) instead of pretending', async () => {
    api.paycheckApprove.mockRejectedValue(Object.assign(new Error('You are paid on this payroll, so you cannot approve it. Ask the owner.'), { code: 'PAYROLL_SELF_APPROVAL', status: 403 }));
    render(<OwnerPaycheckPanel week={week() as any} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('Approve all'));
    fireEvent.change(screen.getByLabelText('Security PIN'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Confirm'));
    expect(await screen.findByText(/cannot approve it/)).toBeInTheDocument();
  });

  // ── close-out (Oct 27 2026): §9.3 the missing KPIs, §9.5 the evidence drill-down ──────────────────────────────────────
  it('§9.3 shows gross earnings, already paid and other-method totals the API already returned', () => {
    const w = week(); w.totals.alreadyPaidCents = 4000; w.totals.otherCents = 12000;
    render(<OwnerPaycheckPanel week={w as any} onChanged={onChanged} />);
    expect(screen.getByText('Gross earnings').nextSibling).toHaveTextContent('$2,000.00');
    expect(screen.getByText('Already paid').nextSibling).toHaveTextContent('$40.00');
    expect(screen.getByText('Other methods').nextSibling).toHaveTextContent('$120.00');
  });
  it('§9.5 the owner drills into the evidence behind a statement: services, tips, hours and adjustments from the server', async () => {
    api.paycheckEvidence.mockResolvedValue({ period: { id: 'p1', status: 'review' }, window: { fromIso: '', toIso: '', timezone: 'UTC' }, line: null,
      services: [{ serviceName: 'Pedicure', lineTotalCents: 6000, commissionCents: 3000, completedAt: '2026-10-14T16:00:00Z', ticketId: 'tk9', ruleSource: null }], tips: [{ ticketId: 'tk9abcdef', cardTipCents: 1000, cashTipCents: 0 }],
      adjustments: [{ id: 'a1', category: 'bonus', amountCents: 5000, reason: 'Great month', status: 'approved' }], payouts: [],
      hours: { technicianName: 'Mia Chen', plan: { id: 'pp', payType: 'hourly', hourlyRateCents: 1800, salaryCentsPerPeriod: null, breaksPaid: false, overtimeWeeklyMinutes: 2400, effectiveStart: '2026-01-01', effectiveEnd: null },
        entries: [{ shiftId: 'sh', branchId: null, shiftDate: '2026-10-14', clockedInAt: null, clockedOutAt: null, open: false, status: 'completed', scheduledMinutes: 480, workedMinutes: 500, breakMinutes: 20, paidMinutes: 480, breaks: [] }],
        openEntries: 0, totals: { scheduledMinutes: 480, workedMinutes: 500, breakMinutes: 20, paidMinutes: 480, potentialOvertimeMinutes: 0, computedHourlyPayCents: 14400, lineHourlyPayCents: 14400, lineWorkedMinutes: 500, lineSalaryPayCents: 0, matchesLine: true } } });
    render(<OwnerPaycheckPanel week={week() as any} onChanged={onChanged} />);
    fireEvent.click(screen.getByText(/Mia Chen/));
    fireEvent.click(screen.getByText('Show evidence'));
    await waitFor(() => expect(api.paycheckEvidence).toHaveBeenCalledWith('p1', 't1'));
    const ev = await screen.findByTestId('owner-evidence');
    expect(ev).toHaveTextContent('Pedicure');
    expect(ev).toHaveTextContent('2026-10-14: clocked 500 min · scheduled 480 min · breaks 20 min · paid 480 min');
    expect(ev).toHaveTextContent('Paid 8.0 h at $18.00/h → $144.00');
    expect(ev).toHaveTextContent('Great month');
  });

  // 17.5 (Oct 27 2026): the pay stub PDF of an approved statement — a download, never a print dialog
  it('17.5 an approved statement downloads its pay stub in the app\'s language; a submitted one has no download yet', async () => {
    const w = week(); (w.statements[0] as Record<string, unknown>).status = 'locked';
    api.paycheckPayStub.mockResolvedValue(new Blob(['%PDF-1.3'], { type: 'application/pdf' }));
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:stub'), revokeObjectURL: vi.fn() });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const printed = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<OwnerPaycheckPanel week={w as any} onChanged={onChanged} />);
    fireEvent.click(screen.getByText(/Ana Ruiz/));
    expect(screen.queryByText('Download pay stub (PDF)')).toBeNull();   // Ana's statement is still submitted (an estimate)
    fireEvent.click(screen.getByText(/Mia Chen/));
    fireEvent.click(await screen.findByText('Download pay stub (PDF)'));
    await waitFor(() => expect(api.paycheckPayStub).toHaveBeenCalledWith('s1', 'en'));
    expect(await screen.findByText('Pay stub downloaded.')).toBeInTheDocument();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(printed).not.toHaveBeenCalled();
    clicked.mockRestore(); printed.mockRestore();
  });
});
