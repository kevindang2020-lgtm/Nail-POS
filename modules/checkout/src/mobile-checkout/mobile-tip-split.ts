// mobile-tip-split.ts — pure tip-preset computation (spec §12) and split-plan validation (spec §13). REUSES the
// canonical tipForPercent / validateCustomTip so the mobile presets match the POS exactly, and mirrors the canonical
// split rules (each segment a positive whole number of cents; segments sum to the balance; no overpay). Authoritative
// application still goes through CheckoutService.paySplit — this is the pre-flight validation the app runs before it
// asks the backend to proceed.

import type { TipPreset, SplitSegmentPlan } from '@aipowersalon/api-contracts/tenant';
export type { TipPreset, SplitSegmentPlan };   // owned by packages/api-contracts (Constitution 13 §13)
import { tipForPercent, validateCustomTip } from '../checkout/checkout-display.dto';


export interface TipResult { ok: boolean; tipCents: number; reason?: string }

const PRESET_PERCENT: Record<'p15' | 'p20' | 'p25', number> = { p15: 15, p20: 20, p25: 25 };

/** Compute the tip for a preset against the service subtotal. maxPercent caps custom tips (default 100%). */
export function computeTip(subtotalCents: number, preset: TipPreset, maxPercent = 100): TipResult {
  if (preset === 'none') return { ok: true, tipCents: 0 };
  if (preset === 'p15' || preset === 'p20' || preset === 'p25') {
    return { ok: true, tipCents: tipForPercent(subtotalCents, PRESET_PERCENT[preset]) };
  }
  const cents = preset.customCents;
  if (!Number.isInteger(cents) || cents < 0) return { ok: false, tipCents: 0, reason: 'Tip must be a non-negative whole number of cents.' };
  const v = validateCustomTip(cents, subtotalCents, maxPercent);
  return v.ok ? { ok: true, tipCents: cents } : { ok: false, tipCents: cents, reason: v.reason };
}

export interface SplitValidation { ok: boolean; totalCents: number; remainingCents: number; errors: string[] }

/**
 * Validate a split plan against the remaining balance. Mirrors CheckoutService.paySplit:
 *  - at least one segment
 *  - each segment a positive whole number of cents (blocks a negative segment masking an overcharge)
 *  - the segments must sum EXACTLY to the balance (no overpay unless the canonical flow allows it, which it does not here)
 */
export function validateSplitPlan(segments: SplitSegmentPlan[], balanceCents: number): SplitValidation {
  const errors: string[] = [];
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false, totalCents: 0, remainingCents: balanceCents, errors: ['A split requires at least one payment segment.'] };
  }
  let total = 0;
  for (const seg of segments) {
    if (!seg || !Number.isInteger(seg.amountCents) || seg.amountCents <= 0) {
      errors.push('Each split segment must be a positive whole number of cents.');
    } else {
      total += seg.amountCents;
    }
    if (!seg?.method) errors.push('Each split segment must specify a payment method.');
  }
  if (errors.length === 0 && total !== balanceCents) {
    errors.push(total > balanceCents
      ? `Split total ${total} exceeds the balance ${balanceCents}.`
      : `Split total ${total} is less than the balance ${balanceCents}.`);
  }
  return { ok: errors.length === 0, totalCents: total, remainingCents: balanceCents - total, errors };
}
