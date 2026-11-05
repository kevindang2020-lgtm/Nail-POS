// @aipowersalon/money — the platform's money type and money arithmetic (Constitution 13 §86, §259 shared kernel).
//
// Money is INTEGER CENTS. No floats leave this module: parsing is digit-exact, formatting rounds once, allocation hands
// out leftover cents deterministically. Consolidated from nine `Money = number` declarations, six identical
// `centsToUsd`, and the compensation engine's allocation — each formatter below is a DISTINCT display rule that existed
// with its own name, kept distinct (§378 merges implementations, never meanings).

/** Integer cents. `Cents` is the same type under the name the compensation engine used. */
export type Money = number;
export type Cents = number;

/** "$1,234.56" — always two decimals, en-US grouping. (The five identical API formatters.) A negative amount reads
 *  sign-first, "−$6.75" (U+2212) — never "$-6.75" (wave 4 pilot: the Tech App's adjustments line). */
export function centsToUsd(cents: Money): string {
  const neg = cents < 0 && Math.round(Math.abs(cents)) > 0;
  return (neg ? '\u2212$' : '$') + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "$1,234" for whole dollars, "$1,234.50" otherwise — the Super Admin tenant screens' compact rule. Rounds first. */
export function centsToUsdCompact(cents: Money): string {
  const dollars = Math.round(cents) / 100;
  return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: dollars % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

/** centsToUsd, or an em dash when the value is unknown (the communications overview's rule). */
export function formatCentsOrDash(cents: Money | null | undefined): string {
  return cents == null ? '—' : centsToUsd(cents);
}

/** "$1234.56" — no grouping, never negative: the POS keypad/display rule (formerly packages/ui formatCentsUsd). */
export function formatCentsPlain(cents: Money): string {
  const n = Math.max(0, Math.trunc(cents));
  return `$${Math.trunc(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

/**
 * Exact dollars-text → cents, or null when the text is not a money amount. Digit-only integer parsing: "12.3" → 1230,
 * "$0.5" → 50, "" / "." / "1.234" / "abc" → null. Never parseFloat (the check:money gate forbids it everywhere).
 */
export function parseDollarsToCents(input: string | null | undefined): Money | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/^\$/, '').trim();
  if (!/^\d*\.?\d{0,2}$/.test(s)) return null;
  const [intPart = '', decPart = ''] = s.split('.');
  if (intPart === '' && decPart === '') return null;
  const dollars = intPart === '' ? 0 : parseInt(intPart, 10);
  const cents = decPart === '' ? 0 : parseInt(decPart.padEnd(2, '0'), 10);
  if (!Number.isFinite(dollars) || !Number.isFinite(cents)) return null;
  return dollars * 100 + cents;
}

/**
 * Split `total` cents across `weights` so the parts sum EXACTLY to the total: floor each share, then hand the leftover
 * cents to the largest fractional parts (ties → lowest index). No weights → everything on the first part.
 * (The compensation engine's allocation, unchanged.)
 */
export function allocateByLargestRemainder(total: Cents, weights: number[]): Cents[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) { const out = new Array<number>(n).fill(0); out[0] = total; return out; }
  const exact = weights.map((w) => (total * w) / sumW);
  const floor = exact.map((x) => Math.floor(x));
  let remainder = total - floor.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  const out = floor.slice();
  for (let k = 0; k < order.length && remainder > 0; k++) { out[order[k].i] += 1; remainder--; }
  return out;
}

/**
 * ONE-PAY (Oct 13 2026): THE percent arithmetic. `round(base × percent / 100)` in integer cents — the only place in the
 * codebase a commission rate, a revenue-share percent or a supply percent is applied to an amount. Callers outside the
 * compensation authority (modules/workforce/src/compensation) are refused by check:one-payroll-calculation unless
 * reviewed in its allowlist.
 */
export function percentOfCents(baseCents: Cents, percent: number): Cents {
  return Math.round((baseCents * percent) / 100);
}

/**
 * THE tax arithmetic (Mandate §33). `round(taxableCents × taxRatePercent / 100)` in integer cents.
 * Always clamped to >= 0. One canonical tax function across tickets, checkout, and reporting.
 */
export function taxCents(taxableCents: Cents, taxRatePercent: number): Cents {
  if (taxableCents <= 0 || taxRatePercent <= 0) return 0;
  return percentOfCents(taxableCents, taxRatePercent);
}

/** A `percent` share of `baseCents` and the remainder, reconciling exactly (share + remainder === base). The share is
 *  clamped to [0, base]; a negative base is 0. The one split (technician / salon, technician / owner). */
export function splitByPercent(baseCents: Cents, percent: number): { shareCents: Cents; remainderCents: Cents } {
  const base = Math.max(0, Math.round(baseCents));
  const shareCents = Math.min(base, Math.max(0, percentOfCents(base, Number(percent) || 0)));
  return { shareCents, remainderCents: base - shareCents };
}

// ── BUILD_PLAN Phase 13 (Constitution 6 §100): the mobile apps' display rules, moved here from ~40 local `money()`
// one-liners. Each is a DISTINCT existing rule kept byte-for-byte (the app tests assert today's text). Currency stays
// the branch's (USD for every salon today); a future currency is a parameter, never a float.

/** "$1,235" — whole dollars, rounded, en-US grouping (customer appointment / home cards). null / undefined / NaN → "$0". */
export function centsToUsdWhole(cents: Money | null | undefined): string {
  return '$' + Math.round((Number(cents) || 0) / 100).toLocaleString('en-US');
}
/** "$1234.50" — two decimals, NO grouping (the toFixed(2) rule; negative stays "$-5.00"). */
export function centsToUsdFixed(cents: Money): string {
  return '$' + (cents / 100).toFixed(2);
}
/** "$1,234.5" — en-US grouping, up to three decimals, no padding (the AI package price rule). */
export function centsToUsdLoose(cents: Money): string {
  return '$' + (cents / 100).toLocaleString('en-US');
}
/**
 * Intl currency style: "$1,234.56" / "-$1,234.56" (sign BEFORE the symbol, unlike centsToUsd); `fractionDigits: 0` gives
 * "$1,235". null / undefined / NaN → 0. The owner app's reporting rule.
 */
export function formatCurrency(cents: Money | null | undefined, o: { fractionDigits?: 0 | 2; currency?: string; locale?: string } = {}): string {
  const opts: Intl.NumberFormatOptions = { style: 'currency', currency: o.currency ?? 'USD' };
  if (o.fractionDigits === 0) opts.maximumFractionDigits = 0;
  else if (o.fractionDigits === 2) { opts.minimumFractionDigits = 2; opts.maximumFractionDigits = 2; }
  return new Intl.NumberFormat(o.locale ?? 'en-US', opts).format((Number(cents) || 0) / 100);
}
