// POSDealsScreen.test.tsx — Marketing → Deals & Offers (Deals & Offers guide, Oct 30 2026; BUILD_PLAN Phase 5 underneath):
// the owner's records (Spring time 5% $10.00 → $9.50, vishal 20%) with Pause kept as the quick action, the six cards and the
// technician-deal policy strip from the server, search / filters reaching the server, the approval inbox (oldest first, a full
// overlay with Approve / Request Changes / Reject / Close, own proposals not decidable), the read-only checker, the wizard,
// the stacking settings and the dashboard.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { deals, offers, disc, cp } = vi.hoisted(() => ({
  deals: Object.fromEntries(['list', 'get', 'getSettings', 'updateSettings', 'create', 'update', 'submit', 'approve', 'reject', 'requestChanges', 'pause', 'resume', 'publish', 'cancel', 'archive',
    'dashboard', 'exportCsv', 'preview', 'coupons', 'generateCodes', 'revokeCode', 'versions', 'analytics'].map((k) => [k, vi.fn()])) as Record<string, any>,
  offers: Object.fromEntries(['kpis', 'library', 'approvals', 'redemptions', 'detail', 'check', 'health', 'suggest', 'draft', 'runHealth', 'healthRuns'].map((k) => [k, vi.fn()])) as Record<string, any>,
  disc: { kpis: vi.fn(), list: vi.fn(), redemptions: vi.fn(), performance: vi.fn(), detail: vi.fn() },
  cp: { check: vi.fn(), campaigns: vi.fn(), health: vi.fn(), suggest: vi.fn(), draft: vi.fn(), duplicate: vi.fn() },
}));
vi.mock('../api/posDealsApi', () => ({ posDealsApi: deals }));
vi.mock('../api/posDealsOffersApi', () => ({ posDealsOffersApi: offers }));
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: disc }));
vi.mock('../api/posCouponsApi', () => ({ posCouponsApi: cp }));
vi.mock('../api/authApi', () => ({ authApi: { branches: vi.fn().mockResolvedValue({ branches: [{ id: 'b1', name: 'Main', isActive: true }, { id: 'b2', name: 'Second', isActive: true }] }) } }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { list: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Polish change', priceCents: 1000 }] } }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { list: async () => ({ items: [{ id: 't1', fullName: 'Lisa Tran' }] }) } }));
import { POSDealsScreen } from './POSDealsScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-30' };
const kpis = { today: '2026-10-30', total: 3, activeDiscounts: 2, percentOff: 2, fixedAmount: 0, redemptions: 1, expiringSoon: 0, expiringWindowDays: 7,
  split: { scheduled: 0, paused: 0, draft: 0, expired: 0, exhausted: 0, archived: 0 }, ledger: { confirmedEvents: 1, uniqueCustomers: 1, savingsCents: 50, pendingAtCheckout: 0, grossDiscountCents: 50, reversedCents: 0 },
  pendingApproval: 1, pendingTechnician: 1, techPolicy: { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 10, maxFixedDiscountCents: null, approvalRequired: true } };
const row = (over: any) => ({ id: 'd1', code: null, codes: 0, name: 'Spring time', description: null, discountType: 'percent', discountPercent: 5, discountCents: null, maxDiscountCents: null, sampleSavingsCents: 500, minPurchaseCents: 0,
  startsAt: null, endsAt: null, maxRedemptions: null, used: 0, remaining: null, lifecycle: 'active', dealStatus: 'active', matchedVia: null, createdAt: '2026-10-27T12:00:00Z', updatedAt: '2026-10-27T12:00:00Z',
  kind: 'deal', ownerType: 'salon', technicianId: null, technicianName: null, branchName: null, originalPriceCents: 1000, finalPriceCents: 950, ...over });
const spring = row({}); const vishal = row({ id: 'd2', name: 'vishal', discountPercent: 20, originalPriceCents: 10000, finalPriceCents: 8000 });
const page = (items: unknown[]) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 });
const request = (over: any = {}) => ({ id: 'p1', title: 'Lisa 8% polish', kind: 'deal', ownerType: 'technician', technicianId: 't1', technicianName: 'Lisa Tran', branchName: null, salonWide: true, requestedAt: '2026-10-29T15:00:00Z',
  createdAt: '2026-10-29T15:00:00Z', createdBy: 'Lisa', services: ['Polish change'], discountType: 'percent', discountPercent: 8, discountCents: null, originalPriceCents: 1000, finalPriceCents: 920,
  startsAt: null, endsAt: null, newCustomersOnly: false, memberOnly: false, minSpendCents: null, maxRedemptions: null, maxPerCustomer: null, version: 1,
  policy: { maxDiscountPercent: 10, maxFixedDiscountCents: null, allowTechnicianDeals: 'on_with_approval', withinPolicy: true, violations: [] },
  exposure: { perUseCents: 80, maxUses: null, maxTotalCents: null, note: '' }, ownProposal: false, ...over });
