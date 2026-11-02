import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const servicesMock = vi.fn(), techMock = vi.fn(), payMock = vi.fn();
vi.mock('../api/posReportsApi', () => ({
  posReportsApi: {
    state: vi.fn(), sales: vi.fn(), exportReport: vi.fn(),
    services: (...a: any[]) => servicesMock(...a),
    technicians: (...a: any[]) => techMock(...a),
    payments: (...a: any[]) => payMock(...a),
  },
}));

import { POSServicesReportScreen } from './POSServicesReportScreen';
import { POSTechniciansReportScreen } from './POSTechniciansReportScreen';
import { POSPaymentsReportScreen } from './POSPaymentsReportScreen';

beforeEach(() => { servicesMock.mockReset(); techMock.mockReset(); payMock.mockReset(); });

describe('POSServicesReportScreen', () => {
  it('renders service revenue rows + refetches on period change', async () => {
    servicesMock.mockResolvedValue([{ serviceId: 's1', serviceName: 'Gel Manicure', revenueCents: 6500, serviceCount: 5, percentOfTop: 100 }]);
    render(<POSServicesReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Services Report' })).toBeInTheDocument();
    expect(screen.getAllByText('Gel Manicure').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$65.00').length).toBeGreaterThan(0);
    expect(servicesMock).toHaveBeenCalledWith({ period: 'month' });
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    await waitFor(() => expect(servicesMock).toHaveBeenCalledWith({ period: 'today' }));
  });
  it('shows a permission message on 403', async () => {
    servicesMock.mockRejectedValue({ status: 403 });
    render(<POSServicesReportScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});

describe('POSTechniciansReportScreen', () => {
  it('renders the technician leaderboard', async () => {
    techMock.mockResolvedValue([{ technicianId: 't1', rank: 1, name: 'Anna Tech', roleLabel: 'Nail Tech', revenueCents: 120000, completedServices: 8 }]);
    render(<POSTechniciansReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Technicians Report' })).toBeInTheDocument();
    expect(screen.getByText('Anna Tech')).toBeInTheDocument();
    expect(screen.getAllByText('$1,200.00').length).toBeGreaterThan(0);
  });
});

describe('POSPaymentsReportScreen', () => {
  it('renders payment-method KPIs', async () => {
    payMock.mockResolvedValue({ cardCents: 90000, cashCents: 20000, giftCardCents: 5000, splitCount: 2, refundsCents: 1000, cardSurchargeCents: 300, processorStatus: 'Connected' });
    render(<POSPaymentsReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Payments Report' })).toBeInTheDocument();
    expect(screen.getAllByText('$1,150.00').length).toBeGreaterThan(0); // total collected
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });
});
