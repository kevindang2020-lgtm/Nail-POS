// ai-money-protection-catalog.ts — the detection matrix (spec §33/§97) as a single source of truth. PURE data +
// a resolver that overlays current feature-flag state. This documents every rule the module can raise: its
// category, severity, detection layer, evaluation mode, default thresholds, and whether it needs human review.
import type { Severity } from './ai-money-protection.dto';
import { moneyProtectionFlags, type MoneyProtectionFlags } from './ai-money-protection-flags';

export type RuleCategory =
  | 'duplicate_charge' | 'refund' | 'void' | 'discount' | 'tip' | 'failed_payment'
  | 'reconciliation' | 'employee' | 'integrity';
export type DetectionLayer = 'deterministic' | 'baseline' | 'reconciliation';
export type EvaluationMode = 'realtime' | 'near_realtime' | 'batch';

export interface RuleDescriptor {
  id: string;
  alertType: string;
  name: string;
  category: RuleCategory;
  layer: DetectionLayer;
  severity: Severity;
  evaluationMode: EvaluationMode;
  humanReview: boolean;           // always true for anything that could reflect on a person
  description: string;
  defaultThresholds: Record<string, number | string>;
}

export const RULE_CATALOG: RuleDescriptor[] = [
  { id: 'MP_DUP_CHARGE_EXACT', alertType: 'duplicate_charge_exact', name: 'Exact duplicate charge', category: 'duplicate_charge', layer: 'deterministic', severity: 'CRITICAL', evaluationMode: 'realtime', humanReview: true,
    description: 'Two captured payments share a processor transaction id or idempotency key.', defaultThresholds: {} },
  { id: 'MP_DUP_CHARGE_LIKELY', alertType: 'duplicate_charge_likely', name: 'Likely duplicate charge', category: 'duplicate_charge', layer: 'deterministic', severity: 'HIGH', evaluationMode: 'realtime', humanReview: true,
    description: 'Same ticket, amount, and method captured more than once in a short window (split payments excluded).', defaultThresholds: { windowSeconds: 120 } },
  { id: 'MP_REFUND_EXCEEDS_CAPTURE', alertType: 'refund_exceeds_capture', name: 'Refund exceeds captured', category: 'refund', layer: 'deterministic', severity: 'HIGH', evaluationMode: 'realtime', humanReview: true,
    description: 'Total refunds on a ticket exceed the amount captured.', defaultThresholds: {} },
  { id: 'MP_REFUND_METHOD_MISMATCH', alertType: 'refund_method_mismatch', name: 'Refund method mismatch', category: 'refund', layer: 'deterministic', severity: 'HIGH', evaluationMode: 'realtime', humanReview: true,
    description: 'A refund was issued by a method never used to pay the ticket (e.g. card sale refunded as cash).', defaultThresholds: {} },
  { id: 'MP_DISCOUNT_EXCEEDS_SUBTOTAL', alertType: 'discount_exceeds_subtotal', name: 'Discount exceeds subtotal', category: 'discount', layer: 'deterministic', severity: 'HIGH', evaluationMode: 'realtime', humanReview: true,
    description: 'A discount larger than the ticket subtotal — impossible under normal policy.', defaultThresholds: {} },
  { id: 'MP_NEGATIVE_CAPTURE', alertType: 'negative_capture_amount', name: 'Negative captured amount', category: 'integrity', layer: 'deterministic', severity: 'MEDIUM', evaluationMode: 'realtime', humanReview: true,
    description: 'A captured payment has a negative amount — a data-integrity anomaly.', defaultThresholds: {} },
  { id: 'MP_MULTIPLE_REVERSALS', alertType: 'multiple_reversals', name: 'Multiple reversals on one ticket', category: 'void', layer: 'deterministic', severity: 'MEDIUM', evaluationMode: 'near_realtime', humanReview: true,
    description: 'A ticket has two or more refund/void records — a possible double reversal.', defaultThresholds: { minReversals: 2 } },
  { id: 'MP_FAILED_PAYMENT_RETRY_LOOP', alertType: 'failed_payment_retry_loop', name: 'Failed-payment retry loop', category: 'failed_payment', layer: 'deterministic', severity: 'MEDIUM', evaluationMode: 'near_realtime', humanReview: true,
    description: 'Repeated declined attempts on one ticket in a short window (possible stuck terminal or card testing).', defaultThresholds: { minDeclines: 4, windowMinutes: 15, highSeverityAt: 8 } },
  { id: 'MP_PAID_NO_CAPTURE', alertType: 'paid_ticket_no_capture', name: 'Paid ticket without capture', category: 'reconciliation', layer: 'deterministic', severity: 'HIGH', evaluationMode: 'realtime', humanReview: true,
    description: 'A ticket marked paid with a non-zero total but no captured payment.', defaultThresholds: {} },
  { id: 'MP_CAPTURE_ON_CANCELLED', alertType: 'capture_on_cancelled_ticket', name: 'Captured money on cancelled ticket', category: 'reconciliation', layer: 'deterministic', severity: 'HIGH', evaluationMode: 'realtime', humanReview: true,
    description: 'A cancelled/voided ticket still has net captured money not refunded.', defaultThresholds: {} },
  { id: 'MP_REVERSAL_RATE_OUTLIER', alertType: 'reversal_rate_outlier', name: 'Reversal-rate outlier', category: 'employee', layer: 'baseline', severity: 'LOW', evaluationMode: 'near_realtime', humanReview: true,
    description: 'A staff member\'s reversal rate is a peer-relative outlier (fairness-gated, advisory only).', defaultThresholds: { minSampleSize: 20, minPeers: 3, zThreshold: 2.5, minRatePct: 5 } },
  { id: 'MP_MEMBERSHIP_DUP_CHARGE', alertType: 'duplicate_membership_charge', name: 'Duplicate membership charge', category: 'reconciliation', layer: 'reconciliation', severity: 'HIGH', evaluationMode: 'batch', humanReview: true,
    description: 'The same idempotency key or processor reference is attached to multiple captured membership charges.', defaultThresholds: {} },
  { id: 'MP_GIFTCARD_NEGATIVE_BALANCE', alertType: 'giftcard_negative_balance', name: 'Negative gift-card balance', category: 'reconciliation', layer: 'reconciliation', severity: 'HIGH', evaluationMode: 'batch', humanReview: true,
    description: 'A gift card has a negative balance.', defaultThresholds: {} },
  { id: 'MP_GIFTCARD_REDEEM_EXCEEDS', alertType: 'giftcard_redemption_exceeds_balance', name: 'Gift-card overdraw', category: 'reconciliation', layer: 'reconciliation', severity: 'HIGH', evaluationMode: 'batch', humanReview: true,
    description: 'A gift-card redemption left the balance negative.', defaultThresholds: {} },
  { id: 'MP_CASH_DRAWER_VARIANCE', alertType: 'cash_drawer_variance', name: 'Cash-drawer variance', category: 'reconciliation', layer: 'reconciliation', severity: 'MEDIUM', evaluationMode: 'batch', humanReview: true,
    description: 'A reconciled cash drawer was short or over beyond tolerance at close.', defaultThresholds: { toleranceCents: 200, highSeverityMultiple: 5 } },
];

const LAYER_FLAG: Record<DetectionLayer, keyof MoneyProtectionFlags> = {
  deterministic: 'deterministicRules', baseline: 'baselines', reconciliation: 'reconciliation',
};

export interface RuleView extends RuleDescriptor { enabled: boolean; }

// Overlay current flag state so the UI shows which rules are active for this deployment.
export function getRuleCatalog(env: NodeJS.ProcessEnv = process.env): { rules: RuleView[]; flags: MoneyProtectionFlags } {
  const flags = moneyProtectionFlags(env);
  const rules = RULE_CATALOG.map((r) => ({ ...r, enabled: flags.enabled && flags[LAYER_FLAG[r.layer]] === true }));
  return { rules, flags };
}
