// ticket-number.ts — allocates human-friendly per-branch daily ticket numbers (e.g. '014'). The sequence resets each day
// per location, computed against the tenant's configured timezone (from tenant_settings 'business-branch', default
// America/New_York) so "today" matches the salon's local day rather than UTC. Allocation is an atomic upsert on a
// per-(tenant, branch, business_date) counter, so concurrent ticket creation can't collide or skip.
import { businessDate } from '@aipowersalon/date-time';
/** The salon's day for ticket numbering — the package's businessDate under this file's historical name. */
export const todayInTimeZone = (tz: string, now: Date = new Date()): string => businessDate(tz, now);   // owned by @aipowersalon/date-time (Constitution 13 §87)
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export async function tenantTimeZone(db: Kysely<DB>, tenantId: string, branchId: string | null): Promise<string> {
  const rows = await db.selectFrom('tenant_settings').select(['branch_id', 'settings_json'])
    .where('tenant_id', '=', tenantId).where('category', '=', 'business-branch')
    .where((eb: any) => eb.or([eb('branch_id', 'is', null), ...(branchId ? [eb('branch_id', '=', branchId)] : [])]))
    .execute().catch(() => [] as any[]);
  const pick = (branchId ? rows.find((r: any) => r.branch_id === branchId) : undefined) ?? rows.find((r: any) => r.branch_id === null);
  const tz = (pick?.settings_json as any)?.timezone;
  return typeof tz === 'string' && tz ? tz : 'America/New_York';
}

// 'YYYY-MM-DD' for the given timezone (en-CA formats as ISO date).

export function formatTicketNumber(seq: number): string { return String(seq).padStart(3, '0'); }

// atomically allocate + return the next per-branch daily ticket number (formatted, e.g. '014').
export async function nextTicketNumber(db: Kysely<DB>, tenantId: string, branchId: string): Promise<string> {
  const tz = await tenantTimeZone(db, tenantId, branchId);
  const businessDate = todayInTimeZone(tz);
  const row = await db.insertInto('ticket_number_counters')
    .values({ tenant_id: tenantId, branch_id: branchId, business_date: businessDate, last_seq: 1 } as any)
    .onConflict((oc: any) => oc.columns(['tenant_id', 'branch_id', 'business_date'])
      .doUpdateSet({ last_seq: sql`ticket_number_counters.last_seq + 1`, updated_at: sql`now()` }))
    .returning('last_seq')
    .executeTakeFirst().catch(() => undefined);
  return formatTicketNumber(Number((row as any)?.last_seq ?? 1));
}
