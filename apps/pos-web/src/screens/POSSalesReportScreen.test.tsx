import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const stateMock = vi.fn(); const exportMock = vi.fn();
vi.mock('../api/posReportsApi', () => ({
  posReportsApi: {
    state: (...a: any[]) => stateMock(...a),
    sales: vi.fn(),
    exportReport: (...a: any[]) => exportMock(...a),
  },
}));
const getMock = vi.fn();
vi.mock('../api/client', async (orig) => ({ ...(await orig() as any), api: { get: (...a: any[]) => getMock(...a) } }));

import { POSSalesReportScreen } from './POSSalesReportScreen';

const trend = { groupBy: 'day', groupByOptions: ['day', 'week'], timezone: 'America/New_York', totalRevenueCents: 120000, totalTickets: 12,
  buckets: [{ key: '2026-11-01', from: '2026-11-01', to: '2026-11-01', revenueCents: 4000, tickets: 2 }, { key: '2026-11-02', from: '2026-11-02', to: '2026-11-02', revenueCents: 116000, tickets: 10 }] };
const sample = (gross: number, over: Record<string, unknown> = {}) => ({
  dateRange: { from: '2026-11-01', to: '2026-11-02', timezone: 'America/New_York' },
  salesKpis: { grossSalesCents: gross, netSalesCents: gross - 500, serviceSalesCents: gross - 2000, productSalesCents: 2000, tipsCents: 1500, taxCollectedCents: 800, cardSurchargeCents: 0, discountsCents: 500, refundsCents: 0, ticketsCount: 12, customersCount: 9, averageTicketCents: Math.round(gross / 12) },
  payments: { cardCents: gross - 500 + 800 + 1500, cashCents: 0, giftCardCents: 0 }, trend,
  revenueByService: [{ serviceId: 'Nails', serviceName: 'Gel Manicure', revenueCents: 6500, serviceCount: 5, percentOfTop: 100 }, { serviceId: '__no_lines__', serviceName: '', revenueCents: 300, serviceCount: 0, percentOfTop: 5 }],
  ...over,
});
const tickets = { items: [{ ticketId: 't1', ticketNumber: '5001', occurredAt: '2026-11-02T15:00:00Z', customer: 'Ann N', services: ['Gel Manicure', 'Spa Pedicure'], technicians: ['Lisa T', 'Mai P'], methods: ['card'], salesCents: 9200, discountCents: 500, netCents: 8700, taxCents: 700, tipCents: 1000, surchargeCents: 155, chargedCents: 10555, refundedCents: 0, status: 'paid' }], total: 1, page: 1, pageSize: 25, q: null, from: '2026-11-01', to: '2026-11-02', timezone: 'America/New_York' };
const at = (url = '/tenant/reports/sales') => render(<MemoryRouter initialEntries={[url]}><POSSalesReportScreen /></MemoryRouter>);

beforeEach(() => { stateMock.mockReset(); exportMock.mockReset(); getMock.mockReset(); getMock.mockResolvedValue(tickets); });

describe('POSSalesReportScreen (batch 9 guide 4)', () => {
  it('keeps the nine cards, trend and top services; labels the special buckets; fetches the chosen period', async () => {
    stateMock.mockResolvedValue(sample(120000));
    at();
    expect(await screen.findByRole('heading', { name: 'Sales Report' })).toBeInTheDocument();
    expect(screen.getAllByText('$1,200.00').length).toBeGreaterThan(0);
    for (const l of ['Gross Sales', 'Net Sales', 'Tips', 'Avg Ticket', 'Tickets']) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('No service lines recorded')).toBeInTheDocument();
    expect(screen.getByTestId('rpt-trend-ok')).toBeInTheDocument();
    expect(stateMock).toHaveBeenCalledWith({ preset: 'month' });
  });
  it('a preset or the URL drives the period', async () => {
    stateMock.mockResolvedValue(sample(120000));
    at('/tenant/reports/sales?preset=custom&from=2026-10-01&to=2026-10-31');
    await waitFor(() => expect(stateMock).toHaveBeenCalledWith(expect.objectContaining({ preset: 'custom', from: '2026-10-01', to: '2026-10-31' })));
    fireEvent.click(await screen.findByTestId('preset-today'));
    await waitFor(() => expect(stateMock).toHaveBeenCalledWith({ preset: 'today' }));
  });
  it('Avg Ticket is N/A with no ticket — never $0.00', async () => {
    stateMock.mockResolvedValue(sample(0, { salesKpis: { ...sample(0).salesKpis, ticketsCount: 0, averageTicketCents: 0 } }));
    at();
    await screen.findByRole('heading', { name: 'Sales Report' });
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });
  it('Export CSV asks for the SALES report of the period, and says so when it fails', async () => {
    stateMock.mockResolvedValue(sample(120000));
    exportMock.mockRejectedValue({ status: 403 });
    at();
    fireEvent.click(await screen.findByTestId('sales-export'));
    await waitFor(() => expect(exportMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'sales', format: 'csv', preset: 'month' })));
    expect(await screen.findByRole('status')).toHaveTextContent(/permission/i);
  });
  it('the ticket explorer shows each money part and both technicians; search goes to the server', async () => {
    stateMock.mockResolvedValue(sample(120000));
    at();
    expect(await screen.findByText('Lisa T, Mai P')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ann N'));
    expect(screen.getByTestId('sales-ticket-detail')).toHaveTextContent('charged $105.55');
    fireEvent.change(screen.getByTestId('sales-search'), { target: { value: '714 555' } });
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/pos/reports/tickets/page', expect.objectContaining({ q: '714 555', page: 1 })));
  });
  it('shows a permission message on 403 and no stale figures', async () => {
    stateMock.mockRejectedValue({ status: 403 });
    at();
    expect(await screen.findByText(/do not have permission to view reports/i)).toBeInTheDocument();
    expect(screen.queryByText('Gross Sales')).toBeNull();
  });
});
