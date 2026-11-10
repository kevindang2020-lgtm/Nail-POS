import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const custMock = vi.fn(), bookMock = vi.fn(), taxMock = vi.fn();
vi.mock('../api/posReportsApi', () => ({
  posReportsApi: {
    state: vi.fn(), sales: vi.fn(), services: vi.fn(), technicians: vi.fn(), payments: vi.fn(), exportReport: vi.fn(),
    customers: (...a: any[]) => custMock(...a),
    booking: (...a: any[]) => bookMock(...a),
    tax: (...a: any[]) => taxMock(...a),
  },
}));
import { POSTaxReportScreen } from './POSTaxReportScreen';
beforeEach(() => { custMock.mockReset(); bookMock.mockReset(); taxMock.mockReset(); });

// POSCustomersReportScreen: see POSCustomersReportScreen.test.tsx (batch 9 guide 7)
// POSAppointmentsReportScreen: see POSAppointmentsReportScreen.test.tsx (batch 9 guide 5)
describe('POSTaxReportScreen', () => {
  it('renders tax KPIs + by-category', async () => {
    taxMock.mockResolvedValue({ taxableSalesCents: 100000, exemptSalesCents: 5000, taxCollectedCents: 6625, taxRatePercent: 6.625, byCategory: [{ category: 'Services', taxCents: 6625 }], adjustmentsCents: 0 });
    render(<POSTaxReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Tax Report' })).toBeInTheDocument();
    expect(screen.getAllByText('$66.25').length).toBeGreaterThan(0);
    expect(screen.getByText('Services')).toBeInTheDocument();
  });
});
