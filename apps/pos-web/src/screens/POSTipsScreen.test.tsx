// Payments → Tips & Gratuity (Oct 29 2026 one-screen rebuild): the five KPIs are the server's, the photo's $9.60 / $19.20
// shows the allocated $9.60 with the snapshot FLAGGED (never summed), filters and search go to the server, the detail keeps
// collected / allocated / snapshot / payout apart, and a correction needs Σ == tip and a reason.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ summary: vi.fn(), transactions: vi.fn(), distribution: vi.fn(), technicians: vi.fn(), adjustments: vi.fn(), detail: vi.fn(), exportCsv: vi.fn() }));
const payroll = vi.hoisted(() => ({ ticketTip: vi.fn(), setTicketTip: vi.fn(), adjustTicketTip: vi.fn() }));
vi.mock('../api/posTipsScreenApi', () => ({ posTipsScreenApi: api }));
vi.mock('../api/posPayrollApi', () => ({ posPayrollApi: payroll }));
vi.mock('./access/accessUi', () => ({ useStepUp: () => ({ run: (fn: () => Promise<unknown>) => fn(), prompt: null }), isStepUpCancelled: () => false }));
import { POSTipsScreen } from './POSTipsScreen';

const PERIOD = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-29' };
const summary = { period: PERIOD, basis: 'collected', permissions: { export: true, adjust: true },
  kpis: { totalTipsCents: 960, reversedCents: 0, netTipsCents: 960, cardTipsCents: 960, cashTipsCents: 0, avgTipRatePct: 6.7, avgTipPerTippedTicketCents: 960, noTipCount: 2, eligibleTickets: 3, tippedTickets: 1, splitTickets: 0 },
  reconciliation: { collectedCents: 960, allocatedCents: 960, unallocatedCents: 0, manualCorrectionCents: 0, reversedCents: 0, snapshotCents: 1920, snapshotMismatchTickets: 1, paidOutCents: 0, pendingPayoutCents: 960, balanced: true } };
const row = (o: Record<string, unknown> = {}) => ({ ticketId: 't1', ticketNumber: '1052', collectedAt: '2026-10-28T16:28:00Z', checkoutAt: '2026-10-28T15:50:00Z', branch: 'Main', customer: { id: 'c1', name: 'John Smith', phone: '(856) 555-1234' },
  technicians: [{ id: 'v', name: 'Vishal verma' }], method: 'card', tenders: 1, paymentRefs: ['RR9001'], amountCents: 960, cardCents: 960, cashCents: 0, pretipSalesCents: 14400, totalCents: 15360, allocatedCents: 960, unallocatedCents: 0, allocationState: 'allocated',
  snapshotCents: 1920, snapshotMismatch: true, reversedCents: 0, netCents: 960, manualCorrectionCents: 0, payout: { state: 'open', periodId: 'p1', periodLabel: 'This period', paidAt: null }, ...o });
const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 10, total: items.length, pageCount: 1, period: PERIOD });
const dist = { ...pageOf([{ technicianId: 'v', name: 'Vishal verma', active: true, tickets: 1, allocatedCents: 960, cardCents: 960, cashCents: 0, sharePct: 100, paidOutCents: 0, pendingCents: 960, manualCorrectionCents: 0, reversedCents: 0, netCents: 960, lastAt: null }]), totals: { allocatedCents: 960, technicians: 1 } };
const mount = () => render(<MemoryRouter><POSTipsScreen /></MemoryRouter>);
beforeEach(() => {
  for (const g of [api, payroll]) Object.values(g).forEach((f) => f.mockReset());
  api.summary.mockResolvedValue(summary); api.transactions.mockResolvedValue(pageOf([row()])); api.distribution.mockResolvedValue(dist); api.technicians.mockResolvedValue([{ id: 'v', name: 'Vishal verma' }]); api.adjustments.mockResolvedValue(pageOf([]));
});

