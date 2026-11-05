// ai-scheduling.ports.ts — BUILD_PLAN Phase 7: the seams between the optimizer's engine (recommendations, runs, apply,
// settings — ai-scheduling.service.ts) and its operations half (customer proposals, explanations, usage, platform switch,
// automation — provided by ai-scheduling-ops.providers.ts). Both halves live in ONE Nest module; the engine injects these
// tokens, the ops half provides them. Shapes on the wire are @aipowersalon/api-contracts (tenant/ai-scheduling.ts).
import type { SchedRecommendation, SchedProposalSummary, SchedRunDetail } from '@aipowersalon/api-contracts/tenant';

/** Who is acting. `actor` 'system' = a background job, 'automation' = the opted-in runner; both carry the tenant they
 *  act for and never a user's permissions beyond what the job needs. */
export interface SchedCtx {
  tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[];
  actor?: 'user' | 'system' | 'automation';
  technicianId?: string | null;            // set for a technician session (view_own filtering)
  requestId?: string | null; correlationId?: string | null;
}

export type SchedAggregateType = 'schedule_recommendation' | 'schedule_run' | 'schedule_proposal' | 'schedule_settings' | 'schedule_insight';
/** Writes a schedule.* domain event to the outbox (pass the transaction handle when inside one). The realtime screens
 *  hear it through the projection consumer — nothing in this module emits realtime directly. */
export interface SchedEventsPort {
  emit(ctx: SchedCtx, eventType: string, aggregate: { type: SchedAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>, trx?: unknown): Promise<void>;
}
export const SCHED_EVENTS = 'SchedEventsPort';

/** Customer proposals (ops half). open() is idempotent per recommendation: it creates the live proposal row (original
 *  appointment untouched), notifies the customer and returns the summary. */
export interface SchedProposalPort {
  open(ctx: SchedCtx, rec: SchedRecommendation): Promise<SchedProposalSummary>;
  resend(ctx: SchedCtx, recommendationId: string): Promise<SchedProposalSummary>;
  /** Staff record a decision the customer gave by phone / in person (decision_channel 'staff_recorded'). */
  recordStaffDecision(ctx: SchedCtx, recommendationId: string, approved: boolean): Promise<SchedProposalSummary>;
  withdraw(ctx: SchedCtx, recommendationId: string, reason: string): Promise<void>;
  markApplied(ctx: SchedCtx, recommendationId: string): Promise<void>;
  summaries(ctx: SchedCtx, recommendationIds: string[]): Promise<Record<string, SchedProposalSummary>>;
}
export const SCHED_PROPOSAL_PORT = 'SchedProposalPort';

/** Explanation text for a recommendation. The LLM only ever WORDS a result the deterministic engine already produced
 *  (task schedule.explain_suggestion); on any failure / no AI package it falls back to the template. */
export interface SchedExplanationPort { explain(ctx: SchedCtx, rec: SchedRecommendation): Promise<{ text: string; source: 'llm' | 'template' }> }
export const SCHED_EXPLANATION_PORT = 'SchedExplanationPort';

export type SchedUsageAction = 'optimization_run' | 'options' | 'recommendation' | 'explanation';
/** Metering into ai_usage_logs (package ai_scheduling_optimizer). Never throws into the caller. */
export interface SchedUsagePort { record(ctx: SchedCtx, action: SchedUsageAction, extra?: { amount?: number; costMicroUsd?: number; model?: string | null; status?: 'ok' | 'error' }): Promise<void> }
export const SCHED_USAGE_PORT = 'SchedUsagePort';

/** The platform-wide kill switch (Super Admin). true = automation off for every salon and generation refused. */
export interface SchedPlatformSwitchPort { isKilled(): Promise<boolean> }
export const SCHED_PLATFORM_SWITCH_PORT = 'SchedPlatformSwitchPort';

/** Called by the engine after a run completes. The ops half's runner applies ONLY safe, reversible, confident actions
 *  the settings allow (evaluateAutomation) — everything else stays for review. */
export interface SchedAutomationPort { afterRun(ctx: SchedCtx, detail: SchedRunDetail): Promise<void> }
export const SCHED_AUTOMATION_PORT = 'SchedAutomationPort';
