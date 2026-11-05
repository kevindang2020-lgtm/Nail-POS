// PeopleScreens.vi.test — English + Vietnamese POS mandate (WP-C2): the people & catalogue screens (Memberships, Services &
// Products, Technicians) render in Vietnamese with no leftover English in what staff read. Names the salon typed (plans,
// services, categories, people) are data and stay as typed (Kevin's ruling: one name per service / product).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { POSMembershipsScreen } from './POSMembershipsScreen';
import { POSServicesScreen } from './POSServicesScreen';
import { POSTechniciansScreen } from './POSTechniciansScreen';
import { leftoverEnglish } from './viScan.testkit';

const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
// the avatar tooltip comes from the shared @aipowersalon/ui package (not a POS screen string)
const SHARED_UI = ['Click to view profile picture of'];

const memberships = {
  kpis: { totalMembers: 248, newMembersThisMonth: 18, activeMembers: 186, activePctOfTotal: 75, membershipRevenueCents: 1284560, revenueDeltaPct: 22.4, expiringSoon: 24, expiringWindowDays: 7, canceledThisMonth: 7, canceledDeltaPct: -12 },
  plans: [{ planId: 'p1', name: 'VIP Nail Club', description: 'Unlimited eligible basic services plus add-ons', productType: 'recurring', billingInterval: 'month', intervalCount: 1, priceCents: 7999, isCustomPricing: false, status: 'active', isPopular: true, badge: null, memberCount: 128, revenueCents: 1023872 }],
  members: [{ membershipId: 'm1', customerId: 'c1', customerName: 'Jessica Miller', avatarUrl: null, maskedPhone: '••• 4567', planName: 'VIP Nail Club', joinDate: '2026-04-06T00:00:00Z', nextBillingAt: '2026-06-06T00:00:00Z', status: 'past_due' }],
  activity: [{ id: 'a1', activityType: 'upgraded', customerName: 'Jessica Miller', planName: 'VIP Nail Club', occurredAt: '2026-05-06T10:30:00Z', amountCents: 7999 }],
  revenueSeries: [{ label: '2026-05-01', cents: 50000 }, { label: '2026-05-06', cents: 80000 }],
  statusBreakdown: [{ status: 'active', count: 186, pct: 75 }, { status: 'grace', count: 16, pct: 6 }],
  planDistribution: [{ planName: 'VIP Nail Club', count: 128, pct: 51, revenueCents: 1023872 }],
  topServices: [{ name: 'Gel Manicure', redemptions: 142, valueCents: 639000 }],
  rangeDays: 30,
};
const services = {
  kpisFull: { totalServices: 5, activeServices: 4, inactiveServices: 1, categoriesCount: 2, addOnsCount: 3, servicesMissingDuration: 0, servicesMissingPrice: 0, servicesWithoutTechMapping: 1, topServiceRevenueCents: 9000 },
  rows: { items: [{ serviceId: 's1', categoryId: 'c1', categoryName: 'Manicures', name: 'Classic Mani', basePriceCents: 3500, durationMinutes: 30, isActive: true, isTaxable: true, bookingEnabled: true, checkoutEnabled: true, onlineBookingEnabled: false, aiBookingEnabled: false, addOnsCount: 0 }], pagination: { totalItems: 1 } },
  filterFacets: { categories: [{ categoryId: 'c1', name: 'Manicures' }], statuses: ['active', 'inactive'], taxableOptions: [], durationRanges: [], priceRanges: [], technicianSkillGroups: [] },
};
const techs = {
  kpisFull: { totalTechnicians: 3, activeTechnicians: 2, availableNow: 1, inService: 1, onBreak: 0, offToday: 1, avgRating: 4.6, todaySalesCents: 12500, todayTipsCents: 2000, estimatedCommissionCents: 5000, totalServicesCompletedToday: 18 },
  rows: { items: [{ technicianId: 't1', firstName: 'Ana', lastName: 'Lee', displayName: 'Ana Lee', status: 'suspended', workingStatus: 'available', skillGroups: ['Nails'], servicesCount: 4, todaySalesCents: 5000, todayTipsCents: 800, estimatedCommissionCents: 1500, rating: 4.8, techAppEnabled: true, canProcessPayment: true }], pagination: { totalItems: 1 } },
  filterFacets: { statuses: ['active', 'inactive'], roles: [], skillGroups: ['Nails'], serviceCategories: [], shiftStatuses: ['on_shift', 'clocked_out'], appAccessStatuses: [] },
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(async () => { await setLanguage('en'); });

describe('People & catalogue screens in Vietnamese', () => {
  it('Memberships: statuses, plan interval, activity and KPIs are Vietnamese', async () => {
    await setLanguage('vi');
    globalThis.fetch = mockFetch(memberships) as any;
    const { container } = render(<MemoryRouter><POSMembershipsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Jessica Miller').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Quá hạn thanh toán').length).toBeGreaterThan(0);     // past_due
    expect(screen.getByText(/\/ tháng/)).toBeInTheDocument();                         // "$79.99 / tháng"
    expect(screen.getAllByText(/đã nâng cấp lên/).length).toBeGreaterThan(0);         // activity "upgraded to"
    for (const en of ['Past Due', 'Grace Period', 'upgraded to']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, ['Jessica Miller', 'VIP Nail Club', 'Unlimited eligible basic services plus add-ons', 'Gel Manicure', 'JM', ...SHARED_UI]).join(' | ')).toBe('');
  });

  it('Services & Products: the dashboard reads in Vietnamese', async () => {
    await setLanguage('vi');
    globalThis.fetch = mockFetch(services) as any;
    const { container } = render(<MemoryRouter><POSServicesScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Classic Mani').length).toBeGreaterThan(0));
    expect(leftoverEnglish(container, ['Classic Mani', 'Manicures', 'Verma Nail Salon', 'Uptown Branch', 'Suburban Branch', ...SHARED_UI]).join(' | ')).toBe('');   // demo branch names are data
  });

  it('Technicians: the roster reads in Vietnamese ("Thợ"), statuses labelled', async () => {
    await setLanguage('vi');
    globalThis.fetch = mockFetch(techs) as any;
    const { container } = render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Ana Lee').length).toBeGreaterThan(0));
    expect(screen.getAllByText('bị đình chỉ').length).toBeGreaterThan(0);              // status 'suspended'
    expect(screen.queryByText('suspended')).toBeNull();
    expect(leftoverEnglish(container, ['Ana Lee', 'AL', 'Nails', ...SHARED_UI]).join(' | ')).toBe('');
  });
});
