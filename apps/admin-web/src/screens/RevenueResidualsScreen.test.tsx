import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


vi.mock('../api/superAdminRevenueResidualsApi', () => {
  const AGR = {
    id: 'a1', code: 'AGR-2026-0010', name: 'Hair Lounge Residual', tenantId: 't1', tenantName: 'The Hair Lounge', branchId: 'b1', branchName: 'City Center',
    processor: 'Fiserv', revenueSource: 'Processing Residual', status: 'pending', aiPct: 60, processorPct: 15, salonPct: 25, effectiveDate: 'May 01, 2026',
    monthlyRecurringRevenueCents: 0, addOnRevenueCents: 0, processingResidualsCents: 1523045, refundsCreditsCents: 18520, netRevenueCents: 895307, outstandingBalanceCents: 231000, forecastedRevenueCents: 1486000,
  };
  return {
  fetchRevenueOverview: vi.fn().mockResolvedValue({
    available: true, generatedAt: '2026-05-06T00:00:00Z',
    kpis: { subscriptionRevenueCents: 124857000, processingResidualsCents: 87643200, monthlyRecurringRevenueCents: 212500200, addOnRevenueCents: 43891000, refundsCreditsCents: 5421700, outstandingBalancesCents: 36874400, forecastedRevenueCents: 320488000, partnerPayoutsDueCents: 41823000 },
    revenueByProcessor: { totalCents: 256391200, slices: [{ processor: 'Fiserv', amountCents: 135678000, pct: 52.9 }, { processor: 'CardPointe', amountCents: 82341000, pct: 32.1 }] },
    revenueSplitBreakdown: { totalCents: 256391200, aiCents: 145410200, processorCents: 38458700, salonCents: 72522300, aiPct: 56.7, processorPct: 15, salonPct: 28.3 },
    revenueTrend: [{ date: 'Apr 7', grossCents: 62000000, netCents: 33000000 }, { date: 'May 5', grossCents: 94000000, netCents: 62000000 }],
    recentActivity: [{ at: 'May 06, 2026', action: 'Residual Calculated', agreementCode: 'AGR-2026-0010', tenantId: 'The Hair Lounge', amount: '895307', reason: 'Pending' }],
    outstandingBalances: [{ tenantId: 'The Hair Lounge', amountCents: 231000, ageDays: 14, lastActivity: 'May 06, 2026' }],
    forecastSummary: { grossCents: 320488000, netCents: 245721000, aiCents: 139650000, processorCents: 36955000, salonCents: 69116000 },
    selectedAgreement: AGR,
  }),
  listRevenueRecords: vi.fn().mockResolvedValue({
    page: 1, pageSize: 8, total: 124, available: true,
    rows: [{ id: 'AGR-2026-0010', agreementCode: 'AGR-2026-0010', agreementId: 'a1', tenantId: 't1', tenantName: 'The Hair Lounge', branchId: 'b1', branchName: 'City Center', processor: 'Fiserv', revenueSource: 'Processing Residual', grossRevenueCents: 1523045, aiPct: 60, processorPct: 15, salonPct: 25, aiShareCents: 913827, processorShareCents: 228457, salonIncentiveShareCents: 380761, refundsCreditsCents: 18520, netRevenueCents: 895307, effectiveDate: 'May 01, 2026', status: 'pending' }],
  }),
  fetchRevenueAgreement: vi.fn().mockResolvedValue({ available: true, agreement: AGR }),
  createRevenueAgreement: vi.fn().mockResolvedValue({ ok: true, id: 'a2', code: 'AGR-2026-0013', versionId: 'v2' }),
  addAgreementVersion: vi.fn().mockResolvedValue({ ok: true, versionId: 'v3', versionNumber: 2 }),
  listRevenueAgreements: vi.fn().mockResolvedValue({ available: true, agreements: [{ id: 'a1', code: 'AGR-2026-0010', name: 'Hair Lounge Residual', tenantId: 't1', tenantName: 'The Hair Lounge', branchId: 'b1', processor: 'Fiserv', revenueSource: 'processing_residual', status: 'active', aiPct: 60, processorPct: 15, salonPct: 25, effectiveDate: '2026-05-01', expirationDate: null, versionNumber: 1 }] }),
  listAgreementVersions: vi.fn().mockResolvedValue({ available: true, versions: [] }),
  calculatePartnerPayout: vi.fn().mockResolvedValue({ ok: true, duplicate: false, payoutId: 'p1', processor: 'Fiserv', eligibleRevenueCents: 2523045, partnerPct: 15, partnerGrossShareCents: 378457, refundAllocationCents: 0, adjustmentAllocationCents: 0, priorBalanceCents: 0, amountDueCents: 378457, status: 'calculated' }),
  approvePartnerPayout: vi.fn().mockResolvedValue({ ok: true, status: 'approved' }),
  listPartnerPayouts: vi.fn().mockResolvedValue({ available: true, payouts: [] }),
  calculateTenantIncentive: vi.fn().mockResolvedValue({ ok: true, duplicate: false, incentiveId: 'i1', eligibleGrossRevenueCents: 2523045, salonPct: 25, incentiveEarnedCents: 630761, refundAllocationCents: 0, adjustmentAllocationCents: 0, priorUnpaidBalanceCents: 0, currentAmountDueCents: 630761, status: 'calculated' }),
  approveTenantIncentive: vi.fn().mockResolvedValue({ ok: true, status: 'approved' }),
  listTenantIncentives: vi.fn().mockResolvedValue({ available: true, incentives: [] }),
  exportPayoutReports: vi.fn().mockResolvedValue({ filename: 'revenue-records-2026-05-06.csv', rowCount: 8 }),
  listRevenueAdjustments: vi.fn().mockResolvedValue({ available: true, adjustments: [] }),
  createRevenueAdjustment: vi.fn().mockResolvedValue({ ok: true, adjustmentId: 'adj1', ref: 'ADJ-2026-0001', requiresDualApproval: false, status: 'pending_approval' }),
  approveRevenueAdjustment: vi.fn().mockResolvedValue({ ok: true, status: 'applied', ledgerRecordId: 'led1' }),
  rejectRevenueAdjustment: vi.fn().mockResolvedValue({ ok: true, status: 'rejected' }),
  reverseRevenueAdjustment: vi.fn().mockResolvedValue({ ok: true, status: 'reversed', reversalLedgerId: 'ledREV1' }),
  listAccountingPeriods: vi.fn().mockResolvedValue({ available: true, periods: [{ id: 'p1', name: '2026-04', startDate: '2026-04-01', endDate: '2026-04-30', currency: 'USD', status: 'open', lockedAt: null, lockReason: null, reopenedAt: null, reopenReason: null }] }),
  createAccountingPeriod: vi.fn().mockResolvedValue({ ok: true, periodId: 'p2', status: 'open' }),
  lockAccountingPeriod: vi.fn().mockResolvedValue({ ok: true, status: 'locked', readiness: { unreviewedStatements: 0, openVariances: 0, pendingAdjustments: 0 } }),
  reopenAccountingPeriod: vi.fn().mockResolvedValue({ ok: true, status: 'reopened' }),
  getUnpaidResiduals: vi.fn().mockResolvedValue({ available: true, rows: [{ tenantId: 't1', tenantName: 'The Hair Lounge', processor: 'Fiserv', agreementCount: 1, outstandingCents: 800000, currentCents: 0, b31_60Cents: 0, b61_90Cents: 500000, b90PlusCents: 300000, oldestAgeDays: 100 }], totals: { outstandingCents: 800000, currentCents: 0, b31_60Cents: 0, b61_90Cents: 500000, b90PlusCents: 300000 } }),
  getRevenueForecast: vi.fn().mockResolvedValue({ available: true, methodology: 'least-squares linear trend', history: [{ month: '2026-03', grossCents: 1500000, netCents: 1000000 }, { month: '2026-04', grossCents: 1700000, netCents: 1200000 }, { month: '2026-05', grossCents: 1900000, netCents: 1400000 }], projection: [{ month: '2026-06', projectedNetCents: 1600000, lowCents: 1500000, highCents: 1700000 }, { month: '2026-07', projectedNetCents: 1800000, lowCents: 1650000, highCents: 1950000 }, { month: '2026-08', projectedNetCents: 2000000, lowCents: 1800000, highCents: 2200000 }], nextPeriod: { month: '2026-06', projectedNetCents: 1600000, lowCents: 1500000, highCents: 1700000 }, monthlyGrowthPct: 20, byProcessor: [{ processor: 'Fiserv', sharePct: 100, projectedNetCents: 1600000 }] }),
  enqueueExportJob: vi.fn().mockResolvedValue({ ok: true, jobId: 'job1', jobStatus: 'queued' }),
  listExportJobs: vi.fn().mockResolvedValue({ available: true, jobs: [{ id: 'job1', dataset: 'records', format: 'csv', status: 'completed', rowCount: 1337, filename: 'revenue-records-2026-07-01.csv', error: null, createdAt: '2026-07-01T10:00:00', completedAt: '2026-07-01T10:00:01' }] }),
  getExportJob: vi.fn().mockResolvedValue({ available: true, job: { id: 'job1', dataset: 'records', format: 'csv', status: 'completed', rowCount: 1337, filename: 'revenue-records-2026-07-01.csv', mime: 'text/csv', encoding: 'utf8', content: '"Agreement"\r\n"AGR-1"', error: null, createdAt: '2026-07-01T10:00:00', completedAt: '2026-07-01T10:00:01' } }),
  downloadExportJobResult: vi.fn(),
  fetchExpenseCategories: vi.fn().mockResolvedValue({ categories: [
    { key: 'interchange', label: 'Interchange', eligibleByDefault: true, note: 'Paid through to the issuing bank; the classic Schedule A pass-through.' },
    { key: 'fines_penalties', label: 'Fines & penalties', eligibleByDefault: false, note: 'Network fines are rarely a permitted deduction from a residual pool.' },
  ] }),
  listResidualStatements: vi.fn().mockResolvedValue({ available: true, statements: [{ id: 's1-abcdef', processor: 'Fiserv', statementRef: 'STMT-2026-05-FSV', merchantAccount: 'MA1', tenantId: 't1', tenantName: 'The Hair Lounge', periodStart: '2026-05-01', periodEnd: '2026-05-31', processingResidualCents: 1523045, processorCalculatedCents: 1523045, importStatus: 'imported', reviewStatus: 'pending', unmatchedLines: 1, createdAt: '2026-05-06' }] }),
  importResidualStatement: vi.fn().mockResolvedValue({ ok: true, imported: true, duplicate: false, statementId: 's2-abcdef', linesImported: 2, unmatchedLines: 1 }),
  reviewResidualStatement: vi.fn().mockResolvedValue({ ok: true, reviewStatus: 'reviewed' }),
  reconcileStatement: vi.fn().mockResolvedValue({ ok: true, reconciliationId: 'rc1', status: 'matched', differenceCents: 0, differenceType: 'match', expectedAmountCents: 1523045, actualAmountCents: 1523045, expected: { ai: 913827, processor: 228457, salon: 380761 } }),
  listReconciliations: vi.fn().mockResolvedValue({ available: true, reconciliations: [] }),
  fetchResidualStatement: vi.fn().mockResolvedValue({ available: true, statement: null }),
  };
});

