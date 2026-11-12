// Gift Cards · 03 Checkout Redemption Readiness — a read-only staff preview of what a gift-card tender WOULD do on the
// selected ticket: eligibility, card balance, ticket due, the split-tender effect and the blockers that would stop it.
// Pure arithmetic over the protected balance check's masked answer and the server-truth ticket balance. It never
// debits, reserves or records anything — Pay (POST pay/gift-card) stays the only write, and the server re-checks all of it.

/** the masked answer of POST /pos/checkout/gift-cards/lookup (only the fields this preview reads) */
export type GiftLookupAnswer = { found: boolean; balanceCents?: number; status?: string; redeemableHere?: boolean; viaNetwork?: boolean };

export type GiftReadinessBlocker = 'not_found' | 'status' | 'no_balance' | 'not_here' | 'already_paid' | 'offline' | 'phone_claim' | 'disabled';

export type GiftReadinessView = {
  ready: boolean;
  balanceCents: number | null;   // null = card not found (never shown as $0)
  dueCents: number;
  appliedCents: number;          // what the card would cover: min(balance, due)
  remainingDueCents: number;     // still owed after the card — another tender (split) must cover it
  cardAfterCents: number | null; // card balance left after this ticket
  splitNeeded: boolean;
  blockers: GiftReadinessBlocker[];
};

/** same rule as the server's applyGiftCard: the card covers up to the due amount, never more */
export function giftReadiness(
  lookup: GiftLookupAnswer,
  dueCents: number,
  opts: { offline?: boolean; phoneClaim?: boolean; giftEnabled?: boolean } = {},
): GiftReadinessView {
  const due = Math.max(0, Math.round(dueCents || 0));
  const blockers: GiftReadinessBlocker[] = [];
  if (opts.giftEnabled === false) blockers.push('disabled');
  if (opts.offline) blockers.push('offline');
  if (opts.phoneClaim) blockers.push('phone_claim');
  if (due <= 0) blockers.push('already_paid');
  if (!lookup.found) {
    blockers.push('not_found');
    return { ready: false, balanceCents: null, dueCents: due, appliedCents: 0, remainingDueCents: due, cardAfterCents: null, splitNeeded: false, blockers };
  }
  const balance = Math.max(0, Math.round(lookup.balanceCents ?? 0));
  if (balance <= 0) blockers.push('no_balance');
  else if (lookup.status && lookup.status !== 'active') blockers.push('status');
  else if (lookup.redeemableHere === false) blockers.push('not_here');
  const usable = blockers.length === 0;
  const applied = usable ? Math.min(balance, due) : 0;
  const remaining = due - applied;
  return {
    ready: usable,
    balanceCents: balance,
    dueCents: due,
    appliedCents: applied,
    remainingDueCents: remaining,
    cardAfterCents: balance - applied,
    splitNeeded: usable && remaining > 0,
    blockers,
  };
}
