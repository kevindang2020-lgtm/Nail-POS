import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posSplitPaymentsApi', () => ({ posSplitPaymentsApi: { state: stateMock } }));
import { POSSplitPaymentsScreen } from './POSSplitPaymentsScreen';
beforeEach(() => stateMock.mockReset());

const state = {
  kpis: { splitTicketCount: 1, totalSplitCents: 5000, averageTenders: 2 },
  tickets: [{ ticketId: 'T1', ticketNumber: '5501', customerName: 'Split Payer', totalCents: 5000, tenderCount: 2, methods: ['cash', 'card'],
    tenders: [{ paymentId: 'a', method: 'cash', amountCents: 3000, createdAt: '2026-07-07T10:00:00Z' }, { paymentId: 'b', method: 'card', amountCents: 2000, createdAt: '2026-07-07T10:01:00Z' }], settledAt: '2026-07-07T10:01:00Z' }],
};

describe('POSSplitPaymentsScreen', () => {
  it('renders split tickets with per-tender breakdown', async () => {
    stateMock.mockResolvedValue(state);
    render(<POSSplitPaymentsScreen />);
    expect(await screen.findByRole('heading', { name: 'Split Payments' })).toBeInTheDocument();
    expect(screen.getByText('#5501')).toBeInTheDocument();
    expect(screen.getByText('Split Payer')).toBeInTheDocument();
    expect(screen.getByText('Cash $30.00')).toBeInTheDocument();
    expect(screen.getByText('Card $20.00')).toBeInTheDocument();
    expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0);
  });
  it('shows empty state', async () => {
    stateMock.mockResolvedValue({ kpis: { splitTicketCount: 0, totalSplitCents: 0, averageTenders: 0 }, tickets: [] });
    render(<POSSplitPaymentsScreen />);
    expect(await screen.findByText(/No split-tender payments/)).toBeInTheDocument();
  });
});
