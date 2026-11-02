import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutomationDashboard } from '../api/superAdminAutomationApi';

const { mockDash, mockTest, mockRetry, mockStatus, mockCreate, mockExc } = vi.hoisted(() => ({ mockDash: vi.fn(), mockTest: vi.fn(), mockRetry: vi.fn(), mockStatus: vi.fn(), mockCreate: vi.fn(), mockExc: vi.fn() }));
vi.mock('../api/superAdminAutomationApi', async () => {
  const actual = await vi.importActual<any>('../api/superAdminAutomationApi');
  return { ...actual, superAdminAutomationApi: { dashboard: () => mockDash(), testRule: (b: any) => mockTest(b), retryFailure: (id: any) => mockRetry(id), setStatus: (id: any, b: any) => mockStatus(id, b), createRule: (b: any) => mockCreate(b), createException: (b: any) => mockExc(b) } };
});

import { AutomationRulesScreen } from './AutomationRulesScreen';

const dash = (): { ok: true } & AutomationDashboard => ({
  ok: true,
  meta: { generatedAt: '2026-05-06T14:34:00Z', scope: 'platform' },
  kpis: { activeRules: 128, executionsToday: 18642, successfulAutomations: 17984, failedAutomations: 146, disabledRules: 9, tenantExceptions: 37, notificationsTriggered: 2418, avgExecutionMs: 74000 },
  executionTrend: [{ day: '2026-05-05', count: 2600 }, { day: '2026-05-06', count: 2800 }],
  successVsFailed: [{ day: '2026-05-05', success: 2500, failed: 100 }, { day: '2026-05-06', success: 2700, failed: 100 }],
  rulesByTrigger: { total: 128, slices: [{ key: 'billing', label: 'Billing', count: 26, pct: 20 }, { key: 'devices', label: 'Devices', count: 23, pct: 18 }] },
  ruleStatus: { total: 128, slices: [{ key: 'active', label: 'Active', count: 91, pct: 71 }, { key: 'draft', label: 'Draft', count: 20, pct: 16 }] },
  ruleTypeDistribution: { total: 128, rows: [{ key: 'event_based', label: 'Event-Based', count: 74, pct: 58 }, { key: 'time_based', label: 'Time-Based', count: 29, pct: 22.7 }] },
  topRules: [{ id: 'r1', name: 'Tenant Payment Failure', trigger: 'TENANT_PAYMENT_FAILED', triggerCategory: 'billing', ruleType: 'event_based', scope: 'All Tenants', status: 'active', executions: 2916, successRatePct: 98.6 }],
  executionHistory: [{ id: 'e1', time: '2026-05-06T14:32:00Z', rule: 'Tenant Payment Failure', tenant: 'Glam Studio', branchId: null, result: 'success', durationMs: 23000, triggeredBy: 'system' }],
  failures: [{ id: 'f1', rule: 'Customer Import Failed', tenant: 'Nail Studio', failureReason: 'Email Service Timeout', severity: 'high', status: 'waiting', category: 'temporary', lastAttempt: '2026-05-06T14:28:00Z' }],
  exceptions: [{ id: 'x1', tenant: 'Hair Hub', rule: 'Device Offline 30m', exceptionType: 'extended_threshold', notes: '45 min instead of 30', status: 'active' }],
  recentActivity: [{ id: 'e1', rule: 'Tenant Payment Failure', tenant: 'Glam Studio', branchId: null, result: 'success', time: '2026-05-06T14:32:00Z' }],
  upcoming: [{ id: 'r2', rule: 'Device Offline 30m', time: '2026-05-06T14:45:00Z', tenant: null, triggerCategory: 'devices', status: 'active' }],
  tenantPerformance: [{ tenantId: 'A', tenant: 'Glam Studio', successRatePct: 98.6, failureRatePct: 1.4, impact: 'High' }],
  totalRules: 128,
});

const renderScreen = () => render(<MemoryRouter><AutomationRulesScreen /></MemoryRouter>);
beforeEach(() => { mockDash.mockReset(); mockTest.mockReset(); mockRetry.mockReset(); mockStatus.mockReset(); mockTest.mockResolvedValue({ ok: true, dryRun: true, triggerMatched: true, conditionsPassed: true, trace: [], resolvedActions: ['send_platform_notification'], skippedActions: [], warnings: [] }); mockRetry.mockResolvedValue({ ok: true, status: 'retrying', class: 'temporary' }); mockStatus.mockResolvedValue({ ok: true, status: 'disabled' }); mockCreate.mockReset(); mockExc.mockReset(); mockCreate.mockResolvedValue({ ok: true, id: 'new1' }); mockExc.mockResolvedValue({ ok: true, id: 'exc1' }); });

