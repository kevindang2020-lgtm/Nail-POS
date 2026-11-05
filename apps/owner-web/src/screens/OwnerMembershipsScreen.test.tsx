// OwnerMembershipsScreen (owner rollup, read-only): membership KPIs + plan distribution + member-status breakdown,
// reusing /owner/memberships/overview. Verifies KPI/section rendering and the empty state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerMembershipsApi: { overview: vi.fn() } }));

import { ownerMembershipsApi } from '../api/ownerApi';
import { OwnerMembershipsScreen } from './OwnerMembershipsScreen';

const overview = (over: any = {}) => ({
  kpis: { totalMembers: 320, newMembersThisMonth: 24, activeMembers: 280, activePctOfTotal: 88, membershipRevenueCents: 1860000, revenueDeltaPct: 12, expiringSoon: 9, expiringWindowDays: 7, canceledThisMonth: 6, canceledDeltaPct: -3 },
  planDistribution: [{ planName: 'VIP Nail Club', count: 180, pct: 64, revenueCents: 1200000 }],
  statusBreakdown: [{ status: 'active', count: 280, pct: 88 }],
  rangeDays: 30,
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerMembershipsApi.overview as any).mockResolvedValue(overview()); });

describe('OwnerMembershipsScreen', () => {
  it('renders membership KPIs, plan distribution, and status breakdown', async () => {
    render(<OwnerMembershipsScreen />);
    await waitFor(() => expect(screen.getByText('Active Members')).toBeInTheDocument());
    expect(screen.getByText('Membership Revenue')).toBeInTheDocument();
    expect(screen.getByText('VIP Nail Club')).toBeInTheDocument();
    expect(screen.getByText('Member status')).toBeInTheDocument();
  });

  it('shows an empty state when no members are enrolled', async () => {
    (ownerMembershipsApi.overview as any).mockResolvedValue(overview({ planDistribution: [], statusBreakdown: [] }));
    render(<OwnerMembershipsScreen />);
    await waitFor(() => expect(screen.getByText('No members enrolled yet.')).toBeInTheDocument());
  });
});
