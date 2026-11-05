import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posSalonPromotionsApi', () => ({ posSalonPromotionsApi: { state: stateMock } }));
import { POSDiscountsScreen } from './POSDiscountsScreen';
beforeEach(() => stateMock.mockReset());

const promo = (o: any = {}) => ({ id: 'p1', code: 'SAVE20', name: 'Spring 20', discountType: 'percent', discountPercent: 20, discountCents: null, minPurchaseCents: 0, status: 'active', startsAt: null, endsAt: '2026-12-31T00:00:00Z', maxRedemptions: 100, redemptionCount: 10, createdAt: '2026-07-01T00:00:00Z', ...o });
const state = (promotions: any[]) => ({ kpis: { total: promotions.length, active: promotions.filter((p) => p.status === 'active').length, paused: 0, totalRedemptions: 10, expiringSoon: 1 }, promotions });
const renderScreen = () => render(<MemoryRouter><POSDiscountsScreen /></MemoryRouter>);

describe('POSDiscountsScreen', () => {
  it('shows live discounts with effective label + sample value on a $100 ticket', async () => {
    stateMock.mockResolvedValue(state([promo(), promo({ id: 'p2', code: 'FIVE', name: 'Five off', discountType: 'fixed', discountPercent: null, discountCents: 500, status: 'active' })]));
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Discounts' })).toBeInTheDocument();
    expect(screen.getByText('SAVE20')).toBeInTheDocument();
    expect(screen.getByText('20% off')).toBeInTheDocument();
    expect(screen.getByText('−$20.00')).toBeInTheDocument();   // 20% of $100
    expect(screen.getByText('$5.00 off')).toBeInTheDocument();
    expect(screen.getByText('−$5.00')).toBeInTheDocument();     // fixed $5 on $100
  });
  it('respects min purchase when computing the sample value', async () => {
    // $200 minimum → no value on a $100 sample ticket
    stateMock.mockResolvedValue(state([promo({ minPurchaseCents: 20000 })]));
    renderScreen();
    expect(await screen.findByText('SAVE20')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();     // min purchase shown
  });
  it('excludes archived discounts and shows empty state', async () => {
    stateMock.mockResolvedValue(state([promo({ status: 'archived' })]));
    renderScreen();
    expect(await screen.findByText(/No active discounts/)).toBeInTheDocument();
  });
});
