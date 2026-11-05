import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSPaymentsOverviewScreen } from './POSPaymentsOverviewScreen';

const overview = {
  kpis: { todayRevenueCents: 528730, todayCollectionsCents: 489260, refundsIssuedCents: 18540, outstandingBalanceCents: 214575, totalTransactions: 8, averageTicketCents: 8261, failedTransactions: 1, pendingPayoutsCents: 371220 },
  totals: { totalRevenueCents: 3489260, totalCollectedCents: 3214520, totalRefundsCents: 124875, outstandingBalanceCents: 214575, totalTipsCents: 324550, totalPayoutsCents: 2843210 },
  revenueTrend: [{ day: '2026-06-15', revenueCents: 100000 }, { day: '2026-06-16', revenueCents: 120000 }],
  paymentMethods: [{ method: 'card', count: 6, amountCents: 2523250 }, { method: 'cash', count: 2, amountCents: 701025 }],
  topServices: [{ name: 'Acrylic Full Set', revenueCents: 845200 }, { name: 'Gel Manicure', revenueCents: 612550 }],
  health: { successful: 153, failed: 3, chargebacks: 0, refundRatePercent: 1.3, collectionRatePercent: 96.8, healthScorePercent: 98 },
  transactions: [{ paymentId: 'p1', ticketNumber: 'T-100', customerName: 'Olivia Brown', serviceName: 'Acrylic Full Set', method: 'card', amountCents: 9500, status: 'approved', type: 'Payment', createdAt: '2026-06-16T14:33:00Z' }],
  upcomingPayouts: [{ label: 'Settlement', amountCents: 214575, scheduledFor: '2026-06-17T00:00:00Z' }],
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSPaymentsOverviewScreen', () => {
  it('renders the payments overview from the real aggregation shape', async () => {
    globalThis.fetch = mockFetch(overview) as any;
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText('Payments & Money')).toBeInTheDocument();
    expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
    expect(screen.getByText(/Revenue Overview/)).toBeInTheDocument();
    expect(screen.getByText('Payment Methods Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Top Services by Revenue')).toBeInTheDocument();
    expect(screen.getByText('Payment Health')).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Payouts')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    // a real figure flows through (avg ticket $82.61)
    expect(screen.getByText('$82.61')).toBeInTheDocument();
  });

  it('renders an honest empty state with zero data', async () => {
    const empty = { kpis: { todayRevenueCents: 0, todayCollectionsCents: 0, refundsIssuedCents: 0, outstandingBalanceCents: 0, totalTransactions: 0, averageTicketCents: 0, failedTransactions: 0, pendingPayoutsCents: 0 }, totals: { totalRevenueCents: 0, totalCollectedCents: 0, totalRefundsCents: 0, outstandingBalanceCents: 0, totalTipsCents: 0, totalPayoutsCents: 0 }, revenueTrend: [], paymentMethods: [], topServices: [], health: { successful: 0, failed: 0, chargebacks: 0, refundRatePercent: 0, collectionRatePercent: 0, healthScorePercent: 0 }, transactions: [], upcomingPayouts: [] };
    globalThis.fetch = mockFetch(empty) as any;
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText('Payments & Money')).toBeInTheDocument();
    expect(screen.getByText('No pending payouts.')).toBeInTheDocument();
  });

  it('the transaction tabs filter by backend transaction type (guards the type-string contract)', async () => {
    const twoTypes = {
      ...overview,
      transactions: [
        { paymentId: 'p1', customerName: 'Olivia Brown', serviceName: 'Acrylic Full Set', method: 'card', amountCents: 9500, status: 'approved', type: 'Payment', createdAt: '2026-06-16T14:33:00Z' },
        { paymentId: 'p2', customerName: 'Refunded Ray', serviceName: 'Gel Manicure', method: 'card', amountCents: 4200, status: 'refunded', type: 'Refund', createdAt: '2026-06-16T15:10:00Z' },
      ],
    };
    globalThis.fetch = mockFetch(twoTypes) as any;
    render(<MemoryRouter><POSPaymentsOverviewScreen /></MemoryRouter>);
    await screen.findByText('Payments & Money');
    // Under "All Transactions" both names appear in the tabbed list (also mirrored in the recent-activity list).
    expect(screen.getAllByText('Olivia Brown').length).toBeGreaterThanOrEqual(1);
    const refundBefore = screen.getAllByText('Refunded Ray').length;
    expect(refundBefore).toBeGreaterThanOrEqual(1);
    // Switch to Refunds → the tabbed list drops the payment row; Olivia now appears only in the recent-activity list
    // (count drops from 2 to 1), proving t.type === 'Refund' matches the backend string exactly.
    fireEvent.click(screen.getByRole('button', { name: 'Refunds' }));
    expect(screen.getAllByText('Olivia Brown').length).toBe(1); // only the unfiltered recent list retains it
    expect(screen.getAllByText('Refunded Ray').length).toBe(refundBefore); // refund stays in both lists
  });
});
