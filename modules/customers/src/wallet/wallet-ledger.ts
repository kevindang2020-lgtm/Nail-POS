// wallet-ledger.ts — pure, framework-free core for the customer store-credit ledger. Balance is always the signed sum
// of entries (never a stored field). Credits are positive, debits negative. These helpers + types are shared by the
// service, the in-memory adapter (tests), and the Kysely adapter so the rules live in exactly one place.
export type WalletEntryType = 'top_up' | 'refund' | 'adjustment' | 'payment' | 'reversal' | 'promo';
export const CREDIT_TYPES: WalletEntryType[] = ['top_up', 'refund', 'promo'];
export const DEBIT_TYPES: WalletEntryType[] = ['payment'];

export interface WalletEntry { id: string; amountCents: number; type: string; currency: string; reference: string | null; createdAt: string }
export interface WalletState { balanceCents: number; currency: string; transactions: WalletEntry[] }

export type WalletErrorCode = 'invalid_amount' | 'insufficient_funds';
export class WalletError extends Error { constructor(public code: WalletErrorCode, message: string) { super(message); this.name = 'WalletError'; } }

/** Balance = signed sum of integer-cent entries. */
export function computeBalance(entries: { amountCents: number }[]): number {
  return entries.reduce((n, e) => n + Math.trunc(e.amountCents || 0), 0);
}
/** A postable amount is a strictly-positive integer number of cents (callers pass a magnitude; the sign is applied by credit/debit). */
export function isPostableAmount(amountCents: number): boolean {
  return Number.isInteger(amountCents) && amountCents > 0;
}
/** A debit of `amountCents` is allowed iff the amount is valid and does not exceed the current balance (no negative balances). */
export function canDebit(amountCents: number, balanceCents: number): boolean {
  return isPostableAmount(amountCents) && balanceCents >= amountCents;
}
