// CommissionPayrollScreen (owner, read-only): pay-period summary (Total Payroll / Commissions / Guarantees / Retail /
// Tips) + a per-technician payout preview that expands to the commission/retail/tip/guarantee/adjustment breakdown,
// with a period switcher. Verifies the summary + preview render, the expand reveals the breakdown, period switching
// refetches, and the empty state. Data is typed from /owner/payroll[/periods/:id] (the engine's stored values).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const back = vi.fn();
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back }) }));
vi.mock('../api/ownerApi', () => ({ ownerPayrollApi: { list: vi.fn(), period: vi.fn(), approve: vi.fn(), lock: vi.fn(), reopen: vi.fn() }, ownerCompensationApi: { tipPolicy: vi.fn(), setTipPolicy: vi.fn(), listRules: vi.fn(), createRule: vi.fn(), seedDefault: vi.fn(), addRuleVersion: vi.fn(), approveVersion: vi.fn(), activateVersion: vi.fn(), cancelVersion: vi.fn(), tierPlans: vi.fn(), createTierPlan: vi.fn(), archiveTierPlan: vi.fn(), previewTierPlan: vi.fn(), retailPolicy: vi.fn(), setRetailPolicy: vi.fn(), bonusRules: vi.fn(), createBonusRule: vi.fn(), archiveBonusRule: vi.fn(), previewBonuses: vi.fn(), approveBonus: vi.fn(), bonusPeriodReview: vi.fn(), classifications: vi.fn(), setClassification: vi.fn(), wageConfig: vi.fn(), setWageConfig: vi.fn(), compliancePreview: vi.fn(), compliancePeriodReview: vi.fn(), agreements: vi.fn(), createAgreement: vi.fn() } }));

import { ownerPayrollApi, ownerCompensationApi } from '../api/ownerApi';
import { CommissionPayrollScreen } from './CommissionPayrollScreen';

const list = {
  periods: [
    { periodId: 'p2', branchId: null, label: 'May 12 – May 18', periodStart: '2026-05-12', periodEnd: '2026-05-18', status: 'finalized', finalizedAt: null, paidAt: null, totalPayableCents: 2468000, totalCommissionCents: 1842000, totalTipsCents: 325000 },
    { periodId: 'p1', branchId: null, label: 'May 5 – May 11', periodStart: '2026-05-05', periodEnd: '2026-05-11', status: 'paid', finalizedAt: null, paidAt: '2026-05-13', totalPayableCents: 2310000, totalCommissionCents: 1700000, totalTipsCents: 300000 },
  ],
  kpis: { totalPeriods: 2, openPeriods: 1, unpaidPayableCents: 2468000, latestPeriodPayableCents: 2468000, lifetimeCommissionCents: 3542000, lifetimeTipsCents: 625000 },
};
const detail = {
  period: list.periods[0],
  totals: { grossSalesCents: 5000000, commissionCents: 1842000, retailCommissionCents: 120000, cardTipCents: 200000, cashTipCents: 125000, tipsCents: 325000, guaranteeTopupCents: 480000, adjustmentCents: 0, payableCents: 2468000, technicianCount: 1 },
  lines: [{ technicianId: 'te1', technicianName: 'Emily R.', servicesCount: 48, grossSalesCents: 312000, commissionType: 'percent', commissionValue: 40, commissionCents: 124800, retailCommissionCents: 4000, cardTipCents: 9000, cashTipCents: 3000, tipsCents: 12000, guaranteeTopupCents: 0, adjustmentCents: 0, payableCents: 125000 }],
};

beforeEach(() => { vi.clearAllMocks(); (ownerPayrollApi.list as any).mockResolvedValue(list); (ownerPayrollApi.period as any).mockResolvedValue(detail); (ownerPayrollApi.lock as any).mockResolvedValue(detail); (ownerPayrollApi.approve as any).mockResolvedValue(detail); (ownerPayrollApi.reopen as any).mockResolvedValue(detail); (ownerCompensationApi.tipPolicy as any).mockResolvedValue({ manyTechTipMethod: 'proportional' }); (ownerCompensationApi.setTipPolicy as any).mockResolvedValue({ manyTechTipMethod: 'equal' }); (ownerCompensationApi.listRules as any).mockResolvedValue([]); (ownerCompensationApi.tierPlans as any).mockResolvedValue([]); (ownerCompensationApi.retailPolicy as any).mockResolvedValue({ method: 'none', value: 0 }); (ownerCompensationApi.bonusRules as any).mockResolvedValue([]); (ownerCompensationApi.classifications as any).mockResolvedValue([]); (ownerCompensationApi.wageConfig as any).mockResolvedValue({ minHourlyWageCents: 0, overtimeThresholdHours: 0 }); (ownerCompensationApi.agreements as any).mockResolvedValue([]); });

