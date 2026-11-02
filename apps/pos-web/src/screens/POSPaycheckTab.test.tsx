// POSPaycheckTab — Weekly Paycheck (Oct 21 2026) on the POS: the week's statements with check / cash, a custom dollar
// split must equal the payable (checked before sending), submit to the owner with the version seen, the owner's approve
// with a hold (step-up), a check is issued with its number, cash is prepared from a source and confirmed with the
// technician's PIN. Mocked API; no network.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api/posPayrollApi', () => ({ posPayrollApi: { payWeek: vi.fn(), payCalculate: vi.fn(), payApplyDefault: vi.fn(), paySubmit: vi.fn(), payApprove: vi.fn(), payReturn: vi.fn(), payReject: vi.fn(), payStatement: vi.fn(), payPlan: vi.fn(),
  payApproveHeld: vi.fn(), payAddPayout: vi.fn(), checkIssue: vi.fn(), checkDeliver: vi.fn(), checkClear: vi.fn(), checkVoid: vi.fn(), cashPrepare: vi.fn(), cashHandOff: vi.fn(), cashAckPin: vi.fn(), cashResolve: vi.fn(),
  openWeek: vi.fn(), payReport: vi.fn(), paySchedule: vi.fn(), savePaySchedule: vi.fn(), paySummary: vi.fn(),
  payCancelPeriod: vi.fn(), payPreparation: vi.fn(), payEvidence: vi.fn(), cashHandoffToken: vi.fn(), cashAckSignature: vi.fn(), cashAckDual: vi.fn(), payStub: vi.fn() } }));
import { posPayrollApi } from '../api/posPayrollApi';
import { PaycheckTab } from './POSPaycheckTab';

const api = posPayrollApi as any;
const payout = (over: Record<string, unknown>) => ({ id: 'x', statementId: 's1', technicianId: 't1', method: 'check', amountCents: 75000, status: 'pending', paidAt: null, checkNumber: null, checkStatus: 'planned', checkIssuedAt: null, checkDeliveredAt: null,
  checkClearedAt: null, checkVoidedAt: null, checkVoidReason: null, replacesPayoutId: null, cashSource: null, cashStatus: null, cashPreparedBy: null, cashPreparedAt: null, cashHandedOffBy: null, cashHandedOffAt: null,
  cashAcknowledgedAt: null, cashAckMethod: null, cashDisputeReason: null, drawerMovementId: null, version: 1, createdAt: null, ...over });
const statement = (status: string, payouts: unknown[] = []) => ({ id: 's1', periodId: 'p1', technicianId: 't1', technicianName: 'Mia Chen', statementNumber: 'PAY-2026-000128', status, reviewRequired: false, version: 3,
  serviceCommissionCents: 146000, hourlyPayCents: 0, salaryPayCents: 0, tipsCents: 4000, cardTipCents: 0, cashTipCents: 4000, retailCommissionCents: 0, bonusCents: 0, guaranteeTopUpCents: 0, positiveAdjustmentsCents: 0,
  deductionsCents: 0, reversalsCents: 0, grossEarningsCents: 150000, linePayableCents: 150000, alreadyPaidCents: 0, approvedPayableCents: 150000, paidCents: 0, unpaidCents: 150000, branchBreakdown: [],
  submittedAt: null, approvedAt: null, approvedBy: null, lockedAt: null, voidedAt: null, createdAt: null,
  plan: { id: 'pl', policyType: 'split_check_cash', payableCents: 150000, status: 'draft', differsFromDefault: false, overrideReason: null, version: 1,
    instructions: [{ id: 'i1', method: 'check', amountCents: 75000, basisPoints: 5000, sequence: 1, status: 'planned', payoutId: null }, { id: 'i2', method: 'cash', amountCents: 75000, basisPoints: 5000, sequence: 2, status: 'planned', payoutId: null }], issues: [] },
  payouts });
const week = (status: string, st = statement('draft')) => ({ period: { id: 'p1', label: null, periodStart: '2026-10-12', periodEnd: '2026-10-18', payDate: '2026-10-23', status, payoutStatus: 'none', version: 5, submittedBy: null, submittedAt: null,
  ownerDecision: null, ownerNote: null, approvedBy: null, approvalHash: null, previewHash: null, branchScope: null },
  statements: [st], totals: { technicians: 1, grossEarningsCents: 150000, alreadyPaidCents: 0, payableCents: 150000, checkCents: 75000, cashCents: 75000, otherCents: 0, paidCents: 0, unpaidCents: 150000, exceptions: 0, overrides: 0 },
  previousPayableCents: null, schedule: { frequency: 'weekly' } });
