// Team → Tips (Team Tips spec, Nov 13 2026). The page reads the ONE canonical tip read model (/pos/payments/tips*): the four
// cards, the technician leaderboard and Collected / Allocated / Payable / Paid are the server's figures over the same tickets;
// search / filters / pages go to the server; a failed load is never shown as $0.00; the technician overlay and the accuracy
// check are read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ summary: vi.fn(), transactions: vi.fn(), distribution: vi.fn(), technicianEarnings: vi.fn(), accuracy: vi.fn(), technicians: vi.fn(), adjustments: vi.fn(), detail: vi.fn(), exportCsv: vi.fn() }));
const live = vi.hoisted(() => ({ cb: null as null | (() => unknown) }));
vi.mock('../api/posTipsScreenApi', () => ({ posTipsScreenApi: api }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: (_s: string, cb: () => unknown) => { live.cb = cb; } }));
import { POSTeamTipsScreen } from './POSTeamTipsScreen';

const PERIOD = { preset: 'month', from: '2026-11-01', to: '2026-11-30', tz: 'America/New_York', today: '2026-11-13' };
const summary = (o: Record<string, unknown> = {}) => ({ period: PERIOD, basis: 'collected', permissions: { export: true, adjust: false, customer: false },
  kpis: { totalTipsCents: 960, cardTipsCents: 960, cashTipsCents: 0, cashDrawerTipsCents: 0, cashToTechnicianTipsCents: 0, avgTipRatePct: 6.7, avgTipPerTippedTicketCents: 960, tippedTickets: 1, noTipCount: 2, eligibleTickets: 3 },
  reconciliation: { collectedCents: 960, allocatedCents: 960, unallocatedCents: 0, reversedCents: 0, paidOutCents: 0, pendingPayoutCents: 960, payableCents: 0, accruedCents: 960, balanced: true }, ...o });
const row = (o: Record<string, unknown> = {}) => ({ ticketId: 't1', ticketNumber: '1052', collectedAt: '2026-11-10T16:28:00Z', customer: { id: 'c1', name: 'Linh T.', phone: '(•••) •••-1234' }, technicians: [{ id: 'v', name: 'Vishal verma' }],
  method: 'card', amountCents: 960, allocatedCents: 960, unallocatedCents: 0, allocationState: 'allocated', reversedCents: 0, payout: { state: 'open', periodLabel: null }, ...o });
const paged = (items: unknown[], o: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 25, total: items.length, pageCount: 1, ...o });
const leader = (o: Record<string, unknown> = {}) => ({ technicianId: 'v', name: 'Vishal verma', tickets: 1, allocatedCents: 960, paidOutCents: 0, pendingCents: 960, ...o });
const earnings = { technician: { id: 'v', name: 'Vishal verma', active: true }, period: PERIOD, dateBasis: 'collected',
  totals: { allocatedCents: 960, paidCents: 0, approvedCents: 0, openCents: 960, unscheduledCents: 0, pendingCents: 960, tickets: 1, manualCorrectionCents: 0, reversedCents: 0, netCents: 960 }, periods: [],
  items: [{ ticketId: 't1', ticketNumber: '1052', collectedAt: '2026-11-10T16:28:00Z', ticketTipCents: 960, allocatedCents: 960, sharedWith: 0, payoutState: 'open', period: null, method: 'card', allocationBasis: 'single', corrected: false }],
  total: 1, page: 1, pageSize: 10, pageCount: 1 };

beforeEach(() => {
  sessionStorage.clear(); live.cb = null;
  Object.values(api).forEach((f) => f.mockReset());
  api.summary.mockResolvedValue(summary());
  api.distribution.mockResolvedValue(paged([leader()], { pageSize: 10 }));
  api.transactions.mockResolvedValue(paged([row()]));
  api.technicianEarnings.mockResolvedValue(earnings);
});

