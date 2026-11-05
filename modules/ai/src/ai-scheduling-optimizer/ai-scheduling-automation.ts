// ai-scheduling-automation.ts — BUILD_PLAN Phase 7 (agent B): the controlled-automation runner (SchedAutomationPort.afterRun).
//
// After every completed optimization run the engine hands the run here. Automation is OFF by default and this runner acts
// on a recommendation ONLY when every one of these holds — otherwise the recommendation simply stays for human review:
//   1. no platform switch is on (the optimizer's own platform kill switch, or the platform's 'AI automatic actions' one);
//   2. the effective settings allow automation (enabled, no salon / location kill switch, automationEnabled, a non-empty
//      allowlist) — engine.effectiveConfig for the run's location;
//   3. the recommendation's type maps to one of the SAFE auto-actions (SAFE_ACTION_FOR) and that action is on the salon's
//      allowlist with confidence ≥ the threshold — evaluateAutomation / isAutoActionAllowed (ai-scheduling-application.ts);
//   4. it is internal only: no appointment moved (no proposed state, no affected appointment), no customer, nothing a
//      customer confirmed, and the action is reversible.
// An automated action is recorded as such: the recommendation → applied with automated=true (CAS on version + status),
// a decision row ('auto_applied', no user), and SCHEDULE_CHANGE_APPLIED { automated: true }. It NEVER calls booking.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { SCHEDULE_RECOMMENDATION } from '../ai-lifecycles';
import type { SchedRecommendation, SchedRecType, SchedRunDetail, SchedSafeAutoAction } from '@aipowersalon/api-contracts/tenant';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { evaluateAutomation } from './ai-scheduling-application';
import type { ResolvedSettings } from './ai-scheduling-settings';
import type { SchedAutomationPort, SchedCtx, SchedEventsPort } from './ai-scheduling.ports';
import { rowsOf, type SchedEngine } from './ai-scheduling-ops.common';

/** Recommendation type → the safe auto-action it would be. Anything not listed is never automated. */
export const SAFE_ACTION_FOR: Partial<Record<SchedRecType, SchedSafeAutoAction>> = {
  open_availability: 'open_empty_slot',
  close_availability: 'close_unavailable_tech',
  adjust_duration: 'recalc_estimated_end',
  add_staffing: 'update_internal_capacity',
  fill_gap: 'apply_preapproved_gap_rule',
};
const REVERSIBLE = new Set<SchedSafeAutoAction>(['open_empty_slot', 'close_unavailable_tech', 'recalc_estimated_end', 'add_internal_warning', 'update_internal_capacity', 'apply_preapproved_gap_rule']);
const OPEN_STATES = new Set(['generated', 'review_required']);

export interface AutomationVerdict { recommendationId: string; automated: boolean; reason: string; action: SchedSafeAutoAction | null }

/** Pure: may THIS recommendation run automatically under `resolved`? */
export function automationVerdict(resolved: ResolvedSettings, rec: SchedRecommendation): AutomationVerdict {
  const action = SAFE_ACTION_FOR[rec.type] ?? null;
  const base = { recommendationId: rec.id, action };
  if (!OPEN_STATES.has(rec.status)) return { ...base, automated: false, reason: 'not_open' };
  if (!action) return { ...base, automated: false, reason: 'not_a_safe_action' };
  const touchesAppointment = !!rec.proposedState || (rec.affectedAppointmentIds?.length ?? 0) > 0 || !!rec.currentState;
  const touchesCustomer = !!rec.currentState?.customerId || !!rec.requiresCustomerApproval;
  const d = evaluateAutomation(resolved, { action, confidence: Number(rec.confidence || 0), reversible: REVERSIBLE.has(action), touchesConfirmedAppointment: !!rec.touchesConfirmedAppointment, touchesCustomer });
  if (!d.autoApply) return { ...base, automated: false, reason: d.reason };
  if (touchesAppointment) return { ...base, automated: false, reason: 'moves_an_appointment_requires_review' };
  return { ...base, automated: true, reason: d.reason };
}

export interface AutomationApplier { markAutomated(ctx: SchedCtx, rec: SchedRecommendation, action: SchedSafeAutoAction): Promise<boolean> }
export interface AutomationPlatformGate { automationBlocked(): Promise<{ blocked: boolean; by: string | null }> }

