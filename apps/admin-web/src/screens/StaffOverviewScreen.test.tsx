import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockDirectory, mockProfile, mockSupport, mockDeactivate, mockDuplicates, mockReviewDup, mockTransfers, mockDecide, mockCrossList, mockCrossReq, mockCrossDecide, mockPayroll, mockPayrollRetry, mockSecurity, mockReviewSec, mockConnectivity, mockViews, mockSaveView, mockDeleteView } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockDirectory: vi.fn(), mockProfile: vi.fn(), mockSupport: vi.fn(), mockDeactivate: vi.fn(), mockDuplicates: vi.fn(), mockReviewDup: vi.fn(), mockTransfers: vi.fn(), mockDecide: vi.fn(), mockCrossList: vi.fn(), mockCrossReq: vi.fn(), mockCrossDecide: vi.fn(), mockPayroll: vi.fn(), mockPayrollRetry: vi.fn(), mockSecurity: vi.fn(), mockReviewSec: vi.fn(), mockConnectivity: vi.fn(), mockViews: vi.fn(), mockSaveView: vi.fn(), mockDeleteView: vi.fn() }));
vi.mock('../api/superAdminStaffApi', () => ({ superAdminStaffApi: { workforceOverview: () => mockOverview(), workforceDirectory: (q: any) => mockDirectory(q), workforceProfile: (id: string) => mockProfile(id), workforceAccessSupport: (id: string, b: any) => mockSupport(id, b), workforceDeactivateAccess: (id: string, b: any) => mockDeactivate(id, b), workforceDuplicates: () => mockDuplicates(), workforceReviewDuplicate: (b: any) => mockReviewDup(b), workforceTransfers: () => mockTransfers(), workforceDecideTransfer: (id: string, b: any) => mockDecide(id, b), workforceCrossTransfers: () => mockCrossList(), workforceRequestCrossTransfer: (id: string, b: any) => mockCrossReq(id, b), workforceDecideCrossTransfer: (id: string, b: any) => mockCrossDecide(id, b), workforcePayrollSync: () => mockPayroll(), workforceRetryPayrollSync: (id: string, b: any) => mockPayrollRetry(id, b), workforceSecurityActivity: () => mockSecurity(), workforceReviewSecurity: (b: any) => mockReviewSec(b), workforceConnectivity: () => mockConnectivity(), workforceSavedViews: () => mockViews(), workforceSaveView: (b: any) => mockSaveView(b), workforceDeleteView: (id: string) => mockDeleteView(id) } }));

import StaffOverviewScreen from './StaffOverviewScreen';

