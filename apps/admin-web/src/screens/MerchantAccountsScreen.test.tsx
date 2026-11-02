import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockConfigureRates, mockActivate, mockDeactivate, mockUpdateFunding, mockAssignMid, mockAssignTerminal, mockExport } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockConfigureRates: vi.fn(), mockActivate: vi.fn(), mockDeactivate: vi.fn(), mockUpdateFunding: vi.fn(), mockAssignMid: vi.fn(), mockAssignTerminal: vi.fn(), mockExport: vi.fn() }));
vi.mock('../api/superAdminMerchantAccountsApi', () => ({ superAdminMerchantAccountsApi: { overview: (q: any) => mockOverview(q), list: (q: any) => mockOverview(q), exportReport: (q: any) => mockExport(q), configureRates: (t: string, b: any) => mockConfigureRates(t, b), activate: (t: string, r: string) => mockActivate(t, r), deactivate: (t: string, r: string) => mockDeactivate(t, r), updateFunding: (t: string, b: any) => mockUpdateFunding(t, b), assignMid: (t: string, b: any) => mockAssignMid(t, b), assignTerminal: (t: string, b: any) => mockAssignTerminal(t, b) } }));

import MerchantAccountsScreen from './MerchantAccountsScreen';

const kpi = (key: string, label: string, value: number, available = true) => ({ key, label, value, display: available ? String(value) : '—', available, href: available ? '/merchant-accounts' : null, semantic: 'neutral' });
const row = (over: Partial<any> = {}) => ({
  tenantId: 't1', merchantId: 'MID-202605-001', processor: 'fiserv', processorLabel: 'Fiserv', tenant: 'Glamour Studio', branch: 'Downtown',
  legalBusinessName: 'Glamour Studio LLC', processingStatus: 'active', processingStatusLabel: 'Active', processingSemantic: 'good',
  underwritingStatus: 'approved', underwritingStatusLabel: 'Approved', underwritingSemantic: 'good',
  bankVerification: 'not_started', bankVerificationLabel: 'Not Started', bankVerificationSemantic: 'neutral', bankVerificationAvailable: false,
  pricingPlan: '—', pricingPlanAvailable: false, processingRates: '—', processingRatesAvailable: false,
  terminalAssignments: 2, applicationStatus: 'approved', applicationStatusLabel: 'Approved',
  riskStatus: 'unknown', riskStatusLabel: '—', riskStatusAvailable: false,
  fundingSchedule: 'not_configured', fundingScheduleLabel: '—', fundingScheduleAvailable: false, environment: 'production', ...over,
});
const overview = (over: Partial<any> = {}) => ({
  ok: true, metadata: { generatedAt: new Date().toISOString() }, scope: { tenantId: null, label: 'All tenants' },
  kpis: [kpi('total', 'Total Merchant Accounts', 3), kpi('active', 'Active Processing Accounts', 1), kpi('pending_underwriting', 'Pending Underwriting', 2), kpi('bank_verification_pending', 'Bank Verification Pending', 0, false), kpi('high_risk', 'High Risk Accounts', 0, false), kpi('assigned_terminals', 'Assigned Terminals', 3), kpi('funding_issues', 'Funding Issues', 0, false), kpi('inactive', 'Inactive Accounts', 1)],
  merchants: [row(), row({ tenantId: 't2', merchantId: 'MID-202605-002', processor: 'cardpointe', processorLabel: 'CardPointe', tenant: 'Luxe Salon', processingStatusLabel: 'Pending', processingSemantic: 'warn' })],
  merchantsTotal: 3,
  selectedMerchant: null,
  processorDistribution: { total: 3, segments: [{ key: 'fiserv', label: 'Fiserv', count: 1, pct: 33.3 }, { key: 'cardpointe', label: 'CardPointe', count: 1, pct: 33.3 }, { key: 'clover', label: 'Clover', count: 1, pct: 33.3 }] },
  underwritingPipeline: { stages: [{ key: 'submitted', label: 'Applications Submitted', count: 3 }, { key: 'under_review', label: 'In Review', count: 1 }, { key: 'approved', label: 'Approved', count: 1 }, { key: 'declined', label: 'Declined', count: 0 }] },
  merchantStatusBreakdown: { total: 3, segments: [{ key: 'active', label: 'Active', count: 1, pct: 33.3 }, { key: 'pending', label: 'Pending', count: 1, pct: 33.3 }, { key: 'inactive', label: 'Inactive', count: 1, pct: 33.3 }] },
  terminalAssignmentOverview: { total: 3, segments: [{ key: 'assigned', label: 'Assigned', count: 2, pct: 66.7 }, { key: 'unassigned', label: 'Unassigned', count: 1, pct: 33.3 }] },
  recentActivity: [], alerts: { available: false, total: 0, items: [] }, topFundingIssues: { available: false, items: [] }, highRiskAccounts: { available: false, total: 0, items: [] }, ...over,
});
const renderScreen = (path = '/merchant-accounts') => render(<MemoryRouter initialEntries={[path]}><MerchantAccountsScreen /></MemoryRouter>);
beforeEach(() => { mockOverview.mockReset(); mockConfigureRates.mockReset(); mockActivate.mockReset(); mockDeactivate.mockReset(); mockUpdateFunding.mockReset(); mockAssignMid.mockReset(); mockAssignTerminal.mockReset(); mockExport.mockReset(); });

