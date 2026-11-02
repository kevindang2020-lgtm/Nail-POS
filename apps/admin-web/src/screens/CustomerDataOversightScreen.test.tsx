import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const kpi = (key: string, label: string, value: string | null, extra: any = {}) => ({ key, label, value, available: value !== null, ...extra });
const overview = () => ({
  kpis: [
    kpi('total_customers', 'Total Customers', '83,612', { to: '/customer-data-oversight' }),
    kpi('customers_by_tenant', 'Customers by Tenant', '24', { supporting: 'Active Tenants' }),
    kpi('duplicate_records', 'Duplicate Records', '2,846'),
    kpi('incomplete_records', 'Incomplete Records', '4,961'),
    kpi('invalid_phone', 'Invalid Phone Numbers', '1,237'),
    kpi('invalid_email', 'Invalid Email Addresses', '982'),
    kpi('failed_imports', 'Failed Imports', null),         // NotConnected
    kpi('privacy_requests', 'Privacy Requests', '58', { supporting: 'Pending 18' }),
    kpi('export_requests', 'Data Export Requests', '22', { supporting: 'Pending 7' }),
    kpi('deletion_requests', 'Data Deletion Requests', '31', { supporting: 'Pending 9' }),
    kpi('consent_status', 'Customer Consent Status', '73.4%', { supporting: 'Consented' }),
    kpi('cross_tenant', 'Suspicious Cross-Tenant', '47'),
    kpi('legal_hold', 'Under Legal Hold', null),           // NotConnected
    kpi('avg_completeness', 'Avg. Record Completeness', '86.7%'),
    kpi('integrity_score', 'Data Integrity Score', '92.6 / 100'),
  ],
  directory: [
    { id: 'CUS-0087321', name: 'Emily Johnson', tenantId: 't1', tenantName: 'Glamour Studio', branchId: 'b1', branchName: 'Downtown', phoneStatus: 'valid', emailStatus: 'valid', completeness: 98, duplicateRisk: 'low', consentStatus: 'consented', privacyRequest: 'None', importSource: 'Web Form', lastUpdated: '2026-05-06T14:10:00Z' },
    { id: 'CUS-0087323', name: 'Sarah Davis', tenantId: 't2', tenantName: 'The Hair Lounge', branchId: 'b2', branchName: 'City Center', phoneStatus: 'valid', emailStatus: 'invalid', completeness: 55, duplicateRisk: 'high', consentStatus: 'not_consented', privacyRequest: 'Delete Requested', importSource: 'Import Job', lastUpdated: '2026-05-06T13:45:00Z' },
  ],
  directoryTotal: 83612,
  pagination: { page: 1, pageSize: 10, totalItems: 83612, totalPages: 8362 },
  healthAlerts: [
    { key: 'duplicate_records', label: 'Duplicate records', count: 2846, available: true, to: '/customer-data-oversight/duplicates' },
    { key: 'failed_imports', label: 'Failed imports', count: null, available: false },
    { key: 'cross_tenant', label: 'Suspicious cross-tenant records', count: 47, available: true },
  ],
  customersByTenant: [{ tenantId: 't1', label: 'Glamour Studio', count: 14000 }, { tenantId: 't2', label: 'The Hair Lounge', count: 10832 }],
  customersByTenantTotal: 83612,
  duplicateDistribution: { total: 2846, segments: [{ key: 'high', label: 'High Risk', count: 832 }, { key: 'medium', label: 'Medium Risk', count: 1214 }, { key: 'low', label: 'Low Risk', count: 800 }] },
  consentOverview: { ratePct: 73.4, segments: [{ key: 'consented', label: 'Consented', count: 61391 }, { key: 'not_consented', label: 'Not Consented', count: 20644 }, { key: 'unknown', label: 'Unknown', count: 1377 }] },
  growthTrend: [{ date: '2026-05-01', newRecords: 120 }, { date: '2026-05-02', newRecords: 145 }],
  growthDefinition: 'New customer records created per day in the selected scope/period.',
  integrityIssues: { total: 6213, categories: [{ key: 'incomplete', label: 'Incomplete Records', count: 4961 }, { key: 'invalid_phone', label: 'Invalid Phone Numbers', count: 1237 }, { key: 'invalid_email', label: 'Invalid Email Addresses', count: 982 }], note: 'One record may have multiple issues — total is issue occurrences, not unique customers.' },
  integrityScore: 92.6,
  suspiciousCrossTenant: { count: 47, alerts: [{ reason: 'phone', maskedKey: '***0104', tenantIds: ['t2', 't3'], recordCount: 2 }] },
  importSuccess: { available: false, successRatePct: null },
  privacyRequestStatus: { available: true, total: 58, segments: [{ key: 'pending', label: 'Pending', count: 18 }, { key: 'in_progress', label: 'In Progress', count: 20 }, { key: 'completed', label: 'Completed', count: 20 }] },
  recentMerges: { available: true, rows: [{ id: 'mrg_1', sourceCustomerId: 'CUS-0099002', targetCustomerId: 'CUS-0099001', mergedByUserId: 'admin1', mergedAt: '2026-05-06T12:00:00Z' }] },
  recentActivity: { available: true, rows: [{ action: 'super_admin_customer_merged', entityType: 'customer', entityId: 'CUS-0087325', actorUserId: 'admin1', at: '2026-05-06T12:00:00Z' }] },
});

