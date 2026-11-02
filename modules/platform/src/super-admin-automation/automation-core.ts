// automation-core.ts — pure, I/O-free logic for the Super Admin Automation Rules engine. No DB, no clock, no network,
// NO eval / arbitrary code. Structured trigger catalog, allowlisted action catalog, a typed condition evaluator (for safe
// test/simulation), idempotency-key construction, failure classification, loop-depth guard, and dashboard rollups.
// Durations are milliseconds; everything reconciles to the records the caller passes in.

// ---- controlled vocabularies -------------------------------------------------------------------------------------
export const RULE_STATUSES = ['draft', 'pending_review', 'approved', 'active', 'paused', 'disabled', 'error', 'retired', 'archived'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];
export const RULE_TYPES = ['event_based', 'time_based', 'threshold_based', 'manual', 'other'] as const;

export const TRIGGER_CATALOG = [
  'TENANT_PAYMENT_FAILED', 'DEVICE_OFFLINE', 'DEVICE_OFFLINE_DURATION_REACHED', 'MERCHANT_APPLICATION_APPROVED',
  'CUSTOMER_IMPORT_FAILED', 'BRANCH_PLAN_LIMIT_REACHED', 'CHARGEBACK_THRESHOLD_EXCEEDED', 'ONBOARDING_COMPLETED',
  'SUPPORT_TICKET_CREATED', 'REPORT_GENERATION_FAILED', 'MEMBERSHIP_PAYMENT_FAILED', 'COMMUNICATION_DELIVERY_FAILED',
  'APPOINTMENT_BOOKING_FAILED', 'QUEUE_SYNC_FAILED',
] as const;
export type TriggerId = (typeof TRIGGER_CATALOG)[number];
export const isTrigger = (v: unknown): v is TriggerId => typeof v === 'string' && (TRIGGER_CATALOG as readonly string[]).includes(v);

// trigger → business category (for "Rules by Trigger Type")
export const TRIGGER_CATEGORY: Record<TriggerId, string> = {
  TENANT_PAYMENT_FAILED: 'billing', MEMBERSHIP_PAYMENT_FAILED: 'billing',
  DEVICE_OFFLINE: 'devices', DEVICE_OFFLINE_DURATION_REACHED: 'devices', QUEUE_SYNC_FAILED: 'devices',
  MERCHANT_APPLICATION_APPROVED: 'merchant_setup', CUSTOMER_IMPORT_FAILED: 'customer_imports',
  BRANCH_PLAN_LIMIT_REACHED: 'plan_limits', CHARGEBACK_THRESHOLD_EXCEEDED: 'chargebacks',
  ONBOARDING_COMPLETED: 'onboarding', SUPPORT_TICKET_CREATED: 'other', REPORT_GENERATION_FAILED: 'other',
  COMMUNICATION_DELIVERY_FAILED: 'other', APPOINTMENT_BOOKING_FAILED: 'other',
};

// Allowlisted actions only — never arbitrary code/SQL/HTTP. `sensitive` actions require stronger controls upstream.
export interface ActionDef { type: string; sensitive: boolean; requiredPermission?: string }
export const ACTION_CATALOG: ActionDef[] = [
  { type: 'send_platform_notification', sensitive: false }, { type: 'send_tenant_notification', sensitive: false },
  { type: 'send_email', sensitive: false }, { type: 'send_sms', sensitive: false }, { type: 'send_push', sensitive: false },
  { type: 'create_support_ticket', sensitive: false }, { type: 'assign_support_case', sensitive: false },
  { type: 'request_final_approval', sensitive: false }, { type: 'add_internal_alert', sensitive: false },
  { type: 'create_audit_event', sensitive: false }, { type: 'add_review_task', sensitive: false },
  { type: 'trigger_smart_reminder_flow', sensitive: false }, { type: 'schedule_report', sensitive: false },
  { type: 'queue_integration_sync', sensitive: false }, { type: 'update_non_financial_status', sensitive: false },
  { type: 'activate_payment_configuration', sensitive: true, requiredPermission: 'super_admin.payments.manage' },   // Phase 9 check:perms: was 'automation_rules.merchant_actions.manage', a key in no catalog
];
const ACTION_BY_TYPE = new Map(ACTION_CATALOG.map((a) => [a.type, a]));
export const isAllowedAction = (t: unknown): boolean => typeof t === 'string' && ACTION_BY_TYPE.has(t);
export const isSensitiveAction = (t: string): boolean => ACTION_BY_TYPE.get(t)?.sensitive ?? false;