const periods = [{ id: 'p1', label: null, periodStart: '2026-10-12', periodEnd: '2026-10-18', status: 'draft' }];
const reload = vi.fn().mockResolvedValue(undefined);
const stepUp = vi.fn((fn: () => Promise<unknown>) => fn()) as any;
const all = () => true;
beforeEach(() => { vi.clearAllMocks(); api.payWeek.mockResolvedValue(week('draft')); api.payStatement.mockResolvedValue(statement('draft')); for (const k of Object.keys(api)) if (!api[k].getMockImplementation()) api[k].mockResolvedValue({}); api.payWeek.mockResolvedValue(week('draft')); api.payStatement.mockResolvedValue(statement('draft')); });

describe('POS weekly paychecks — 17.5 the pay stub PDF (Oct 27 2026)', () => {
  it('an approved statement downloads its pay stub (the server\'s PDF, saved as a file — no print dialog)', async () => {
    api.payStatement.mockResolvedValue(statement('locked', [payout({ id: 'k1' })]));
    api.payStub.mockResolvedValue(new Blob(['%PDF-1.3'], { type: 'application/pdf' }));
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:stub'), revokeObjectURL: vi.fn() });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const printed = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('Download pay stub (PDF)'));
    await waitFor(() => expect(api.payStub).toHaveBeenCalledWith('s1', 'en'));
    expect(await within(dialog).findByText('Pay stub downloaded.')).toBeInTheDocument();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(printed).not.toHaveBeenCalled();
    clicked.mockRestore(); printed.mockRestore();
  });
  it('a draft statement has no download yet — it is an estimate until the owner approves', async () => {
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('The pay stub is ready once the owner approves this week.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Download pay stub (PDF)')).toBeNull();
  });
  it('a refused download (e.g. too many at once) shows the server\'s message', async () => {
    api.payStatement.mockResolvedValue(statement('paid'));
    api.payStub.mockRejectedValue(Object.assign(new Error('Too many pay stub downloads — wait a minute and try again.'), { status: 429, code: 'RATE_LIMITED' }));
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('Download pay stub (PDF)'));
    expect(await within(dialog).findByText(/Too many pay stub downloads/)).toBeInTheDocument();
  });
});

