// Deposits & Settlements (Oct 29 2026 one-screen rebuild): KPIs and the reconciliation strip come from the server summary,
// the list is server-paged (newest created first), a processor payout is never shown as bank cash, and a failed load is
// never a $0.00.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), detail: vi.fn(), transactions: vi.fn(), exportCsv: vi.fn(), exportDetail: vi.fn() }));
vi.mock('../api/posSettlementsApi', () => ({ posSettlementsApi: api }));
const recon = vi.hoisted(() => ({ raise: vi.fn() }));
vi.mock('../api/posDepositReconApi', () => ({ posDepositReconApi: recon }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
import { POSSettlementsScreen } from './POSSettlementsScreen';

const PERIOD = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-29' };
const summary = (o: Record<string, unknown> = {}) => ({
  period: PERIOD, dateBasis: 'settlement_date',
  kpis: { settlements: 2, grossSettledCents: 50000, processorFeesCents: 1200, netProcessorPayoutCents: 48800, refunds: 1, refundsCompleted: 1, refundsOpen: 0, refundsFailed: 0, refundsTotalCents: 1000 },
  reconciliation: { grossCents: 50000, feesDeductedCents: 1200, refundsInBatchCents: 0, chargebacksInBatchCents: 0, adjustmentsCents: 0, providerDefinedDifferenceCents: 0, expectedPayoutCents: 48800, bankVerified: false, bankConfirmedCents: 0, differenceCents: null, matched: 0, partial: 0, unverified: 2 },
  sourceStatus: { state: 'connected' }, options: { processors: ['cardpointe'] }, newest: null, ...o,
});
const row = (o: Record<string, unknown> = {}) => ({ id: 's-1', settlementRef: 'CP-20260063', processor: 'cardpointe', fundingAccount: null, settledAt: '2026-10-29T14:00:00Z', createdAt: '2026-10-29T14:00:00Z', expectedPayoutDate: null,
  transactionCount: 3, linkedPayments: 3, grossCents: 30000, feeCents: 800, netCents: 29200, expectedPayoutCents: 29200, refundsInBatchCents: 0, chargebacksInBatchCents: 0, adjustmentsCents: 0,
  currency: 'USD', providerStatus: 'settled', bankState: 'unverified', bankConfirmedCents: 0, linkedDeposits: 0, matchedBy: null, ...o });
const pageOf = (items: unknown[], o: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 12, total: items.length, pageCount: 1, period: PERIOD, ...o });
const mount = () => render(<MemoryRouter><POSSettlementsScreen /></MemoryRouter>);

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); });