describe('AutomationRulesScreen', () => {
  it('renders title, subtitle, and all 8 KPI cards', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Automation Rules')).toBeInTheDocument());
    expect(screen.getByText('Creates conditional platform workflows.', { exact: false })).toBeInTheDocument();
    for (const l of ['Active Rules', 'Executions Today', 'Successful Automations', 'Failed Automations', 'Disabled Rules', 'Tenant-Specific Exceptions', 'Notifications Triggered', 'Avg Execution Time'])
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getAllByText('01m 14s').length).toBeGreaterThan(0);
  });

  it('renders 9 Automation Rule Controls and 7 example rules', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Automation Rule Controls')).toBeInTheDocument());
    for (const c of ['Create Rules', 'Define Triggers', 'Define Conditions', 'Define Actions', 'Test Rules', 'Enable or Disable Rules', 'Review Execution History', 'Retry Failed Automation', 'Set Tenant-Specific Exceptions'])
      expect(screen.getAllByText(c).length).toBeGreaterThan(0);
    expect(screen.getByText('When a tenant fails payment, notify billing.')).toBeInTheDocument();
    expect(screen.getByText('When onboarding reaches 100%, request final approval.')).toBeInTheDocument();
  });

  it('renders the four analytics, four tables, and lower panels', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Execution Trend (Last 7 Days)')).toBeInTheDocument());
    for (const m of ['Success vs Failed Automations', 'Rules by Trigger Type', 'Rule Status', 'Top Automation Rules', 'Execution History', 'Failed Automations & Retry Queue', 'Tenant-Specific Exceptions', 'Recent Automation Activity', 'Upcoming Rule Evaluations', 'Automation Performance by Tenant (Top 5)', 'Rule Type Distribution'])
      expect(screen.getAllByText(m).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tenant Payment Failure').length).toBeGreaterThan(0);
    expect(screen.getByText('Email Service Timeout')).toBeInTheDocument();
  });

  it('renders 7 Quick Actions and 6 At-a-Glance cards', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Quick Actions')).toBeInTheDocument());
    for (const a of ['View Failures', 'Retry Queue', 'Set Exceptions', 'Open Tenant Profile'])
      expect(screen.getAllByText(a).length).toBeGreaterThan(0);
    expect(screen.getByText('At-a-Glance Summary (Today)')).toBeInTheDocument();
    for (const c of ['Rules Executed Today', 'Successful Runs', 'Failed Runs', 'Notifications Sent', 'Exceptions Active', 'Avg Rule Latency'])
      expect(screen.getByText(c)).toBeInTheDocument();
  });

  it('filters the Top Automation Rules table by status', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Tenant Payment Failure').length).toBeGreaterThan(0));
    // pick a status with no matching top rule → table empties
    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'draft' } });
    await waitFor(() => expect(screen.getByText('No rules match the filters.')).toBeInTheDocument());
  });

  it('runs a dry-run test through the test modal and shows would-run actions', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Test Rules')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Test Rules'));
    await waitFor(() => expect(screen.getByText('Test Rule (Dry Run)')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Run Test'));
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Would run:', { exact: false })).toBeInTheDocument());
  });

  it('retries only temporary failures via the retry queue', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Email Service Timeout')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('f1'));
  });


  it('creates a rule as a draft through the Create Rule modal', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('+ Create Rule')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ Create Rule'));
    await waitFor(() => expect(screen.getByLabelText('Rule name')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'My Payment Rule' } });
    fireEvent.click(screen.getByText('Save Draft'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Payment Rule', actions: expect.any(Array) })));
  });

  it('rejects a safety-bypassing exception with a clear message', async () => {
    mockExc.mockResolvedValue({ ok: false, error: 'exception_cannot_bypass_safety' });
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Set Exceptions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Set Exceptions'));
    await waitFor(() => expect(screen.getByLabelText('Tenant ID')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: '11111111-1111-1111-1111-111111111111' } });
    fireEvent.change(screen.getByLabelText('Exception type'), { target: { value: 'Bypass isolation' } });
    fireEvent.click(screen.getByText('Create Exception'));
    await waitFor(() => expect(mockExc).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('weaken a hard safety rule', { exact: false })).toBeInTheDocument());
  });

});
