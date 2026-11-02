// member-ref.ts — resolve a Team Management memberId (a login's users.id, or a login-less technicians.id — the same id the
// directory and the profile overlay use) to the salon's records. Tenant literal in every statement; 404 outside the salon.
import { sql, type Kysely } from 'kysely';
import { UUID, err, type TeamCtx } from '../team-screens/screen-kit';

export interface MemberRef { memberId: string; userId: string | null; technicianId: string | null; name: string; branchId: string | null; current: boolean }

export async function resolveMember(db: Kysely<any>, ctx: TeamCtx, memberId: string): Promise<MemberRef> {
  if (!UUID.test(String(memberId))) throw err(404, 'MEMBER_NOT_FOUND', 'That team member is not in this salon.');
  const T = ctx.tenantId;
  const u = (await sql<any>`select u.id, u.branch_id, u.status, coalesce(nullif(u.full_name, ''), nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), u.email, 'Team member') as name,
      (select t.id from technicians t where t.tenant_id = ${T} and t.user_id = u.id order by (t.archived_at is null) desc, t.created_at desc limit 1) as tid
    from users u where u.tenant_id = ${T} and u.id = ${memberId} and upper(coalesce(u.role, '')) not in ('CUSTOMER', 'SUPER_ADMIN')`.execute(db)).rows[0];
  if (u) return { memberId: String(u.id), userId: String(u.id), technicianId: u.tid ? String(u.tid) : null, name: String(u.name), branchId: u.branch_id ? String(u.branch_id) : null,
    current: !['archived', 'deleted'].includes(String(u.status ?? 'active')) };
  const t = (await sql<any>`select t.id, t.user_id, t.branch_id, t.archived_at, t.status, coalesce(nullif(t.full_name, ''), nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), ''), 'Technician') as name,
      exists (select 1 from users u2 where u2.tenant_id = ${T} and u2.id = t.user_id) as has_login
    from technicians t where t.tenant_id = ${T} and t.id = ${memberId}`.execute(db)).rows[0];
  if (!t) throw err(404, 'MEMBER_NOT_FOUND', 'That team member is not in this salon.');
  const uid = t.has_login && t.user_id ? String(t.user_id) : null;
  return { memberId: uid ?? String(t.id), userId: uid, technicianId: String(t.id), name: String(t.name), branchId: t.branch_id ? String(t.branch_id) : null,
    current: !t.archived_at && String(t.status ?? '') !== 'archived' };
}

/** the team_staff_profiles row of a member (by login first, else by technician record) — alias p */
export function profileMatch(ctx: TeamCtx, m: MemberRef) {
  return sql`p.tenant_id = ${ctx.tenantId} and ((${m.userId}::uuid is not null and p.user_id = ${m.userId}::uuid) or (${m.technicianId}::uuid is not null and p.technician_id = ${m.technicianId}::uuid))`;
}
