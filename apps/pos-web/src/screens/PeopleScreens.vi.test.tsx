// PeopleScreens.vi.test — English + Vietnamese POS mandate (WP-C2): the people & catalogue screens (Memberships, Services &
// Products, Technicians) render in Vietnamese with no leftover English in what staff read. Names the salon typed (plans,
// services, categories, people) are data and stay as typed (Kevin's ruling: one name per service / product).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
// Nov 4 2026: the screen reads the Overview rebuild's own endpoints (overview + paged members / activity / plans) — the old
// one-payload fixture fed every call the same object, so the plan list had no items and the screen never rendered
const { api } = vi.hoisted(() => ({ api: { overview: vi.fn(), members: vi.fn(), memberDetail: vi.fn(), activity: vi.fn(), payments: vi.fn(), redemptions: vi.fn(), planList: vi.fn(), planPerformance: vi.fn(), discounts: vi.fn(),
  exportMembers: vi.fn(), exportPayments: vi.fn(), exportRedemptions: vi.fn(), previewReminders: vi.fn(), runReminders: vi.fn() } }));
vi.mock('../api/posMembershipsApi', () => ({ posMembershipsApi: api }));
import { POSMembershipsScreen } from './POSMembershipsScreen';
import { leftoverEnglish } from './viScan.testkit';

// the avatar tooltip comes from the shared @aipowersalon/ui package (not a POS screen string)
const SHARED_UI = ['Click to view profile picture of'];

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' };
const page = (items: unknown[], extra = {}) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, ...extra });
const overview = {
  kpis: { totalMembers: 248, newMembersThisMonth: 18, activeMembers: 186, activePctOfTotal: 75, membershipRevenueCents: 1284560, membershipPaymentsThisMonth: 40, revenueDeltaPct: 22.4, expiringSoon: 24, expiringWindowDays: 7, canceledThisMonth: 7, canceledDeltaPct: -12 },
  plans: [{ planId: 'p1', name: 'VIP Nail Club', description: 'Unlimited eligible basic services plus add-ons', billingInterval: 'month', intervalCount: 1, priceCents: 7999, isCustomPricing: false, status: 'active', isPopular: true, badge: null, memberCount: 128, revenueCents: 1023872 }],
  revenueSeries: [{ label: '2026-05-01', cents: 50000 }, { label: '2026-05-06', cents: 80000 }],
  statusBreakdown: [{ status: 'active', count: 186, pct: 75 }, { status: 'grace', count: 16, pct: 6 }], statusTotal: 202,
  planDistribution: [{ planName: 'VIP Nail Club', count: 128, pct: 51, revenueCents: 1023872 }], distributionTotal: 128,
  topServices: [{ name: 'Gel Manicure', redemptions: 142, valueCents: 639000 }],
  rangeDays: 30,
};
const member = { membershipId: 'm1', customerId: 'c1', customerName: 'Jessica Miller', avatarUrl: null, maskedPhone: '••• 4567', planId: 'p1', planName: 'VIP Nail Club', status: 'past_due', memberNumber: null,
  startedAt: '2026-04-06T00:00:00Z', nextDate: '2026-06-06T00:00:00Z', nextDateKind: 'renews', canceledAt: null, autoRenew: true, redemptions: 0, lifetimePaidCents: 7999, lastPaymentStatus: null };
const activity = { id: 'a1', activityType: 'upgraded', customerId: 'c1', membershipId: 'm1', customerName: 'Jessica Miller', planName: 'VIP Nail Club', occurredAt: '2026-05-06T10:30:00Z', amountCents: 7999, status: null };
const plan = { planId: 'p1', name: 'VIP Nail Club', code: null, description: 'Unlimited eligible basic services plus add-ons', status: 'active', isPopular: true, badge: null, versionNumber: 1, billingInterval: 'month', intervalCount: 1, priceCents: 7999,
  isCustomPricing: false, trialDays: null, activeMembers: 128, currentMembers: 128, benefits: 1, revenueThisMonthCents: 1023872, createdAt: '2026-04-01T12:00:00Z' };
const _services = {
  kpisFull: { totalServices: 5, activeServices: 4, inactiveServices: 1, categoriesCount: 2, addOnsCount: 3, servicesMissingDuration: 0, servicesMissingPrice: 0, servicesWithoutTechMapping: 1, topServiceRevenueCents: 9000 },
  rows: { items: [{ serviceId: 's1', categoryId: 'c1', categoryName: 'Manicures', name: 'Classic Mani', basePriceCents: 3500, durationMinutes: 30, isActive: true, isTaxable: true, bookingEnabled: true, checkoutEnabled: true, onlineBookingEnabled: false, aiBookingEnabled: false, addOnsCount: 0 }], pagination: { totalItems: 1 } },
  filterFacets: { categories: [{ categoryId: 'c1', name: 'Manicures' }], statuses: ['active', 'inactive'], taxableOptions: [], durationRanges: [], priceRanges: [], technicianSkillGroups: [] },
};
const _techs = {
  kpisFull: { totalTechnicians: 3, activeTechnicians: 2, availableNow: 1, inService: 1, onBreak: 0, offToday: 1, avgRating: 4.6, todaySalesCents: 12500, todayTipsCents: 2000, estimatedCommissionCents: 5000, totalServicesCompletedToday: 18 },
  rows: { items: [{ technicianId: 't1', firstName: 'Ana', lastName: 'Lee', displayName: 'Ana Lee', status: 'suspended', workingStatus: 'available', skillGroups: ['Nails'], servicesCount: 4, todaySalesCents: 5000, todayTipsCents: 800, estimatedCommissionCents: 1500, rating: 4.8, techAppEnabled: true, canProcessPayment: true }], pagination: { totalItems: 1 } },
  filterFacets: { statuses: ['active', 'inactive'], roles: [], skillGroups: ['Nails'], serviceCategories: [], shiftStatuses: ['on_shift', 'clocked_out'], appAccessStatuses: [] },
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.overview.mockResolvedValue(overview);
  api.members.mockResolvedValue(page([member]));
  api.activity.mockResolvedValue(page([activity], { types: [] }));
  api.planList.mockResolvedValue(page([plan]));
});
afterEach(async () => { await setLanguage('en'); });

describe('People & catalogue screens in Vietnamese', () => {
  it('Memberships: statuses, plan interval, activity and KPIs are Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = render(<MemoryRouter><POSMembershipsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Jessica Miller').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Quá hạn thanh toán').length).toBeGreaterThan(0);     // past_due
    expect(screen.getByText(/\/ tháng/)).toBeInTheDocument();                         // "$79.99 / tháng"
    expect(screen.getAllByText(/đã nâng cấp lên/).length).toBeGreaterThan(0);         // activity "upgraded to"
    for (const en of ['Past Due', 'Grace Period', 'upgraded to']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, ['Jessica Miller', 'VIP Nail Club', 'Unlimited eligible basic services plus add-ons', 'Gel Manicure', 'JM', 'America/New_York', ...SHARED_UI]).join(' | ')).toBe('');
  });

  // Services & Products: its Vietnamese check lives with the Oct 30 2026 rebuild's own tests

  // Technicians: its Vietnamese check lives with the Oct 30 2026 rebuild's own tests
});