describe('POSSettlementsScreen', () => {
  it('shows the server KPIs; the processor payout is not called bank cash', async () => {
    api.summary.mockResolvedValue(summary()); api.list.mockResolvedValue(pageOf([row(), row({ id: 's-2', settlementRef: 'CP-20260062' })]));
    mount();
    expect(await screen.findByRole('heading', { name: 'Deposits & Settlements' })).toBeInTheDocument();
    expect(await screen.findByText('CP-20260063')).toBeInTheDocument();
    expect(screen.getAllByText('$500.00').length).toBeGreaterThan(0);     // gross settled
    expect(screen.getAllByText('$488.00').length).toBeGreaterThan(0);     // net processor payout
    expect(screen.getAllByText('Not bank verified').length).toBeGreaterThan(0);
    expect(screen.getByTestId('active-period').textContent).toMatch(/Oct 1, 2026.*Oct 31, 2026/);
  });
  it('Settlements guide audit (Nov 4 2026): with no processor set up and no batch, the settlement cards say Not set up — never $0.00', async () => {
    api.summary.mockResolvedValue(summary({ kpis: { settlements: 0, grossSettledCents: 0, processorFeesCents: 0, netProcessorPayoutCents: 0, refunds: 0, refundsCompleted: 0, refundsOpen: 0, refundsFailed: 0, refundsTotalCents: 0 }, sourceStatus: { state: 'not_configured' } }));
    api.list.mockResolvedValue(pageOf([]));
    mount();
    expect(await screen.findByTestId('kpi-gross')).toHaveTextContent('Not set up');
    expect(screen.getByTestId('kpi-net')).toHaveTextContent('Not set up');
    expect(screen.getByTestId('kpi-gross')).not.toHaveTextContent('$0.00');
  });
  it('Settlements guide (Nov 4 2026): Investigate opens a reconciliation case for the batch (never a second open one)', async () => {
    api.summary.mockResolvedValue(summary()); api.list.mockResolvedValue(pageOf([row()]));
    api.detail.mockResolvedValue({ settlement: row(), provenance: { retrievedAt: '2026-10-29T14:05:00Z' }, allocations: [] });
    api.transactions.mockResolvedValue(pageOf([]));
    recon.raise.mockResolvedValueOnce({ id: 'x1', existing: false }).mockResolvedValueOnce({ id: 'x1', existing: true });
    mount();
    fireEvent.click(await screen.findByText('CP-20260063'));
    fireEvent.click(await screen.findByTestId('investigate'));
    expect(screen.getByTestId('inv-kind')).toHaveValue('missing_deposit');   // the payout is not matched in the bank yet
    fireEvent.change(screen.getByTestId('inv-note'), { target: { value: 'Not on the statement' } });
    fireEvent.click(screen.getByTestId('inv-submit'));
    await waitFor(() => expect(recon.raise).toHaveBeenCalledWith({ targetType: 'settlement', targetId: 's-1', kind: 'missing_deposit', note: 'Not on the statement' }));
    expect(await screen.findByText(/Case opened/)).toBeInTheDocument();
  });
  it('Settlements guide §10: while searching, the other tab shows how many refunds match', async () => {
    api.summary.mockResolvedValue(summary());
    api.list.mockImplementation(async (q: { tab: string; search?: string }) => (q.tab === 'refunds' ? pageOf([], { total: q.search ? 2 : 0 }) : pageOf(q.search ? [] : [row()])));
    mount(); await screen.findByText('CP-20260063');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'RF-1001' } });
    await waitFor(() => expect(screen.getByTestId('tab-refunds')).toHaveTextContent('· 2'), { timeout: 2000 });
  });
  it('asks the server for This Month, newest created first, page 1', async () => {
    api.summary.mockResolvedValue(summary()); api.list.mockResolvedValue(pageOf([row()]));
    mount();
    await screen.findByText('CP-20260063');
    expect(api.list.mock.calls[0][0]).toMatchObject({ tab: 'settlements', preset: 'month', sort: 'created_desc', page: 1 });
    expect(api.summary.mock.calls[0][0]).toMatchObject({ preset: 'month', dateField: 'settlement_date' });
  });
  it('a preset is sent to the server (the browser clock is not used)', async () => {
    api.summary.mockResolvedValue(summary()); api.list.mockResolvedValue(pageOf([row()]));
    mount();
    await screen.findByText('CP-20260063');
    fireEvent.click(screen.getByTestId('preset-year'));
    await waitFor(() => expect(api.list.mock.calls.slice(-1)[0]![0]).toMatchObject({ preset: 'year', page: 1 }));
    expect(api.list.mock.calls.slice(-1)[0]![0]).not.toHaveProperty('from');
  });
  it('a failed summary is an error with Retry, not $0.00', async () => {
    api.summary.mockRejectedValue({ status: 503 }); api.list.mockResolvedValue(pageOf([]));
    mount();
    expect(await screen.findByText(/could not be reached/i)).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });
  it('the Refunds tab has its own list', async () => {
    api.summary.mockResolvedValue(summary()); api.list.mockResolvedValue(pageOf([row()]));
    mount();
    await screen.findByText('CP-20260063');
    api.list.mockResolvedValue(pageOf([{ id: 'r-1', refundRef: 'RF-88001', processor: 'cardpointe', amountCents: 625, reason: null, status: 'failed', rawStatus: 'failed', createdAt: '2026-10-20T12:00:00Z', completedAt: null,
      payment: null, ticket: null, customer: null, saleSettlement: null, matchedBy: null }]));
    fireEvent.click(screen.getByTestId('tab-refunds'));
    expect(await screen.findByText('RF-88001')).toBeInTheDocument();
    expect(api.list.mock.calls.slice(-1)[0]![0]).toMatchObject({ tab: 'refunds', page: 1 });
  });
});
