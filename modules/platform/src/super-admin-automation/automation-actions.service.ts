// automation-actions.service.ts — controlled write-actions for Automation Rules. Every action is SuperAdminGuard-gated
// (controller), server-derives the actor, and is audit logged. Enforces the safety boundary: triggers must be in the
// catalog, actions must be allowlisted (NO arbitrary code/SQL/HTTP), status changes follow the lifecycle, tenant
// exceptions cannot weaken security/isolation/audit, test mode NEVER performs real actions, and retries only run for
// TEMPORARY failures. Sensitive actions require an explicit permission flag on the actor context.
import { sql, type Kysely } from 'kysely';
import type { AdminCtx } from './automation.service';
import {
  isTrigger, isAllowedAction, isSensitiveAction, TRIGGER_CATEGORY, evaluateConditions, canRuleTransition,
  isForbiddenException, classifyFailure, type ConditionGroup, type TriggerId,
} from './automation-core';
import { canMoveToSql, transitionStatus, InvalidStateTransitionError } from '@aipowersalon/database';
import { AUTOMATION_RULE, AUTOMATION_FAILURE } from '../platform-lifecycles';

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const clean = (v: unknown, max = 2000): string => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max); // eslint-disable-line no-control-regex

export interface CreateRuleInput { name?: string; description?: string; ruleType?: string; triggerId?: string; conditions?: ConditionGroup; actions?: { type: string; config?: unknown }[]; scopeKind?: string; tenantId?: string | null; branchId?: string | null; timeoutMs?: number; cooldownSeconds?: number }
export interface TestRuleInput { triggerId?: string; conditions?: ConditionGroup; actions?: { type: string }[]; context?: Record<string, unknown> }

export class AutomationActionsService {
  constructor(private readonly db: Kysely<any> | null) {}