const detail = { ...spring, id: 'p1', name: 'Lisa 8% polish', discountPercent: 8, dealStatus: 'pending_approval', lifecycle: 'draft', limits: { maxRedemptions: null, maxPerCustomer: null, maxDiscountCents: null, budgetCents: null, codes: 0, activeCodes: 0, walletCodes: 0 },
  overview: { terms: null, branch: null, salonWide: true, createdBy: 'Lisa', publishedAt: null, expiredAt: null, suspendedReason: null, priority: 100 },
  eligibility: { newCustomersOnly: false, memberOnly: false, daysOfWeek: null, validFromMinute: null, validToMinute: null, channels: null, stackable: false, stackGroup: null, requiresCode: false, advancedRules: 0 },
  services: [{ id: 's1', name: 'Polish change' }], usage: { confirmed: 0, pendingAtCheckout: 0, released: 0, reversed: 0, uniqueCustomers: 0, savingsCents: 0, lastRedeemedAt: null }, history: [],
  owner: { ownerType: 'technician', technicianId: 't1', technicianName: 'Lisa Tran', approvedBy: null, version: 1 }, policy: request().policy, approvals: [],
  performance: { completed: 0, grossDiscountCents: 0, reversedCents: 0, netDiscountCents: 0, linkedServiceRevenueCents: 0, note: '' } };
const settings = { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 10, stackingPolicy: 'best_single', priceFloorPercent: 0, allowStackLoyalty: true, allowStackMembership: false, editableAfterRedemption: false, dealsEnabled: true, platformMaxActiveDeals: 5 };
beforeEach(() => {
  [deals, offers, disc, cp].forEach((o) => Object.values(o).forEach((f: any) => f.mockReset()));
  offers.kpis.mockResolvedValue(kpis); offers.library.mockResolvedValue(page([spring, vishal]));
  offers.approvals.mockResolvedValue({ order: 'oldest', ...page([request()]) }); offers.detail.mockResolvedValue(detail);
  offers.redemptions.mockResolvedValue({ ...page([]), totals: { savingsCents: 0, uniqueCustomers: 0 } });
  offers.healthRuns.mockResolvedValue({ items: [], page: 1, pageSize: 5, totalItems: 0, totalPages: 1 });
  offers.health.mockResolvedValue({ overall: 'attention', checkedAt: '2026-10-30T20:00:00Z', checks: [{ key: 'tech_policy', status: 'attention', count: 1, detail: '1 technician deal(s) are outside the salon\'s current technician-deal rules.', sample: [] }] });
  deals.getSettings.mockResolvedValue(settings);
});
const renderScreen = (path = '/tenant/marketing/deals') => render(<MemoryRouter initialEntries={[path]}><POSDealsScreen /></MemoryRouter>);