import { RevenueResidualsScreen } from './RevenueResidualsScreen';
const renderScreen = () => render(<MemoryRouter><RevenueResidualsScreen /></MemoryRouter>);

describe('RevenueResidualsScreen', () => {
  it('renders title, subtitle, and primary actions', () => {
    renderScreen();
    expect(screen.getByText('Revenue & Residuals')).toBeInTheDocument();
    expect(screen.getByText(/money earned by AI PowerSalon/i)).toBeInTheDocument();
    expect(screen.getByText(/Add Revenue Rule/)).toBeInTheDocument();
    expect(screen.getAllByText(/Export Payout Reports/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders all 8 KPI labels and loads real values', async () => {
    renderScreen();
    for (const l of ['Subscription Revenue', 'Processing Residuals', 'Monthly Recurring Revenue', 'Add-On Revenue', 'Refunds & Credits', 'Outstanding Balances', 'Forecasted Revenue', 'Partner Payouts Due']) {
      expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1);
    }
    await waitFor(() => expect(screen.getByText('$1,248,570')).toBeInTheDocument());
  });

  it('renders the filter controls (search + 6 selects + date range + reset/apply)', () => {
    renderScreen();
    expect(screen.getByPlaceholderText('Search agreements, tenants...')).toBeInTheDocument();
    for (const l of ['Agreement', 'Tenant', 'Branch', 'Processor', 'Revenue Type', 'Status', 'Date Range']) expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Reset Filters')).toBeInTheDocument();
    expect(screen.getByText(/Apply Filters/)).toBeInTheDocument();
  });

  // SCAN (Oct 12): the search box had onChange={() => {}}, the six selects and the date field were uncontrolled with
  // no effect, Apply re-fetched page 1 unfiltered, and the "›" pager button had no handler — every control a lie.
  it('the filter bar and pager drive the records query (search, status, processor, dates, next page, reset)', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    const list = vi.mocked(api.listRevenueRecords); list.mockClear();
    renderScreen();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('Search agreements, tenants...'), { target: { value: 'Lounge' } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Lounge', page: 1 })));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paid' } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Lounge', status: 'paid', page: 1 })));
    fireEvent.change(screen.getByLabelText('Processor'), { target: { value: 'Fiserv' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-04-01' } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ processor: 'Fiserv', startDate: '2026-04-01' })));
    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.click(screen.getByText('Reset Filters'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize: 8 }));
  });

  it('loads records into the table and shows the count', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Revenue & Residual Records (124)')).toBeInTheDocument());
    expect(screen.getAllByText('AGR-2026-0010').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Agreement Details with the three-way split and the configurable notice', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Agreement Details')).toBeInTheDocument());
    expect(screen.getByText('AI PowerSalon %')).toBeInTheDocument();
    expect(screen.getByText('Participating Salon %')).toBeInTheDocument();
    expect(screen.getByText(/three-way split is configurable by agreement and effective date/i)).toBeInTheDocument();
  });

  it('renders all 9 Super Admin Actions', () => {
    renderScreen();
    for (const a of ['Configure Revenue-Sharing Rules', 'Review Residual Statements', 'Reconcile Processor Reports', 'Calculate Partner Payouts', 'Calculate Tenant Incentives', 'Track Unpaid Residuals', 'Approve Revenue Adjustments', 'Lock Finalized Accounting Periods']) {
      expect(screen.getByText(a)).toBeInTheDocument();
    }
  });

  it('renders the charts + lower panels', () => {
    renderScreen();
    expect(screen.getByText('Revenue Trend')).toBeInTheDocument();
    expect(screen.getByText('Revenue by Processor')).toBeInTheDocument();
    expect(screen.getByText('Revenue Split Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Three-Way Split Example')).toBeInTheDocument();
    expect(screen.getByText('Recent Residual Activity')).toBeInTheDocument();
    expect(screen.getAllByText('Outstanding Balances').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Forecast Summary/)).toBeInTheDocument();
  });

  it('opens the Add Revenue Rule modal with the three-way split form', async () => {
    renderScreen();
    fireEvent.click(screen.getByText('+ Add Revenue Rule'));
    const dialog = await screen.findByRole('dialog', { name: 'Add Revenue Rule' });
    expect(within(dialog).getByText('Agreement Name')).toBeInTheDocument();
    expect(within(dialog).getByText('AI PowerSalon %')).toBeInTheDocument();
    expect(within(dialog).getByText(/total 100% ✓/)).toBeInTheDocument();
    expect(within(dialog).getByText('Create Agreement')).toBeInTheDocument();
  });

  it('disables Create while the split does not total 100', async () => {
    renderScreen();
    fireEvent.click(screen.getByText('+ Add Revenue Rule'));
    const dialog = await screen.findByRole('dialog', { name: 'Add Revenue Rule' });
    const create = within(dialog).getByText('Create Agreement') as HTMLButtonElement;
    expect(create).not.toBeDisabled();
    const aiInput = within(dialog).getByDisplayValue('60') as HTMLInputElement;
    fireEvent.change(aiInput, { target: { value: '50' } }); // 50+15+25 = 90
    expect(within(dialog).getByText(/must equal 100/)).toBeInTheDocument();
    expect(create).toBeDisabled();
  });

  it('submits a valid agreement and calls the create API', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText('+ Add Revenue Rule'));
    const dialog = await screen.findByRole('dialog', { name: 'Add Revenue Rule' });
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Hair Lounge Residual'), { target: { value: 'New Rule' } });
    const effective = dialog.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(effective, { target: { value: '2026-06-01' } });
    fireEvent.click(within(dialog).getByText('Create Agreement'));
    await waitFor(() => expect(api.createRevenueAgreement).toHaveBeenCalled());
  });

  it('opens Review Residual Statements from the actions row and lists statements', async () => {
    renderScreen();
    fireEvent.click(screen.getByText('Review Residual Statements'));
    const dialog = await screen.findByRole('dialog', { name: 'Review Residual Statements' });
    expect(within(dialog).getByText('Import Statement')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText('STMT-2026-05-FSV')).toBeInTheDocument());
  });

  it('imports a residual statement through the modal', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText('Review Residual Statements'));
    const dialog = await screen.findByRole('dialog', { name: 'Review Residual Statements' });
    fireEvent.click(within(dialog).getByText('Import Statement'));
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. STMT-2026-05-Fiserv'), { target: { value: 'STMT-X' } });
    const dateAt = (i: number) => dialog.querySelectorAll('input[type="date"]')[i] as HTMLInputElement;
    fireEvent.change(dateAt(0), { target: { value: '2026-05-01' } });
    fireEvent.change(dateAt(1), { target: { value: '2026-05-31' } });
    const btns = within(dialog).getAllByRole('button');
    fireEvent.click(btns[btns.length - 1]); // footer submit
    await waitFor(() => expect(api.importResidualStatement).toHaveBeenCalled());
  });

  it('reconciles a statement from the statements list', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText('Reconcile Processor Reports'));
    const dialog = await screen.findByRole('dialog', { name: 'Review Residual Statements' });
    await waitFor(() => expect(within(dialog).getByText('STMT-2026-05-FSV')).toBeInTheDocument());
    fireEvent.click(within(dialog).getByText('Reconcile'));
    await waitFor(() => expect(api.reconcileStatement).toHaveBeenCalled());
    expect(await within(dialog).findByText(/Reconciled — header residual matches/i)).toBeInTheDocument();
  });

  it('calculates a partner payout from the payouts modal', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText('Calculate Partner Payouts'));
    const dialog = await screen.findByRole('dialog', { name: 'Calculate Partner Payouts' });
    await waitFor(() => expect(within(dialog).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'a1' } });
    const dateAt = (i: number) => dialog.querySelectorAll('input[type="date"]')[i] as HTMLInputElement;
    fireEvent.change(dateAt(0), { target: { value: '2026-05-01' } });
    fireEvent.change(dateAt(1), { target: { value: '2026-05-31' } });
    fireEvent.click(within(dialog).getByText('Calculate'));
    await waitFor(() => expect(api.calculatePartnerPayout).toHaveBeenCalled());
    expect(await within(dialog).findByText(/eligible .* → gross .* due/i)).toBeInTheDocument();
  });

  it('calculates a tenant incentive (agreement prefills the tenant scope)', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText('Calculate Tenant Incentives'));
    const dialog = await screen.findByRole('dialog', { name: 'Calculate Tenant Incentives' });
    await waitFor(() => expect(within(dialog).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'a1' } });
    expect((within(dialog).getByPlaceholderText('participating salon') as HTMLInputElement).value).toBe('t1'); // prefilled from agreement
    const dateAt = (i: number) => dialog.querySelectorAll('input[type="date"]')[i] as HTMLInputElement;
    fireEvent.change(dateAt(0), { target: { value: '2026-05-01' } });
    fireEvent.change(dateAt(1), { target: { value: '2026-05-31' } });
    fireEvent.click(within(dialog).getByText('Calculate'));
    await waitFor(() => expect(api.calculateTenantIncentive).toHaveBeenCalled());
    expect(await within(dialog).findByText(/earned .* → due/i)).toBeInTheDocument();
  });

  it('exports payout reports from the header button (filter-aware, audited CSV)', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getAllByText(/Export Payout Reports/)[0]);
    await waitFor(() => expect(api.exportPayoutReports).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'records' })));
    expect(await screen.findByText(/Exported 8 records row\(s\)/i)).toBeInTheDocument();
  });

  it('exports in the selected format (XLSX)', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    (api.exportPayoutReports as any).mockResolvedValueOnce({ filename: 'revenue-records-2026-05-06.xlsx', rowCount: 8 });
    renderScreen();
    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: 'xlsx' } });
    fireEvent.click(screen.getAllByText(/Export Payout Reports/)[0]);
    await waitFor(() => expect(api.exportPayoutReports).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'records', format: 'xlsx' })));
  });

  it('creates a revenue adjustment (originals preserved, separate ledger entry on approval)', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText('Approve Revenue Adjustments'));
    const dialog = await screen.findByRole('dialog', { name: 'Approve Revenue Adjustments' });
    expect(within(dialog).getByText(/never edit original records/i)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByPlaceholderText('required'), { target: { value: 'Overstated refund' } });
    const amount = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '-50' } });
    fireEvent.click(within(dialog).getByText('Create'));
    await waitFor(() => expect(api.createRevenueAdjustment).toHaveBeenCalled());
    expect(await within(dialog).findByText(/ADJ-2026-0001 created/i)).toBeInTheDocument();
  });

  it('reverses an applied adjustment (compensating ledger entry)', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    (api.listRevenueAdjustments as any).mockResolvedValueOnce({ available: true, adjustments: [{ id: 'adjA', adjustmentRef: 'ADJ-2026-0009', agreementId: 'a1', agreementCode: 'AGR-2026-0010', revenueRecordId: null, tenantId: 't1', tenantName: 'The Hair Lounge', processor: 'Fiserv', adjustmentType: 'refund_correction', amountCents: -5000, direction: 'decrease', reason: 'Overstated', requiresDualApproval: false, status: 'applied', ledgerRecordId: 'led1', createdAt: '2026-07-01' }] });
    renderScreen();
    fireEvent.click(screen.getByText('Approve Revenue Adjustments'));
    const dialog = await screen.findByRole('dialog', { name: 'Approve Revenue Adjustments' });
    fireEvent.click(await within(dialog).findByText('Reverse'));
    await waitFor(() => expect(api.reverseRevenueAdjustment).toHaveBeenCalledWith('adjA', expect.any(String)));
    expect(await within(dialog).findByText(/compensating ledger entry/i)).toBeInTheDocument();
  });

  it('creates and locks an accounting period (locked periods become immutable)', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText('Lock Finalized Accounting Periods'));
    const dialog = await screen.findByRole('dialog', { name: 'Lock Finalized Accounting Periods' });
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. 2026-05'), { target: { value: '2026-05' } });
    const dateAt = (i: number) => dialog.querySelectorAll('input[type="date"]')[i] as HTMLInputElement;
    fireEvent.change(dateAt(0), { target: { value: '2026-05-01' } });
    fireEvent.change(dateAt(1), { target: { value: '2026-05-31' } });
    fireEvent.click(within(dialog).getByText('Create Period'));
    await waitFor(() => expect(api.createAccountingPeriod).toHaveBeenCalled());
    // lock the existing open period
    fireEvent.click(within(dialog).getByText('Lock'));
    await waitFor(() => expect(api.lockAccountingPeriod).toHaveBeenCalledWith('p1', expect.any(String)));
    expect(await within(dialog).findByText(/Period locked/i)).toBeInTheDocument();
  });

  it('shows the unpaid-residuals aging view with buckets and totals', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText('Track Unpaid Residuals'));
    const dialog = await screen.findByRole('dialog', { name: 'Track Unpaid Residuals' });
    await waitFor(() => expect(api.getUnpaidResiduals).toHaveBeenCalled());
    expect(await within(dialog).findByText('The Hair Lounge')).toBeInTheDocument();
    expect(within(dialog).getByText('100d')).toBeInTheDocument(); // oldest age
    expect(within(dialog).getAllByText(/\$8,000\.00|\$8000\.00/).length).toBeGreaterThan(0); // total outstanding
  });

  it('opens the revenue forecast detail with projection + per-processor split', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    await screen.findByText('⛅ Forecast Summary');
    fireEvent.click(screen.getByText('View Forecast Details'));
    const dialog = await screen.findByRole('dialog', { name: 'Revenue Forecast' });
    await waitFor(() => expect(api.getRevenueForecast).toHaveBeenCalled());
    expect(await within(dialog).findByText(/NEXT PERIOD \(/i)).toBeInTheDocument();
    expect(within(dialog).getByText('+20%')).toBeInTheDocument(); // monthly trend
    expect(within(dialog).getByText(/Projected next period by processor/i)).toBeInTheDocument();
  });

  it('queues a background export and downloads the completed job', async () => {
    const api = await import('../api/superAdminRevenueResidualsApi');
    renderScreen();
    fireEvent.click(screen.getByText(/⧗ Background/));
    await waitFor(() => expect(api.enqueueExportJob).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'records', format: 'csv' })));
    const dialog = await screen.findByRole('dialog', { name: 'Background Export Jobs' });
    await waitFor(() => expect(api.listExportJobs).toHaveBeenCalled());
    expect(await within(dialog).findByText('1337')).toBeInTheDocument(); // row count of the completed job
    fireEvent.click(within(dialog).getByText('Download'));
    await waitFor(() => expect(api.getExportJob).toHaveBeenCalledWith('job1'));
    await waitFor(() => expect(api.downloadExportJobResult).toHaveBeenCalled());
  });
});
