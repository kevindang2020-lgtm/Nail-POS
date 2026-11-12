import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerRewardsApi', () => ({ customerRewardsApi: { mine: vi.fn(() => Promise.resolve({
  state: 'ACTIVE', program: { available: true, pointsPerRedeemBlock: 10, redeemBlockValueCents: 100 }, terms: { version: 'v1', title: 'T', summary: [], privacyPath: '/p' },
  account: { availablePoints: '20', heldPoints: '0', availableTenths: 200, heldTenths: 0, redemptionValueCents: 200, lifetimeEarnedPoints: '40', lifetimeRedeemedPoints: '0', joinedAt: null, termsVersion: 'v1', withdrawnAt: null, expires: null },
  earned: [{ ref: 'E-1', salon: 'Salon B', at: '2026-11-03T15:00:00Z', points: '20', eligibleCents: 10000, rate: '$5.00 = 1 point', status: 'EARNED', rule: { kind: 'salon', versionNo: 3 }, spendableFrom: '2026-11-03T15:00:00Z' },
    { ref: 'E-2', salon: 'Salon A', at: '2026-11-01T15:00:00Z', points: '0', eligibleCents: 10000, rate: '$5.00 = 1 point', status: 'REVERSED', rule: { kind: 'network', versionNo: 1 }, spendableFrom: null }],
  redemptions: [] })), optIn: vi.fn(), withdraw: vi.fn() } }));
import { MyRewardsScreen, ruleLabel } from './MyRewardsScreen';

describe('My Rewards — earned points explainer (GLOBAL LOYALTY 05)', () => {
  it('each earning shows the rule version that applied and since when it is spendable; a refunded one is not spendable', async () => {
    render(<MemoryRouter><MyRewardsScreen /></MemoryRouter>);
    const why = await screen.findAllByTestId('rewards-earned-why');
    expect(why[0]).toHaveTextContent("Salon's own rate (version 3)"); expect(why[0]).toHaveTextContent('Spendable since');
    expect(why[1]).toHaveTextContent('Network rate (version 1)'); expect(why[1]).toHaveTextContent('Refunded — not spendable');
    expect(ruleLabel(null)).toBe('Rule not recorded');
  });
});
