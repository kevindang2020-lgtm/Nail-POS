// automation.service.ts — composes automation-core over AutomationRepository into the full Automation Rules dashboard:
// 8 KPIs, execution trend, success-vs-failed, trigger/status/type distributions, top rules, execution history,
// failures/retry queue, tenant exceptions, recent activity, upcoming evaluations, tenant performance. Read-only.
import type { OverviewScope } from '@aipowersalon/database';
import type { AutomationRepository } from './automation.repository';
import { successRatePct } from './automation-core';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { AutomationDashboard } from '@aipowersalon/api-contracts/platform';
import type { AutomationDashboard } from '@aipowersalon/api-contracts/platform';

export interface AdminCtx { userId?: string; email?: string; ip?: string; canManageSensitive?: boolean }

const CAT_LABEL: Record<string, string> = { billing: 'Billing', devices: 'Devices', merchant_setup: 'Merchant Setup', customer_imports: 'Customer Imports', plan_limits: 'Plan Limits', chargebacks: 'Chargebacks', onboarding: 'Onboarding', other: 'Other' };
const TYPE_LABEL: Record<string, string> = { event_based: 'Event-Based', time_based: 'Time-Based', threshold_based: 'Threshold-Based', manual: 'Manual', other: 'Other' };
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', pending_review: 'Pending Review', approved: 'Approved', active: 'Active', paused: 'Paused', disabled: 'Disabled', error: 'Error', retired: 'Retired', archived: 'Archived' };
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);


export class AutomationService {
  constructor(private readonly repo: AutomationRepository) {}

  async getDashboard(_ctx: AdminCtx, q: { scope?: OverviewScope }): Promise<AutomationDashboard> {
    const d = await this.repo.dashboardData(q.scope);
    const slices = (rows: { key: string; count: number }[], labels: Record<string, string>) => {
      const total = rows.reduce((a, r) => a + r.count, 0);
      return { total, slices: rows.map((r) => ({ key: r.key, label: labels[r.key] ?? r.key, count: r.count, pct: pct(r.count, total) })).sort((a, b) => b.count - a.count) };
    };
    const scopeLabel = (kind: string, tenantName: string | null) => (kind === 'all_tenants' ? 'All Tenants' : tenantName ?? (kind === 'branch' ? 'Branch' : 'Tenant'));

    const typeDist = slices(d.byType, TYPE_LABEL);
    return {
      meta: { generatedAt: new Date().toISOString(), scope: q.scope?.tenantId ? 'tenant' : 'platform' },
      kpis: {
        activeRules: d.kpis.activeRules, executionsToday: d.kpis.executionsToday, successfulAutomations: d.kpis.successfulToday,
        failedAutomations: d.kpis.failedToday, disabledRules: d.kpis.disabledRules, tenantExceptions: d.kpis.exceptionsActive,
        notificationsTriggered: d.kpis.notificationsToday, avgExecutionMs: d.kpis.avgDurationMs,
      },
      executionTrend: d.executionTrend,
      successVsFailed: d.successVsFailed,
      rulesByTrigger: slices(d.byTrigger, CAT_LABEL),
      ruleStatus: slices(d.byStatus, STATUS_LABEL),
      ruleTypeDistribution: { total: typeDist.total, rows: typeDist.slices },
      topRules: d.topRules.map((r) => ({ id: r.id, name: r.name, trigger: r.triggerId, triggerCategory: r.triggerCategory, ruleType: r.ruleType, scope: scopeLabel(r.scopeKind, r.tenantName), status: r.status, executions: r.executions, successRatePct: successRatePct(r.successes, r.executions) })),
      executionHistory: d.executionHistory.map((e) => ({ id: e.id, time: e.startedAt, rule: e.ruleName, tenant: e.tenantName, branchId: e.branchId, result: e.status, durationMs: e.durationMs, triggeredBy: e.triggeredBy })),
      failures: d.failures.map((f) => ({ id: f.id, rule: f.ruleName, tenant: f.tenantName, failureReason: f.failureReason, severity: f.severity, status: f.status, category: f.failureCategory, lastAttempt: f.lastAttemptAt })),
      exceptions: d.exceptions.map((x) => ({ id: x.id, tenant: x.tenantName, rule: x.ruleName, exceptionType: x.exceptionType, notes: x.notes, status: x.status })),
      recentActivity: d.recentActivity.map((e) => ({ id: e.id, rule: e.ruleName, tenant: e.tenantName, branchId: e.branchId, result: e.status, time: e.startedAt })),
      upcoming: d.upcoming.map((u) => ({ id: u.id, rule: u.ruleName, time: u.nextEvaluationAt, tenant: u.tenantName, triggerCategory: u.triggerCategory, status: u.status })),
      tenantPerformance: d.tenantPerf.map((t) => {
        const s = pct(t.success, t.total), f = pct(t.failed, t.total);
        return { tenantId: t.tenantId, tenant: t.tenantName, successRatePct: s, failureRatePct: f, impact: (t.total >= 100 ? 'High' : t.total >= 20 ? 'Medium' : 'Low') as 'High' | 'Medium' | 'Low' };
      }),
      totalRules: d.totalRules,
    };
  }
}
