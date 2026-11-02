import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SettlementsOverview } from '../api/superAdminSettlementsApi';

const { mockOverview, mockAddNote, mockExportCsv, mockExportXlsx, mockCase, mockMatch, mockResolve } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockAddNote: vi.fn(), mockExportCsv: vi.fn(), mockExportXlsx: vi.fn(), mockCase: vi.fn(), mockMatch: vi.fn(), mockResolve: vi.fn() }));
vi.mock('../api/superAdminSettlementsApi', async () => {
  const actual = await vi.importActual<any>('../api/superAdminSettlementsApi');
  return { ...actual, superAdminSettlementsApi: { overview: (q: any) => mockOverview(q), addNote: (id: any, b: any) => mockAddNote(id, b), exportCsv: (q: any) => mockExportCsv(q), exportXlsx: (q: any) => mockExportXlsx(q), processorCase: (id: any, b: any) => mockCase(id, b), matchDeposit: (id: any, b: any) => mockMatch(id, b), resolve: (id: any, b: any) => mockResolve(id, b) } };
});

import { SettlementsScreen } from './SettlementsScreen';

const row = (o: Partial<SettlementsOverview['batches']['rows'][number]> = {}): SettlementsOverview['batches']['rows'][number] => ({
  id: 'id-1', batchRef: 'BCH-2026-0506-001', tenantId: 't-a', tenantName: 'Glamour Studio', branchId: 'b-1', branchName: 'Downtown',
  processor: 'fiserv', grossCents: 2681235, refundsCents: 102540, chargebacksCents: 24500, feesCents: 56215, adjustmentsCents: 0,
  netCents: 2497980, expectedNetCents: 2497980, actualDepositCents: 2497980, expectedDepositDate: '2026-05-06', actualDepositDate: '2026-05-06',
  fundingMasked: '•••• 7890', settlementStatus: 'settled', reconciliationStatus: 'reconciled', differenceCents: 0, transactionCount: 412, ...o,
});

const overview = (): SettlementsOverview => ({
  meta: { generatedAt: '2026-05-06T14:34:00Z', scope: 'platform' },
  kpis: { totalBatches: 487, grossCents: 124839240, netCents: 119184216, pendingDepositsCents: 5655024, reconDiffCents: 498237, feesCents: 1864273, chargebackCents: 1294531, fundingExceptions: 7 },
  batches: { rows: [row(), row({ id: 'id-2', batchRef: 'BCH-2026-0506-002', tenantName: 'Luxe Salon & Spa', branchName: 'Main', processor: 'clover', settlementStatus: 'pending', reconciliationStatus: 'pending', actualDepositCents: null, actualDepositDate: null, differenceCents: null, fundingMasked: '•••• 4567' })], total: 487, page: 1, pageSize: 10, totalPages: 49 },
  selectedBatch: null,
  depositStatus: { total: 487, slices: [{ status: 'settled', count: 391, pct: 80.3 }, { status: 'pending', count: 63, pct: 12.9 }], settledAmountCents: 107824241, pendingAmountCents: 5655024 },
  settlementTrend: [{ date: '2026-04-30', grossCents: 2500000, netCents: 2400000 }, { date: '2026-05-01', grossCents: 2600000, netCents: 2500000 }],
  settlementTrendTotals: { grossCents: 17489210, netCents: 16675985 },
  dailyFunding: [{ date: '2026-04-30', expectedCents: 2500000, actualCents: 2510000 }],
  dailyFundingTotals: { expectedCents: 16665161, actualCents: 16675985, varianceCents: 10824 },
  reconciliationDifferences: { rows: [{ id: 'id-3', batchRef: 'BCH-2026-0504-010', differenceCents: 13245, status: 'in_review' }], totalCents: 498237 },
  recentActivity: [{ id: 'id-1', batchRef: 'BCH-2026-0506-001', tenantName: 'Glamour Studio', branchName: 'Downtown', status: 'settled', amountCents: 2497980, atMs: Date.parse('2026-05-06T14:31:00Z') }],
  fundingExceptions: { categories: [{ type: 'delayed_deposit', count: 8 }, { type: 'failed_deposit', count: 5 }], total: 18 },
});

const renderScreen = () => render(<MemoryRouter><SettlementsScreen /></MemoryRouter>);
beforeEach(() => { mockOverview.mockReset(); mockAddNote.mockReset(); mockExportCsv.mockReset(); mockExportXlsx.mockReset(); mockCase.mockReset(); mockMatch.mockReset(); mockResolve.mockReset(); globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn(); });

