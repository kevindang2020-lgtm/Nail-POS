import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
vi.mock('../api/ownerApi', async (orig) => ({ ...(await orig<typeof import('../api/ownerApi')>()), ownerCashHandoffApi: { state: vi.fn() } }));
import { ownerCashHandoffApi } from '../api/ownerApi';
import { OwnerCashHandoffScreen } from './OwnerCashHandoffScreen';

const board = (over: Record<string, unknown> = {}) => ({
  businessDate: '2026-06-16',
  technicians: [{ technicianId: 't1', technicianName: 'Ava Nguyen', businessDate: '2026-06-16', expectedCents: 13300, paymentCount: 3, countedCents: 12800, varianceCents: -500, status: 'discrepancy', submittedAt: null, reconciledAt: null, notes: 'Drawer short' }],
  totalExpectedCents: 13300, totalCountedCents: 12800, technicianCount: 1, reconciledCount: 1, openCount: 0,
  ...over,
});

describe('OwnerCashHandoffScreen (owner end-of-day cash summary)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the salon-wide totals and a technician row with its over/short', async () => {
    (ownerCashHandoffApi.state as any).mockResolvedValue(board());
    render(<OwnerCashHandoffScreen />);
    expect(await screen.findByText('Ava Nguyen')).toBeTruthy();
    expect(screen.getByText('Discrepancy')).toBeTruthy();
    expect(screen.getAllByText('$133.00').length).toBeGreaterThan(0); // expected total + row
    expect(screen.getByText(/Short \$5.00/)).toBeTruthy();             // net variance KPI
  });

  it('shows an empty state when no cash was collected', async () => {
    (ownerCashHandoffApi.state as any).mockResolvedValue(board({ technicians: [], totalExpectedCents: 0, totalCountedCents: 0, technicianCount: 0, reconciledCount: 0, openCount: 0 }));
    render(<OwnerCashHandoffScreen />);
    expect(await screen.findByText(/No technician collected cash/)).toBeTruthy();
  });
});
