import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posMultiLocationApi', () => ({ posMultiLocationApi: { state: stateMock } }));
import { POSMultiLocationScreen } from './POSMultiLocationScreen';
beforeEach(() => stateMock.mockReset());

const state = {
  period: { from: '2026-07-01', to: '2026-07-07', comparisonFrom: '2026-06-01', comparisonTo: '2026-06-07' },
  totalRevenueCents: 5000000, totalRevenueTrendPercent: 12,
  topBranch: { branchId: 'b1', branchName: 'Cherry Hill', trendPercent: 15 },
  totalBranches: 3, activeBranches: 3,
  branches: [
    { rank: 1, branchId: 'b1', branchName: 'Cherry Hill', revenueCents: 3000000, trendPercent: 15, bookingCount: 220, averageTicketCents: 6800 },
    { rank: 2, branchId: 'b2', branchName: 'Marlton', revenueCents: 2000000, trendPercent: -4, bookingCount: 150, averageTicketCents: 7200 },
  ],
  quickComparison: {
    bestGrowth: { branchId: 'b1', branchName: 'Cherry Hill', valuePercent: 15 },
    highestAverageTicket: { branchId: 'b2', branchName: 'Marlton', valueCents: 7200 },
    topBookings: { branchId: 'b1', branchName: 'Cherry Hill', value: 220 },
  },
};

describe('POSMultiLocationScreen', () => {
  it('renders cross-branch KPIs + ranked branch table', async () => {
    stateMock.mockResolvedValue(state);
    render(<POSMultiLocationScreen />);
    expect(await screen.findByRole('heading', { name: 'Multi-Location Reports' })).toBeInTheDocument();
    expect(screen.getByText('$50,000.00')).toBeInTheDocument();     // total revenue
    expect(screen.getAllByText('Cherry Hill').length).toBeGreaterThan(0);
    expect(screen.getByText('Marlton')).toBeInTheDocument();
    expect(screen.getByText('$30,000.00')).toBeInTheDocument();     // top branch revenue
  });
  it('shows empty state when no branches', async () => {
    stateMock.mockResolvedValue({ ...state, branches: [], topBranch: undefined, quickComparison: {} });
    render(<POSMultiLocationScreen />);
    expect(await screen.findByText(/No branch activity/)).toBeInTheDocument();
  });
});