export class SchedAutomationRunner implements SchedAutomationPort {
  readonly last: AutomationVerdict[] = [];
  constructor(private readonly engine: SchedEngine, private readonly applier: AutomationApplier, private readonly platform: AutomationPlatformGate | null, private readonly events: SchedEventsPort | null) {}

  async afterRun(ctx: SchedCtx, detail: SchedRunDetail): Promise<void> { await this.evaluate(ctx, detail); }

  /** Returns every verdict (for tests and the run log); never throws into the engine's run. */
  async evaluate(ctx: SchedCtx, detail: SchedRunDetail): Promise<AutomationVerdict[]> {
    const recs = detail?.recommendations ?? [];
    this.last.length = 0;
    if (!recs.length) return [];
    try {
      const gate = this.platform ? await this.platform.automationBlocked() : { blocked: false, by: null };
      if (gate.blocked) return this.all(recs, `platform_blocked:${gate.by}`);
      const branchCtx: SchedCtx = { ...ctx, branchId: detail.run?.branchId ?? ctx.branchId ?? null };
      const resolved = (await this.engine.effectiveConfig(branchCtx)) as ResolvedSettings & { platformKilled?: boolean };
      if (resolved.platformKilled) return this.all(recs, 'platform_blocked:optimizer_platform_switch');
      if (!resolved.automationAllowed) return this.all(recs, resolved.killed ? 'kill_switch' : 'automation_off');
      const out: AutomationVerdict[] = [];
      for (const rec of recs) {
        const v = automationVerdict(resolved, rec);
        if (v.automated && v.action) {
          const ok = await this.applier.markAutomated({ ...branchCtx, actor: 'automation' }, rec, v.action).catch(() => false);
          if (!ok) { out.push({ ...v, automated: false, reason: 'changed_meanwhile' }); continue; }
          await this.events?.emit({ ...branchCtx, actor: 'automation' }, DOMAIN_EVENTS.SCHEDULE_CHANGE_APPLIED, { type: 'schedule_recommendation', id: rec.id, version: rec.version + 1 },
            { recommendationId: rec.id, status: 'applied', automated: true, action: v.action, runId: detail.run?.id ?? null }).catch(() => undefined);
        }
        out.push(v);
      }
      this.last.push(...out);
      return out;
    } catch {
      return this.all(recs, 'automation_error');   // automation is never load-bearing: on doubt, everything stays manual
    }
  }
  private all(recs: SchedRecommendation[], reason: string): AutomationVerdict[] {
    const out = recs.map((r) => ({ recommendationId: r.id, automated: false, reason, action: SAFE_ACTION_FOR[r.type] ?? null }));
    this.last.push(...out);
    return out;
  }
}

/** The recommendation → applied + automated, only from an open state at the version the run produced. */
export class KyselyAutomationApplier implements AutomationApplier {
  constructor(private readonly db: Kysely<any>) {}
  async markAutomated(ctx: SchedCtx, rec: SchedRecommendation, action: SchedSafeAutoAction): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const r = rowsOf(await sql`update schedule_optimization_recommendations
                                    set status = 'applied', automated = true, applied_at = now(), decided_at = now(), version = version + 1, updated_at = now()
                                  where tenant_id = ${ctx.tenantId} and id = ${rec.id} and version = ${rec.version} and status in ('generated','review_required') and ${canMoveToSql(SCHEDULE_RECOMMENDATION, 'applied')}
                                    and affected_appointment_ids = '[]'::jsonb and proposed_state is null
                                  returning id`.execute(trx))[0];
      if (!r) return false;
      await sql`insert into schedule_recommendation_decisions (tenant_id, recommendation_id, action, actor_user_id, reason, before_snapshot, after_snapshot)
                values (${ctx.tenantId}, ${rec.id}, 'auto_applied', null, ${`automation: ${action}`},
                        ${JSON.stringify({ status: rec.status, version: rec.version })}::jsonb, ${JSON.stringify({ status: 'applied', version: rec.version + 1, automated: true })}::jsonb)`.execute(trx);
      return true;
    });
  }
}
