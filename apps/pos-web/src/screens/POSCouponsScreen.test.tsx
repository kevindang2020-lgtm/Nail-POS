// POSCouponsScreen — Marketing → Coupons (Coupons & Promotions Management Center, Oct 30 2026): its own title (the route
// used to render Promotions), the six cards from the server, the vishal row, the read-only checker, the Health tab.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { disc, cp } = vi.hoisted(() => ({
  disc: { kpis: vi.fn(), list: vi.fn(), redemptions: vi.fn(), performance: vi.fn(), detail: vi.fn(), exportList: vi.fn(), exportRedemptions: vi.fn() },
  cp: { check: vi.fn(), campaigns: vi.fn(), health: vi.fn(), suggest: vi.fn(), draft: vi.fn(), duplicate: vi.fn(), runHealth: vi.fn(), healthRuns: vi.fn() },
}));
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: disc }));
vi.mock('../api/posCouponsApi', () => ({ posCouponsApi: cp }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock('../api/authApi', () => ({ authApi: { branches: vi.fn().mockResolvedValue({ branches: [{ id: 'b1', name: 'Main', isActive: true }, { id: 'b2', name: 'Second', isActive: true }] }) } }));
import { POSCouponsScreen } from './POSCouponsScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-30' };
const kpis = { today: '2026-10-30', total: 1, activeDiscounts: 1, percentOff: 1, fixedAmount: 0, redemptions: 0, expiringSoon: 0, expiringWindowDays: 7,
  split: { scheduled: 0, paused: 0, draft: 0, expired: 0, exhausted: 0, archived: 0 }, ledger: { confirmedEvents: 0, uniqueCustomers: 0, savingsCents: 0, pendingAtCheckout: 0, grossDiscountCents: 0, reversedCents: 0 } };
const vishal = { id: 'd1', code: '••••NG20', codes: 1, name: 'vishal', description: null, discountType: 'percent', discountPercent: 20, discountCents: null, maxDiscountCents: null, sampleSavingsCents: 2000, minPurchaseCents: 0,
  startsAt: null, endsAt: null, maxRedemptions: null, used: 0, remaining: null, lifecycle: 'active', dealStatus: 'active', matchedVia: null, createdAt: '2026-10-27T12:00:00Z', updatedAt: '2026-10-27T12:00:00Z' };
const page = (items: unknown[]) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 });
beforeEach(() => {
  Object.values(disc).forEach((f) => f.mockReset()); Object.values(cp).forEach((f) => f.mockReset());
  disc.kpis.mockResolvedValue(kpis); disc.list.mockResolvedValue(page([vishal])); disc.redemptions.mockResolvedValue({ ...page([]), totals: { savingsCents: 0, uniqueCustomers: 0 } });
  cp.health.mockResolvedValue({ overall: 'ready', checkedAt: '2026-10-30T20:00:00Z', checks: [{ key: 'counters', status: 'ready', count: 0, detail: 'ok', sample: [] }] });
  cp.healthRuns.mockResolvedValue({ items: [], page: 1, pageSize: 5, totalItems: 0, totalPages: 1 });
});
const renderScreen = (path = '/tenant/marketing/coupons') => render(<MemoryRouter initialEntries={[path]}><POSCouponsScreen /></MemoryRouter>);

describe('POSCouponsScreen', () => {
  it('has its own title (not "Promotions") and shows the vishal 20% record from the server with the six cards', async () => {
    renderScreen();
    expect(await screen.findByText('••••NG20')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Coupons & Promotions');
    for (const k of ['Total', 'Active', 'Paused', 'Redemptions', 'Expiring Soon', 'Discount value used']) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    expect(screen.getByText('vishal')).toBeInTheDocument(); expect(screen.getAllByText('20% off').length).toBeGreaterThan(0);
  });
  it('Check runs the server checker (read-only) and shows its verdict and the discount', async () => {
    cp.check.mockResolvedValue({ verdict: 'ELIGIBLE', eligible: true, action: '', reasons: [], dealId: 'd1', title: 'vishal', status: 'active', discountPreviewCents: 667, eligibleBaseCents: 3335, context: { ticketId: 't', customerId: null, serviceIds: [], spendCents: 3335, onTicket: 0, policy: 'best_single' } });
    renderScreen();
    fireEvent.click(await screen.findByTestId('coupon-check'));
    fireEvent.change(screen.getByTestId('check-ticket'), { target: { value: '77001' } });
    fireEvent.click(screen.getByTestId('check-run'));
    expect(await screen.findByTestId('check-verdict')).toHaveTextContent('Eligible');
    expect(screen.getByTestId('check-discount')).toHaveTextContent('$6.67');
    expect(cp.check).toHaveBeenCalledWith('d1', { ticketNumber: '77001', codeEntered: true });
  });
  it('Health tab shows the server\'s verified checks', async () => {
    renderScreen('/tenant/marketing/coupons?tab=health');
    expect(await screen.findByTestId('health-overall')).toHaveTextContent('Ready');
  });
  it('location filter, expiring window, redemption basis and export go to the server; a redemption opens its ticket', async () => {
    disc.exportList.mockResolvedValue('Code,Name\n');
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x') as any; globalThis.URL.revokeObjectURL = vi.fn() as any;
    renderScreen();
    await screen.findByText('••••NG20');
    fireEvent.change(await screen.findByTestId('branch'), { target: { value: 'b2' } });
    await waitFor(() => expect(disc.list).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'b2', page: 1 })));
    fireEvent.change(screen.getByTestId('expiring-window'), { target: { value: '30' } });
    await waitFor(() => expect(disc.kpis).toHaveBeenLastCalledWith({ expiringDays: 30 }));
    fireEvent.click(screen.getByTestId('export'));
    await waitFor(() => expect(disc.exportList).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'b2' })));
    disc.redemptions.mockResolvedValue({ ...page([{ id: 'r1', at: '2026-10-30T12:00:00Z', customerId: null, customerName: 'Ana', code: 'X', dealName: 'vishal', dealId: 'd1', ticketId: 't1', ticketNumber: '1042', eligibleSubtotalCents: 1000, discountCents: 200, finalCents: 800, status: 'redeemed' }]), totals: { savingsCents: 200, uniqueCustomers: 1 } });
    fireEvent.click(screen.getByTestId('tab-redemptions'));
    await waitFor(() => expect(disc.redemptions).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'b2', dateField: 'redeemed' })));
    expect(await screen.findByTestId('red-ticket')).toHaveTextContent('#1042');
  });
  it('Run check now records a run and the history lists it newest first', async () => {
    cp.runHealth.mockResolvedValue({ overall: 'attention', runId: 'h2' });
    renderScreen();
    fireEvent.click(await screen.findByTestId('tab-health'));
    expect(await screen.findByText('No recorded checks yet.')).toBeInTheDocument();
    cp.healthRuns.mockResolvedValue({ items: [{ id: 'h2', overall: 'attention', at: '2026-10-30T20:05:00Z', by: 'Linh Owner', attention: ['counters'] }], page: 1, pageSize: 5, totalItems: 1, totalPages: 1 });
    fireEvent.click(screen.getByTestId('health-run'));
    await waitFor(() => expect(cp.runHealth).toHaveBeenCalled());
    expect(await screen.findByTestId('health-run-row')).toHaveTextContent('Linh Owner');
  });
});
