// TechPayStatementsPanel — Weekly Paycheck §15: the technician's own statements (estimated until the owner approves,
// then approved with paid / unpaid), the statement detail with no manager note, and the cash the salon prepared:
// confirm receipt, or tell the manager it is wrong. Mocked API.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../lib/useTechStream', () => ({ useTechStream: () => undefined }));
vi.mock('../api/techApi', () => ({ techApi: { payStatements: vi.fn(), payStatement: vi.fn(), acknowledgeCash: vi.fn(), disputeCash: vi.fn(), payStub: vi.fn() } }));

import { techApi } from '../api/techApi';
import { TechPayStatementsPanel } from './TechPayStatementsPanel';

const api = techApi as any;
const item = (over: Record<string, unknown> = {}) => ({ id: 's1', periodId: 'p1', statementNumber: 'PAY-2026-000128', periodStart: '2026-10-12', periodEnd: '2026-10-18', payDate: '2026-10-23', label: null,
  status: 'partially_paid', estimated: false, stage: 'approved', amountCents: 150000, paidCents: 75000, unpaidCents: 75000, ...over });
const cash = { id: 'c1', statementId: 's1', technicianId: 't1', method: 'cash', amountCents: 75000, status: 'processing', paidAt: null, checkNumber: null, checkStatus: null, checkIssuedAt: null, checkDeliveredAt: null, checkClearedAt: null,
  checkVoidedAt: null, checkVoidReason: null, replacesPayoutId: null, cashSource: 'safe', cashStatus: 'handed_off', cashPreparedBy: null, cashPreparedAt: null, cashHandedOffBy: null, cashHandedOffAt: null,
  cashAcknowledgedAt: null, cashAckMethod: null, cashDisputeReason: null, drawerMovementId: null, version: 2, createdAt: null };
beforeEach(() => {
  vi.clearAllMocks();
  api.payStatements.mockResolvedValue({ current: item(), statements: [item(), item({ id: 's0', periodStart: '2026-10-19', periodEnd: '2026-10-25', status: 'draft', estimated: true, stage: 'manager_review', amountCents: 90000, paidCents: 0, unpaidCents: 0 })], cashWaiting: [cash] });
  api.acknowledgeCash.mockResolvedValue({});
  api.disputeCash.mockResolvedValue({});
});