const kpi = (value: number | null) => ({ value, available: value != null });
const overview = () => ({
  ok: true, scope: { tenantScoped: false },
  kpis: {
    totalWorkers: kpi(4286), activeWorkers: kpi(3824), inactiveWorkers: kpi(462), technicians: kpi(2463), receptionists: kpi(1205), managers: kpi(618),
    duplicateProfiles: kpi(68), branchTransfers: kpi(null), accountAccessIssues: kpi(56), payrollSyncIssues: kpi(null), missingEmploymentInfo: kpi(112), suspiciousPermissionActivity: kpi(null),
  },
  roleDistribution: { technicians: 2463, receptionists: 1205, managers: 618, other: 0, total: 4286 },
  statusDistribution: { active: 3824, inactive: 462, suspended: 0, invited: 0, total: 4286 },
  workersByTenant: { rows: [{ tenantId: 't1', tenantName: 'Glamour Studio', count: 1124 }, { tenantId: 't2', tenantName: 'Luxe Salon', count: 862 }], total: 4286 },
  healthAlerts: [
    { key: 'duplicates', label: 'Duplicate staff profiles', count: 68, severity: 'critical', available: true, to: '/staff?profileStatus=duplicate' },
    { key: 'payrollFailures', label: 'Payroll synchronization failures', count: null, severity: 'critical', available: false, to: '/staff/payroll-sync?status=failed' },
    { key: 'inactiveUsers', label: 'Inactive users', count: 462, severity: 'info', available: true, to: '/staff?status=inactive' },
  ],
  availabilityDistribution: { available: false, reason: 'x' }, workforceTrend: { available: false, reason: 'x' }, transferPipeline: { available: false, reason: 'x' },
  technicianConnectivity: { available: false, reason: 'x' }, payrollSyncRate: { available: false, reason: 'x' },
  recentActivity: [{ id: 'a1', actionType: 'user_profile_updated', entityType: 'user', userId: 'u1', tenantId: 't1', at: '2026-05-06T12:00:00Z' }],
  auditEventSummary: [{ category: 'Profile Updates', count: 128 }, { category: 'Role Changes', count: 46 }, { category: 'Access Changes', count: 72 }, { category: 'Login Failures', count: 19 }, { category: 'Payroll Sync Errors', count: 14 }],
  todaySummary: { auditEvents: kpi(279) },
});
const dirPage = () => ({
  ok: true, total: 2, page: 1, pageSize: 10, pages: 1, facets: { statuses: ['active', 'inactive'] },
  rows: [
    { workerId: 'w1', name: 'Sarah Johnson', role: 'TECHNICIAN', roleCategory: 'technician', tenantId: 't1', tenant: 'Glamour Studio', branchId: 'b1', branch: 'Downtown', status: 'active', availability: 'Unknown', profileStatus: 'Verified', accessStatus: 'OK', payrollSync: 'Not Configured', lastActivity: '2026-05-06T14:20:00Z', flags: [] },
    { workerId: 'w2', name: 'Emma Wilson', role: 'RECEPTION', roleCategory: 'receptionist', tenantId: 't2', tenant: 'Radiant Beauty', branchId: 'b2', branch: 'West End', status: 'active', availability: 'Unknown', profileStatus: 'Duplicate Review', accessStatus: 'OK', payrollSync: 'Not Configured', lastActivity: null, flags: ['Duplicate'] },
  ],
});

const profile = () => ({ ok: true, profile: {
  workerId: 'w1', name: 'Sarah Johnson', firstName: 'Sarah', lastName: 'Johnson', maskedEmail: 's•••@glamour.test', maskedPhone: '••• ••• 1234',
  role: 'TECHNICIAN', roleCategory: 'technician', tenantId: 't1', tenant: 'Glamour Studio', branchId: 'b1', branch: 'Downtown', status: 'active', createdAt: '2026-01-02T00:00:00Z',
  access: { accountStatus: 'active', accessStatus: 'OK', mfaEnabled: true, mustChangePassword: false, lastLogin: '2026-06-20T10:00:00Z', activeSessions: 2, appRegistrations: 1 },
  monitoring: { availability: { available: false, reason: 'x' }, connectivity: { available: false, reason: 'x' }, payrollSync: { available: false, reason: 'x' } },
  history: [{ id: 'a1', actionType: 'user_profile_updated', entityType: 'user', userId: 'w1', tenantId: 't1', at: '2026-06-20T10:00:00Z' }],
} });

