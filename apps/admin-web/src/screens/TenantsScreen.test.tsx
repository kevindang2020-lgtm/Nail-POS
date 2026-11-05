// Tenants/Salons QA: KPI cards + table rows from /super-admin/tenants/state, row-select opens the detail panel,
// the action menu pauses via the real suspend route, and changing a filter refetches.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { changeLifecycle: vi.fn(), state: vi.fn(), directoryOverview: vi.fn(), bulkStatus: vi.fn(), getGateway: vi.fn(), tenantHealth: vi.fn(), tenantWarnings: vi.fn(), suspend: vi.fn(), reactivate: vi.fn(), changeStatus: vi.fn(), sendWarning: vi.fn(), supportAccess: vi.fn(), createTenant: vi.fn(), audit: vi.fn(), topPerformingTenants: vi.fn(), appFlags: vi.fn(() => Promise.resolve({ flags: [] })), setAppFlag: vi.fn() } }));
vi.mock('../api/superAdminOverviewApi', () => ({ superAdminOverviewApi: { state: vi.fn() } }));
vi.mock('../api/superAdminHardwarePackagesApi', () => ({ hwApi: { tenantHardware: vi.fn(() => Promise.resolve({ package: { packageName: 'Pro Package', status: 'delivered', paymentStatus: 'paid', trackingNumber: '1Z999' }, normalizedStatus: 'delivered' })) } }));

import { superAdminApi } from '../api/superAdminApi';
import { superAdminOverviewApi } from '../api/superAdminOverviewApi';
import { TenantsScreen } from './TenantsScreen';

const row = (over: any = {}) => ({
  id: 't1', n: 'Luxe Nails & Spa', code: 'LUXE-1001', owner: 'Emily Johnson', email: 'emily@luxenails.com', phone: '(512) 555-8765',
  city: 'Houston', state: 'TX', plan: 'Enterprise', planTier: 'Premium', ai: '6', rev: '$124,850', use: 0, pay: 'Current',
  status: 'healthy', sl: 'Active', aiEnabled: true, fiserv: true, last: '2m ago', created: '', payoff: 'Paid Off', ...over,
});
const state = (over: any = {}) => ({
  kpis: [
    { lab: 'Total Tenants', val: '2,418', d: '', dt: 'up' }, { lab: 'Active Tenants', val: '1,862', d: '77%', dt: 'success' },
    { lab: 'Trial Tenants', val: '86', d: '', dt: 'warning' }, { lab: 'Suspended', val: '124', d: 'review', dt: 'danger' },
  ],
  tenants: [row(), row({ id: 't2', n: 'Diamond Nail Bar', code: 'DNB-1002', owner: 'Sophia Martinez', city: 'Miami', state: 'FL', status: 'suspended', sl: 'Paused', rev: '$96,320' })],
  pagination: { page: 1, pageSize: 10, totalItems: 2418, totalPages: 242 }, ...over,
});
const overview = () => ({ kpis: { pendingApplications: 28, monthlyCardVolumeCents: 324000000, openSupportTickets: 128, trends: { monthlyCardVolume: 18.4 } }, recentActivity: [{ id: 'ev1', icon: '🟢', title: 'New tenant registered', tenantName: 'Luxe Nails & Spa', message: 'tenant', ageLabel: '5m ago', severity: 'success' }], recentTenantApplications: [{ id: 'app1', salonName: 'Glamour Nails', owner: 'Sarah Thompson', city: 'Austin', state: 'TX', phone: null, status: 'new', date: new Date(Date.now() - 2 * 3600 * 1000).toISOString() }], topPerformingTenants: [] });
const directory = () => ({
  kpis: { totalTenants: 1248, activeTenants: 1062, trialTenants: 118, pendingApprovals: 32, suspendedTenants: 68, enterpriseTenants: 156, totalBranches: 3317, totalCustomers: 1284741, monthlyRevenueCents: 423589200, churnRiskHigh: 23, overduePayments: 8, activePosDevices: 5642, openSupportTickets: null },
  planDistribution: [{ key: 'enterprise', label: 'Enterprise', count: 156, pct: 12.5 }, { key: 'growth', label: 'Growth', count: 412, pct: 33.0 }],
  statusDistribution: [{ key: 'active', label: 'Active', count: 1062, pct: 85.1 }, { key: 'trial', label: 'Trial', count: 118, pct: 9.5 }],
  healthDistribution: [{ key: 'excellent', label: 'Excellent (90–100)', count: 312, pct: 25.0 }],
  healthAlerts: [{ key: 'high_churn_risk', label: 'tenants at high churn risk', count: 23, available: true }],
  growthTrend: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, label: 'M', totalTenants: 1000 + i * 20 })),
  onboardingPipeline: { stages: [{ key: 'received', label: 'Applications Received', count: 68 }], conversionRatePct: 17.6, available: true },
  upcomingRenewals: { rows: [{ tenantId: 'rn1', tenantName: 'Renewal Co', plan: 'Pro', renewalDate: new Date().toISOString(), daysRemaining: 24, warning: 'ok' }], available: true },
  meta: { growthDefinition: 'Total tenants existing at each month-end (cumulative).', revenueDefinition: 'sum' },
});

