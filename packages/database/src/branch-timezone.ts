// branch-timezone.ts — the ONE answer to "what time zone is this branch in?" (Oct 2 2026).
// branches.timezone (migration 106, written by the location screens) → America/New_York. Several features had assumed
// New Jersey (or UTC); a salon in Chicago or Los Angeles needs its own day and clock for the booking board, LATE status,
// the add-on schedule check and day-based reports. Cached briefly per branch so it is not a query per request.
export const DEFAULT_SALON_TIME_ZONE = 'America/New_York';
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { tz: string; at: number }>();

/** A real IANA zone the runtime understands (a typo in the location screen must not break the clock). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export async function branchTimeZone(db: any, tenantId: string, branchId: string | null | undefined, nowMs: number = Date.now()): Promise<string> {
  if (!db || !tenantId || !branchId) return DEFAULT_SALON_TIME_ZONE;
  const key = tenantId + '|' + branchId;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < TTL_MS) return hit.tz;
  let tz = DEFAULT_SALON_TIME_ZONE;
  try {
    const r: any = await db.selectFrom('branches').select('timezone').where('tenant_id', '=', tenantId).where('id', '=', branchId).executeTakeFirst();
    if (isValidTimeZone(r?.timezone)) tz = r.timezone;
  } catch { /* fall back to the default — never block a request on this */ }
  cache.set(key, { tz, at: nowMs });
  return tz;
}
/**
 * A SALON's zone, for limits and counts kept salon-wide (no branch): its first active branch's zone (the salon's main
 * location), else America/New_York. Cached like the branch lookup.
 */
export async function tenantTimeZone(db: any, tenantId: string, nowMs: number = Date.now()): Promise<string> {
  if (!db || !tenantId) return DEFAULT_SALON_TIME_ZONE;
  const key = tenantId + '|*';
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < TTL_MS) return hit.tz;
  let tz = DEFAULT_SALON_TIME_ZONE;
  try {
    const rows: any[] = await db.selectFrom('branches').select('timezone').where('tenant_id', '=', tenantId).where('deleted_at', 'is', null)
      .orderBy('created_at', 'asc').limit(5).execute();
    const first = rows.find((r) => isValidTimeZone(r?.timezone)); if (first) tz = first.timezone;
  } catch { /* the default — never block a request on this */ }
  cache.set(key, { tz, at: nowMs });
  return tz;
}
/**
 * A zone name safe to place in SQL text as a literal (`AT TIME ZONE 'America/New_York'`) — for an expression that must be
 * written identically in SELECT and GROUP BY, where a bound parameter cannot be used. Only a real IANA name of letters,
 * digits, `_ + - /` passes; anything else is the default zone, never raw text.
 */
export function safeZoneName(tz: unknown): string { return isValidTimeZone(tz) && /^[A-Za-z0-9_+\-/]+$/.test(tz) ? tz : DEFAULT_SALON_TIME_ZONE; }
/** Tests, and after a branch's location is saved. */
export function clearBranchTimeZoneCache(): void { cache.clear(); }
