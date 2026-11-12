// tipRefundImpact.ts — Extras (Tips & Gratuity 05): before anyone refunds, voids or disputes a ticket, explain what the
// reversal would do to this tip — the collected total, each technician's allocation and what is payable — using the SAME
// rules the compensation engine applies (workforce/compensation/compensation-adjustments.ts buildRefundReversal):
//   • a tip reverses ONLY when the tip itself is refunded (a service-only refund leaves it); a void always reverses it;
//   • a chargeback never posts on its own — it waits for review;
//   • the collected tip never changes: a reversal is a separate signed row, so net = collected + reversals;
//   • a reversal after the payroll period was paid lands in a FUTURE period and waits for approval (the paid period is
//     never rewritten).
// Pure integer cents; read only — nothing here refunds, voids or posts anything.

export type RefundScenario = 'service_only' | 'full_with_tip' | 'void' | 'chargeback';
export const REFUND_SCENARIOS: readonly RefundScenario[] = ['service_only', 'full_with_tip', 'void', 'chargeback'];

export interface RefundImpactInput {
  collectedCents: number;          // the ticket's tip as collected
  reversedCents: number;           // reversals already posted (≤ 0)
  payoutState: string;             // paid / approved / open / none
  allocations: Array<{ technicianId: string; name: string | null; netCents: number }>;
}
export interface RefundImpactRow { technicianId: string; name: string | null; nowCents: number; changeCents: number; afterCents: number }
export interface RefundImpact {
  scenario: RefundScenario;
  tipReversed: boolean;
  collectedCents: number;          // unchanged by design
  netNowCents: number; netAfterCents: number; reversalCents: number;   // reversalCents ≤ 0
  rows: RefundImpactRow[];
  posting: 'none' | 'posted_now' | 'future_period_pending' | 'pending_review';
}

export function tipRefundImpact(input: RefundImpactInput, scenario: RefundScenario): RefundImpact {
  const collected = Math.max(0, Math.round(input.collectedCents || 0));
  const netNow = collected + Math.min(0, Math.round(input.reversedCents || 0));
  const tipReversed = scenario === 'full_with_tip' || scenario === 'void' || scenario === 'chargeback';
  // each technician gives back what they still hold of this tip (never below zero; a technician holding nothing is untouched)
  const rows: RefundImpactRow[] = input.allocations.map((a) => {
    const now = Math.round(a.netCents || 0);
    const change = tipReversed && now > 0 ? -now : 0;
    return { technicianId: a.technicianId, name: a.name, nowCents: now, changeCents: change, afterCents: now + change };
  });
  const reversal = rows.reduce((s, r) => s + r.changeCents, 0);
  const posting: RefundImpact['posting'] = !tipReversed || reversal === 0 ? 'none'
    : scenario === 'chargeback' ? 'pending_review'
      : input.payoutState === 'paid' ? 'future_period_pending' : 'posted_now';
  return { scenario, tipReversed, collectedCents: collected, netNowCents: netNow, netAfterCents: netNow + reversal, reversalCents: reversal, rows, posting };
}
