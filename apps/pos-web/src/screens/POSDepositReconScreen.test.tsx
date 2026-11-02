// AI Deposit Reconciliation (Oct 29 2026 one-screen rebuild): five server KPIs, Settlements → Deposits (server pages),
// bank accounts, unmatched deposits, Record a Deposit (a record — no money moves), and a match only after a person reviews.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ kpis: vi.fn(), bankAccounts: vi.fn(), settlements: vi.fn(), deposits: vi.fn(), search: vi.fn(), recordDeposit: vi.fn(), deposit: vi.fn(), settlement: vi.fn(), allocate: vi.fn(), suggestions: vi.fn() }));
vi.mock('../api/posDepositReconApi', () => ({ posDepositReconApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('./access/accessUi', () => ({ useStepUp: () => ({ run: (fn: () => Promise<unknown>) => fn(), prompt: null }), isStepUpCancelled: () => false }));
import { POSDepositReconScreen } from './POSDepositReconScreen';

const PERIOD = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-29' };
const kpis = { period: PERIOD, dateBasis: 'settlement', kpis: { expectedDepositsCents: 15000, matchedCents: 10000, settlements: 2, missingDeposits: 1, graceDays: 2, netDifferenceCents: -5000, unmatchedDeposits: 1,
  byStatus: { matched: 1, partiallyMatched: 0 }, netDifference: { dueMatchedCents: 10000, dueExpectedCents: 15000, notYetDueCount: 0, notYetDueCents: 0 } } };
const sRow = (o: Record<string, unknown> = {}) => ({ id: 's-1', settlementRef: 'CP-20260054', processor: 'cardpointe', settledAt: '2026-10-20T14:00:00Z', createdAt: '2026-10-20T14:00:00Z', grossCents: 10300, feeCents: 300, adjustmentsCents: 0,
  expectedNetCents: 10000, expectedArrival: '2026-10-23', arrivalSourced: false, transactionCount: 2, currency: 'USD', linkedDeposits: 0, depositRefs: [], matchedCents: 0, allocatedCents: 0, remainingCents: 10000, differenceCents: -10000,
  status: 'overdue', providerStatus: 'settled', openExceptions: 0, matchedBy: null, ...o });
const account = { id: 'b-1', nickname: 'Operating', bankName: 'TD Bank', accountType: 'checking', last4: '4321', masked: 'Operating ••4321', status: 'active', isDefault: true, deposits: 3, lastDepositDate: '2026-10-27' };
const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 10, total: items.length, pageCount: 1, period: PERIOD });
const mount = () => render(<MemoryRouter><POSDepositReconScreen /></MemoryRouter>);

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.kpis.mockResolvedValue(kpis); api.bankAccounts.mockResolvedValue({ items: [account], canManage: true });
  api.settlements.mockResolvedValue(pageOf([sRow()])); api.deposits.mockResolvedValue(pageOf([])); api.search.mockResolvedValue({ results: [] });
});

describe('POSDepositReconScreen', () => {
  it('renders the server KPIs, the settlement rows and the masked bank account', async () => {
    mount();
    expect(await screen.findByText('AI Deposit Reconciliation')).toBeInTheDocument();
    expect(await screen.findByText('CP-20260054')).toBeInTheDocument();
    expect(screen.getAllByText('$150.00').length).toBeGreaterThan(0);   // expected deposits
    expect(screen.getAllByText(/Operating ••4321/).length).toBeGreaterThan(0);
    expect(api.settlements.mock.calls[0][0]).toMatchObject({ preset: 'month', sort: 'created_desc', page: 1 });
  });
  it('Record a Deposit sends integer cents and the posted date; nothing else is implied', async () => {
    api.recordDeposit.mockResolvedValue({ deposit: { id: 'd-9', amountCents: 12345 } });
    mount();
    await screen.findByText('CP-20260054');
    fireEvent.click(screen.getByTestId('record-deposit'));
    fireEvent.change(screen.getByTestId('dep-amount'), { target: { value: '123.45' } });
    fireEvent.change(screen.getByTestId('dep-reference'), { target: { value: 'ACH 1029' } });
    fireEvent.click(screen.getByTestId('save-deposit'));
    await waitFor(() => expect(api.recordDeposit).toHaveBeenCalled());
    expect(api.recordDeposit.mock.calls[0][0]).toMatchObject({ bankAccountId: 'b-1', amountCents: 12345, depositDate: '2026-10-29', reference: 'ACH 1029', allowDuplicateReference: false });
  });
  it('a match cannot be confirmed until the person ticks that they reviewed the evidence', async () => {
    api.settlement.mockResolvedValue({ settlement: sRow(), allocations: [], exceptions: [], payments: [], notes: [] });
    api.deposit.mockResolvedValue({ deposit: { id: 'd-1', bankAccountId: 'b-1', account: 'Operating ••4321', bankName: 'TD Bank', amountCents: 10000, depositDate: '2026-10-23', reference: 'CARDPOINTE CP-20260054', description: null, source: 'manual', status: 'posted',
      notes: null, createdAt: null, createdBy: null, allocatedCents: 0, remainingCents: 10000, matchState: 'possible_candidate', candidates: 1, reviewNotes: 0 }, allocations: [], notes: [] });
    api.deposits.mockResolvedValue(pageOf([{ id: 'd-1', remainingCents: 10000, amountCents: 10000, reference: 'CARDPOINTE CP-20260054', depositDate: '2026-10-23' }]));
    api.allocate.mockResolvedValue({});
    mount();
    await screen.findByText('CP-20260054');
    fireEvent.click(screen.getAllByRole('button', { name: 'Match' })[0]);
    fireEvent.click(await screen.findByTestId('match-candidate'));
    const confirm = await screen.findByTestId('confirm-match');
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByTestId('match-reviewed'));
    await waitFor(() => expect(screen.getByTestId('confirm-match')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('confirm-match'));
    await waitFor(() => expect(api.allocate).toHaveBeenCalled());
    expect(api.allocate.mock.calls[0][0]).toMatchObject({ settlementId: 's-1', depositId: 'd-1', amountCents: 10000, reviewed: true });
  });
  it('a failed KPI load is an error state, never $0.00', async () => {
    api.kpis.mockRejectedValue({ status: 503 });
    mount();
    expect(await screen.findByText(/could not be reached/i)).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});
