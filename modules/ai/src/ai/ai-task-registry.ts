// ai-task-registry.ts — Constitution 10 Phases 3–4: the AI Platform's authoritative list of allowed tasks.
//
// §9: a tenant application may only ask for a task that appears here. There is deliberately no
// `ai.run_arbitrary_prompt` — an open prompt endpoint is how prompt injection becomes a system instruction
// (§27, §303) and how cost becomes unbounded (§183).
//
// §10: a task declares everything the platform needs to route, budget, validate and police it BEFORE any
// provider is contacted. Nothing here is decided by the model; the model is told what it may do.
//
// §42 is the rule that shapes the risk column: AI never overrides a hard constraint. `queue.recommend_assignment`
// is MEDIUM not because the model is trustworthy but because the deterministic engine has already eliminated
// every technician who is off-shift, at another branch, unskilled or unavailable — the model only ranks what is
// already legal. A task whose output would be acted on without such a filter does not belong at MEDIUM.

/** §36. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
/** §41. */
export type ApprovalPolicy = 'NO_APPROVAL' | 'REVIEW_BEFORE_USE' | 'APPROVAL_BEFORE_EXECUTION' | 'DUAL_APPROVAL';
/** §11: routing asks for a CAPABILITY, never a provider or a model name. */
export type Capability = 'text.generate' | 'text.classify' | 'text.summarize' | 'vision.extract' | 'audio.transcribe' | 'embedding.create';

export interface TaskDefinition {
  /** §9 `domain.verb` — the wire key a module passes to the platform. */
  key: string;
  module: string;
  description: string;
  capability: Capability;
  /** §10/§11: allow-lists. Empty allowedModels = any model of an allowed provider that offers the capability. */
  allowedProviders: string[];
  allowedModels: string[];
  defaultModel: string | null;
  /** §73: keys into the output schema registry. `null` input schema = the module's own typed input. */
  inputSchema: string | null;
  outputSchema: string;
  risk: RiskLevel;
  mode: 'sync' | 'async';
  maxOutputTokens: number;
  /** §84 wall-clock budget for the provider call. */
  timeoutMs: number;
  /** §89/§90: 0 disables caching for this task. A cache key is ALWAYS tenant-scoped (§303 no cross-tenant cache). */
  cacheTtlSeconds: number;
  approval: ApprovalPolicy;
  /** §278: deterministic extraction runs cold; creative generation may not. */
  temperature: number;
  /** §29/§32: tools this task may invoke. Empty = none, which is the default and the safe answer. */
  allowedTools: string[];
  /** Why this risk level — so a later reader does not have to re-derive the judgement (§117). */
  riskRationale: string;
}

const T = (d: TaskDefinition): TaskDefinition => d;

/**
 * The registry. Every task an AI module may ask for. Adding a row is a deliberate act: it declares a cost
 * ceiling, a risk level and an approval policy at the same time.
 */
