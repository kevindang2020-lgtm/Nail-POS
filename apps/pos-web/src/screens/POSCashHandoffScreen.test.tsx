import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../api/posCashHandoffApi', async (orig) => ({ ...(await orig<typeof import('../api/posCashHandoffApi')>()), posCashHandoffApi: { state: vi.fn(), reconcile: vi.fn() } }));
import { posCashHandoffApi } from '../api/posCashHandoffApi';
import { POSCashHandoffScreen } from './POSCashHandoffScreen';
const TODAY = new Date().toISOString().slice(0, 10);

const board = (over: Record<string, unknown> = {}) => ({
  businessDate: '2026-06-16',
  technicians: [{ technicianId: 't1', technicianName: 'Ava Nguyen', businessDate: '2026-06-16', expectedCents: 13300, paymentCount: 3, countedCents: null, varianceCents: null, status: 'submitted', submittedAt: '2026-06-16T20:00:00Z', reconciledAt: null, notes: null }],
  totalExpectedCents: 13300, totalCountedCents: 0, technicianCount: 1, reconciledCount: 0, openCount: 1,
  ...over,
});

describe('POSCashHandoffScreen (end-of-day reconciliation board)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists a technician with expected cash and status', async () => {
    (posCashHandoffApi.state as any).mockResolvedValue(board());
    render(<POSCashHandoffScreen />);
    expect(await screen.findByText('Ava Nguyen')).toBeTruthy();
    expect(screen.getAllByText('$133.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Handed off')).toBeTruthy();
  });

  it('counts and reconciles a technician', async () => {
    (posCashHandoffApi.state as any).mockResolvedValue(board());
    (posCashHandoffApi.reconcile as any).mockResolvedValue({ technicianId: 't1', technicianName: 'Ava Nguyen', businessDate: '2026-06-16', expectedCents: 13300, paymentCount: 3, countedCents: 13300, varianceCents: 0, status: 'reconciled', submittedAt: null, reconciledAt: null, notes: null, lines: [] });
    render(<POSCashHandoffScreen />);
    fireEvent.click(await screen.findByText('Count'));
    const input = await screen.findByLabelText(/Counted cash/);
    fireEvent.change(input, { target: { value: '133.00' } });
    fireEvent.click(screen.getByText('Reconcile'));
    expect(await screen.findByText(/matched \$133.00/)).toBeTruthy();
    expect(posCashHandoffApi.reconcile).toHaveBeenCalledWith('t1', 13300, undefined, TODAY);
  });
});
