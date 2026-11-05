// mobile-proceed.ts — the pure "can this checkout proceed to payment?" decision (spec §14). It gates the flow on the
// truthful readiness (so when Tap to Pay is SetupRequired it refuses), on the caller actually holding the lock, on a
// positive balance, and on valid tip/split. No money moves here; the service attaches an idempotency key when the gate
// is green so the eventual attempt is replay-safe.

import type { ProceedDecision } from '@aipowersalon/api-contracts/tenant';
export type { ProceedDecision };   // owned by packages/api-contracts (Constitution 13 §13)
import type { TipResult } from './mobile-tip-split';
import type { SplitValidation } from './mobile-tip-split';

export interface ProceedFacts {
  canTakePayment: boolean;
  readinessOverall: string;       // e.g. 'tap_to_pay_setup_required' — used as the machine-readable reason
  lockOwnedByCaller: boolean;
  balanceCents: number;
  tip?: TipResult;                // present only if a tip preset was supplied
  split?: SplitValidation;        // present only if a split plan was supplied
}


export function decideProceed(f: ProceedFacts): ProceedDecision {
  if (f.balanceCents <= 0) return { canProceed: false, reason: 'already_paid', message: 'This ticket is already paid in full.', balanceCents: f.balanceCents };
  if (!f.lockOwnedByCaller) return { canProceed: false, reason: 'lock_not_held', message: 'Re-open the ticket to continue checkout.', balanceCents: f.balanceCents };
  if (f.tip && !f.tip.ok) return { canProceed: false, reason: 'invalid_tip', message: f.tip.reason, balanceCents: f.balanceCents };
  if (f.split && !f.split.ok) return { canProceed: false, reason: 'invalid_split', message: f.split.errors[0], balanceCents: f.balanceCents };
  if (!f.canTakePayment) return { canProceed: false, reason: f.readinessOverall || 'not_ready', message: 'Payment is not ready on this device.', balanceCents: f.balanceCents };
  return { canProceed: true, balanceCents: f.balanceCents };
}
