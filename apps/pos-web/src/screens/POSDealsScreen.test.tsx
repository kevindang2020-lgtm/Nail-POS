// POSDealsScreen.test.tsx — BUILD_PLAN Phase 5: the deals management surface — the list with its lifecycle, the wizard
// (catalog services, rules, simulator), coupon codes shown once, the dashboard and the stacking settings.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api: Record<string, any> = {};
const fns = ['list', 'listKind', 'getSettings', 'updateSettings', 'create', 'update', 'submit', 'approve', 'reject', 'pause', 'resume', 'publish', 'cancel', 'archive', 'dashboard', 'exportCsv', 'preview', 'coupons', 'generateCodes', 'revokeCode', 'versions', 'analytics'];
for (const f of fns) api[f] = vi.fn();
vi.mock('../api/posDealsApi', () => ({ posDealsApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { list: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Gel', priceCents: 5000 }, { id: '22222222-2222-4222-8222-222222222222', name: 'Pedi', priceCents: 3000 }] } }));
import { POSDealsScreen } from './POSDealsScreen';

const deal = (over: any = {}) => ({ id: 'd1', tenantId: 't', branchId: null, ownerType: 'salon', technicianId: null, title: 'Spring Gel', shortDescription: null, terms: null, imageUrl: null, discountType: 'percent', discountPercent: 20, discountCents: null,
  originalPriceCents: 5000, finalPriceCents: 4000, savingsCents: 1000, serviceIds: [], startsAt: null, endsAt: null, newCustomersOnly: false, memberOnly: false, maxRedemptions: 50, maxPerCustomer: null, stackable: false,
  allowTechSubstitution: false, status: 'draft', redemptionCount: 3, version: 2, createdAt: '2026-10-01T00:00:00Z', kind: 'deal', ...over });
const settings = { allowTechnicianDeals: 'off', maxDiscountPercent: null, stackingPolicy: 'best_single', priceFloorPercent: 0, allowStackLoyalty: true, allowStackMembership: false, editableAfterRedemption: false, dealsEnabled: true, platformMaxActiveDeals: 5 };
beforeEach(() => {
  for (const f of fns) api[f].mockReset();
  api.list.mockResolvedValue([deal(), deal({ id: 'c1', title: 'VIP Coupon', kind: 'coupon', status: 'active' }), deal({ id: 'p1', title: 'Tech deal', ownerType: 'technician', status: 'pending_approval' })]);
  api.listKind.mockResolvedValue([deal({ id: 'c1', title: 'VIP Coupon', kind: 'coupon', status: 'active' })]);
  api.getSettings.mockResolvedValue(settings);
});

describe('deals list and lifecycle', () => {
  it('shows every kind with status, cap, version — and the approval queue', async () => {
    render(<POSDealsScreen />);
    expect((await screen.findAllByTestId('deal-row')).length).toBe(3);
    expect(screen.getByText('Approval queue (1)')).toBeInTheDocument();
    expect(screen.getAllByTestId('deal-row')[0]).toHaveTextContent('3 / 50 redeemed');
    expect(screen.getAllByTestId('deal-row')[0]).toHaveTextContent('v2');
  });
  it('publishing a deal with a future start says it is scheduled', async () => {
    api.list.mockResolvedValue([deal({ status: 'approved' })]);
    api.publish.mockResolvedValue({ ...deal(), status: 'scheduled', startsAt: '2026-11-01T14:00:00Z' });
    render(<POSDealsScreen />);
    fireEvent.click(await screen.findByText('Publish'));
    expect(await screen.findByRole('status')).toHaveTextContent('is scheduled');
  });
  it('filters by kind', async () => {
    render(<POSDealsScreen />);
    await screen.findAllByTestId('deal-row');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'coupon' } });
    await waitFor(() => expect(api.listKind).toHaveBeenCalledWith('coupon'));
  });
});

describe('version history', () => {
  it('a changed deal shows the terms each version carried', async () => {
    api.versions.mockResolvedValue([{ version: 2, terms: { title: 'Spring Gel', discountType: 'percent', discountPercent: 20 }, createdAt: null }, { version: 1, terms: { title: 'Spring Gel', discountType: 'percent', discountPercent: 15 }, createdAt: null }]);
    render(<POSDealsScreen />);
    const row = (await screen.findAllByTestId('deal-row'))[0];
    fireEvent.click(within(row).getByText('History'));
    const h = await screen.findByTestId('deal-history');
    expect(api.versions).toHaveBeenCalledWith('d1');
    expect(h).toHaveTextContent('v2');
    expect(h).toHaveTextContent('15% off');
  });
});

describe('the wizard', () => {
  it('builds the deal from catalog services, rules and limits; the simulator asks the server', async () => {
    api.preview.mockResolvedValue({ problems: [], eligibility: { eligible: true, reasons: [] }, pricing: { subtotalCents: 5000, totalDiscountCents: 1000, lines: [], rejected: [] }, originalPriceCents: 5000, finalPriceCents: 4000 });
    api.create.mockResolvedValue(deal({ title: 'Weekday Gel' }));
    render(<POSDealsScreen />);
    fireEvent.click(await screen.findByText('+ New deal'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weekday Gel' } });
    fireEvent.click(screen.getByText('Next'));
    fireEvent.change(screen.getByLabelText('Discount value'), { target: { value: '20' } });
    fireEvent.click(await screen.findByLabelText('Gel'));
    expect(screen.getByText(/Catalog price \$50\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByLabelText('Mon')); fireEvent.click(screen.getByLabelText('Tue'));
    fireEvent.change(screen.getByLabelText('Per customer'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('+ Add rule'));
    fireEvent.change(screen.getByLabelText('Rule 1 value'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Run simulator'));
    expect(await screen.findByTestId('simulator-result')).toHaveTextContent('Eligible — takes $10.00 off $50.00');
    fireEvent.click(screen.getByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    const body = api.create.mock.calls[0][0];
    expect(body).toMatchObject({ kind: 'deal', title: 'Weekday Gel', discountType: 'percent', discountPercent: 20, serviceIds: ['11111111-1111-4111-8111-111111111111'], daysOfWeek: [1, 2], maxPerCustomer: 1, rules: { all: [{ type: 'min_visits', count: 3 }] } });
    expect(body).not.toHaveProperty('originalPriceCents');   // the server takes the catalog price (bug 8)
  });
  it('a server refusal (e.g. 12.5%) is shown, nothing saved', async () => {
    api.create.mockRejectedValue(new Error('A percentage discount is a whole number from 1 to 100.'));
    render(<POSDealsScreen />);
    fireEvent.click(await screen.findByText('+ New deal'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Odd' } });
    fireEvent.click(screen.getByText('Next'));
    fireEvent.change(screen.getByLabelText('Discount value'), { target: { value: '12.5' } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Create draft'));
    expect(await screen.findByRole('alert')).toHaveTextContent('whole number from 1 to 100');
  });
});

describe('coupon codes', () => {
  it('generated codes are shown once with a download; the list shows only the last four characters', async () => {
    api.coupons.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'k1', hint: 'AB12', status: 'active', singleUse: true, maxUses: null, useCount: 0, customerName: null, expiresAt: null }]);
    api.generateCodes.mockResolvedValue({ batchId: 'b', quantity: 1, codes: ['VIP-XXXX-AB12'], hints: ['AB12'] });
    render(<POSDealsScreen />);
    const row = (await screen.findAllByTestId('deal-row')).find((r) => r.textContent?.includes('VIP Coupon'))!;
    fireEvent.click(within(row).getByText('Codes'));
    fireEvent.change(await screen.findByLabelText('How many codes'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Generate codes'));
    expect(await screen.findByTestId('fresh-codes')).toHaveTextContent('VIP-XXXX-AB12');
    expect(screen.getByTestId('fresh-codes')).toHaveTextContent('they will not be shown again');
    expect(await screen.findByText('••••AB12')).toBeInTheDocument();
  });
});

describe('settings and dashboard', () => {
  it('the stacking policy is saved; the plan’s live-deal limit is shown', async () => {
    api.updateSettings.mockResolvedValue({ ...settings, stackingPolicy: 'stack_all' });
    render(<POSDealsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    expect(screen.getByText(/Your plan allows 5 live deals/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stacking policy'), { target: { value: 'stack_all' } });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ stackingPolicy: 'stack_all' }));
  });
  it('the dashboard shows net discounts, redemptions and the top deals', async () => {
    api.dashboard.mockResolvedValue({ days: 30, live: { active: 2, scheduled: 1, pendingApproval: 0, activeCoupons: 1 }, totals: { openApplications: 1, openDiscountCents: 500, redemptions: 7, netDiscountCents: 7000, views: 40, reversals: 1 },
      daily: [{ day: '2026-10-06', views: 10, bookings: 2, applications: 3, redemptions: 3, reversals: 0, discountedCents: 3000, reversedCents: 0 }],
      top: [{ dealId: 'd1', title: 'Spring Gel', kind: 'deal', status: 'active', redemptionCount: 7, maxRedemptions: 50, budgetCents: null, budgetReservedCents: 0, discountedCents: 7000, views: 40, redemptions: 7, conversion: 17.5 }] });
    render(<POSDealsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Dashboard' }));
    const dash = await screen.findByTestId('deals-dashboard');
    await waitFor(() => expect(dash).toHaveTextContent('$70.00'));
    expect(dash).toHaveTextContent('17.5%');
  });
  it('the dashboard exports the uses as CSV for the selected period', async () => {
    api.dashboard.mockResolvedValue({ days: 30, live: { active: 0, scheduled: 0, pendingApproval: 0, activeCoupons: 0 }, totals: { openApplications: 0, openDiscountCents: 0, redemptions: 0, netDiscountCents: 0, views: 0, reversals: 0 }, daily: [], top: [] });
    api.exportCsv.mockResolvedValue({ format: 'csv', filename: 'deal-redemptions.csv', csv: 'applied_at\n' });
    const created = vi.fn(() => 'blob:x'); (URL as any).createObjectURL = created; (URL as any).revokeObjectURL = vi.fn();
    render(<POSDealsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Dashboard' }));
    fireEvent.change(await screen.findByLabelText('Dashboard period'), { target: { value: '90' } });
    fireEvent.click(screen.getByText('⭳ Export CSV'));
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalledWith(90));
    expect(created).toHaveBeenCalled();
  });
});
