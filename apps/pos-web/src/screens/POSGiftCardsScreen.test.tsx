import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { gcMock } = vi.hoisted(() => ({ gcMock: vi.fn() }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardsApi: { state: gcMock, liability: () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 })) } }));   // branch liability panel hidden (no reports permission) — covered in POSGiftCardsScreen.liability.test.tsx
import { POSGiftCardsScreen } from './POSGiftCardsScreen';
beforeEach(() => gcMock.mockReset());

const state = {
  kpis: { totalCards: 2, activeCards: 2, redeemedCards: 0, voidCards: 0, outstandingCents: 11000, issuedTotalCents: 15000, redeemedValueCents: 4000 },
  cards: [
    { id: 'g1', code: 'GC-0001', initialBalanceCents: 10000, balanceCents: 6000, status: 'active', customerId: null, createdAt: '2026-07-01T00:00:00Z' },
    { id: 'g2', code: 'GC-0002', initialBalanceCents: 5000, balanceCents: 5000, status: 'active', customerId: null, createdAt: '2026-07-02T00:00:00Z' },
  ],
};

describe('POSGiftCardsScreen', () => {
  it('renders outstanding liability KPI + the card portfolio', async () => {
    gcMock.mockResolvedValue(state);
    render(<POSGiftCardsScreen />);
    expect(await screen.findByRole('heading', { name: 'Gift Cards' })).toBeInTheDocument();
    expect(screen.getByText('Outstanding Liability')).toBeInTheDocument();
    expect(screen.getByText('$110.00')).toBeInTheDocument(); // 11000 cents
    expect(screen.getByText('GC-0001')).toBeInTheDocument();
    expect(screen.getByText('GC-0002')).toBeInTheDocument();
  });
  it('filters the portfolio by status tab', async () => {
    gcMock.mockResolvedValue({ ...state, cards: [...state.cards, { id: 'g3', code: 'GC-VOID', initialBalanceCents: 3000, balanceCents: 3000, status: 'void', customerId: null, createdAt: '2026-07-03T00:00:00Z' }] });
    render(<POSGiftCardsScreen />);
    await screen.findByText('GC-0001');
    fireEvent.click(screen.getByRole('tab', { name: 'Void' }));
    expect(screen.getByText('GC-VOID')).toBeInTheDocument();
    expect(screen.queryByText('GC-0001')).toBeNull();
  });
});