describe('POS weekly paychecks', () => {
  it('shows each technician with check / cash and submits the week with the version seen', async () => {
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    expect(await screen.findByText('Mia Chen')).toBeInTheDocument();
    expect(screen.getAllByText('$750.00').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByText('Submit to owner'));
    await waitFor(() => expect(api.paySubmit).toHaveBeenCalledWith('p1', 5));
  });
  it('a custom dollar split must equal the payable before it is sent', async () => {
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Payout split'), { target: { value: 'manual_amount' } });
    fireEvent.change(within(dialog).getByLabelText('Check amount'), { target: { value: '1000' } });
    fireEvent.change(within(dialog).getByLabelText('Cash amount'), { target: { value: '400' } });
    fireEvent.click(within(dialog).getByText('Save split'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('$1,500.00');
    expect(api.payPlan).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Cash amount'), { target: { value: '500' } });
    fireEvent.change(within(dialog).getByLabelText('Reason for a custom split'), { target: { value: 'Asked for more on the check' } });
    fireEvent.click(within(dialog).getByText('Save split'));
    await waitFor(() => expect(api.payPlan).toHaveBeenCalledWith('s1', { policyType: 'manual_amount', entries: [{ method: 'check', amountCents: 100000 }, { method: 'cash', amountCents: 50000 }], overrideReason: 'Asked for more on the check', expectedVersion: 3 }));
  });
  it('the owner approves holding a technician (through the step-up)', async () => {
    api.payWeek.mockResolvedValue(week('review', statement('submitted')));
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByLabelText('Hold Mia Chen'));
    fireEvent.click(screen.getByText('Approve, hold 1'));
    await waitFor(() => expect(api.payApprove).toHaveBeenCalledWith('p1', { expectedVersion: 5, holdTechnicianIds: ['t1'] }));
    expect(stepUp).toHaveBeenCalled();
  });
  it('§66/§67: "Show exceptions only" and the technician search ask the SERVER for the narrowed week; the exceptions are named', async () => {
    const flagged = { ...statement('draft'), exceptions: [{ code: 'MISSING_CLOCK_OUT', message: 'Still clocked in' }, { code: 'MANUAL_ADJUSTMENT', message: 'Manual' }] };
    api.payWeek.mockResolvedValue({ ...week('draft', flagged), view: { exceptionsOnly: false, search: null, branchId: null, matched: 1, total: 200, withExceptions: 15, validatedAt: null, periodIssues: [] } });
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    expect(await screen.findByText('No clock-out')).toBeInTheDocument();
    expect(screen.getByText('Manual adjustment')).toBeInTheDocument();
    expect(api.payWeek).toHaveBeenLastCalledWith('p1', { exceptionsOnly: false, search: '' });
    api.payWeek.mockResolvedValue({ ...week('draft', flagged), view: { exceptionsOnly: true, search: null, branchId: null, matched: 15, total: 200, withExceptions: 15, validatedAt: null, periodIssues: [] } });
    fireEvent.click(screen.getByLabelText('Show exceptions only'));
    await waitFor(() => expect(api.payWeek).toHaveBeenLastCalledWith('p1', { exceptionsOnly: true, search: '' }));
    expect(await screen.findByText('Showing 15 of 200')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search technician'), { target: { value: 'Mia' } });
    await waitFor(() => expect(api.payWeek).toHaveBeenLastCalledWith('p1', { exceptionsOnly: true, search: 'Mia' }));
  });
  it('issues a check with its number and confirms cash with the technician PIN', async () => {
    const st = statement('locked', [payout({ id: 'c1' }), payout({ id: 'k1', method: 'cash', checkStatus: null, cashStatus: 'ready_for_handoff', cashSource: 'register_drawer' })]);
    api.payWeek.mockResolvedValue(week('finalized', st)); api.payStatement.mockResolvedValue(st);
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText('Check number'), { target: { value: '1001' } });
    fireEvent.click(within(dialog).getByText('Issue check'));
    await waitFor(() => expect(api.checkIssue).toHaveBeenCalledWith('c1', '1001'));
    fireEvent.change(within(dialog).getByLabelText('Technician PIN'), { target: { value: '4321' } });
    fireEvent.click(within(dialog).getByText('Technician confirms'));
    await waitFor(() => expect(api.cashAckPin).toHaveBeenCalledWith('k1', '4321'));
  });
  it('explains an insufficient drawer instead of pretending the cash was prepared', async () => {
    const st = statement('locked', [payout({ id: 'k1', method: 'cash', checkStatus: null, cashStatus: 'planned' })]);
    api.payWeek.mockResolvedValue(week('finalized', st)); api.payStatement.mockResolvedValue(st);
    api.cashPrepare.mockRejectedValue(Object.assign(new Error('There is not enough cash in that drawer for this payout.'), { code: 'INSUFFICIENT_CASH', status: 409 }));
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('Prepare cash'));
    expect(await within(dialog).findByText(/not enough cash/)).toBeInTheDocument();
  });

  // ── close-out (Oct 27 2026): the INTERNAL items of docs/mandates/status/WEEKLY_PAYCHECK_STATUS.md ────────────────────
  it('§7.4 the split editor shows what is still unallocated on every keystroke (dollars and percent), before any save', async () => {
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Payout split'), { target: { value: 'manual_amount' } });
    expect(within(dialog).getByTestId('split-remaining')).toHaveTextContent('Remaining to allocate: $1,500.00');
    fireEvent.change(within(dialog).getByLabelText('Check amount'), { target: { value: '1000' } });
    expect(within(dialog).getByTestId('split-remaining')).toHaveTextContent('Remaining to allocate: $500.00');
    fireEvent.change(within(dialog).getByLabelText('Cash amount'), { target: { value: '600' } });
    expect(within(dialog).getByTestId('split-remaining')).toHaveTextContent('Over by $100.00');
    fireEvent.change(within(dialog).getByLabelText('Cash amount'), { target: { value: '500' } });
    expect(within(dialog).getByTestId('split-remaining')).toHaveTextContent('Allocated exactly: $1,500.00');
    fireEvent.change(within(dialog).getByLabelText('Payout split'), { target: { value: 'manual_percent' } });
    fireEvent.change(within(dialog).getByLabelText('Check percent'), { target: { value: '70' } });
    fireEvent.change(within(dialog).getByLabelText('Cash percent'), { target: { value: '20' } });
    expect(within(dialog).getByTestId('split-remaining')).toHaveTextContent('10% left to allocate');
    expect(api.payPlan).not.toHaveBeenCalled();   // a counter, never a save
  });
  it('§4.2 / §8.4 the statement itemises its reversals and opens the evidence (time clock, services, tips)', async () => {
    const st = { ...statement('draft'), reversalsCents: 1200, refundReversalCents: 1000, tipAdjustmentCents: 200, retailReversalCents: 0 };
    api.payWeek.mockResolvedValue(week('draft', st)); api.payStatement.mockResolvedValue(st);
    api.payEvidence.mockResolvedValue({ period: { id: 'p1', status: 'draft' }, window: { fromIso: '', toIso: '', timezone: 'UTC' }, line: null,
      services: [{ serviceName: 'Gel manicure', lineTotalCents: 4500, commissionCents: 2250, completedAt: '2026-10-13T15:00:00Z', ticketId: 'tk1', ruleSource: null }], tips: [{ ticketId: 'tk1ticket', cardTipCents: 500, cashTipCents: 0 }], adjustments: [], payouts: [],
      hours: { technicianName: 'Mia Chen', plan: { id: 'pp', payType: 'hybrid', hourlyRateCents: 2000, salaryCentsPerPeriod: null, breaksPaid: false, overtimeWeeklyMinutes: 2400, effectiveStart: '2026-01-01', effectiveEnd: null },
        entries: [{ shiftId: 'sh1', branchId: null, shiftDate: '2026-10-13', clockedInAt: '2026-10-13T13:00:00Z', clockedOutAt: '2026-10-13T21:00:00Z', open: false, status: 'completed', scheduledMinutes: 450, workedMinutes: 480, breakMinutes: 30, paidMinutes: 450, breaks: [] }],
        openEntries: 0, totals: { scheduledMinutes: 450, workedMinutes: 480, breakMinutes: 30, paidMinutes: 450, potentialOvertimeMinutes: 0, computedHourlyPayCents: 15000, lineHourlyPayCents: 15000, lineWorkedMinutes: 480, lineSalaryPayCents: 0, matchesLine: true } } });
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Refund / void reversals')).toBeInTheDocument();
    expect(within(dialog).getByText('Tip adjustments')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Show evidence (services, tips, hours)'));
    await waitFor(() => expect(api.payEvidence).toHaveBeenCalledWith('p1', 't1'));
    const ev = await within(dialog).findByTestId('paycheck-evidence');
    expect(ev).toHaveTextContent('2026-10-13: clocked 480 min · scheduled 450 min · breaks 30 min · paid 450 min');
    expect(ev).toHaveTextContent('Total paid 7.5 h → $150.00');
    expect(ev).toHaveTextContent('matches the time clock');
    expect(ev).toHaveTextContent('Gel manicure');
  });
  it('§12.4 the preparation report lists the checks to issue and the cash envelopes with totals that reconcile', async () => {
    api.payWeek.mockResolvedValue(week('finalized', statement('locked')));
    api.payPreparation.mockResolvedValue({ period: week('finalized').period, technicians: 2,
      checks: { lines: [{ payoutId: 'c1', statementId: 's1', statementNumber: 'PAY-2026-000128', technicianId: 't1', technicianName: 'Mia Chen', method: 'check', amountCents: 75000, status: 'pending', paid: false, checkNumber: null, checkStatus: 'planned', cashSource: null, cashStatus: null, replacesPayoutId: null }], count: 1, amountCents: 75000, toIssue: 1, toDeliver: 0, delivered: 0 },
      cash: { lines: [{ payoutId: 'k1', statementId: 's1', statementNumber: 'PAY-2026-000128', technicianId: 't1', technicianName: 'Mia Chen', method: 'cash', amountCents: 75000, status: 'pending', paid: false, checkNumber: null, checkStatus: null, cashSource: 'safe', cashStatus: 'ready_for_handoff', replacesPayoutId: null }], count: 1, amountCents: 75000, toPrepare: 0, toHandOff: 1, toAcknowledge: 0, acknowledged: 0, disputed: 0, bySource: { safe: { count: 1, amountCents: 75000 } } },
      other: { lines: [], count: 0, amountCents: 0 }, unplanned: [], totals: { payableCents: 150000, committedCents: 150000, unplannedCents: 0, paidCents: 0, unpaidCents: 150000, reconciles: true } });
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Preparation'));
    const rep = await screen.findByTestId('preparation-report');
    expect(api.payPreparation).toHaveBeenCalledWith('p1');
    expect(rep).toHaveTextContent('Cash envelopes and check run for 2026-10-12 – 2026-10-18');
    expect(rep).toHaveTextContent('1 to issue');
    expect(rep).toHaveTextContent('1 to hand over');
    expect(rep).toHaveTextContent('every cent accounted for');
    expect(within(rep).getAllByText(/PAY-2026-000128/)).toHaveLength(2);
  });
  it('§3.4 a draft period opened by mistake is canceled with a reason (step-up); a canceled period shows why', async () => {
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Cancel this period'));
    const why = screen.getByLabelText('Why is it canceled?');
    fireEvent.change(why, { target: { value: 'Opened by mistake' } });
    api.payWeek.mockResolvedValue({ ...week('canceled'), period: { ...week('canceled').period, cancelReason: 'Opened by mistake' } });
    fireEvent.click(screen.getByText('Cancel period'));
    await waitFor(() => expect(api.payCancelPeriod).toHaveBeenCalledWith('p1', 'Opened by mistake', 5));
    expect(stepUp).toHaveBeenCalled();
    expect(await screen.findByText('This period was canceled: Opened by mistake')).toBeInTheDocument();
    expect(screen.queryByText('Submit to owner')).not.toBeInTheDocument();
  });
  it('§11.5 the three more cash confirmations: a QR handoff code, PIN + signature, manager + technician (step-up)', async () => {
    const st = statement('locked', [payout({ id: 'k1', method: 'cash', checkStatus: null, cashStatus: 'ready_for_handoff', cashSource: 'safe' })]);
    api.payWeek.mockResolvedValue(week('finalized', st)); api.payStatement.mockResolvedValue(st);
    api.cashHandoffToken.mockResolvedValue({ payoutId: 'k1', handoffCode: 'A1B2C3D4', expiresAt: '2026-10-23T15:10:00Z' });
    render(<PaycheckTab periods={periods} reload={reload} can={all} stepUp={stepUp} />);
    fireEvent.click(await screen.findByText('Mia Chen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('Show handoff code'));
    await waitFor(() => expect(api.cashHandoffToken).toHaveBeenCalledWith('k1'));
    expect(await within(dialog).findByText(/types A1B2C3D4/)).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Show handoff code' })).toBeInTheDocument();   // the QR
    // manager + technician dual: the PIN plus the manager's step-up
    fireEvent.change(within(dialog).getByLabelText('Technician PIN'), { target: { value: '4321' } });
    fireEvent.click(within(dialog).getByText('Manager + technician confirm'));
    await waitFor(() => expect(api.cashAckDual).toHaveBeenCalledWith('k1', '4321'));
    expect(stepUp).toHaveBeenCalled();
    // PIN + signature: the strokes are sent as path data with the PIN
    fireEvent.change(within(dialog).getByLabelText('Technician PIN'), { target: { value: '4321' } });
    fireEvent.click(within(dialog).getByText('PIN + signature'));
    const pad = await within(dialog).findByTestId('signature-pad');
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 100, right: 300, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    (pad as any).setPointerCapture = () => undefined;
    // jsdom has no PointerEvent: a MouseEvent of the pointer type carries the coordinates React reads
    const stroke = (type: string, clientX: number, clientY: number) => fireEvent(pad, Object.assign(new MouseEvent(type, { bubbles: true, clientX, clientY }), { pointerId: 1 }));
    stroke('pointerdown', 10, 20); stroke('pointermove', 40, 50); stroke('pointermove', 80, 30); stroke('pointerup', 80, 30);
    fireEvent.click(within(dialog).getByText('Confirm with PIN + signature'));
    await waitFor(() => expect(api.cashAckSignature).toHaveBeenCalledWith('k1', { pin: '4321', signature: 'M 10 20 L 40 50 L 80 30' }));
  });
});
