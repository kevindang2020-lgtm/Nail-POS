// ai-platform.adapters.ts — Constitution 10 §18: thin, typed adapters that map a module's own narrow port onto
// AiPlatform.execute(). The module keeps depending on its interface; the wiring lives here, next to the platform.
//
// Each adapter does three things and nothing else: name the task key, pass the declared variables, and unwrap
// the validated data. Business rules stay in the module, provider concerns stay in the platform.
import type { AiPlatform } from './ai-platform';

/** ai-money-protection: money.explain_alert (HIGH risk, REVIEW_BEFORE_USE). */
export const moneyExplainAdapter = (platform: AiPlatform) => ({
  async explain(req: { tenantId: string; userId: string | null; alertJson: unknown }) {
    const r = await platform.execute<{ explanation: string; first_check: string }>({
      taskKey: 'money.explain_alert', tenantId: req.tenantId, userId: req.userId, variables: { alert_json: req.alertJson },
    });
    return r.data ? { explanation: r.data.explanation, firstCheck: r.data.first_check } : null;
  },
});

/** ai-queue-assignment: queue.explain_recommendation. The engine chose; the model only writes the sentence. */
export const queueExplainAdapter = (platform: AiPlatform) => ({
  async explain(req: { tenantId: string; userId: string | null; recommendation: unknown }) {
    const r = await platform.execute<{ explanation: string; key_factor: string }>({
      taskKey: 'queue.explain_recommendation', tenantId: req.tenantId, userId: req.userId,
      variables: { recommendation_json: req.recommendation },
    });
    return r.data ? { explanation: r.data.explanation, keyFactor: r.data.key_factor } : null;
  },
});

/**
 * ai-marketing: marketing.content_draft. The module computes the prompt's per-request variables itself
 * (buildPromptVariables), because the offer rule, channel rule and allowed-token list are its domain rules and
 * validateDraft depends on them staying exactly as they are.
 */
export const marketingDraftAdapter = (platform: AiPlatform) => ({
  async draft(req: { tenantId: string; userId: string | null; variables: Record<string, string> }) {
    const r = await platform.execute<{ subject: string | null; message: string }>({
      taskKey: 'marketing.content_draft', tenantId: req.tenantId, userId: req.userId, variables: req.variables,
    });
    // ContentDraft already surfaces token counts and the model used, so the adapter passes the platform's
    // usage through rather than dropping it — the screen keeps showing what it always showed.
    return r.data ? { ...r.data, usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, provider: r.provenance.provider, model: r.provenance.model } } : null;
  },
});

/** ai-voice-transcription: voice.summarize (the transcript is already redacted by the module). */
export const voiceSummarizeAdapter = (platform: AiPlatform) => ({
  async summarize(req: { tenantId: string; userId: string | null; transcript: string }) {
    const r = await platform.execute<{ intent: string; service: string | null; requested_time: string | null; follow_up: string | null; summary: string }>({
      taskKey: 'voice.summarize', tenantId: req.tenantId, userId: req.userId, variables: { transcript: req.transcript },
    });
    return r.data ? { intent: r.data.intent, service: r.data.service, requestedTime: r.data.requested_time, followUp: r.data.follow_up, summary: r.data.summary } : null;
  },
});
