// Onboarding & Approvals QA: the screen renders the header, all 12 KPI cards with real values, the Approval Queue
// badge, and the pipeline rows from the mocked overview hook — plus the empty state. All over the real component.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useOverview = vi.fn();
const apiMock = vi.hoisted(() => ({
  transition: vi.fn().mockResolvedValue({}), activate: vi.fn().mockResolvedValue({}), assign: vi.fn().mockResolvedValue({}),
  returnForCorrection: vi.fn().mockResolvedValue({}), requestInfo: vi.fn().mockResolvedValue({ id: 'n' }),
  documents: vi.fn().mockResolvedValue([
    { id: 'd1', onboardingId: 'o1', category: 'government_id', fileName: 'license.pdf', status: 'pending', reviewerUserId: null, reviewedAt: null, rejectionReason: null, issueDate: null, expirationDate: '2030-01-01', version: 1, virusScanStatus: 'clean', createdAt: '2026-05-06T12:10:00Z', updatedAt: '2026-05-06T12:10:00Z' },
    { id: 'd2', onboardingId: 'o1', category: 'tax_document', fileName: 'tax.pdf', status: 'pending', reviewerUserId: null, reviewedAt: null, rejectionReason: null, issueDate: null, expirationDate: null, version: 1, virusScanStatus: 'pending', createdAt: '2026-05-06T12:11:00Z', updatedAt: '2026-05-06T12:11:00Z' },
  ]),
  reviewDocument: vi.fn().mockResolvedValue({ ok: true, status: 'approved' }),
  record: vi.fn().mockResolvedValue({ id: 'o1', salonName: 'Glamour Studio', ownerName: 'Ada Lovelace', ownerEmail: 'ada@glamour.test', branchCount: 2, currentStage: 'identity_verification', completionPct: 38, specialistName: 'Sarah Johnson', missingDocsCount: 1, merchant: 'under_review', hardware: 'pending', dataImport: 'not_started', training: 'not_started', usersInvited: false, updatedAt: '2026-05-06T13:00:00Z' }),
  history: vi.fn().mockResolvedValue([
    { id: 'h1', onboardingId: 'o1', fromState: 'business_info_submitted', toState: 'identity_verification', reason: null, actorRole: 'super_admin', createdAt: '2026-05-06T12:00:00Z' },
    { id: 'h2', onboardingId: 'o1', fromState: null, toState: 'application_received', reason: null, actorRole: null, createdAt: '2026-05-05T09:00:00Z' },
  ]),
  notes: vi.fn().mockResolvedValue([
    { id: 'n1', onboardingId: 'o1', authorUserId: null, authorName: 'Sarah J.', noteType: 'request_info', body: 'Need a clearer ID scan', stage: null, visibility: 'applicant_visible', attachmentDocumentId: null, followUpDate: null, createdAt: '2026-05-06T12:30:00Z' },
  ]),
  approvals: vi.fn().mockResolvedValue([
    { id: 'ap1', onboardingId: 'o1', approvalType: 'final_review', stage: 'final_review', status: 'pending', decidedByUserId: null, decidedByRole: null, decidedAt: null, reason: null, requiresSecondApproval: true, secondApproverUserId: null, secondApprovedAt: null, createdAt: '2026-05-06T10:00:00Z', updatedAt: '2026-05-06T10:00:00Z' },
    { id: 'ap2', onboardingId: 'o2', approvalType: 'merchant_application', stage: 'merchant_application_submitted', status: 'pending', decidedByUserId: 'user-1', decidedByRole: 'SUPER_ADMIN', decidedAt: '2026-05-06T11:00:00Z', reason: null, requiresSecondApproval: true, secondApproverUserId: null, secondApprovedAt: null, createdAt: '2026-05-06T09:00:00Z', updatedAt: '2026-05-06T11:00:00Z' },
  ]),
  decideApproval: vi.fn().mockResolvedValue({ ok: true }),
  exportReport: vi.fn().mockImplementation((_q: unknown, format: string) =>
    format === 'csv'
      ? Promise.resolve({ format: 'csv', filename: 'onboarding-pipeline.csv', csv: 'Tenant\r\nGlamour Studio' })
      : Promise.resolve({ format, filename: '', disabledReason: 'Export is not configured yet.' })),
}));
vi.mock('../api/onboardingApi', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useOnboardingOverview: () => useOverview(), onboardingApi: apiMock };
});

