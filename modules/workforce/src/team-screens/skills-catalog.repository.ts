// skills-catalog.repository.ts — Technician Profile & Team Management guide (Nov 5 2026, G3 §8, migration 816): the
// salon's reusable Skills Catalog and technician skill assignments.
//
//   catalog   tenant_skills: name (unique per salon, case-insensitive), category, description, required certification, the
//             EXISTING services the skill qualifies for (tenant_skill_services). No price or duration — the Service
//             Catalog owns those. Archived, never deleted. Search + status filter + numbered pages, newest first.
//   assign    one or several skills to a technician by an authorized manager (pos.technicians.skills.edit). Approval grants
//             each linked active service in the ONE eligibility table, technician_services (granted_via 'skill:<id>'), so
//             Booking / Find Opening / Tech Queue / the Technician App see it at once. An existing grant (another skill, a
//             manager, a Skill Request) is never duplicated or overwritten. Technicians still REQUEST skills through the
//             existing Skill Requests flow; they never approve their own.
//   revoke    with a reason. Removes only the services this skill granted that no other live skill also grants — a
//             manager's direct grant stays. Future bookings that use a removed service are listed for human review —
//             never cancelled or reassigned. History stays (REVOKED row).
import { sql, type Kysely } from 'kysely';
import { N, iso, branchOf, teamPeriod, UUID, err, canAny, like, paging, served, type TeamCtx } from './screen-kit';
import { writeAuditRow } from './audit-rows';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_SKILL, TECHNICIAN_SKILL_ASSIGNMENT } from '../workforce-lifecycles';

