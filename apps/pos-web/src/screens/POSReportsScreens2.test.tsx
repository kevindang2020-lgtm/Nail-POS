import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const custMock = vi.fn(), bookMock = vi.fn(), taxMock = vi.fn();
vi.mock('../api/posReportsApi', () => ({
  posReportsApi: {
    state: vi.fn(), sales: vi.fn(), services: vi.fn(), technicians: vi.fn(), payments: vi.fn(), exportReport: vi.fn(),
    customers: (...a: any[]) => custMock(...a),
    booking: (...a: any[]) => bookMock(...a),
    tax: (...a: any[]) => taxMock(...a),
  },
}));
import { POSCustomersReportScreen } from './POSCustomersReportScreen';
import { POSAppointmentsReportScreen } from './POSAppointmentsReportScreen';
import { POSTaxReportScreen } from './POSTaxReportScreen';
beforeEach(() => { custMock.mockReset(); bookMock.mockReset(); taxMock.mockReset(); });

describe('POSCustomersReportScreen', () => {
  it('renders new/returning/retention + refetches', async () => {
    custMock.mockResolvedValue({ newCustomers: 12, newCustomersTrendPercent: 5, returningCustomers: 30, returningCustomersTrendPercent: 3, retentionRatePercent: 71.4, retentionRateTrendPercent: 2 });
    render(<POSCustomersReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Customers Report' })).toBeInTheDocument();
    expect(screen.getByText('71.4%')).toBeInTheDocument();
    expect(custMock).toHaveBeenCalledWith({ period: 'month' });
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    await waitFor(() => expect(custMock).toHaveBeenCalledWith({ period: 'today' }));
  });
  it('shows 403 message', async () => { custMock.mockRejectedValue({ status: 403 }); render(<POSCustomersReportScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
describe('POSAppointmentsReportScreen', () => {
  it('renders booking outcomes', async () => {
    bookMock.mockResolvedValue({ totalBookings: 40, completed: 30, completedPercent: 75, cancelled: 6, cancelledPercent: 15, noShow: 4, noShowPercent: 10 });
    render(<POSAppointmentsReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Appointments Report' })).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getAllByText('75.0%').length).toBeGreaterThan(0);
  });
});
describe('POSTaxReportScreen', () => {
  it('renders tax KPIs + by-category', async () => {
    taxMock.mockResolvedValue({ taxableSalesCents: 100000, exemptSalesCents: 5000, taxCollectedCents: 6625, taxRatePercent: 6.625, byCategory: [{ category: 'Services', taxCents: 6625 }], adjustmentsCents: 0 });
    render(<POSTaxReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Tax Report' })).toBeInTheDocument();
    expect(screen.getAllByText('$66.25').length).toBeGreaterThan(0);
    expect(screen.getByText('Services')).toBeInTheDocument();
  });
});
