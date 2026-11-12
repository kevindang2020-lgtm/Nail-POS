import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { compareMock, center } = vi.hoisted(() => ({ compareMock: vi.fn(), center: { branchScorecard: vi.fn(), branchExplain: vi.fn(), branchCheck: vi.fn() } }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { compareBranches: compareMock, center } }));
import { POSAiBranchCompareScreen } from './POSAiBranchCompareScreen';

const render1 = () => render(<MemoryRouter><POSAiBranchCompareScreen /></MemoryRouter>);

const ROW = (o: any) => ({ status: 'active', timeZone: 'UTC', averageTicketCents: 5000, totalBookings: 10, completed: 9, completionRate: 90, noShowPercent: 2, cancelledPercent: 1, customers: 10, returningCustomers: 5, rank: { perTechnicianHour: null, perOperatingHour: null, returningRate: null }, ...o });
const SC = { preset: 'month', range: null, financialsIncluded: true, notes: [], rows: [
  ROW({ branchId: 'b1', branchName: 'Marlton', netSalesCents: 500000, ticketsCount: 100, technicianHours: 100, operatingHours: 200, netPerTechnicianHourCents: 5000, netPerOperatingHourCents: 2500, returningRate: 50, rank: { perTechnicianHour: 2, perOperatingHour: 1, returningRate: 1 } }),
  ROW({ branchId: 'b2', branchName: 'Deptford', netSalesCents: 200000, ticketsCount: 50, technicianHours: 20, operatingHours: null, netPerTechnicianHourCents: 10000, netPerOperatingHourCents: null, returningRate: 30, rank: { perTechnicianHour: 1, perOperatingHour: null, returningRate: 2 } }) ],
  advice: [{ branchId: 'b2', branchName: 'Deptford', kind: 'no_opening_hours', severity: 'info', message: 'x', basis: {}, route: '/tenant/management/locations' }] };
beforeEach(() => { center.branchScorecard.mockReset().mockResolvedValue({ ...SC, rows: [], advice: [] }); center.branchExplain.mockReset(); });

describe('AI Branch Comparison screen', () => {
  it('A3: the fair scorecard ranks per technician hour; the advisor speaks the screen language; Explain renders the measured bridge', async () => {
    compareMock.mockResolvedValue({ preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 2, truncated: false, page: 1, pageSize: 25, totalItems: 2, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: 700000, ticketsCount: 150, averageTicketCents: 4667, totalBookings: 20, completed: 18, completionRate: 90, branches: 2 }, drilldownRoute: '/tenant/reports/sales', notes: [], branches: [] });
    center.branchScorecard.mockResolvedValue(SC);
    center.branchExplain.mockResolvedValue({ a: 'Marlton', b: 'Deptford', preset: 'month', range: null, lines: [], bridge: { volumeCents: 200000, priceCents: 100000, totalCents: 300000 } });
    render1();
    const rows = await screen.findAllByTestId('bcx-s-row');
    expect(rows[1]).toHaveTextContent('Deptford');
    expect(rows[1]).toHaveTextContent('$100.00 · #1');
    expect(screen.getByTestId('bcx-advice')).toHaveTextContent('Deptford has no opening hours set');
    fireEvent.click(screen.getByTestId('bcx-explain'));
    fireEvent.click(await screen.findByTestId('bcx-e-run'));
    expect(center.branchExplain).toHaveBeenCalledWith({ preset: 'month', a: 'b1', b: 'b2' });
    const lines = await screen.findByTestId('bcx-e-lines');
    expect(lines).toHaveTextContent('Marlton took $3,000.00 more than Deptford.');
    expect(lines).toHaveTextContent('$2,000.00 of that comes from 50 more paid tickets (100 vs 50)');
    expect(lines).toHaveTextContent('These are measured differences, not causes');
  });

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

  it('extras (Nov 11 2026): fewer than 5 bookings is marked a small sample; definitions are one tap away', async () => {
    compareMock.mockResolvedValue({
      preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 2, truncated: false, page: 1, pageSize: 25, totalItems: 2, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: 60000, ticketsCount: 13, averageTicketCents: 4615, totalBookings: 14, completed: 12, completionRate: 86, branches: 2 }, drilldownRoute: '/tenant/reports/sales', notes: [],
      branches: [
        { branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: 50000, averageTicketCents: 5000, ticketsCount: 10, totalBookings: 11, completed: 10, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 5000, completionRate: 91 },
        { branchId: 'b2', branchName: 'Deptford', status: 'active', netSalesCents: 10000, averageTicketCents: 3333, ticketsCount: 3, totalBookings: 3, completed: 2, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 5000, completionRate: 67 },
      ],
    });
    render1();
    await screen.findByText('Deptford');
    const small = screen.getAllByTestId('bcx-small');
    expect(small).toHaveLength(1);
    expect(small[0]).toHaveAttribute('title', expect.stringContaining('Only 3 bookings'));
    expect(screen.getByTestId('bcx-defs')).toHaveTextContent('Completion — Completed ÷ Bookings');
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
  it('AI BRANCH COMPARISON 08: the previous-period toggle asks the server, names both periods and shows the change per KPI and branch', async () => {
    const base = { preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 1, truncated: false, page: 1, pageSize: 25, totalItems: 1, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: 500000, ticketsCount: 100, averageTicketCents: 5000, totalBookings: 20, completed: 18, completionRate: 90, branches: 1 }, drilldownRoute: '/tenant/reports/sales', notes: [],
      branches: [{ branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: 500000, averageTicketCents: 5000, ticketsCount: 100, totalBookings: 20, completed: 18, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 27778, completionRate: 90 }] };
    compareMock.mockReset().mockImplementation(async (q: any) => (q.compare === 'prior' ? { ...base, comparison: { basis: 'previous_equal_period', preset: 'month', range: null, priorRange: null,
      totals: { netSalesCents: 450000, ticketsCount: 90, totalBookings: 25, completed: 20, completionRate: 80 }, byBranch: { b1: { netSalesCents: 450000, ticketsCount: 90, totalBookings: 25, completed: 20, completionRate: 80 } } } } : base));
    render1();
    await screen.findAllByTestId('bcx-row');
    expect(screen.queryByTestId('bcx-compare-basis')).toBeNull();
    expect(compareMock.mock.calls[0][0].compare).toBeUndefined();
    fireEvent.click(screen.getByTestId('bcx-compare'));
    expect(await screen.findByTestId('bcx-compare-basis')).toHaveTextContent('compared with last month, the 1st to the same day');
    expect(compareMock).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'month', compare: 'prior' }));
    expect(screen.getByTestId('bcx-k-net')).toHaveTextContent('+$500.00 vs previous');
    expect(screen.getByTestId('bcx-k-bookings')).toHaveTextContent('−5 vs previous');
    expect(screen.getByTestId('bcx-k-completion')).toHaveTextContent('+10 pts vs previous');
    expect(screen.getByTestId('bcx-d-net')).toHaveTextContent('+$500.00');
    expect(screen.getByTestId('bcx-d-bookings')).toHaveTextContent('−5');
    fireEvent.click(screen.getByTestId('bcx-compare'));
    await screen.findAllByTestId('bcx-row');
    expect(screen.queryByTestId('bcx-d-net')).toBeNull();
  });
});
