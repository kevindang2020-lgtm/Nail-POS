// Extras (GLOBAL LOYALTY REWARDS 13): the wallet's per-branch attribution, as the server computed it — read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../../api/posRewardsNetworkApi', () => ({ posRewardsNetworkApi: {
  state: stateMock, history: vi.fn().mockResolvedValue({ items: [] }),
  purchases: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 5, pageCount: 1, totalItems: 0, totalPages: 1, items: [] }),
  ledger: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 5, pageCount: 1, totalItems: 0, totalPages: 1, items: [] }),
} }));
vi.mock('../../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
import { RewardsNetworkPanel } from './RewardsNetworkPanel';

const rate = { spendIncrementCents: 500, pointTenthsPerIncrement: 5, minEligibleCents: 0, perTicketCapTenths: null };
const st = (branchUsage: unknown) => ({
  generatedAt: '2026-11-12T00:00:00Z', mode: 'GLOBAL', effective: { ...rate, source: 'GLOBAL_DEFAULT' }, globalNow: rate, globalNext: null, scheduled: [], drafts: [],
  program: { pointsPerRedeemBlock: 10, redeemBlockValueCents: 100, tokenValueCents: 100, limits: { minSpendIncrementCents: 100, maxSpendIncrementCents: 10000, maxPointTenthsPerIncrement: 100, minEligibleFloorCents: 0, maxPointTenthsPerTicket: 1000 },
    earnPaused: false, redeemPaused: false, purchasesPaused: false, purchasePresetsTokens: [10], maxPurchaseTokens: 100, termsVersion: null },
  enrollment: { status: 'enrolled' },
  wallet: { exists: true, availableCents: 9695, pendingCents: 0, pendingPurchases: 0, usedThisMonthCents: 305, lifetimeFundedCents: 10000, lifetimeAllocatedCents: 305, deficitCents: 0, status: 'active', alertLevel: 'ok', tokenValueCents: 100, updatedAt: null, branchUsage },
  flags: { engine: true, earn: true, redemption: true, purchases: true, customEarning: true },
  permissions: { canEdit: false, canActivate: false, canBuyTokens: false }, funding: { provider: null, sandbox: false, available: false },
});

beforeEach(() => { stateMock.mockReset(); });

describe('RewardsNetworkPanel — wallet use by branch', () => {
  it('opens the per-branch split; says the rows add up to the wallet and nothing was funded twice', async () => {
    stateMock.mockResolvedValue(st({ since: '2026-11-01T04:00:00.000Z', totalFundedCents: 305, walletUsedCents: 305, matchesWallet: true, doubleFunded: 0, rows: [
      { branchId: 'b1', branchName: 'Main', earnings: 5, pointTenths: 285, fundedCents: 285, redemptions: 2, redeemedValueCents: 400 },
      { branchId: 'b2', branchName: 'A North', earnings: 1, pointTenths: 20, fundedCents: 20, redemptions: 0, redeemedValueCents: 0 }] }));
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-branches'));
    await screen.findByTestId('rn-branches-dlg');
    const rows = screen.getAllByTestId('rn-branch-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Main'); expect(rows[0]).toHaveTextContent('28.5'); expect(rows[0]).toHaveTextContent('2.85'); expect(rows[0]).toHaveTextContent('2 · $4.00');
    expect(rows[1]).toHaveTextContent('A North'); expect(rows[1]).toHaveTextContent('0.20');
    expect(screen.getByTestId('rn-branches-match')).toHaveTextContent('The branches add up to the wallet: 3.05 tokens used this month.');
    expect(screen.getByTestId('rn-branches-double')).toHaveTextContent('No earning was funded twice.');
  });
  it('a mismatch and a double funding are said, not hidden', async () => {
    stateMock.mockResolvedValue(st({ since: '2026-11-01T04:00:00.000Z', totalFundedCents: 285, walletUsedCents: 305, matchesWallet: false, doubleFunded: 1, rows: [
      { branchId: null, branchName: null, earnings: 5, pointTenths: 285, fundedCents: 285, redemptions: 0, redeemedValueCents: 0 }] }));
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-branches'));
    expect(await screen.findByTestId('rn-branches-match')).toHaveTextContent('The branches add up to 2.85 tokens but the wallet shows 3.05 used this month');
    expect(screen.getByTestId('rn-branches-double')).toHaveTextContent('1 earnings were funded more than once');
    expect(screen.getByTestId('rn-branch-row')).toHaveTextContent('No branch recorded');
  });
  it('no branch split from the server → no button', async () => {
    stateMock.mockResolvedValue(st(undefined));
    render(<RewardsNetworkPanel />);
    await screen.findByTestId('rn-forecast');   // the wallet has loaded
    expect(screen.queryByTestId('rn-branches')).toBeNull();
  });
});
