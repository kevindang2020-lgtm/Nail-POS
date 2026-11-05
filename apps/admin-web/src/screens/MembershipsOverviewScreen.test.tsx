import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockPlanDetail, mockMemberDetail } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockPlanDetail: vi.fn(), mockMemberDetail: vi.fn() }));
vi.mock('../api/superAdminMembershipsApi', () => ({ superAdminMembershipsApi: { overview: (q: any) => mockOverview(q), planDetail: () => mockPlanDetail(), memberDetail: () => mockMemberDetail() } }));

import { MembershipsOverviewScreen } from './MembershipsOverviewScreen';

const overview = (members: number) => ({
  ok: true,
  kpis: { totalMembers: members, activeMembers: members, activePctOfTotal: members ? 100 : 0, newMembersThisMonth: members, membershipRevenueCents: members ? 1284560 : 0, revenueDeltaPct: members ? 22.4 : null, expiringSoon: members ? 2 : 0, expiringWindowDays: 7, canceledThisMonth: 0, canceledDeltaPct: null },
  plans: members ? [{ planId: 'p1', name: 'VIP Nail Club', description: 'Unlimited basics', productType: 'recurring', status: 'active', isPopular: true, badge: null, billingInterval: 'month', intervalCount: 1, priceCents: 7999, isCustomPricing: false, memberCount: members, revenueCents: 1284560 }] : [],
  members: members ? [{ membershipId: 'm1', customerId: 'c1', customerName: 'Jordan Lee', maskedPhone: '(•••) •••-1234', avatarUrl: null, planName: 'VIP Nail Club', joinDate: '2026-06-01T00:00:00Z', nextBillingAt: '2026-07-01T00:00:00Z', status: 'active' }] : [],
  activity: [],
  revenueSeries: members ? [{ label: 'Jun 01', cents: 7999 }] : [],
  revenueRange: { range: 'this_month', label: 'This Month', totalCents: members ? 1284560 : 0, deltaPct: members ? 22.4 : null },
  statusBreakdown: members ? [{ status: 'active', count: members }] : [],
  planDistribution: members ? [{ planName: 'VIP Nail Club', count: members }] : [],
  topServices: [],
  expiring: members ? [{ membershipId: 'm2', customerName: 'Olivia Brown', avatarUrl: null, planName: 'Gel Polish Plus', expiresOn: '2026-07-03T00:00:00Z', daysLeft: 4, status: 'active' }] : [],
  recentlyCreated: members ? [{ membershipId: 'm3', customerName: 'Emma Wilson', avatarUrl: null, planName: 'Spa Pedicure Club', joinDate: '2026-06-20T00:00:00Z', amountCents: 4999, status: 'active' }] : [],
  summary: { totalMembers: members, activeMembers: members, totalRevenueCents: members ? 1284560 : 0, avgRevenuePerMemberCents: members ? 6906 : 0, renewalRatePct: members ? 82.6 : null, renewalRateDeltaPct: members ? 5.3 : null, churnRatePct: members ? 3.2 : null },
  tenantCount: members ? 3 : 0, rangeDays: 30,
});

const renderScreen = () => render(<MemoryRouter><MembershipsOverviewScreen /></MemoryRouter>);
beforeEach(() => { mockOverview.mockReset(); mockPlanDetail.mockReset(); mockMemberDetail.mockReset(); });

describe('MembershipsOverviewScreen (Super Admin)', () => {
  it('renders platform KPIs and panels from real overview data', async () => {
    mockOverview.mockResolvedValue(overview(186));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Membership Overview')).toBeInTheDocument());
    expect(screen.getAllByText('186').length).toBeGreaterThan(0);            // active members (KPI + bottom strip)
    expect(screen.getAllByText('VIP Nail Club').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$12,845.60').length).toBeGreaterThan(0);     // revenue (KPI + chart + bottom strip)
  });

  it('shows honest empty states when the platform has no members', async () => {
    mockOverview.mockResolvedValue(overview(0));
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('No plans yet.').length).toBeGreaterThan(0));
    expect(screen.getAllByText('No members yet.').length).toBeGreaterThan(0);
  });

  it('keeps tenant-scoped actions read-only with an honest notice', async () => {
    mockOverview.mockResolvedValue(overview(186));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Membership Overview')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add New Member' }));
    expect(screen.getByText(/tenant-scoped/i)).toBeInTheDocument();
  });

  it('opens a read-only plan detail drawer when a plan row is clicked', async () => {
    mockOverview.mockResolvedValue(overview(186));
    mockPlanDetail.mockResolvedValue({ ok: true, plan: {
      planId: 'p1', tenantId: 't1', tenantName: 'Glamour Nails Studio', name: 'VIP Nail Club', description: 'Unlimited basics', productType: 'recurring', status: 'active', isPopular: true, badge: null,
      branchId: null, branchName: null, memberCount: 186, revenueCents: 1284560,
      version: { versionNumber: 2, billingInterval: 'month', intervalCount: 1, priceCents: 7999, isCustomPricing: false, autoRenew: true, termType: 'ongoing', termDays: null, techSplitPct: 60, ownerSplitPct: 40, allocationTiming: 'on_redemption', cancellationPolicy: 'end_of_period', isPublished: true, benefits: [] },
    } });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Membership Overview')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('View plan detail'));
    await waitFor(() => expect(screen.getByText('Glamour Nails Studio')).toBeInTheDocument());  // owning tenant (read-only platform context)
    expect(screen.getByText('60%')).toBeInTheDocument();                                          // technician split surfaced read-only
  });

  it('re-fetches revenue when the range selector changes', async () => {
    mockOverview.mockResolvedValue(overview(186));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Membership Overview')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Revenue range'), { target: { value: 'this_year' } });
    await waitFor(() => expect(mockOverview).toHaveBeenCalledWith({ revenueRange: 'this_year' }));
  });

  it('makes active, expiring, and recently-created members all drill into a profile', async () => {
    mockOverview.mockResolvedValue(overview(186));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Membership Overview')).toBeInTheDocument());
    expect(screen.getAllByTitle('View membership profile').length).toBe(3); // active + expiring + recently-created rows
  });
});
