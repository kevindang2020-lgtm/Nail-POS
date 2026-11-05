import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('../api/ownerApi', async (orig) => ({ ...(await orig<typeof import('../api/ownerApi')>()), ownerCashHandoffApi: { state: vi.fn() } }));
import { ownerCashHandoffApi } from '../api/ownerApi';
import { CashHandoffHomeCard } from './OwnerHomeScreen';

const board = (over: Record<string, unknown> = {}) => ({
  businessDate: '2026-06-16',
  technicians: [{ technicianId: 't1', technicianName: 'Ava Nguyen', businessDate: '2026-06-16', expectedCents: 13300, paymentCount: 3, countedCents: 12800, varianceCents: -500, status: 'discrepancy', submittedAt: null, reconciledAt: null, notes: null }],
  totalExpectedCents: 13300, totalCountedCents: 12800, technicianCount: 1, reconciledCount: 1, openCount: 0,
  ...over,
});

describe('CashHandoffHomeCard (owner home glance)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows collected cash + a discrepancy flag and taps through', async () => {
    (ownerCashHandoffApi.state as any).mockResolvedValue(board());
    const onOpen = vi.fn();
    render(<CashHandoffHomeCard onOpen={onOpen} />);
    expect(await screen.findByText('End-of-Day Cash')).toBeTruthy();
    expect(screen.getByText('$133.00')).toBeTruthy();
    expect(screen.getByText(/1 discrepancy/)).toBeTruthy();
    fireEvent.click(screen.getByText('End-of-Day Cash'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('renders nothing when no cash was collected', async () => {
    (ownerCashHandoffApi.state as any).mockResolvedValue(board({ technicians: [], technicianCount: 0, totalExpectedCents: 0 }));
    const { container } = render(<CashHandoffHomeCard onOpen={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('.owner-chartcard')).toBeNull();
  });
});
