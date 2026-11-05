import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const dashboard = vi.hoisted(() => ({
  kpis: { totalBranches: 24, activeBranches: 21, newThisMonth: 2, totalStaff: 156, todaysAppointments: 412, monthlyRevenueCents: 24859260, suspendedBranches: 2, pendingOpenings: 3, openTodayBranches: 18, posDevices: 64, customersCheckedIn: 188, todaysRevenueCents: 1289520, openSupportTickets: 7, totalTechs: 140 },
  statusDistribution: { active: 21, maintenance: 1, inactive: 2, total: 24, raw: [{ status: 'active', count: 21 }, { status: 'suspended', count: 2 }, { status: 'pending', count: 1 }] },
  directory: [
    { id: 'b1aaaaaa', name: 'Downtown Branch', tenantId: 't1', tenantName: 'Luxe', city: 'New York', state: 'NY', status: 'active', manager: 'Samantha Green', staff: 24, todaysAppts: 68, revenueMtdCents: 4528750, devices: null, openTickets: 1, queueWaiting: 4, healthScore: 92 },
    { id: 'b2bbbbbb', name: 'Pending Branch', tenantId: 't2', tenantName: 'Bella', city: 'Austin', state: 'TX', status: 'pending', manager: 'Olivia Martinez', staff: 0, todaysAppts: 0, revenueMtdCents: 0, devices: null, openTickets: 0, queueWaiting: 0, healthScore: null },
  ],
  recentActivity: [{ action: 'branch_suspended', branchId: 'b1', at: '2026-06-29T10:00:00Z', actorRole: 'SUPER_ADMIN', actorName: 'Admin' }],
  healthDistribution: { excellent: 1, good: 0, average: 0, poor: 0, critical: 0, scored: 1, unscored: 1, total: 2 },
  operationalAlerts: [{ key: 'low_health', label: 'branches with low health score', count: 3, severity: 'critical', to: '/branches?healthMax=49' }],
  deviceStatus: { total: 64, online: 55, offline: 5, maintenance: 2, inactive: 2 },
  performanceTrend: [{ month: 'Jan', revenueCents: 100000, appointments: 20 }, { month: 'Feb', revenueCents: 150000, appointments: 25 }],
  topBranches: [{ id: 'b1', name: 'Downtown Branch', tenantName: 'Luxe', revenueMtdCents: 4528750 }],
  revenueByCity: [{ city: 'New York', state: 'NY', cents: 4528750 }],
  queueByBranch: [{ branchId: 'b1', name: 'Downtown Branch', count: 4 }],
  upcomingByBranch: [{ branchId: 'b1', name: 'Downtown Branch', count: 12 }],
  onboardingPipeline: { received: 3, underReview: 1, siteVerified: 0, setupInProgress: 0, readyToLaunch: 0, conversionRate: 0 },
  hoursAvailability: { full: 20, partial: 3, limited: 1, total: 24, avgAvailabilityPct: 89 },
  atAGlance: { totalBranches: 24, totalTechs: 140, customersToday: 188, apptsToday: 412, revenueTodayCents: 1289520 },
  capacity: null, healthScore: null,
}));

vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  branchesDashboard: vi.fn().mockResolvedValue(dashboard),
  branchesDirectory: vi.fn().mockResolvedValue({
    rows: dashboard.directory,
    total: dashboard.directory.length, page: 1, pageSize: 10, pages: 1,
    facets: { statuses: ['active', 'pending'], tenants: ['Bella', 'Luxe'], cities: ['Austin', 'New York'] },
  }),
  createBranch: vi.fn().mockResolvedValue({ id: 'b-new', name: 'New Downtown', status: 'pending', tenantId: 't1', city: null, state: null }),
  changeBranchStatus: vi.fn().mockResolvedValue({ id: 'b1aaaaaa', name: 'Downtown Branch', from: 'active', to: 'suspended' }),
  assignableManagers: vi.fn().mockResolvedValue({ branchTenantId: 't1', managers: [
    { id: 'u9', name: 'Sam Green', email: 's@x.com', role: 'MANAGER', currentBranchId: null },
    { id: 'u8', name: 'Pat Lee', email: 'p@x.com', role: 'OWNER', currentBranchId: 'b9' },
  ] }),
  assignBranchManager: vi.fn().mockResolvedValue({ branch: { id: 'b1aaaaaa', name: 'Downtown Branch' }, manager: { id: 'u9', name: 'Sam Green', email: 's@x.com' }, movedFromBranchId: null }),
  branchTransferOptions: vi.fn().mockResolvedValue({ branch: { id: 'b1aaaaaa', name: 'Downtown Branch', currentTenantId: 't1', currentTenantName: 'Luxe' }, destinations: [{ id: 't2', name: 'Bella', status: 'active' }, { id: 't3', name: 'Inactive Co', status: 'suspended' }] }),
  branchTransferPreflight: vi.fn().mockResolvedValue({ branch: { id: 'b1aaaaaa', name: 'Downtown Branch' }, destination: { id: 't2', name: 'Bella', status: 'active' }, impact: { staff: 24, appointments: 68, serviceRecords: 120, supportTickets: 1, queueItems: 4 }, blockers: [] }),
  requestBranchTransfer: vi.fn().mockResolvedValue({ id: 'req-1234abcd', status: 'requested', toTenantId: 't2', executed: false }),
  branchesExport: vi.fn().mockResolvedValue({ filename: 'branches-2026-06-30.csv', mime: 'text/csv', content: 'Branch,Branch ID\nDowntown Branch,b1aaaaaa', rowCount: 1 }),
  branchHours: vi.fn().mockResolvedValue({ branch: { id: 'b1aaaaaa', name: 'Downtown Branch' }, days: [
    { dayOfWeek: 0, label: 'Sunday', isClosed: true, opensAt: null, closesAt: null, set: true },
    { dayOfWeek: 1, label: 'Monday', isClosed: false, opensAt: '09:00', closesAt: '17:00', set: true },
    { dayOfWeek: 2, label: 'Tuesday', isClosed: false, opensAt: '09:00', closesAt: '17:00', set: true },
    { dayOfWeek: 3, label: 'Wednesday', isClosed: false, opensAt: '09:00', closesAt: '17:00', set: true },
    { dayOfWeek: 4, label: 'Thursday', isClosed: false, opensAt: '09:00', closesAt: '17:00', set: true },
    { dayOfWeek: 5, label: 'Friday', isClosed: false, opensAt: '09:00', closesAt: '19:00', set: true },
    { dayOfWeek: 6, label: 'Saturday', isClosed: false, opensAt: '10:00', closesAt: '16:00', set: true },
  ] }),
  setBranchHours: vi.fn().mockResolvedValue({ count: 7 }),
  bulkBranchStatus: vi.fn().mockResolvedValue({ status: 'suspended', summary: { total: 1, succeeded: 1, failed: 0 }, results: [{ id: 'b1aaaaaa', name: 'Downtown Branch', ok: true, message: 'active → suspended' }] }),
  branchDevices: vi.fn().mockResolvedValue({ branch: { id: 'b1aaaaaa', name: 'Downtown Branch' }, tenantId: 't1', devices: [
    { id: 'term-1', category: 'Payment Terminal', deviceType: 'terminal', name: 'Lane 1', status: 'paired', currentBranchName: null, onThisBranch: false, allocatable: true },
    { id: 'disp-1', category: 'Customer Display', deviceType: 'display', name: 'Front Display', status: 'paired', currentBranchName: 'Uptown Branch', onThisBranch: false, allocatable: true },
    { id: 'hw-1', category: 'Leased Hardware', deviceType: 'hardware', name: 'iPad Pro', status: 'assigned', currentBranchName: null, onThisBranch: false, allocatable: false },
  ] }),
  allocateDevice: vi.fn().mockResolvedValue({ device: { id: 'term-1', name: 'Lane 1' }, movedFromBranchId: null }),
} }));

