// AiQueueAssignmentOversightScreen.test.tsx — BUILD_PLAN Phase 6 (ai_queue_assignment): the Super Admin oversight the
// audit listed as MISSING, against agent C's real shapes (ai-queue-assignment-superadmin.{controller,repository}.ts).
// Platform totals (per-salon counts, auto-assigned apart, acceptance share, jobs), searchable salons, a salon's detail
// (each location's effective settings, salon defaults, open alerts, change log), and the salon kill switch: only with
// super_admin.ai.manage, reason ≥ 12 characters, a cancelled step-up said plainly, everything reloaded after a change.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api: Record<string, any> = { overview: vi.fn(), tenants: vi.fn(), tenant: vi.fn(), setAutoKill: vi.fn() };
vi.mock('../api/superAdminAiQueueAssignmentApi', async (orig) => ({ ...(await orig() as any), superAdminAiQueueAssignmentApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
let permissions: string[] = ['super_admin.operations.view', 'super_admin.ai.manage'];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', role: 'SUPER_ADMIN', permissions } }) }));
import { AiQueueAssignmentOversightScreen } from './AiQueueAssignmentOversightScreen';

const overview = {
  ok: true,
  salons: { using: 5, autoEnabled: 2, autoKilled: 1, entitled: 4 }, platformAutoActionsDisabled: false,
  recommendations: { total: 120, last30Days: 48 },
  decisions: { accepted: 40, rejected: 6, overridden: 4, kept_unassigned: 0, auto_assigned: 17, total: 67, acceptanceRate: 0.8 },
  alerts: { total: 9, open: 4, autoResolved: 3, openByType: { long_wait: 3, stuck_record: 1 }, openBySeverity: { severe: 1, warning: 3 } },
  aiCalls: { success: 30, failed: 2, blocked_limit: 0, blocked_permission: 0, blocked_unpaid: 0, total: 32, other: 0 },
  jobs: { lastScanAt: '2026-10-07T14:01:00Z', lastAutoRunAt: '2026-10-07T14:00:00Z', branchesScannedLast10Min: 6 },
  auto: { tenantsEnabled: 2 }, tenantsWithSettings: 5,
};
const salon = (over: any = {}) => ({ tenantId: 'aaaaaaaa-1111', name: 'Pilot Nails', status: 'active', branches: 3, branchesAutoOn: 2, autoKilled: false, autoKilledReason: null,
  openAlerts: 4, criticalAlerts: 1, decisions30d: 55, autoAssigned30d: 12, lastScanAt: '2026-10-07T14:01:00Z', lastAutoRunAt: '2026-10-07T14:00:00Z', ...over });
const eff = (over: any = {}) => ({ waitApproachingMin: 10, waitExceededMin: 20, waitSevereMin: 30, waitCriticalMin: 45, stuckMinutes: 30, longServiceFactor: 1.5, congestionWaitingPerTech: 2, lateGraceMin: 10,
  rotationPolicy: 'fixed_order', fixedOrder: [], autoEnabled: true, autoConfidenceFloor: 0.75, autoMaxPerRun: 5, autoDelaySeconds: 120, autoExclusions: {},
  tenantVersion: 3, branchVersion: 1, configVersion: '3.1', salonAutoKilled: false, salonAutoKilledReason: null, platformAutoActionsDisabled: false, autoAllowed: true, autoBlockedBy: null, ...over });
const detail = (over: any = {}) => ({
  tenant: { tenantId: 'aaaaaaaa-1111', name: 'Pilot Nails', status: 'active' },
  branches: [
    { branchId: 'b1111111-x', name: 'Cherry Hill', status: 'active', openAlerts: 3, lastScanAt: '2026-10-07T14:01:00Z', lastAutoRunAt: '2026-10-07T14:00:00Z', effective: eff() },
    { branchId: 'b2222222-x', name: 'Marlton', status: 'active', openAlerts: 1, lastScanAt: null, lastAutoRunAt: null, effective: eff({ waitApproachingMin: 15, autoAllowed: false, autoBlockedBy: 'platform' }) },
    { branchId: 'b3333333-x', name: 'Voorhees', status: 'active', openAlerts: 0, lastScanAt: null, lastAutoRunAt: null, effective: eff({ autoEnabled: false, autoAllowed: false, autoBlockedBy: 'disabled' }) },
  ],
  openAlerts: [{ id: 'al1', branchId: 'b1111111-x', type: 'long_wait', severity: 'severe', reason: 'Waiting 34 min (severe at 30)', ageMinutes: 34, createdAt: '2026-10-07T13:00:00Z', autoResolved: false }],
  alertsByType: { long_wait: 1 }, decisions30d: { accepted: 20, auto_assigned: 12, rejected: 0 }, aiCalls30d: { success: 9 },
  salonSettings: { ...eff(), version: 3, autoKilled: false, autoKilledReason: null, autoExclusions: { vip: true, technicianIds: ['t1', 't2'], groups: false } },
  versions: [{ version: 3, branchId: null, change: 'platform_unkill', reason: 'Rotation fixed by the owner', changedBy: 'u1', createdAt: '2026-10-06T10:00:00Z', settings: {} }],
  auto: { salonKilled: false, salonKilledReason: null, platformAutoActionsDisabled: false, branchesAllowed: 1 },
  ...over,
});

beforeEach(() => {
  permissions = ['super_admin.operations.view', 'super_admin.ai.manage'];
  for (const f of Object.values(api)) f.mockReset();
  api.overview.mockResolvedValue(overview);
  api.tenants.mockResolvedValue([salon(), salon({ tenantId: 'bbbbbbbb-2222', name: 'Glow Spa', autoKilled: true, autoKilledReason: 'Wrong assignments reported', branchesAutoOn: 0, criticalAlerts: 0 })]);
  api.tenant.mockResolvedValue(detail());
});

describe('AI Queue Assignment oversight', () => {
  it('shows platform totals per salon, the acceptance share, auto-assigned apart, alerts, AI calls and the jobs', async () => {
    render(<AiQueueAssignmentOversightScreen />);
    const text = (await screen.findAllByTestId('aq-card')).map((c) => c.textContent);
    expect(text).toContain('Salons with auto-assign on2');
    expect(text).toContain('Salons with the AI package4');
    expect(text).toContain('Recommendations (30 days)48');
    expect(text).toContain('Staff acceptance80%');
    expect(text).toContain('Auto-assigned17');
    expect(text).toContain('Open alerts4');
    expect(text).toContain('Alerts resolved automatically3');
    expect(screen.getByTestId('aq-calls')).toHaveTextContent('success 30 · failed 2 · total 32');
    expect(screen.getByTestId('aq-calls')).not.toHaveTextContent('blocked');   // zero buckets are left out
    expect(screen.getByTestId('aq-alert-types')).toHaveTextContent('long wait 3');
    expect(screen.getByTestId('aq-alert-severity')).toHaveTextContent('severe 1');
    expect(screen.getByTestId('aq-jobs')).toHaveTextContent('6 location(s) scanned in the last 10 minutes');
  });

  it('lists salons with their auto-assign state; a stopped salon shows why and offers "Allow"', async () => {
    render(<AiQueueAssignmentOversightScreen />);
    const rows = await screen.findAllByTestId('aq-tenant');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('On at 2 of 3');
    expect(rows[0]).toHaveTextContent('4 (1 critical)');
    expect(within(rows[0]).getByText('Stop auto-assign…')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Stopped — Wrong assignments reported');
    expect(within(rows[1]).getByText('Allow auto-assign…')).toBeInTheDocument();
  });

  it('searching asks the server (tenants?search)', async () => {
    render(<AiQueueAssignmentOversightScreen />);
    await screen.findAllByTestId('aq-tenant');
    api.tenants.mockResolvedValue([]);
    fireEvent.change(screen.getByLabelText('Search salons'), { target: { value: 'glow' } });
    await waitFor(() => expect(api.tenants).toHaveBeenLastCalledWith('glow'));
    expect(await screen.findByText('No salon matches.')).toBeInTheDocument();
  });

  it('opens a salon: each location\'s effective auto state + thresholds, salon defaults, open alerts, 30 days, change log', async () => {
    render(<AiQueueAssignmentOversightScreen />);
    const rows = await screen.findAllByTestId('aq-tenant');
    fireEvent.click(within(rows[0]).getByText('Details'));
    await waitFor(() => expect(api.tenant).toHaveBeenCalledWith('aaaaaaaa-1111'));
    const branches = await screen.findAllByTestId('aq-branch');
    expect(branches[0]).toHaveTextContent('On');
    expect(branches[0]).toHaveTextContent('fixed order');
    expect(branches[1]).toHaveTextContent('On, but blocked by the platform-wide switch');
    expect(branches[1]).toHaveTextContent('15 / 20 / 30 / 45');
    expect(branches[2]).toHaveTextContent('Off');
    expect(screen.getByTestId('aq-detail-auto')).toHaveTextContent('acting at 1 of 3 location(s)');
    const settings = screen.getByTestId('aq-settings');
    expect(settings).toHaveTextContent('confidence floor 75%');
    expect(settings).toHaveTextContent('Never auto-assigns: vip, technicianIds (2)');
    expect(settings).not.toHaveTextContent('groups');
    const alert = screen.getByTestId('aq-alert');
    expect(alert).toHaveTextContent('Waiting 34 min (severe at 30)');
    expect(alert).toHaveTextContent('Cherry Hill');
    expect(screen.getByTestId('aq-detail-30d')).toHaveTextContent('auto assigned 12');
    expect(screen.getByTestId('aq-version')).toHaveTextContent('v3 · platform unkill — Rotation fixed by the owner');
  });

  it('stopping a salon needs a reason of at least 12 characters, sends killed:true, then reloads salons and overview', async () => {
    api.setAutoKill.mockResolvedValue({ tenantId: 'aaaaaaaa-1111', killed: true, reason: 'x', version: 4 });
    render(<AiQueueAssignmentOversightScreen />);
    const rows = await screen.findAllByTestId('aq-tenant');
    fireEvent.click(within(rows[0]).getByText('Stop auto-assign…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'too short' } });
    fireEvent.click(screen.getByText('Stop auto-assign'));
    expect(screen.getByText('Enter at least 12 characters.')).toBeInTheDocument();
    expect(api.setAutoKill).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Front desk reports wrong technicians' } });
    fireEvent.click(screen.getByText('Stop auto-assign'));
    await waitFor(() => expect(api.setAutoKill).toHaveBeenCalledWith('aaaaaaaa-1111', true, 'Front desk reports wrong technicians'));
    expect(await screen.findByRole('status')).toHaveTextContent('Auto-assignment stopped for Pilot Nails.');
    await waitFor(() => expect(api.tenants).toHaveBeenCalledTimes(2));
    expect(api.overview).toHaveBeenCalledTimes(2);
  });

  it('allowing a stopped salon again sends killed:false; the message follows what the server says', async () => {
    api.setAutoKill.mockResolvedValue({ tenantId: 'bbbbbbbb-2222', killed: false, reason: null, version: 5 });
    render(<AiQueueAssignmentOversightScreen />);
    const rows = await screen.findAllByTestId('aq-tenant');
    fireEvent.click(within(rows[1]).getByText('Allow auto-assign…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Rotation fixed by the salon owner' } });
    fireEvent.click(screen.getByText('Allow auto-assign'));
    await waitFor(() => expect(api.setAutoKill).toHaveBeenCalledWith('bbbbbbbb-2222', false, 'Rotation fixed by the salon owner'));
    expect(await screen.findByRole('status')).toHaveTextContent('Auto-assignment allowed again for Glow Spa.');
  });

  it('without super_admin.ai.manage the screen is view-only (no kill buttons)', async () => {
    permissions = ['super_admin.operations.view'];
    render(<AiQueueAssignmentOversightScreen />);
    const rows = await screen.findAllByTestId('aq-tenant');
    expect(screen.getByTestId('aq-view-only')).toBeInTheDocument();
    expect(screen.queryByText('Stop auto-assign…')).toBeNull();
    expect(screen.queryByText('Allow auto-assign…')).toBeNull();
    fireEvent.click(within(rows[0]).getByText('Details'));
    await screen.findAllByTestId('aq-branch');
    expect(within(screen.getByTestId('aq-detail-auto')).queryByRole('button')).toBeNull();
  });

  it('a step-up that was not completed is said plainly; nothing claims success', async () => {
    api.setAutoKill.mockRejectedValue(Object.assign(new Error('Step-up required'), { code: 'STEP_UP_REQUIRED', status: 403 }));
    render(<AiQueueAssignmentOversightScreen />);
    const rows = await screen.findAllByTestId('aq-tenant');
    fireEvent.click(within(rows[0]).getByText('Stop auto-assign…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Front desk reports wrong technicians' } });
    fireEvent.click(screen.getByText('Stop auto-assign'));
    expect(await screen.findByRole('status')).toHaveTextContent('confirm your identity again (step-up)');
    expect(screen.getByRole('status')).not.toHaveTextContent('stopped for');
  });

  it('the platform-wide switch is shown when AI auto-actions are off everywhere', async () => {
    api.overview.mockResolvedValue({ ...overview, platformAutoActionsDisabled: true });
    render(<AiQueueAssignmentOversightScreen />);
    expect(await screen.findByTestId('aq-platform-off')).toBeInTheDocument();
  });

  it('failed loads say so instead of showing an empty platform', async () => {
    api.overview.mockRejectedValue(new Error('500'));
    api.tenants.mockRejectedValue(new Error('500'));
    render(<AiQueueAssignmentOversightScreen />);
    expect(await screen.findByText('Could not load the overview.')).toBeInTheDocument();
    expect(await screen.findByText('Could not load salons.')).toBeInTheDocument();
  });

  it('a failed salon detail says so', async () => {
    api.tenant.mockRejectedValue(new Error('404'));
    render(<AiQueueAssignmentOversightScreen />);
    const rows = await screen.findAllByTestId('aq-tenant');
    fireEvent.click(within(rows[0]).getByText('Details'));
    expect(await screen.findByText('Could not load this salon.')).toBeInTheDocument();
  });
});
