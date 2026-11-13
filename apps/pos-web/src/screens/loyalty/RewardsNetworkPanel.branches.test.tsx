// Extras (GLOBAL LOYALTY REWARDS 13): the wallet's per-branch attribution, as the server computed it — read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { stateMock, previewMock } = vi.hoisted(() => ({ stateMock: vi.fn(), previewMock: vi.fn() }));
vi.mock('../../api/posRewardsNetworkApi', () => ({ posRewardsNetworkApi: {
  state: stateMock, preview: previewMock, history: vi.fn().mockResolvedValue({ items: [] }),
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

// extras GLOBAL LOYALTY REWARDS 03 (round 10): the depletion estimate and funding need are the SERVER's (last 30 days of verified use)
describe('RewardsNetworkPanel — smart wallet funding alert', () => {
  it('shows the server forecast: days left at the 30-day pace and the tokens that would cover the next 30 days; nothing bought', async () => {
    const s0: any = st(undefined);
    s0.wallet = { ...s0.wallet, availableCents: 300, forecast: { basisDays: 30, usedCents: 3000, dailyCents: 100, daysLeft: 3, daysToLow: 0, fundingNeededCents: 2700, automaticPurchase: false } };
    stateMock.mockResolvedValue(s0);
    render(<RewardsNetworkPanel />);
    const f = await screen.findByTestId('rn-forecast');
    expect(f).toHaveTextContent('about 3 days of tokens left at the last 30 days’ pace (~1 tokens a day)');
    expect(f.className).toContain('warn');
    expect(screen.getByTestId('rn-forecast-need')).toHaveTextContent('About 27 more tokens would cover the next 30 days at that pace. Nothing is bought automatically.');
  });
  it('no verified use (or an older server) → no estimate, never invented', async () => {
    const s0: any = st(undefined);
    s0.wallet = { ...s0.wallet, forecast: { basisDays: 30, usedCents: 0, dailyCents: null, daysLeft: null, daysToLow: null, fundingNeededCents: null, automaticPurchase: false } };
    stateMock.mockResolvedValue(s0);
    const { unmount } = render(<RewardsNetworkPanel />);
    expect(await screen.findByTestId('rn-forecast')).toHaveTextContent('No tokens used in the last 30 days — no depletion estimate');
    expect(screen.queryByTestId('rn-forecast-need')).toBeNull();
    unmount();
    stateMock.mockResolvedValue(st(undefined));   // no forecast field at all
    render(<RewardsNetworkPanel />);
    expect(await screen.findByTestId('rn-forecast')).toHaveTextContent('no depletion estimate');
  });
});

// extras GLOBAL LOYALTY REWARDS 06 (round 10): funding vs liability, each from its own ledger, side by side
describe('RewardsNetworkPanel — funding vs liability', () => {
  it('shows backed funding, points earned here with their backing, held points and what the network owes — not added together', async () => {
    const s0: any = st(undefined);
    s0.wallet = { ...s0.wallet, availableCents: 9695, fundingVsLiability: { backedFundingCents: 9695, pointsEarnedHereTenths: 305, earnBackingCents: 305, heldRedemptions: 1, heldPointTenths: 500, heldValueCents: 500, salonPayablesOpen: 2, salonPayablesOwedCents: 1250, combined: false } };
    stateMock.mockResolvedValue(s0);
    render(<RewardsNetworkPanel />);
    expect(await screen.findByTestId('rn-fvl-backed')).toHaveTextContent('96.95');
    expect(screen.getByTestId('rn-fvl-earned')).toHaveTextContent('30.5 points / 3.05 tokens');
    expect(screen.getByTestId('rn-fvl-held')).toHaveTextContent('1 reward(s) · 50 points · $5.00');
    expect(screen.getByTestId('rn-fvl-owed')).toHaveTextContent('2 open · $12.50');
    expect(screen.getByTestId('rn-fvl')).toHaveTextContent('never added together');
  });
  it('an older server without it → no panel', async () => {
    stateMock.mockResolvedValue(st(undefined));
    render(<RewardsNetworkPanel />);
    await screen.findByTestId('rn-forecast');
    expect(screen.queryByTestId('rn-fvl')).toBeNull();
  });
});

// extras GLOBAL LOYALTY REWARDS 04 (round 10): the custom-rule preview shows the server's scope, expected effect and approval
describe('RewardsNetworkPanel — policy impact preview', () => {
  it('shows where the rule applies, its expected effect on real earnings and who can activate it; nothing is saved', async () => {
    const s0: any = st(undefined); s0.permissions = { canEdit: true, canActivate: true, canBuyTokens: false };
    stateMock.mockResolvedValue(s0);
    previewMock.mockResolvedValue({ proposed: rate, global: rate, rows: [{ eligibleCents: 1000, pointTenths: 20, tokenCostCents: 20, globalPointTenths: 10, globalTokenCostCents: 10, differenceCents: 10 }],
      scope: { appliesTo: 'all_branches', branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'A North' }], wallet: 'one_salon_wallet' },
      expected: { basisDays: 30, earnings: 6, actualBackingCents: 305, proposedBackingCents: 560, globalBackingCents: 305, differenceVsActualCents: 255 },
      approval: { permission: 'pos.settings.edit', stepUp: true, canActivate: true, historyImmutable: true } });
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-kpi-mode'));
    expect(await screen.findByTestId('rn-impact-scope', {}, { timeout: 3000 })).toHaveTextContent('Applies to all 2 location(s) of this salon (one wallet): Main, A North.');
    expect(screen.getByTestId('rn-impact-expected')).toHaveTextContent('On your last 30 days (6 earnings) this rule would have used 5.6 tokens instead of the 3.05 actually used.');
    expect(screen.getByTestId('rn-impact-approval')).toHaveTextContent('Activating needs settings permission and a fresh verification (you can). Earnings already made keep their own rule.');
  });
});
