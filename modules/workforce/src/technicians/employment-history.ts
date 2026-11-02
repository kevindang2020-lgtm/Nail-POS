// employment-history.ts — Technician Profile mandate §128 (employment history) + §64 (rehire keeps history).
//
// THE ONE WRITER of technician_employment_events (646, append-only). Every caller passes the transaction it is
// already in, so the history row commits with the change it describes or not at all — never a history of a change
// that rolled back, never a change with no history. Leave / Returned are not written here: an approved VACATION /
// SICK technician_time_off row IS the leave, and readEmploymentHistory merges it in (one store per fact).
//
// Tenant-private (§59, §61): the read is keyed by (tenant_id, technician_id) — a salon only ever sees ITS rows, and
// no public projection reads this table.
import { sql } from 'kysely';

export const EMPLOYMENT_EVENT_TYPES = [
  'hired', 'rehired', 'role_changed', 'branch_added', 'branch_removed', 'suspended', 'reactivated', 'terminated', 'transferred',
] as const;
export type EmploymentEventType = (typeof EMPLOYMENT_EVENT_TYPES)[number];

export interface EmploymentEventInput {
  tenantId: string;
  technicianId: string;
  type: EmploymentEventType;
  profileId?: string | null;
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
  reason?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
}

const uuidOrNull = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** Append one employment event inside the caller's transaction. Throws on an unknown type (programming error). */
export async function recordEmploymentEvent(trx: any, e: EmploymentEventInput): Promise<void> {
  if (!(EMPLOYMENT_EVENT_TYPES as readonly string[]).includes(e.type)) throw new Error(`unknown employment event ${e.type}`);
  await sql`
    insert into technician_employment_events
      (tenant_id, technician_id, global_tech_profile_id, branch_id, event_type, from_value, to_value, reason,
       actor_user_id, actor_role, source, metadata)
    values (${e.tenantId}, ${e.technicianId}, ${uuidOrNull(e.profileId)}, ${uuidOrNull(e.branchId)}, ${e.type},
            ${e.from ?? null}, ${e.to ?? null}, ${e.reason ? String(e.reason).slice(0, 500) : null},
            ${uuidOrNull(e.actorUserId)}, ${e.actorRole ?? null}, ${e.source ?? null}, ${JSON.stringify(e.metadata ?? {})}::jsonb)`.execute(trx);
}

/** Did this roster technician ever leave this salon? (a second 'hired' is then a 'rehired' — §64) */
export async function hasEndedBefore(trx: any, tenantId: string, technicianId: string): Promise<boolean> {
  const r: any = await sql`
    select 1 from technician_employment_events
     where tenant_id = ${tenantId} and technician_id = ${technicianId} and event_type in ('terminated','transferred')
     limit 1`.execute(trx);
  return !!r?.rows?.length;
}

/** Is there any history row yet (the 646 backfill / an earlier materialize)? */
export async function hasHireEvent(trx: any, tenantId: string, technicianId: string): Promise<boolean> {
  const r: any = await sql`
    select 1 from technician_employment_events
     where tenant_id = ${tenantId} and technician_id = ${technicianId} and event_type in ('hired','rehired') limit 1`.execute(trx);
  return !!r?.rows?.length;
}

/**
 * Branch grants changed for a LOGIN (team access screen, PUT /members/:userId/branches). If that login is a roster
 * technician here, each added / removed branch becomes a history row. A non-technician login is a no-op.
 */
export async function recordBranchDiffForUser(trx: any, i: { tenantId: string; userId: string; before: string[]; after: string[]; actorUserId?: string | null; actorRole?: string | null; reason?: string | null }): Promise<number> {
  const t: any = await sql`select id, global_tech_profile_id from technicians where tenant_id = ${i.tenantId} and user_id = ${i.userId} and archived_at is null limit 1`.execute(trx);
  const tech = t?.rows?.[0];
  if (!tech) return 0;
  const { added, removed } = branchDiff(i.before, i.after);
  for (const b of added) await recordEmploymentEvent(trx, { tenantId: i.tenantId, technicianId: String(tech.id), profileId: tech.global_tech_profile_id, branchId: b, type: 'branch_added', reason: i.reason, actorUserId: i.actorUserId, actorRole: i.actorRole, source: 'team_access' });
  for (const b of removed) await recordEmploymentEvent(trx, { tenantId: i.tenantId, technicianId: String(tech.id), profileId: tech.global_tech_profile_id, branchId: b, type: 'branch_removed', reason: i.reason, actorUserId: i.actorUserId, actorRole: i.actorRole, source: 'team_access' });
  return added.length + removed.length;
}

