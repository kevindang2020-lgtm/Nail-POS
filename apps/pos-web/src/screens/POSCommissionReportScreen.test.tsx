// POSCommissionReportScreen — the Commission Report rebuild (Oct 30 2026): the five KPIs and the seven-column table equal
// the photo's month, the table pages / sorts / searches on the server, a row opens Technician Commission Details with the
// captured rate per line, the reconciliation calls the payout an obligation and Paid only what payroll recorded, the
// cross-check against the payroll calculation, and the empty state.
import { MemoryRouter } from 'react-router-dom';   // the review slide-over links to Payroll
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
const { cm, cr, stateMock } = vi.hoisted(() => ({ cm: { summary: vi.fn(), technicians: vi.fn(), lines: vi.fn(), tips: vi.fn(), adjustments: vi.fn(), payouts: vi.fn(), exportCsv: vi.fn(), exportHistory: vi.fn() },
  cr: { list: vi.fn(), detail: vi.fn(), assignees: vi.fn(), runCheck: vi.fn(), setRefundPolicy: vi.fn(), assign: vi.fn(), investigate: vi.fn(), note: vi.fn(), resolve: vi.fn(), dismiss: vi.fn(), reopen: vi.fn() }, stateMock: vi.fn() }));
vi.mock('../api/posTeamScreensApi', () => ({ posCommissionScreenApi: cm, posCommissionReviewApi: cr }));
vi.mock('../api/posCommissionReportApi', () => ({ posCommissionReportApi: { state: stateMock } }));
vi.mock('../components/IPadViewProvider', () => ({ useIPadView: () => ({ open: vi.fn() }), registerIPadModule: vi.fn() }));
import { POSCommissionReportScreen } from './POSCommissionReportScreen';

const period = { preset: 'month', from: '2026-10-01', to: '2026-10-30', tz: 'America/New_York', today: '2026-10-30' };
const K = { technicianCount: 2, lineCount: 28, serviceRevenueCents: 188100, discountCents: 0, commissionableCents: 188100, commissionCents: 25880, commissionAdjustmentCents: 0, tipsCents: 33300, tipAdjustmentCents: 0, payoutCents: 59180, averageRatePercent: 13.8, paidCents: 30000, pendingCents: 0 };
const row = (id: string, name: string, n: number, rev: number, comm: number, rate: number, tips: number, paid = 0) => ({ technicianId: id, technicianName: name, avatarUrl: null, inactive: false, serviceCount: n, serviceRevenueCents: rev, discountCents: 0, commissionableCents: rev,
  commissionCents: comm, commissionAdjustmentCents: 0, tipsCents: tips, tipAdjustmentCents: 0, payoutCents: comm + tips, effectiveRatePercent: rate, lastActivityAt: null, paidCents: paid, pendingCents: 0, matchedVia: null });
const ROWS = [row('v', 'Vishal verma', 27, 183100, 23880, 13, 32300, 30000), row('c', 'CD T6805', 1, 5000, 2000, 40, 1000)];
const REVIEW = { id: 'r1', type: 'TIP_MISMATCH', verification: 'CONFIRMED', status: 'OPEN', severity: 'medium', summary: 'Tip allocations do not add up.', technicianId: null, technician: null, ticketId: 't1', ticketNumber: 'T-2001',
  expectedCents: 1700, recordedCents: 1200, differenceCents: -500, assigneeUserId: null, assignee: null, detectedAt: '2026-10-29T15:00:00Z', updatedAt: '2026-10-29T15:00:00Z', version: 1, actions: ['assign', 'investigate', 'note', 'resolve', 'dismiss'] };