const VIEW = ['pos.technicians.view', 'pos.technicians.skills.edit'];
const EDIT = ['pos.technicians.skills.edit'];
const HOLDING = ['scheduled', 'confirmed', 'booked', 'checked_in', 'arrived', 'pending'];
const PROF = ['BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const uuids = (v: unknown, max = 100): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, max) : []);

export class SkillsCatalogRepository {
  constructor(private readonly db: Kysely<any>) {}
  private must(ctx: TeamCtx, keys: string[], what: string) { if (!canAny(ctx, ...keys)) throw err(403, 'FORBIDDEN', `You do not have permission to ${what}.`); }

  private async services(exec: Kysely<any>, T: string, ids: string[]) {
    if (!ids.length) return [];
    return (await sql<any>`select s.id, s.name, s.branch_id, s.status, s.archived_at from services s where s.tenant_id = ${T} and s.id = any(${ids}::uuid[])`.execute(exec)).rows;
  }
  private skillRow(r: any) {
    return { id: String(r.id), name: r.name, category: r.category ?? null, description: r.description ?? null, requiredCertification: r.required_certification ?? null, status: r.status,
      version: N(r.version), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), createdBy: r.created_by_name ?? null,
      services: (Array.isArray(r.services) ? r.services : []).map((x: any) => ({ id: String(x.id), name: x.name, active: !!x.active })), technicians: N(r.technicians) };
  }

  async list(ctx: TeamCtx, q: { q?: string; status?: string; category?: string; page?: unknown; pageSize?: unknown }) {
    this.must(ctx, VIEW, 'view the skills catalog');
    const T = ctx.tenantId; const { page, pageSize } = paging(q.page, q.pageSize, 25);
    const text = str(q.q, 100); const status = q.status === 'archived' ? 'archived' : q.status === 'all' ? null : 'active'; const cat = str(q.category, 60);
    const where = sql`k.tenant_id = ${T} and ${status ? sql`k.status = ${status}` : sql`true`} and ${cat ? sql`lower(coalesce(k.category, '')) = lower(${cat})` : sql`true`}
      and ${text ? sql`(k.name ilike ${like(text)} or coalesce(k.category, '') ilike ${like(text)} or exists (select 1 from tenant_skill_services x join services s on s.id = x.service_id and s.tenant_id = x.tenant_id
        where x.tenant_id = k.tenant_id and x.skill_id = k.id and s.name ilike ${like(text)}))` : sql`true`}`;
    const total = N((await sql<any>`select count(*)::int as n from tenant_skills k where k.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
    const sv = served(page, pageSize, total);
    const rows = (await sql<any>`select k.id, k.tenant_id, k.name, k.category, k.description, k.required_certification, k.status, k.version, k.created_by, k.updated_by, k.archived_at, k.created_at, k.updated_at, coalesce(nullif(u.full_name, ''), u.email) as created_by_name,
        (select coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'active', s.status = 'active' and s.archived_at is null) order by s.name), '[]'::json)
          from tenant_skill_services x join services s on s.id = x.service_id and s.tenant_id = x.tenant_id where x.tenant_id = k.tenant_id and x.skill_id = k.id) as services,
        (select count(*)::int from technician_skill_assignments a where a.tenant_id = k.tenant_id and a.skill_id = k.id and a.status = 'APPROVED') as technicians
      from tenant_skills k left join users u on u.id = k.created_by and u.tenant_id = k.tenant_id where k.tenant_id = ${T} and ${where}
      order by k.created_at desc, k.id desc limit ${pageSize} offset ${sv.offset}`.execute(this.db)).rows;
    const categories = (await sql<any>`select distinct category from tenant_skills where tenant_id = ${T} and category is not null order by category`.execute(this.db)).rows.map((r: any) => String(r.category));
    return { items: rows.map((r: any) => this.skillRow(r)), page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages, categories, canEdit: canAny(ctx, ...EDIT) };
  }

  /** create / edit a skill (same body); a name already used in this salon is refused, never duplicated */
  async save(ctx: TeamCtx, b: { id?: unknown; name?: unknown; category?: unknown; description?: unknown; requiredCertification?: unknown; serviceIds?: unknown; expectedVersion?: unknown }, requestId: string) {
    this.must(ctx, EDIT, 'manage the skills catalog');
    const T = ctx.tenantId; const name = str(b.name, 80);
    if (!name) throw err(422, 'SKILL_INVALID', 'Enter the skill name.', { field: 'name' });
    const category = str(b.category, 60); const description = str(b.description, 500); const cert = str(b.requiredCertification, 120);
    const sids = uuids(b.serviceIds);
    const svc = await this.services(this.db, T, sids);
    if (svc.length !== sids.length) throw err(422, 'SKILL_INVALID', 'One of the linked services is not in this salon.', { field: 'serviceIds' });
    return this.db.transaction().execute(async (trx) => {
      const dupe = (await sql<any>`select id from tenant_skills where tenant_id = ${T} and lower(name) = lower(${name}) and (${typeof b.id === 'string' && UUID.test(b.id) ? b.id : null}::uuid is null or id <> ${typeof b.id === 'string' && UUID.test(b.id) ? b.id : null}::uuid)`.execute(trx)).rows[0];
      if (dupe) throw err(409, 'SKILL_EXISTS', `A skill named "${name}" already exists in this salon.`, { skillId: String(dupe.id) });
      let id: string; let before: any = null;
      if (typeof b.id === 'string' && UUID.test(b.id)) {
        before = (await sql<any>`select id, tenant_id, name, category, description, required_certification, status, version, created_by, updated_by, archived_at, created_at, updated_at from tenant_skills where tenant_id = ${T} and id = ${b.id} for update`.execute(trx)).rows[0];
        if (!before) throw err(404, 'SKILL_NOT_FOUND', 'That skill was not found.');
        if (b.expectedVersion != null && Math.trunc(Number(b.expectedVersion)) !== N(before.version)) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this skill. Reload to see the latest.', { currentVersion: N(before.version) });
        await sql`update tenant_skills set name = ${name}, category = ${category}, description = ${description}, required_certification = ${cert}, version = version + 1, updated_by = ${ctx.userId ?? null}, updated_at = now()
          where tenant_id = ${T} and id = ${b.id}`.execute(trx);
        id = b.id;
        await sql`delete from tenant_skill_services where tenant_id = ${T} and skill_id = ${id} and not (service_id = any(${sids}::uuid[]))`.execute(trx);
      } else {
        id = String((await sql<any>`insert into tenant_skills (tenant_id, name, category, description, required_certification, created_by, updated_by)
          values (${T}, ${name}, ${category}, ${description}, ${cert}, ${ctx.userId ?? null}, ${ctx.userId ?? null}) returning id`.execute(trx)).rows[0].id);
      }
      for (const s of sids) await sql`insert into tenant_skill_services (tenant_id, skill_id, service_id) values (${T}, ${id}, ${s}) on conflict do nothing`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: before ? 'skill_catalog.updated' : 'skill_catalog.created', resourceType: 'tenant_skill', resourceId: id,
        summary: `${before ? 'Skill updated' : 'Skill created'}: ${name}`, before: before ? { name: before.name, category: before.category } : null, after: { name, category, serviceIds: sids }, requestId });
      return { id, created: !before };
    });
  }

  async archive(ctx: TeamCtx, id: string, b: { archived?: unknown; reason?: unknown }, requestId: string) {
    this.must(ctx, EDIT, 'manage the skills catalog');
    if (!UUID.test(id)) throw err(404, 'SKILL_NOT_FOUND', 'That skill was not found.');
    const archived = b.archived !== false;
    const r = (await sql<any>`update tenant_skills set status = ${archived ? 'archived' : 'active'}, archived_at = ${archived ? sql`now()` : null}, version = version + 1, updated_by = ${ctx.userId ?? null}, updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${id} and ${canMoveToSql(TENANT_SKILL, archived ? 'archived' : 'active')} returning id, name`.execute(this.db)).rows[0];
    if (!r) throw err(404, 'SKILL_NOT_FOUND', 'That skill was not found, or it is already ' + (archived ? 'archived.' : 'active.'));
    await writeAuditRow(this.db, ctx, { module: 'workforce', action: archived ? 'skill_catalog.archived' : 'skill_catalog.restored', resourceType: 'tenant_skill', resourceId: id,
      summary: `${archived ? 'Skill archived' : 'Skill restored'}: ${r.name}`, reason: str(b.reason, 500), requestId });
    // archiving hides the skill from new assignments; technicians who hold it keep it (and its services) until revoked
    return { id, status: archived ? 'archived' : 'active' };
  }

  private async tech(ctx: TeamCtx, id: unknown) {
    if (typeof id !== 'string' || !UUID.test(id)) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const t = (await sql<any>`select te.id, te.full_name, te.branch_id from technicians te where te.tenant_id = ${ctx.tenantId} and te.id = ${id} and te.archived_at is null`.execute(this.db)).rows[0];
    if (!t) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    return t;
  }

  /** the technician's skills (live + history) and the services each grants */
  async technicianSkills(ctx: TeamCtx, technicianId: string) {
    this.must(ctx, VIEW, 'view technician skills');
    const t = await this.tech(ctx, technicianId); const T = ctx.tenantId;
    const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const rows = (await sql<any>`select a.id, a.skill_id, a.status, a.proficiency, to_char(a.effective_from, 'YYYY-MM-DD') as f, to_char(a.expires_on, 'YYYY-MM-DD') as x, a.approved_at, a.revoked_at, a.revoke_reason, a.version,
        k.name, k.category, k.status as skill_status, coalesce(nullif(u.full_name, ''), u.email) as approved_by_name,
        (select coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'granted', exists (select 1 from technician_services ts where ts.tenant_id = s.tenant_id and ts.technician_id = a.technician_id and ts.service_id = s.id))
            order by s.name), '[]'::json) from tenant_skill_services x join services s on s.id = x.service_id and s.tenant_id = x.tenant_id where x.tenant_id = a.tenant_id and x.skill_id = a.skill_id) as services
      from technician_skill_assignments a join tenant_skills k on k.id = a.skill_id and k.tenant_id = a.tenant_id left join users u on u.id = a.approved_by and u.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.technician_id = ${t.id} order by (a.status = 'APPROVED') desc, a.created_at desc limit 200`.execute(this.db)).rows;
    const items = rows.map((r: any) => ({ id: String(r.id), skillId: String(r.skill_id), name: r.name, category: r.category ?? null, proficiency: r.proficiency ?? null,
      // the displayed status comes from the record, never a checkbox: Approved / Expired / Inactive (archived skill) / Revoked
      status: r.status === 'REVOKED' ? 'REVOKED' : r.x && r.x < per.today ? 'EXPIRED' : r.skill_status !== 'active' ? 'INACTIVE' : r.f > per.today ? 'PENDING' : 'APPROVED',
      effectiveFrom: r.f, expiresOn: r.x ?? null, approvedAt: iso(r.approved_at), approvedBy: r.approved_by_name ?? null, revokedAt: iso(r.revoked_at), revokeReason: r.revoke_reason ?? null, version: N(r.version),
      services: (Array.isArray(r.services) ? r.services : []).map((s: any) => ({ id: String(s.id), name: s.name, granted: !!s.granted })) }));
    const eligible = N((await sql<any>`select count(*)::int as n from technician_services where tenant_id = ${T} and technician_id = ${t.id}`.execute(this.db)).rows[0]?.n);
    return { technicianId: String(t.id), items, eligibleServices: eligible, canEdit: canAny(ctx, ...EDIT) };
  }

  /** Assign Skills: several catalog skills at once; each grants its linked active services (never duplicated) */
  async assign(ctx: TeamCtx, b: { technicianId?: unknown; skillIds?: unknown; proficiency?: unknown; effectiveFrom?: unknown; expiresOn?: unknown }, requestId: string) {
    this.must(ctx, EDIT, 'assign skills');
    const t = await this.tech(ctx, b.technicianId); const T = ctx.tenantId;
    if (ctx.userId && String(t.id) === String((await sql<any>`select id from technicians where tenant_id = ${T} and user_id = ${ctx.userId} limit 1`.execute(this.db)).rows[0]?.id ?? ''))
      throw err(403, 'SKILL_SELF_APPROVAL', 'You cannot approve skills for yourself — ask a manager, or send a Skill Request.');
    const ids = uuids(b.skillIds, 50);
    if (!ids.length) throw err(422, 'SKILL_INVALID', 'Choose at least one skill.', { field: 'skillIds' });
    const prof = typeof b.proficiency === 'string' && PROF.includes(b.proficiency) ? b.proficiency : null;
    const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const from = typeof b.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.effectiveFrom) ? b.effectiveFrom : per.today;
    const exp = typeof b.expiresOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.expiresOn) ? b.expiresOn : null;
    if (exp && exp < from) throw err(422, 'SKILL_INVALID', 'The expiry date must be after the start date.', { field: 'expiresOn' });
    const skills = (await sql<any>`select id, name, status from tenant_skills where tenant_id = ${T} and id = any(${ids}::uuid[])`.execute(this.db)).rows;
    if (skills.length !== ids.length) throw err(404, 'SKILL_NOT_FOUND', 'One of the chosen skills is not in this salon.');
    const archived = skills.filter((k: any) => k.status !== 'active');
    if (archived.length) throw err(422, 'SKILL_INACTIVE', `Archived skills cannot be assigned: ${archived.map((k: any) => k.name).join(', ')}.`);
    const out = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'tech-skills:' + T + ':' + t.id}))`.execute(trx);
      const assigned: string[] = []; const already: string[] = []; const granted: string[] = [];
      for (const k of skills) {
        const ins = (await sql<any>`insert into technician_skill_assignments (tenant_id, branch_id, technician_id, skill_id, status, proficiency, effective_from, expires_on, approved_by, approved_at, updated_by)
          values (${T}, ${branchOf(ctx)}, ${t.id}, ${k.id}, 'APPROVED', ${prof}, ${from}::date, ${exp}::date, ${ctx.userId ?? null}, now(), ${ctx.userId ?? null})
          on conflict (tenant_id, technician_id, skill_id) where status = 'APPROVED' do nothing returning id`.execute(trx)).rows[0];
        if (!ins) { already.push(String(k.name)); continue; }
        assigned.push(String(k.name));
        // grant the linked ACTIVE services in the one eligibility table (an existing grant is left exactly as it is)
        const g = (await sql<any>`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary, proficiency, granted_by_user_id, granted_via, created_at, updated_at, updated_by)
          select ${T}, s.branch_id, ${t.id}, s.id, false, ${prof}, ${ctx.userId ?? null}, ${'skill:' + k.id}, now(), now(), ${ctx.userId ?? null}
          from tenant_skill_services x join services s on s.id = x.service_id and s.tenant_id = x.tenant_id
          where x.tenant_id = ${T} and x.skill_id = ${k.id} and s.status = 'active' and s.archived_at is null
          on conflict (tenant_id, technician_id, service_id) do nothing returning service_id`.execute(trx)).rows;
        granted.push(...g.map((r: any) => String(r.service_id)));
      }
      if (assigned.length) await writeAuditRow(trx, ctx, { module: 'workforce', action: 'technician.skills.assigned', resourceType: 'technician', resourceId: String(t.id),
        summary: `Skills assigned: ${assigned.join(', ')}`, after: { skills: assigned, servicesGranted: granted.length, proficiency: prof, effectiveFrom: from, expiresOn: exp }, requestId, metadata: { technicianId: t.id } });
      return { assigned, already, servicesGranted: granted.length };
    });
    return { ...out, ...(await this.technicianSkills(ctx, String(t.id))) };
  }

  /** what revoking would remove + the future bookings that use those services (nothing written) */
  private async revokePlan(exec: Kysely<any>, ctx: TeamCtx, t: any, assignmentId: string, lock = false) {
    const T = ctx.tenantId;
    const a = (await sql<any>`select a.id, a.tenant_id, a.branch_id, a.technician_id, a.skill_id, a.status, a.proficiency, a.effective_from, a.expires_on, a.approved_by, a.approved_at, a.revoked_by, a.revoked_at, a.revoke_reason, a.version, a.updated_by, a.created_at, a.updated_at, k.name from technician_skill_assignments a join tenant_skills k on k.id = a.skill_id and k.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.technician_id = ${t.id} and a.id = ${assignmentId} ${lock ? sql`for update of a` : sql``}`.execute(exec)).rows[0];
    if (!a) throw err(404, 'SKILL_ASSIGNMENT_NOT_FOUND', 'That skill is not assigned to this technician.');
    // services this skill granted that no OTHER live skill of the technician also links
    const removes = (await sql<any>`select ts.service_id, s.name from technician_services ts join services s on s.id = ts.service_id and s.tenant_id = ts.tenant_id
      where ts.tenant_id = ${T} and ts.technician_id = ${t.id} and ts.granted_via = ${'skill:' + a.skill_id}
        and not exists (select 1 from technician_skill_assignments o join tenant_skill_services x on x.tenant_id = o.tenant_id and x.skill_id = o.skill_id
          where o.tenant_id = ${T} and o.technician_id = ${t.id} and o.status = 'APPROVED' and o.id <> ${a.id} and x.service_id = ts.service_id)`.execute(exec)).rows;
    const sids = removes.map((r: any) => String(r.service_id));
    const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const bookings = sids.length ? (await sql<any>`select a.id, to_char(a.appt_date, 'YYYY-MM-DD') as d, left(a.start_time::text, 5) as s, a.customer_name, a.status
      from pos_tech_appointments a where a.tenant_id = ${T} and a.technician_id = ${t.id} and a.appt_date >= ${per.today}::date and lower(a.status) = any(${HOLDING}::text[])
        and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) e where e->>'serviceId' = any(${sids}::text[]))
      order by a.appt_date, a.start_time limit 100`.execute(exec)).rows : [];
    return { a, removes: removes.map((r: any) => ({ id: String(r.service_id), name: r.name })), bookings: bookings.map((b: any) => ({ appointmentId: String(b.id), date: String(b.d), startTime: b.s, customer: b.customer_name ?? null, status: String(b.status) })) };
  }
  async revokePreview(ctx: TeamCtx, technicianId: string, assignmentId: string) {
    this.must(ctx, VIEW, 'view technician skills');
    const t = await this.tech(ctx, technicianId);
    if (!UUID.test(assignmentId)) throw err(404, 'SKILL_ASSIGNMENT_NOT_FOUND', 'That skill is not assigned to this technician.');
    const p = await this.revokePlan(this.db, ctx, t, assignmentId);
    return { assignmentId, skill: p.a.name, servicesRemoved: p.removes, futureBookings: p.bookings };
  }
  async revoke(ctx: TeamCtx, b: { technicianId?: unknown; assignmentId?: unknown; reason?: unknown; expectedVersion?: unknown; acknowledgeBookings?: unknown }, requestId: string) {
    this.must(ctx, EDIT, 'remove skills');
    const t = await this.tech(ctx, b.technicianId); const T = ctx.tenantId;
    const reason = str(b.reason, 500);
    if (!reason || reason.length < 3) throw err(422, 'SKILL_INVALID', 'Give a reason for removing the skill.', { field: 'reason' });
    if (typeof b.assignmentId !== 'string' || !UUID.test(b.assignmentId)) throw err(404, 'SKILL_ASSIGNMENT_NOT_FOUND', 'That skill is not assigned to this technician.');
    const assignmentId = b.assignmentId;
    const out = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'tech-skills:' + T + ':' + t.id}))`.execute(trx);
      const p = await this.revokePlan(trx, ctx, t, assignmentId, true);
      if (p.a.status !== 'APPROVED') throw err(409, 'SKILL_ASSIGNMENT_STATE', 'This skill was already removed.');
      if (b.expectedVersion != null && Math.trunc(Number(b.expectedVersion)) !== N(p.a.version)) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this skill assignment. Reload to see the latest.', { currentVersion: N(p.a.version) });
      if (p.bookings.length && b.acknowledgeBookings !== true)
        throw err(409, 'SCHEDULE_CONFLICT', `${p.bookings.length} future booking(s) use a service this skill grants. They are kept for a person to review — confirm to continue.`, { futureBookings: p.bookings, canAcknowledge: true });
      await sql`update technician_skill_assignments set status = 'REVOKED', revoked_by = ${ctx.userId ?? null}, revoked_at = now(), revoke_reason = ${reason}, version = version + 1, updated_by = ${ctx.userId ?? null}, updated_at = now()
        where tenant_id = ${T} and id = ${assignmentId} and ${canMoveToSql(TECHNICIAN_SKILL_ASSIGNMENT, 'REVOKED')}`.execute(trx);
      const sids = p.removes.map((r) => r.id);
      if (sids.length) await sql`delete from technician_services where tenant_id = ${T} and technician_id = ${t.id} and granted_via = ${'skill:' + p.a.skill_id} and service_id = any(${sids}::uuid[])`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'technician.skills.revoked', resourceType: 'technician', resourceId: String(t.id),
        summary: `Skill removed: ${p.a.name}`, before: { skill: p.a.name, services: p.removes.map((r) => r.name) }, after: { status: 'REVOKED' }, reason,
        metadata: { technicianId: t.id, assignmentId, futureBookingsForReview: p.bookings.map((x) => x.appointmentId) }, requestId });
      return { revoked: true, servicesRemoved: p.removes, futureBookingsForReview: p.bookings };
    });
    return { ...out, ...(await this.technicianSkills(ctx, String(t.id))) };
  }
}
