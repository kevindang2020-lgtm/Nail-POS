// loyalty-reward-code.ts — Functional Decision 15, loyalty step: what a customer's reward code takes off a ticket, and
// why a code cannot be used. Pure; the checkout service applies the amount as a 'loyalty' discount — the LAST step of
// the one stacking engine (bundle → membership → deal → coupon → manual → loyalty) — and the repository reserves the
// code to the ticket atomically.
//
// Before Oct 2 2026 a code (issued when a customer spent points) was never accepted anywhere, and rewards had no value.
export interface RewardCodeRow {
  redemptionId: string; code: string; customerId: string; rewardTitle: string; status: 'issued' | 'applied' | 'used' | 'void';
  rewardType: 'amount_off' | 'percent_off'; valueCents: number; percent: number; expiresAt: string | null; ticketId: string | null;
}

/** The discount for one code on what is left of the ticket after the earlier discount steps. Never more than that. */
export function rewardCodeDiscountCents(code: Pick<RewardCodeRow, 'rewardType' | 'valueCents' | 'percent'>, remainingCents: number): number {
  const base = Math.max(0, Math.round(remainingCents));
  if (code.rewardType === 'percent_off') return Math.min(base, Math.round((base * Math.min(100, Math.max(0, code.percent))) / 100));
  return Math.min(base, Math.max(0, Math.round(code.valueCents)));
}

/** Why this code cannot go on this ticket, or null when it can (or is already on THIS ticket). */
export function rewardCodeProblem(code: RewardCodeRow | null, ticket: { ticketId: string; customerId: string | null }, nowMs: number): string | null {
  if (!code) return 'That reward code was not found.';
  if (!ticket.customerId || code.customerId !== ticket.customerId) return 'That reward code belongs to a different customer.';
  if (code.status === 'used') return 'That reward code has already been used.';
  if (code.status === 'void') return 'That reward code was cancelled.';
  if (code.status === 'applied' && code.ticketId !== ticket.ticketId) return 'That reward code is already on another open ticket.';
  if (code.expiresAt && Date.parse(code.expiresAt) <= nowMs) return 'That reward code has expired.';
  if (!(code.rewardType === 'percent_off' ? code.percent > 0 : code.valueCents > 0)) return 'That reward has no value set — ask the owner to set one.';
  return null;
}

/** Codes are shown to customers as typed; staff may type them in any case, with spaces. */
export const normalizeRewardCode = (raw: unknown) => String(raw ?? '').replace(/\s+/g, '').toUpperCase();
