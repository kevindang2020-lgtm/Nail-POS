import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSReportsScreen } from './POSReportsScreen';

const state = {
  dateRange: { from: '2026-06-01', to: '2026-06-07', granularity: 'day', timezone: 'America/New_York' },
  kpis: { totalRevenueCents: 5284730, revenueTrendPercent: 18.6, totalBookings: 248, completedServices: 248, newCustomers: 48, averageRating: 4.8, noShowRatePercent: 3 },
  salesKpis: { grossSalesCents: 0, netSalesCents: 0, serviceSalesCents: 0, productSalesCents: 0, tipsCents: 0, taxCollectedCents: 0, cardSurchargeCents: 0, discountsCents: 0, refundsCents: 0, ticketsCount: 0, customersCount: 0, averageTicketCents: 0 },
  salesTrend: { points: [] },
  payments: { cardCents: 0, cashCents: 0, giftCardCents: 0, splitCount: 0, refundsCents: 0, cardSurchargeCents: 0, processorStatus: 'sandbox' },
  tips: { totalCents: 0, cardTipsCents: 0, cashTipsCents: 0, tipPercentAvg: 0, noTipCount: 0, managerApprovalCount: 0, byTechnician: [] },
  tax: { taxableSalesCents: 0, exemptSalesCents: 0, taxCollectedCents: 0, taxRatePercent: 0, byCategory: [], adjustmentsCents: 0 },
  discountSurcharge: { discountCents: 0, discountCount: 0, topReason: '', cardSurchargeCents: 0, surchargePercent: 0, cashDiscountCents: 0 },
  queue: { averageWaitMinutes: 0, longestWaitMinutes: 0, walkIns: 0, skipped: 0, peakWindow: '', byTechnician: [] },
  transactions: [], revenueByService: [], topTechnicians: [],
  customerInsights: { newCustomers: 0, newCustomersTrendPercent: 0, returningCustomers: 0, returningCustomersTrendPercent: 0, retentionRatePercent: 0, retentionRateTrendPercent: 0 },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSReportsScreen', () => {
  it('mounts and renders the reports board + empty trend state', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('No data for this range.')).toBeInTheDocument();
  });

  it('derives AI Insights from real report data', async () => {
    const withData = {
      ...state,
      salesKpis: { ...state.salesKpis, grossSalesCents: 5284730, refundsCents: 2500, ticketsCount: 248 },
      payments: { ...state.payments, cardCents: 3393900, cashCents: 1283400, giftCardCents: 422500 },
      revenueByService: [{ serviceId: 's1', serviceName: 'Gel Manicure', revenueCents: 984200, serviceCount: 30, percentOfTop: 100 }],
      topTechnicians: [{ technicianId: 't1', rank: 1, name: 'Samantha Green', roleLabel: 'Nail Tech', revenueCents: 1248600, completedServices: 56 }],
      customerInsights: { newCustomers: 48, newCustomersTrendPercent: 17, returningCustomers: 180, returningCustomersTrendPercent: 9, retentionRatePercent: 68, retentionRateTrendPercent: 6 },
      queue: { ...state.queue, peakWindow: '1 PM – 3 PM', averageWaitMinutes: 12 },
    };
    globalThis.fetch = mockFetch(withData) as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('AI Insights')).toBeInTheDocument();
    expect(screen.getByText(/Top service by revenue: Gel Manicure/)).toBeInTheDocument();
    expect(screen.getByText(/Most revenue collected via Card/)).toBeInTheDocument();
    expect(screen.getByText(/refunds this period/)).toBeInTheDocument();
  });
});
