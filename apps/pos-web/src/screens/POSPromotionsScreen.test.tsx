// POSPromotionsScreen — Marketing → Promotions (Promotions Management guide, Oct 30 2026): the preserved title, five KPI cards
// (+ discount value), the vishal 20% row with its masked code, row Pause, the logged read-only checker, the Eligibility Checks
// scope and a 403 permission state. The server is mocked; the backend contracts are proven by promotions-center.pgtest.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { disc, cp, pr, deals } = vi.hoisted(() => ({
  disc: { kpis: vi.fn(), list: vi.fn(), redemptions: vi.fn(), performance: vi.fn(), detail: vi.fn(), exportList: vi.fn(), exportRedemptions: vi.fn() },
  cp: { check: vi.fn(), campaigns: vi.fn(), health: vi.fn(), suggest: vi.fn(), draft: vi.fn(), duplicate: vi.fn() },
  pr: { check: vi.fn(), checks: vi.fn(), trends: vi.fn(), suggest: vi.fn(), activity: vi.fn() },
  deals: { pause: vi.fn(), resume: vi.fn(), archive: vi.fn(), publish: vi.fn(), get: vi.fn() },
}));
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: disc }));
vi.mock('../api/posCouponsApi', () => ({ posCouponsApi: cp }));
vi.mock('../api/posPromotionsApi', () => ({ posPromotionsApi: pr }));
vi.mock('../api/posDealsApi', () => ({ posDealsApi: deals }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock('../api/authApi', () => ({ authApi: { branches: vi.fn().mockResolvedValue({ ok: true, branches: [] }) } }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
import { POSPromotionsScreen } from './POSPromotionsScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-30' };
const kpis = { today: '2026-10-30', total: 1, activeDiscounts: 1, percentOff: 1, fixedAmount: 0, redemptions: 0, expiringSoon: 0, expiringWindowDays: 7,
  split: { scheduled: 0, paused: 0, draft: 0, expired: 0, exhausted: 0, archived: 0 }, ledger: { confirmedEvents: 0, uniqueCustomers: 0, savingsCents: 0, pendingAtCheckout: 0, grossDiscountCents: 0, reversedCents: 0 } };
const vishal = { id: 'd1', code: '••••NG20', codes: 1, name: 'vishal', description: null, discountType: 'percent', discountPercent: 20, discountCents: null, maxDiscountCents: null, sampleSavingsCents: 2000, minPurchaseCents: 0,
  startsAt: null, endsAt: null, maxRedemptions: null, used: 0, remaining: null, lifecycle: 'active', dealStatus: 'active', matchedVia: null, createdAt: '2026-10-27T12:00:00Z', updatedAt: '2026-10-27T12:00:00Z' };
const page = (items: unknown[]) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 });
beforeEach(() => {
  for (const g of [disc, cp, pr, deals]) Object.values(g).forEach((f) => f.mockReset());
  disc.kpis.mockResolvedValue(kpis); disc.list.mockResolvedValue(page([vishal]));
  pr.checks.mockResolvedValue({ ...page([]), verdict: 'all', note: '' });
});
const renderScreen = (path = '/tenant/marketing/promotions') => render(<MemoryRouter initialEntries={[path]}><POSPromotionsScreen /></MemoryRouter>);

describe('POSPromotionsScreen', () => {
  it('keeps the Promotions title, the five KPI cards (+ discount value) and the vishal 20% row with its masked code', async () => {
    renderScreen();
    expect(await screen.findByText('••••NG20')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Promotions');
    for (const k of ['Total', 'Active', 'Paused', 'Redemptions', 'Expiring Soon', 'Discount value redeemed']) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    expect(screen.getByText('vishal')).toBeInTheDocument(); expect(screen.getByTestId('new-promotion')).toBeInTheDocument();
  });
  it('row Pause calls the audited lifecycle endpoint (not the legacy status route)', async () => {
    deals.pause.mockResolvedValue({ id: 'd1', status: 'paused' });
    renderScreen();
    fireEvent.click(await screen.findByTestId('row-pause'));
    expect(deals.pause).toHaveBeenCalledWith('d1');
  });
  it('Check uses the logged promotions checker and says it was recorded, not applied', async () => {
    pr.check.mockResolvedValue({ verdict: 'ELIGIBLE', eligible: true, action: '', reasons: [], dealId: 'd1', title: 'vishal', status: 'active', discountPreviewCents: 2000, eligibleBaseCents: 10000, checkId: 'k1', checkedAt: '2026-10-30T20:00:00Z', logged: true,
      context: { ticketId: null, customerId: null, serviceIds: [], spendCents: 10000, onTicket: 0, policy: 'best_single' } });
    renderScreen();
    fireEvent.click(await screen.findByTestId('row-check'));
    fireEvent.change(screen.getByTestId('check-spend'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('check-run'));
    expect(await screen.findByTestId('check-discount')).toHaveTextContent('$20.00');
    expect(screen.getByTestId('check-logged')).toBeInTheDocument();
  });
  it('the Eligibility Checks scope lists only logged checks (empty state when none)', async () => {
    renderScreen('/tenant/marketing/promotions?scope=checks');
    expect(await screen.findByText(/No eligibility checks yet/)).toBeInTheDocument();
    expect(pr.checks).toHaveBeenCalled();
  });
  it('shows a permission message on 403', async () => {
    disc.kpis.mockRejectedValue({ status: 403 });
    renderScreen();
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
