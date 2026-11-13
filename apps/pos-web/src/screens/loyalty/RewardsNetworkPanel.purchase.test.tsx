// extras GLOBAL LOYALTY REWARDS 04 (round 10): the purchase status timeline — each recorded step with its time AND who recorded it.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { stateMock, purchaseMock, P } = vi.hoisted(() => ({ stateMock: vi.fn(), purchaseMock: vi.fn(), P: { id: 'pu1', tenantId: 't', tokenCents: 1000, amountCents: 1000, feeCents: 0, status: 'FUNDS_VERIFIED', pending: false, spendable: true, provider: 'sandbox', providerRefLast6: '123456', failureCode: null,
  createdAt: '2026-11-10T14:00:00Z', confirmedAt: '2026-11-10T14:01:00Z', fundedAt: '2026-11-10T14:02:00Z' } }));
vi.mock('../../api/posRewardsNetworkApi', () => ({ posRewardsNetworkApi: {
  state: stateMock, history: vi.fn().mockResolvedValue({ items: [] }), purchase: purchaseMock,
  purchases: vi.fn().mockResolvedValue({ total: 1, page: 1, pageSize: 5, pageCount: 1, totalItems: 1, totalPages: 1, items: [P] }),
  ledger: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 5, pageCount: 1, totalItems: 0, totalPages: 1, items: [] }),
} }));
vi.mock('../../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
import { RewardsNetworkPanel } from './RewardsNetworkPanel';

const rate = { spendIncrementCents: 500, pointTenthsPerIncrement: 5, minEligibleCents: 0, perTicketCapTenths: null };
describe('RewardsNetworkPanel — purchase timeline', () => {
  it('lists requested → confirmed → verified with each time and who recorded it (never a raw source code)', async () => {
    stateMock.mockResolvedValue({ generatedAt: '2026-11-12T00:00:00Z', mode: 'GLOBAL', effective: { ...rate, source: 'GLOBAL_DEFAULT' }, globalNow: rate, globalNext: null, scheduled: [], drafts: [],
      program: { pointsPerRedeemBlock: 10, redeemBlockValueCents: 100, tokenValueCents: 100, limits: { minSpendIncrementCents: 100, maxSpendIncrementCents: 10000, maxPointTenthsPerIncrement: 100, minEligibleFloorCents: 0, maxPointTenthsPerTicket: 1000 },
        earnPaused: false, redeemPaused: false, purchasesPaused: false, purchasePresetsTokens: [10], maxPurchaseTokens: 100, termsVersion: null },
      enrollment: { status: 'enrolled' }, wallet: { exists: true, availableCents: 1000, pendingCents: 0, pendingPurchases: 0, usedThisMonthCents: 0, lifetimeFundedCents: 1000, lifetimeAllocatedCents: 0, deficitCents: 0, status: 'active', alertLevel: 'ok', tokenValueCents: 100, updatedAt: null },
      flags: { engine: true, earn: true, redemption: true, purchases: true, customEarning: true }, permissions: { canEdit: false, canActivate: false, canBuyTokens: false }, funding: { provider: 'sandbox', sandbox: true, available: true } });
    purchaseMock.mockResolvedValue({ ...P, events: [{ from: null, to: 'REQUESTED', source: 'owner', at: '2026-11-10T14:00:00Z' }, { from: 'REQUESTED', to: 'PAYMENT_CONFIRMED', source: 'sandbox_admin', at: '2026-11-10T14:01:00Z' },
      { from: 'PAYMENT_CONFIRMED', to: 'FUNDS_VERIFIED', source: 'sandbox_admin', at: '2026-11-10T14:02:00Z' }] });
    render(<RewardsNetworkPanel />);
    fireEvent.click((await screen.findAllByLabelText('Details'))[0]);
    const ev = await screen.findAllByTestId('rn-purchase-event');
    expect(ev).toHaveLength(3);
    expect(ev[0]).toHaveTextContent('recorded by the salon'); expect(ev[2]).toHaveTextContent('recorded by platform support (sandbox)');
    for (const e of ev) expect(e.textContent).not.toMatch(/sandbox_admin|\bowner\b/);
  });
});
