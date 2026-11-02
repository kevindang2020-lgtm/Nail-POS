// ai-queue-assignment-explanation.ts — PURE. A recommendation is always explainable from its own structured reasons
// (deterministicExplanation) with NO model call. The AI gateway is only used to phrase that more naturally; if it's
// unavailable/disabled the deterministic text is used verbatim. sanitize() bounds and cleans any model output so a
// misbehaving provider can't inject control characters or unbounded text into the UI.
import type { RecommendationEnvelope } from './ai-queue-assignment.dto';

export function deterministicExplanation(env: RecommendationEnvelope): string {
  if (!env.recommended) {
    const why = env.conflicts.length ? env.conflicts.join('; ') : 'no eligible technician is available';
    return `No technician could be recommended: ${why}.`;
  }
  const r = env.recommended;
  const reasons = r.reasons.slice(0, 3);
  // BUILD_PLAN Phase 6 (audit, explanations): a suggestion for staff to confirm — never "the best match" (the spec forbids
  // presenting it as a verdict).
  let out = `Suggested: ${r.name}`;
  if (reasons.length) out += ` — ${reasons.join(', ')}`;
  out += `.`;
  if (env.warnings.length) out += ` Note: ${env.warnings.join('; ')}.`;
  out += ` Confidence ${Math.round(env.confidence * 100)}%.`;
  return out;
}

// Build the sanitized, PII-free prompt payload from the envelope (technician names + reasons only — never customer data).
export function explanationPromptData(env: RecommendationEnvelope): Record<string, unknown> {
  return {
    recommendedTechnician: env.recommended?.name ?? null,
    reasons: env.recommended?.reasons?.slice(0, 5) ?? [],
    warnings: env.warnings.slice(0, 5),
    confidencePercent: Math.round(env.confidence * 100),
    alternates: env.alternates.map((a) => a.name).slice(0, 3),
    requiredAction: env.requiredAction,
  };
}

const MAX_LEN = 400;
export function sanitize(text: string): string {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex -- deliberate: strip control chars from model/OCR output
    .replace(/[\u0000-\u001f\u007f]+/g, ' ') // strip control chars/newlines
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}