let DETAIL: any;
const page = (items: unknown[], extra = {}) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, ...extra });
beforeEach(() => {
  DETAIL = { ...REVIEW, evidence: { check: 'tip_mismatch' }, canAct: true, canClose: true, selfPay: false, history: { items: [{ id: 'h1', type: 'DETECTED', from: null, to: 'OPEN', reason: null, metadata: {}, at: '2026-10-29T15:00:00Z', actor: null }], page: 1, pageSize: 6, totalItems: 1, totalPages: 1 } };
  for (const f of [...Object.values(cm), stateMock]) (f as any).mockReset();
  cm.summary.mockResolvedValue({ period, basis: 'paid_checkout', kpis: K });
  cm.technicians.mockImplementation(async (q: any) => page(q?.q ? ROWS.slice(0, 1).map((r) => ({ ...r, matchedVia: 'line' })) : ROWS));
  cm.payouts.mockResolvedValue(page([{ id: 'p1', technicianId: 'v', technician: 'Vishal verma', amountCents: 30000, method: 'cash', status: 'paid', reference: 'PAY-778', paidAt: '2026-10-29T15:00:00Z', createdAt: '2026-10-29T15:00:00Z', payrollPeriod: 'Oct 1–15' }]));
  cm.exportHistory.mockResolvedValue({ scope: 'salon', ...page([{ id: 'e1', event: 'succeeded', reportType: 'COMMISSION', result: 'success', at: '2026-10-30T14:00:00Z', requestId: 'r1', actor: 'Pat Owner', rowCount: 2 }]) });
  cm.exportCsv.mockResolvedValue('\uFEFFTechnician,Services\r\nVishal verma,27');
  for (const f of Object.values(cr)) (f as any).mockReset();
  cr.list.mockResolvedValue({ ...page([REVIEW]), counts: { OPEN: 1, ASSIGNED: 0, INVESTIGATING: 0, RESOLVED: 0, DISMISSED: 0 }, lastRun: { status: 'succeeded', startedAt: '2026-10-30T14:00:00Z', finishedAt: '2026-10-30T14:00:05Z', from: '2026-10-01', to: '2026-10-30', actor: 'Pat Owner' }, policy: null });
  cr.detail.mockImplementation(async () => DETAIL);
  cr.assignees.mockResolvedValue({ items: [{ userId: 'u1', name: 'Kim Manager' }] });
  cm.lines.mockResolvedValue(page([{ id: 'l1', ticketId: 't1', ticketNumber: 'T-2001', at: '2026-10-29T15:00:00Z', service: 'Gel Manicure', kind: 'service', customer: 'Mai Le', grossCents: 6800, discountCents: 0, commissionableCents: 6800, rateType: 'percent', rateValue: 13, rateSource: null, earnedCents: 885, effectivePercent: 13, tipsCents: 1200, techsOnTicket: 1 }], { totalItems: 27, totalPages: 4 }));
  cm.tips.mockResolvedValue(page([{ id: 'a1', ticketId: 't1', ticketNumber: 'T-2001', at: '2026-10-29T15:00:00Z', tipCents: 1200, ticketTipCents: 1700, shares: 1, allocatedCents: 1200, mismatch: true }]));
  stateMock.mockResolvedValue({ preset: 'month', from: '2026-10-01', to: '2026-10-30', kpis: { technicianCount: 2, totalServiceRevenueCents: 188100, totalCommissionCents: 25880, totalTipsCents: 33300, totalPayoutCents: 59180, averageRatePercent: 13.8 }, rows: [] });
});

