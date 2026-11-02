// POSCustomersScreen.vi.test — English + Vietnamese POS mandate (WP-C2): the Customers screen and its profile drawer read
// in Vietnamese (no leftover English in what a cashier reads); the customer's message language is an English / Tiếng Việt
// picker that stores en / vi (WP-I follow-up), and the profile shows the language's name, never the raw code.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { POSCustomersScreen } from './POSCustomersScreen';
import { leftoverEnglish } from './viScan.testkit';
import { customerLanguageName, customerLanguageCode } from '../components/customerLanguage';

const pagination = (totalItems: number) => ({ page: 1, pageSize: 8, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / 8)) });
const row = { customerId: 'CUST-1001', displayName: 'Olivia Brown', phone: '(555) 123-4567', email: 'olivia@email.com', status: 'active', source: 'walk_in', visitCount: 24, lastVisitAt: '2026-05-05', totalSpendCents: 124800, averageSpendCents: 5203, loyaltyPoints: 2450, loyaltyTier: 'Gold', isVip: true, tags: ['VIP'], marketingOptIn: true, smsOptIn: true, emailOptIn: true, preferredLanguage: 'vi' };
const state = {
  kpisFull: { totalCustomers: 100, newCustomersToday: 4, returningCustomersToday: 12, vipCustomers: 20, birthdayThisMonth: 3, inactiveCustomers: 8, duplicateProfiles: 2, loyaltyMembers: 55, averageSpendCents: 24575 },
  analytics: { ageGroups: [{ label: '26-35', count: 2 }], lifetimeValue: { totalRevenueCents: 429600, totalCustomers: 3, repeatRatePercent: 67, avgClvCents: 143200 }, rfm: [{ segment: 'Champions', count: 2 }], retentionRatePercent: 67 },
  rows: { items: [row], pagination: pagination(1) },
  filterFacets: { segments: ['new'], statuses: ['active'], loyaltyTiers: ['Gold'], visitRanges: [], spendRanges: [], sources: ['walk_in', 'online_booking'], tags: ['VIP'] },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
// fixture data the salon typed (names, tier names, RFM segment names from the server) — not UI text
const DATA = ['Olivia Brown', 'OB', 'olivia@email.com', 'Gold', 'Champions', 'CUST'];
// the avatar's tooltip comes from the shared @aipowersalon/ui package (not a POS screen string; reported to the lead)
const SHARED_UI = ['Click to view profile picture of'];

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(async () => { await setLanguage('en'); });

describe('POSCustomersScreen in Vietnamese', () => {
  it('the list reads in Vietnamese — main labels are Vietnamese, no English left', async () => {
    await setLanguage('vi');
    globalThis.fetch = mockFetch(state) as any;
    const { container } = render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Khách hàng', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Olivia Brown').length).toBeGreaterThan(0));
    for (const en of ['Customers', 'Retention Rate', 'Loyalty Members', 'Customer Sources', 'Walk-In', 'Online Booking']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, [...DATA, ...SHARED_UI]).join(' | ')).toBe('');
  });

  it('the profile drawer reads in Vietnamese and shows the language name, not the code', async () => {
    await setLanguage('vi');
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTitle('Mở hồ sơ'))[0]);
    const dialog = await screen.findByRole('dialog');
    for (const en of ['Email', 'Marketing']) expect(within(dialog).queryByText(new RegExp(`^${en} [✓✕]$`))).toBeNull();
    expect(within(dialog).getAllByText(/Tiếp thị/).length).toBeGreaterThan(0);
    expect(leftoverEnglish(dialog, [...DATA, ...SHARED_UI]).join(' | ')).toBe('');
  });

  it('the edit form stores en / vi from an English / Tiếng Việt picker', () => {
    expect(customerLanguageName('vi')).toBe('Tiếng Việt');
    expect(customerLanguageName('en-US')).toBe('English');
    expect(customerLanguageCode('vi-VN')).toBe('vi');
    expect(customerLanguageCode('English')).toBe('en');
    expect(customerLanguageCode(null)).toBe('');
  });
});
