import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSMembershipsScreen } from './POSMembershipsScreen';

const populated = {
  kpis: { totalMembers: 248, newMembersThisMonth: 18, activeMembers: 186, activePctOfTotal: 75, membershipRevenueCents: 1284560, revenueDeltaPct: 22.4, expiringSoon: 24, expiringWindowDays: 7, canceledThisMonth: 7, canceledDeltaPct: -12 },
  plans: [{ planId: 'p1', name: 'VIP Nail Club', description: 'Unlimited eligible basic services plus add-ons', productType: 'recurring', billingInterval: 'month', intervalCount: 1, priceCents: 7999, isCustomPricing: false, status: 'active', isPopular: true, badge: 'Most Popular', memberCount: 128, revenueCents: 1023872 }],
  members: [{ membershipId: 'm1', customerId: 'c1', customerName: 'Jessica Miller', avatarUrl: null, maskedPhone: '\u2022\u2022\u2022 4567', planName: 'VIP Nail Club', joinDate: '2026-04-06T00:00:00Z', nextBillingAt: '2026-06-06T00:00:00Z', status: 'active' }],
  activity: [{ id: 'a1', activityType: 'renewed', customerName: 'Jessica Miller', planName: 'VIP Nail Club', occurredAt: '2026-05-06T10:30:00Z', amountCents: 7999 }],
  revenueSeries: [{ label: 'May 01', cents: 50000 }, { label: 'May 06', cents: 80000 }],
  statusBreakdown: [{ status: 'active', count: 186, pct: 75 }, { status: 'paused', count: 16, pct: 6 }],
  planDistribution: [{ planName: 'VIP Nail Club', count: 128, pct: 51, revenueCents: 1023872 }],
  topServices: [{ name: 'Gel Manicure', redemptions: 142, valueCents: 639000 }],
  rangeDays: 30,
};
const empty = { kpis: { totalMembers: 0, newMembersThisMonth: 0, activeMembers: 0, activePctOfTotal: 0, membershipRevenueCents: 0, revenueDeltaPct: null, expiringSoon: 0, expiringWindowDays: 7, canceledThisMonth: 0, canceledDeltaPct: null }, plans: [], members: [], activity: [], revenueSeries: [], statusBreakdown: [], planDistribution: [], topServices: [], rangeDays: 30 };

const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSMembershipsScreen', () => {
  it('renders the membership overview from the real aggregation shape', async () => {
    globalThis.fetch = mockFetch(populated) as any;
    render(<MemoryRouter><POSMembershipsScreen /></MemoryRouter>);
    expect(await screen.findByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Membership Overview')).toBeInTheDocument();
    expect(screen.getByText('Total Members')).toBeInTheDocument();
    expect(screen.getByText('248')).toBeInTheDocument();
    expect(screen.getByText('186')).toBeInTheDocument();
    expect(screen.getAllByText('Active Members').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Membership Revenue').length).toBeGreaterThan(0);
    expect(screen.getByText('Membership Plans')).toBeInTheDocument();
    expect(screen.getAllByText('VIP Nail Club').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Jessica Miller').length).toBeGreaterThan(0);
    expect(screen.getByText('Membership Activity')).toBeInTheDocument();
    expect(screen.getByText('Membership Status')).toBeInTheDocument();
    expect(screen.getByText('Plan Distribution')).toBeInTheDocument();
    expect(screen.getByText('Top Membership Services')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('+ Create Membership Plan')).toBeInTheDocument();
  });

  it('shows honest empty states with no fabricated numbers', async () => {
    globalThis.fetch = mockFetch(empty) as any;
    render(<MemoryRouter><POSMembershipsScreen /></MemoryRouter>);
    expect(await screen.findByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText(/No plans yet/)).toBeInTheDocument();
    expect(screen.getByText('No members yet.')).toBeInTheDocument();
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    expect(screen.queryByText('248')).not.toBeInTheDocument();
  });
});
