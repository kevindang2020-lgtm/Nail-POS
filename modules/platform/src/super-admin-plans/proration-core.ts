import type { Strategy, ChangeType } from '@aipowersalon/api-contracts/platform';
export type { Strategy, ChangeType };   // owned by packages/api-contracts (Constitution 13 §13)
// proration-core.ts — pure, decimal-safe plan-change math. Money is integer cents in and out (rounded once to the
// nearest cent), so no fractional cents are ever stored. Proration is time-based on the current billing period:
// the unused remainder of the old plan is credited and the same remainder of the new plan is charged.


export function classifyChange(oldCents: number | null, newCents: number): ChangeType {
  if (oldCents === null || oldCents === undefined) return 'initial';
  if (newCents > oldCents) return 'upgrade';
  if (newCents < oldCents) return 'downgrade';
  return 'crossgrade';
}

export type ProrationInput = {
  periodStartMs: number;
  periodEndMs: number;
  changeAtMs: number;
  oldMonthlyCents: number; // 0 when the prior plan has no known/locked price
  newMonthlyCents: number;
};

export type Proration = {
  remainingFraction: number;  // 0..1 of the period left at change time
  creditCents: number;        // unused remainder of the old plan
  chargeCents: number;        // prorated new plan for the remainder
  netCents: number;           // chargeCents - creditCents (negative = net credit back)
};

// immediate proration. For end_of_cycle, callers should pass changeAt = periodEnd (=> zero proration).
export function computeProration(i: ProrationInput): Proration {
  const total = i.periodEndMs - i.periodStartMs;
  if (total <= 0) return { remainingFraction: 0, creditCents: 0, chargeCents: 0, netCents: 0 };
  const remaining = Math.min(total, Math.max(0, i.periodEndMs - i.changeAtMs));
  const oldM = Math.max(0, Math.trunc(i.oldMonthlyCents));
  const newM = Math.max(0, Math.trunc(i.newMonthlyCents));
  const creditCents = Math.round((oldM * remaining) / total); // single rounding => exact cents
  const chargeCents = Math.round((newM * remaining) / total);
  return { remainingFraction: remaining / total, creditCents, chargeCents, netCents: chargeCents - creditCents };
}