const customerDataOversight = vi.fn();
const legalHolds = vi.fn();
const applyLegalHold = vi.fn();
const releaseLegalHold = vi.fn();
const importJobs = vi.fn();
const approveImport = vi.fn();
const retryImport = vi.fn();
const rejectImport = vi.fn();
const deletionRequests = vi.fn();
const requestDeletion = vi.fn();
const approveDeletion = vi.fn();
const rejectDeletion = vi.fn();
const executeDeletion = vi.fn();
const customerDuplicates = vi.fn();
const customerSyncDashboard = vi.fn();
const customerSyncConflicts = vi.fn();
const customerSyncRunDetail = vi.fn();
const customerSyncRuns = vi.fn();
const customerSyncMergePreview = vi.fn();
const customerSyncMerge = vi.fn();
const customerSyncConflictStatus = vi.fn();
const customerSyncRun = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  customerDataOversight: (...a: any[]) => customerDataOversight(...a),
  legalHolds: (...a: any[]) => legalHolds(...a),
  applyLegalHold: (...a: any[]) => applyLegalHold(...a),
  releaseLegalHold: (...a: any[]) => releaseLegalHold(...a),
  importJobs: (...a: any[]) => importJobs(...a),
  approveImport: (...a: any[]) => approveImport(...a),
  retryImport: (...a: any[]) => retryImport(...a),
  rejectImport: (...a: any[]) => rejectImport(...a),
  deletionRequests: (...a: any[]) => deletionRequests(...a),
  requestDeletion: (...a: any[]) => requestDeletion(...a),
  approveDeletion: (...a: any[]) => approveDeletion(...a),
  rejectDeletion: (...a: any[]) => rejectDeletion(...a),
  executeDeletion: (...a: any[]) => executeDeletion(...a),
  customerDuplicates: (...a: any[]) => customerDuplicates(...a),
  // Defaults matter: an unset mock returns undefined and every pre-existing test would crash on `.then`.
  customerSyncDashboard: (...a: any[]) => customerSyncDashboard(...a) ?? Promise.resolve({ lastSync: null, lastStatus: null, nextScheduled: null, recentRuns: [], openConflicts: 0 }),
  customerSyncConflicts: (...a: any[]) => customerSyncConflicts(...a) ?? Promise.resolve([]),
  customerSyncRunDetail: (...a: any[]) => customerSyncRunDetail(...a) ?? Promise.resolve([]),
  customerSyncRuns: (...a: any[]) => customerSyncRuns(...a) ?? Promise.resolve([]),
  customerSyncMergePreview: (...a: any[]) => customerSyncMergePreview(...a) ?? Promise.resolve(null),
  customerSyncMerge: (...a: any[]) => customerSyncMerge(...a) ?? Promise.resolve({ ok: true }),
  customerSyncConflictStatus: (...a: any[]) => customerSyncConflictStatus(...a) ?? Promise.resolve(true),
  customerSyncRun: (...a: any[]) => customerSyncRun(...a) ?? Promise.resolve({ ran: true, status: 'COMPLETED' }),
} }));