/** Pure set difference (pinned by the spec). */
export function branchDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before.map(String)), a = new Set(after.map(String));
  return { added: [...a].filter((x) => !b.has(x)).sort(), removed: [...b].filter((x) => !a.has(x)).sort() };
}

/** The lifecycle-change → history-type mapping (pure — pinned by employment-history.vitest.spec). */
export function lifecycleEventType(from: string | null | undefined, to: string): EmploymentEventType | null {
  if (to === 'suspended') return from === 'suspended' ? null : 'suspended';
  if (to === 'archived' || to === 'inactive') return from === 'archived' || from === 'inactive' ? null : 'terminated';
  if (to === 'active') return from && from !== 'active' ? 'reactivated' : null;
  return null;
}

// the wire shape is the API contract's (Constitution 13 §15)
export type { EmploymentHistoryRow } from '@aipowersalon/api-contracts/tenant';
import type { EmploymentHistoryRow } from '@aipowersalon/api-contracts/tenant';

const LABEL: Record<EmploymentEventType | 'leave', string> = {
  hired: 'Hired', rehired: 'Rehired', role_changed: 'Role changed', branch_added: 'Branch added', branch_removed: 'Branch removed',
  suspended: 'Suspended', reactivated: 'Returned / reactivated', terminated: 'Terminated', transferred: 'Transferred out', leave: 'Leave',
};
export const employmentEventLabel = (t: EmploymentEventType | 'leave'): string => LABEL[t] ?? t;

/** GET /pos/technicians/:id/employment-history — this salon's record only, newest first, leave merged in. */
export async function readEmploymentHistory(db: any, tenantId: string, technicianId: string): Promise<EmploymentHistoryRow[]> {
  const ev: any = await sql`
    select e.id, e.event_type, e.occurred_at, e.branch_id, b.name as branch_name, e.from_value, e.to_value, e.reason, u.full_name as actor_name
      from technician_employment_events e
      left join branches b on b.id = e.branch_id and b.tenant_id = e.tenant_id
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id
     where e.tenant_id = ${tenantId} and e.technician_id = ${technicianId}
     order by e.occurred_at desc, e.id desc limit 200`.execute(db);
  const leave: any = await sql`
    select o.id, o.kind, o.starts_at, o.ends_at, o.reason
      from technician_time_off o
     where o.tenant_id = ${tenantId} and o.technician_id = ${technicianId} and o.status = 'approved' and o.kind in ('VACATION','SICK')
     order by o.starts_at desc limit 100`.execute(db).catch(() => ({ rows: [] }));
  const iso = (v: unknown) => new Date(v as any).toISOString();
  const rows: EmploymentHistoryRow[] = [
    ...(ev?.rows ?? []).map((r: any): EmploymentHistoryRow => ({
      id: String(r.id), type: r.event_type, label: employmentEventLabel(r.event_type), occurredAt: iso(r.occurred_at), endsAt: null,
      branchId: r.branch_id ?? null, branchName: r.branch_name ?? null, from: r.from_value ?? null, to: r.to_value ?? null,
      reason: r.reason ?? null, actorName: r.actor_name ?? null,
    })),
    ...(leave?.rows ?? []).map((r: any): EmploymentHistoryRow => ({
      id: `leave:${r.id}`, type: 'leave', label: `Leave (${String(r.kind).toLowerCase()})`, occurredAt: iso(r.starts_at), endsAt: iso(r.ends_at),
      branchId: null, branchName: null, from: null, to: null, reason: r.reason ?? null, actorName: null,
    })),
  ];
  return rows.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
}
