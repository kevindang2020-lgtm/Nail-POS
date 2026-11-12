// POSPromotionsScreen — Marketing → Promotions (Promotions Management guide, Oct 30 2026): the preserved title, five KPI cards
// (+ discount value), the vishal 20% row with its masked code, row Pause, the logged read-only checker, the Eligibility Checks
// scope and a 403 permission state. The server is mocked; the backend contracts are proven by promotions-center.pgtest.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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
  it('Expiring Soon opens an expiration calendar by day and branch that opens the same canonical promotion', async () => {
    renderScreen();
    await screen.findByText('••••NG20');
    disc.list.mockResolvedValue({ ...page([{ ...vishal, id: 'd9', name: 'Holiday', endsAt: '2026-11-05T16:00:00Z', branchName: 'Downtown' }, { ...vishal, id: 'd8', name: 'Fall', endsAt: '2026-11-02T16:00:00Z', branchName: null }]), totalItems: 140 });
    disc.detail.mockResolvedValue(null);
    const kpi = screen.getByTestId('kpi-expiring');
    fireEvent.click(kpi.querySelector('button') ?? kpi);
    const dlg = await screen.findByTestId('dlg-expiration-calendar');
    await waitFor(() => expect(disc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'live', dateField: 'ends', preset: 'custom', from: '2026-10-30', to: '2026-11-29' })));
    const days = await screen.findAllByTestId('exp-day');
    expect(days[0].textContent).toMatch(/Fall/); expect(days[1].textContent).toMatch(/Holiday/); expect(days[1].textContent).toMatch(/Downtown/);
    expect(screen.getByTestId('exp-capped').textContent).toMatch(/140/);   // more than shown is said, never hidden
    fireEvent.click(screen.getAllByTestId('exp-open')[1]);
    await waitFor(() => expect(disc.detail).toHaveBeenCalledWith('d9'));
    expect(dlg).not.toBeInTheDocument();
  });
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
    // Pause Impact Warning: nothing changes until the owner confirms; the dialog says what pausing does
    expect(deals.pause).not.toHaveBeenCalled();
    expect(screen.getByTestId('pause-impact')).toBeInTheDocument();
    expect(screen.getByTestId('dlg-confirm-pause')).toHaveTextContent(/Checkout stops accepting/);
    fireEvent.click(screen.getByTestId('confirm-pause'));
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
    expect(await screen.findByText(/cannot see this information/i)).toBeInTheDocument();
  });
  it('Export CSV sends the current filters; a paid redemption\'s ticket opens its receipt in Transactions', async () => {
    disc.exportList.mockResolvedValue('Code,Name\n');
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x') as any; globalThis.URL.revokeObjectURL = vi.fn() as any;
    renderScreen();
    fireEvent.click(await screen.findByTestId('export'));
    await waitFor(() => expect(disc.exportList).toHaveBeenCalledWith(expect.objectContaining({ status: expect.any(String) })));
    disc.redemptions.mockResolvedValue({ items: [{ id: 'r1', at: '2026-10-30T12:00:00Z', customerId: null, customerName: 'Ana', code: 'X', dealName: 'vishal', dealId: 'd1', ticketId: 't1', ticketNumber: '3001', eligibleSubtotalCents: 1000, discountCents: 200, finalCents: 800, status: 'redeemed' }],
      page: 1, pageSize: 10, totalItems: 1, totalPages: 1, period: { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-30' }, totals: { savingsCents: 200, uniqueCustomers: 1 } });
    const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; };
    render(<MemoryRouter initialEntries={['/tenant/marketing/promotions?scope=redemptions']}><Routes><Route path="/tenant/marketing/promotions" element={<POSPromotionsScreen />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    const link = (await screen.findAllByTestId('red-ticket')).find((x) => x.textContent === '#3001')!;
    fireEvent.click(link);
    expect(await screen.findByTestId('where')).toHaveTextContent('/tenant/payments/transactions?search=3001');
  });
});
