import { parseDollarsToCents, formatCentsPlain } from '@aipowersalon/money';
// The exact parser and the keypad display rule now live in the money package (Constitution 13 §86); the same names are
// kept here so every screen's import still works. keypadPress is UI behaviour and stays.
export { parseDollarsToCents };
export const formatCentsUsd = formatCentsPlain;
// money-input.ts — the ONE authoritative dollars→cents parser for every AIPowerSalon checkout surface.
// Pure STRING parsing: no parseFloat, no Number(x)*100, no floating-point money arithmetic anywhere.
// Accepts: optional leading $, digits, at most one dot, at most two decimals ("17.50", "$5", "0.07", ".5", "5.").
// Rejects (returns null): empty, negatives, letters, commas, >2 decimals, multiple dots.

/** Render integer cents as "$12.34" — display only, still no float math. */

/** One keypad press applied to the current raw string (shared by every keypad UI so behavior is identical). */
export function keypadPress(raw: string, key: string, maxDollars = 100000): string {
  if (key === '⌫') return raw.slice(0, -1);
  if (key === '.') return raw.includes('.') ? raw : raw === '' ? '0.' : raw + '.';
  const next = raw + key;
  if (!/^\d*\.?\d{0,2}$/.test(next)) return raw;
  const cents = parseDollarsToCents(next);
  if (cents == null || cents > maxDollars * 100) return raw;
  return next;
}