describe('the owner\'s records, cards and the technician policy', () => {
  it('Spring time shows $10.00 → $9.50 and vishal 20% off; the cards and "On — manager approval required · 10%" come from the server', async () => {
    renderScreen();
    const rows = await screen.findAllByTestId('deal-row');
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveTextContent('Spring time'); expect(within(rows[0]).getByTestId('price-line')).toHaveTextContent('$10.00 → $9.50');
    expect(rows[1]).toHaveTextContent('vishal'); expect(rows[1]).toHaveTextContent('20% off');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deals & Offers');
    for (const k of ['Total', 'Active', 'Pending approval', 'Redemptions', 'Expiring Soon', 'Discount value used']) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    expect(screen.getByTestId('tech-policy-state')).toHaveTextContent('On — manager approval required');
    expect(screen.getByTestId('tech-policy-cap')).toHaveTextContent('Maximum technician discount: 10%');
  });
  it('Pause stays the quick action on an active row', async () => {
    deals.pause.mockResolvedValue({});
    renderScreen();
    const rows = await screen.findAllByTestId('deal-row');
    fireEvent.click(within(rows[0]).getByTestId('deal-pause'));
    await waitFor(() => expect(deals.pause).toHaveBeenCalledWith('d1'));
    expect(await screen.findByTestId('note')).toHaveTextContent('"Spring time" was paused');
  });
  it('search, status and owner reach the server and reset to page 1', async () => {
    renderScreen();
    await screen.findAllByTestId('deal-row');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'lisa' } });
    fireEvent.change(screen.getByTestId('status'), { target: { value: 'pending' } });
    fireEvent.change(screen.getByTestId('owner'), { target: { value: 'technician' } });
    await waitFor(() => expect(offers.library).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'lisa', status: 'pending', ownerType: 'technician', page: 1 })));
  });
});

describe('approval inbox', () => {
  it('a proposal whose start is near is flagged as needing a decision — never auto-approved', async () => {
    offers.approvals.mockResolvedValue({ order: 'oldest', ...page([request({ startsAt: new Date(Date.now() + 5 * 3600000).toISOString() })]) });
    renderScreen('/tenant/marketing/deals?tab=approvals');
    const r = await screen.findByTestId('approval-row');
    expect(within(r).getByTestId('approval-sla').textContent).toMatch(/Starts in (5|6) h — needs a decision/);
    expect(deals.approve).not.toHaveBeenCalled();
  });
  it('oldest waiting first; the review overlay compares with the cap; Approve calls the server', async () => {
    deals.approve.mockResolvedValue({});
    renderScreen('/tenant/marketing/deals?tab=approvals');
    const r = await screen.findByTestId('approval-row');
    expect(offers.approvals).toHaveBeenCalledWith(expect.objectContaining({ order: 'oldest' }));
    expect(within(r).getByTestId('approval-policy')).toHaveTextContent('Within the 10% cap');
    fireEvent.click(within(r).getByTestId('approval-open'));
    expect(await screen.findByTestId('decide-within')).toHaveTextContent('Within the 10% cap');
    fireEvent.click(screen.getByTestId('decide-approve'));
    await waitFor(() => expect(deals.approve).toHaveBeenCalledWith('p1', undefined));
  });
  it('Request Changes needs a note, then sends it; Close leaves without deciding', async () => {
    deals.requestChanges.mockResolvedValue({});
    renderScreen('/tenant/marketing/deals?tab=approvals');
    fireEvent.click(await screen.findByTestId('approval-open'));
    await screen.findByTestId('decide-overview');
    fireEvent.click(screen.getByTestId('decide-changes'));
    expect(await screen.findByTestId('decide-error')).toHaveTextContent('Say what needs to change.');
    expect(deals.requestChanges).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('decide-notes'), { target: { value: 'End it by Nov 30' } });
    fireEvent.click(screen.getByTestId('decide-changes'));
    await waitFor(() => expect(deals.requestChanges).toHaveBeenCalledWith('p1', 'End it by Nov 30'));
  });
  it('your own proposal shows why it cannot be decided and offers no decision buttons', async () => {
    offers.approvals.mockResolvedValue({ order: 'oldest', ...page([request({ ownProposal: true })]) });
    renderScreen('/tenant/marketing/deals?tab=approvals');
    fireEvent.click(await screen.findByTestId('approval-open'));
    expect(await screen.findByTestId('decide-own')).toHaveTextContent('another manager has to decide it');
    expect(screen.queryByTestId('decide-approve')).toBeNull();
    fireEvent.click(screen.getByTestId('decide-close'));
    await waitFor(() => expect(screen.queryByTestId('dlg-decide')).toBeNull());
  });
});