import { CustomerDataOversightScreen } from './CustomerDataOversightScreen';

describe('CustomerDataOversightScreen — governance reference', () => {
  beforeEach(() => {
    customerDataOversight.mockReset(); customerDataOversight.mockResolvedValue(overview());
    legalHolds.mockReset(); legalHolds.mockResolvedValue([]);
    applyLegalHold.mockReset(); applyLegalHold.mockResolvedValue({ ok: true, hold: { id: 'lh_1' } });
    releaseLegalHold.mockReset(); releaseLegalHold.mockResolvedValue({ ok: true });
    importJobs.mockReset(); importJobs.mockResolvedValue([]);
    approveImport.mockReset(); approveImport.mockResolvedValue({ ok: true, job: { importedRows: 2, failedRows: 0 } });
    retryImport.mockReset(); retryImport.mockResolvedValue({ ok: true, job: { importedRows: 0, failedRows: 0 } });
    rejectImport.mockReset(); rejectImport.mockResolvedValue({ ok: true });
    deletionRequests.mockReset(); deletionRequests.mockResolvedValue([]);
    requestDeletion.mockReset(); requestDeletion.mockResolvedValue({ ok: true, request: { id: 'del_1' } });
    approveDeletion.mockReset(); approveDeletion.mockResolvedValue({ ok: true });
    rejectDeletion.mockReset(); rejectDeletion.mockResolvedValue({ ok: true });
    executeDeletion.mockReset(); executeDeletion.mockResolvedValue({ ok: true });
    customerDuplicates.mockReset(); customerDuplicates.mockResolvedValue({ total: 1, cases: [{ id: 'dup1', kind: 'phone', keyMasked: '•••4567', confidence: 'exact', tenantId: 't1', tenantName: 'Glamour Studio', members: [{ id: 'c1', name: 'Emily Johnson', phone: '•••4567', email: 'e•••@x.com', branch: 'Downtown', status: 'active' }, { id: 'c2', name: 'Emily J', phone: '•••4567', email: 'e2•••@x.com', branch: 'Downtown', status: 'active' }] }] });
  });

  it('renders the title, subtitle, and primary actions', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    expect(await screen.findByText('Customer Data Oversight')).toBeInTheDocument();
    expect(screen.getByText(/Monitor customer records, imports, privacy requests/)).toBeInTheDocument();
    expect(screen.getByText('⬇ Export Report')).toBeInTheDocument();
    expect(screen.getByText('+ Add Widget')).toBeInTheDocument();
  });

  it('shows the tenant-isolation banner with a working Learn More', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    expect(await screen.findByText('TENANT ISOLATION REQUIRED')).toBeInTheDocument();
    expect(screen.getByText(/must never automatically appear inside Tenant B/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Learn More'));
    expect(await screen.findByText(/protected Super Admin integrity alert/)).toBeInTheDocument();
  });

  it('renders all 15 KPI cards with NotConnected for unbacked ones', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    await screen.findByText('Total Customers');
    for (const l of ['Total Customers', 'Duplicate Records', 'Invalid Phone Numbers', 'Privacy Requests', 'Data Deletion Requests', 'Suspicious Cross-Tenant', 'Data Integrity Score', 'Failed Imports', 'Under Legal Hold']) {
      expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getByText('83,612')).toBeInTheDocument();
    expect(screen.getAllByText(/not connected/i).length).toBeGreaterThanOrEqual(2); // failed imports + legal hold + modules
  });

  it('renders the directory with governance columns and accessible badges', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    expect(await screen.findByText('CUS-0087321')).toBeInTheDocument();
    expect(screen.getByText('Emily Johnson')).toBeInTheDocument();
    expect(screen.getByText('Delete Requested')).toBeInTheDocument();
    expect(screen.getAllByText('Valid').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Invalid')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 to 2 of 83,612 customers/)).toBeInTheDocument();
  });

  it('renders all 10 Oversight Actions with the dangerous deletion action present', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    for (const a of ['Review duplicate-detection results', 'Approve large imports', 'Retry failed imports', 'Merge records with authorization', 'Process privacy requests', 'Export customer data', 'Correct data-integrity problems', 'Review customer audit history', 'Place records under legal hold', 'Permanently delete data under approved process']) {
      expect(await screen.findByText(a)).toBeInTheDocument();
    }
  });

  it('renders the analytics modules incl. honest NotConnected for import/merge/activity', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    expect(await screen.findByText('Customer Growth Trend')).toBeInTheDocument();
    expect(screen.getAllByText('Customers by Tenant').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Duplicate Record Distribution')).toBeInTheDocument();
    expect(screen.getByText('Customer Consent Status Overview')).toBeInTheDocument();
    expect(screen.getByText('Data Integrity Issues Summary')).toBeInTheDocument();
    expect(screen.getByText('Suspicious Cross-Tenant Records')).toBeInTheDocument();
    expect(screen.getByText(/issue occurrences, not unique customers/)).toBeInTheDocument();
    expect(screen.getByText('Recent Merges / Audit Trail')).toBeInTheDocument();
  });

  it('changing the tenant filter refetches scoped to that tenant', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    await screen.findByText('CUS-0087321');
    const tenantSelect = screen.getByDisplayValue('All Tenants');
    fireEvent.change(tenantSelect, { target: { value: 't1' } });
    await waitFor(() => expect(customerDataOversight).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' })));
  });

  it('opens the legal-hold modal from the oversight action and blocks submit until required fields + confirmation', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Place records under legal hold'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Place legal hold')); // empty → validation errors, no API call
    expect(await screen.findByText(/Matter \/ case reference is required/)).toBeInTheDocument();
    expect(applyLegalHold).not.toHaveBeenCalled();
  });

  it('applies a customer-scoped hold and refreshes', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    await screen.findByText('CUS-0087321');
    fireEvent.click(screen.getByLabelText('Place legal hold on Emily Johnson')); // row action prefills tenant + customer
    fireEvent.change(screen.getByPlaceholderText('e.g. LIT-2026-0042'), { target: { value: 'LIT-1' } });
    fireEvent.change(screen.getByPlaceholderText('Why this hold is being placed'), { target: { value: 'litigation' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Place legal hold'));
    await waitFor(() => expect(applyLegalHold).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', customerId: 'CUS-0087321', matterRef: 'LIT-1', reason: 'litigation', scope: 'customer' })));
  });

  it('lists active legal holds with a release control', async () => {
    legalHolds.mockResolvedValue([{ id: 'lh_9', tenantId: 't1', customerId: 'CUS-0087321', branchId: null, matterRef: 'LIT-7', reason: 'r', scope: 'customer', status: 'active', appliedByUserId: null, appliedAt: '2026-05-01T00:00:00Z', effectiveAt: '2026-05-01T00:00:00Z', reviewAt: null, releasedByUserId: null, releasedAt: null, releaseReason: null, internalNotes: null }]);
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    expect(await screen.findByText('Active Legal Holds')).toBeInTheDocument();
    expect(await screen.findByText('Matter LIT-7')).toBeInTheDocument();
    expect(screen.getByText('Release')).toBeInTheDocument();
  });

  it('opens the imports drawer from the oversight action, lists jobs, and approves a pending one', async () => {
    importJobs.mockResolvedValue([
      { id: 'imp_1', tenantId: 't1', branchId: 'b1', source: 'csv', filename: 'batch.csv', status: 'pending', totalRows: 3, validRows: 2, invalidRows: 1, importedRows: 0, failedRows: 0, rejectReason: null, createdAt: '2026-05-01T00:00:00Z', approvedAt: null, completedAt: null },
    ]);
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Approve large imports'));
    expect(await screen.findByText('batch.csv')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(approveImport).toHaveBeenCalledWith('imp_1'));
  });

  it('opens the deletion drawer and requests a permanent deletion', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Permanently delete data under approved process'));
    expect(await screen.findByText('Request a deletion')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Customer ID (CUS-…)'), { target: { value: 'CUS-9' } });
    fireEvent.change(screen.getByPlaceholderText(/GDPR erasure/), { target: { value: 'erasure request' } });
    // tenant select still empty → blocked
    fireEvent.click(screen.getByText('Request deletion'));
    expect(requestDeletion).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByDisplayValue('Select tenant…')[0], { target: { value: 't1' } });
    fireEvent.click(screen.getByText('Request deletion'));
    await waitFor(() => expect(requestDeletion).toHaveBeenCalledWith({ tenantId: 't1', customerId: 'CUS-9', reason: 'erasure request' }));
  });

  it('requires the exact typed customer ID before permanent erasure can be executed', async () => {
    deletionRequests.mockResolvedValue([
      { id: 'del_5', tenantId: 't1', customerId: 'CUS-7', reason: 'GDPR', status: 'approved', requestedByUserId: 'u1', approvedByUserId: 'u2', executedByUserId: null, rejectReason: null, retentionChecked: false, retentionNote: null, legalHoldBlocked: false, requestedAt: '2026-05-01T00:00:00Z', approvedAt: '2026-05-02T00:00:00Z', executedAt: null },
    ]);
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Permanently delete data under approved process'));
    fireEvent.click(await screen.findByText('Execute'));
    const eraseBtn = await screen.findByText('Permanently erase');
    expect(eraseBtn).toBeDisabled(); // empty confirmation
    const input = screen.getByPlaceholderText('CUS-7');
    fireEvent.change(input, { target: { value: 'WRONG' } });
    expect(screen.getByText('Permanently erase')).toBeDisabled(); // mismatch
    fireEvent.change(input, { target: { value: 'CUS-7' } });
    expect(screen.getByText('Permanently erase')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Permanently erase'));
    await waitFor(() => expect(executeDeletion).toHaveBeenCalledWith('del_5', 'CUS-7'));
  });

  it('surfaces the recent merges and activity trails (no longer NotConnected)', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    expect(await screen.findByText('CUS-0099002 →', { exact: false })).toBeInTheDocument(); // recent merge row
    expect(screen.getByText(/Super Admin Customer Merged/i)).toBeInTheDocument(); // recent activity row
  });

  it('deep-links from the sidebar submenu: /import-history opens the imports drawer', async () => {
    importJobs.mockResolvedValue([
      { id: 'imp_9', tenantId: 't1', branchId: 'b1', source: 'csv', filename: 'deeplink.csv', status: 'pending', totalRows: 1, validRows: 1, invalidRows: 0, importedRows: 0, failedRows: 0, rejectReason: null, createdAt: '2026-05-01T00:00:00Z', approvedAt: null, completedAt: null },
    ]);
    render(<MemoryRouter initialEntries={['/customer-data-oversight/import-history']}>
      <Routes><Route path="/customer-data-oversight/:view" element={<CustomerDataOversightScreen />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('Customer Imports')).toBeInTheDocument(); // imports drawer opened by the :view param
    expect(await screen.findByText('deeplink.csv')).toBeInTheDocument();
  });

  it('opens the merge-review drawer and lists within-tenant duplicate clusters', async () => {
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Merge records with authorization'));
    expect(await screen.findByText('Duplicate Review & Merge')).toBeInTheDocument();
    expect(await screen.findByText('Emily J')).toBeInTheDocument();
    expect(screen.getByText(/within a single tenant only/)).toBeInTheDocument();
    await waitFor(() => expect(customerDuplicates).toHaveBeenCalled());
  });
});


// ---- Customer Sync & Reconciliation section (the 7 PM global-identity engine, Jul 26 2026) ----
describe('customer sync & reconciliation section', () => {
  it('shows the dashboard head, run history and MASKED conflicts; a run needs confirmation and reports its result', async () => {
    customerSyncDashboard.mockResolvedValue({
      lastSync: '2026-07-26T23:14:00Z', lastStatus: 'COMPLETED_WITH_ISSUES', nextScheduled: '2026-07-27T23:00:00Z', openConflicts: 2,
      recentRuns: [{ id: 'r1', trigger: 'scheduled', scope: 'all', scopeId: null, status: 'COMPLETED_WITH_ISSUES', startedAt: '2026-07-26T23:00:00Z', finishedAt: '2026-07-26T23:14:00Z', tenantsScanned: 2, customersScanned: 51, newGlobals: 7, linkedExisting: 12, duplicateSuspects: 2, conflicts: 1, errors: 0 }],
    });
    customerSyncConflicts.mockResolvedValue([
      { id: 'k1', kind: 'PHONE_AND_EMAIL_MATCH_DIFFERENT_CUSTOMERS', tenantId: 'T1', customerId: 'C1', field: null, mainValueMasked: '••••1234', tenantValueMasked: 'k•••@example.com', status: 'NEW', occurrences: 3, recommendedAction: 'REVIEW', createdAt: '2026-07-26T23:10:00Z' },
    ]);
    customerSyncRunDetail.mockResolvedValue([
      { tenantId: 'T1', customersScanned: 30, newGlobals: 4, linkedExisting: 8, duplicateSuspects: 1, conflicts: 1, errors: 0, status: 'ok', errorDetail: null },
      { tenantId: 'T2', customersScanned: 21, newGlobals: 3, linkedExisting: 4, duplicateSuspects: 1, conflicts: 0, errors: 0, status: 'ok', errorDetail: null },
    ]);
    customerSyncRun.mockResolvedValue({ ran: true, status: 'COMPLETED', customersScanned: 9, newGlobals: 1, linkedExisting: 2, conflicts: 0, errors: 0 });
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    const sec = within(await screen.findByTestId('customer-sync'));
    expect(await sec.findByText('COMPLETED_WITH_ISSUES', { selector: 'div' })).toBeTruthy();
    expect(sec.getByText('••••1234')).toBeTruthy();
    expect(sec.getByText('k•••@example.com')).toBeTruthy();

    fireEvent.click(sec.getByText('Run customer sync now'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run sync now' }));   // §35 confirmation, in-app
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await sec.findByText(/COMPLETED: 9 scanned, 1 new, 2 linked/)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it('an advisory-lock skip is reported honestly, and a customer re-sync without a tenant is refused client-side', async () => {
    customerSyncDashboard.mockResolvedValue({ lastSync: null, lastStatus: null, nextScheduled: null, recentRuns: [], openConflicts: 0 });
    customerSyncConflicts.mockResolvedValue([]);
    customerSyncRun.mockReset();
    customerSyncRun.mockResolvedValue({ ran: false, skippedReason: 'another reconciliation is running (advisory lock held)' });

    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    const sec = within(await screen.findByTestId('customer-sync'));
    fireEvent.click(sec.getByText('Re-sync customer'));
    expect(await sec.findByText(/needs both the tenant and the customer ID/)).toBeTruthy();
    expect(customerSyncRun).not.toHaveBeenCalled();

    fireEvent.click(sec.getByText('Run customer sync now'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run sync now' }));
    expect(await sec.findByText(/advisory lock held/)).toBeTruthy();
  });

  it('the run-history control loads the full run list from the dedicated endpoint', async () => {
    customerSyncRuns.mockResolvedValue([
      { id: 'r-old-1', trigger: 'scheduled', scope: 'all', scopeId: null, status: 'COMPLETED', startedAt: '2026-07-20T23:00:00Z', finishedAt: '2026-07-20T23:05:00Z', tenantsScanned: 3, customersScanned: 120, newGlobals: 4, linkedExisting: 9, duplicateSuspects: 0, conflicts: 0, errors: 0 },
      { id: 'r-old-2', trigger: 'manual', scope: 'tenant', scopeId: 'T1', status: 'PARTIAL', startedAt: '2026-07-19T23:00:00Z', finishedAt: '2026-07-19T23:02:00Z', tenantsScanned: 1, customersScanned: 12, newGlobals: 0, linkedExisting: 1, duplicateSuspects: 0, conflicts: 0, errors: 1 },
    ]);
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    const btn = await screen.findByTestId('sync-load-history');
    fireEvent.click(btn);
    expect(await screen.findByText('Run history')).toBeTruthy();
    expect(customerSyncRuns).toHaveBeenCalled();
    expect(screen.getByText('2 runs')).toBeTruthy();
  });

  it('§24 merge review compares two identities with masked values and refuses to merge until confirmed', async () => {
    customerSyncMergePreview.mockResolvedValue({
      a: { globalCustomerId: 'GA', name: 'Kevin Guest', phoneMasked: '••••1234', emailMasked: 'k•••@example.com', phoneVerified: true, emailVerified: false, status: 'active', linkedTenants: 1, createdAt: '2026-01-01T00:00:00Z' },
      b: { globalCustomerId: 'GB', name: 'Kevin Guest', phoneMasked: '••••1234', emailMasked: '•••', phoneVerified: true, emailVerified: false, status: 'active', linkedTenants: 2, createdAt: '2026-02-01T00:00:00Z' },
      indicators: { samePhone: true, sameEmail: false, sharesTenant: false },
    });
    customerSyncMerge.mockResolvedValue({ ok: true, moved: 1 });
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    const panel = within(await screen.findByTestId('merge-review'));
    fireEvent.change(panel.getByLabelText('Global customer A'), { target: { value: 'GA' } });
    fireEvent.change(panel.getByLabelText('Global customer B'), { target: { value: 'GB' } });
    fireEvent.click(panel.getByText('Compare'));
    expect((await panel.findAllByText('••••1234', { exact: false })).length).toBeGreaterThan(0);   // shown for both sides
    const mergeBtn = panel.getByText('Merge identities') as HTMLButtonElement;
    expect(mergeBtn.disabled).toBe(true);                       // confirmation gates the destructive-shaped action
    fireEvent.click(panel.getByRole('checkbox'));
    fireEvent.click(panel.getByText('Merge identities'));
    expect(await screen.findByText(/retired, not deleted/)).toBeTruthy();
    expect(customerSyncMerge).toHaveBeenCalledWith({ sourceGlobalCustomerId: 'GA', targetGlobalCustomerId: 'GB', confirm: true });
  });

  it('a legal hold is reported plainly instead of a generic failure', async () => {
    customerSyncMergePreview.mockResolvedValue({
      a: { globalCustomerId: 'GA', name: 'A', phoneMasked: '••••1111', emailMasked: '•••', phoneVerified: true, emailVerified: false, status: 'active', linkedTenants: 1, createdAt: null },
      b: { globalCustomerId: 'GB', name: 'B', phoneMasked: '••••1111', emailMasked: '•••', phoneVerified: true, emailVerified: false, status: 'active', linkedTenants: 1, createdAt: null },
      indicators: { samePhone: true, sameEmail: false, sharesTenant: false },
    });
    customerSyncMerge.mockResolvedValue({ ok: false, reason: 'LEGAL_HOLD' });
    render(<MemoryRouter><CustomerDataOversightScreen /></MemoryRouter>);
    const panel = within(await screen.findByTestId('merge-review'));
    fireEvent.change(panel.getByLabelText('Global customer A'), { target: { value: 'GA' } });
    fireEvent.change(panel.getByLabelText('Global customer B'), { target: { value: 'GB' } });
    fireEvent.click(panel.getByText('Compare'));
    await panel.findByText('Merge identities');
    fireEvent.click(panel.getByRole('checkbox'));
    fireEvent.click(panel.getByText('Merge identities'));
    expect((await panel.findAllByText(/legal hold/i)).length).toBeGreaterThan(0);
  });
});
