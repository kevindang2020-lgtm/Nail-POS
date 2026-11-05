// POSDealsScreen.vi.test — English + Vietnamese POS mandate (WP-C4): the deals host page (list, kinds, statuses, tabs) reads in
// Vietnamese with no leftover English in what staff read. Deal titles are the salon's data and stay as typed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

const api: Record<string, any> = {};
const fns = ['list', 'listKind', 'getSettings', 'updateSettings', 'create', 'update', 'submit', 'approve', 'reject', 'pause', 'resume', 'publish', 'cancel', 'archive', 'dashboard', 'exportCsv', 'preview', 'coupons', 'generateCodes', 'revokeCode', 'versions', 'analytics'];
for (const f of fns) api[f] = vi.fn();
vi.mock('../api/posDealsApi', () => ({ posDealsApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { list: async () => [] } }));
import { POSDealsScreen } from './POSDealsScreen';

const deal = (over: any = {}) => ({ id: 'd1', tenantId: 't', branchId: null, ownerType: 'salon', technicianId: null, title: 'Spring Gel', shortDescription: null, terms: null, imageUrl: null, discountType: 'percent', discountPercent: 20, discountCents: null,
  originalPriceCents: 5000, finalPriceCents: 4000, savingsCents: 1000, serviceIds: [], startsAt: null, endsAt: null, newCustomersOnly: false, memberOnly: false, maxRedemptions: 50, maxPerCustomer: null, stackable: false,
  allowTechSubstitution: false, status: 'draft', redemptionCount: 3, version: 2, createdAt: '2026-10-01T00:00:00Z', kind: 'deal', ...over });

beforeEach(() => {
  for (const f of fns) api[f].mockReset();
  api.list.mockResolvedValue([deal(), deal({ id: 'c1', title: 'VIP Coupon', kind: 'coupon', status: 'active' }), deal({ id: 'a1', title: 'Holiday hours', kind: 'announcement', status: 'pending_approval' })]);
  api.getSettings.mockResolvedValue({ allowTechnicianDeals: 'off', maxDiscountPercent: null, stackingPolicy: 'best_single', priceFloorPercent: 0, allowStackLoyalty: true, allowStackMembership: false, editableAfterRedemption: false, dealsEnabled: true, platformMaxActiveDeals: 5 });
});
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

// "Coupon" is the approved catalogue Vietnamese for the filter option (pos.coupons), so it is allowed
describe('Deals in Vietnamese', () => {
  it('kinds, statuses and tabs are Vietnamese; nothing English is left', async () => {
    await setLanguage('vi');
    const { container } = render(<POSDealsScreen />);
    expect((await screen.findAllByTestId('deal-row')).length).toBe(3);
    expect(screen.getAllByText('Mã giảm giá').length).toBeGreaterThan(0);          // kind coupon
    expect(screen.getByRole('tab', { name: 'Ưu đãi' })).toBeInTheDocument();       // the Deals tab
    for (const en of ['Announcement', 'Deals', 'Settings']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, ['Spring Gel', 'VIP Coupon', 'Holiday hours', 'Coupon']).join(' | ')).toBe('');
  });
});
