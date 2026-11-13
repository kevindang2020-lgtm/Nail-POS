// Payments & Money → Overview (Oct 29 2026 one-screen rebuild): the eight KPIs (each with its scope), the four workspaces,
// the six all-time totals and all eight Quick Actions are on ONE screen; the Transactions workspace keeps the six filters.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const mo = vi.hoisted(() => ({ overview: vi.fn(), services: vi.fn(), payouts: vi.fn(), search: vi.fn(), accuracy: vi.fn() }));
vi.mock('../api/posMoneyOverviewApi', () => ({ posMoneyOverviewApi: mo }));
const txa = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), technicians: vi.fn(), detail: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posTransactionsApi', () => ({ posTransactionsApi: txa }));
let perms: string[] = [];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u', role: 'OWNER', permissions: perms } }) }));
import { POSPaymentsOverviewScreen } from './POSPaymentsOverviewScreen';
const PERIOD = { preset: 'today', from: '2026-10-22', to: '2026-10-22', tz: 'America/New_York', today: '2026-10-22' };
const overview = {
  period: PERIOD, scope: 'location', generatedAt: '2026-10-22T20:00:00Z',
  kpis: { revenueCents: 10883, collectionsCents: 16815, giftCardCollectionsCents: 0, refundsIssuedCents: 0, pendingRefundsCents: 0, outstandingBalanceCents: 9000, totalTransactions: 3, averageTicketCents: 5442, paidTickets: 2, failedTransactions: 1, unresolvedTransactions: 1, pendingPayoutsCents: 11293, pendingPayouts: 1 },
  outstanding: { outstandingCents: 9000, ticketsDue: 1, ticketsDueCents: 3000, invoicesDue: 1, invoicesDueCents: 6000 },
  totals: { totalRevenueCents: 18383, totalCollectedCents: 23815, totalRefundsCents: 1000, outstandingBalanceCents: 9000, totalTipsCents: 760, totalPayoutsCents: 8730 },
  revenueTrend: { bucket: 'day', points: [{ start: '2026-10-22', label: 'Oct 22', revenueCents: 10883, collectionsCents: 16815 }] },
  paymentMethods: { totalCents: 16815, methods: [{ method: 'card', count: 3, amountCents: 16815, percent: 100 }] },
  topServices: { items: [{ name: 'Pedicure', revenueCents: 4967, count: 1, tickets: 1 }], total: 1, page: 1, pageSize: 5, pageCount: 1 },
  health: { status: 'attention', reasons: ['failed_payments'], successful: 3, failed: 1, unresolved: 1, chargebacks: 0, chargebackCents: 0, successRatePercent: 75, refundRatePercent: 0, collectionRatePercent: 65.1, latestPaymentAt: null, latestSettlementAt: null },
  recentTransactions: [{ id: 'p3', ticketNumber: '5003', customer: null, method: 'card', amountCents: 5172, state: 'completed', at: '2026-10-22T16:30:00Z' }],
  upcomingPayouts: { items: [{ id: 's1', reference: 'BATCH-201', netCents: 11293, expectedDate: '2026-10-24' }], total: 1, page: 1, pageSize: 4, pageCount: 1 },
  definitions: {},
};
beforeEach(() => {
  perms = ['reports.view', 'checkout.process_payment', 'checkout.manage_overrides', 'checkout.view', 'tips.adjust', 'payouts.manage', 'reconciliation.view', 'settings.view'];
  Object.values(mo).forEach((f) => f.mockReset()); Object.values(txa).forEach((f) => f.mockReset());
  mo.overview.mockResolvedValue(overview);
  txa.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10, pageCount: 1, period: PERIOD });
});
describe('POSPaymentsOverviewScreen', () => {
  it('shows the eight KPIs, the six all-time totals and the eight Quick Actions on one screen', async () => {
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    expect(await screen.findByTestId('kpi-collections')).toHaveTextContent('$168.15');
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('$108.83');
    for (const k of ['refunds', 'outstanding', 'transactions', 'average', 'failed', 'payouts']) expect(screen.getByTestId('kpi-' + k)).toBeInTheDocument();
    expect(screen.getByTestId('totals').querySelectorAll('.pm-total')).toHaveLength(6);
    expect(screen.getByTestId('quick-actions').querySelectorAll('button')).toHaveLength(8);
    expect(mo.overview).toHaveBeenCalledWith({ preset: 'today' });
  });
  it('the Transactions workspace keeps the six filters and asks the server for each', async () => {
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>); await screen.findByTestId('kpi-collections');
    fireEvent.click(screen.getByTestId('space-transactions'));
    for (const k of ['all', 'payments', 'refunds', 'voids', 'pending', 'failed']) expect(await screen.findByTestId('kind-' + k)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('kind-refunds'));
    await waitFor(() => expect(txa.list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'refunds', preset: 'today', page: 1 })));
  });
  it('PAYMENTS & MONEY 01: Check accuracy asks the server for the same period and shows each figure beside its second read; a mismatch keeps both numbers', async () => {
    const c = (key: string, group: string, unit: string, shown: number, checked: number | null, checker: string, state: string) => ({ key, group, unit, shown, checked, checker, state, difference: checked == null ? null : shown - checked });
    mo.accuracy.mockResolvedValue({ period: PERIOD, scope: 'location', checkedAt: '2026-10-22T20:05:00Z', overall: 'mismatch', counts: { match: 2, mismatch: 1, singleSource: 1 },
      checks: [c('collections', 'kpi', 'cents', 16815, 16815, 'transactions', 'match'), c('transactions', 'kpi', 'count', 3, 3, 'transactions', 'match'),
        c('totalRevenue', 'total', 'cents', 18383, 17149, 'revenue_trend', 'mismatch'), c('failed', 'kpi', 'count', 1, null, 'single_source', 'single_source')] });
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('accuracy'));
    await waitFor(() => expect(mo.accuracy).toHaveBeenCalledWith({ preset: 'today' }));
    expect(await screen.findByTestId('accuracy-overall')).toHaveTextContent('1 figure(s) do not match their second source. 2 matched; 1 have only one source.');
    const rows = screen.getAllByTestId('accuracy-row');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Collections'); expect(rows[0]).toHaveTextContent('Transactions screen'); expect(rows[0]).toHaveTextContent('Matches');
    expect(rows[2]).toHaveTextContent('$183.83'); expect(rows[2]).toHaveTextContent('$171.49'); expect(rows[2]).toHaveTextContent('$12.34'); expect(rows[2]).toHaveTextContent('Does not match');
    expect(rows[3]).toHaveTextContent('One source only'); expect(rows[3]).toHaveTextContent('—');
    expect(screen.getByTestId('accuracy-dialog').querySelectorAll('button:not([aria-label])').length).toBeLessThanOrEqual(1);   // Close only: nothing to correct here
  });
  it('a Quick Action the role cannot use is disabled, not hidden', async () => {
    perms = ['reports.view']; render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>); await screen.findByTestId('kpi-collections');
    expect(screen.getByTestId('qa-payout')).toBeDisabled(); expect(screen.getByTestId('qa-report')).not.toBeDisabled();
  });
  it('PAYMENTS 05: Revenue tab explains Revenue vs Collections step by step from the server bridge; nothing is recalculated', async () => {
    mo.overview.mockResolvedValue({ ...overview, revenueBridge: { revenueCents: 10883, taxCents: 0, tipsCents: 760, expectedCents: 11643, collectedOnPaidTicketsCents: 11643, otherDifferenceCents: 0,
      collectedOtherDaysCents: 0, collectedForOtherTicketsCents: 5172, otherTicketsCount: 1, collectionsCents: 16815, balanced: true } });
    mo.services.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5, pageCount: 1 });
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('space-revenue'));
    fireEvent.click(await screen.findByTestId('revenue-bridge-open'));
    const t = await screen.findByTestId('revenue-bridge-table');
    expect(screen.getByTestId('bridge-revenue')).toHaveTextContent('$108.83');
    expect(screen.getByTestId('bridge-tips')).toHaveTextContent('+ $7.60');
    expect(screen.getByTestId('bridge-expected')).toHaveTextContent('$116.43');
    expect(screen.getByTestId('bridge-otherTickets')).toHaveTextContent('Collected for 1 other ticket(s)');
    expect(screen.getByTestId('bridge-otherTickets')).toHaveTextContent('+ $51.72');
    expect(screen.getByTestId('bridge-collections')).toHaveTextContent('$168.15');
    expect(t.querySelectorAll('tr')).toHaveLength(8);
    expect(screen.queryByTestId('revenue-bridge-unbalanced')).toBeNull();
  });
  it('PAYMENTS 05: an unbalanced bridge says so; no bridge from the server → no button', async () => {
    mo.overview.mockResolvedValue({ ...overview, revenueBridge: { revenueCents: 100, taxCents: 0, tipsCents: 0, expectedCents: 100, collectedOnPaidTicketsCents: 100, otherDifferenceCents: 0, collectedOtherDaysCents: 0, collectedForOtherTicketsCents: 0, otherTicketsCount: 0, collectionsCents: 150, balanced: false } });
    mo.services.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5, pageCount: 1 });
    const v = render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('space-revenue'));
    fireEvent.click(await screen.findByTestId('revenue-bridge-open'));
    expect(await screen.findByTestId('revenue-bridge-unbalanced')).toBeInTheDocument();
    v.unmount();
    mo.overview.mockResolvedValue(overview);
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('space-revenue'));
    await screen.findByTestId('panel-trend-wide');
    expect(screen.queryByTestId('revenue-bridge-open')).toBeNull();
  });

  it('extras PAYMENTS 12: the payout forecast lists the server\'s pending payouts by date and processor with the date\'s source; a late one is never "arrived"', async () => {
    mo.overview.mockResolvedValue({ ...overview, payoutForecast: { today: '2026-10-26', fundingDays: 3, totalCents: 16143, items: [
      { expectedDate: '2026-10-24', processor: 'cardpointe', source: 'processor', payouts: 1, netCents: 11293, late: true },
      { expectedDate: '2026-10-27', processor: 'cardpointe', source: 'estimated', payouts: 1, netCents: 4850, late: false }] } });
    mo.payouts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5, pageCount: 1 });
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('space-payouts'));
    const rows = await screen.findAllByTestId('payout-forecast-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('2026-10-24'); expect(rows[0]).toHaveTextContent('CardPointe'); expect(rows[0]).toHaveTextContent('$112.93');
    expect(rows[0]).toHaveTextContent('Date from the processor'); expect(rows[0]).toHaveTextContent('not deposited yet');
    expect(rows[1]).toHaveTextContent('Estimated: settlement date + 3 days'); expect(rows[1].querySelector('[data-testid="payout-forecast-late"]')).toBeNull();
    expect(screen.getByTestId('payout-forecast')).toHaveTextContent('$161.43');
  });
  it('extras PAYMENTS 12: no pending payouts says so; an older server without the forecast shows nothing', async () => {
    mo.overview.mockResolvedValue({ ...overview, payoutForecast: { today: '2026-10-26', fundingDays: 3, totalCents: 0, items: [] } });
    mo.payouts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5, pageCount: 1 });
    const v = render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('space-payouts'));
    expect(await screen.findByTestId('payout-forecast-none')).toHaveTextContent('No processor payouts are waiting.');
    v.unmount();
    mo.overview.mockResolvedValue(overview);
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('space-payouts'));
    await screen.findByTestId('panel-health-wide');
    expect(screen.queryByTestId('payout-forecast')).toBeNull();
  });
});