// ---- typed condition engine (safe; no eval) ----------------------------------------------------------------------
export type Operator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty' | 'in' | 'not_in' | 'has_changed' | 'duration_exceeds' | 'count_exceeds' | 'percentage_exceeds' | 'date_before' | 'date_after';
export interface Condition { field: string; operator: Operator; value?: unknown }
export interface ConditionGroup { logic: 'and' | 'or'; conditions?: Condition[]; groups?: ConditionGroup[] }
export const MAX_CONDITION_DEPTH = 5;

function evalCondition(c: Condition, ctx: Record<string, unknown>): boolean {
  const left = ctx[c.field];
  const v = c.value;
  switch (c.operator) {
    case 'eq': return left === v;
    case 'neq': return left !== v;
    case 'gt': return Number(left) > Number(v);
    case 'gte': return Number(left) >= Number(v);
    case 'lt': return Number(left) < Number(v);
    case 'lte': return Number(left) <= Number(v);
    case 'contains': return String(left ?? '').includes(String(v ?? ''));
    case 'not_contains': return !String(left ?? '').includes(String(v ?? ''));
    case 'is_empty': return left == null || left === '' || (Array.isArray(left) && left.length === 0);
    case 'is_not_empty': return !(left == null || left === '' || (Array.isArray(left) && left.length === 0));
    case 'in': return Array.isArray(v) && (v as unknown[]).includes(left);
    case 'not_in': return Array.isArray(v) && !(v as unknown[]).includes(left);
    case 'has_changed': return left !== undefined && ctx[`${c.field}__previous`] !== left;
    case 'duration_exceeds': case 'count_exceeds': case 'percentage_exceeds': return Number(left) > Number(v);
    case 'date_before': return new Date(String(left)).getTime() < new Date(String(v)).getTime();
    case 'date_after': return new Date(String(left)).getTime() > new Date(String(v)).getTime();
    default: return false;
  }
}

export interface ConditionTrace { field: string; operator: string; passed: boolean }
/** Evaluate a condition group against a context. Returns pass/fail + a per-condition trace (for Test mode). Depth-limited. */
export function evaluateConditions(group: ConditionGroup | undefined, ctx: Record<string, unknown>, depth = 0): { passed: boolean; trace: ConditionTrace[] } {
  const trace: ConditionTrace[] = [];
  if (!group) return { passed: true, trace };
  if (depth > MAX_CONDITION_DEPTH) return { passed: false, trace };
  const results: boolean[] = [];
  for (const c of group.conditions ?? []) { const passed = evalCondition(c, ctx); trace.push({ field: c.field, operator: c.operator, passed }); results.push(passed); }
  for (const g of group.groups ?? []) { const sub = evaluateConditions(g, ctx, depth + 1); trace.push(...sub.trace); results.push(sub.passed); }
  if (results.length === 0) return { passed: true, trace };
  const passed = group.logic === 'or' ? results.some(Boolean) : results.every(Boolean);
  return { passed, trace };
}