import { OnboardingScreen } from './OnboardingScreen';

const row = (o: Record<string, unknown> = {}) => ({
  id: 'o1', applicationId: 'a1', applicationType: 'new_tenant', parentTenantId: null, tenantId: null,
  salonName: 'Glamour Studio', ownerName: 'Jane Doe', ownerEmail: 'glamour@x.com', branchCount: 12,
  currentStage: 'identity_verification', completionPct: 38, specialistUserId: 's1', specialistName: 'Sarah Johnson',
  stageEnteredAt: '2026-05-01T00:00:00Z', stageAgeHours: 240, slaBand: 'breached',
  identity: 'pending', merchant: 'under_review', bank: 'not_started', hardware: 'pending', dataImport: 'not_started',
  training: 'not_started', usersInvited: false, missingDocsCount: 2, priority: 'normal',
  targetActivationDate: null, activatedAt: null, activationType: null,
  createdAt: '2026-05-06T14:00:00Z', updatedAt: '2026-05-06T14:10:00Z', ...o,
});

const overview = (over: Record<string, unknown> = {}) => ({
  data: {
    generatedAt: '2026-05-06T14:30:00Z',
    kpis: {
      applicationsReceived: 248, inProgress: 156, pendingApprovals: 82, identityVerificationPending: 37,
      merchantApproved: 114, bankVerified: 98, hardwareAssigned: 91, dataImportsCompleted: 76,
      usersInvited: 132, trainingCompleted: 88, finalReviewsPending: 26, tenantsActivated: 64,
    },
    applications: { rows: [row()], total: 245, page: 1, pageSize: 10, totalPages: 25 },
    workflow: [{ stage: 'identity_verification', label: 'Identity Verification', count: 1 }], stageDistribution: { buckets: [{ stage: 'identity_verification', label: 'Identity Verification', count: 1 }], total: 248 },
    completionTrend: [{ date: '2026-05-06', applications: 3, completions: 1 }],
    merchantStatus: { slices: [{ key: 'approved', label: 'Approved', count: 114 }], total: 114 }, shipmentStatus: { slices: [], total: 0 },
    dataImportStatus: { slices: [], total: 0 }, trainingProgress: { slices: [], total: 0 },
    specialistWorkload: [{ specialistUserId: 's1', specialistName: 'Sarah Johnson', active: 4, completed: 2 }],
    recentActivity: [{ id: 'h1', onboardingId: 'o1', from: 'business_info_submitted', to: 'identity_verification', reason: null, at: '2026-05-06T13:00:00Z' }],
    approvalNotes: [{ id: 'n1', onboardingId: 'o1', authorName: 'Sarah J.', noteType: 'request_info', body: 'Merchant verification documents pending', visibility: 'internal', createdAt: '2026-05-06T13:50:00Z' }],
    onboardingHealth: [{ key: 'missingDocuments', label: 'Missing Documents', count: 29, severity: 'warning' }],
    pendingApprovals: { byType: { merchant_application: 18, final_review: 26 }, total: 82 },
    activationSummary: { total: 64, newTenants: 41, upgraded: 18, reactivated: 5 },
    rejectedExpired: { rejectedApplications: 7, expiredIdentityVerifications: 12, cancelledOnboarding: 5, expiredApplications: 0 },
    permissions: { view: true, activate: true },
  },
  loading: false, error: null, reload: vi.fn(), ...over,
});

const renderScreen = (view?: string) => render(<MemoryRouter><OnboardingScreen view={view as never} /></MemoryRouter>);

