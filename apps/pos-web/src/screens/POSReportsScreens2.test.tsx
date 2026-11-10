import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
describe('POSTaxReportScreen (batch 9 guide 15)', () => {
  it('taxable / exempt per category from the lines, tax once for the period, adjustments not tracked, the chosen period', async () => {
    taxMock.mockResolvedValue({ taxableSalesCents: 100000, exemptSalesCents: 5000, taxCollectedCents: 6625, taxRatePercent: 7.75, effectiveRatePercent: 6.625,
      byCategory: [{ category: 'Nails', taxCents: null, taxableCents: 95000, exemptCents: 5000 }, { category: 'Retail', taxCents: null, taxableCents: 5000, exemptCents: 0 }], adjustmentsCents: null, basis: 'lines_before_discounts' });
    render(<MemoryRouter initialEntries={['/tenant/reports/tax']}><POSTaxReportScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Tax Report' })).toBeInTheDocument();
    expect(screen.getByTestId('tax-collected')).toHaveTextContent('$66.25');
    expect(screen.getByTestId('tax-exempt')).toHaveTextContent('$50.00');
    expect(screen.getByTestId('tax-effective')).toHaveTextContent('6.63%');
    expect(screen.getByTestId('tax-adj')).toHaveTextContent('—');
    expect(screen.getByTestId('tax-cats')).toHaveTextContent('Nails');
    expect(taxMock).toHaveBeenCalledWith({ preset: 'month' });              // `preset`, not the ignored `period`
  });
});
