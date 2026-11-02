// community-related.ts — BUILD_PLAN Phase 8 (agent C): related / possible-duplicate advisories. PURE rules; the SQL
// candidate search (same category, published within ±14 days, pg_trgm title similarity, shared tags) lives in
// community-interactions.repository.ts. A system link is a HINT for readers and moderators — never a merge (only a
// moderator merges, agent B) and never anything about a person.
export const RELATED_WINDOW_DAYS = 14;
export const RELATED_MIN_SIMILARITY = 0.6;
export const DUPLICATE_MIN_SIMILARITY = 0.8;

export type SystemRelation = 'related' | 'possible_duplicate';

/** The relation a candidate earns, or null. Title similarity ≥ 0.8 → possible_duplicate; ≥ 0.6 or any shared tag →
 *  related. Category + time window are already applied by the query. */
export function relationFor(similarity: number, sharedTags: number): SystemRelation | null {
  const s = Number.isFinite(similarity) ? similarity : 0;
  if (s >= DUPLICATE_MIN_SIMILARITY) return 'possible_duplicate';
  if (s >= RELATED_MIN_SIMILARITY || sharedTags > 0) return 'related';
  return null;
}

/** numeric(4,3) score column: clamp to [0,1] and round to 3 places. */
export function relationScore(similarity: number): number {
  const s = Number.isFinite(similarity) ? Math.max(0, Math.min(1, similarity)) : 0;
  return Math.round(s * 1000) / 1000;
}

/** Normalised tag set (lower-case, trimmed, de-duplicated) for the shared-tags comparison. */
export function normTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean))];
}