describe('POSTeamTipsScreen', () => {
  it('keeps the four KPI cards, the four presets (+ Custom), Tips by Technician and the time basis', async () => {
    render(<POSTeamTipsScreen />);
    expect(await screen.findByRole('heading', { name: 'Team Tips' })).toBeInTheDocument();
    expect(await screen.findByTestId('tt-kpi-total')).toHaveTextContent('$9.60');
    expect(screen.getByTestId('tt-kpi-card')).toHaveTextContent('$9.60');
    expect(screen.getByTestId('tt-kpi-cash')).toHaveTextContent('$0.00');
    for (const p of ['today', 'week', 'month', 'year', 'custom']) expect(screen.getByTestId('preset-' + p)).toBeInTheDocument();
    expect(screen.getByTestId('tips-basis')).toHaveTextContent('day the payment was taken');
    expect(await screen.findByTestId('tt-leaderboard')).toHaveTextContent('Vishal verma');
    expect(api.summary.mock.calls[0][0]).toMatchObject({ preset: 'month', dateField: 'collected' });
    expect(api.distribution.mock.calls[0][0]).toMatchObject({ sort: 'allocated_desc', page: 1 });
  });
  it('P0: the cards and the leaderboard are the same tickets — $9.60 on both, never $0.00 beside $9.60; unallocated is named', async () => {
    api.summary.mockResolvedValue(summary({ reconciliation: { ...summary().reconciliation, collectedCents: 1460, allocatedCents: 960, unallocatedCents: 500 }, kpis: { ...summary().kpis, totalTipsCents: 1460 } }));
    render(<POSTeamTipsScreen />);
    expect(await screen.findByTestId('tt-kpi-total')).toHaveTextContent('$14.60');
    expect(await screen.findByTestId('tt-unallocated')).toHaveTextContent('$5.00');
    expect(screen.getByTestId('tt-rec-collected')).toHaveTextContent('$14.60');
    expect(screen.getByTestId('tt-rec-allocated')).toHaveTextContent('$9.60');
    expect(screen.getByTestId('tt-rec-payable')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('tt-rec-paid')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('tt-balanced')).toHaveTextContent('collected = allocated + unallocated');
  });
  it('Avg Tip is a dollar amount per tipped ticket with the % rate labelled as a rate; no tipped tickets → "—", never "0%"', async () => {
    const { unmount } = render(<POSTeamTipsScreen />);
    expect(await screen.findByTestId('tt-kpi-avg')).toHaveTextContent('Avg Tip ($)');
    expect(screen.getByTestId('tt-kpi-avg')).toHaveTextContent('$9.60');
    expect(screen.getByTestId('tt-kpi-avg')).toHaveTextContent('tip rate 6.7% of pre-tip sales');
    unmount();
    api.summary.mockResolvedValue(summary({ kpis: { ...summary().kpis, totalTipsCents: 0, cardTipsCents: 0, avgTipRatePct: null, avgTipPerTippedTicketCents: null, tippedTickets: 0 } }));
    render(<POSTeamTipsScreen />);
    await waitFor(() => expect(screen.getByTestId('tt-kpi-avg')).toHaveTextContent('No tipped tickets in this period'));
    expect(screen.getByTestId('tt-kpi-avg')).toHaveTextContent('—');
    expect(screen.getByTestId('tt-kpi-avg')).not.toHaveTextContent('0%');
  });
  it('a failed load is an error with Retry — never $0.00; a 403 is a permission message', async () => {
    api.summary.mockRejectedValue({ status: 503 });
    const { unmount } = render(<POSTeamTipsScreen />);
    expect((await screen.findAllByText(/could not be reached/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
    unmount();
    api.summary.mockRejectedValue({ status: 403 });
    render(<POSTeamTipsScreen />);
    expect(await screen.findByText(/cannot see this information/i)).toBeInTheDocument();
  });
  it('search, method and status go to the server and start again on page 1; numbered pages and 10/25/50/100 rows', async () => {
    api.transactions.mockResolvedValue(paged([row()], { total: 60, pageCount: 3 }));
    render(<POSTeamTipsScreen />);
    await screen.findAllByTestId('tt-row');
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 25, sort: 'collected_desc' })));
    fireEvent.change(screen.getByTestId('tips-search'), { target: { value: 'thao' } });
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'thao', page: 1 })));
    fireEvent.change(screen.getByTestId('tt-method'), { target: { value: 'cash' } });
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'cash', page: 1 })));
    fireEvent.change(screen.getByTestId('tt-status'), { target: { value: 'unallocated' } });
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unallocated' })));
    fireEvent.change(screen.getByTestId('tt-page-size'), { target: { value: '100' } });
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 100, page: 1 })));
    fireEvent.click(screen.getByTestId('tt-reset'));
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, method: undefined, status: undefined, pageSize: 25 })));
  });
  it('rows are numbered from the page start (page 2 of 25 starts at 26); the customer column only for customer access', async () => {
    api.transactions.mockResolvedValue(paged([row(), row({ ticketId: 't2', ticketNumber: '1053' })], { page: 2, total: 27, pageCount: 2 }));
    const { unmount } = render(<POSTeamTipsScreen />);
    const rows = await screen.findAllByTestId('tt-row');
    expect(within(rows[0]).getAllByRole('cell')[0]).toHaveTextContent('26');
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('27');
    expect(screen.queryByText('Linh T.')).toBeNull();
    unmount();
    api.summary.mockResolvedValue(summary({ permissions: { customer: true } }));
    render(<POSTeamTipsScreen />);
    expect(await screen.findAllByText('Linh T.')).toHaveLength(2);
  });
  it('Custom: From / To month popovers; Apply sends the exact days; To before From is never applied reversed', async () => {
    render(<POSTeamTipsScreen />);
    await screen.findByTestId('tt-kpi-total');
    fireEvent.click(screen.getByTestId('preset-custom'));
    const cal = await screen.findByTestId('range-calendar');
    fireEvent.click(within(cal).getByTestId('range-from'));
    fireEvent.click(cal.querySelector('[data-ymd="2026-11-10"]')!);
    fireEvent.click(cal.querySelector('[data-ymd="2026-11-03"]')!);   // before From: becomes the new From, To cleared
    expect(within(cal).getByTestId('range-apply')).toBeDisabled();
    fireEvent.click(cal.querySelector('[data-ymd="2026-11-12"]')!);
    fireEvent.click(within(cal).getByTestId('range-apply'));
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'custom', from: '2026-11-03', to: '2026-11-12' })));
    expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'custom', from: '2026-11-03', to: '2026-11-12', page: 1 }));
  });
  it('a technician row opens the READ-ONLY detail (method, allocation basis, payroll state); Escape closes and keeps the page', async () => {
    render(<POSTeamTipsScreen />);
    const r = await screen.findByTestId('tt-leader');
    fireEvent.keyDown(r, { key: 'Enter' });
    const ov = await screen.findByTestId('tt-tech-overlay');
    expect(api.technicianEarnings).toHaveBeenCalledWith('v', expect.objectContaining({ preset: 'month', page: 1 }));
    expect(await within(ov).findByTestId('tt-ov-row')).toHaveTextContent('Only technician');
    expect(within(ov).getByTestId('tt-ov-row')).toHaveTextContent('Card');
    expect(within(ov).getByTestId('tt-ov-readonly')).toHaveTextContent('Read-only');
    expect(within(ov).queryByRole('button', { name: /adjust|save|record/i })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('tt-tech-overlay')).toBeNull());
    expect(screen.getByTestId('tt-kpi-total')).toHaveTextContent('$9.60');
  });
  it('the Tip accuracy check lists findings read-only; "Show ticket" searches for it', async () => {
    api.accuracy.mockResolvedValue({ period: PERIOD, dateBasis: 'collected', asOf: '2026-11-13T12:00:00Z', readOnly: true, overall: 'warn',
      totals: { collectedCents: 960, allocatedCents: 960, unallocatedCents: 0, technicianSumCents: 960, tippedTickets: 1 },
      checks: [{ key: 'period_match', status: 'warn', count: 1, cents: 960, samples: ['8c0e1d2a-0000-4000-8000-000000000001'] }, { key: 'over_allocated', status: 'ok', count: 0, cents: 0, samples: [] }] });
    render(<POSTeamTipsScreen />);
    await screen.findByTestId('tt-kpi-total');
    fireEvent.click(screen.getByTestId('tt-accuracy-open'));
    const ov = await screen.findByTestId('tt-accuracy');
    expect(await within(ov).findByTestId('tt-acc-period_match')).toHaveTextContent('First payment is outside this period');
    expect(within(ov).getByTestId('tt-acc-period_match')).toHaveTextContent('Review');
    expect(within(ov).getByTestId('tt-acc-over_allocated')).toHaveTextContent('OK');
    expect(within(ov).getByTestId('tt-acc-readonly')).toHaveTextContent('no money moves');
    fireEvent.click(within(ov).getByRole('button', { name: 'Show ticket' }));
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ search: '8c0e1d2a-0000-4000-8000-000000000001', page: 1 })));
  });
  it('live: page 1 reloads in place; on page 2 a newer tip shows "New tip activity" instead of moving the rows', async () => {
    api.transactions.mockResolvedValue(paged([row()], { total: 60, pageCount: 3 }));
    render(<POSTeamTipsScreen />);
    await screen.findAllByTestId('tt-row');
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    api.transactions.mockResolvedValue(paged([row({ ticketId: 'tNEW', ticketNumber: '1099' })], { total: 61, pageCount: 3 }));
    await act(async () => { await live.cb?.(); });
    expect(await screen.findByTestId('tt-new-activity')).toBeInTheDocument();
    expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 1 }));
    fireEvent.click(screen.getByTestId('tt-new-activity'));
    await waitFor(() => expect(api.transactions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 25 })));
  });
});
