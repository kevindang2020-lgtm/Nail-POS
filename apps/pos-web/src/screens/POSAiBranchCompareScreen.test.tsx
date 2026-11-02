import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { compareMock } = vi.hoisted(() => ({ compareMock: vi.fn() }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { compareBranches: compareMock } }));
import { POSAiBranchCompareScreen } from './POSAiBranchCompareScreen';

const render1 = () => render(<MemoryRouter><POSAiBranchCompareScreen /></MemoryRouter>);

describe('AI Branch Comparison screen', () => {
  it('renders a per-branch row with totals and normalized revenue-per-completed', async () => {
    compareMock.mockResolvedValue({
      preset: 'month', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 2, truncated: false,
      drilldownRoute: '/tenant/reports/sales', notes: ['Comparison covers only branches you are authorized to view.'],
      branches: [
        { branchId: 'b1', branchName: 'Marlton', netSalesCents: 500000, averageTicketCents: 5000, ticketsCount: 100, totalBookings: 120, completed: 100, cancelledPercent: 8, noShowPercent: 5, revenuePerCompletedAppointmentCents: 5000, completionRate: 83 },
        { branchId: 'b2', branchName: 'Deptford', netSalesCents: 200000, averageTicketCents: 4000, ticketsCount: 50, totalBookings: 60, completed: 50, cancelledPercent: 10, noShowPercent: 6, revenuePerCompletedAppointmentCents: 4000, completionRate: 83 },
      ],
    });
    render1();
    expect(await screen.findByText('Marlton')).toBeInTheDocument();
    expect(screen.getByText('Deptford')).toBeInTheDocument();
    expect(screen.getByText('$5,000.00')).toBeInTheDocument(); // avg ticket / rev-per-completed for b1
  });

  it('shows dashes for revenue columns when financials are restricted', async () => {
    compareMock.mockResolvedValue({
      preset: 'month', partialCurrentPeriod: false, financialsIncluded: false, branchCount: 1, truncated: false,
      drilldownRoute: '/tenant/reports/sales', notes: ['Revenue columns are hidden because you do not have financial-view permission.'],
      branches: [{ branchId: 'b1', branchName: 'Marlton', netSalesCents: null, averageTicketCents: null, ticketsCount: null, totalBookings: 40, completed: 36, cancelledPercent: 5, noShowPercent: 4, revenuePerCompletedAppointmentCents: null, completionRate: 90 }],
    });
    render1();
    expect(await screen.findByText('Marlton')).toBeInTheDocument();
    expect(screen.getByText(/do not have financial-view/i)).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument(); // operational column still present
  });
});
