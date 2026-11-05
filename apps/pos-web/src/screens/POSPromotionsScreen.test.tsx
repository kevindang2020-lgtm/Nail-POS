import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock, createMock, statusMock } = vi.hoisted(() => ({ stateMock: vi.fn(), createMock: vi.fn(), statusMock: vi.fn() }));
vi.mock('../api/posSalonPromotionsApi', () => ({ posSalonPromotionsApi: { state: stateMock, create: createMock, setStatus: statusMock, redeem: vi.fn() } }));
import { POSPromotionsScreen } from './POSPromotionsScreen';
beforeEach(() => { stateMock.mockReset(); createMock.mockReset(); statusMock.mockReset(); });

const promo = (o: any = {}) => ({ id: 'p1', code: 'SPRING20', name: 'Spring 20% Off', discountType: 'percent', discountPercent: 20, discountCents: null, minPurchaseCents: 5000, status: 'active', startsAt: null, endsAt: null, maxRedemptions: null, redemptionCount: 3, createdAt: '2026-07-01T00:00:00Z', ...o });
const state = (promos: any[]) => ({ kpis: { total: promos.length, active: promos.filter((p) => p.status === 'active').length, paused: 0, totalRedemptions: promos.reduce((a, p) => a + p.redemptionCount, 0), expiringSoon: 0 }, promotions: promos });

describe('POSPromotionsScreen', () => {
  it('renders KPIs + the promotion portfolio', async () => {
    stateMock.mockResolvedValue(state([promo()]));
    render(<POSPromotionsScreen />);
    expect(await screen.findByRole('heading', { name: 'Promotions' })).toBeInTheDocument();
    expect(screen.getByText('SPRING20')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });
  it('creates a promotion and reloads', async () => {
    stateMock.mockResolvedValue(state([]));
    createMock.mockResolvedValue({});
    render(<POSPromotionsScreen />);
    await screen.findByRole('heading', { name: 'Promotions' });
    fireEvent.click(screen.getByRole('button', { name: /New Promotion/i }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'SUMMER10' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Summer 10' } });
    fireEvent.change(screen.getByLabelText('Discount %'), { target: { value: '10' } });   // Sep 2026 redesign: label names the unit
    stateMock.mockResolvedValue(state([promo({ code: 'SUMMER10', name: 'Summer 10', discountPercent: 10 })]));
    fireEvent.click(screen.getByRole('button', { name: 'Create Promotion' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUMMER10', name: 'Summer 10', discountType: 'percent', discountPercent: 10 })));
  });
  it('pauses an active promotion', async () => {
    stateMock.mockResolvedValue(state([promo()]));
    statusMock.mockResolvedValue({});
    render(<POSPromotionsScreen />);
    await screen.findByText('SPRING20');
    stateMock.mockResolvedValue(state([promo({ status: 'paused' })]));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith('p1', 'paused'));
  });
});
