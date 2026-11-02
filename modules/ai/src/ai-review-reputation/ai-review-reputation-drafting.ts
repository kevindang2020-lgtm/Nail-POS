// ai-review-reputation-drafting.ts — PURE drafting/approval safety. Three safety-critical pieces:
//   1. autoResponseDecision — the controlled auto-response gate. Deny-by-default; allows ONLY a clean 5-star, high-
//      confidence, no-signal, no-category, non-spam/injection review when the tenant has explicitly enabled it. Any risk
//      condition falls back to human approval.
//   2. validateDraftSafety — a generated draft (from any model) is BLOCKED if it leaks PII/payment/contact info, admits
//      legal liability, or names an employee. Runs before a draft can be approved or auto-published.
//   3. the approval state machine — legal transitions only; a public response cannot reach `published` without passing
//      through `approved` (or the audited auto-response path).
import type { ReviewAnalysis } from './ai-review-reputation-core';
import type { ReputationConfig } from './ai-review-reputation-settings';

// ---- 1. controlled auto-response gate ----
export interface AutoResponseDecision { allow: boolean; reason: string; }
export function autoResponseDecision(analysis: ReviewAnalysis, rating: number | null, config: ReputationConfig): AutoResponseDecision {
  const ar = config.autoResponse;
  if (!ar.enabled) return { allow: false, reason: 'auto_response_disabled' };
  if (analysis.escalationRequired) return { allow: false, reason: 'escalation_required' };
  if (analysis.seriousSignals.length > 0) return { allow: false, reason: 'serious_signal' };
  if (analysis.isSpam) return { allow: false, reason: 'spam' };
  if (analysis.injectionSuspected) return { allow: false, reason: 'injection_suspected' };
  if (analysis.sentiment !== 'positive') return { allow: false, reason: 'not_positive' };
  if (analysis.categories.length > 0) return { allow: false, reason: 'has_complaint_category' };
  if ((rating ?? 0) < ar.minRating) return { allow: false, reason: 'below_min_rating' };
  if (analysis.confidence < ar.confidenceThreshold) return { allow: false, reason: 'below_confidence' };
  return { allow: true, reason: 'ok' };
}

// ---- 2. draft safety validator ----
export interface DraftSafetyResult { safe: boolean; violations: string[]; }
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE = /(\+?\d[\d\s().-]{8,}\d)/;
const MONEY = /\$\s?\d/;
const CARD = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
const LIABILITY = [/\bwe (admit|accept)( full)? (fault|liability|responsibility)\b/i, /\bour (mistake|negligence) (caused|led to)\b/i, /\bwe are (legally )?liable\b/i, /\bthis was our fault\b/i];
export function validateDraftSafety(text: string | null, opts?: { employeeNames?: string[] }): DraftSafetyResult {
  const t = String(text ?? '');
  const v: string[] = [];
  if (EMAIL.test(t)) v.push('contains_email');
  if (PHONE.test(t)) v.push('contains_phone');
  if (MONEY.test(t) || CARD.test(t)) v.push('contains_payment_detail');
  if (LIABILITY.some((r) => r.test(t))) v.push('admits_liability');
  for (const name of opts?.employeeNames || []) { if (name && t.toLowerCase().includes(name.toLowerCase())) { v.push('names_employee'); break; } }
  return { safe: v.length === 0, violations: v };
}

// ---- 3. approval state machine ----
export type ResponseStatus =
  | 'review_received' | 'analysis_pending' | 'analyzed' | 'draft_generated' | 'awaiting_approval' | 'approved'
  | 'publishing' | 'published' | 'rejected' | 'needs_revision' | 'escalated' | 'no_response_required'
  | 'publish_failed' | 'archived';

const LEGAL: Record<ResponseStatus, ResponseStatus[]> = {
  review_received: ['analysis_pending', 'analyzed', 'escalated', 'no_response_required'],
  analysis_pending: ['analyzed', 'escalated'],
  analyzed: ['draft_generated', 'no_response_required', 'escalated'],
  draft_generated: ['awaiting_approval', 'needs_revision', 'no_response_required', 'escalated', 'published'], // published only via auto-response gate
  awaiting_approval: ['approved', 'rejected', 'needs_revision', 'escalated'],
  approved: ['publishing', 'needs_revision'],
  publishing: ['published', 'publish_failed'],
  publish_failed: ['publishing', 'awaiting_approval'],
  needs_revision: ['draft_generated', 'awaiting_approval'],
  rejected: ['archived', 'needs_revision'],
  escalated: ['analyzed', 'awaiting_approval', 'no_response_required', 'archived'],
  no_response_required: ['archived', 'analyzed'],
  published: ['archived'],
  archived: [],
};
export function transitionResponse(from: ResponseStatus, to: ResponseStatus): ResponseStatus {
  if (from === to) return from;
  if (!LEGAL[from].includes(to)) throw new Error('INVALID_RESPONSE_TRANSITION');
  return to;
}

/** A public response may be published only from `approved` (manual) or via an explicitly auto-approved gate result. */
export function canPublish(status: ResponseStatus, opts?: { autoApproved?: boolean }): boolean {
  if (status === 'approved') return true;
  if (opts?.autoApproved && status === 'draft_generated') return true;
  return false;
}

// ---- draft transformation directives (the LLM applies them; the service re-validates the output) ----
export type DraftDirective = 'generate' | 'regenerate' | 'shorten' | 'expand' | 'warmer' | 'more_professional' | 'translate';
