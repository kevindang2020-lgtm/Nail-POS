// gift-cards.dto.ts — tenant gift-card management (read model). Reuses the existing gift_cards +
// gift_card_transactions tables (migration 033); the transactional ops live in the checkout module.
// Money is integer cents throughout.

export interface GiftCardsContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export interface GiftCardRow {
  id: string;
  code: string;
  initialBalanceCents: number;
  balanceCents: number;
  status: string; // 'active' | 'redeemed' | 'void'
  customerId: string | null;
  createdAt: string;
}

export interface GiftCardsSummary {
  totalCards: number;
  activeCards: number;
  redeemedCards: number;
  voidCards: number;
  outstandingCents: number;   // sum of active-card balances still owed to customers (a liability)
  issuedTotalCents: number;   // sum of initial loaded value across all cards
  redeemedValueCents: number; // value already spent down (initial - current), non-negative
}

export interface GiftCardsState {
  kpis: GiftCardsSummary;
  cards: GiftCardRow[];
}

// Pure summary builder — computed from the card rows so the math is identical across data sources
// and unit-testable without a database.
export function buildGiftCardsSummary(cards: GiftCardRow[]): GiftCardsSummary {
  let activeCards = 0, redeemedCards = 0, voidCards = 0;
  let outstandingCents = 0, issuedTotalCents = 0, redeemedValueCents = 0;
  for (const c of cards) {
    const initial = Math.max(0, Math.round(c.initialBalanceCents || 0));
    const bal = Math.max(0, Math.round(c.balanceCents || 0));
    issuedTotalCents += initial;
    redeemedValueCents += Math.max(0, initial - bal);
    if (c.status === 'active') { activeCards++; outstandingCents += bal; }
    else if (c.status === 'redeemed') redeemedCards++;
    else if (c.status === 'void') voidCards++;
  }
  return { totalCards: cards.length, activeCards, redeemedCards, voidCards, outstandingCents, issuedTotalCents, redeemedValueCents };
}

// ── Functional Decision 31: gift-card value is the TENANT's liability; branches clear between themselves ──
// $100 sold at Branch A: A takes the payment and the tenant owes the card holder $100. $60 redeemed at Branch B: B
// recognizes $60 of service revenue and the liability falls by $60. A is holding $60 of payment for work B did, so A owes
// B $60. The other $40 is still owed to the card holder — liability, not something A owes another branch.
// Clearing is therefore per CARD: a redemption at branch R of a card sold at branch S (S ≠ R) moves that amount from S to
// R. A card whose selling branch is unknown cannot be cleared and is reported as not attributed.
export interface GiftCardLedgerRow {
  branchId: string | null; type: string; amountCents: number; idempotencyKey: string | null;
  /** Where the card was SOLD (its first issue/activation, else the card's own branch) — any date, not just the range. */
  soldBranchId?: string | null;
  /** For a redemption: which branches' SALES the spent value came from (first in, first out over the card's whole
   *  history — Oct 2 2026). Wins over soldBranchId; branchId null = value with no known seller (not cleared). */
  sourceSplits?: { branchId: string | null; cents: number }[];
}

/** One card's ledger in order, for the first-in-first-out split. */
export interface CardHistoryRow { id: string; type: string; idempotencyKey: string | null; amountCents: number; branchId: string | null }

/**
 * Which sales a card's redemptions spent, first in, first out (Decision 31, Oct 2 2026). Before, every redemption
 * cleared to the branch that FIRST sold the card — a $40 reload sold at another branch never counted for that branch.
 *   • issue / activate / reload → value sold at that row's branch (a lot);
 *   • redeem → spends the oldest lots first; the split is that redemption's sources;
 *   • a negative adjustment or an outgoing transfer spends lots too (nothing to clear);
 *   • value that comes back with no clear seller (refund reversal, positive adjustment, incoming transfer) is spent
 *     FIRST and reported as not cleared (branchId null) — never guessed;
 *   • spending more than the known lots (cards older than the ledger) falls back to the card's own branch.
 */