describe('SettlementsScreen', () => {
  it('renders title, all 8 KPI cards, and the batches table', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Settlements & Deposits')).toBeInTheDocument());
    for (const l of ['Total Batches', 'Gross Settlements', 'Net Deposits', 'Pending Deposits', 'Reconciliation Differences', 'Processing Fees', 'Chargeback Impact', 'Funding Exceptions'])
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getByText('Settlement Batches (487)')).toBeInTheDocument();
    expect(screen.getAllByText('BCH-2026-0506-001').length).toBeGreaterThan(0);
  });

  it('masks funding accounts and never shows a full account number', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('•••• 7890').length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toMatch(/\b\d{8,}\b/); // no long bare account numbers anywhere
  });

  it('selecting a row highlights it and loads Selected Batch Details', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('BCH-2026-0506-001').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('BCH-2026-0506-001')[0]);
    await waitFor(() => expect(mockOverview).toHaveBeenCalledWith(expect.objectContaining({ selectedId: 'id-1' })));
  });

  it('renders all eight Super Admin Actions and the lower modules', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Super Admin Actions')).toBeInTheDocument());
    for (const a of ['Review Daily Batches', 'Match Deposits to Transactions', 'Identify Missing Deposits', 'Identify Settlement Discrepancies', 'Export Settlement Reports', 'Open a Processor-Support Case', 'Mark Discrepancies as Resolved', 'Add Internal Reconciliation Notes'])
      expect(screen.getAllByText(a).length).toBeGreaterThan(0);
    for (const m of ['Settlement Trend', 'Deposit Status', 'Reconciliation Differences', 'Daily Funding Overview', 'Recent Settlement Activity', 'Funding Exceptions'])
      expect(screen.getAllByText(m).length).toBeGreaterThan(0);
  });

  it('adds a reconciliation note through the real endpoint (append-only)', async () => {
    mockOverview.mockImplementation((q: any) => Promise.resolve(q?.selectedId ? { ...overview(), selectedBatch: { ...row(), notes: [] } } : overview()));
    mockAddNote.mockResolvedValue({ ok: true });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('BCH-2026-0506-001').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('BCH-2026-0506-001')[0]);
    await waitFor(() => expect(mockOverview).toHaveBeenCalledWith(expect.objectContaining({ selectedId: 'id-1' })));
    fireEvent.click(screen.getByText('+ Add Note'));
    await waitFor(() => expect(screen.getByLabelText('Note text')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'Fee timing confirmed.' } });
    fireEvent.click(screen.getByText('Save Note'));
    await waitFor(() => expect(mockAddNote).toHaveBeenCalledWith('id-1', expect.objectContaining({ body: 'Fee timing confirmed.' })));
  });

  it('exports the current view via the real export endpoint', async () => {
    mockOverview.mockResolvedValue(overview());
    mockExportCsv.mockResolvedValue(new Blob(['x'], { type: 'text/csv' }));
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Export Settlement Reports').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Export Settlement Reports')[0]);
    await waitFor(() => expect(mockExportCsv).toHaveBeenCalledTimes(1));
  });

  it('Add Note without a selection prompts to select a batch', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('+ Add Note')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ Add Note'));
    await waitFor(() => expect(screen.getByText(/Select a batch first/)).toBeInTheDocument());
  });

  it('records a deposit match through the real endpoint (original amounts preserved server-side)', async () => {
    mockOverview.mockImplementation((q: any) => Promise.resolve(q?.selectedId ? { ...overview(), selectedBatch: { ...row(), notes: [] } } : overview()));
    mockMatch.mockResolvedValue({ ok: true, idempotent: false, differenceCents: 0, reconciliationStatus: 'reconciled' });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('BCH-2026-0506-001').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('BCH-2026-0506-001')[0]);
    await waitFor(() => expect(mockOverview).toHaveBeenCalledWith(expect.objectContaining({ selectedId: 'id-1' })));
    fireEvent.click(screen.getByText('Match Deposits to Transactions'));
    await waitFor(() => expect(screen.getByLabelText('Actual deposit amount')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Actual deposit amount'), { target: { value: '24979.80' } });
    fireEvent.click(screen.getByText('Record Match'));
    await waitFor(() => expect(mockMatch).toHaveBeenCalledWith('id-1', expect.objectContaining({ actualCents: 2497980 })));
  });

  it('resolves a discrepancy with a required reason through the real endpoint', async () => {
    mockOverview.mockImplementation((q: any) => Promise.resolve(q?.selectedId ? { ...overview(), selectedBatch: { ...row({ reconciliationStatus: 'in_review', differenceCents: 13245 }), notes: [] } } : overview()));
    mockResolve.mockResolvedValue({ ok: true });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('BCH-2026-0506-001').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('BCH-2026-0506-001')[0]);
    await waitFor(() => expect(mockOverview).toHaveBeenCalledWith(expect.objectContaining({ selectedId: 'id-1' })));
    fireEvent.click(screen.getByText('Mark Discrepancies as Resolved'));
    await waitFor(() => expect(screen.getByLabelText('Resolution reason')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Resolution reason'), { target: { value: 'Processor confirmed fee timing.' } });
    fireEvent.click(screen.getByText('Mark Resolved'));
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('id-1', expect.objectContaining({ reason: 'Processor confirmed fee timing.' })));
  });

});
