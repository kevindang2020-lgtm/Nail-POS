// automation-engine.service.ts — the controlled execution pipeline (spec §38). Turns a real domain event into a real,
// idempotent, loop-protected, condition-evaluated, exception-aware execution record. NO arbitrary code: triggers are
// matched against the catalog, actions are allowlisted, terminal side-effects go through an injected ActionDispatcher.
// Duplicate events are absorbed by the executions unique idempotency key. Failures are classified + enqueued for retry.
import { sql, type Kysely } from 'kysely';
import {
  isTrigger, isAllowedAction, isSensitiveAction, evaluateConditions, idempotencyKey, loopDepthExceeded,
  classifyFailure, type ConditionGroup,
} from './automation-core';
import { canMoveToSql } from '@aipowersalon/database';
import { AUTOMATION_EXECUTION } from '../platform-lifecycles';

export interface DomainEvent {
  eventId: string; type: string; tenantId?: string | null; branchId?: string | null;
  entityId?: string | null; entityType?: string | null; occurredAt?: string;
  correlationId?: string | null; causationId?: string | null; depth?: number;
  triggeredBy?: string; payload?: Record<string, unknown>; targetRuleId?: string | null;
}
export interface DispatchCtx { event: DomainEvent; ruleId: string; idempotencyKey: string }
export interface ActionDispatcher {
  /** Perform (or record) the terminal effect of one allowlisted action. Must be idempotent per DispatchCtx.idempotencyKey. */
  dispatch(action: { type: string; config?: unknown }, ctx: DispatchCtx): Promise<{ ok: boolean; notification?: boolean; error?: string }>;
}

/** Default dispatcher: records intent only. Binding external actions (email/SMS/ticket/merchant) to Communications /
 *  Support Center / Merchant Accounts is a configuration step — swap in a real dispatcher without touching the engine. */
export class RecordingDispatcher implements ActionDispatcher {
  async dispatch(action: { type: string }): Promise<{ ok: boolean; notification?: boolean }> {
    const isNotification = /^send_(platform|tenant)_notification$|^send_(email|sms|push)$/.test(action.type);
    return { ok: true, notification: isNotification };
  }
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const asArray = (v: unknown): { type: string; config?: unknown }[] => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v || '[]') : []);
const asGroup = (v: unknown): ConditionGroup | undefined => { const g = typeof v === 'string' ? JSON.parse(v || '{}') : v; return g && (g.conditions || g.groups) ? g : undefined; };

export interface IngestResult { ok: boolean; created: number; duplicates: number; skipped: number; suppressed: number; ruleIds: string[] }

export class AutomationEngineService {
  constructor(private readonly db: Kysely<any> | null, private readonly dispatcher: ActionDispatcher = new RecordingDispatcher(), private readonly canManageSensitive = false) {}