describe('Super-Admin Onboarding & Approvals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the title, subtitle, and primary actions', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    expect(screen.getByRole('heading', { name: /Onboarding & Approvals/i })).toBeInTheDocument();
    expect(screen.getByText(/Manage the complete onboarding process/i)).toBeInTheDocument();
    expect(screen.getByText(/Export Report/i)).toBeInTheDocument();
    expect(screen.getByText(/Add Application/i)).toBeInTheDocument();
  });

  it('renders all 12 KPI cards with their real values', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    const labels = ['Applications Received', 'In Progress', 'Pending Approvals', 'Identity Verification Pending', 'Merchant Approved', 'Bank Verified', 'Hardware Assigned', 'Data Imports Completed', 'Users Invited', 'Training Completed', 'Final Reviews Pending', 'Tenants Activated'];
    for (const l of labels) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Applications Received: 248')).toBeInTheDocument();
    expect(screen.getByLabelText('Tenants Activated: 64')).toBeInTheDocument();
  });

  it('shows the Approval Queue badge count from pending approvals', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    const btn = screen.getByText(/Approval Queue/i).closest('button')!;
    expect(within(btn).getByText('82')).toBeInTheDocument();
  });

  it('renders pipeline rows with tenant, stage badge, completion and specialist', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    expect(screen.getByText('Glamour Studio')).toBeInTheDocument();
    expect(screen.getAllByText('Identity Verification').length).toBeGreaterThan(0);
    expect(screen.getByText('38%')).toBeInTheDocument();
    expect(screen.getAllByText('Sarah Johnson').length).toBeGreaterThan(0);
    expect(screen.getByText(/Showing 1 to 10 of 245 entries/)).toBeInTheDocument();
  });

  it('renders an honest empty state when there are no applications', () => {
    useOverview.mockReturnValue(overview({ data: { ...overview().data, applications: { rows: [], total: 0, page: 1, pageSize: 10, totalPages: 1 } } }));
    renderScreen();
    expect(screen.getByText(/No onboarding applications match this view yet/i)).toBeInTheDocument();
  });

  it('surfaces an error with a retry action', () => {
    useOverview.mockReturnValue(overview({ data: null, error: 'Network down' }));
    renderScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('renders the dashboard modules from the overview payload', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    for (const title of ['Onboarding Workflow', 'Onboarding Completion Trend', 'Stage Distribution', 'Merchant Underwriting Status', 'Hardware Shipment Tracker', 'Data Import Status', 'Training Progress', 'Onboarding Health & Alerts', 'Pending Approvals', 'Specialist Workload', 'Recent Onboarding Activity', 'Approval Notes / Review', 'Tenant Activation Summary', 'Rejected / Expired Items']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('Total Pending')).toBeInTheDocument();
    expect(screen.getByText('Merchant verification documents pending')).toBeInTheDocument();
    expect(screen.getAllByText('Sarah Johnson').length).toBeGreaterThan(0);
  });

  it('renders all 9 Quick Actions', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    for (const a of ['Approve Step', 'Reject Step', 'Request Info', 'Assign Specialist', 'Review Documents', 'Track Hardware', 'Approve Data Import', 'Activate Tenant', 'Return for Correction']) {
      expect(screen.getByRole('button', { name: a })).toBeInTheDocument();
    }
  });

  it('Reject Step requires a reason before confirming', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Reject Step' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /Confirm/ });
    expect(confirm).toBeDisabled(); // no reason + no typed name yet
    fireEvent.change(within(dialog).getByPlaceholderText(/recorded in the audit trail/i), { target: { value: 'fraud signals' } });
    fireEvent.change(within(dialog).getByPlaceholderText('Glamour Studio'), { target: { value: 'Glamour Studio' } });
    expect(confirm).toBeEnabled();
    expect(apiMock.transition).not.toHaveBeenCalled();
  });

  it('Activate Tenant requires the typed tenant name to match', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Activate Tenant' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /Confirm/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByPlaceholderText('Glamour Studio'), { target: { value: 'Wrong Name' } });
    expect(confirm).toBeDisabled(); // mismatch
    fireEvent.change(within(dialog).getByPlaceholderText('Glamour Studio'), { target: { value: 'Glamour Studio' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(apiMock.activate).toHaveBeenCalledWith('o1', expect.objectContaining({ note: expect.any(String) }));
  });

  it('Add Application opens a real create dialog gated on an application ID', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Add Application/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add Application' });
    expect(within(dialog).getByText('New Branch for Existing Tenant')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Create Application/ })).toBeDisabled();
  });

  it('Export menu offers CSV/Excel/PDF and surfaces the honest "not configured" reason for Excel', async () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Export Report/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /CSV/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Excel/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /PDF/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Excel/ }));
    expect(await screen.findByText('Export is not configured yet.')).toBeInTheDocument();
    expect(apiMock.exportReport).toHaveBeenCalledWith(expect.anything(), 'excel');
  });

  it('Approval Queue shows two-person items and labels first vs second approval', async () => {
    useOverview.mockReturnValue(overview());
    renderScreen('approvals');
    expect(await screen.findByRole('heading', { name: 'Approval Queue' })).toBeInTheDocument();
    // a brand-new two-person item offers "First Approve"; one already first-approved offers "Second Approve"
    expect(await screen.findByRole('button', { name: 'First Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Second Approve' })).toBeInTheDocument();
    expect(screen.getByText('Awaiting 2nd approval')).toBeInTheDocument();
    expect(screen.getAllByText('two-person').length).toBe(2);
  });

  it('Approval Queue: first approval routes through decideApproval(approved)', async () => {
    useOverview.mockReturnValue(overview());
    renderScreen('approvals');
    fireEvent.click(await screen.findByRole('button', { name: 'First Approve' }));
    expect(apiMock.decideApproval).toHaveBeenCalledWith('ap1', 'approved', null);
  });

  it('Approval Queue: rejecting requires a reason', async () => {
    useOverview.mockReturnValue(overview());
    renderScreen('approvals');
    const rejectBtns = await screen.findAllByRole('button', { name: 'Reject' });
    fireEvent.click(rejectBtns[0]);
    const dialog = screen.getByRole('dialog', { name: 'Reject Approval' });
    const confirm = within(dialog).getByRole('button', { name: /^Reject$/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByPlaceholderText(/recorded in the audit trail/i), { target: { value: 'incomplete docs' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(apiMock.decideApproval).toHaveBeenCalledWith('ap1', 'rejected', 'incomplete docs');
  });

  it('clicking an application opens a detail drawer with timeline, notes, and documents', async () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Open Glamour Studio details/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Application details' });
    expect(apiMock.record).toHaveBeenCalledWith('o1');
    expect(await within(drawer).findByText('Stage History (2)')).toBeInTheDocument();
    expect(within(drawer).getByText('Notes (1)')).toBeInTheDocument();
    expect(within(drawer).getByText('Documents (2)')).toBeInTheDocument();
    // timeline + notes + documents content surfaces
    expect(within(drawer).getByText('Need a clearer ID scan')).toBeInTheDocument();
    expect(within(drawer).getByText('license.pdf')).toBeInTheDocument();
    expect(within(drawer).getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('document review: approve is gated on a clean virus scan, reject requires a reason', async () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Open Glamour Studio details/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Application details' });
    await within(drawer).findByText('Documents (2)');
    const approveBtns = within(drawer).getAllByRole('button', { name: 'Approve' });
    expect(approveBtns[0]).toBeEnabled();
    expect(approveBtns[1]).toBeDisabled();
    fireEvent.click(approveBtns[0]);
    expect(apiMock.reviewDocument).toHaveBeenCalledWith('d1', 'approved', null);
    const rejectBtns = await within(drawer).findAllByRole('button', { name: 'Reject' });
    fireEvent.click(rejectBtns[0]);
    const rd = await screen.findByRole('dialog', { name: 'Reject Document' });
    const confirm = within(rd).getByRole('button', { name: /^Reject$/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(rd).getByPlaceholderText(/recorded in the audit trail/i), { target: { value: 'blurry scan' } });
    fireEvent.click(confirm);
    expect(apiMock.reviewDocument).toHaveBeenCalledWith('d1', 'rejected', 'blurry scan');
  });

  it('shows an SLA time-in-stage badge and offers a "stalled first" sort', () => {
    useOverview.mockReturnValue(overview());
    renderScreen();
    expect(screen.getByText('⏱ 10d')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Stalled first/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Stalled first/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
