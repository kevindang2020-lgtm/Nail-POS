// ai-safety-policy.ts — Constitution 10 §109–§118: the one place that decides what an AI task is allowed to do
// for a given tenant, and the trace that records why.
//
// §110 is the rule that shapes this whole file: **a tenant may tighten safety, never weaken it.** Every setting
// here composes by taking the STRICTER of platform and tenant, so a tenant asking for more automation than the
// platform allows simply does not get it — there is no code path where a tenant setting raises a ceiling.
//
// §113's kill switch has a matching subtlety: turning off automatic AI ACTIONS must not turn off read-only AI
// insight. An owner hitting the switch because a draft went wrong should still be able to read why an alert
// fired. So the switch clamps the automation level rather than disabling the task.
import { AI_TASKS, type TaskDefinition, type RiskLevel, type ApprovalPolicy } from './ai-task-registry';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { AutomationLevel } from '@aipowersalon/api-contracts/tenant';
import type { AutomationLevel } from '@aipowersalon/api-contracts/tenant';
import { AUTOMATION_LEVELS } from '@aipowersalon/api-contracts/tenant';
export { AUTOMATION_LEVELS };   // the one list of levels lives in the contract; re-exported for this module's callers

/** §111. Ordered from least to most autonomous — the order IS the comparison. */
const rank = (l: AutomationLevel) => AUTOMATION_LEVELS.indexOf(l);
/** §110: the stricter of two levels. */
export const stricter = (a: AutomationLevel, b: AutomationLevel): AutomationLevel => (rank(a) <= rank(b) ? a : b);

/**
 * §111/§112: the MAXIMUM automation the platform permits per task. "Not all tasks support every level."
 * These ceilings follow from the task's own risk and approval policy, and a test proves that rather than
 * trusting the table: nothing here may exceed what §41's approval policy already implies.
 */
export const PLATFORM_MAX_AUTOMATION: Readonly<Record<string, AutomationLevel>> = Object.freeze({
  'review.sentiment_analyze': 'AUTOMATIC',            // a label on a review; nothing acts on it
  'review.response_draft': 'DRAFT',                   // §112 exactly: may create a draft, never send
  'voice.transcribe': 'AUTOMATIC',                    // a record, not a recommendation
  'voice.summarize': 'LIMITED_AUTOMATION',
  'ocr.receipt_extract': 'APPROVAL_REQUIRED',         // §47 feeds inventory and cost
  'forecast.explain': 'LIMITED_AUTOMATION',
  'queue.explain_recommendation': 'SUGGEST_ONLY',     // §112 exactly: may recommend, never assign
  'schedule.explain_suggestion': 'APPROVAL_REQUIRED', // §112 exactly: may propose a change
  'reconciliation.explain_exception': 'SUGGEST_ONLY', // money: a human reads, decides, and acts
  'money.explain_alert': 'SUGGEST_ONLY',
  'receptionist.reply_draft': 'DRAFT',
  'marketing.content_draft': 'DRAFT',
  'business.report_narrate': 'LIMITED_AUTOMATION',
  'checkout.upsell_suggest': 'SUGGEST_ONLY',
});

/** §109: everything the engine decides, in one object. */
export interface SafetyDecision {
  taskKey: string;
  allowed: boolean;
  /** The effective level after platform ceiling, tenant preference and kill switches. */
  automation: AutomationLevel;
  risk: RiskLevel;
  approval: ApprovalPolicy;
  /** §109 allowed tools after the same composition — a tenant may remove tools, never add them. */
  allowedTools: readonly string[];
  /** §62: PII labels the task may keep in free text, after tenant tightening. */
  allowPiiInText: readonly string[];
  /** Human-readable why, for §117. */
  reasons: string[];
  /** Which constraint produced the final level — so an owner can be told what to change. */
  boundBy: 'platform' | 'tenant' | 'platform_kill_switch' | 'tenant_kill_switch' | 'task_off';
}

/** §52/§53 the tenant's own AI settings, as far as safety is concerned. */
export interface TenantSafetySettings {
  /** Per-task preference. Applied as an upper bound only (§110). */
  automation?: Partial<Record<string, AutomationLevel>>;
  /** §113 tenant kill switch for automatic ACTIONS. */
  autoActionsDisabled?: boolean;
  /** Tools the tenant has turned off. Only ever removes. */
  disabledTools?: readonly string[];
  /** PII the tenant permits in prompt text. Intersected with the platform's list — never a superset. */
  allowPiiInText?: readonly string[];
  /** A tenant may switch a task off entirely; that is tightening. */
  disabledTasks?: readonly string[];
}

export interface PlatformSafetyState {
  /** §113 platform-wide kill switch (Super Admin, incident response). */
  autoActionsDisabled?: boolean;
  /** Tasks the platform has suspended globally. */
  suspendedTasks?: readonly string[];
}

/** §113: the level an automatic-action kill switch clamps to. Reading and suggesting survive; acting does not. */
export const KILL_SWITCH_CEILING: AutomationLevel = 'SUGGEST_ONLY';

/** The PII labels the platform will ever allow in prompt text. A tenant may narrow this; nothing widens it. */
export const PLATFORM_ALLOWED_PII: readonly string[] = Object.freeze([]);

