// BranchPerformanceScreen (owner, Module 2): Overview (3 KPIs + ranked Revenue-by-Branch) and Comparison (quick-comparison
// cards + the same ranked list), with period chips that refetch. Verifies the overview render, the period refetch, the
// comparison tab hitting the comparison endpoint + its cards, the empty state, and a friendly 403.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/ownerApi', () => ({ ownerBranchesApi: { performance: vi.fn(), comparison: vi.fn() } }));
const nav = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => nav }));
// BUILD_PLAN Phase 6: the AI queue card has its own period chips + api (tested in OwnerAiQueueCard.test.tsx) — stubbed here
vi.mock('./OwnerAiQueueCard', () => ({ OwnerAiQueueCard: () => <div data-testid="owner-ai-queue-stub" /> }));
// BUILD_PLAN Phase 7: the AI scheduling card is tested in OwnerAiSchedulingCard.test.tsx — stubbed here
vi.mock('./OwnerAiSchedulingCard', () => ({ OwnerAiSchedulingCard: () => <div data-testid="owner-ai-scheduling-stub" /> }));

import { ownerBranchesApi } from '../api/ownerApi';
import { BranchPerformanceScreen } from './BranchPerformanceScreen';

const base = (over: any = {}) => ({
  period: { from: '2026-06-01', to: '2026-06-30' },
  totalRevenueCents: 4850000, totalRevenueTrendPercent: 8.5,
  topBranch: { branchId: 'b1', branchName: 'Cherry Hill', trendPercent: 12.0 },
  totalBranches: 3, activeBranches: 3,
  branches: [
    { rank: 1, branchId: 'b1', branchName: 'Cherry Hill', revenueCents: 2200000, trendPercent: 12.0, bookingCount: 340, averageTicketCents: 6500 },
    { rank: 2, branchId: 'b2', branchName: 'Marlton', revenueCents: 1650000, trendPercent: -3.0, bookingCount: 280, averageTicketCents: 5900 },
  ],
  quickComparison: {}, ...over,
});
const comp = base({ quickComparison: {
  bestGrowth: { branchId: 'b1', branchName: 'Cherry Hill', valuePercent: 12.0 },
  highestAverageTicket: { branchId: 'b1', branchName: 'Cherry Hill', valueCents: 6500 },
  topBookings: { branchId: 'b1', branchName: 'Cherry Hill', value: 340 },
} });

beforeEach(() => {
  vi.clearAllMocks();
  (ownerBranchesApi.performance as any).mockResolvedValue(base());
  (ownerBranchesApi.comparison as any).mockResolvedValue(comp);
});
afterEach(() => { vi.clearAllTimers(); });

describe('BranchPerformanceScreen', () => {
  it('has a Back arrow to More (developer merge, Oct 6 2026)', async () => {
    render(<BranchPerformanceScreen />);
    fireEvent.click(await screen.findByLabelText('Back'));
    expect(nav.go).toHaveBeenCalledWith('more');
  });
  it('renders the overview KPIs and the ranked branch list', async () => {
    render(<BranchPerformanceScreen />);
    expect(await screen.findByText('$48,500')).toBeInTheDocument();    // total revenue
    expect(screen.getAllByText('Cherry Hill').length).toBeGreaterThan(0); // top performing + rank-1 row
    expect(screen.getByText('Marlton')).toBeInTheDocument();
    expect(screen.getByText('$22,000')).toBeInTheDocument();           // branch 1 revenue
    expect(screen.getByText('$16,500')).toBeInTheDocument();           // branch 2 revenue
    expect(screen.getByText('3')).toBeInTheDocument();                 // active branches
  });

  it('refetches when the period chip changes', async () => {
    render(<BranchPerformanceScreen />);
    await screen.findByText('$48,500');
    fireEvent.click(screen.getByText('Week'));
    await waitFor(() => expect((ownerBranchesApi.performance as any).mock.calls.some((c: any[]) => c[0] === 'week')).toBe(true));
  });

  it('loads the comparison endpoint and its cards on the Comparison tab', async () => {
    render(<BranchPerformanceScreen />);
    await screen.findByText('$48,500');
    fireEvent.click(screen.getByText('Comparison'));
    await waitFor(() => expect(ownerBranchesApi.comparison).toHaveBeenCalled());
    expect(await screen.findByText('Best Growth')).toBeInTheDocument();
    expect(screen.getByText('Highest ATV')).toBeInTheDocument();
    expect(screen.getByText('$65.00')).toBeInTheDocument();            // highest ATV value
    expect(screen.getByText('Top Bookings')).toBeInTheDocument();
  });

  it('shows the empty state when there are no branches', async () => {
    (ownerBranchesApi.performance as any).mockResolvedValue(base({ branches: [] }));
    render(<BranchPerformanceScreen />);
    expect(await screen.findByText('No active branches found')).toBeInTheDocument();
  });

  it('mounts the AI queue branch comparison (BUILD_PLAN Phase 6), even when revenue fails', async () => {
    (ownerBranchesApi.performance as any).mockRejectedValue({ status: 500, message: 'down' });
    render(<BranchPerformanceScreen />);
    expect(await screen.findByTestId('owner-ai-queue-stub')).toBeInTheDocument();
  });

  it('mounts the AI scheduling optimizer comparison (BUILD_PLAN Phase 7), even when revenue fails', async () => {
    (ownerBranchesApi.performance as any).mockRejectedValue({ status: 500, message: 'down' });
    render(<BranchPerformanceScreen />);
    expect(await screen.findByTestId('owner-ai-scheduling-stub')).toBeInTheDocument();
  });

  it('shows a friendly 403 with Retry', async () => {
    (ownerBranchesApi.performance as any).mockRejectedValue({ status: 403 });
    render(<BranchPerformanceScreen />);
    expect(await screen.findByText('You do not have access to branch reports.')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