import { BranchesScreen } from './BranchesScreen';

// Sep 2026 redesign: per-branch actions live in the row's '⋯ Actions' menu (the page's Quick Actions reuse some labels,
// so the item is looked up inside the opened menu).
async function openBranchMenuItem(item: RegExp) {
  const trigger = await screen.findByRole('button', { name: 'More actions for Downtown Branch' });
  fireEvent.click(trigger);
  fireEvent.click(within(trigger.parentElement as HTMLElement).getByRole('button', { name: item }));
}

describe('BranchesScreen (Super Admin › Branches)', () => {
  it('renders the title, 10 KPIs, directory, and all reference modules from the real aggregate', async () => {
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    expect(await screen.findByText('Centralized branch management with full operational visibility across all tenants.')).toBeInTheDocument();

    // 10 KPI cards (some labels also appear in At-a-Glance, so assert presence ≥1)
    for (const label of ['Total Branches', 'Active Branches', 'Pending Openings', 'Suspended Branches', 'Open Today', 'POS Devices', "Today's Appointments", "Today's Revenue", 'Customers Checked In', 'Open Support Tickets']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }

    // Directory + a real row + honest pre-operational health gap (directory loads on its own async tick — await it)
    expect(screen.getByText('All Branches Directory')).toBeInTheDocument();
    expect(await screen.findByText('Pending Branch')).toBeInTheDocument();
    expect(screen.getAllByText('Downtown Branch').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Showing 1 to 2 of 2 branches')).toBeInTheDocument();

    // Right column modules
    expect(screen.getByText('Branch Health & Alerts')).toBeInTheDocument();
    expect(screen.getByText('Operational Alerts')).toBeInTheDocument();
    expect(screen.getByText('Branch Status Distribution')).toBeInTheDocument();
    expect(screen.getByText('Device Status Overview')).toBeInTheDocument();

    // Lower analytics modules
    expect(screen.getByText('Branch Performance Trend')).toBeInTheDocument();
    expect(screen.getByText('Top Performing Branches')).toBeInTheDocument();
    expect(screen.getByText('Revenue by City')).toBeInTheDocument();
    expect(screen.getByText('Live Queue Monitor by Branch')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Appointments by Branch')).toBeInTheDocument();
    expect(screen.getByText('Recent Branch Activity')).toBeInTheDocument();
    expect(screen.getByText('Branch Onboarding Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Branch Hours & Availability')).toBeInTheDocument();
    expect(screen.getByText('Tech Utilization Overview')).toBeInTheDocument();
    expect(screen.getByText('At-a-Glance Summary')).toBeInTheDocument();

    // Tech utilization is an honest documented gap
    expect(screen.getAllByText(/not connected/).length).toBeGreaterThanOrEqual(1);

    // 10 Quick Actions
    const qa = screen.getByText('Quick Actions').parentElement as HTMLElement;
    for (const label of ['Add Branch', 'Bulk Update', 'Assign Manager', 'View Reports', 'Export Data', 'Branch Health', 'Device Allocation', 'Opening Requests', 'Send Notice', 'Manage Hours']) {
      expect(within(qa).getByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it('opens the controlled Add Branch workflow (requires a reason, no fake persistence)', async () => {
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    const addButtons = await screen.findAllByText(/Add Branch/);
    addButtons[0].click();
    expect(await screen.findByRole('dialog', { name: /Add Branch/ })).toBeInTheDocument();
  });

  it('submits the Add Branch form to the real createBranch command and shows success', async () => {
    const { superAdminApi } = await import('../api/superAdminApi');
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    (await screen.findAllByText(/Add Branch/))[0].click();
    const dialog = await screen.findByRole('dialog', { name: /Add Branch/ });
    fireEvent.change(within(dialog).getByText('Select tenant…').closest('select') as HTMLSelectElement, { target: { value: 't1' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Glamour Studio/) as HTMLInputElement, { target: { value: 'New Downtown' } });
    const textboxes = within(dialog).getAllByRole('textbox');
    fireEvent.change(textboxes[textboxes.length - 1], { target: { value: 'pilot expansion' } }); // reason textarea is last
    fireEvent.click(within(dialog).getByText('Create Branch'));
    expect(await screen.findByText(/created successfully/)).toBeInTheDocument();   // Sep 2026 redesign wording
    expect(superAdminApi.createBranch).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', name: 'New Downtown', reason: 'pilot expansion' }));
  });

  it('changes branch status via the controlled lifecycle command (typed confirmation for suspend)', async () => {
    const { superAdminApi } = await import('../api/superAdminApi');
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    await screen.findByText('All Branches Directory');
    // Sep 2026 redesign: status lives in the row's actions menu
    await openBranchMenuItem(/Change Status/);
    const dialog = await screen.findByRole('dialog', { name: /Change status/ });
    fireEvent.change(within(dialog).getByText('Select…').closest('select') as HTMLSelectElement, { target: { value: 'suspended' } });
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: 'fraud review' } }); // reason textarea
    fireEvent.change(within(dialog).getByPlaceholderText('Downtown Branch'), { target: { value: 'Downtown Branch' } }); // typed confirm
    fireEvent.click(within(dialog).getByText(/Apply Suspended/));
    await waitFor(() => expect(superAdminApi.changeBranchStatus).toHaveBeenCalledWith('b1aaaaaa', expect.objectContaining({ status: 'suspended', reason: 'fraud review', confirmName: 'Downtown Branch' })));
  });

  it('assigns a branch manager via the controlled command (validated, audited)', async () => {
    const { superAdminApi } = await import('../api/superAdminApi');
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    await screen.findByText('All Branches Directory');
    await openBranchMenuItem(/Assign Manager/);   // row actions menu (Sep 2026 redesign)
    const dialog = await screen.findByRole('dialog', { name: /Assign manager/ });
    await within(dialog).findByText('Select…');
    fireEvent.change(within(dialog).getByText('Select…').closest('select') as HTMLSelectElement, { target: { value: 'u9' } });
    fireEvent.change(within(dialog).getAllByRole('textbox').slice(-1)[0], { target: { value: 'promotion' } }); // reason textarea (last textbox)
    fireEvent.click(within(dialog).getByText('Assign Manager'));
    await waitFor(() => expect(superAdminApi.assignBranchManager).toHaveBeenCalledWith('b1aaaaaa', expect.objectContaining({ managerUserId: 'u9', reason: 'promotion' })));
    expect(await screen.findByText(/assigned to/)).toBeInTheDocument();
  });

  it('records a controlled branch-transfer request (impact preflight, typed confirm, not executed)', async () => {
    const { superAdminApi } = await import('../api/superAdminApi');
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    await screen.findByText('All Branches Directory');
    await openBranchMenuItem(/Transfer Branch/);   // row actions menu (Sep 2026 redesign)
    const dialog = await screen.findByRole('dialog', { name: /Transfer branch/ });
    fireEvent.change(await within(dialog).findByText('Select…').then((el) => el.closest('select') as HTMLSelectElement), { target: { value: 't2' } });
    await within(dialog).findByText(/Impact snapshot/); // preflight loaded
    fireEvent.change(within(dialog).getAllByRole('textbox').slice(-2)[0], { target: { value: 'consolidating into the parent group' } }); // reason textarea
    fireEvent.change(within(dialog).getByPlaceholderText('Downtown Branch'), { target: { value: 'Downtown Branch' } }); // typed confirm
    fireEvent.click(within(dialog).getByText('Request Transfer'));
    await waitFor(() => expect(superAdminApi.requestBranchTransfer).toHaveBeenCalledWith('b1aaaaaa', expect.objectContaining({ destinationTenantId: 't2', confirmName: 'Downtown Branch', reason: 'consolidating into the parent group' })));
    expect(await screen.findByText(/Recorded for review/)).toBeInTheDocument();
  });

  it('exports the directory through the audited server endpoint and triggers a download', async () => {
    const { superAdminApi } = await import('../api/superAdminApi');
    const createUrl = vi.fn().mockReturnValue('blob:x');
    const revokeUrl = vi.fn();
    (global.URL as any).createObjectURL = createUrl;
    (global.URL as any).revokeObjectURL = revokeUrl;
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    await screen.findByText('All Branches Directory');
    fireEvent.click(screen.getByRole('button', { name: /Export Report/ }));
    await waitFor(() => expect(superAdminApi.branchesExport).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalled(); // Blob download path exercised
  });

  it('edits and saves branch operating hours (validated week, audited)', async () => {
    const { superAdminApi } = await import('../api/superAdminApi');
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    await screen.findByText('All Branches Directory');
    await openBranchMenuItem(/Operating Hours/);   // row actions menu (Sep 2026 redesign)
    const dialog = await screen.findByRole('dialog', { name: /Operating hours/ });
    await within(dialog).findByLabelText('Monday opens');
    fireEvent.change(within(dialog).getByLabelText('Monday opens'), { target: { value: '08:30' } });
    fireEvent.click(within(dialog).getByLabelText('Tuesday closed'));
    fireEvent.click(within(dialog).getByText('Save Hours'));
    await waitFor(() => expect(superAdminApi.setBranchHours).toHaveBeenCalled());
    const payload = (superAdminApi.setBranchHours as any).mock.calls[0][1];
    expect(payload.days.find((d: any) => d.dayOfWeek === 1).opensAt).toBe('08:30');
    expect(payload.days.find((d: any) => d.dayOfWeek === 2)).toMatchObject({ isClosed: true, opensAt: null });
    expect(await screen.findByText('Operating hours saved.')).toBeInTheDocument();
  });

  it('selects branches and applies a bulk status change (per-branch validation, audited)', async () => {
    const { superAdminApi } = await import('../api/superAdminApi');
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    await screen.findByText('All Branches Directory');
    fireEvent.click(await screen.findByLabelText('Select Downtown Branch'));
    fireEvent.click(await screen.findByText('Bulk status…'));
    const dialog = await screen.findByRole('dialog', { name: /Bulk status/ });
    fireEvent.change(within(dialog).getByText('Select…').closest('select') as HTMLSelectElement, { target: { value: 'suspended' } });
    fireEvent.change(within(dialog).getAllByRole('textbox').slice(-1)[0], { target: { value: 'fraud sweep' } });
    fireEvent.click(within(dialog).getByText('Apply to 1'));
    await waitFor(() => expect(superAdminApi.bulkBranchStatus).toHaveBeenCalledWith(expect.objectContaining({ branchIds: ['b1aaaaaa'], status: 'suspended', reason: 'fraud sweep' })));
    expect(await within(dialog).findByText(/1 of 1 updated/)).toBeInTheDocument();
  });

  it('allocates a device to the branch (allocatable types only, audited)', async () => {
    const { superAdminApi } = await import('../api/superAdminApi');
    render(<MemoryRouter><BranchesScreen /></MemoryRouter>);
    await screen.findByText('All Branches Directory');
    await openBranchMenuItem(/Device Allocation/);   // row actions menu (Sep 2026 redesign)
    const dialog = await screen.findByRole('dialog', { name: /Devices —/ });
    await within(dialog).findByText('Lane 1');
    expect(within(dialog).getByText('Not allocatable')).toBeInTheDocument(); // leased hardware gated
    fireEvent.click(within(dialog).getByText('Allocate here')); // the terminal with no current branch
    await waitFor(() => expect(superAdminApi.allocateDevice).toHaveBeenCalledWith('b1aaaaaa', { deviceId: 'term-1', category: 'terminal' }));
    expect(await within(dialog).findByText(/allocated to/)).toBeInTheDocument();
  });
});
