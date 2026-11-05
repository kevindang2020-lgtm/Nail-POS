import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posRefundsVoidsApi', () => ({ posRefundsVoidsApi: { state: stateMock } }));
import { POSRefundsVoidsScreen } from './POSRefundsVoidsScreen';
beforeEach(() => stateMock.mockReset());
const state = {
  kpis: { refundCount: 2, refundedCents: 7500, voidCount: 1, voidedCents: 8000, totalReversalCount: 3, totalReversalCents: 15500 },
  rows: [
    { id: 'p1', kind: 'refund', status: 'refunded', method: 'card', amountCents: 5000, ticketId: 't1', ticketNumber: '#2001', processedByName: 'Ana', createdAt: '2026-07-01T00:00:00Z' },
    { id: 'p3', kind: 'void', status: 'voided', method: 'cash', amountCents: 8000, ticketId: 't2', ticketNumber: '#2002', processedByName: 'Ben', createdAt: '2026-07-02T00:00:00Z' },
  ],
};
describe('POSRefundsVoidsScreen', () => {
  it('renders reversal KPIs + ledger with refund/void tags', async () => {
    stateMock.mockResolvedValue(state);
    render(<POSRefundsVoidsScreen />);
    expect(await screen.findByRole('heading', { name: /Refunds/ })).toBeInTheDocument();
    expect(screen.getByText('$155.00')).toBeInTheDocument();
    expect(screen.getByText('Refund')).toBeInTheDocument();
    expect(screen.getByText('Void')).toBeInTheDocument();
    expect(screen.getByText('#2001')).toBeInTheDocument();
  });
  it('shows empty state', async () => {
    stateMock.mockResolvedValue({ kpis: { refundCount: 0, refundedCents: 0, voidCount: 0, voidedCents: 0, totalReversalCount: 0, totalReversalCents: 0 }, rows: [] });
    render(<POSRefundsVoidsScreen />);
    expect(await screen.findByText(/No refunds or voids/)).toBeInTheDocument();
  });
});