export const AI_TASKS: Readonly<Record<string, TaskDefinition>> = Object.freeze({
  // ---- reviews (§50, §193) ----
  'review.sentiment_analyze': T({
    key: 'review.sentiment_analyze', module: 'ai-review-reputation', description: 'Classify the sentiment of a customer review.',
    capability: 'text.classify', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'review.sentiment.v1', risk: 'LOW', mode: 'sync', maxOutputTokens: 200,
    timeoutMs: 20_000, cacheTtlSeconds: 86_400, approval: 'NO_APPROVAL', temperature: 0, allowedTools: [],
    riskRationale: 'Reads one review and returns a label; nothing acts on it automatically.',
  }),
  'review.response_draft': T({
    key: 'review.response_draft', module: 'ai-review-reputation', description: 'Draft a salon response to a customer review.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'review.response.v1', risk: 'MEDIUM', mode: 'sync', maxOutputTokens: 500,
    timeoutMs: 30_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0.4, allowedTools: [],
    riskRationale: '§193: text published under the salon name. A human sends it, never the platform.',
  }),

  // ---- voice (§51, §154) ----
  'voice.transcribe': T({
    key: 'voice.transcribe', module: 'ai-voice-transcription', description: 'Transcribe a recorded call.',
    capability: 'audio.transcribe', allowedProviders: ['openai'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'voice.transcript.v1', risk: 'LOW', mode: 'async', maxOutputTokens: 4_000,
    timeoutMs: 120_000, cacheTtlSeconds: 0, approval: 'NO_APPROVAL', temperature: 0, allowedTools: [],
    riskRationale: '§153/§154: LOW because a transcript is a RECORD, not a recommendation — nothing acts on it. '
      + 'Consent is a precondition enforced before the task is dispatched, and §154 redaction runs on the output. '
      + 'It was first written MEDIUM/NO_APPROVAL, which the registry\'s own invariant rejected: a MEDIUM task is by '
      + 'definition a human-visible recommendation, and one nobody has to see is an action. Either the level or the '
      + 'policy had to move; the honest answer is that transcription is not a recommendation at all.',
  }),
  'voice.summarize': T({
    key: 'voice.summarize', module: 'ai-voice-transcription', description: 'Summarize a transcribed call.',
    capability: 'text.summarize', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'voice.summary.v1', risk: 'LOW', mode: 'async', maxOutputTokens: 600,
    timeoutMs: 30_000, cacheTtlSeconds: 0, approval: 'NO_APPROVAL', temperature: 0.2, allowedTools: [],
    riskRationale: 'Summarizes text the tenant already holds; human-visible only.',
  }),

  // ---- OCR (§47, §155) ----
  'ocr.receipt_extract': T({
    key: 'ocr.receipt_extract', module: 'ai-ocr-receipt', description: 'Extract line items and totals from a supplier receipt image.',
    capability: 'vision.extract', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'ocr.receipt.v1', risk: 'MEDIUM', mode: 'async', maxOutputTokens: 2_000,
    timeoutMs: 90_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0, allowedTools: [],
    riskRationale: '§47: extraction feeds inventory and cost. Low confidence routes to human review, never straight in.',
  }),

  // ---- forecasting (§44, §157, §206) ----
  'forecast.explain': T({
    key: 'forecast.explain', module: 'ai-analytics-forecasting', description: 'Explain a forecast produced by the deterministic model, in words.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'forecast.explanation.v1', risk: 'LOW', mode: 'sync', maxOutputTokens: 400,
    timeoutMs: 30_000, cacheTtlSeconds: 3_600, approval: 'NO_APPROVAL', temperature: 0.3, allowedTools: [],
    riskRationale: '§44/§303: the NUMBERS come from the deterministic forecaster. The model only narrates them. '
      + 'There is deliberately no forecast.appointment_demand or forecast.revenue task — an LLM must never be the numerical forecaster.',
  }),

  // ---- queue (§45, §42) ----
  // CORRECTED during Phase 23 migration. This registry first declared `queue.recommend_assignment`, assuming the
  // module asked a model to rank technicians from an eligible shortlist. It does not: ai-queue-assignment-engine
  // ranks deterministically via scoreTechnician(), and the ONLY model call in the module explains a ranking that
  // already exists. The task now matches what the code actually does — which is also the stricter reading of §45.
  'queue.explain_recommendation': T({
    key: 'queue.explain_recommendation', module: 'ai-queue-assignment', description: 'Explain a technician recommendation the deterministic engine already produced.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'queue.explanation.v1', risk: 'MEDIUM', mode: 'sync', maxOutputTokens: 400,
    timeoutMs: 20_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0.1, allowedTools: [],
    riskRationale: '§42/§45: scoreTechnician() has already chosen. The model writes the sentence a human reads; '
      + 'it neither ranks nor assigns. There is deliberately no task that lets a model pick the technician.',
  }),

  // ---- scheduling (§43) ----
  'schedule.explain_suggestion': T({
    key: 'schedule.explain_suggestion', module: 'ai-scheduling-optimizer', description: 'Explain a schedule suggestion produced by the constraint solver.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'schedule.explanation.v1', risk: 'MEDIUM', mode: 'sync', maxOutputTokens: 400,
    timeoutMs: 20_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0.2, allowedTools: [],
    riskRationale: '§43/§303: constraints are solved deterministically. An automatic schedule CHANGE is §39 HIGH '
      + 'and is not a task here — a human applies the suggestion.',
  }),

  // ---- reconciliation (§46, §160, §208) ----
  'reconciliation.explain_exception': T({
    key: 'reconciliation.explain_exception', module: 'deposit-reconciliation', description: 'Explain a deposit exception the deterministic matcher could not resolve.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'reconciliation.explanation.v1', risk: 'HIGH', mode: 'sync', maxOutputTokens: 500,
    timeoutMs: 30_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0, allowedTools: [],
    riskRationale: '§46/§303: money. The matcher decides what reconciles; the model only explains an exception a '
      + 'human is already looking at. It is never the reconciliation engine and never moves money.',
  }),

  // ---- money protection (§61) ----
  'money.explain_alert': T({
    key: 'money.explain_alert', module: 'ai-money-protection', description: 'Explain a cash or payment anomaly alert in plain language.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'money.explanation.v1', risk: 'HIGH', mode: 'sync', maxOutputTokens: 400,
    timeoutMs: 30_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0, allowedTools: [],
    riskRationale: '§61: financial amounts in context. The detector raises the alert deterministically; the model '
      + 'narrates it for an owner who then decides.',
  }),

  // ---- receptionist (§48, §49) ----
  'receptionist.reply_draft': T({
    key: 'receptionist.reply_draft', module: 'ai', description: 'Draft a reply to an inbound customer message.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'receptionist.reply.v1', risk: 'MEDIUM', mode: 'sync', maxOutputTokens: 500,
    timeoutMs: 30_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0.4, allowedTools: [],
    riskRationale: '§48/§49: speaks to a customer as the salon. Booking or payment actions are tools it does not '
      + 'have — allowedTools is empty until a tool registry with server-derived context exists (§135).',
  }),

  // ---- marketing (§280) ----
  'marketing.content_draft': T({
    key: 'marketing.content_draft', module: 'ai-marketing', description: 'Draft marketing copy for a campaign.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'marketing.content.v1', risk: 'LOW', mode: 'sync', maxOutputTokens: 800,
    timeoutMs: 30_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0.7, allowedTools: [],
    riskRationale: '§280: creative generation. A human approves before anything is sent.',
  }),

  // ---- business reporting ----
  'business.report_narrate': T({
    key: 'business.report_narrate', module: 'ai-business', description: 'Narrate a computed business report.',
    capability: 'text.summarize', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'business.narrative.v1', risk: 'LOW', mode: 'sync', maxOutputTokens: 600,
    timeoutMs: 30_000, cacheTtlSeconds: 1_800, approval: 'NO_APPROVAL', temperature: 0.3, allowedTools: [],
    riskRationale: 'The figures are computed by reports; the model writes prose around them.',
  }),

  // ---- checkout upsell ----
  'checkout.upsell_suggest': T({
    key: 'checkout.upsell_suggest', module: 'ai-checkout-upsell', description: 'Suggest an add-on service at checkout from an eligible catalogue.',
    capability: 'text.generate', allowedProviders: ['openai', 'anthropic'], allowedModels: [], defaultModel: null,
    inputSchema: null, outputSchema: 'checkout.upsell.v1', risk: 'MEDIUM', mode: 'sync', maxOutputTokens: 300,
    timeoutMs: 15_000, cacheTtlSeconds: 0, approval: 'REVIEW_BEFORE_USE', temperature: 0.4, allowedTools: [],
    riskRationale: 'Shown to staff during a sale. The eligible catalogue is computed deterministically; the model '
      + 'picks from it and never prices, discounts or charges anything (§142).',
  }),
});

/** §9: the only way to turn a wire string into a task. Unknown keys are refused, never guessed. */
export function resolveTask(key: string): TaskDefinition {
  const t = (AI_TASKS as Record<string, TaskDefinition>)[key];
  if (!t) throw new UnknownTaskError(key);
  return t;
}
export class UnknownTaskError extends Error {
  readonly status = 400;
  constructor(readonly taskKey: string) {
    super(`Unknown AI task "${taskKey}" — tasks must be declared in the AI Task Registry (§9)`);
    this.name = 'UnknownTaskError';
  }
}

/** §36/§41: the approval policy a risk level may never fall below. */
export const MIN_APPROVAL_FOR_RISK: Readonly<Record<RiskLevel, ApprovalPolicy[]>> = Object.freeze({
  LOW: ['NO_APPROVAL', 'REVIEW_BEFORE_USE', 'APPROVAL_BEFORE_EXECUTION', 'DUAL_APPROVAL'],
  MEDIUM: ['REVIEW_BEFORE_USE', 'APPROVAL_BEFORE_EXECUTION', 'DUAL_APPROVAL'],
  HIGH: ['REVIEW_BEFORE_USE', 'APPROVAL_BEFORE_EXECUTION', 'DUAL_APPROVAL'],
  CRITICAL: ['APPROVAL_BEFORE_EXECUTION', 'DUAL_APPROVAL'],
});
