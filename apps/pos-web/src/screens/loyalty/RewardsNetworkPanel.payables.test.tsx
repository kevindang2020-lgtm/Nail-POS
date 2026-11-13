// Extras (GLOBAL LOYALTY REWARDS 07 + 10): the salon's reimbursements — stage, why, provider answers, journal lines, and the
// stale-provider strip (last verified settlement; pending vs unknown provider answers). Every value is the server's; read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { stateMock, payMock, exportMock, live } = vi.hoisted(() => ({ stateMock: vi.fn(), payMock: vi.fn(), exportMock: vi.fn(), live: { refresh: null as null | (() => void) } }));
vi.mock('../../api/posRewardsNetworkApi', () => ({ posRewardsNetworkApi: {
  state: stateMock, reimbursements: payMock, financeExport: exportMock, history: vi.fn().mockResolvedValue({ items: [] }),
  purchases: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 5, pageCount: 1, totalItems: 0, totalPages: 1, items: [] }),
  ledger: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 5, pageCount: 1, totalItems: 0, totalPages: 1, items: [] }),
} }));
vi.mock('../../realtime/useRealtime', () => ({ useRealtime: (_t: unknown, cb: () => void) => { live.refresh = cb; } }));
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
const noX = { expiredHolds: { count: 0, items: [] }, unreconciledPaid: { count: 0, items: [] }, disputedReversals: { count: 0, items: [] } };
const page = (o: object) => ({ exceptionQueue: noX, provider: { connected: false, state: 'BLOCKED_EXTERNAL' },
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

describe('RewardsNetworkPanel — KPI sources + stale-time label (extras Global Loyalty Rewards 10 + 15)', () => {
  it('says when the balances were read from the server, and the explainer names formula, scope, currency, rule version and missing states', async () => {
    stateMock.mockResolvedValue({ ...st(undefined), effective: { ...rate, source: 'TENANT_OVERRIDE', versionNo: 4 }, mode: 'CUSTOM' });
    render(<RewardsNetworkPanel />);
    expect(await screen.findByTestId('rn-fresh')).toHaveTextContent('Balances as of');
    expect(screen.getByTestId('rn-fresh')).toHaveTextContent('nothing is changed on this screen before the server confirms it');
    fireEvent.click(screen.getByTestId('rn-kpi-explain'));
    await screen.findByTestId('rn-explain-dlg');
    expect(screen.getByTestId('rn-explain-common')).toHaveTextContent('Your whole salon: one wallet');
    expect(screen.getByTestId('rn-explain-common')).toHaveTextContent('US dollars. 1 token = $1.00.');
    expect(screen.getByTestId('rn-explain-mode')).toHaveTextContent('rule version 4');
    expect(screen.getByTestId('rn-explain-tokens')).toHaveTextContent('Available tokens · 96.95');
  });
  it('a failed refresh keeps the numbers labelled as stale; no wallet reads "No wallet yet", never 0', async () => {
    const base = st(undefined);
    stateMock.mockResolvedValueOnce({ ...base, wallet: { ...base.wallet, exists: false } }).mockRejectedValueOnce(new Error('offline'));
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-kpi-explain'));
    expect(await screen.findByTestId('rn-explain-tokens')).toHaveTextContent('No wallet yet');
    expect(screen.getByTestId('rn-explain-pending')).toHaveTextContent('No wallet yet');
    act(() => { live.refresh?.(); });   // a realtime nudge refetches; the refetch fails
    await waitFor(() => expect(screen.getByTestId('rn-fresh')).toHaveTextContent('Could not refresh. Numbers shown are from'));
    expect(screen.getByTestId('rn-fresh').className).toContain('warn');
  });
});

describe('RewardsNetworkPanel — owner finance export (extras GLOBAL LOYALTY REWARDS 16)', () => {
  it('owner picks salon days; the server-built audited CSV is saved as-is and the row / exception counts are said', async () => {
    const base = st(undefined);
    stateMock.mockResolvedValue({ ...base, permissions: { canEdit: true, canActivate: false, canBuyTokens: false } });
    exportMock.mockResolvedValue({ format: 'csv', filename: 'rewards-network-finance-2026-11-01-to-2026-11-12.csv', csv: 'record_type\n', rows: 7, counts: { purchases: 1, allocations: 4, payables: 2, exceptions: 1 } });
    const saved: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-export'));
    await screen.findByTestId('rn-export-dlg');
    fireEvent.change(screen.getByTestId('rn-export-from'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByTestId('rn-export-to'), { target: { value: '2026-11-12' } });
    fireEvent.click(screen.getByTestId('rn-export-go'));
    expect(await screen.findByTestId('rn-export-done')).toHaveTextContent('Downloaded 7 rows (1 exceptions).');
    expect(exportMock).toHaveBeenCalledWith('2026-11-01', '2026-11-12');
    expect(saved).toEqual(['rewards-network-finance-2026-11-01-to-2026-11-12.csv']);
    // From after To cannot be sent
    fireEvent.change(screen.getByTestId('rn-export-from'), { target: { value: '2026-12-01' } });
    expect(screen.getByTestId('rn-export-go')).toBeDisabled();
    click.mockRestore();
  });
  it('a staff member without settings access does not see the export', async () => {
    render(<RewardsNetworkPanel />);
    await screen.findByTestId('rn-kpis'); await screen.findByTestId('rn-fresh');
    expect(screen.queryByTestId('rn-export')).toBeNull();
  });
});

describe('RewardsNetworkPanel — redemption exception queue (extras Global Loyalty Rewards 07)', () => {
  it('counts each kind and lists them on demand; none says none', async () => {
    payMock.mockResolvedValueOnce(page({ exceptionQueue: {
      expiredHolds: { count: 2, items: [{ redemptionId: 'r9', ticketId: 'aaaa-ticket-000111', valueCents: 100, at: '2026-11-10T15:00:00Z' }] },
      unreconciledPaid: { count: 1, items: [{ redemptionId: 'r8', ticketId: 'bbbb-ticket-000222', valueCents: 200, at: '2026-11-11T15:00:00Z' }] },
      disputedReversals: { count: 1, items: [{ payableId: 'm1', status: 'OFFSET', ticketId: 'cccc-ticket-000333', reversedCents: 100, holdReason: null, at: '2026-11-11T16:00:00Z' }] } } }));
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-payables'));
    const box = await screen.findByTestId('rn-pay-exceptions');
    expect(box).toHaveTextContent('Exceptions: 1 paid ticket(s) whose reward was never confirmed · 1 refund(s) after payout started · 2 expired hold(s)');
    fireEvent.click(screen.getByTestId('rn-pay-x-toggle'));
    expect(screen.getByTestId('rn-pay-x-unreconciled')).toHaveTextContent('Ticket #000222 is paid but its $2.00 reward is still on hold');
    expect(screen.getByTestId('rn-pay-x-disputed')).toHaveTextContent('Refund of $1.00 on ticket #000333 after payout started · Recovery claim');
    expect(screen.getByTestId('rn-pay-x-expired')).toHaveTextContent('$1.00 reward hold on ticket #000111 expired');
  });
  it('no exceptions is said plainly', async () => {
    payMock.mockResolvedValue(page({}));
    render(<RewardsNetworkPanel />);
    fireEvent.click(await screen.findByTestId('rn-payables'));
    expect(await screen.findByTestId('rn-pay-exceptions')).toHaveTextContent('Exceptions: none');
    expect(screen.queryByTestId('rn-pay-x-toggle')).toBeNull();
  });
});