// ---- idempotency + loop protection -------------------------------------------------------------------------------
/** Deterministic idempotency key for an execution/action. Repeated events ⇒ identical key ⇒ dedup by unique constraint. */
export function idempotencyKey(parts: { ruleVersionId: string; triggerEventId: string; tenantId: string; branchId?: string | null; entityId?: string | null; occurrence?: string | null; actionIndex?: number | null }): string {
  return [parts.ruleVersionId, parts.triggerEventId, parts.tenantId, parts.branchId ?? 'none', parts.entityId ?? 'none', parts.occurrence ?? 'once', parts.actionIndex ?? 'exec'].join('|');
}
export const MAX_EXECUTION_DEPTH = 5;
export const loopDepthExceeded = (depth: number, max = MAX_EXECUTION_DEPTH): boolean => depth > max;

// ---- rule status lifecycle ---------------------------------------------------------------------------------------
export const RULE_FLOW: Record<RuleStatus, RuleStatus[]> = {
  draft: ['pending_review', 'active', 'disabled'],
  pending_review: ['approved', 'draft'],
  approved: ['active', 'draft'],
  active: ['paused', 'disabled', 'error'],
  paused: ['active', 'disabled'],
  disabled: ['active', 'retired'],
  error: ['draft', 'disabled'],
  retired: ['archived'],
  archived: [],
};
export function canRuleTransition(from: string, to: string): boolean {
  return (RULE_FLOW[from as RuleStatus] ?? []).includes(to as RuleStatus);
}

// Exception types that would weaken mandatory security/privacy/isolation/audit — never allowed, even for one tenant.
const FORBIDDEN_EXCEPTION = [/isolation/i, /security/i, /audit/i, /permission/i, /encryption/i, /cross.?tenant/i, /bypass.?safety/i];
export function isForbiddenException(exceptionType: string, notes = ''): boolean {
  const s = `${exceptionType} ${notes}`;
  return FORBIDDEN_EXCEPTION.some((re) => re.test(s));
}

// ---- failure classification --------------------------------------------------------------------------------------
export type FailureClass = 'temporary' | 'permanent' | 'safety';
const TEMPORARY = [/timeout/i, /network/i, /unavailable/i, /rate.?limit/i, /worker/i, /temporar/i, /lock/i, /502|503|504/];
const SAFETY = [/loop/i, /depth/i, /duplicate/i, /cross.?tenant/i, /approval missing/i, /action limit/i];
export function classifyFailure(reason: string): FailureClass {
  const r = reason ?? '';
  if (SAFETY.some((re) => re.test(r))) return 'safety';
  if (TEMPORARY.some((re) => re.test(r))) return 'temporary';
  return 'permanent';   // invalid config / unauthorized / missing param / validation ⇒ do NOT auto-retry
}
export const isRetryable = (reason: string): boolean => classifyFailure(reason) === 'temporary';

// ---- dashboard rollups -------------------------------------------------------------------------------------------
export const successRatePct = (success: number, total: number): number => (total > 0 ? Math.round((success / total) * 1000) / 10 : 0);

export function distribution<T extends string>(items: { key: T; count: number }[]): { total: number; slices: { key: T; count: number; pct: number }[] } {
  const total = items.reduce((a, i) => a + i.count, 0);
  return { total, slices: items.map((i) => ({ key: i.key, count: i.count, pct: total ? Math.round((i.count / total) * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count) };
}

// Whether an INCREASE is favorable for automation health. Absent ⇒ neutral.
export const INCREASE_GOOD: Record<string, boolean> = {
  activeRules: true, executionsToday: true, successfulAutomations: true, notificationsTriggered: true,
  failedAutomations: false, avgExecutionMs: false, disabledRules: false,
  // tenantExceptions is intentionally absent ⇒ neutral.
};
export interface Trend { delta: number; pct: number | null; favorable: boolean | null }
export function trendOf(metric: string, current: number, prior: number | null): Trend | null {
  if (prior == null) return null;
  const delta = current - prior;
  const pct = prior !== 0 ? Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10 : null;
  const good = INCREASE_GOOD[metric];
  const favorable = delta === 0 || good === undefined ? null : good ? delta > 0 : delta < 0;
  return { delta, pct, favorable };
}
