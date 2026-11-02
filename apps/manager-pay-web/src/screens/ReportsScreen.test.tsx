import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReportsScreen } from './ReportsScreen';

vi.mock('../api/mobileCheckoutApi', () => ({ mobileCheckoutApi: { report: vi.fn(), salesReport: vi.fn() } }));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const sales = (over: Partial<any> = {}) => ({
  period: '7d', from: '', to: '', grossCardSalesCents: 9000, cashSalesCents: 2500, otherSalesCents: 0, refundsCents: 500,
  tipsCents: 1200, transactionCount: 4, averageTicketCents: 2875, bySurface: [{ surface: 'tap_to_pay_iphone', salesCents: 9000, count: 3 }],
  settlementKnown: false, ...over,
});

describe('ReportsScreen (§107–§110: gross ≠ payout)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mobileCheckoutApi.report as any).mockResolvedValue({ period: '7d', totalAttempts: 0, byStatus: {}, attemptedTotalCents: 0, settledTotalCents: 0, daily: [] });
  });

  it('shows gross card sales and never labels them a payout when settlement is unknown', async () => {
    (mobileCheckoutApi.salesReport as any).mockResolvedValue(sales());
    render(<ReportsScreen />);
    expect(await screen.findByText('Gross Card Sales')).toBeInTheDocument();
    expect(screen.getAllByText('$90.00').length).toBeGreaterThan(0);
    expect(screen.getByText('−$5.00')).toBeInTheDocument();
    expect(screen.getByText(/gross sales are not a payout/)).toBeInTheDocument();
    expect(screen.queryByText('Net Processor Payout')).not.toBeInTheDocument();
    expect(screen.getByText(/Tap to Pay · 3/)).toBeInTheDocument();
  });

  it('shows the processor payout ONLY from settlement data', async () => {
    (mobileCheckoutApi.salesReport as any).mockResolvedValue(sales({ settlementKnown: true, processorFeesCents: 270, netProcessorPayoutCents: 8730 }));
    render(<ReportsScreen />);
    expect(await screen.findByText('Net Processor Payout')).toBeInTheDocument();
    expect(screen.getByText('$87.30')).toBeInTheDocument();
    expect(screen.getByText('−$2.70')).toBeInTheDocument();
  });

  it('shows an honest error when the report cannot load', async () => {
    (mobileCheckoutApi.salesReport as any).mockRejectedValue(new Error('down'));
    render(<ReportsScreen />);
    await waitFor(() => expect(screen.getByText('Couldn’t load reports')).toBeInTheDocument());
  });
});
