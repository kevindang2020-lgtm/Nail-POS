// date-range.ts — shared server-side date-range caps (Scaling Roadmap Phase 1.10 / §10 "Query range caps").
//
// The goal mirrors pagination.ts: NO interactive endpoint should be coercible into scanning years of data for a large
// salon. Historically the codebase clamped a `days` param in a few places (Math.min(90, ...)) but the reports surface
// accepted raw `from`/`to` with no ceiling, so `?from=2018-01-01&to=2026-07-03` would scan years of rows during an
// interactive request. This gives every module one consistent cap instead of scattered copy-pasted clamps, and a
// clear error the client can act on (per the doc: "Use an export job for a larger range").

/** Per-context maximum interactive range, in days. Larger ranges must go through an async export/report job. */
export const MAX_RANGE_DAYS = {
  appointments: 31,   // interactive appointment/day-grid views
  transactions: 90,   // transaction/payment search
  reports: 90,        // interactive report ranges
  audit: 90,          // audit-log searches
  // BUILD_PLAN Phase 12 (Constitution 5 §52, DoD #23): the contexts the list-query standard (list-query.ts / parseListQuery)
  // declares per endpoint. Interactive reads stay bounded; anything larger goes through the async export (§33).
  operational: 31,    // day-to-day operational lists (queue history, check-ins, notifications)
  history: 180,       // per-record histories and ledgers (customer visits, loyalty / gift-card ledgers, message logs)
  analytics: 366,     // dashboards and trend charts whose period presets include "this year" / "last 12 months"
} as const;

export type RangeContext = keyof typeof MAX_RANGE_DAYS;

const MS_PER_DAY = 86_400_000;

function parseDay(v: unknown): number | null {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

export class DateRangeError extends Error {
  constructor(msg: string) { super(msg); this.name = 'DateRangeError'; }
}

/** Whole-day difference between two epoch-ms values (inclusive-friendly, always >= 0). */
export function diffInDays(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / MS_PER_DAY));
}

/**
 * Validate an interactive from/to range against the cap for `context`. Returns the parsed bounds (or nulls when a side
 * is absent — an open-ended request is allowed through only when BOTH sides are absent; a one-sided range is treated as
 * unbounded and rejected so it can't scan from epoch/to-now). Throws DateRangeError when the span exceeds the cap or the
 * order is inverted. Missing/invalid dates are treated as "no range" per side; callers that require a range should pass
 * `requireBoth`.
 */
export function validateDateRange(
  from: unknown,
  to: unknown,
  context: RangeContext,
  opts: { requireBoth?: boolean } = {},
): { fromMs: number | null; toMs: number | null } {
  const fromMs = parseDay(from);
  const toMs = parseDay(to);
  const maxDays = MAX_RANGE_DAYS[context];

  if (fromMs == null && toMs == null) {
    if (opts.requireBoth) throw new DateRangeError('A date range is required.');
    return { fromMs: null, toMs: null };
  }
  // A one-sided range is effectively unbounded (epoch→to, or from→now), which is exactly what the cap exists to prevent.
  if (fromMs == null || toMs == null) {
    throw new DateRangeError(`Both a start and end date are required (max ${maxDays} days).`);
  }
  if (toMs < fromMs) throw new DateRangeError('The end date must not be before the start date.');
  if (diffInDays(fromMs, toMs) > maxDays) {
    throw new DateRangeError(`The maximum interactive range is ${maxDays} days. Use an export job for a larger range.`);
  }
  return { fromMs, toMs };
}

/**
 * BUILD_PLAN Phase 12 (DoD #23): the span of a resolved range in whole days, measured exactly as validateDateRange measures
 * it (diffInDays), so a list endpoint's maxDays and the older per-endpoint caps agree on where the line is. Date-only
 * bounds are counted in calendar days (a DST day is still one day).
 */
export function rangeSpanDays(fromMs: number, toMs: number, dateOnly = false): number {
  if (dateOnly) return Math.max(0, Math.round((toMs - fromMs) / MS_PER_DAY));
  return diffInDays(fromMs, toMs);
}

/** Resolve a cap: a number of days, or one of the named contexts above. */
export function maxRangeDays(cap: number | RangeContext): number {
  return typeof cap === 'number' ? cap : MAX_RANGE_DAYS[cap];
}
