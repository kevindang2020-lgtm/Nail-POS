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
  // raw SQL (Oct 29 2026): the same read as before, executable on any connection / transaction handle
  const rows = (await sql<{ branch_id: string | null; settings_json: unknown }>`select branch_id, settings_json from tenant_settings
     where tenant_id = ${tenantId} and category = 'business-branch' and (branch_id is null ${branchId ? sql`or branch_id = ${branchId}` : sql``})`.execute(db).catch(() => ({ rows: [] as { branch_id: string | null; settings_json: unknown }[] }))).rows;
  const pick = (branchId ? rows.find((r) => r.branch_id != null && String(r.branch_id) === branchId) : undefined) ?? rows.find((r) => r.branch_id == null);
  const tz = (pick?.settings_json as { timezone?: unknown } | undefined)?.timezone;
  return typeof tz === 'string' && tz ? tz : 'America/New_York';
}

// 'YYYY-MM-DD' for the given timezone (en-CA formats as ISO date).

export function formatTicketNumber(seq: number): string { return String(seq).padStart(3, '0'); }

// atomically allocate + return the next per-branch daily ticket number (formatted, e.g. '014').
export async function nextTicketNumber(db: Kysely<DB>, tenantId: string, branchId: string): Promise<string> {
  const tz = await tenantTimeZone(db, tenantId, branchId);
  const businessDate = todayInTimeZone(tz);
  // one atomic upsert per (tenant, branch, business date) — concurrent tickets can neither collide nor skip
  const row = (await sql<{ last_seq: number }>`insert into ticket_number_counters (tenant_id, branch_id, business_date, last_seq) values (${tenantId}, ${branchId}, ${businessDate}, 1)
     on conflict (tenant_id, branch_id, business_date) do update set last_seq = ticket_number_counters.last_seq + 1, updated_at = now()
     returning last_seq`.execute(db)).rows[0];
  return formatTicketNumber(Number(row?.last_seq ?? 1));
}
