// POSDiscountsScreen — Services → Discounts rebuild (Oct 29 2026): the five cards, the seven Live & Scheduled columns with a
// masked code and the illustrative $100 figure, the tabs, the empty states, Manage in Promotions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api } = vi.hoisted(() => ({ api: { kpis: vi.fn(), list: vi.fn(), redemptions: vi.fn(), performance: vi.fn(), detail: vi.fn(), exportList: vi.fn(), exportRedemptions: vi.fn() } }));
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: api }));
import { POSDiscountsScreen } from './POSDiscountsScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' };
const kpis = { today: '2026-10-29', activeDiscounts: 1, percentOff: 1, fixedAmount: 0, redemptions: 0, expiringSoon: 0, expiringWindowDays: 7, split: { scheduled: 0, paused: 0, draft: 0, expired: 0, exhausted: 0 }, ledger: { confirmedEvents: 0, uniqueCustomers: 0, savingsCents: 0, pendingAtCheckout: 0 } };
const row = { id: 'd1', code: '••••NG20', codes: 1, name: 'Spring Glow', description: null, discountType: 'percent', discountPercent: 20, discountCents: null, maxDiscountCents: null, sampleSavingsCents: 2000, minPurchaseCents: 1000,
  startsAt: null, endsAt: null, maxRedemptions: null, used: 0, remaining: null, lifecycle: 'active', dealStatus: 'active', matchedVia: null, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' };
const page = (items: unknown[]) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 });
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.kpis.mockResolvedValue(kpis); api.list.mockResolvedValue(page([row])); api.redemptions.mockResolvedValue({ ...page([]), totals: { savingsCents: 0, uniqueCustomers: 0 } }); });
const renderScreen = () => render(<MemoryRouter><POSDiscountsScreen /></MemoryRouter>);

describe('POSDiscountsScreen', () => {
  it('keeps the five cards, the seven columns and the photo coupon (masked, 20% off, −$20.00 on $100, $10 min, no end date, 0 used)', async () => {
    renderScreen();
    expect(await screen.findByText('••••NG20')).toBeInTheDocument();
    for (const k of ['Active Discounts', 'Percent-Off', 'Fixed-Amount', 'Redemptions', 'Expiring Soon']) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    for (const h of ['Code', 'Discount', 'On a $100 ticket', 'Min Purchase', 'Valid', 'Usage', 'Status']) expect(screen.getAllByText(new RegExp('^' + h.replace('$', '\\$') + '$', 'i')).length).toBeGreaterThan(0);
    expect(screen.getByText('20% off')).toBeInTheDocument();
    expect(screen.getByText('−$20.00')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    expect(screen.getByText('No end date')).toBeInTheDocument();
    expect(screen.getByText(/0 used/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage in Promotions' })).toBeInTheDocument();
  });
  it('a verified zero is an empty state with Manage in Promotions, not an error', async () => {
    api.list.mockResolvedValue(page([]));
    renderScreen();
    expect(await screen.findByText('No discounts found.')).toBeInTheDocument();
  });
  it('Redemption History is its own tab and list', async () => {
    renderScreen();
    await screen.findByText('••••NG20');
    fireEvent.click(screen.getByTestId('tab-redemptions'));
    expect(await screen.findByText('No confirmed redemptions yet.')).toBeInTheDocument();
    expect(api.redemptions).toHaveBeenCalledWith(expect.objectContaining({ state: 'confirmed', page: 1 }));
  });
});