describe('CommissionPayrollScreen', () => {
  it('shows the latest pay-period summary and the payout preview', async () => {
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByText('Emily R.')).toBeInTheDocument());
    expect(screen.getByText('Total Payroll')).toBeInTheDocument();
    expect(screen.getByText('$24,680.00')).toBeInTheDocument();   // period total payable
    expect(screen.getByText('Payout Preview')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();      // status badge
  });

  it('expands a technician row to reveal the commission/tip/guarantee breakdown', async () => {
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByText('Emily R.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Emily R.'));
    await waitFor(() => expect(screen.getByText('Guarantee Top-Up')).toBeInTheDocument());
    expect(screen.getByText('Card Tips')).toBeInTheDocument();
    expect(screen.getByText(/40%/)).toBeInTheDocument(); // commission percent in the breakdown
  });

  it('switches the selected pay period and refetches its detail', async () => {
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByText('Emily R.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('May 5 – May 11'));
    await waitFor(() => expect(ownerPayrollApi.period).toHaveBeenCalledWith('p1'));
  });

  it('shows an empty state when there are no payroll periods', async () => {
    (ownerPayrollApi.list as any).mockResolvedValue({ periods: [], kpis: { totalPeriods: 0, openPeriods: 0, unpaidPayableCents: 0, latestPeriodPayableCents: 0, lifetimeCommissionCents: 0, lifetimeTipsCents: 0 } });
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByText('No payroll periods yet.')).toBeInTheDocument());
  });

  it('gates Lock & Pay behind a PIN (fresh auth) and calls the lock endpoint on confirm', async () => {
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByText('Lock & Pay')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Lock & Pay'));
    const pinInput = await screen.findByLabelText('Security PIN');
    fireEvent.change(pinInput, { target: { value: '1357' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(ownerPayrollApi.lock).toHaveBeenCalledWith('p2', '1357'));
  });

  it('reopen asks for a written reason and sends it with the PIN (Payroll mandate §124)', async () => {
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByText('Reopen to Draft')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Reopen to Draft'));
    fireEvent.change(await screen.findByLabelText('Security PIN'), { target: { value: '1357' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/why this approved period/i));
    expect(ownerPayrollApi.reopen).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reopen reason'), { target: { value: 'Missed a refund for Emily' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(ownerPayrollApi.reopen).toHaveBeenCalledWith('p2', '1357', 'Missed a refund for Emily'));
  });

  it('surfaces the server error when the PIN is rejected', async () => {
    (ownerPayrollApi.lock as any).mockRejectedValue(new Error('Incorrect PIN. Please try again.'));
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByText('Lock & Pay')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Lock & Pay'));
    fireEvent.change(await screen.findByLabelText('Security PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/incorrect pin/i));
  });

  it('shows a locked message and no actions for a paid period', async () => {
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByText('Lock & Pay')).toBeInTheDocument());
    fireEvent.click(screen.getByText('May 5 – May 11')); // p1 = paid
    await waitFor(() => expect(screen.getByText(/locked and paid/i)).toBeInTheDocument());
    expect(screen.queryByText('Lock & Pay')).not.toBeInTheDocument();
    expect(screen.queryByText('Approve Payroll')).not.toBeInTheDocument();
  });

  it('loads the tip-split policy and switches it (PUT sent, Saved shown)', async () => {
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByLabelText('Proportional')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByLabelText('Equal (default)')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByLabelText('Equal (default)'));
    await waitFor(() => expect(ownerCompensationApi.setTipPolicy).toHaveBeenCalledWith('equal'));
    await waitFor(() => expect(screen.getByLabelText('Equal (default)')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('reverts the tip-split selection when the save fails', async () => {
    (ownerCompensationApi.setTipPolicy as any).mockRejectedValue(new Error('Could not save the policy.'));
    render(<CommissionPayrollScreen />);
    await waitFor(() => expect(screen.getByLabelText('Proportional')).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(screen.getByLabelText('Equal (default)'));
    await waitFor(() => expect(ownerCompensationApi.setTipPolicy).toHaveBeenCalled());
    // the save failed → the optimistic switch snaps back to the previous policy
    await waitFor(() => expect(screen.getByLabelText('Equal (default)')).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByLabelText('Proportional')).toHaveAttribute('aria-pressed', 'true');
  });
});
