// Payments & Money → Overview (Oct 29 2026 one-screen rebuild): the eight KPIs (each with its scope), the four workspaces,
// the six all-time totals and all eight Quick Actions are on ONE screen; the Transactions workspace keeps the six filters.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const mo = vi.hoisted(() => ({ overview: vi.fn(), services: vi.fn(), payouts: vi.fn(), search: vi.fn() }));
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
  it('a Quick Action the role cannot use is disabled, not hidden', async () => {
    perms = ['reports.view']; render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>); await screen.findByTestId('kpi-collections');
    expect(screen.getByTestId('qa-payout')).toBeDisabled(); expect(screen.getByTestId('qa-report')).not.toBeDisabled();
  });
});
