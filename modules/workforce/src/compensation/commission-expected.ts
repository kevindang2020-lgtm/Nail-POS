// commission-expected.ts — Finish the Five (Oct 30 2026): what the ONE compensation engine would pay a line's technicians
// at a given rate, for VERIFICATION only (the F2 rate-vs-historical-configuration check). It is the engine's own formula
// (computeServiceLine: lineCommissionCents, and the technician-funded split), kept here inside the authority so the
// discrepancy scanner never re-implements money. Nothing calls this to pay, post or adjust anything.
import { percentOfCents } from '@aipowersalon/money';
import { lineCommissionCents } from './commission-basis';

export function expectedLineEarningsCents(commissionableCents: number, discountCents: number, funding: string | null, type: 'percent' | 'fixed', value: number): number {
  if (funding === 'technician_funded' && type === 'percent' && discountCents > 0) {
    const eligible = commissionableCents + discountCents;
    const salon = Math.min(commissionableCents, percentOfCents(Math.max(0, eligible), 100 - value));
    return Math.max(0, commissionableCents - salon);
  }
  return lineCommissionCents(commissionableCents, type, value);
}
