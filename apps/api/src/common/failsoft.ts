// failsoft.ts — two names for the two opposite jobs `.catch(() => 0)` was doing.
//
// ══ WHY THIS FILE EXISTS ══════════════════════════════════════════════════════════════════════════════════
//
// Every bug found in this codebase on 2026-07-13 was written the same way:
//
//     const n = await someCount().catch(() => 0);
//
// That line is CORRECT about half the time and CATASTROPHIC the other half, and nothing in it says which:
//
//   • The POS "Service Done" badge counted a status that can never occur → 0 forever. Harmless-ish. A badge.
//   • Branch-transfer impact counted a DROPPED table → "0 appointments will be affected" → shown to a Super
//     Admin immediately before an irreversible move that could touch thousands.
//   • Menu Insights product cost hit a column on the wrong table → cost 0 → every service reported a 100% margin.
//   • The AI usage counter failed → used 0 → `used + 1 > limit` is false for every tenant, on every package,
//     always → **every usage cap silently disappeared** and tenants consumed AI for free.
//
// The difference is never the catch. It is WHAT THE VALUE FEEDS. And since a single construct served both, the
// dangerous one could be — and repeatedly was — written by accident, by someone reaching for the safe-looking
// idiom they had seen everywhere else.
//
// So: two constructs. One says "a missing count must not break this page." The other says "I could not find out,
// and you must decide what that means." You can still write the wrong one — but you can no longer write it
// without saying so.
//
// ══ THE RULE ══════════════════════════════════════════════════════════════════════════════════════════════
//
//     Does a human make a decision from this number?
//
//        NO  → orZero()      a badge, a chip, a nice-to-have count. 0 is a fine answer.
//        YES → orUnknown()   money, impact previews, limits, quotas, anything on an invoice or a confirmation.
//                            Returns null. 0 is NOT an acceptable answer, because 0 is a CONFIDENT answer and
//                            it is indistinguishable from the truth.

/**
 * For a value nobody decides anything from.
 *
 * A sidebar badge that cannot load must not take the page down with it, and "0 waiting" is a perfectly good thing
 * to render when we could not count. Use this freely — and only — for that.
 *
 * If you find yourself reaching for this on a figure that appears in money, an impact preview, a limit, or a
 * confirmation dialog: you want `orUnknown`.
 */
export async function orZero(p: Promise<number | null | undefined>): Promise<number> {
  try {
    const v = await p;
    return Number(v ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** The list-shaped sibling. Same rule: only where an empty list is an acceptable thing to render. */
export async function orEmpty<T>(p: Promise<T[] | null | undefined>): Promise<T[]> {
  try {
    return (await p) ?? [];
  } catch {
    return [];
  }
}

/**
 * For a value somebody DOES decide something from.
 *
 * Returns `null` on failure — never 0, never [], never a plausible-looking default.
 *
 * `null` is the point. It cannot be summed, compared, or rendered as a quantity without the caller noticing:
 * arithmetic on it produces `NaN`, a `>` comparison against it is `false`, and TypeScript will not let it into a
 * `number` without a decision. Whereas `0` slides silently into every one of those places and comes out the other
 * side looking like a fact.
 *
 * The caller must then answer the question the failure actually poses — which is a PRODUCT question, not a
 * plumbing one:
 *
 *     "0 appointments affected"        → do we let the Super Admin proceed, or refuse until we can count?
 *     "used 0 of 500"                  → do we serve the call, or hold it until we know?
 *     "cost 0, margin 100%"            → do we show a dash, or a stale figure, or nothing at all?
 *
 * There is no universally right answer. There is only a right answer per site — which is exactly why this
 * returns `null` and makes you write it down.
 */
export async function orUnknown<T>(p: Promise<T | null | undefined>): Promise<T | null> {
  try {
    const v = await p;
    return v ?? null;
  } catch {
    return null;
  }
}

/**
 * When a caller genuinely must produce a number from an unknown, and has DECIDED what the unknown means.
 *
 * The point is not the arithmetic — it is that the decision is now a visible argument at the call site, rather
 * than an invisible `0` inherited from a `.catch`. Someone reading the line can see what was chosen.
 *
 *     const impacted = coalesceUnknown(await orUnknown(countAppointments()), { onUnknown: 'refuse' });
 */
export function coalesceUnknown(
  value: number | null,
  opts: { onUnknown: 'zero' } | { onUnknown: 'refuse'; message?: string },
): number {
  if (value != null) return value;
  if (opts.onUnknown === 'zero') return 0;
  throw new UnknownValueError(
    (opts as any).message ?? 'We could not read this figure, and it is not safe to assume it is zero.',
  );
}

/** Thrown when a decision needs a number we could not read, and guessing would be worse than failing. */
export class UnknownValueError extends Error {
  readonly code = 'VALUE_UNKNOWN';
  constructor(message: string) {
    super(message);
    this.name = 'UnknownValueError';
  }
}
