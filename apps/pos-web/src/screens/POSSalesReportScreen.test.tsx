import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const stateMock = vi.fn();
vi.mock('../api/posReportsApi', () => ({
  posReportsApi: {
    state: (...a: any[]) => stateMock(...a),
    sales: vi.fn(),
    exportReport: vi.fn(async () => ({})),
  },
}));

import { POSSalesReportScreen } from './POSSalesReportScreen';

const sample = (gross: number) => ({
  dateRangeLabel: 'This Month',
  salesKpis: { grossSalesCents: gross, netSalesCents: gross - 500, serviceSalesCents: gross - 2000, productSalesCents: 2000, tipsCents: 1500, taxCollectedCents: 800, cardSurchargeCents: 0, discountsCents: 0, refundsCents: 0, ticketsCount: 12, customersCount: 9, averageTicketCents: Math.round(gross / 12) },
  salesTrend: { points: [{ label: 'Wk1', grossSalesCents: 4000, netSalesCents: 3800 }, { label: 'Wk2', grossSalesCents: gross, netSalesCents: gross - 500 }] },
  revenueByService: [{ serviceId: 's1', serviceName: 'Gel Manicure', revenueCents: 6500, serviceCount: 5, percentOfTop: 100 }],
});

beforeEach(() => { stateMock.mockReset(); });

describe('POSSalesReportScreen', () => {
  it('renders sales KPIs, revenue trend, and top services from the real reports API', async () => {
    stateMock.mockResolvedValue(sample(120000));
    render(<POSSalesReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Sales Report' })).toBeInTheDocument();
    // KPI: gross sales $1,200.00
    expect(screen.getByText('$1,200.00')).toBeInTheDocument();
    expect(screen.getByText('Gross Sales')).toBeInTheDocument();
    // top service row
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('$65.00')).toBeInTheDocument();
    // fetched with the default period
    expect(stateMock).toHaveBeenCalledWith({ preset: 'month' });   // the API reads `preset` (it dropped `period`, so the tabs did nothing — Nov 3 2026)
  });

  it('refetches when the period changes', async () => {
    stateMock.mockResolvedValue(sample(120000));
    render(<POSSalesReportScreen />);
    await screen.findByRole('heading', { name: 'Sales Report' });
    stateMock.mockResolvedValue(sample(30000));
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    await waitFor(() => expect(stateMock).toHaveBeenCalledWith({ preset: 'today' }));
  });

  it('shows a permission message on 403', async () => {
    stateMock.mockRejectedValue({ status: 403 });
    render(<POSSalesReportScreen />);
    expect(await screen.findByText(/do not have permission to view reports/i)).toBeInTheDocument();
  });
});