export function evaluateSafety(taskKey: string, opts: { tenant?: TenantSafetySettings; platform?: PlatformSafetyState } = {}): SafetyDecision {
  const task = AI_TASKS[taskKey] as TaskDefinition | undefined;
  if (!task) throw new Error(`Unknown AI task "${taskKey}" (§9)`);
  const tenant = opts.tenant ?? {};
  const platform = opts.platform ?? {};
  const reasons: string[] = [];

  // 1. Platform ceiling for this task (§111/§112).
  let automation: AutomationLevel = PLATFORM_MAX_AUTOMATION[taskKey] ?? 'SUGGEST_ONLY';
  let boundBy: SafetyDecision['boundBy'] = 'platform';
  reasons.push(`platform allows at most ${automation} for ${taskKey}`);

  // 2. Tenant preference — an upper bound only. §110: `stricter` cannot raise anything.
  const pref = tenant.automation?.[taskKey];
  if (pref) {
    const next = stricter(automation, pref);
    if (next !== automation) { automation = next; boundBy = 'tenant'; reasons.push(`tenant tightened to ${pref}`); }
    else if (rank(pref) > rank(automation)) reasons.push(`tenant asked for ${pref}; platform ceiling ${automation} stands (§110)`);
  }

  // 3. §113 kill switches. Platform first, then tenant; either clamps, neither disables reading.
  if (platform.autoActionsDisabled && rank(automation) > rank(KILL_SWITCH_CEILING)) {
    automation = KILL_SWITCH_CEILING; boundBy = 'platform_kill_switch';
    reasons.push('platform auto-action kill switch is on; read-only and suggestion AI continue (§113)');
  }
  if (tenant.autoActionsDisabled && rank(automation) > rank(KILL_SWITCH_CEILING)) {
    automation = KILL_SWITCH_CEILING; boundBy = 'tenant_kill_switch';
    reasons.push('tenant auto-action kill switch is on; read-only and suggestion AI continue (§113)');
  }

  // 4. Task switched off — by the tenant (tightening) or suspended by the platform.
  const off = (tenant.disabledTasks ?? []).includes(taskKey) || (platform.suspendedTasks ?? []).includes(taskKey);
  if (off) { automation = 'OFF'; boundBy = 'task_off'; reasons.push('task is switched off'); }

  // 5. §109 tools: the task's declaration, minus anything the tenant disabled. Never a union.
  const allowedTools = task.allowedTools.filter((t) => !(tenant.disabledTools ?? []).includes(t));

  // 6. §62 PII: the intersection, so a tenant listing a label the platform does not allow gains nothing.
  const allowPiiInText = (tenant.allowPiiInText ?? PLATFORM_ALLOWED_PII).filter((p) => PLATFORM_ALLOWED_PII.includes(p));

  return { taskKey, allowed: automation !== 'OFF', automation, risk: task.risk, approval: task.approval, allowedTools, allowPiiInText, reasons, boundBy };
}

/** §111: does this decision permit the platform to act without a human? */
export const permitsAutomaticAction = (d: SafetyDecision) => d.automation === 'AUTOMATIC' || d.automation === 'LIMITED_AUTOMATION';

// ---------------------------------------------------------------------------------------------------------------
// §114–§118 audit and decision trace
// ---------------------------------------------------------------------------------------------------------------
/**
 * §114/§115: what an AI action records. The absence of a `prompt` field is the point — §115 says an audit is not
 * raw prompt logging. What is kept is the prompt VERSION and a hash of the rendered input, which is enough to
 * reproduce (§242) and to prove two runs saw the same thing, without parking customer text in an audit table.
 */
export interface AiAuditRecord {
  tenantId: string;
  actorUserId: string | null;
  module: string;
  taskKey: string;
  jobId: string | null;
  provider: string;
  model: string;
  promptKey: string;
  promptVersion: number;
  /** sha256 of the rendered prompt — a fingerprint, not the content. */
  inputHash: string;
  /** §69: pointers to what was read, never the values. */
  inputReferences: string[];
  toolCalls: Array<{ toolKey: string; approvedByUser: string | null; executed: boolean }>;
  automation: AutomationLevel;
  approvedByUser: string | null;
  outcome: 'COMPLETED' | 'NEEDS_REVIEW' | 'FAILED_VALIDATION' | 'FAILED_PROVIDER' | 'BLOCKED';
  confidence?: number;
  at: string;
}

/** Keys that must never appear in an audit record (§115). Asserted by test against the built object. */
export const AUDIT_FORBIDDEN_KEYS = Object.freeze(['prompt', 'system', 'completion', 'response', 'text', 'transcript', 'messages', 'reviewText', 'customerMessage']);

/**
 * §116/§117/§118: the trace for a high-risk recommendation. `engineFacts` is what the DETERMINISTIC engine
 * computed; `modelOutput` is what the model wrote about it. Keeping them in separate fields is what makes
 * §118 checkable — an explanation is only valid if every fact it rests on is in engineFacts.
 */
export interface AiDecisionTrace {
  taskKey: string;
  inputReferences: string[];
  engineFacts: Record<string, unknown>;
  modelOutput: unknown;
  confidence?: number;
  approval: { required: boolean; approvedByUser: string | null; at: string | null };
  automation: AutomationLevel;
}

/**
 * §117/§118: an explanation must reflect the engine's actual scoring, not an invented rationale. This checks
 * the claim structurally — every factor the explanation cites must be a factor the engine produced.
 *
 * It cannot prove the prose is honest; nothing can. What it CAN do is catch the specific failure §118 names:
 * an explanation citing a factor the engine never computed.
 */
export function citedFactorsAreReal(explanationFactors: readonly string[], engineFacts: Record<string, unknown>): { ok: boolean; invented: string[] } {
  const known = new Set(Object.keys(engineFacts).map((k) => k.toLowerCase()));
  const invented = explanationFactors.filter((f) => !known.has(f.toLowerCase()));
  return { ok: invented.length === 0, invented };
}
