import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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
    globalThis.fetch = mockFetch({ ...state, trend: { groupBy: 'day', groupByOptions: ['day'], timezone: 'UTC', totalRevenueCents: 0, totalTickets: 0, buckets: [{ key: '2026-06-01', from: '2026-06-01', to: '2026-06-01', revenueCents: 0, tickets: 0 }] } }) as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByText('Reports')).toBeInTheDocument();
    expect(screen.getByTestId('rpt-trend-empty')).toHaveTextContent('No sales or paid tickets in this period.');
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
    expect(screen.getByText(/Top service category by sales \(before tax and surcharge\): Gel Manicure/)).toBeInTheDocument();
    expect(screen.getByText(/Most charged by Card/)).toBeInTheDocument();
    expect(screen.getByText(/not AI-generated/)).toBeInTheDocument();
    expect(screen.getByText(/refunds this period/)).toBeInTheDocument();
  });

  const routed = (st: unknown, page: unknown) => vi.fn(async (u: any) => ({ ok: true, status: 200, json: async () => (String(u).includes('/transactions/page') ? page : st), headers: { get: () => null } } as any));
  const emptyPage = { items: [], total: 0, page: 1, pageSize: 25, q: '', from: '2026-06-01', to: '2026-06-07' };

  it('shows N/A for unknown metrics instead of an invented 0', async () => {
    const nulls = { ...state, kpis: { ...state.kpis, averageRating: null, noShowRatePercent: null }, customerInsights: { ...state.customerInsights, retentionRatePercent: null } };
    globalThis.fetch = routed(nulls, emptyPage) as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByText('Reports')).toBeInTheDocument();
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(2);
  });

  it('flags charged vs collected when they do not reconcile', async () => {
    const off = { ...state, salesKpis: { ...state.salesKpis, grossSalesCents: 10000, netSalesCents: 10000, ticketsCount: 1, taxCollectedCents: 500, tipsCents: 1000 }, payments: { ...state.payments, cardCents: 11000 } };
    globalThis.fetch = routed(off, emptyPage) as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByTestId('rpt-reconcile-diff')).toBeInTheDocument();
  });

  it('explains how each figure is calculated', async () => {
    globalThis.fetch = routed(state, emptyPage) as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('rpt-how'));
    expect(screen.getByText(/net sales \+ tax \+ tips \+ surcharge/)).toBeInTheDocument();
  });

  it('pages and searches the transactions server-side', async () => {
    const page = { ...emptyPage, total: 1, items: [{ id: 'p1', ticketId: 'T-1', customer: 'Ana Tran', service: 'Pedicure', technician: 'Lan', amountCents: 4200, method: 'card', status: 'paid', occurredAt: '2026-06-02T15:00:00Z' }] };
    const f = routed(state, page); globalThis.fetch = f as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByText('Ana Tran')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('rpt-tx-search'), { target: { value: 'ana' } });
    await waitFor(() => expect(f.mock.calls.some((c: any[]) => /transactions\/page.*q=ana/.test(String(c[0])))).toBe(true));
  });

  it('Revenue by Service: a category opens the Services Report filtered to it, keeping the period; empty says the dates', async () => {
    const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; };
    const withSvc = { ...state, revenueByService: [{ serviceId: 'Nails', serviceName: 'Nails', revenueCents: 9600, serviceCount: 2, percentOfTop: 100 }, { serviceId: '__unmapped__', serviceName: '', revenueCents: 500, serviceCount: 1, percentOfTop: 5 }] };
    globalThis.fetch = routed(withSvc, emptyPage) as any;
    render(<MemoryRouter initialEntries={['/reports']}><Routes><Route path="/reports" element={<POSReportsScreen />} /><Route path="/tenant/reports/services" element={<Where />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Unmapped / historical')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Nails: 2 services/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/tenant/reports/services?preset=week&category=Nails');
  });

  it('Revenue by Service empty state names the period', async () => {
    globalThis.fetch = routed(state, emptyPage) as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByTestId('rpt-rbs-empty')).toHaveTextContent('No service sales from 2026-06-01 to 2026-06-07.');
  });

  const trend = (over: Record<string, unknown> = {}) => ({ groupBy: 'day', groupByOptions: ['day', 'week'], timezone: 'America/New_York', totalRevenueCents: 9600, totalTickets: 2,
    buckets: [{ key: '2026-06-01', from: '2026-06-01', to: '2026-06-01', revenueCents: 0, tickets: 0 }, { key: '2026-06-02', from: '2026-06-02', to: '2026-06-02', revenueCents: 9600, tickets: 2 }], ...over });
  const withTrend = (t: unknown, kpi = 9600) => ({ ...state, trend: t, salesKpis: { ...state.salesKpis, grossSalesCents: kpi, ticketsCount: 2 } });

  it('trend (guide 3): both series, every bucket, reconciled with the cards, a bucket opens its transactions', async () => {
    const f = routed(withTrend(trend()), emptyPage); globalThis.fetch = f as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByTestId('rpt-trend-ok')).toBeInTheDocument();
    expect(screen.getByText('Appointments completed (paid tickets)')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rpt-bucket-2026-06-02'));
    expect(await screen.findByTestId('rpt-bucket-chip')).toBeInTheDocument();
    await waitFor(() => expect(f.mock.calls.some((c: any[]) => /transactions\/page.*preset=custom.*from=2026-06-02.*to=2026-06-02/.test(String(c[0])))).toBe(true));
  });

  it('trend: a mismatch with the cards is flagged, the table view lists every bucket, grouping + compare go to the server', async () => {
    const f = routed(withTrend(trend({ compare: { from: '2026-05-25', to: '2026-05-31', revenueCents: 0, tickets: 0, revenueChangePercent: null, ticketsChangePercent: null } }), 10000), emptyPage); globalThis.fetch = f as any;
    render(<MemoryRouter><POSReportsScreen /></MemoryRouter>);
    expect(await screen.findByTestId('rpt-trend-diff')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rpt-trend-table'));
    expect(screen.getByTestId('rpt-trend-tbl').querySelectorAll('tbody tr')).toHaveLength(2);
    fireEvent.change(screen.getByTestId('rpt-trend-group'), { target: { value: 'week' } });
    await waitFor(() => expect(f.mock.calls.some((c: any[]) => /reports\/state.*groupBy=week/.test(String(c[0])))).toBe(true));
    fireEvent.click(screen.getByTestId('rpt-trend-compare'));
    await waitFor(() => expect(f.mock.calls.some((c: any[]) => /reports\/state.*compare=1/.test(String(c[0])))).toBe(true));
    expect(await screen.findByTestId('rpt-trend-cmp')).toHaveTextContent('insufficient data');
  });
});
