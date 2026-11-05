// ai-scheduling-core.ts — PURE time-interval arithmetic, the foundation the whole optimizer stands on. No I/O, no dates
// as strings — all times are integer MINUTES in a single consistent frame the caller chooses (minutes-from-midnight for a
// day view, or absolute epoch-minutes for cross-day). Deterministic and unit-testable. Touching endpoints (a.end == b.start)
// do NOT overlap — that's the whole point of back-to-back scheduling. Nothing here mutates its inputs.

export interface Range { start: number; end: number; }

export const isValidRange = (r: Range): boolean => Number.isFinite(r.start) && Number.isFinite(r.end) && r.start < r.end;
export const durationOf = (r: Range): number => Math.max(0, r.end - r.start);

/** Strict overlap — shared endpoints do NOT count (back-to-back is allowed). */
export const overlaps = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end;
/** a fully contains b (inclusive endpoints). */
export const contains = (a: Range, b: Range): boolean => a.start <= b.start && b.end <= a.end;
/** a.end == b.start or b.end == a.start. */
export const adjacent = (a: Range, b: Range): boolean => a.end === b.start || b.end === a.start;

/** The overlapping sub-range, or null if they don't overlap. */
export function intersect(a: Range, b: Range): Range | null {
  const start = Math.max(a.start, b.start), end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}

/** Sort + union overlapping OR adjacent ranges into a minimal disjoint set. */
export function mergeRanges(ranges: Range[]): Range[] {
  const valid = ranges.filter(isValidRange).sort((x, y) => x.start - y.start);
  const out: Range[] = [];
  for (const r of valid) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);   // overlap or touch → extend
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

/** base minus blocks → the free sub-ranges of base not covered by any block. */
export function subtractRanges(base: Range, blocks: Range[]): Range[] {
  if (!isValidRange(base)) return [];
  const merged = mergeRanges(blocks.map((b) => intersect(base, b)).filter((x): x is Range => !!x));
  const free: Range[] = [];
  let cursor = base.start;
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < base.end) free.push({ start: cursor, end: base.end });
  return free;
}

/** Clip every range to a window, dropping non-overlapping ones. */
export function clipAll(ranges: Range[], window: Range): Range[] {
  return ranges.map((r) => intersect(r, window)).filter((x): x is Range => !!x);
}

/** Expand a range by setup(before)/cleanup(after) buffers — the true OCCUPIED footprint of a service. */
export function applyBuffer(r: Range, buffer: { before?: number; after?: number }): Range {
  return { start: r.start - (buffer.before || 0), end: r.end + (buffer.after || 0) };
}

/** Does a service of `durationMin` (plus setup/cleanup) fit inside a gap? */
export function fits(gap: Range, durationMin: number, buffer: { setup?: number; cleanup?: number } = {}): boolean {
  return durationOf(gap) >= durationMin + (buffer.setup || 0) + (buffer.cleanup || 0);
}

/** Free windows inside business hours after removing blocks (breaks/appointments/time-off). */
export function freeWindows(businessHours: Range, blocks: Range[]): Range[] {
  return subtractRanges(businessHours, blocks);
}

/** Total covered minutes of a set of ranges (merged, so overlaps aren't double-counted). */
export function totalCovered(ranges: Range[]): number {
  return mergeRanges(ranges).reduce((n, r) => n + durationOf(r), 0);
}

/** Chain a sequence of service durations back-to-back from a start, inserting transition buffers between them.
 *  Returns each service's occupied range + the overall span (for multi-service appointment placement). */
export function chainServices(start: number, services: { duration: number; setup?: number; cleanup?: number }[], transitionBuffer = 0): { blocks: Range[]; span: Range } {
  const blocks: Range[] = [];
  let cursor = start;
  services.forEach((s, i) => {
    if (i > 0) cursor += transitionBuffer;
    const from = cursor + (s.setup || 0);
    const to = from + s.duration;
    blocks.push({ start: from, end: to });
    cursor = to + (s.cleanup || 0);
  });
  return { blocks, span: { start, end: cursor } };
}
