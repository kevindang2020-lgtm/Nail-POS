// POSDealsScreen.vi.test — English + Vietnamese POS mandate (WP-C4) for Marketing → Deals & Offers (Oct 30 2026 rebuild): the
// cards, the technician-deal policy strip, filters, tabs and kinds read in Vietnamese with no leftover English in what staff
// read; money and the deal records are the same numbers. Deal titles are the salon's data and stay as typed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
const { offers, deals } = vi.hoisted(() => ({
  offers: Object.fromEntries(['kpis', 'library', 'approvals', 'redemptions', 'detail', 'check', 'health', 'suggest', 'draft'].map((k) => [k, vi.fn()])) as Record<string, any>,
  deals: Object.fromEntries(['getSettings', 'pause', 'resume', 'dashboard'].map((k) => [k, vi.fn()])) as Record<string, any>,
}));
vi.mock('../api/posDealsOffersApi', () => ({ posDealsOffersApi: offers }));
vi.mock('../api/posDealsApi', () => ({ posDealsApi: deals }));
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: {} }));
vi.mock('../api/posCouponsApi', () => ({ posCouponsApi: {} }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { list: async () => [] } }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { list: async () => [] } }));
import { POSDealsScreen } from './POSDealsScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-30' };
const row = (over: any) => ({ id: 'd1', code: null, codes: 0, name: 'Spring time', description: null, discountType: 'percent', discountPercent: 5, discountCents: null, maxDiscountCents: null, sampleSavingsCents: 500, minPurchaseCents: 0,
  startsAt: null, endsAt: null, maxRedemptions: null, used: 0, remaining: null, lifecycle: 'active', dealStatus: 'active', matchedVia: null, createdAt: '2026-10-27T12:00:00Z', updatedAt: '2026-10-27T12:00:00Z',
  kind: 'deal', ownerType: 'salon', technicianId: null, technicianName: null, branchName: null, originalPriceCents: 1000, finalPriceCents: 950, ...over });
beforeEach(() => {
  [offers, deals].forEach((o) => Object.values(o).forEach((f: any) => f.mockReset()));
  offers.kpis.mockResolvedValue({ today: '2026-10-30', total: 2, activeDiscounts: 2, percentOff: 2, fixedAmount: 0, redemptions: 0, expiringSoon: 0, expiringWindowDays: 7,
    split: { scheduled: 0, paused: 0, draft: 0, expired: 0, exhausted: 0, archived: 0 }, ledger: { confirmedEvents: 0, uniqueCustomers: 0, savingsCents: 0, pendingAtCheckout: 0, grossDiscountCents: 0, reversedCents: 0 },
    pendingApproval: 0, pendingTechnician: 0, techPolicy: { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 10, maxFixedDiscountCents: null, approvalRequired: true } });
  offers.library.mockResolvedValue({ period, items: [row({}), row({ id: 'd2', name: 'vishal', discountPercent: 20, originalPriceCents: 10000, finalPriceCents: 8000 })], page: 1, pageSize: 10, totalItems: 2, totalPages: 1 });
});
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Deals & Offers in Vietnamese', () => {
  it('cards, policy strip, filters and tabs are Vietnamese; the same $10.00 → $9.50; nothing English is left', async () => {
    await setLanguage('vi');
    const { container } = render(<MemoryRouter initialEntries={['/tenant/marketing/deals']}><POSDealsScreen /></MemoryRouter>);
    expect((await screen.findAllByTestId('deal-row')).length).toBe(2);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ưu đãi & Khuyến mãi');
    expect(screen.getByTestId('tech-policy-state')).toHaveTextContent('Bật — cần quản lý duyệt');
    expect(screen.getByTestId('tech-policy-cap')).toHaveTextContent('Mức giảm tối đa của thợ: 10%');
    expect(screen.getByRole('tab', { name: 'Duyệt' })).toBeInTheDocument();
    expect(screen.getAllByTestId('price-line')[0]).toHaveTextContent('$10.00 → $9.50');
    for (const en of ['Approvals', 'Settings', 'Pending approval', 'Technician deals:']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, ['Spring time', 'vishal']).join(' | ')).toBe('');
  });
});