describe('checker, health, wizard, settings, performance', () => {
  it('Check runs the deals checker (read-only, no code box) and shows the $0.50 discount', async () => {
    offers.check.mockResolvedValue({ verdict: 'ELIGIBLE', eligible: true, action: '', reasons: [], dealId: 'd1', title: 'Spring time', status: 'active', discountPreviewCents: 50, eligibleBaseCents: 1000, context: {} });
    renderScreen();
    fireEvent.click(within((await screen.findAllByTestId('deal-row'))[0]).getByTestId('deal-check'));
    expect(screen.queryByTestId('check-code')).toBeNull();
    fireEvent.change(screen.getByTestId('check-spend'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('check-run'));
    await waitFor(() => expect(offers.check).toHaveBeenCalledWith('d1', expect.objectContaining({ spendCents: 1000, codeEntered: false })));
    expect(await screen.findByTestId('check-discount')).toHaveTextContent('$0.50');
  });
  it('Check Deal System opens the health tab with verified checks (never green by default)', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('check-system'));
    expect(await screen.findByTestId('health-overall')).toHaveTextContent('Attention');
    expect(screen.getByTestId('health-tech_policy')).toHaveTextContent('Technician deals follow today\'s rules');
  });
  it('New Deal opens the wizard in a dialog', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('new-deal'));
    expect(await screen.findByTestId('dlg-wizard')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });
  it('the stacking policy is saved from Settings; the plan\'s live-deal limit is shown', async () => {
    deals.updateSettings.mockResolvedValue({ ...settings, stackingPolicy: 'stack_all' });
    renderScreen('/tenant/marketing/deals?tab=settings');
    expect(await screen.findByText(/Your plan allows 5 live deals/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stacking policy'), { target: { value: 'stack_all' } });
    await waitFor(() => expect(deals.updateSettings).toHaveBeenCalledWith({ stackingPolicy: 'stack_all' }));
  });
  it('Performance shows the dashboard (net discounts, top deals)', async () => {
    deals.dashboard.mockResolvedValue({ days: 30, live: { active: 2, scheduled: 0, pendingApproval: 1, activeCoupons: 0 }, totals: { openApplications: 0, openDiscountCents: 0, redemptions: 1, netDiscountCents: 50, views: 0, reversals: 0 },
      daily: [], top: [{ dealId: 'd1', title: 'Spring time', kind: 'deal', status: 'active', redemptionCount: 1, maxRedemptions: null, budgetCents: null, budgetReservedCents: 0, discountedCents: 50, views: 0, redemptions: 1, conversion: null }] });
    renderScreen('/tenant/marketing/deals?tab=performance');
    const dash = await screen.findByTestId('deals-dashboard');
    await waitFor(() => expect(dash).toHaveTextContent('Spring time'));
  });
  it('a location filter reaches the library, approvals and redemptions; the redemption basis and #ticket work', async () => {
    renderScreen();
    fireEvent.change(await screen.findByTestId('branch'), { target: { value: 'b2' } });
    await waitFor(() => expect(offers.library).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'b2', page: 1 })));
    fireEvent.click(screen.getByTestId('tab-approvals'));
    await waitFor(() => expect(offers.approvals).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'b2' })));
    offers.redemptions.mockResolvedValue({ ...page([{ id: 'r1', at: '2026-10-30T12:00:00Z', customerId: null, customerName: 'Ana', code: null, dealName: 'Deal', dealId: 'd1', ticketId: 't9', ticketNumber: '2001', eligibleSubtotalCents: 1000, discountCents: 200, finalCents: 800, status: 'redeemed' }]), totals: { savingsCents: 200, uniqueCustomers: 1 } });
    fireEvent.click(screen.getByTestId('tab-redemptions'));
    await waitFor(() => expect(offers.redemptions).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'b2', dateField: 'redeemed' })));
    expect(await screen.findByTestId('red-ticket')).toHaveTextContent('#2001');
  });
  it('the approvals inbox has its own requested-date period sent to the server', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('tab-approvals'));
    const bar = await screen.findByTestId('apr-period');
    fireEvent.click(within(bar).getByTestId('preset-month'));
    await waitFor(() => expect(offers.approvals).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'month', page: 1 })));
  });
});