beforeEach(() => { mockOverview.mockReset(); mockDirectory.mockReset(); mockProfile.mockReset(); mockSupport.mockReset(); mockDeactivate.mockReset(); mockDuplicates.mockReset(); mockReviewDup.mockReset(); mockOverview.mockResolvedValue(overview()); mockDirectory.mockResolvedValue(dirPage()); mockProfile.mockResolvedValue(profile()); mockSupport.mockResolvedValue({ ok: true, action: 'revoke_sessions', result: { sessionsRevoked: 2 } }); mockDeactivate.mockResolvedValue({ ok: true, result: { sessionsRevoked: 1, devicesRevoked: 2 } }); mockDuplicates.mockResolvedValue({ ok: true, groups: [{ tenantId: 't1', tenant: 'Glamour Studio', maskedEmail: 'a•••@glamour.test', members: [{ workerId: 'u1', name: 'Ann A', role: 'TECHNICIAN', status: 'active', lastLogin: null, createdAt: '2026-01-01T00:00:00Z' }, { workerId: 'u2', name: 'Ann Alt', role: 'TECHNICIAN', status: 'invited', lastLogin: null, createdAt: '2026-02-01T00:00:00Z' }] }] }); mockReviewDup.mockResolvedValue({ ok: true, canonicalId: 'u1', flaggedIds: ['u2'], maskedEmail: 'a•••@glamour.test' }); mockTransfers.mockResolvedValue({ ok: true, pipeline: { available: true, total: 3, byStatus: { requested: 1, approved: 2, rejected: 0, cancelled: 0 }, pending: [{ id: 'req1', workerId: 'w1', workerName: 'Sarah Johnson', tenant: 'Glamour Studio', fromBranch: 'Downtown', toBranch: 'West End', status: 'requested', reason: 'cover maternity leave', requestedAt: null, decidedAt: null, decisionNote: null }] } }); mockDecide.mockResolvedValue({ ok: true, id: 'req1', status: 'approved' }); mockCrossList.mockReset(); mockCrossReq.mockReset(); mockCrossDecide.mockReset(); mockCrossList.mockResolvedValue({ ok: true, rows: [] }); mockCrossReq.mockResolvedValue({ ok: true, id: 'cx1', status: 'requested' }); mockCrossDecide.mockResolvedValue({ ok: true, id: 'cx1', status: 'approved' }); mockPayroll.mockReset(); mockPayrollRetry.mockReset(); mockPayroll.mockResolvedValue({ ok: true, summary: { total: 100, byStatus: { synced: 90, failed: 10 }, successful: 90, failed: 10, successRate: 90, configured: true }, events: [{ id: 'e1', workerId: 'u1', workerName: 'Noah Brown', tenant: 'Glow Studio', provider: 'gusto', eventType: 'hours_export', status: 'failed', errorCode: 'PROVIDER_OUTAGE', errorMessage: 'timeout', attemptCount: 1, maxAttempts: 5, lastAttemptAt: null, nextRetryAt: null, retryable: true, retryBlockedReason: null }, { id: 'e2', workerId: 'u2', workerName: 'Ana Diaz', tenant: 'Glow Studio', provider: 'gusto', eventType: 'worker_provision', status: 'failed', errorCode: 'MAPPING_MISSING', errorMessage: 'no external id', attemptCount: 0, maxAttempts: 5, lastAttemptAt: null, nextRetryAt: null, retryable: false, retryBlockedReason: '"MAPPING_MISSING" is a permanent failure — correct the configuration first' }] }); mockPayrollRetry.mockResolvedValue({ ok: true, id: 'e1', status: 'retrying', attemptCount: 2, nextRetryAt: '2026-06-30T12:00:00Z' }); mockSecurity.mockReset(); mockReviewSec.mockReset(); mockSecurity.mockResolvedValue({ ok: true, total: 2, alerts: [{ key: 'terminated_access:u2', type: 'terminated_access', label: 'Inactive/suspended worker with active access', severity: 'critical', workerId: 'u2', workerName: 'Olivia Martinez', tenant: 'Elite Cuts', count: 1, reason: '1 active session(s) despite a non-active account — review and revoke.' }, { key: 'permission_denials:u3', type: 'permission_denials', label: 'Repeated permission denials', severity: 'warning', workerId: 'u3', workerName: 'James Carter', tenant: 'Blow Dry', count: 6, reason: '6 permission denials — possible probing outside job function.' }] }); mockReviewSec.mockResolvedValue({ ok: true, alertKey: 'terminated_access:u2', resolution: 'escalated' }); mockConnectivity.mockReset(); mockConnectivity.mockResolvedValue({ ok: true, summary: { total: 2331, connected: 2222, disconnected: 109, unknown: 0, connectedRate: 95.3, configured: true } }); mockViews.mockReset(); mockSaveView.mockReset(); mockDeleteView.mockReset(); mockViews.mockResolvedValue({ ok: true, views: [] }); mockSaveView.mockResolvedValue({ ok: true, id: 'v9' }); mockDeleteView.mockResolvedValue({ ok: true, deleted: true }); });

