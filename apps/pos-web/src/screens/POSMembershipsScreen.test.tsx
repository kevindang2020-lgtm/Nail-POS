// POSMembershipsScreen — Membership Overview rebuild (Oct 29 2026): the five KPIs, the three panels, the four analytics and
// the ten Quick Actions stay; the search + period strip and the six tabs are added; a phone search opens Members.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api } = vi.hoisted(() => ({ api: { overview: vi.fn(), members: vi.fn(), memberDetail: vi.fn(), activity: vi.fn(), payments: vi.fn(), redemptions: vi.fn(), planList: vi.fn(), planPerformance: vi.fn(), discounts: vi.fn(),
  exportMembers: vi.fn(), exportPayments: vi.fn(), exportRedemptions: vi.fn(), previewReminders: vi.fn(), runReminders: vi.fn() } }));
vi.mock('../api/posMembershipsApi', () => ({ posMembershipsApi: api }));
import { POSMembershipsScreen } from './POSMembershipsScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' };
const ov = {
  kpis: { totalMembers: 2, newMembersThisMonth: 2, activeMembers: 2, activePctOfTotal: 100, membershipRevenueCents: 0, membershipPaymentsThisMonth: 0, revenueDeltaPct: null, expiringSoon: 0, expiringWindowDays: 7, canceledThisMonth: 0, canceledDeltaPct: null },
  plans: [{ planId: 'p1', name: 'VIP Nail Club', description: null, billingInterval: 'month', intervalCount: 1, priceCents: 0, isCustomPricing: true, status: 'active', isPopular: false, badge: null, memberCount: 2, revenueCents: 0 }],
  revenueSeries: [], statusBreakdown: [{ status: 'active', count: 2, pct: 100 }], statusTotal: 2, planDistribution: [{ planName: 'VIP Nail Club', count: 2, pct: 100, revenueCents: 0 }], distributionTotal: 2, topServices: [], rangeDays: 30,
};
const member = (id: string, name: string) => ({ membershipId: id, customerId: 'c' + id, customerName: name, avatarUrl: null, maskedPhone: '••• 1234', planId: 'p1', planName: 'VIP Nail Club', status: 'active', memberNumber: null,
  startedAt: '2026-10-20T12:00:00Z', nextDate: '2026-11-20T12:00:00Z', nextDateKind: 'renews', canceledAt: null, autoRenew: true, redemptions: 0, lifetimePaidCents: 0, lastPaymentStatus: null });
const page = (items: unknown[], extra = {}) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, ...extra });
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.overview.mockResolvedValue(ov);
  api.members.mockResolvedValue(page([member('m1', 'Mai Le'), member('m2', 'mai le')]));
  api.activity.mockResolvedValue(page([{ id: 'a1', activityType: 'purchased', customerId: 'cm1', membershipId: 'm1', customerName: 'Mai Le', planName: 'VIP Nail Club', occurredAt: '2026-10-20T12:00:00Z', amountCents: null, status: null }], { types: [] }));
  api.planList.mockResolvedValue(page([{ planId: 'p1', name: 'VIP Nail Club', code: null, description: null, status: 'active', isPopular: false, badge: null, versionNumber: 1, billingInterval: 'month', intervalCount: 1, priceCents: 0, isCustomPricing: true, trialDays: null, activeMembers: 2, currentMembers: 2, benefits: 1, revenueThisMonthCents: 0, createdAt: '2026-10-01T12:00:00Z' }]));
});
const renderScreen = () => render(<MemoryRouter><POSMembershipsScreen /></MemoryRouter>);

describe('POSMembershipsScreen', () => {
  it('keeps the five KPIs, the three panels, the four analytics and all ten Quick Actions', async () => {
    renderScreen();
    expect((await screen.findAllByText('VIP Nail Club')).length).toBeGreaterThan(0);
    for (const t of ['Total Members', 'Expiring Soon', 'Canceled This Month', 'Membership Plans', 'Membership Activity', 'Membership Status', 'Plan Distribution', 'Top Membership Services']) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    const quick = screen.getByTestId('membership-quick');
    expect(quick.querySelectorAll('button')).toHaveLength(10);
    // two similar names stay two rows (two membership ids)
    expect(screen.getAllByTestId('member-li')).toHaveLength(2);
  });
  it('the six tabs are there; a phone search opens Members and searches the server', async () => {
    renderScreen();
    await screen.findAllByText('VIP Nail Club');
    for (const t of ['overview', 'members', 'plans', 'payments', 'benefits', 'activity']) expect(screen.getByTestId('tab-' + t)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('search'), { target: { value: '(856) 555-1234' } });
    expect(await screen.findByTestId('members-table', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(api.members).toHaveBeenCalledWith(expect.objectContaining({ q: '(856) 555-1234', filter: 'any' }));
  });
});
