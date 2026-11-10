import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSManagementScreen } from './POSManagementScreen';

vi.mock('../api/posLocationsApi', () => ({
  posLocationsApi: {
    list: vi.fn().mockResolvedValue({
      locations: [
        { id: 'b1', name: 'Downtown Branch', public_display_name: 'Downtown Branch', city: 'Cherry Hill', state: 'NJ', status: 'active' },
        { id: 'b2', name: 'Uptown Branch', public_display_name: 'Uptown Branch', city: 'Camden', state: 'NJ', status: 'active' },
      ],
      summary: { total: 2, active: 2, published: 2, unverified: 0, missingPins: 0, acceptingBookings: 2 },
    }),
  },
}));

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn((path: string) => {
      if (path.includes('technicians')) return Promise.resolve({
        kpisFull: { totalTechnicians: 4, activeTechnicians: 4, availableNow: 2, onBreak: 1, offToday: 1, estimatedCommissionCents: 0, todayTipsCents: 0, todaySalesCents: 0 },
        rows: { items: [
          { technicianId: 't1', displayName: 'Samantha Green', role: 'Manager', workingStatus: 'available', shiftStatus: 'on_shift', rating: 4.9, todaySalesCents: 0, estimatedCommissionCents: 0 },
          { technicianId: 't2', displayName: 'Charlotte Taylor', role: 'Senior Tech', workingStatus: 'in_service', shiftStatus: 'on_shift', rating: 4.8, todaySalesCents: 0, estimatedCommissionCents: 0 },
        ] },
      });
      if (path.includes('payroll')) return Promise.resolve({
        kpis: { totalPeriods: 2, openPeriods: 1, unpaidPayableCents: 1874200, lifetimePayableCents: 3000000, lifetimeCommissionCents: 1800000, lifetimeTipsCents: 600000 },
        periods: [],
      });
      if (path.includes('/pos/approvals')) return Promise.resolve({ items: [], page: 1, pageSize: 1, total: 3, hasMore: true });
      if (path.includes('branches/comparison')) return Promise.resolve({ branches: [
        { branchId: 'b1', revenueCents: 120000, trendPercent: 12.5, bookingCount: 30, averageTicketCents: 4000 },
        { branchId: 'b2', revenueCents: 40000, trendPercent: null, bookingCount: 8, averageTicketCents: 5000 } ] });
      return Promise.resolve({});
    }),
  },
}));

describe('POSManagementScreen', () => {
  it('aggregates branches + team + payroll into a real management dashboard', async () => {
    render(<MemoryRouter><POSManagementScreen /></MemoryRouter>);
    expect(await screen.findByText('Management')).toBeInTheDocument();
    // KPIs
    expect(screen.getByText('Active Staff')).toBeInTheDocument();
    expect(screen.getByText('Branches Active')).toBeInTheDocument();
    // real branch + team data
    expect(screen.getByText('Branch Performance Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
    expect(screen.getByText('Team & Role Management')).toBeInTheDocument();
    expect(screen.getByText('Samantha Green')).toBeInTheDocument();
    expect(screen.getByText('Payroll Allocation')).toBeInTheDocument();
    // honest pending modules
    expect(screen.getAllByText(/Not connected yet/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });
});

describe('POSManagementScreen — batch 9 guides 17–18 (Nov 10 2026)', () => {
  it('Pending Approvals is the Approvals count; the snapshot shows each branch\'s figures and N/A with no prior base', async () => {
    render(<MemoryRouter><POSManagementScreen /></MemoryRouter>);
    expect(await screen.findByTestId('mgmt-approvals-open')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(await screen.findByTestId('mgmt-trend-b1')).toHaveTextContent('+12.5%');
    expect(screen.getByTestId('mgmt-trend-b2')).toHaveTextContent('N/A');
  });
});