describe('POSCommissionReportScreen', () => {
  it('the five KPIs and the seven columns equal the photo, with the total row', async () => {
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Commission Report' })).toBeInTheDocument();
    expect(await screen.findByTestId('kpi-payout')).toHaveTextContent('$591.80');
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('$1,881.00');
    expect(screen.getByTestId('kpi-commission')).toHaveTextContent('$258.80');
    expect(screen.getByTestId('kpi-tips')).toHaveTextContent('$333.00');
    const rows = await screen.findAllByTestId('payout-row');
    expect(rows[0]).toHaveTextContent('Vishal verma'); expect(rows[0]).toHaveTextContent('$561.80'); expect(rows[1]).toHaveTextContent('$30.00');
    expect(screen.getByTestId('payout-total')).toHaveTextContent('$591.80');
    expect(await screen.findByTestId('check-ok')).toBeInTheDocument();   // same days as the payroll calculation, same totals
  });
  it('search and sort go to the server; Page 1 again', async () => {
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>); await screen.findAllByTestId('payout-row');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'T-2001' } });
    await waitFor(() => expect(cm.technicians).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'T-2001', page: 1 })));
    fireEvent.change(screen.getByTestId('sort'), { target: { value: 'name' } });
    await waitFor(() => expect(cm.technicians).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name', page: 1 })));
  });
  it('a row opens the details: captured rate per line, the tip mismatch; Esc closes', async () => {
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('payout-row'))[0]);
    expect(await screen.findByTestId('commission-summary')).toHaveTextContent('$561.80');
    expect(await screen.findByTestId('line-row')).toHaveTextContent('13%');
    expect(cm.lines).toHaveBeenCalledWith('v', expect.objectContaining({ preset: 'month', page: 1 }));
    fireEvent.click(screen.getByTestId('ctab-tips'));
    expect(await screen.findByTestId('tip-row')).toHaveTextContent('≠');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dlg-commission')).toBeNull());
  });
  it('reconciliation: payable is owed, Paid only from recorded payouts; a differing payroll calculation is flagged', async () => {
    stateMock.mockResolvedValue({ preset: 'month', from: '2026-10-01', to: '2026-10-30', kpis: { technicianCount: 2, totalServiceRevenueCents: 188100, totalCommissionCents: 25000, totalTipsCents: 33300, totalPayoutCents: 58300, averageRatePercent: 13.3 }, rows: [] });
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>);
    const r = await screen.findByTestId('recon');
    expect(r).toHaveTextContent('$591.80'); expect(r).toHaveTextContent('$300.00');
    expect(await screen.findByTestId('check-diff')).toHaveTextContent('+$8.80');
    expect(await screen.findAllByTestId('payout-history-row')).toHaveLength(1);
    expect(await screen.findAllByTestId('disc-row')).toHaveLength(1);
  });
  it('F1: a finding opens the review slide-over; Resolve sends the version, code and note, and shows the server-confirmed state', async () => {
    cr.resolve.mockImplementation(async () => { DETAIL = { ...DETAIL, status: 'RESOLVED', version: 2, resolutionCode: 'NO_ACTION', resolutionNote: 'Split at the desk', actions: ['note', 'reopen'],
      history: { ...DETAIL.history, items: [{ id: 'h2', type: 'RESOLVED', from: 'OPEN', to: 'RESOLVED', reason: 'Split at the desk', metadata: { resolutionCode: 'NO_ACTION' }, at: '2026-10-30T15:00:00Z', actor: 'Kim Manager' }, ...DETAIL.history.items] } }; return DETAIL; });
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('disc-row'))[0]);
    await screen.findByTestId('review-evidence');
    fireEvent.click(screen.getByTestId('act-resolve'));
    fireEvent.change(screen.getByTestId('resolution'), { target: { value: 'NO_ACTION' } });
    fireEvent.change(screen.getByTestId('review-note'), { target: { value: 'Split at the desk' } });
    fireEvent.click(screen.getByTestId('review-submit'));
    await waitFor(() => expect(cr.resolve).toHaveBeenCalledWith('r1', { expectedVersion: 1, resolutionCode: 'NO_ACTION', note: 'Split at the desk' }));
    expect(await screen.findByTestId('review-done')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('review-status')).toHaveTextContent('Resolved'));
    expect(screen.getAllByTestId('history-row')[0]).toHaveTextContent('Resolved');
  });
  it('Finish the Five 05: open findings by age — overdue chip filters on the server, oldest first, each open row says how long it has waited', async () => {
    cr.list.mockResolvedValue({ ...page([{ ...REVIEW, ageDays: 10, overdue: true }]), counts: { OPEN: 1, ASSIGNED: 0, INVESTIGATING: 0, RESOLVED: 0, DISMISSED: 0 }, lastRun: null, policy: null,
      ageCounts: { new: 0, week: 2, overdue: 1, overdueAfterDays: 7 } });
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>);
    const ages = await screen.findByTestId('cr-age');
    expect(within(ages).getByTestId('cr-age-overdue').textContent).toBe('Overdue (over 7 days) · 1');
    expect(within(ages).getByTestId('cr-age-week').textContent).toBe('1–7 days · 2');
    expect((await screen.findAllByTestId('disc-age'))[0].textContent).toBe('Overdue · 10 d');
    fireEvent.click(within(ages).getByTestId('cr-age-overdue'));
    await waitFor(() => expect(cr.list).toHaveBeenLastCalledWith(expect.objectContaining({ age: 'overdue', page: 1 })));
    fireEvent.click(within(ages).getByTestId('cr-oldest'));
    await waitFor(() => expect(cr.list).toHaveBeenLastCalledWith(expect.objectContaining({ age: 'overdue', sort: 'oldest' })));
    expect(cr.resolve).not.toHaveBeenCalled();
  });
  it('F1: a stale version (409) says someone else changed it and reloads; nothing claims success', async () => {
    cr.investigate.mockRejectedValue({ status: 409, code: 'VERSION_CONFLICT' });
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('disc-row'))[0]); await screen.findByTestId('review-evidence');
    fireEvent.click(screen.getByTestId('act-investigate')); fireEvent.click(screen.getByTestId('review-submit'));
    expect(await screen.findByTestId('review-error')).toHaveTextContent(/changed this finding/);
    expect(screen.queryByTestId('review-done')).toBeNull();
    await waitFor(() => expect(cr.detail.mock.calls.length).toBeGreaterThan(1));
  });
  it('F2: Run Check calls the server for the period and shows its counts; the missing refund policy is visible', async () => {
    cr.runCheck.mockResolvedValue({ detected: 2, alreadyKnown: 1, unableToVerify: 3, checkedLines: 28 });
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>);
    expect(await screen.findByTestId('policy-missing')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('run-check'));
    await waitFor(() => expect(cr.runCheck).toHaveBeenCalledWith({ preset: 'month' }));
    expect(await screen.findByTestId('run-result')).toHaveTextContent('2 new findings');
  });
  it('F3: Export asks the server (audited) with a request id and the screen language; the history lists the attempt', async () => {
    const orig = URL.createObjectURL; URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>); await screen.findByTestId('kpi-payout');
    fireEvent.click(screen.getByTestId('export'));
    await waitFor(() => expect(cm.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ preset: 'month', lang: 'en', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) })));
    expect(await screen.findByTestId('export-history-row')).toHaveTextContent('Succeeded');
    cm.exportCsv.mockRejectedValue({ status: 503 }); fireEvent.click(screen.getByTestId('export'));
    expect(await screen.findByTestId('export-error')).toHaveTextContent(/audit record/);
    URL.createObjectURL = orig;
  });
  it('shows the empty state when nothing was earned', async () => {
    cm.technicians.mockResolvedValue(page([]));
    render(<MemoryRouter><POSCommissionReportScreen /></MemoryRouter>);
    expect(await screen.findByText(/No commissionable activity/)).toBeInTheDocument();
  });
});

describe('POSCommissionReportScreen — period from the URL (batch 9, Nov 10 2026)', () => {
  it('a link from the Technicians Report opens on its period', async () => {
    render(<MemoryRouter initialEntries={['/tenant/reports/commission?preset=custom&from=2026-10-01&to=2026-10-15']}><POSCommissionReportScreen /></MemoryRouter>);
    await waitFor(() => expect(cm.summary).toHaveBeenCalledWith(expect.objectContaining({ preset: 'custom', from: '2026-10-01', to: '2026-10-15' })));
  });
});
