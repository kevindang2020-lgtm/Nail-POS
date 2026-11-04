// gift-cards.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface StockItem { id: string; last4: string; status: string; batchLabel: string | null; notes: string | null; createdAt: string; activatedAt: string | null }

export interface StockCounts { available: number; activated: number; void: number; total: number }

// Functional Decision 31 — branch liability & inter-branch clearing report (moved here Oct 3 2026; the server and the POS
// each declared their own copy, which Constitution 13's gate forbids).
export interface GiftCardBranchLiability {
  branchId: string | null;      // null = not attributed (rows whose branch is unknown)
  branchName: string;
  soldCents: number;            // new cards, activations, reloads sold here (paid value)
  redeemedCents: number;        // value spent here
  adjustedCents: number;        // manual corrections here (signed) — shown, never counted as a sale or redemption
  owesCents: number;            // this branch sold cards that other branches redeemed: it holds their payment
  owedCents: number;            // this branch redeemed cards other branches sold: it did the work, they hold the money
  netClearingCents: number;     // owed − owes: positive = is owed by other branches, negative = owes them
}
export interface GiftCardClearingTransfer { fromBranchId: string; fromBranchName: string; toBranchId: string; toBranchName: string; amountCents: number }
export interface GiftCardLiabilityReport {
  from: string; to: string;
  outstandingLiabilityCents: number;   // what the tenant owes card holders right now (all active/frozen balances)
  branches: GiftCardBranchLiability[];
  /** Who pays whom for the period, one line per pair of branches. */
  transfers: GiftCardClearingTransfer[];
  /** Redemptions whose selling branch is unknown (cannot be cleared). */
  unclearableRedeemedCents: number;
  totals: { soldCents: number; redeemedCents: number; adjustedCents: number };
}


/** POST /pos/checkout/gift-cards/:cardId/adjust (Gift Cards guide, Nov 4 2026) — the balance before / after a manager's adjustment */
export interface GiftCardAdjustResult { cardId: string; amountCents: number; beforeCents: number; afterCents: number; status: string }
