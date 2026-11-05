// idempotency-sweep.ts — Constitution 5 §61–66: removes expired Idempotency-Key rows (24 h).
// CROSS-TENANT BY DESIGN: expiry housekeeping over every salon's rows; it only deletes rows already past expires_at,
// reads nothing back, and returns a count. The per-request queries (idempotency.ts) are tenant-filtered.
import { sql } from 'kysely';
export async function sweepExpiredIdempotency(db: any, now = new Date(), limit = 1000): Promise<number> {
  const r = await sql`delete from api_idempotency where ctid in (select ctid from api_idempotency where expires_at <= ${now} limit ${limit})`.execute(db);
  return Number((r as any).numAffectedRows ?? 0);
}