  private async audit(ctx: AdminCtx, action: string, tenantId: string | null, entityId: string | null, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${tenantId}, ${null}, ${ctx.userId ?? null}, 'super_admin', ${action}, 'automation_rule', ${entityId}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db);
    } catch { /* best-effort */ }
  }

  /** Validate trigger + actions against the safety boundary. Returns errors (empty = valid). */
  private validateDefinition(triggerId: unknown, actions: { type: string }[] | undefined): string[] {
    const errs: string[] = [];
    if (!isTrigger(triggerId)) errs.push('invalid_trigger');
    const acts = actions ?? [];
    if (acts.length === 0) errs.push('no_actions');
    for (const a of acts) if (!isAllowedAction(a?.type)) errs.push(`disallowed_action:${a?.type ?? 'unknown'}`);
    return errs;
  }

  /** Create a rule as Draft with an immutable v1 version. */
  async createRule(ctx: AdminCtx, input: CreateRuleInput): Promise<{ ok: boolean; error?: string; errors?: string[]; id?: string }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    const name = clean(input.name, 160);
    if (!name) return { ok: false, error: 'name_required' };
    const errs = this.validateDefinition(input.triggerId, input.actions);
    if (errs.length) return { ok: false, error: 'validation_failed', errors: errs };
    // sensitive actions require an explicit permission on the actor
    const needsSensitive = (input.actions ?? []).some((a) => isSensitiveAction(a.type));
    if (needsSensitive && !ctx.canManageSensitive) return { ok: false, error: 'sensitive_permission_required' };

    const triggerId = input.triggerId as TriggerId;
    const category = TRIGGER_CATEGORY[triggerId] ?? 'other';
    const ruleType = ['event_based', 'time_based', 'threshold_based', 'manual', 'other'].includes(String(input.ruleType)) ? String(input.ruleType) : 'event_based';
    const scopeKind = ['all_tenants', 'tenant', 'branch'].includes(String(input.scopeKind)) ? String(input.scopeKind) : 'all_tenants';
    const ref = `AR-${Date.now().toString(36).toUpperCase()}`;
    const created = await sql<{ id: string }>`
      INSERT INTO automation_rules (rule_reference, name, description, rule_type, trigger_id, trigger_category, status, scope_kind, tenant_id, branch_id, current_version, owner_id)
      VALUES (${ref}, ${name}, ${clean(input.description)}, ${ruleType}, ${triggerId}, ${category}, 'draft', ${scopeKind}, ${isUuid(input.tenantId) ? input.tenantId : null}, ${isUuid(input.branchId) ? input.branchId : null}, 1, ${ctx.userId ?? null})
      RETURNING id`.execute(this.db);
    const id = created.rows[0]?.id;
    await sql`
      INSERT INTO automation_rule_versions (rule_id, version_number, trigger_definition, condition_definition, action_definitions, scope_definition, timeout_ms, cooldown_seconds, created_by)
      VALUES (${id}, 1, ${JSON.stringify({ triggerId })}::jsonb, ${JSON.stringify(input.conditions ?? {})}::jsonb, ${JSON.stringify(input.actions ?? [])}::jsonb, ${JSON.stringify({ scopeKind, tenantId: input.tenantId ?? null })}::jsonb, ${Math.max(1000, Math.min(300000, Number(input.timeoutMs) || 30000))}, ${Math.max(0, Number(input.cooldownSeconds) || 0)}, ${ctx.userId ?? null})`.execute(this.db);
    await this.audit(ctx, 'automation_rule.create', isUuid(input.tenantId) ? input.tenantId! : null, id ?? null, { name, triggerId, ruleType, actions: (input.actions ?? []).map((a) => a.type) });
    return { ok: true, id };
  }

  /** SAFE simulation. Evaluates trigger + conditions and resolves which actions WOULD run. Never performs real actions;
   *  optionally records an is_test execution so it is visibly excluded from production KPIs. */
  async testRule(ctx: AdminCtx, input: TestRuleInput, ruleId?: string): Promise<{ ok: boolean; error?: string; dryRun: true; triggerMatched: boolean; conditionsPassed: boolean; trace: { field: string; operator: string; passed: boolean }[]; resolvedActions: string[]; skippedActions: string[]; warnings: string[] }> {
    const warnings: string[] = [];
    const triggerMatched = isTrigger(input.triggerId);
    if (!triggerMatched) warnings.push('trigger_not_in_catalog');
    const { passed, trace } = evaluateConditions(input.conditions, input.context ?? {});
    const resolved: string[] = []; const skipped: string[] = [];
    for (const a of input.actions ?? []) {
      if (!isAllowedAction(a.type)) { skipped.push(`${a.type} (not allowlisted)`); continue; }
      if (isSensitiveAction(a.type) && !ctx.canManageSensitive) { skipped.push(`${a.type} (needs sensitive permission)`); continue; }
      resolved.push(a.type);
    }
    if (this.db && isUuid(ruleId)) {
      // record a dry-run execution row (is_test = true) — excluded from production KPIs by the dashboard
      try {
        await sql`INSERT INTO automation_executions (rule_id, tenant_id, status, triggered_by, idempotency_key, is_test, action_count, completed_at, duration_ms)
                  VALUES (${ruleId}, ${null}, ${passed && triggerMatched ? 'success' : 'skipped'}, 'super_admin', ${'test|' + ruleId + '|' + Date.now()}, true, ${resolved.length}, now(), 5)`.execute(this.db);
      } catch { /* non-blocking */ }
    }
    await this.audit(ctx, 'automation_rule.test', null, isUuid(ruleId) ? ruleId! : null, { triggerMatched, conditionsPassed: passed, resolvedActions: resolved, dryRun: true });
    return { ok: true, dryRun: true, triggerMatched, conditionsPassed: passed, trace, resolvedActions: resolved, skippedActions: skipped, warnings };
  }

  /** Validated lifecycle transition (enable/disable/pause/etc.). Enabling re-validates the published definition. */
  async setStatus(ctx: AdminCtx, id: string, to: string, reason?: string): Promise<{ ok: boolean; error?: string; errors?: string[]; status?: string }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    if (!isUuid(id)) return { ok: false, error: 'invalid_id' };
    const cur = await sql<any>`select r.status, r.tenant_id, r.trigger_id, v.action_definitions
      from automation_rules r left join automation_rule_versions v on v.rule_id = r.id and v.version_number = r.current_version
      where r.id = ${id} limit 1`.execute(this.db);
    const row = cur.rows[0];
    if (!row) return { ok: false, error: 'not_found' };
    if (!canRuleTransition(String(row.status), to)) return { ok: false, error: 'invalid_transition' };
    if (to === 'active') {
      const actions = Array.isArray(row.action_definitions) ? row.action_definitions : JSON.parse(row.action_definitions ?? '[]');
      const errs = this.validateDefinition(row.trigger_id, actions);
      if (errs.length) return { ok: false, error: 'validation_failed', errors: errs };
    }
    if ((to === 'disabled' || to === 'retired') && !clean(reason)) return { ok: false, error: 'reason_required' };
    // Phase 12 (#27): the move through AUTOMATION_RULE, conditional on the state read above — a concurrent status change
    // between the read and this write is refused (409 → invalid_transition), never overwritten
    try { await transitionStatus(this.db, AUTOMATION_RULE, { where: { id }, from: String(row.status) as any, to: to as any, set: { updated_at: sql`now()` } }); }
    catch (e) { if (e instanceof InvalidStateTransitionError) return { ok: false, error: 'invalid_transition' }; throw e; }
    await this.audit(ctx, `automation_rule.${to}`, row.tenant_id ? String(row.tenant_id) : null, id, { from: row.status, to, reason: clean(reason) || null });
    return { ok: true, status: to };
  }

  /** Create a tenant-specific exception. Rejects any exception that would weaken mandatory safety/isolation/audit. */
  async createException(ctx: AdminCtx, input: { ruleId?: string; tenantId?: string; branchId?: string | null; exceptionType?: string; overrideValue?: string; notes?: string; reason?: string }): Promise<{ ok: boolean; error?: string; id?: string }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    if (!isUuid(input.ruleId) || !isUuid(input.tenantId)) return { ok: false, error: 'rule_and_tenant_required' };
    const type = clean(input.exceptionType, 60);
    if (!type) return { ok: false, error: 'exception_type_required' };
    if (isForbiddenException(type, clean(input.notes))) return { ok: false, error: 'exception_cannot_bypass_safety' };
    const r = await sql<{ id: string }>`
      INSERT INTO automation_exceptions (rule_id, tenant_id, branch_id, exception_type, override_value, notes, reason, status, created_by)
      VALUES (${input.ruleId}, ${input.tenantId}, ${isUuid(input.branchId) ? input.branchId : null}, ${type}, ${clean(input.overrideValue, 200)}, ${clean(input.notes)}, ${clean(input.reason)}, 'active', ${ctx.userId ?? null}) RETURNING id`.execute(this.db);
    await this.audit(ctx, 'automation_exception.create', input.tenantId!, r.rows[0]?.id ?? null, { ruleId: input.ruleId, exceptionType: type });
    return { ok: true, id: r.rows[0]?.id };
  }

  /** Retry a failed automation — ONLY when the failure is classified temporary. Permanent/safety failures are refused. */
  async retryFailure(ctx: AdminCtx, failureId: string): Promise<{ ok: boolean; error?: string; status?: string; class?: string }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    if (!isUuid(failureId)) return { ok: false, error: 'invalid_id' };
    const cur = await sql<any>`select tenant_id, failure_reason, failure_category, status, retry_count from automation_failures where id = ${failureId} limit 1`.execute(this.db);
    const row = cur.rows[0];
    if (!row) return { ok: false, error: 'not_found' };
    if (row.status === 'resolved') return { ok: false, error: 'already_resolved' };
    const cls = row.failure_category || classifyFailure(String(row.failure_reason));
    if (cls !== 'temporary') { await this.audit(ctx, 'automation_failure.retry_refused', row.tenant_id ? String(row.tenant_id) : null, failureId, { class: cls }); return { ok: false, error: 'not_retryable', class: cls }; }
    const moved: any = await sql`update automation_failures set status = 'retrying', retry_count = retry_count + 1, last_attempt_at = now(), updated_at = now() where id = ${failureId} and status = ${row.status} and ${canMoveToSql(AUTOMATION_FAILURE, 'retrying')} returning id`.execute(this.db);
    if (!moved.rows.length) return { ok: false, error: 'already_resolved' };   // resolved (or retried) concurrently
    await this.audit(ctx, 'automation_failure.retry', row.tenant_id ? String(row.tenant_id) : null, failureId, { class: cls, retryCount: Number(row.retry_count) + 1 });
    return { ok: true, status: 'retrying', class: cls };
  }
}