  private async audit(event: DomainEvent, action: string, ruleId: string | null, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${event.tenantId ?? null}, ${event.branchId ?? null}, ${null}, 'system', ${action}, 'automation_execution', ${ruleId}, ${JSON.stringify({ eventId: event.eventId, ...meta })}::jsonb)`.execute(this.db);
    } catch { /* best-effort */ }
  }

  /** Ingest one domain event: match active rules, dedupe, evaluate, dispatch, record. Idempotent + loop-guarded. */
  async ingestEvent(event: DomainEvent): Promise<IngestResult> {
    const res: IngestResult = { ok: true, created: 0, duplicates: 0, skipped: 0, suppressed: 0, ruleIds: [] };
    if (!this.db) return res;
    if (!isTrigger(event.type) || !event.eventId) return res;              // unknown trigger ⇒ ignore (no noise)

    const depth = Number(event.depth ?? 0);
    // find eligible active rules for this trigger + scope
    const rules = await sql<any>`
      select r.id, r.tenant_id, r.branch_id, r.scope_kind, v.id as version_id, v.condition_definition, v.action_definitions, v.cooldown_seconds
      from automation_rules r
      join automation_rule_versions v on v.rule_id = r.id and v.version_number = r.current_version
      where r.status = 'active' and r.trigger_id = ${event.type}
        and (r.scope_kind = 'all_tenants' or r.tenant_id = ${event.tenantId ?? null})
        ${event.targetRuleId ? sql`and r.id = ${event.targetRuleId}` : sql``}`.execute(this.db);

    for (const r of rules.rows) {
      const ruleId = String(r.id);
      const key = idempotencyKey({ ruleVersionId: String(r.version_id), triggerEventId: event.eventId, tenantId: event.tenantId ?? 'platform', branchId: event.branchId, entityId: event.entityId });

      // tenant exception that disables this rule for the tenant ⇒ suppress (never bypasses hard safety, only disables)
      if (isUuid(event.tenantId)) {
        const exc = await sql<any>`select 1 from automation_exceptions where rule_id = ${ruleId} and tenant_id = ${event.tenantId} and status = 'active' and exception_type ~* 'disabled' limit 1`.execute(this.db);
        if (exc.rows.length) { res.suppressed++; continue; }
      }

      // idempotent insert — duplicate events collide on the unique key and are absorbed
      const ins = await sql<any>`
        insert into automation_executions (rule_id, rule_version_id, trigger_event_id, tenant_id, branch_id, status, triggered_by, idempotency_key, correlation_id, causation_id, is_test, started_at)
        values (${ruleId}, ${r.version_id}, ${event.eventId}, ${event.tenantId ?? null}, ${event.branchId ?? null}, 'success', ${event.triggeredBy || 'api_event'}, ${key}, ${event.correlationId ?? null}, ${event.causationId ?? null}, false, now())
        on conflict (idempotency_key) do nothing returning id`.execute(this.db);
      if (ins.rows.length === 0) { res.duplicates++; continue; }
      const execId = String(ins.rows[0].id);

      // loop / recursion guard
      if (loopDepthExceeded(depth)) {
        await this.finalize(execId, 'suppressed', 0, 'safety', 'Execution depth exceeded');
        await this.recordFailure(execId, ruleId, event.tenantId ?? null, 'Execution depth exceeded', 'safety', 'high');
        await this.audit(event, 'automation.loop_suppressed', ruleId, { depth });
        res.suppressed++; continue;
      }

      // condition evaluation (typed, no eval)
      const { passed } = evaluateConditions(asGroup(r.condition_definition), event.payload ?? {});
      if (!passed) { await this.finalize(execId, 'skipped', 0, null, null); res.skipped++; res.ruleIds.push(ruleId); continue; }

      // resolve + dispatch allowlisted actions in order
      const actions = asArray(r.action_definitions);
      let notifications = 0; let failed = false; let firstError: string | null = null;
      for (const a of actions) {
        if (!isAllowedAction(a.type)) { failed = true; firstError = firstError ?? `disallowed_action:${a.type}`; break; }
        if (isSensitiveAction(a.type) && !this.canManageSensitive) { failed = true; firstError = firstError ?? `sensitive_not_authorized:${a.type}`; break; }
        const out = await this.dispatcher.dispatch(a, { event, ruleId, idempotencyKey: `${key}|${a.type}` });
        if (!out.ok) { failed = true; firstError = firstError ?? (out.error || `action_failed:${a.type}`); break; }
        if (out.notification) notifications++;
      }

      if (failed) {
        const cls = classifyFailure(firstError ?? 'error');
        await this.finalize(execId, cls === 'safety' ? 'suppressed' : 'failed', notifications, cls, firstError);
        await this.recordFailure(execId, ruleId, event.tenantId ?? null, firstError ?? 'error', cls, cls === 'safety' ? 'high' : 'medium');
        await this.audit(event, 'automation.execution_failed', ruleId, { error: firstError, class: cls });
        res.created++; res.ruleIds.push(ruleId); continue;
      }

      await this.finalize(execId, 'success', notifications, null, null);
      await this.audit(event, 'automation.executed', ruleId, { notifications, actions: actions.map((a) => a.type) });
      res.created++; res.ruleIds.push(ruleId);
    }
    return res;
  }

  private async finalize(execId: string, status: string, notifications: number, failureCategory: string | null, failureMessage: string | null): Promise<void> {
    if (!this.db) return;
    await sql`update automation_executions
      set status = ${status}, notifications_sent = ${notifications}, action_count = ${notifications},
          failure_category = ${failureCategory}, failure_message = ${failureMessage},
          completed_at = now(), duration_ms = greatest(1, cast(extract(epoch from (now() - started_at)) * 1000 as integer))
      where id = ${execId} and ${canMoveToSql(AUTOMATION_EXECUTION, status)}`.execute(this.db);
  }

  private async recordFailure(execId: string, ruleId: string, tenantId: string | null, reason: string, category: string, severity: string): Promise<void> {
    if (!this.db) return;
    await sql`insert into automation_failures (execution_id, rule_id, tenant_id, failure_reason, failure_category, severity, status, last_attempt_at)
              values (${execId}, ${ruleId}, ${tenantId}, ${reason}, ${category}, ${severity}, 'waiting', now())`.execute(this.db);
  }

  /** Scheduler tick (spec §24/§30): evaluate active time/threshold rules whose next_evaluation_at is due, then roll the
   *  schedule forward. Time-based rules fire on schedule through the same idempotent pipeline (the slot is baked into the
   *  eventId, so a slot runs once). Threshold-based rules fire only when a metricProvider supplies their current metric
   *  payload — otherwise the schedule advances without firing (an honest metric feeder is required to evaluate them). */
  async runDueEvaluations(now: Date = new Date(), opts?: { metricProvider?: (rule: { id: string; triggerId: string; tenantId: string | null }) => (Record<string, unknown> | null) | Promise<Record<string, unknown> | null>; defaultIntervalSeconds?: number }): Promise<{ evaluated: number; fired: number; rolled: number; skipped: number }> {
    const out = { evaluated: 0, fired: 0, rolled: 0, skipped: 0 };
    if (!this.db) return out;
    const due = await sql<any>`
      select r.id, r.tenant_id, r.branch_id, r.rule_type, r.trigger_id, r.next_evaluation_at, v.cooldown_seconds
      from automation_rules r
      join automation_rule_versions v on v.rule_id = r.id and v.version_number = r.current_version
      where r.status = 'active' and r.rule_type in ('time_based', 'threshold_based')
        and r.next_evaluation_at is not null and r.next_evaluation_at <= ${now.toISOString()}
      order by r.next_evaluation_at asc limit 100`.execute(this.db);

    for (const r of due.rows) {
      out.evaluated++;
      const ruleId = String(r.id);
      const slotIso = new Date(r.next_evaluation_at).toISOString();
      let payload: Record<string, unknown> | null = {};
      if (r.rule_type === 'threshold_based') payload = (await opts?.metricProvider?.({ id: ruleId, triggerId: String(r.trigger_id), tenantId: r.tenant_id ? String(r.tenant_id) : null })) ?? null;

      if (payload && isTrigger(r.trigger_id)) {
        const res = await this.ingestEvent({ eventId: `sched|${ruleId}|${slotIso}`, type: String(r.trigger_id), tenantId: r.tenant_id ? String(r.tenant_id) : null, branchId: r.branch_id ? String(r.branch_id) : null, entityId: ruleId, entityType: 'automation_rule', triggeredBy: 'scheduler', payload, targetRuleId: ruleId });
        out.fired += res.created; out.skipped += res.skipped;
      } else {
        out.skipped++;   // threshold rule with no metric feeder — schedule advances but nothing fires
      }

      const intervalS = Number(r.cooldown_seconds) > 0 ? Number(r.cooldown_seconds) : (opts?.defaultIntervalSeconds ?? 3600);
      await sql`update automation_rules set next_evaluation_at = ${new Date(now.getTime() + intervalS * 1000).toISOString()}, updated_at = now() where id = ${ruleId}`.execute(this.db);
      out.rolled++;
    }
    return out;
  }
}
