// pagination.ts — shared server-side pagination clamps (Scaling Roadmap Phase 1.4).
//
// The goal is that NO endpoint can be coerced into returning an unbounded set for a large salon. Historically the
// codebase clamped `pageSize` with `Math.max(1, Number(f.pageSize) || N)` — which enforces a *floor* of 1 but no
// *ceiling*, so a client sending `pageSize=1000000` would pull a million rows. These helpers add the ceiling and
// give every layer one consistent implementation instead of 8+ copy-pasted `clampInt`s.

/** Absolute upper bound on any single page. A caller may request less, never more. */
export const MAX_PAGE_SIZE = 100;

/** Clamp an integer into [min, max], falling back to `def` for non-finite input. */
export function clampInt(value: unknown, def: number, min: number, max: number): number {
  const x = Math.trunc(Number(value));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
}

/** Clamp a requested page number to a sane range (>= 1). */
export function clampPage(value: unknown, def = 1): number {
  return clampInt(value, def, 1, 100_000);
}

/**
 * Clamp a requested page size into [1, max]. `def` is used when the value is missing/invalid; `max` defaults to the
 * global MAX_PAGE_SIZE ceiling but a caller may pass a smaller cap for a heavier endpoint.
 */
export function clampPageSize(value: unknown, def = 20, max: number = MAX_PAGE_SIZE): number {
  return clampInt(value, def, 1, Math.min(max, MAX_PAGE_SIZE));
}

/** Clamp a bare list `limit` (non-paginated "top N" style reads) into [1, max]. */
export function clampLimit(value: unknown, def: number, max: number = MAX_PAGE_SIZE): number {
  return clampInt(value, def, 1, Math.min(max, MAX_PAGE_SIZE));
}
