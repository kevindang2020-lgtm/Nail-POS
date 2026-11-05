// ai-cardpointe-billing.ts — bridge for the "I charge cards via Fiserv CardPointe and reconcile myself" model. There's no
// external signed webhook here: your charge/refund code calls this with the CardPointe response, and it produces a
// normalized billing event keyed by the transaction's retref (so re-submitting the same charge is idempotent). Pure +
// testable; the service applies it through the same state machine + ledger as everything else.
import type { NormalizedBillingEvent } from './ai-subscription-billing.repository';

// The fields we read from a CardPointe auth/capture/refund response (others ignored).
export interface CardPointeChargeResult { retref?: string; respstat?: string; resptext?: string; respcode?: string; amount?: string; account?: string }
export interface CardPointeChargeContext { tenantId: string; packageCode: string; kind?: 'charge' | 'refund' }
export type CardPointeMapResult = { ok: true; value: NormalizedBillingEvent } | { ok: false; reason: string };

// CardPointe respstat: 'A' approved, 'B' retry (soft decline), 'C' declined (hard).
export function cardpointeChargeToBillingEvent(charge: CardPointeChargeResult, ctx: CardPointeChargeContext): CardPointeMapResult {
  if (!ctx?.tenantId || !ctx?.packageCode) return { ok: false, reason: 'missing_context' };
  const retref = charge?.retref;
  if (!retref) return { ok: false, reason: 'missing_retref' };
  const stat = String(charge?.respstat ?? '').toUpperCase();
  const kind = ctx.kind === 'refund' ? 'refund' : 'charge';

  let eventType: string | null;
  if (kind === 'refund') eventType = stat === 'A' ? 'refunded' : null;
  else if (stat === 'A') eventType = 'payment_succeeded';
  else if (stat === 'C') eventType = 'payment_failed';
  else eventType = null; // 'B' (retry) or unknown → not actionable yet

  if (!eventType) return { ok: false, reason: stat === 'B' ? 'retry_pending' : 'no_actionable_status' };
  return {
    ok: true,
    value: {
      eventId: `cardpointe:${kind}:${retref}`,
      tenantId: ctx.tenantId, packageCode: ctx.packageCode, eventType,
      provider: 'fiserv_cardpointe', paymentSubscriptionId: null, paymentCustomerId: charge?.account ?? null,
      paymentStatus: charge?.resptext || stat, raw: charge,
    },
  };
}
