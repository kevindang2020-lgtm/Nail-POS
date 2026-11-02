// voice-learning-core.ts — pure, testable safety logic for the improvement loop. No I/O. This is where the "AI never
// auto-changes production" invariants live: what the loop may target, how prompt versions transition (activation is a
// separate explicit human step), and a deterministic (no-LLM) evaluator that flags calls worth a human's review.

/** The ONLY things a learning suggestion may propose changing. Everything operational is deliberately excluded. */
export const ALLOWED_SUGGESTION_TARGETS = ['prompt', 'faq', 'knowledge', 'pronunciation', 'tool_description'] as const;
export type SuggestionTarget = typeof ALLOWED_SUGGESTION_TARGETS[number];

/** Things the learning loop must NEVER change (even with approval, these go through their own POS modules, not here). */
export const FORBIDDEN_AUTO_CHANGE = [
  'price', 'prices', 'hours', 'business_hours', 'cancellation_policy', 'deposit_rules', 'refund_rules',
  'schedule', 'schedules', 'security', 'permissions', 'booking_validation', 'tenant_permissions',
] as const;

export function isAllowedSuggestionTarget(t: string): t is SuggestionTarget {
  return (ALLOWED_SUGGESTION_TARGETS as readonly string[]).includes(t);
}
export function isForbiddenTarget(t: string): boolean {
  return (FORBIDDEN_AUTO_CHANGE as readonly string[]).includes(String(t).toLowerCase().trim());
}

// ---- Prompt-version state machine. Activation is NEVER automatic — it's an explicit transition a human triggers. ----
// PromptStatus: the platform contract's VoicePromptStatus (Constitution 13 §15).
import type { VoicePromptStatus } from '@aipowersalon/api-contracts/platform';
export type PromptStatus = VoicePromptStatus;
const TRANSITIONS: Record<PromptStatus, PromptStatus[]> = {
  draft: ['pending_review', 'archived'],
  pending_review: ['active', 'draft', 'archived'], // → active is the explicit human activation
  active: ['archived'],                             // an active version can only be retired (rollback activates another)
  archived: ['active'],                             // rollback: re-activate a previously-archived version
};
export function canTransition(from: PromptStatus, to: PromptStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ---- Deterministic evaluator (no LLM). Turns a stored call outcome into review signals. ----
export interface OutcomeSignalsInput {
  toolCalls?: { name: string; ok: boolean }[];
  repeatedQuestionCount?: number;
  interruptionCount?: number;
  abandoned?: boolean;
  bookingOutcome?: string | null;
  handoffOutcome?: string | null;
}
export interface OutcomeSignals {
  toolFailures: number;
  reviewWorthy: boolean;         // should a human look at this call for improvement ideas?
  categories: string[];          // why (drives suggestion category)
}

/** Flag a call for human review based on concrete, deterministic signals — never auto-acts on them. */
export function evaluateOutcome(o: OutcomeSignalsInput): OutcomeSignals {
  const categories: string[] = [];
  const toolFailures = (o.toolCalls ?? []).filter((t) => t.ok === false).length;
  if (toolFailures > 0) categories.push('tool_failure');
  if ((o.repeatedQuestionCount ?? 0) >= 2) categories.push('repeated_questions');
  if ((o.interruptionCount ?? 0) >= 4) categories.push('excessive_interruptions');
  if (o.abandoned === true) categories.push('abandoned');
  if (o.bookingOutcome === 'failed') categories.push('failed_booking');
  return { toolFailures, reviewWorthy: categories.length > 0, categories };
}
