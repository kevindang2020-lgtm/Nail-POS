// POSGiftCardsScreen.liability.test.tsx — Functional Decision 31: the Branch Liability & Clearing panel.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// A plain function, not vi.fn: vi.fn's result tracking turned the (handled) 403 rejection into a test failure.
const h = vi.hoisted(() => ({ calls: [] as unknown[][], impl: (async () => null) as (...a: unknown[]) => Promise<unknown> }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardsApi: { liability: (...a: unknown[]) => { h.calls.push(a); return h.impl(...a); } } }));
import { GiftCardBranchLiability } from './POSGiftCardsScreen';
beforeEach(() => { h.calls.length = 0; });

const report = {
  from: '2026-10-01', to: '2026-10-01', outstandingLiabilityCents: 4000,
  branches: [
    { branchId: 'a', branchName: 'Cherry Hill', soldCents: 10000, redeemedCents: 0, adjustedCents: 0, owesCents: 6000, owedCents: 0, netClearingCents: -6000 },
    { branchId: 'b', branchName: 'Moorestown', soldCents: 0, redeemedCents: 6000, adjustedCents: 0, owesCents: 0, owedCents: 6000, netClearingCents: 6000 },
    { branchId: null, branchName: 'Not attributed', soldCents: 0, redeemedCents: 0, adjustedCents: -100, owesCents: 0, owedCents: 0, netClearingCents: 0 },
  ],
  transfers: [{ fromBranchId: 'a', fromBranchName: 'Cherry Hill', toBranchId: 'b', toBranchName: 'Moorestown', amountCents: 6000 }],
  unclearableRedeemedCents: 0,
  totals: { soldCents: 10000, redeemedCents: 6000, adjustedCents: -100 },
};

describe('Gift cards — Branch Liability & Clearing (Decision 31)', () => {
  it('shows each branch\'s sold / redeemed, who owes whom (A owes B $60, not $100), and the salon-wide $40 liability', async () => {
    h.impl = async () => report;
    render(<GiftCardBranchLiability />);
    expect(await screen.findByText('Cherry Hill')).toBeInTheDocument();
    expect(screen.getByText('owes $60.00')).toBeInTheDocument();       // A sold the card B redeemed
    expect(screen.getByText('is owed $60.00')).toBeInTheDocument();
    expect(screen.getByText('Cherry Hill pays Moorestown $60.00')).toBeInTheDocument();
    expect(screen.getByText('Not attributed')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
  });
  it('Update asks for the chosen range', async () => {
    h.impl = async () => report;
    const { container } = render(<GiftCardBranchLiability />);
    await screen.findByText('Cherry Hill');
    const [from, to] = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(from, { target: { value: '2026-09-01' } }); fireEvent.change(to, { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(h.calls[h.calls.length - 1]).toEqual(['2026-09-01', '2026-09-30']));
  });
  it('without the reports permission the panel is not shown at all', async () => {
    h.impl = async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); };
    const { container } = render(<GiftCardBranchLiability />);
    await waitFor(() => expect(container.querySelector('[aria-label="Branch gift-card liability"]')).toBeNull());
    expect(h.calls).toHaveLength(1);
  });
});