describe('StaffOverviewScreen (Workforce Oversight)', () => {
  it('renders title, 12 KPIs, directory rows, alerts, oversight actions, boundary, and quick actions', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText('Workforce Oversight')).toBeInTheDocument();
    expect(screen.getByText('Total Workers')).toBeInTheDocument();
    expect(screen.getByText('Suspicious Permission Activity')).toBeInTheDocument();
    expect(await screen.findByText('4,286')).toBeInTheDocument(); // total workers KPI
    expect(await screen.findByText('Sarah Johnson')).toBeInTheDocument(); // directory row
    expect(screen.getByText('Duplicate staff profiles')).toBeInTheDocument(); // alerts
    expect(screen.getByText('Review staff profiles')).toBeInTheDocument(); // oversight actions
    expect(screen.getByText(/Super Admin Monitoring Boundary/)).toBeInTheDocument();
    expect(screen.getByText('Check Connectivity')).toBeInTheDocument(); // quick actions
    expect(screen.getByText('Role Distribution')).toBeInTheDocument();
  });

  it('shows honest "—" for unsourced KPIs and Not Connected for gap charts', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('4,286');
    // Trend (§16) and availability (§19) remain genuine gaps with no real source.
    expect(screen.getByText(/Historical workforce trend isn’t connected/)).toBeInTheDocument();
    expect(screen.getByText(/No real-time availability source connected/)).toBeInTheDocument();
  });

  it('filters the directory by role via the dropdown (server-side)', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('Sarah Johnson');
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'technician' } });
    await waitFor(() => expect(mockDirectory).toHaveBeenCalledWith(expect.objectContaining({ role: 'technician' })));
  });

  it('exports the current directory view to CSV', async () => {
    const createUrl = vi.fn().mockReturnValue('blob:x'); const revokeUrl = vi.fn();
    (global.URL as any).createObjectURL = createUrl; (global.URL as any).revokeObjectURL = revokeUrl;
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('Sarah Johnson');
    fireEvent.click(screen.getByText('⭳ Export Report'));
    expect(createUrl).toHaveBeenCalled();
  });

  it('opens the workforce profile drawer and shows real masked profile fields', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('Sarah Johnson');
    fireEvent.click(screen.getByLabelText('Actions for Sarah Johnson'));
    fireEvent.click(screen.getByText('View workforce profile'));
    await waitFor(() => expect(mockProfile).toHaveBeenCalledWith('w1'));
    expect(await screen.findByText('s•••@glamour.test')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument(); // MFA
    expect(screen.getByText(/No passwords, tokens, or sensitive/)).toBeInTheDocument();
  });

  it('runs a controlled access-support action only after reason + typed CONFIRM', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('Sarah Johnson');
    fireEvent.click(screen.getByLabelText('Actions for Sarah Johnson'));
    fireEvent.click(screen.getByText('View workforce profile'));
    const runBtn = await screen.findByText('Run access support');
    expect(runBtn).toBeDisabled(); // no reason / no confirm yet
    fireEvent.change(screen.getByLabelText('Support reason'), { target: { value: 'phone lost, force logout' } });
    expect(runBtn).toBeDisabled(); // still needs CONFIRM
    fireEvent.change(screen.getByLabelText('Type CONFIRM'), { target: { value: 'CONFIRM' } });
    expect(runBtn).not.toBeDisabled();
    fireEvent.click(runBtn);
    await waitFor(() => expect(mockSupport).toHaveBeenCalledWith('w1', { action: 'revoke_sessions', reason: 'phone lost, force logout' }));
    expect(await screen.findByText('Revoked 2 active session(s).')).toBeInTheDocument();
  });

  it('offers terminated-user cleanup only for inactive/suspended workers and routes to the deactivate endpoint', async () => {
    const inactive = profile(); inactive.profile.status = 'inactive'; mockProfile.mockResolvedValue(inactive);
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('Sarah Johnson');
    fireEvent.click(screen.getByLabelText('Actions for Sarah Johnson'));
    fireEvent.click(screen.getByText('View workforce profile'));
    const opt = await screen.findByText('Revoke ALL access (terminated-user cleanup)');
    expect(opt).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Support action'), { target: { value: 'deactivate_access' } });
    fireEvent.change(screen.getByLabelText('Support reason'), { target: { value: 'terminated, remove all access' } });
    fireEvent.change(screen.getByLabelText('Type CONFIRM'), { target: { value: 'CONFIRM' } });
    fireEvent.click(screen.getByText('Run access support'));
    await waitFor(() => expect(mockDeactivate).toHaveBeenCalledWith('w1', { reason: 'terminated, remove all access' }));
    expect(await screen.findByText('Revoked 1 session(s) and 2 device registration(s).')).toBeInTheDocument();
  });

  it('reviews a duplicate group: records canonical + reason, never merges', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('4,286');
    fireEvent.click(screen.getByText('Correct duplicate profiles')); // oversight action opens the modal
    await waitFor(() => expect(mockDuplicates).toHaveBeenCalled());
    expect(await screen.findByText('a•••@glamour.test', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/never merges or deletes/)).toBeInTheDocument();
    const recordBtn = screen.getByText('Record review');
    expect(recordBtn).toBeDisabled(); // needs reason + CONFIRM
    fireEvent.change(screen.getByLabelText('Review reason'), { target: { value: 'keep the original record' } });
    fireEvent.change(screen.getByLabelText('Type CONFIRM to record'), { target: { value: 'CONFIRM' } });
    expect(recordBtn).not.toBeDisabled();
    fireEvent.click(recordBtn);
    await waitFor(() => expect(mockReviewDup).toHaveBeenCalledWith({ canonicalId: 'u1', memberIds: ['u1', 'u2'], reason: 'keep the original record' }));
    expect(await screen.findByText(/flagged for tenant resolution/)).toBeInTheDocument();
  });

  it('requests a cross-tenant transfer only after destination + reason + typed worker name (§31)', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('Sarah Johnson');
    fireEvent.click(screen.getByLabelText('Actions for Sarah Johnson'));
    fireEvent.click(screen.getByText('View workforce profile'));
    const reqBtn = await screen.findByText('Request cross-tenant transfer');
    expect(reqBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Destination tenant'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Cross-transfer reason'), { target: { value: 'approved relocation to sister brand' } });
    expect(reqBtn).toBeDisabled(); // still needs typed worker name
    fireEvent.change(screen.getByLabelText('Type worker name to confirm'), { target: { value: 'Sarah Johnson' } });
    expect(reqBtn).not.toBeDisabled();
    fireEvent.click(reqBtn);
    await waitFor(() => expect(mockCrossReq).toHaveBeenCalledWith('w1', { toTenantId: 't2', effectiveDate: undefined, reason: 'approved relocation to sister brand' }));
    expect(await screen.findByText(/recorded for review/)).toBeInTheDocument();
  });

  it('retries an eligible payroll sync event but blocks permanent failures (§35)', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('4,286');
    fireEvent.click(screen.getByText('Troubleshoot payroll synchronization')); // oversight action opens payroll modal
    await waitFor(() => expect(mockPayroll).toHaveBeenCalled());
    expect(await screen.findByText('Noah Brown')).toBeInTheDocument();
    // permanent failure is not retryable and says why
    expect(screen.getByText(/Not retryable: .*permanent failure/)).toBeInTheDocument();
    // the transient one is retryable
    fireEvent.click(screen.getByText('Retry'));
    fireEvent.change(screen.getByLabelText('Retry reason for e1'), { target: { value: 'provider outage cleared' } });
    fireEvent.click(screen.getByText('Confirm retry'));
    await waitFor(() => expect(mockPayrollRetry).toHaveBeenCalledWith('e1', { reason: 'provider outage cleared' }));
    expect(await screen.findByText(/Retry queued \(attempt 2\)/)).toBeInTheDocument();
  });

  it('opens suspicious-activity alerts and records an audited review (§37)', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('4,286');
    // suspicious KPI is now sourced (count 2) and opens the security modal
    const suspCard = await screen.findByLabelText('Suspicious Permission Activity: 2');
    fireEvent.click(suspCard);
    await waitFor(() => expect(mockSecurity).toHaveBeenCalled());
    expect(await screen.findByText('Inactive/suspended worker with active access')).toBeInTheDocument();
    expect(screen.getByText(/probing outside job function/)).toBeInTheDocument();
    const recordBtns = screen.getAllByText('Record review');
    fireEvent.click(recordBtns[0]);
    fireEvent.change(screen.getByLabelText('Resolution for terminated_access:u2'), { target: { value: 'escalated' } });
    fireEvent.change(screen.getByLabelText('Review reason for terminated_access:u2'), { target: { value: 'handed to security team' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockReviewSec).toHaveBeenCalledWith({ alertKey: 'terminated_access:u2', resolution: 'escalated', reason: 'handed to security team' }));
    expect(await screen.findByText('Recorded as escalated.')).toBeInTheDocument();
  });

  it('renders the technician-app connectivity donut from real heartbeat data (§21)', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('4,286');
    await waitFor(() => expect(mockConnectivity).toHaveBeenCalled());
    expect(await screen.findByText('95.3% Connected')).toBeInTheDocument();
    expect(screen.getByText(/109 disconnected/)).toBeInTheDocument();
  });

  it('persists a saved view with the current filters + default flag (§6)', async () => {
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    await screen.findByText('Sarah Johnson');
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'manager' } });
    fireEvent.click(screen.getByText('+ Add View'));
    fireEvent.change(await screen.findByPlaceholderText(/View name/), { target: { value: 'Managers' } });
    fireEvent.click(screen.getByText('Make this my default view'));
    fireEvent.click(screen.getByText('Save view'));
    await waitFor(() => expect(mockSaveView).toHaveBeenCalledWith(expect.objectContaining({ name: 'Managers', isDefault: true, filters: expect.objectContaining({ role: 'manager' }) })));
  });

  it('auto-applies the default saved view on load', async () => {
    mockViews.mockResolvedValue({ ok: true, views: [{ id: 'v1', name: 'Suspended', filters: { status: 'suspended' }, isDefault: true, createdAt: null }] });
    render(<MemoryRouter><StaffOverviewScreen /></MemoryRouter>);
    // default view sets the status filter → directory is queried with status 'suspended'
    await waitFor(() => expect(mockDirectory).toHaveBeenCalledWith(expect.objectContaining({ status: 'suspended' })));
    expect(await screen.findByText('★ Suspended')).toBeInTheDocument();
  });

  it('sidebar deep-link ?panel=transfers opens the transfers review view', async () => {
    render(<MemoryRouter initialEntries={['/staff?panel=transfers']}><StaffOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText('Worker branch transfers')).toBeInTheDocument();
  });

  it('sidebar deep-link ?panel=payroll opens the payroll sync view', async () => {
    render(<MemoryRouter initialEntries={['/staff?panel=payroll']}><StaffOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText('Payroll synchronization')).toBeInTheDocument();
  });
});