export function redemptionSources(history: CardHistoryRow[], fallbackBranchId: string | null): Map<string, { branchId: string | null; cents: number }[]> {
  const lots: { branchId: string | null; cents: number }[] = [];
  const out = new Map<string, { branchId: string | null; cents: number }[]>();
  const spend = (cents: number) => {
    const parts: { branchId: string | null; cents: number }[] = [];
    let left = cents;
    while (left > 0 && lots.length) {
      const lot = lots[0]; const take = Math.min(lot.cents, left);
      const last = parts[parts.length - 1];
      if (last && last.branchId === lot.branchId) last.cents += take; else parts.push({ branchId: lot.branchId, cents: take });
      lot.cents -= take; left -= take;
      if (lot.cents <= 0) lots.shift();
    }
    if (left > 0) { const last = parts[parts.length - 1]; if (last && last.branchId === fallbackBranchId) last.cents += left; else parts.push({ branchId: fallbackBranchId, cents: left }); }
    return parts;
  };
  for (const r of history) {
    const amt = Math.round(Number(r.amountCents) || 0), v = Math.abs(amt);
    if (!v) continue;
    const kind = classifyGiftCardLedger(r.type, r.idempotencyKey);
    if (kind === 'sold') lots.push({ branchId: r.branchId, cents: v });
    else if (kind === 'redeemed') out.set(r.id, spend(v));
    else if ((kind === 'adjusted' && amt < 0) || (r.type === 'transfer' && amt < 0)) spend(v);
    else if (kind === 'adjusted' || r.type === 'transfer' || r.type === 'refund_reversal') lots.unshift({ branchId: null, cents: v });
  }
  return out;
}
// GiftCardBranchLiability / GiftCardClearingTransfer / GiftCardLiabilityReport live in @aipowersalon/api-contracts (tenant realm) — one definition for the server and the apps.
import type { GiftCardBranchLiability, GiftCardClearingTransfer, GiftCardLiabilityReport } from '@aipowersalon/api-contracts/tenant';
export type { GiftCardBranchLiability, GiftCardClearingTransfer, GiftCardLiabilityReport };
/** What a ledger row means for the branch report. A reload is credited as an 'adjust' row keyed 'reload:<hold>'; it is
 *  a sale. Transfers (old card → new card) cancel out; holds are pending; freezes and voids move no value here. */
export function classifyGiftCardLedger(type: string, idempotencyKey: string | null): 'sold' | 'redeemed' | 'adjusted' | 'none' {
  if (type === 'issue' || type === 'activate' || type === 'reload') return 'sold';
  if (type === 'adjust' && (idempotencyKey ?? '').startsWith('reload:')) return 'sold';
  if (type === 'redeem') return 'redeemed';
  if (type === 'adjust') return 'adjusted';
  return 'none';
}
export function buildBranchLiability(rows: GiftCardLedgerRow[], branchNames: Map<string, string>): Pick<GiftCardLiabilityReport, 'branches' | 'transfers' | 'unclearableRedeemedCents' | 'totals'> {
  const nameOf = (id: string | null) => id ? (branchNames.get(id) ?? 'Branch') : 'Not attributed';
  const by = new Map<string, GiftCardBranchLiability>();
  const slot = (id: string | null) => {
    const k = id ?? '';
    let b = by.get(k);
    if (!b) { b = { branchId: id, branchName: nameOf(id), soldCents: 0, redeemedCents: 0, adjustedCents: 0, owesCents: 0, owedCents: 0, netClearingCents: 0 }; by.set(k, b); }
    return b;
  };
  const pairs = new Map<string, GiftCardClearingTransfer>();
  let unclearableRedeemedCents = 0;
  for (const r of rows) {
    const kind = classifyGiftCardLedger(r.type, r.idempotencyKey);
    if (kind === 'none') continue;
    const amt = Math.round(Number(r.amountCents) || 0);
    const b = slot(r.branchId);
    if (kind === 'sold') b.soldCents += Math.abs(amt);
    else if (kind === 'adjusted') b.adjustedCents += amt;
    else {
      const v = Math.abs(amt);
      b.redeemedCents += v;
      // Which sales this value came from: the first-in-first-out split when known, else the card's first seller.
      const parts = r.sourceSplits?.length ? r.sourceSplits : [{ branchId: r.soldBranchId ?? null, cents: v }];
      for (const part of parts) {
        const sold = part.branchId, c = Math.abs(Math.round(part.cents));
        if (!c) continue;
        if (!sold || !r.branchId) { unclearableRedeemedCents += c; continue; }
        if (sold === r.branchId) continue;                     // spent where it was sold: nothing to clear
        slot(sold).owesCents += c; b.owedCents += c;
        const key = sold + '>' + r.branchId;
        const t = pairs.get(key) ?? { fromBranchId: sold, fromBranchName: nameOf(sold), toBranchId: r.branchId, toBranchName: nameOf(r.branchId), amountCents: 0 };
        t.amountCents += c; pairs.set(key, t);
      }
    }
  }
  const branches = [...by.values()].map((b) => ({ ...b, netClearingCents: b.owedCents - b.owesCents }))
    .sort((a, b) => (a.branchId === null ? 1 : b.branchId === null ? -1 : a.branchName.localeCompare(b.branchName)));
  const totals = branches.reduce((t, b) => ({ soldCents: t.soldCents + b.soldCents, redeemedCents: t.redeemedCents + b.redeemedCents, adjustedCents: t.adjustedCents + b.adjustedCents }), { soldCents: 0, redeemedCents: 0, adjustedCents: 0 });
  const transfers = [...pairs.values()].sort((a, b) => b.amountCents - a.amountCents);
  return { branches, transfers, unclearableRedeemedCents, totals };
}
