// ai-review-reputation-recovery.ts — PURE recovery + escalation logic. Two safety rules baked in:
//   1. Financial recovery actions (refund/credit/loyalty/discount) are RECOMMENDATIONS ONLY — always
//      requiresAuthorization=true and carry `delegatesTo` pointing at the existing system. This module never issues money.
//   2. Escalation notifications contain NO review text and NO customer PII — only a severity and a secure link, so
//      sensitive complaint details never travel through SMS/email/push.
import type { ReviewAnalysis, Severity } from './ai-review-reputation-core';
import { REVIEW_ESCALATION } from '../ai-lifecycles';

export type RecoveryActionType =
  | 'manager_call' | 'private_sms' | 'private_email' | 'apology' | 'free_repair' | 'service_redo'
  | 'technician_reassignment' | 'partial_refund_review' | 'full_refund_review' | 'account_credit'
  | 'loyalty_points' | 'discount_future' | 'complimentary_addon' | 'internal_coaching'
  | 'sanitation_investigation' | 'payment_investigation' | 'appointment_investigation'
  | 'escalate_owner' | 'escalate_super_admin';

// which existing platform system executes a financial action (never this module)
const DELEGATES: Partial<Record<RecoveryActionType, string>> = {
  partial_refund_review: 'refunds', full_refund_review: 'refunds', account_credit: 'credits',
  loyalty_points: 'loyalty', discount_future: 'discounts', complimentary_addon: 'services',
};
export function isFinancialAction(t: RecoveryActionType): boolean { return t in DELEGATES; }

export interface RecoveryRecommendation {
  type: RecoveryActionType; priority: number;
  requiresAuthorization: boolean;         // true for every financial action
  delegatesTo: string | null;             // the existing system that must execute it
  rationale: string;
  autoExecute: false;                     // hard-coded: recovery is never auto-executed by this module
}

const rec = (type: RecoveryActionType, priority: number, rationale: string): RecoveryRecommendation => ({
  type, priority, requiresAuthorization: isFinancialAction(type), delegatesTo: DELEGATES[type] ?? null, rationale, autoExecute: false,
});

/** Recommend recovery actions for negative/serious feedback. Ordered by priority. Purely advisory. */
export function recommendRecoveryActions(analysis: ReviewAnalysis, rating: number | null): RecoveryRecommendation[] {
  const out: RecoveryRecommendation[] = [];
  const sig = new Set(analysis.seriousSignals);
  const cat = new Set(analysis.categories);

  if (sig.has('injury') || sig.has('infection') || sig.has('chemical_burn') || sig.has('allergic_reaction')) {
    out.push(rec('manager_call', 1, 'Health/safety concern — personal contact by a manager.'));
    out.push(rec('sanitation_investigation', 2, 'Investigate sanitation/procedure per health-safety concern.'));
    out.push(rec('escalate_owner', 3, 'Owner awareness required for a health/safety complaint.'));
  }
  if (sig.has('sanitation')) out.push(rec('sanitation_investigation', 2, 'Sanitation concern raised.'));
  if (sig.has('discrimination') || sig.has('harassment')) { out.push(rec('escalate_owner', 1, 'Conduct complaint — owner review.')); out.push(rec('internal_coaching', 3, 'Staff coaching may be warranted.')); }
  if (sig.has('fraud') || sig.has('unauthorized_charge') || cat.has('unauthorized_charge')) { out.push(rec('payment_investigation', 1, 'Billing concern — investigate before any refund.')); out.push(rec('partial_refund_review', 4, 'Refund may be warranted — route to the refunds system for authorization.')); }
  if (cat.has('pricing_dispute')) out.push(rec('payment_investigation', 3, 'Pricing dispute — verify charges.'));
  if (cat.has('refund_request')) out.push(rec('full_refund_review', 3, 'Customer requested a refund — route to refunds for authorization.'));
  if (cat.has('nail_damage') || cat.has('incorrect_service')) { out.push(rec('service_redo', 2, 'Offer a redo of the service.')); out.push(rec('free_repair', 3, 'Offer a repair.')); out.push(rec('technician_reassignment', 4, 'Consider a different technician next visit.')); }
  if (cat.has('long_wait') || cat.has('service_quality') || cat.has('staff_attitude')) { out.push(rec('apology', 2, 'Acknowledge and apologize.')); out.push(rec('discount_future', 4, 'A goodwill discount may help — route to discounts for authorization.')); }

  if (out.length === 0 && (rating ?? 5) <= 3) out.push(rec('apology', 3, 'Acknowledge the feedback and invite a private conversation.'));
  // de-dup by type keeping the highest priority (lowest number)
  const best = new Map<RecoveryActionType, RecoveryRecommendation>();
  for (const r of out) { const cur = best.get(r.type); if (!cur || r.priority < cur.priority) best.set(r.type, r); }
  return [...best.values()].sort((a, b) => a.priority - b.priority);
}

// --- escalation state machine ---
export type EscalationStatus = 'open' | 'acknowledged' | 'resolved';
/** BUILD_PLAN Phase 12 (#27): the ONE table is the review_escalation machine (ai-lifecycles.ts). */
const ESC_LEGAL = (from: EscalationStatus): readonly EscalationStatus[] => (REVIEW_ESCALATION.transitions[from] ?? []) as readonly EscalationStatus[];
export function transitionEscalation(from: EscalationStatus, to: EscalationStatus): EscalationStatus {
  if (from === to) return from;
  if (!ESC_LEGAL(from).includes(to)) throw new Error('INVALID_ESCALATION_TRANSITION');
  return to;
}

export interface EscalationRecord { severity: Severity; signals: string[]; status: EscalationStatus; }
export function buildEscalation(analysis: ReviewAnalysis): EscalationRecord | null {
  if (!analysis.escalationRequired) return null;
  return { severity: analysis.severity, signals: analysis.seriousSignals, status: 'open' };
}

// --- secure notification (NO review text / PII) ---
export interface SecureNotification { severity: Severity; reviewId: string; secureLink: string; summary: string; containsPii: false; }
export function buildSecureNotification(reviewId: string, severity: Severity, baseUrl: string): SecureNotification {
  const path = `/reviews/${encodeURIComponent(reviewId)}`;
  return {
    severity, reviewId,
    secureLink: `${String(baseUrl || '').replace(/\/+$/, '')}${path}`,
    summary: `A ${severity} complaint needs review. Open the secure link to view details.`,   // generic, no content
    containsPii: false,
  };
}