describe('MerchantAccountsScreen', () => {
  it('renders header, 8 KPIs (with honest unavailable), and the directory', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Merchant Accounts' })).toBeInTheDocument());
    expect(screen.getByText('Total Merchant Accounts')).toBeInTheDocument();
    expect(screen.getAllByText('High Risk Accounts').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not yet provisioned').length).toBeGreaterThanOrEqual(3); // bank verif / high risk / funding issues
    expect(screen.getByText('MID-202605-001')).toBeInTheDocument();
    expect(screen.getByText('3 Merchant Accounts')).toBeInTheDocument();
  });

  it('surfaces only Fiserv/CardPointe/Clover as processor filter options (no Stripe/Square)', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Processor')).toBeInTheDocument());
    const proc = screen.getByLabelText('Processor') as HTMLSelectElement;
    const opts = within(proc).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['All Processors', 'Fiserv', 'CardPointe', 'Clover']);
    expect(opts.join()).not.toMatch(/stripe|square|adyen/i);
  });

  it('selecting a row highlights it and opens details with masked secure funding', async () => {
    mockOverview.mockResolvedValueOnce(overview());
    mockOverview.mockResolvedValue(overview({ selectedMerchant: { ...row({ bankVerificationLabel: 'Verified', bankVerificationSemantic: 'good', bankVerificationAvailable: true, fundingScheduleLabel: 'Next Day', fundingScheduleAvailable: true }), funding: { available: true, bankAccount: '•••• 4342', bankName: 'Chase Bank', accountType: 'Checking', bankVerificationLabel: 'Verified', note: 'Bank details are encrypted and stored securely.' } } }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MID-202605-001'));
    await waitFor(() => expect(screen.getByText('Secure Funding Information')).toBeInTheDocument());
    expect(screen.getByText('•••• 4342')).toBeInTheDocument();
    expect(screen.getByText('Chase Bank')).toBeInTheDocument();
    expect(screen.getByText('Bank details are encrypted and stored securely.')).toBeInTheDocument();
    expect(mockOverview).toHaveBeenLastCalledWith(expect.objectContaining({ selected: 't1' }));
  });

  it('renders Top Funding Issues when provisioned', async () => {
    mockOverview.mockResolvedValue(overview({ topFundingIssues: { available: true, total: 2, items: [
      { key: 'bank_verification_pending', label: 'Bank Verification Pending', count: 1, pct: 50 },
      { key: 'document_expired', label: 'Document Expired', count: 1, pct: 50 },
    ] } }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Document Expired')).toBeInTheDocument());
    expect(screen.getAllByText('Bank Verification Pending').length).toBeGreaterThanOrEqual(1);
  });

  it('renders all 11 Super Admin Actions and opens an informative workflow modal (no dead buttons)', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Super Admin Actions')).toBeInTheDocument());
    ['Start merchant onboarding', 'Assign an MID to a branch', 'Update funding information', 'Manage processor connections'].forEach((a) => expect(screen.getByText(a)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Review merchant documents'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Review merchant documents' })).toBeInTheDocument());
    expect(screen.getByText(/secure, permissioned, audited workflow/i)).toBeInTheDocument();
  });

  it('applies a processor filter through the query', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(mockOverview).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Processor'), { target: { value: 'clover' } });
    await waitFor(() => expect(mockOverview).toHaveBeenLastCalledWith(expect.objectContaining({ processor: 'clover' })));
  });

  it('renders the High Risk Accounts list when risk reviews are provisioned', async () => {
    mockOverview.mockResolvedValue(overview({ highRiskAccounts: { available: true, total: 2, items: [
      { merchantId: 'MID-202605-005', tenant: 'Radiant Beauty', riskStatus: 'high', riskLabel: 'High', reviewedAt: new Date(Date.now() - 86400000).toISOString() },
      { merchantId: 'MID-202605-009', tenant: 'Hair Haven', riskStatus: 'high', riskLabel: 'High', reviewedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    ] } }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-005')).toBeInTheDocument());
    expect(screen.getByText('Hair Haven')).toBeInTheDocument();
    // Sep 2026 redesign: the high-risk list shows merchant + tenant; the review age is no longer displayed
    expect(screen.queryByText('Risk reviews are not yet provisioned.')).not.toBeInTheDocument();
  });

  it('renders Merchant Account Alerts when provisioned', async () => {
    mockOverview.mockResolvedValue(overview({ alerts: { available: true, total: 2, items: [
      { id: 'a1', merchantId: 'MID-202605-002', tenant: 'Luxe Salon', alertType: 'underwriting_declined', severity: 'critical', severityLabel: 'Critical', severitySemantic: 'bad', summary: 'Underwriting declined — action required', status: 'investigating', reviewer: null, createdAt: new Date(Date.now() - 3600000).toISOString() },
      { id: 'a2', merchantId: 'MID-202605-001', tenant: 'Glamour Studio', alertType: 'risk_review', severity: 'warning', severityLabel: 'Warning', severitySemantic: 'warn', summary: 'High-risk flag requires review', status: 'open', reviewer: null, createdAt: new Date(Date.now() - 7200000).toISOString() },
    ] } }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Underwriting declined — action required')).toBeInTheDocument());
    expect(screen.getByText('High-risk flag requires review')).toBeInTheDocument();
    // Sep 2026 redesign: the count is a badge beside the heading
    expect(screen.getByText('Merchant Account Alerts').parentElement).toHaveTextContent(/Merchant Account Alerts\s*2/);
  });

  it('configures processing rates from the selected merchant (decimal-safe POST)', async () => {
    mockOverview.mockResolvedValueOnce(overview());
    mockOverview.mockResolvedValue(overview({ selectedMerchant: { ...row(), funding: { available: false, note: 'Bank details are encrypted and stored securely.' } } }));
    mockConfigureRates.mockResolvedValue({ ok: true, idempotent: false, scheduleId: 's1', before: { display: '2.60% + $0.30' }, after: { display: '2.49% + $0.15' }, effectiveAt: new Date().toISOString() });
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MID-202605-001'));
    await waitFor(() => expect(screen.getByText('Super Admin Actions')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Configure processing rates'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Configure Processing Rates' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Percentage rate'), { target: { value: '2.49' } });
    fireEvent.change(screen.getByLabelText('Per-transaction fee'), { target: { value: '0.15' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Renewal pricing' } });
    fireEvent.click(screen.getByText('Save rate schedule'));
    await waitFor(() => expect(mockConfigureRates).toHaveBeenCalledWith('t1', expect.objectContaining({ percentageBasisPoints: 249, perTxnFeeMinor: 15, changeReason: 'Renewal pricing' })));
    await waitFor(() => expect(screen.getByText('Rate schedule saved.')).toBeInTheDocument());
  });

  it('requires a change reason before submitting rates', async () => {
    mockOverview.mockResolvedValueOnce(overview());
    mockOverview.mockResolvedValue(overview({ selectedMerchant: { ...row(), funding: { available: false, note: 'x' } } }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MID-202605-001'));
    await waitFor(() => expect(screen.getByText('Configure processing rates')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Configure processing rates'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Configure Processing Rates' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Percentage rate'), { target: { value: '2.49' } });
    fireEvent.click(screen.getByText('Save rate schedule'));
    expect(screen.getByText('A change reason is required.')).toBeInTheDocument();
    expect(mockConfigureRates).not.toHaveBeenCalled();
  });

  it('shows the blocking checklist when activation is blocked', async () => {
    mockOverview.mockResolvedValueOnce(overview());
    mockOverview.mockResolvedValue(overview({ selectedMerchant: { ...row(), funding: { available: false, note: 'x' } } }));
    mockActivate.mockResolvedValue({ ok: false, blocked: true, action: 'activate', status: 'inactive', requirements: [
      { key: 'underwriting_approved', label: 'Underwriting approved', met: true },
      { key: 'bank_verified', label: 'Bank account verified', met: false },
      { key: 'pricing_configured', label: 'Processing rates configured', met: false },
    ], blockers: [{ key: 'bank_verified', label: 'Bank account verified', met: false }] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MID-202605-001'));
    await waitFor(() => expect(screen.getByText('Activate or deactivate processing')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Activate or deactivate processing'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Activate or Deactivate Processing' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Status reason'), { target: { value: 'go live' } });
    fireEvent.click(screen.getByText('Activate'));
    await waitFor(() => expect(mockActivate).toHaveBeenCalledWith('t1', 'go live'));
    await waitFor(() => expect(screen.getByText('Activation blocked — resolve these first:')).toBeInTheDocument());
    expect(screen.getByText('Bank account verified')).toBeInTheDocument();
  });

  it('deactivates processing with a required reason', async () => {
    mockOverview.mockResolvedValueOnce(overview());
    mockOverview.mockResolvedValue(overview({ selectedMerchant: { ...row(), funding: { available: false, note: 'x' } } }));
    mockDeactivate.mockResolvedValue({ ok: true, blocked: false, action: 'deactivate', status: 'inactive' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MID-202605-001'));
    await waitFor(() => expect(screen.getByText('Activate or deactivate processing')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Activate or deactivate processing'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Activate or Deactivate Processing' })).toBeInTheDocument());
    fireEvent.click(screen.getByText('Deactivate'));
    expect(screen.getByText('A reason is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status reason'), { target: { value: 'compliance hold' } });
    fireEvent.click(screen.getByText('Deactivate'));
    await waitFor(() => expect(mockDeactivate).toHaveBeenCalledWith('t1', 'compliance hold'));
    await waitFor(() => expect(screen.getByText(/Processing deactivated/)).toBeInTheDocument());
  });

  it('requires step-up before submitting a secure funding update, then shows masked result', async () => {
    mockOverview.mockResolvedValueOnce(overview());
    mockOverview.mockResolvedValue(overview({ selectedMerchant: { ...row(), funding: { available: true, bankAccount: '•••• 4342', bankName: 'Chase Bank', accountType: 'Checking', bankVerificationLabel: 'Verified', note: 'x' } } }));
    mockUpdateFunding.mockResolvedValue({ ok: true, profileId: 'p1', before: { bankAccount: '•••• 4342', bankName: 'Chase Bank' }, after: { bankAccount: '•••• 6789', bankName: 'New Bank', accountType: 'Savings', bankVerification: 'Pending' }, verificationStatus: 'pending', note: 'Bank details are encrypted and stored securely. Re-verification is required.' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MID-202605-001'));
    await waitFor(() => expect(screen.getByText('Update funding information')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Update funding information'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Update Funding Information' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '000123456789' } });
    fireEvent.change(screen.getByLabelText('Routing number'), { target: { value: '021000021' } });
    fireEvent.change(screen.getByLabelText('Funding reason'), { target: { value: 'owner change' } });
    // Without step-up confirmed → blocked client-side, no API call.
    fireEvent.click(screen.getByText('Update funding'));
    expect(screen.getByText('Confirm step-up authentication to proceed.')).toBeInTheDocument();
    expect(mockUpdateFunding).not.toHaveBeenCalled();
    // Confirm step-up → submits.
    fireEvent.click(screen.getByLabelText('Confirm step-up authentication'));
    fireEvent.click(screen.getByText('Update funding'));
    await waitFor(() => expect(mockUpdateFunding).toHaveBeenCalledWith('t1', expect.objectContaining({ stepUpConfirmed: true, routingNumber: '021000021', reason: 'owner change' })));
    await waitFor(() => expect(screen.getByText('Funding updated — re-verification pending.')).toBeInTheDocument());
    expect(screen.getByText(/•••• 6789/)).toBeInTheDocument();
  });

  it('assigns a MID with validation and a required reason', async () => {
    mockOverview.mockResolvedValueOnce(overview());
    mockOverview.mockResolvedValue(overview({ selectedMerchant: { ...row(), funding: { available: false, note: 'x' } } }));
    mockAssignMid.mockResolvedValue({ ok: true, idempotent: false, merchantId: 'MID-202605-777', previousMid: 'MID-202605-001', branchId: null });
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MID-202605-001'));
    await waitFor(() => expect(screen.getByText('Assign an MID to a branch')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Assign an MID to a branch'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Assign MID to a Branch' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Merchant ID'), { target: { value: 'MID-202605-777' } });
    fireEvent.click(screen.getByText('Assign MID'));
    expect(screen.getByText('A reason is required.')).toBeInTheDocument();
    expect(mockAssignMid).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('MID reason'), { target: { value: 'reissue' } });
    fireEvent.click(screen.getByText('Assign MID'));
    await waitFor(() => expect(mockAssignMid).toHaveBeenCalledWith('t1', expect.objectContaining({ merchantId: 'MID-202605-777', reason: 'reissue' })));
    await waitFor(() => expect(screen.getByText('MID assigned.')).toBeInTheDocument());
  });

  it('assigns a terminal with ownership validation and a required reason', async () => {
    mockOverview.mockResolvedValueOnce(overview());
    mockOverview.mockResolvedValue(overview({ selectedMerchant: { ...row(), funding: { available: false, note: 'x' } } }));
    mockAssignTerminal.mockResolvedValue({ ok: true, idempotent: false, terminalId: 'term-1', previousBranchId: 'b-old', branchId: 'b-new', label: 'Clover Flex #2' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('MID-202605-001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MID-202605-001'));
    await waitFor(() => expect(screen.getByText('Assign terminals')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Assign terminals'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Assign Terminals' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Terminal ID'), { target: { value: 'term-1' } });
    fireEvent.change(screen.getByLabelText('Terminal branch ID'), { target: { value: 'b-new' } });
    fireEvent.click(screen.getByText('Assign terminal'));
    expect(screen.getByText('A reason is required.')).toBeInTheDocument();
    expect(mockAssignTerminal).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Terminal reason'), { target: { value: 'relocate' } });
    fireEvent.click(screen.getByText('Assign terminal'));
    await waitFor(() => expect(mockAssignTerminal).toHaveBeenCalledWith('t1', expect.objectContaining({ terminalId: 'term-1', branchId: 'b-new', reason: 'relocate' })));
    await waitFor(() => expect(screen.getByText('Terminal assigned.')).toBeInTheDocument());
  });

  it('exports the filtered directory as a CSV download', async () => {
    mockOverview.mockResolvedValue(overview());
    mockExport.mockResolvedValue({ ok: true, filename: 'merchant-accounts-2026-07-01.csv', mimeType: 'text/csv', rowCount: 3, csv: 'Merchant ID,Processor\nMID-202605-001,Fiserv', formats: { csv: true, xlsx: false, pdf: false } });
    const createObjSpy = vi.fn().mockReturnValue('blob:x');
    (URL as any).createObjectURL = createObjSpy;
    (URL as any).revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderScreen('/merchant-accounts?processor=clover');
    await waitFor(() => expect(screen.getByText('Export Report')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Export Report'));
    await waitFor(() => expect(mockExport).toHaveBeenCalledWith(expect.objectContaining({ processor: 'clover' })));
    await waitFor(() => expect(createObjSpy).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('shows a live auto-refresh indicator and polls in the background', async () => {
    vi.useFakeTimers();
    try {
      mockOverview.mockResolvedValue(overview());
      renderScreen();
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/auto-refresh 25s/)).toBeInTheDocument();
      const initial = mockOverview.mock.calls.length;
      await vi.advanceTimersByTimeAsync(25_000);
      expect(mockOverview.mock.calls.length).toBeGreaterThan(initial);
    } finally { vi.useRealTimers(); }
  });

  it('preserves last data and flags stale when a background refresh fails', async () => {
    vi.useFakeTimers();
    try {
      mockOverview.mockResolvedValueOnce(overview());
      renderScreen();
      await vi.advanceTimersByTimeAsync(0);
      mockOverview.mockRejectedValueOnce(new Error('blip'));
      await vi.advanceTimersByTimeAsync(25_000);
      expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
      expect(screen.getByText('MID-202605-001')).toBeInTheDocument(); // last data preserved
    } finally { vi.useRealTimers(); }
  });

  it('shows an error state with retry', async () => {
    mockOverview.mockRejectedValue(new Error('boom'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Couldn’t load Merchant Accounts')).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