describe('TechPayStatementsPanel', () => {
  it('shows the approved statement with paid / unpaid and the next week as an estimate', async () => {
    render(<TechPayStatementsPanel />);
    expect(await screen.findByText('Weekly pay statements')).toBeInTheDocument();
    expect(screen.getByText(/Paid \$750\.00 · unpaid \$750\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated · manager reviewing/)).toBeInTheDocument();
  });
  it('confirms the cash handed over', async () => {
    render(<TechPayStatementsPanel />);
    fireEvent.click(await screen.findByText('I received it'));
    await waitFor(() => expect(api.acknowledgeCash).toHaveBeenCalledWith('c1', null));
  });
  it('tells the manager when the cash is wrong (a reason is required)', async () => {
    render(<TechPayStatementsPanel />);
    fireEvent.click(await screen.findByText('Something is wrong'));
    const send = screen.getByText('Tell the manager');
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What is wrong'), { target: { value: 'Envelope was $20 short' } });
    fireEvent.click(send);
    await waitFor(() => expect(api.disputeCash).toHaveBeenCalledWith('c1', 'Envelope was $20 short'));
  });
  it('opens a statement — the figures, never a manager note', async () => {
    api.payStatement.mockResolvedValue({ ...item(), salonName: 'Lotus Nails', serviceCommissionCents: 140000, cardTipCents: 6000, cashTipCents: 4000, hourlyPayCents: 0, salaryPayCents: 0, retailCommissionCents: 0, bonusCents: 0,
      guaranteeTopUpCents: 0, positiveAdjustmentsCents: 0, deductionsCents: 0, reversalsCents: 0, grossEarningsCents: 150000, alreadyPaidCents: 0, approvedPayableCents: 150000, branchBreakdown: [], payouts: [] });
    render(<TechPayStatementsPanel />);
    fireEvent.click((await screen.findAllByText('View statement'))[0]);
    expect(await screen.findByText(/Lotus Nails · PAY-2026-000128/)).toBeInTheDocument();
    expect(screen.getByText('Service commission')).toBeInTheDocument();
    expect(screen.queryByText(/private/i)).toBeNull();
  });

  // ── close-out (Oct 27 2026): §15.3 lifecycle words, §11.5 the handoff code ──────────────────────────────────────────
  it('§15.3 names each payout\'s lifecycle word — "Check #4812 · DELIVERED", "Cash · ACKNOWLEDGED" — and how the cash was confirmed', async () => {
    api.payStatement.mockResolvedValue({ ...item(), salonName: 'Lotus Nails', serviceCommissionCents: 150000, cardTipCents: 0, cashTipCents: 0, hourlyPayCents: 0, salaryPayCents: 0, retailCommissionCents: 0, bonusCents: 0,
      guaranteeTopUpCents: 0, positiveAdjustmentsCents: 0, deductionsCents: 0, reversalsCents: 0, grossEarningsCents: 150000, alreadyPaidCents: 0, approvedPayableCents: 150000, branchBreakdown: [],
      payouts: [{ ...cash, id: 'k1', method: 'check', amountCents: 99000, status: 'paid', checkNumber: '4812', checkStatus: 'delivered', cashStatus: null, cashSource: null },
        { ...cash, id: 'k2', amountCents: 51000, status: 'paid', cashStatus: 'acknowledged', cashAckMethod: 'qr_handoff' },
        { ...cash, id: 'k3', method: 'check', amountCents: 1000, status: 'pending', checkNumber: '4813', checkStatus: 'issued', cashStatus: null }] });
    render(<TechPayStatementsPanel />);
    fireEvent.click((await screen.findAllByText('View statement'))[0]);
    expect(await screen.findByText(/Check #4812 · DELIVERED/)).toBeInTheDocument();
    expect(screen.getByText(/Cash · ACKNOWLEDGED/)).toBeInTheDocument();
    expect(screen.getByText(/You confirmed with the handoff code/)).toBeInTheDocument();
    expect(screen.getByText(/Check #4813 · ISSUED/)).toBeInTheDocument();
  });
  // ── 17.5 (Oct 27 2026): the pay stub PDF of an approved week — a download, in the app's language ─────────────────
  const detail = (over: Record<string, unknown> = {}) => ({ ...item(), salonName: 'Lotus Nails', serviceCommissionCents: 150000, cardTipCents: 0, cashTipCents: 0, hourlyPayCents: 0, salaryPayCents: 0, retailCommissionCents: 0,
    bonusCents: 0, guaranteeTopUpCents: 0, positiveAdjustmentsCents: 0, deductionsCents: 0, reversalsCents: 0, grossEarningsCents: 150000, alreadyPaidCents: 0, approvedPayableCents: 150000, branchBreakdown: [], payouts: [], ...over });
  it('17.5 downloads the approved week\'s pay stub (PDF from the server, saved as a file — no print dialog)', async () => {
    api.payStatement.mockResolvedValue(detail());
    api.payStub.mockResolvedValue(new Blob(['%PDF-1.3'], { type: 'application/pdf' }));
    const created = vi.fn(() => 'blob:stub'); const revoked = vi.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const printed = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<TechPayStatementsPanel />);
    fireEvent.click((await screen.findAllByText('View statement'))[0]);
    fireEvent.click(await screen.findByText('Download pay stub'));
    await waitFor(() => expect(api.payStub).toHaveBeenCalledWith('s1', 'en'));
    expect(await screen.findByText('Pay stub downloaded.')).toBeInTheDocument();
    expect(created).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(printed).not.toHaveBeenCalled();
    clicked.mockRestore(); printed.mockRestore();
  });
  it('17.5 an estimated week has no pay stub button (the stub exists once the owner approves)', async () => {
    api.payStatement.mockResolvedValueOnce(detail({ id: 's0', estimated: true, status: 'draft' }));
    render(<TechPayStatementsPanel />);
    fireEvent.click((await screen.findAllByText('View statement'))[1]);
    expect(await screen.findByText(/Lotus Nails · PAY-2026-000128 · estimated/)).toBeInTheDocument();
    expect(screen.queryByText('Download pay stub')).toBeNull();
  });
  it('17.5 a refused download (e.g. too many at once) shows the server\'s message', async () => {
    api.payStatement.mockResolvedValue(detail());
    api.payStub.mockRejectedValue(Object.assign(new Error('Too many pay stub downloads — wait a minute and try again.'), { code: 'RATE_LIMITED', status: 429 }));
    render(<TechPayStatementsPanel />);
    fireEvent.click((await screen.findAllByText('View statement'))[0]);
    fireEvent.click(await screen.findByText('Download pay stub'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many pay stub downloads');
  });
  it('§11.5 confirms the cash with the manager\'s handoff code when one was typed', async () => {
    render(<TechPayStatementsPanel />);
    fireEvent.change(await screen.findByLabelText('Manager’s handoff code (optional)'), { target: { value: 'a1b2c3d4' } });
    fireEvent.click(screen.getByText('I received it'));
    await waitFor(() => expect(api.acknowledgeCash).toHaveBeenCalledWith('c1', 'A1B2C3D4'));
  });
});