describe('POSTipsScreen', () => {
  it('shows the five server KPIs and the photo reconciled: Vishal $9.60 allocated, the $19.20 snapshot flagged — not summed', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Tips & Gratuity' })).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total')).toHaveTextContent('$9.60');
    expect(screen.getByTestId('kpi-card')).toHaveTextContent('$9.60'); expect(screen.getByTestId('kpi-cash')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('kpi-avg')).toHaveTextContent('6.7%'); expect(screen.getByTestId('kpi-notip')).toHaveTextContent('2');
    const bars = await screen.findByTestId('tech-bars'); expect(bars).toHaveTextContent('Vishal verma'); expect(bars).toHaveTextContent('$9.60'); expect(bars).not.toHaveTextContent('$19.20');
    expect(screen.getByTestId('mismatch-chip')).toHaveTextContent('1 ticket(s) disagree with payroll snapshot');
    expect(api.summary.mock.calls[0][0]).toMatchObject({ preset: 'month', dateField: 'collected' });
  });
  it('search, technician, method and status filters go to the server; the mismatch chip opens the flagged list', async () => {
    mount(); await screen.findByTestId('tech-bars');
    fireEvent.click(screen.getByTestId('mismatch-chip'));
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'mismatch', page: 1 })));
    expect(await screen.findByTestId('transactions-table')).toHaveTextContent('Snapshot mismatch');
    fireEvent.change(screen.getByTestId('search'), { target: { value: '856.555.1234' } });
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ search: '856.555.1234' })));
    fireEvent.change(screen.getByTestId('method'), { target: { value: 'cash' } });
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'cash' })));
  });
  it('the detail keeps allocated and snapshot apart; an adjustment needs Σ == tip and a reason, then posts through tips.adjust', async () => {
    api.detail.mockResolvedValue({ tip: row(), payments: [{ id: 'p', method: 'card', amountCents: 15360, tipCents: 960, status: 'approved', processorRef: 'RR9001', at: '2026-10-28T16:28:00Z' }],
      allocations: [{ technicianId: 'v', name: 'Vishal verma', allocatedCents: 960, allocatedAt: null, snapshotCents: 1920, snapshotRows: 2, snapshotMismatch: true, manualCorrectionCents: 0, reversedCents: 0, netCents: 1920 }],
      splitRule: 'single', unallocatedCents: 0, adjustments: [], audit: [], permissions: { adjust: true, customer: true } });
    payroll.ticketTip.mockResolvedValue({ ticketId: 't1', tipCents: 960, status: 'paid', locked: true, allocations: [{ technicianId: 'v', name: 'Vishal verma', tipCents: 960 }, { technicianId: 'a', name: 'Anna Lee', tipCents: 0 }] });
    payroll.setTicketTip.mockResolvedValue({ ok: true });
    mount(); await screen.findByTestId('tech-bars');
    fireEvent.click(screen.getByTestId('tab-transactions'));
    fireEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);
    const alloc = await screen.findByTestId('alloc-table'); expect(alloc).toHaveTextContent('$9.60'); expect(alloc).toHaveTextContent('$19.20'); expect(screen.getByTestId('mismatch-flag')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('adjust'));
    await screen.findByTestId('adjust-form');
    fireEvent.change(screen.getByTestId('alloc-v'), { target: { value: '5.00' } }); fireEvent.change(screen.getByTestId('alloc-a'), { target: { value: '3.00' } });
    fireEvent.change(screen.getByTestId('adjust-reason'), { target: { value: 'Anna did the art' } });
    expect(screen.getByTestId('adjust-save')).toBeDisabled();   // 8.00 ≠ 9.60
    fireEvent.change(screen.getByTestId('alloc-a'), { target: { value: '4.60' } });
    fireEvent.click(screen.getByTestId('adjust-save'));
    await waitFor(() => expect(payroll.setTicketTip).toHaveBeenCalledWith('t1', { allocations: [{ technicianId: 'v', tipCents: 500 }, { technicianId: 'a', tipCents: 460 }], reason: 'Anna did the art' }));
  });
  it('Tip split preview: Split evenly fills exact cents, shows before → after per technician and where the remainder cent goes; nothing saves until Save', async () => {
    api.detail.mockResolvedValue({ tip: row({ amountCents: 961 }), payments: [], allocations: [], splitRule: 'single', unallocatedCents: 0, adjustments: [], audit: [], permissions: { adjust: true, customer: true } });
    payroll.ticketTip.mockResolvedValue({ ticketId: 't1', tipCents: 961, status: 'open', locked: false, allocations: [{ technicianId: 'v', name: 'Vishal verma', tipCents: 961 }, { technicianId: 'a', name: 'Anna Lee', tipCents: 0 }] });
    mount(); await screen.findByTestId('tech-bars');
    fireEvent.click(screen.getByTestId('tab-transactions'));
    fireEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);
    fireEvent.click(await screen.findByTestId('adjust'));
    await screen.findByTestId('adjust-form');
    expect(screen.queryByTestId('split-preview')).toBeNull();   // nothing changed yet
    fireEvent.click(screen.getByTestId('split-even'));
    expect((screen.getByTestId('alloc-v') as HTMLInputElement).value).toBe('4.81'); expect((screen.getByTestId('alloc-a') as HTMLInputElement).value).toBe('4.80');
    const rows = screen.getAllByTestId('split-row');
    expect(rows[0]).toHaveTextContent('Vishal verma'); expect(rows[0]).toHaveTextContent('$9.61'); expect(rows[0]).toHaveTextContent('−$4.80');
    expect(rows[1]).toHaveTextContent('+$4.80');
    expect(screen.getByTestId('split-remainder').textContent).toBe('Rounding remainder: 1¢, one cent each to Vishal verma');
    expect(screen.queryByTestId('split-diff')).toBeNull();
    fireEvent.change(screen.getByTestId('alloc-a'), { target: { value: '4.00' } });
    expect(screen.getByTestId('split-diff').textContent).toMatch(/Off by \$0\.80/);
    expect(screen.queryByTestId('split-remainder')).toBeNull();
    expect(payroll.setTicketTip).not.toHaveBeenCalled();
  });
  it('D15/D19 gaps — Add or remove tip: one technician, a direction, an amount and a reason, sent once with an Idempotency-Key', async () => {
    api.detail.mockResolvedValue({ tip: row(), payments: [], allocations: [], splitRule: 'single', unallocatedCents: 0, adjustments: [], audit: [], permissions: { adjust: true, customer: true } });
    payroll.ticketTip.mockResolvedValue({ ticketId: 't1', tipCents: 960, status: 'paid', locked: true, allocations: [{ technicianId: 'v', name: 'Vishal verma', tipCents: 960 }, { technicianId: 'a', name: 'Anna Lee', tipCents: 0 }] });
    payroll.adjustTicketTip.mockResolvedValue({ ok: true, amountCents: -200, earnedCents: 760, routedToNextPeriod: false });
    mount(); await screen.findByTestId('tech-bars');
    fireEvent.click(screen.getByTestId('tab-transactions'));
    fireEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);
    fireEvent.click(await screen.findByTestId('free-adjust'));
    await screen.findByTestId('free-adjust-form');
    fireEvent.change(screen.getByTestId('free-dir'), { target: { value: 'remove' } });
    fireEvent.change(screen.getByTestId('free-amount'), { target: { value: '2.00' } });
    expect(screen.getByTestId('free-save')).toBeDisabled();   // no reason yet
    fireEvent.change(screen.getByTestId('free-reason'), { target: { value: 'Entered twice' } });
    fireEvent.click(screen.getByTestId('free-save'));
    await waitFor(() => expect(payroll.adjustTicketTip).toHaveBeenCalledWith('t1', { technicianId: 'v', amountCents: -200, reason: 'Entered twice' }, expect.any(String)));
  });
  it('shows a permission state on 403 and no export button without the permission', async () => {
    api.summary.mockRejectedValue({ status: 403 }); api.transactions.mockRejectedValue({ status: 403 }); api.distribution.mockRejectedValue({ status: 403 });
    mount();
    expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument();
    expect(screen.queryByTestId('export')).toBeNull();
  });
  it('Tips 10: each tipped row and the detail say verified / pending / adjusted / needs review from the server fields', async () => {
    api.transactions.mockResolvedValue(pageOf([row(), row({ ticketId: 't2', ticketNumber: '1053', snapshotCents: 960, snapshotMismatch: false }), row({ ticketId: 't3', ticketNumber: '1054', snapshotCents: null, snapshotMismatch: false }),
      row({ ticketId: 't4', ticketNumber: '1055', snapshotCents: 960, snapshotMismatch: false, reversedCents: -960 }), row({ ticketId: 't5', ticketNumber: '1056', amountCents: 0 })]));
    mount(); await screen.findByTestId('tech-bars');
    fireEvent.click(screen.getByTestId('tab-transactions'));
    await screen.findByTestId('transactions-table');
    expect(screen.getAllByTestId('tip-source-row').map((e) => e.textContent)).toEqual(['Needs review', 'Verified', 'Pending', 'Adjusted']);   // no label on the zero tip
  });
  it('Tips 05: the refund impact preview explains the collected total, each allocation and payable — and posts nothing', async () => {
    api.detail.mockResolvedValue({ tip: row({ snapshotCents: 960, snapshotMismatch: false, payout: { state: 'paid', periodId: 'p1', periodLabel: 'Oct 1–15', paidAt: '2026-10-16T12:00:00Z' } }), payments: [],
      allocations: [{ technicianId: 'v', name: 'Vishal verma', allocatedCents: 600, snapshotCents: 600, snapshotMismatch: false, manualCorrectionCents: 0, reversedCents: 0, netCents: 600 }, { technicianId: 'a', name: 'Anna Lee', allocatedCents: 360, snapshotCents: 360, snapshotMismatch: false, manualCorrectionCents: 0, reversedCents: 0, netCents: 360 }],
      splitRule: 'manual', unallocatedCents: 0, adjustments: [], audit: [], permissions: { adjust: true, customer: true } });
    mount(); await screen.findByTestId('tech-bars');
    fireEvent.click(screen.getByTestId('tab-transactions'));
    fireEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);
    expect(await screen.findByTestId('tip-source')).toHaveTextContent('Verified');
    fireEvent.click(screen.getByTestId('refund-impact-open'));
    expect(screen.getByTestId('refund-impact-posting')).toHaveTextContent('No change');
    expect(screen.getByTestId('refund-impact-totals')).toHaveTextContent('$9.60 → $9.60');
    fireEvent.change(screen.getByTestId('refund-impact-scenario'), { target: { value: 'full_with_tip' } });
    expect(screen.getByTestId('refund-impact-totals')).toHaveTextContent('$9.60 → $0.00');
    expect(screen.getByTestId('refund-impact-totals')).toHaveTextContent('stays as collected');
    expect(screen.getByTestId('refund-impact-posting')).toHaveTextContent('already paid: the reversal goes to a future period');
    const rows = screen.getByTestId('refund-impact-rows'); expect(rows).toHaveTextContent('Vishal verma'); expect(rows).toHaveTextContent('−$6.00'); expect(rows).toHaveTextContent('−$3.60');
    fireEvent.change(screen.getByTestId('refund-impact-scenario'), { target: { value: 'chargeback' } });
    expect(screen.getByTestId('refund-impact-posting')).toHaveTextContent('waits for a manager review');
    expect(payroll.setTicketTip).not.toHaveBeenCalled(); expect(payroll.adjustTicketTip).not.toHaveBeenCalled();
  });
  it('Individual Technician Tipping 05 (round 10): the distribution tab flags a technician whose tickets do not add up (server count); a balanced one shows nothing', async () => {
    api.distribution.mockResolvedValue({ ...dist, items: [{ ...dist.items[0], unreconciledTickets: 2 }, { ...dist.items[0], technicianId: 'a', name: 'Anna Lee', unreconciledTickets: 0 }] });
    mount();
    fireEvent.click(await screen.findByTestId('tab-distribution'));
    const rows = await screen.findAllByTestId('dist-row');
    expect(rows[0]).toHaveTextContent('2 ticket(s) do not add up');
    expect(screen.getAllByTestId('dist-unreconciled')).toHaveLength(1);
  });
});
