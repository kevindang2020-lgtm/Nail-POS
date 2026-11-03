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
      preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 2, truncated: false, page: 1, pageSize: 25, totalItems: 2, totalPages: 1, inactiveHidden: 1,
      totals: { netSalesCents: 700000, ticketsCount: 150, averageTicketCents: 4667, totalBookings: 180, completed: 150, completionRate: 83, branches: 2 },
      drilldownRoute: '/tenant/reports/sales', notes: ['Comparison covers only branches you are authorized to view.'],
      branches: [
        { branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: 500000, averageTicketCents: 5000, ticketsCount: 100, totalBookings: 120, completed: 100, cancelledPercent: 8, noShowPercent: 5, revenuePerCompletedAppointmentCents: 5000, completionRate: 83 },
        { branchId: 'b2', branchName: 'Deptford', status: 'active', netSalesCents: 200000, averageTicketCents: 4000, ticketsCount: 50, totalBookings: 60, completed: 50, cancelledPercent: 10, noShowPercent: 6, revenuePerCompletedAppointmentCents: 4000, completionRate: 83 },
      ],
    });
    render1();
    expect(await screen.findByText('Marlton')).toBeInTheDocument();
    expect(screen.getByText('Deptford')).toBeInTheDocument();
    expect(screen.getByText('$5,000.00')).toBeInTheDocument(); // avg ticket / rev-per-completed for b1
  });

  it('shows dashes for revenue columns when financials are restricted', async () => {
    compareMock.mockResolvedValue({
      preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: false, branchCount: 1, truncated: false, page: 1, pageSize: 25, totalItems: 1, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: null, ticketsCount: null, averageTicketCents: null, totalBookings: 40, completed: 36, completionRate: 90, branches: 1 },
      drilldownRoute: '/tenant/reports/sales', notes: ['Revenue columns are hidden because you do not have financial-view permission.'],
      branches: [{ branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: null, averageTicketCents: null, ticketsCount: null, totalBookings: 40, completed: 36, cancelledPercent: 5, noShowPercent: 4, revenuePerCompletedAppointmentCents: null, completionRate: 90 }],
    });
    render1();
    expect(await screen.findByText('Marlton')).toBeInTheDocument();
    expect(screen.getByText(/do not have financial-view/i)).toBeInTheDocument();
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0); // operational column still present
  });
  it('guide: totals strip, N/A for a branch with no bookings, search / period / inactive go to the server, a row opens its figures', async () => {
    const { fireEvent } = await import('@testing-library/react');
    compareMock.mockResolvedValue({
      preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 1, truncated: false, page: 1, pageSize: 25, totalItems: 1, totalPages: 1, inactiveHidden: 2,
      totals: { netSalesCents: 0, ticketsCount: 0, averageTicketCents: null, totalBookings: 0, completed: 0, completionRate: null, branches: 1 },
      drilldownRoute: '/tenant/reports/sales', notes: [],
      branches: [{ branchId: 'b3', branchName: 'Cherry Hill', status: 'active', netSalesCents: 0, averageTicketCents: null, ticketsCount: 0, totalBookings: 0, completed: 0, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: null, completionRate: null }],
    });
    render1();
    expect(await screen.findByText('Cherry Hill')).toBeInTheDocument();
    expect(screen.getByTestId('bcx-completion')).toHaveTextContent('N/A');
    expect(screen.getByTestId('bcx-k-branches')).toHaveTextContent('2 inactive hidden');
    fireEvent.change(screen.getByTestId('bcx-search'), { target: { value: 'cherry' } });
    fireEvent.submit(screen.getByTestId('bcx-search').closest('form')!);
    fireEvent.click(screen.getByTestId('bcx-preset-quarter'));
    fireEvent.click(screen.getByTestId('bcx-inactive'));
    expect(compareMock).toHaveBeenLastCalledWith({ preset: 'quarter', q: 'cherry', includeInactive: 'true', page: 1, pageSize: 25 });
    fireEvent.click(screen.getByTestId('bcx-row'));
    expect(await screen.findByTestId('bcx-detail')).toHaveTextContent('Cherry Hill');
  });
});