describe('Tenants / Salons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (superAdminApi.state as any).mockResolvedValue(state());
    // the REAL wire shape (MaskedPaymentGateway) — the old fixture used last4/cardBrand/provider, fields the API never
    // returns, which is exactly how the card got away with reading them
    (superAdminApi.getGateway as any).mockResolvedValue({ processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '••••0238', status: 'active', setupRequired: false, onboardingStatus: 'approved', terminalConfigured: true, terminalBaseUrl: 'https://bolt-uat.cardpointe.com/api' });
    (superAdminApi.tenantHealth as any).mockResolvedValue({ tenantId: 't1', tenantName: 'Luxe Nails & Spa', observedAt: '2026-09-27T10:00:00Z', overall: 'DEGRADED', failedQueries: [],
      components: { payments: { state: 'HEALTHY', reason: 'ok', details: {} }, messaging: { state: 'MISCONFIGURED', reason: 'a2p_not_approved', details: {} }, booking: { state: 'HEALTHY', reason: 'ok', details: {} }, devices: { state: 'UNKNOWN', reason: 'no_devices', details: {} }, jobs: { state: 'HEALTHY', reason: 'ok', details: {} } } });
    (superAdminApi.tenantWarnings as any).mockResolvedValue([{ id: 'w1', warningType: 'payment_issue', severity: 'high', subject: 'Overdue balance', message: 'Please settle.', sendEmail: true, sendSms: false, showInTenantDashboard: true, deliveryStatus: 'sent', createdAt: new Date().toISOString() }]);
    (superAdminOverviewApi.state as any).mockResolvedValue(overview());
    (superAdminApi.directoryOverview as any).mockResolvedValue(directory());
    (superAdminApi.bulkStatus as any).mockResolvedValue({ ok: true, total: 1, succeeded: 1, failed: 0, results: [{ id: 't1', ok: true }] });
    (superAdminApi.topPerformingTenants as any).mockResolvedValue({ tenants: [{ rank: 1, tenantId: 't1', salonName: 'Luxe Nails & Spa', salonCode: 'LUXE-1001', city: 'Houston', state: 'TX', monthlyCardVolume: 12485000, formattedMonthlyCardVolume: '$124,850', growthPercent: 24.5, trendDirection: 'up' }] });
  });

  it('renders the 12-KPI directory grid (from /tenants/directory-overview) and tenant rows', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Luxe Nails & Spa')).toBeInTheDocument();
    expect(within(table).getByText('Diamond Nail Bar')).toBeInTheDocument();
    // the directory KPIs are TenantDirectoryAnalytics' 'Filter by …' buttons since the Sep 2026 redesign
    await waitFor(() => expect(screen.getAllByTitle(/^Filter by /)).toHaveLength(12));
    const grid = screen.getAllByTitle(/^Filter by /)[0].parentElement as HTMLElement;
    expect(within(grid).getByText('1,248')).toBeInTheDocument();   // Total Tenants
    expect(within(grid).getByText('$4.24M')).toBeInTheDocument();  // Monthly Revenue from cents
    expect(within(grid).getByText('5,642')).toBeInTheDocument();   // Active POS Devices
    // Open Support Tickets is null from the endpoint but supplied from overview governance KPIs (128).
    const tickets = screen.getByTitle('Filter by Open Support Tickets');
    expect(within(tickets).getByText('128')).toBeInTheDocument();
  });

  it('selects the first tenant by default and shows its detail panel', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    expect(await screen.findByText('emily@luxenails.com')).toBeInTheDocument();   // owner email in panel
    expect(screen.getByText('Onboarding Progress')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Fiserv · Sandbox')).toBeInTheDocument());   // the gateway itself, not the subscription
    expect(screen.getByText('••••0238')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();                           // card terminal (Bolt) stored
    await waitFor(() => expect(screen.getByText('Pro Package')).toBeInTheDocument()); // live hardware card from /tenants/:id/hardware
    expect(screen.getByText('1Z999')).toBeInTheDocument();                         // tracking number shown
  });

  it('shows the selected salon\'s health: the worst in-use component as the overall, each component, and never "healthy" for an unused one', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const panel = await screen.findByTestId('tenant-health');
    await waitFor(() => expect(within(panel).getByText('Degraded')).toBeInTheDocument());       // overall
    expect(within(panel).getByText('Misconfigured')).toBeInTheDocument();                        // messaging
    expect(within(panel).getByText('Not in use')).toBeInTheDocument();                           // devices: UNKNOWN is not "Healthy"
    expect(within(panel).getAllByText('Healthy')).toHaveLength(3);
    expect(superAdminApi.tenantHealth).toHaveBeenCalledWith('t1');
  });

  it('says so when the health read fails — it does not show an empty or healthy panel', async () => {
    (superAdminApi.tenantHealth as any).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const panel = await screen.findByTestId('tenant-health');
    await waitFor(() => expect(within(panel).getByText('Health could not be read right now.')).toBeInTheDocument());
    expect(within(panel).queryByText('Healthy')).toBeNull();
  });

  it('a salon with no gateway reads "Not configured" — not its subscription status', async () => {
    (superAdminApi.getGateway as any).mockResolvedValue({ processorType: 'none', environment: 'sandbox', merchantIdMasked: '', status: 'not_configured', setupRequired: true, onboardingStatus: 'not_started', terminalConfigured: false });
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const label = await screen.findByText('Payment Gateway');
    const sec = label.closest('.dsec') as HTMLElement;
    await waitFor(() => expect(within(sec).getByText('Not configured')).toBeInTheDocument());
    expect(within(sec).queryByText('Connected')).toBeNull();
  });

  it('pauses a tenant from the row action menu via the status route (with confirmation)', async () => {
    (superAdminApi.changeStatus as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const table = await screen.findByRole('table');
    const firstRow = within(table).getByText('Luxe Nails & Spa').closest('tr') as HTMLElement;
    fireEvent.click(within(firstRow).getByTitle('More actions'));   // Sep 2026 redesign: '⋯' trigger titled 'More actions'
    fireEvent.click(within(firstRow).getByText('Pause Tenant'));   // row menu → opens the confirm modal
    // confirm modal appears. Constitution 7 §18: the pause needs a reason code AND a written reason before it can be sent
    const confirmBtn = await screen.findByRole('button', { name: 'Pause Tenant' });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Suspension reason'), { target: { value: 'BILLING' } });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);                    // code alone is not enough
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'card declined three times' } });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(superAdminApi.changeStatus).toHaveBeenCalledWith('t1', 'paused', 'card declined three times', 'BILLING'));
  });

  it('Support Mode (was View POS): a real reason first, then a server-side support session — no dead POS link opened', async () => {
    (superAdminApi.supportAccess as any).mockResolvedValue({ ok: true, sessionId: 'ss_x', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null as any);
    const changed = vi.fn(); window.addEventListener('aps:support-mode-changed', changed);
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    fireEvent.click(await screen.findByRole('button', { name: '🛟 Support Mode' }));
    // Constitution 7 §74: a real reason first — nothing sent until it is there
    const ask = await screen.findByTestId('view-pos-reason');
    expect((within(ask).getByRole('button', { name: 'Start Support Mode' }) as HTMLButtonElement).disabled).toBe(true);
    expect(superAdminApi.supportAccess).not.toHaveBeenCalled();
    fireEvent.change(within(ask).getByLabelText('Support reason'), { target: { value: 'owner reports checkout freezing' } });
    fireEvent.click(within(ask).getByRole('button', { name: 'Start Support Mode' }));
    await waitFor(() => expect(superAdminApi.supportAccess).toHaveBeenCalledWith('t1', expect.objectContaining({ reason: 'owner reports checkout freezing', source: 'tenants_salons_quick_actions' })));
    expect(await screen.findByText(/Support Mode started for this salon/)).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();                       // the shell banner refreshes at once
    expect(openSpy).not.toHaveBeenCalled();                   // D7: no link to a route that does not exist
    openSpy.mockRestore(); window.removeEventListener('aps:support-mode-changed', changed);
  });

  it('Send Warning validates and posts to the warning route', async () => {
    (superAdminApi.sendWarning as any).mockResolvedValue({ ok: true, deliveryStatus: 'pending' });
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    fireEvent.click(await screen.findByRole('button', { name: '⚠ Send Warning' }));
    // modal open; fill subject + message then send
    const dialogSend = await screen.findByRole('button', { name: 'Send Warning' });
    fireEvent.click(dialogSend);                                    // empty → blocked (no call yet)
    expect(superAdminApi.sendWarning).not.toHaveBeenCalled();
    fireEvent.change(screen.getByText('Subject').querySelector('input')!, { target: { value: 'Overdue balance' } });
    fireEvent.change(screen.getByText('Message').querySelector('textarea')!, { target: { value: 'Please update billing.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Warning' }));
    await waitFor(() => expect(superAdminApi.sendWarning).toHaveBeenCalledWith('t1', expect.objectContaining({ subject: 'Overdue balance', message: 'Please update billing.' })));
  });

  it('Recent Tenant Activity card renders an event with its icon, title, and salon name', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    expect(await screen.findByText('New tenant registered')).toBeInTheDocument();
    expect(screen.getByText('🟢')).toBeInTheDocument();
    expect(screen.getByText('Luxe Nails & Spa · tenant')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('refetches when the status filter changes', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    (superAdminApi.state as any).mockClear();
    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'suspended' } });
    await waitFor(() => expect(superAdminApi.state).toHaveBeenCalled());
  });

  it('Recent Applications card renders an application with a status badge + time, and View All carries the dashboard source', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    expect(await screen.findByText('Glamour Nails')).toBeInTheDocument();
    expect(screen.getByText('Sarah Thompson · Austin, TX')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();        // status label, colour-mapped
    expect(screen.getByText('2h ago')).toBeInTheDocument();     // submitted time
    const viewAll = screen.getAllByText('View All').find((b) => b.closest('section'));
    expect(viewAll).toBeTruthy();
  });

  it('clicking the Active Tenants KPI filters the table by active and syncs ?status', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    (superAdminApi.state as any).mockClear();
    fireEvent.click(await screen.findByTitle('Filter by Active Tenants'));
    await waitFor(() => {
      const calls = (superAdminApi.state as any).mock.calls;
      expect(calls.some((c: any[]) => c[0]?.tab === 'active')).toBe(true);
    });
  });

  it('initializes the status filter from ?status=paused (tab=suspended)', async () => {
    render(<MemoryRouter initialEntries={['/?status=paused']}><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    await waitFor(() => {
      const calls = (superAdminApi.state as any).mock.calls;
      expect(calls.some((c: any[]) => c[0]?.tab === 'suspended')).toBe(true);
    });
  });

  it('Refresh refetches the summary and the overview-fed cards', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    (superAdminApi.state as any).mockClear();
    (superAdminOverviewApi.state as any).mockClear();
    fireEvent.click(screen.getByText('↻ Refresh'));
    await waitFor(() => {
      expect((superAdminApi.state as any).mock.calls.length).toBeGreaterThan(0);
      expect((superAdminOverviewApi.state as any).mock.calls.length).toBeGreaterThan(0);
    });
    expect(await screen.findByText('Tenants / Salons data refreshed.')).toBeInTheDocument();
  });

  it('Quick Actions: Activate/Pause reflect tenant status', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    // default selection is the first row (t1, healthy/active)
    expect((screen.getByRole('button', { name: /Activate/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Pause Tenant/ }) as HTMLButtonElement).disabled).toBe(false);
    // select the suspended tenant
    fireEvent.click(screen.getByText('Diamond Nail Bar'));
    await waitFor(() => expect((screen.getByRole('button', { name: /Activate/ }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole('button', { name: /Pause Tenant/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Top Performing + Revenue-by-Tenant share the dedicated endpoint and support retry', async () => {
    (superAdminApi.topPerformingTenants as any).mockRejectedValueOnce(new Error('boom'));
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    await screen.findByRole('table');
    expect(superAdminApi.topPerformingTenants).toHaveBeenCalled();
    // Both the Revenue-by-Tenant bar and the Top Performing card surface a retry on failure.
    const retries = await screen.findAllByText('Retry');
    fireEvent.click(retries[0]);
    // After a successful refetch the ranked value renders in both modules (reconciled, single source).
    await waitFor(() => expect(screen.getAllByText('$124,850').length).toBeGreaterThanOrEqual(1));
  });

  it('Bulk Actions: select tenants, pause requires a reason (impact summary), then posts to the bulk endpoint', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByLabelText('Select Luxe Nails & Spa'));      // row checkbox
    fireEvent.click(screen.getByTitle('Bulk actions'));                            // open header menu
    fireEvent.click(screen.getByText(/Pause selected/));                           // → opens confirm modal
    expect(await screen.findByText(/about to pause 1 tenant/i)).toBeInTheDocument(); // impact summary
    const confirm = screen.getByRole('button', { name: /Pause 1/ });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);                    // reason required
    expect(superAdminApi.bulkStatus).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(/Logged with each/), { target: { value: 'billing review pending' } });
    expect((screen.getByRole('button', { name: /Pause 1/ }) as HTMLButtonElement).disabled).toBe(true);   // still needs the code (§18)
    fireEvent.change(screen.getByLabelText('Suspension reason'), { target: { value: 'BILLING' } });
    fireEvent.click(screen.getByRole('button', { name: /Pause 1/ }));
    await waitFor(() => expect(superAdminApi.bulkStatus).toHaveBeenCalledWith(['t1'], 'paused', 'billing review pending', 'BILLING'));
  });

  it('Constitution 7 §16: the detail panel shows the lifecycle state and offers only the moves the server allows', async () => {
    (superAdminApi.state as any).mockResolvedValue(state({ tenants: [row({ lifecycleState: 'PAST_DUE', lifecycleMoves: ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED'] })] }));
    (superAdminApi.changeLifecycle as any).mockResolvedValue({ ok: true, from: 'PAST_DUE', to: 'SUSPENDED', status: 'suspended' });
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const panel = await screen.findByTestId('tenant-lifecycle');
    expect(within(panel).getByText('Past due')).toBeInTheDocument();
    const select = within(panel).getByLabelText('Move lifecycle to') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED']);
    fireEvent.change(select, { target: { value: 'SUSPENDED' } });
    const apply = within(panel).getByRole('button', { name: 'Apply' });
    expect((apply as HTMLButtonElement).disabled).toBe(true);                     // suspension needs a code + reason
    fireEvent.change(within(panel).getByLabelText('Suspension reason'), { target: { value: 'BILLING' } });
    fireEvent.change(within(panel).getByLabelText('Lifecycle reason'), { target: { value: 'unpaid for 45 days' } });
    fireEvent.click(apply);
    await waitFor(() => expect(superAdminApi.changeLifecycle).toHaveBeenCalledWith('t1', 'SUSPENDED', 'unpaid for 45 days', 'BILLING'));
  });

  it('Constitution 7 §19: a suspended salon shows what its suspension cause allows, and says honestly what is not yet enforced', async () => {
    (superAdminApi.state as any).mockResolvedValue(state({ tenants: [row({ lifecycleState: 'SUSPENDED', lifecycleMoves: ['ACTIVE', 'CLOSED'], suspensionReasonCode: 'BILLING',
      suspensionPolicy: [{ capability: 'customerBooking', allowed: false, effective: false, enforced: true }, { capability: 'ownerBillingAccess', allowed: true, effective: false, enforced: false }] })] }));
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const p = await screen.findByTestId('suspension-policy');
    expect(p).toHaveTextContent('While suspended (Billing)');
    expect(p).toHaveTextContent('Customer bookings');
    expect(p).toHaveTextContent('Stopped');
    expect(p).toHaveTextContent('Owner billing access');
    expect(p).toHaveTextContent('not yet enforced (currently stopped)');
  });

  it("a refused lifecycle move shows the server's reason", async () => {
    (superAdminApi.state as any).mockResolvedValue(state({ tenants: [row({ lifecycleState: 'SUSPENDED', lifecycleMoves: ['ACTIVE', 'CLOSED'] })] }));
    (superAdminApi.changeLifecycle as any).mockResolvedValue({ ok: false, errors: ['A reason of at least 10 characters is required for this change.'] });
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    const panel = await screen.findByTestId('tenant-lifecycle');
    fireEvent.change(within(panel).getByLabelText('Move lifecycle to'), { target: { value: 'ACTIVE' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('at least 10 characters');
  });

  it('detail panel shows the Tenant Health block with score, band, and churn risk', async () => {
    (superAdminApi.state as any).mockResolvedValue(state({ tenants: [row({ healthScore: 82, healthBand: 'good', churnRisk: 'low' }), row({ id: 't2', n: 'Diamond Nail Bar', code: 'DNB-1002', owner: 'Sophia Martinez' })] }));
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    expect(await screen.findByText('Tenant Health')).toBeInTheDocument();
    expect(screen.getByText('Churn Risk')).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();      // churn risk value (panel only; capitalized via CSS)
    expect(screen.getAllByText('82').length).toBeGreaterThanOrEqual(2); // health score in both the table column and the panel
  });

  it('detail panel shows Recent Warnings with the delivery-status badge', async () => {
    render(<MemoryRouter><TenantsScreen /></MemoryRouter>);
    expect(await screen.findByText('Recent Warnings')).toBeInTheDocument();
    expect(await screen.findByText('Overdue balance')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();          // delivery status badge from the dispatch worker
    expect(superAdminApi.tenantWarnings).toHaveBeenCalled();
  });
});
