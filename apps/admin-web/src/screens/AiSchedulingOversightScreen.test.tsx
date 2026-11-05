// AiSchedulingOversightScreen.test.tsx — BUILD_PLAN Phase 7 (ai_scheduling_optimizer): Super Admin oversight against
// agent B's shapes (@aipowersalon/api-contracts/platform Sa*). Applied split manual vs automated (the old screen counted
// manual applications as "auto actions"), salons, the support-session gate on a salon's detail, and the writes — only with
// super_admin.ai.manage, reason ≥ 12, a cancelled step-up said plainly, everything reloaded after a change.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api: Record<string, any> = { overview: vi.fn(), tenants: vi.fn(), tenant: vi.fn(), retry: vi.fn(), rollback: vi.fn(), disable: vi.fn(), platformSwitch: vi.fn(), startSupportSession: vi.fn() };
vi.mock('../api/superAdminAiSchedulingOptimizerApi', async (orig) => ({ ...(await orig() as any), superAdminAiSchedulingOptimizerApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
let permissions: string[] = ['super_admin.operations.view', 'super_admin.ai.manage'];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', role: 'SUPER_ADMIN', permissions } }) }));
import { AiSchedulingOversightScreen } from './AiSchedulingOversightScreen';

const overview = (o: any = {}) => ({
  enabledTenants: 7, killedTenants: 1, platformKilled: false,
  runs: { total: 400, completed: 390, failed: 10, last24h: 31 },
  recommendations: { review_required: 12, applied: 80, rejected: 9 },
  applied: { manual: 64, automated: 16, failed: 3 },
  proposals: { customer_notified: 4, customer_approved: 9 },
  conflictsOpen: 5, understaffingOpen: 2, explanations: { llm: 50, template: 70 }, llmCostMicroUsd30d: 2340000, generatedAt: '2026-10-08T12:00:00Z', ...o,
});
const salon = (o: any = {}) => ({ tenantId: 'aaaaaaaa-1111', tenantName: 'Pilot Nails', enabled: true, killed: false, runs30d: 60, applied30d: 12, failed30d: 2, lastRunAt: '2026-10-08T11:00:00Z', ...o });
const detail = (o: any = {}) => ({
  tenantId: 'aaaaaaaa-1111', supportSessionId: 'sess1234-5678',
  settings: { enabled: true, killed: false, automationAllowed: true, version: 7 },
  runs: [{ id: 'run1', scope: 'branch_day', status: 'failed', startedAt: '2026-10-08T10:00:00Z', errorCode: 'BOOKING_UNAVAILABLE' }],
  failedApplications: [{ recommendationId: 'rec11111-x', status: 'application_failed', errorCode: 'SLOT_TAKEN', attempt: 2, updatedAt: '2026-10-08T10:05:00Z' }, { recommendationId: 'rec22222-x', status: 'applied', errorCode: null, attempt: 1, updatedAt: '2026-10-08T09:00:00Z' }],
  recommendationsByStatus: { applied: 10, application_failed: 1 }, ...o,
});
beforeEach(() => {
  permissions = ['super_admin.operations.view', 'super_admin.ai.manage'];
  Object.values(api).forEach((f) => f.mockReset());
  api.overview.mockResolvedValue(overview());
  api.tenants.mockResolvedValue([salon(), salon({ tenantId: 'bbbbbbbb-2222', tenantName: 'Glow Spa', killed: true, enabled: false })]);
  api.tenant.mockResolvedValue(detail());
});

describe('AiSchedulingOversightScreen', () => {
  it('platform counts: applied by staff and automatically counted apart, recommendations / proposals by status, cost', async () => {
    render(<AiSchedulingOversightScreen />);
    const cards = await screen.findAllByTestId('sched-card');
    const text = cards.map((c) => c.textContent).join('|');
    expect(text).toContain('Applied by staff64');
    expect(text).toContain('Applied automatically16');
    expect(text).toContain('AI cost (30 days)$2.34');
    expect(screen.getByTestId('sched-recs-by-status').textContent).toContain('review required 12');
    expect(screen.getByTestId('sched-proposals').textContent).toContain('customer approved 9');
  });

  it('salons list; a stopped salon has no Switch off button', async () => {
    render(<AiSchedulingOversightScreen />);
    const rows = await screen.findAllByTestId('sched-tenant');
    expect(rows[0].textContent).toContain('Pilot Nails');
    expect(within(rows[0]).getByText('Switch off…')).toBeTruthy();
    expect(rows[1].textContent).toContain('Switched off (kill switch)');
    expect(within(rows[1]).queryByText('Switch off…')).toBeNull();
  });

  it('detail inside a support session: settings, runs, failed applications with retry / roll back', async () => {
    api.retry.mockResolvedValue({ ok: true });
    render(<AiSchedulingOversightScreen />);
    fireEvent.click(within((await screen.findAllByTestId('sched-tenant'))[0]).getByText('Details'));
    expect((await screen.findByTestId('sched-detail-settings')).textContent).toContain('settings v7');
    expect(screen.getByTestId('sched-detail-run').textContent).toContain('BOOKING_UNAVAILABLE');
    const apps = screen.getAllByTestId('sched-failed-app');
    expect(within(apps[1]).getByText('Roll back…')).toBeTruthy();
    fireEvent.click(within(apps[0]).getByText('Retry…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'too short' } });
    fireEvent.click(screen.getByText('Retry'));
    expect(screen.getByText('Enter at least 12 characters.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Salon owner asked us to retry' } });
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('aaaaaaaa-1111', 'rec11111-x', 'Salon owner asked us to retry'));
    expect(await screen.findByRole('status')).toHaveTextContent('Retry sent.');
    await waitFor(() => expect(api.tenant).toHaveBeenCalledTimes(2));
  });

  it('no support session → the detail asks for one; starting it reloads the detail', async () => {
    api.tenant.mockRejectedValueOnce(Object.assign(new Error('Open a support session for this salon first'), { status: 403, code: 'SUPPORT_SESSION_REQUIRED' }));
    api.startSupportSession.mockResolvedValue({ ok: true, sessionId: 's1' });
    render(<AiSchedulingOversightScreen />);
    fireEvent.click(within((await screen.findAllByTestId('sched-tenant'))[0]).getByText('Details'));
    const gate = await screen.findByTestId('sched-needs-session');
    expect(gate.textContent).toContain('Open a support session');
    fireEvent.click(within(gate).getByText('Start a support session…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Investigating failed applies' } });
    fireEvent.click(screen.getByText('Start support session'));
    await waitFor(() => expect(api.startSupportSession).toHaveBeenCalledWith('aaaaaaaa-1111', 'Investigating failed applies'));
    expect(await screen.findByTestId('sched-detail-settings')).toBeTruthy();
  });

  it('switch a salon off: reason, then salons + overview reload; a cancelled step-up is said plainly', async () => {
    api.disable.mockResolvedValueOnce({ ok: true, killed: true });
    render(<AiSchedulingOversightScreen />);
    fireEvent.click(within((await screen.findAllByTestId('sched-tenant'))[0]).getByText('Switch off…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Double bookings reported today' } });
    fireEvent.click(screen.getByText('Switch off'));
    await waitFor(() => expect(api.disable).toHaveBeenCalledWith('aaaaaaaa-1111', 'Double bookings reported today'));
    expect(await screen.findByRole('status')).toHaveTextContent('switched off for Pilot Nails');
    await waitFor(() => expect(api.tenants).toHaveBeenCalledTimes(2));
    expect(api.overview).toHaveBeenCalledTimes(2);
    api.disable.mockRejectedValueOnce(Object.assign(new Error('step up'), { status: 403, code: 'STEP_UP_REQUIRED' }));
    fireEvent.click(within(screen.getAllByTestId('sched-tenant')[0]).getByText('Switch off…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Double bookings reported today' } });
    fireEvent.click(screen.getByText('Switch off'));
    expect(await screen.findByText(/step-up/)).toBeInTheDocument();
  });

  it('platform switch: pause everywhere sends killed:true; when paused the banner shows and the button switches back on', async () => {
    api.platformSwitch.mockResolvedValue({ ok: true, killed: true });
    render(<AiSchedulingOversightScreen />);
    fireEvent.click(await screen.findByText('Pause for every salon…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Engine incident under review' } });
    fireEvent.click(screen.getByText('Pause everywhere'));
    await waitFor(() => expect(api.platformSwitch).toHaveBeenCalledWith(true, 'Engine incident under review'));
    api.overview.mockResolvedValue(overview({ platformKilled: true }));
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2));
  });

  it('without super_admin.ai.manage: view only, no write buttons', async () => {
    permissions = ['super_admin.operations.view'];
    api.overview.mockResolvedValue(overview({ platformKilled: true }));
    render(<AiSchedulingOversightScreen />);
    await screen.findAllByTestId('sched-tenant');
    expect(screen.getByTestId('sched-view-only')).toBeTruthy();
    expect(screen.getByTestId('sched-platform-off')).toBeTruthy();
    expect(screen.queryByText('Switch off…')).toBeNull();
    expect(screen.queryByText('Switch back on platform-wide…')).toBeNull();
    fireEvent.click(within(screen.getAllByTestId('sched-tenant')[0]).getByText('Details'));
    await screen.findByTestId('sched-detail-settings');
    expect(screen.queryByText('Retry…')).toBeNull();
    expect(screen.queryByText('Roll back…')).toBeNull();
  });
});
