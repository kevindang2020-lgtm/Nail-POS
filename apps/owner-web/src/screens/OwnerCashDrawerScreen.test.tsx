// OwnerCashDrawerScreen (owner money oversight, read-only): salon-wide register-drawer review for a date. Verifies the
// KPI roll-ups (expected/counted/net variance, reconciled + awaiting counts), the per-branch over/short/balanced labels
// (which lock the variance sign: varianceCents = counted − expected, so >0 is OVER and <0 is SHORT), the uncounted state,
// the empty state, and a friendly 403.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
vi.mock('../api/ownerApi', () => ({ ownerCashDrawerApi: { state: vi.fn() } }));

import { ownerCashDrawerApi } from '../api/ownerApi';
import { OwnerCashDrawerScreen } from './OwnerCashDrawerScreen';

const row = (over: any = {}) => ({
  branchId: 'b', branchName: 'Branch', businessDate: '2026-06-17', openingFloatCents: 20000, expectedSalesCents: 35000,
  refundsCents: 5000, paidInCents: 0, paidOutCents: 0, expectedCashCents: 50000, countedCents: 50000, varianceCents: 0,
  cashPaymentCount: 12, status: 'reconciled', openedAt: null, reconciledAt: null, notes: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (ownerCashDrawerApi.state as any).mockResolvedValue({
    businessDate: '2026-06-17',
    branches: [
      row({ branchId: 'a', branchName: 'Cherry Hill', expectedCashCents: 50000, countedCents: 50000, varianceCents: 0, status: 'reconciled' }),
      row({ branchId: 'b', branchName: 'Marlton', expectedCashCents: 30000, countedCents: 29500, varianceCents: -500, status: 'discrepancy' }),
      row({ branchId: 'c', branchName: 'Voorhees', expectedCashCents: 20000, countedCents: 20300, varianceCents: 300, status: 'discrepancy' }),
    ],
  });
});

describe('OwnerCashDrawerScreen', () => {
  it('rolls up expected, counted and net variance across branches', async () => {
    render(<OwnerCashDrawerScreen />);
    expect(await screen.findByText('$1,000.00')).toBeInTheDocument();   // totalExpected 100000
    expect(screen.getByText('$998.00')).toBeInTheDocument();            // totalCounted 99800
    expect(screen.getByText('Short $2.00')).toBeInTheDocument();        // netVariance -200
    expect(screen.getByText('2 discrepancies · 0 awaiting')).toBeInTheDocument();
  });

  it('labels per-branch variance by the correct sign (over for +, short for -, balanced for 0)', async () => {
    render(<OwnerCashDrawerScreen />);
    expect(await screen.findByText('balanced')).toBeInTheDocument();    // a: variance 0
    expect(screen.getByText('short $5.00')).toBeInTheDocument();        // b: counted < expected
    expect(screen.getByText('over $3.00')).toBeInTheDocument();         // c: counted > expected
  });

  it('shows "Not counted yet" for an uncounted branch without breaking totals', async () => {
    (ownerCashDrawerApi.state as any).mockResolvedValue({
      businessDate: '2026-06-17',
      branches: [row({ branchId: 'a', branchName: 'Cherry Hill', expectedCashCents: 40000, countedCents: null, varianceCents: null, status: 'open' })],
    });
    render(<OwnerCashDrawerScreen />);
    expect(await screen.findByText('Not counted yet')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();              // totalCounted with the null treated as 0
  });

  it('shows the empty state for a date with no branches', async () => {
    (ownerCashDrawerApi.state as any).mockResolvedValue({ businessDate: '2026-06-17', branches: [] });
    render(<OwnerCashDrawerScreen />);
    expect(await screen.findByText('No active branches for this date.')).toBeInTheDocument();
  });

  it('shows a friendly message on a 403', async () => {
    (ownerCashDrawerApi.state as any).mockRejectedValue({ status: 403 });
    render(<OwnerCashDrawerScreen />);
    expect(await screen.findByText('You do not have access to the cash drawer.')).toBeInTheDocument();
  });
});
