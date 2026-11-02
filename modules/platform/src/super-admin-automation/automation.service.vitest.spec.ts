import { describe, it, expect } from 'vitest';
import { AutomationService } from './automation.service';
import type { AutomationDashboardData } from './automation.repository';

const data = (): AutomationDashboardData => ({
  kpis: { activeRules: 128, executionsToday: 18642, successfulToday: 17984, failedToday: 146, disabledRules: 9, exceptionsActive: 37, notificationsToday: 2418, avgDurationMs: 74000 },
  executionTrend: [{ day: '2026-05-05', count: 2600 }, { day: '2026-05-06', count: 2900 }],
  successVsFailed: [{ day: '2026-05-06', success: 2850, failed: 50 }],
  byTrigger: [{ key: 'billing', count: 20 }, { key: 'devices', count: 18 }, { key: 'merchant_setup', count: 15 }, { key: 'other', count: 10 }],
  byStatus: [{ key: 'active', count: 71 }, { key: 'draft', count: 16 }, { key: 'error', count: 8 }, { key: 'disabled', count: 5 }],
  byType: [{ key: 'event_based', count: 74 }, { key: 'time_based', count: 29 }, { key: 'threshold_based', count: 15 }, { key: 'manual', count: 8 }, { key: 'other', count: 2 }],
  totalRules: 128,
  topRules: [{ id: 'r1', name: 'Tenant Payment Failure', triggerId: 'TENANT_PAYMENT_FAILED', triggerCategory: 'billing', ruleType: 'event_based', status: 'active', scopeKind: 'all_tenants', tenantName: null, executions: 2916, successes: 2874 }],
  executionHistory: [{ id: 'e1', startedAt: '2026-05-06T14:32:00Z', ruleName: 'Tenant Payment Failure', tenantName: 'Glam Studio', branchId: null, status: 'success', durationMs: 23000, triggeredBy: 'system' }],
  failures: [{ id: 'f1', ruleName: 'Customer Import Failed', tenantName: 'Nail Studio', failureReason: 'Email Service Timeout', severity: 'high', status: 'waiting', failureCategory: 'temporary', lastAttemptAt: '2026-05-06T14:20:00Z' }],
  exceptions: [{ id: 'x1', tenantName: 'Hair Hub', ruleName: 'Device Offline 30m', exceptionType: 'Extended Threshold', notes: '45 min instead of 30', status: 'active' }],
  recentActivity: [{ id: 'e1', startedAt: '2026-05-06T14:32:00Z', ruleName: 'Tenant Payment Failure', tenantName: 'Glam Studio', branchId: null, status: 'success', durationMs: 23000, triggeredBy: 'system' }],
  upcoming: [{ id: 'r2', ruleName: 'Device Offline 30m', triggerCategory: 'devices', ruleType: 'threshold_based', status: 'active', nextEvaluationAt: '2026-05-06T14:45:00Z', tenantName: null }],
  tenantPerf: [{ tenantId: 'A', tenantName: 'Glam Studio', total: 1200, success: 1183, failed: 17 }],
});

const svc = (d: AutomationDashboardData) => new AutomationService({ dashboardData: async () => d } as any);

describe('AutomationService', () => {
  it('maps the 8 KPIs', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.kpis.activeRules).toBe(128);
    expect(o.kpis.successfulAutomations).toBe(17984);
    expect(o.kpis.failedAutomations).toBe(146);
    expect(o.kpis.tenantExceptions).toBe(37);
    expect(o.kpis.avgExecutionMs).toBe(74000);
  });
  it('donuts + type distribution reconcile to their totals with labels', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.ruleStatus.slices.reduce((a, s) => a + s.count, 0)).toBe(o.ruleStatus.total);
    expect(o.ruleStatus.slices[0].label).toBe('Active');
    expect(o.ruleTypeDistribution.rows[0].label).toBe('Event-Based');
    expect(o.rulesByTrigger.slices[0].label).toBe('Billing');
  });
  it('top rules compute success rate and scope label', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.topRules[0].successRatePct).toBe(98.6);   // 2874/2916
    expect(o.topRules[0].scope).toBe('All Tenants');
  });
  it('tenant performance derives rates + impact', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.tenantPerformance[0].successRatePct).toBe(98.6);
    expect(o.tenantPerformance[0].impact).toBe('High');   // total >= 100
  });
  it('carries failures, exceptions, upcoming, activity through', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.failures[0].failureReason).toBe('Email Service Timeout');
    expect(o.exceptions[0].exceptionType).toBe('Extended Threshold');
    expect(o.upcoming[0].rule).toBe('Device Offline 30m');
    expect(o.recentActivity.length).toBe(1);
  });
});
