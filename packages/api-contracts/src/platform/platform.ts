// platform.ts — wire contract (Constitution 13 §13, §15). Realm: platform. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface AutomationDashboard {
  meta: { generatedAt: string; scope: 'platform' | 'tenant' };
  kpis: { activeRules: number; executionsToday: number; successfulAutomations: number; failedAutomations: number; disabledRules: number; tenantExceptions: number; notificationsTriggered: number; avgExecutionMs: number };
  executionTrend: { day: string; count: number }[];
  successVsFailed: { day: string; success: number; failed: number }[];
  rulesByTrigger: { total: number; slices: { key: string; label: string; count: number; pct: number }[] };
  ruleStatus: { total: number; slices: { key: string; label: string; count: number; pct: number }[] };
  ruleTypeDistribution: { total: number; rows: { key: string; label: string; count: number; pct: number }[] };
  topRules: { id: string; name: string; trigger: string; triggerCategory: string; ruleType: string; scope: string; status: string; executions: number; successRatePct: number }[];
  executionHistory: { id: string; time: string; rule: string | null; tenant: string | null; branchId: string | null; result: string; durationMs: number | null; triggeredBy: string }[];
  failures: { id: string; rule: string | null; tenant: string | null; failureReason: string; severity: string; status: string; category: string; lastAttempt: string | null }[];
  exceptions: { id: string; tenant: string | null; rule: string | null; exceptionType: string; notes: string | null; status: string }[];
  recentActivity: { id: string; rule: string | null; tenant: string | null; branchId: string | null; result: string; time: string }[];
  upcoming: { id: string; rule: string; time: string; tenant: string | null; triggerCategory: string; status: string }[];
  tenantPerformance: { tenantId: string; tenant: string | null; successRatePct: number; failureRatePct: number; impact: 'High' | 'Medium' | 'Low' }[];
  totalRules: number;
}
