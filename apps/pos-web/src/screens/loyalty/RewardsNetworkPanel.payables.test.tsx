// Extras (GLOBAL LOYALTY REWARDS 07 + 10): the salon's reimbursements — stage, why, provider answers, journal lines, and the
// stale-provider strip (last verified settlement; pending vs unknown provider answers). Every value is the server's; read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { stateMock, payMock } = vi.hoisted(() => ({ stateMock: vi.fn(), payMock: vi.fn() }));
vi.mock('../../api/posRewardsNetworkApi', () => ({ posRewardsNetworkApi: {
  state: stateMock, reimbursements: payMock, history: vi.fn().mockResolvedValue({ items: [] }),
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


const attempt = (o: object) => ({ id: 'pa1', status: 'SETTLED', provider: 'p', amountCents: 500, settlementRef: null, signatureVerified: false, settledAt: null, failureCode: null, requestedAt: '2026-11-10T15:00:00Z', ...o });
const row = (o: object) => ({ id: 'm1', redemptionId: 'r1', ticketId: 't1', amountCents: 500, adjustedCents: 0, owedCents: 500, status: 'PAID', stage: 'PAID', why: 'paid_verified_settlement',
  holdReason: null, settlementRef: null, paidAt: null, eligibleAt: null, createdAt: '2026-11-09T15:00:00Z', attempts: [], adjustments: [], journal: [], ...o });
const page = (o: object) => ({ provider: { connected: false, state: 'BLOCKED_EXTERNAL' },
  settlement: { lastVerifiedAt: '2026-11-11T16:30:00Z', waitingOnProvider: 2, oldestWaitingSince: '2026-11-10T15:00:00Z', unknownAnswer: 1, oldestUnknownSince: '2026-11-10T18:00:00Z' },
  totals: [{ status: 'PAID', stage: 'PAID', count: 1, owedCents: 500 }, { status: 'PAYOUT_PENDING', stage: 'PROCESSING', count: 1, owedCents: 300 }], total: 2, page: 1, pageSize: 8, pageCount: 1, items: [
    row({ id: 'm1', settlementRef: 'stl_9', paidAt: '2026-11-11T16:30:00Z', attempts: [attempt({ settlementRef: 'stl_9', signatureVerified: true, settledAt: '2026-11-11T16:30:00Z' })],
      journal: [{ entryType: 'redemption_committed', account: 'reimbursement_payable', debitCents: 0, creditCents: 500, at: '2026-11-09T15:00:00Z' }, { entryType: 'reimbursement_paid', account: 'reimbursement_payable', debitCents: 500, creditCents: 0, at: '2026-11-11T16:30:00Z' }] }),
    row({ id: 'm2', amountCents: 300, owedCents: 300, status: 'PAYOUT_PENDING', stage: 'PROCESSING', why: 'pending_provider_unknown', attempts: [attempt({ id: 'pa2', status: 'UNKNOWN', amountCents: 300, failureCode: 'PROVIDER_NO_ANSWER' })] }),
  ], ...o });

beforeEach(() => { stateMock.mockReset(); payMock.mockReset(); stateMock.mockResolvedValue(st(undefined)); });

describe('RewardsNetworkPanel — reimbursements owed to this salon (extras GLOBAL LOYALTY REWARDS 07 + 10)', () => {
  it('the strip says no payout provider, the last verified settlement, and pending apart from unknown provider answers', async () => {
    payMock.mockResolvedValue(page({}));
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-payables'));
    await screen.findByTestId('rn-pay-dlg');
    expect(await screen.findByTestId('rn-pay-provider')).toHaveTextContent('No payout provider is connected yet');
    expect(screen.getByTestId('rn-pay-last')).toHaveTextContent('Last verified settlement:');
    expect(screen.getByTestId('rn-pay-waiting')).toHaveTextContent('Pending: 2 payout(s) sent to the provider');
    expect(screen.getByTestId('rn-pay-unknown')).toHaveTextContent('Unknown: 1 payout(s) got no answer');
    expect(payMock).toHaveBeenCalledWith({ page: 1, pageSize: 8, status: null });
    const rows = screen.getAllByTestId('rn-pay-row');
    expect(rows[0]).toHaveTextContent('$5.00 · Paid'); expect(rows[0]).toHaveTextContent("Paid: the provider's settlement was verified");
    expect(rows[1]).toHaveTextContent('Payout in progress'); expect(rows[1]).toHaveTextContent('the provider never answered');
  });
  it('a row opens its evidence: provider attempt with settlement ref + verified signature, and the journal lines', async () => {
    payMock.mockResolvedValue(page({}));
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-payables'));
    fireEvent.click((await screen.findAllByTestId('rn-pay-row'))[0]);
    const ev = await screen.findByTestId('rn-pay-evidence');
    expect(ev).toHaveTextContent('settlement ref stl_9'); expect(ev).toHaveTextContent('signature verified');
    const j = screen.getByTestId('rn-pay-journal');
    expect(j).toHaveTextContent('Points accepted'); expect(j).toHaveTextContent('Payout settled'); expect(j).toHaveTextContent('Owed to your salon');
    fireEvent.click(screen.getAllByTestId('rn-pay-row')[1]);
    expect(await screen.findByTestId('rn-pay-attempt')).toHaveTextContent('no answer from the provider');
    expect(screen.getByTestId('rn-pay-attempt')).toHaveTextContent('Unknown');
  });
  it('a status chip filters on the server; nothing verified and nothing waiting is said plainly', async () => {
    payMock.mockResolvedValue(page({ settlement: { lastVerifiedAt: null, waitingOnProvider: 0, oldestWaitingSince: null, unknownAnswer: 0, oldestUnknownSince: null } }));
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-payables'));
    expect(await screen.findByTestId('rn-pay-last')).toHaveTextContent('No verified settlement yet.');
    expect(screen.getByTestId('rn-pay-waiting')).toHaveTextContent('Pending: no payout is waiting');
    expect(screen.getByTestId('rn-pay-unknown')).toHaveTextContent('Unknown: none.');
    fireEvent.click(screen.getByTestId('rn-pay-total-PAYOUT_PENDING'));
    await waitFor(() => expect(payMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 8, status: 'PAYOUT_PENDING' }));
  });
});
