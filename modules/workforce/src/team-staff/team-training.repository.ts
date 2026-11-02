// team-training.repository.ts — TM-09 (Four-Module Completion Guide §10.4, 30 Oct 2026): the salon's training catalog,
// staff assignments with a versioned lifecycle, and certification records — migration 727.
//
//   catalog        team_training_courses (tenant-scoped; validity in months → completion expiry; archive, never delete)
//   assignment     assigned → in_progress → completed → expired (completion + validity passed; the nightly sweep persists
//                  it, reads already show it) · assigned / in_progress → canceled. Row lock + expectedVersion (409),
//                  server-side transition check (422), an append-only team_training_events row and the audit row in ONE
//                  transaction. A completed / expired / canceled assignment may be followed by a new one (history kept).
//   certification  COMPLETION IS NOT CERTIFICATION. A certification is its own record with an issuer, an optional expiry and
//                  a verification status that only a verifier changes. A technician's certifications are the canonical
//                  technician_certifications rows (migration 584 — created UNVERIFIED here, verified with the existing
//                  POS verify route) and are LINKED from the assignment, never copied. Staff without a technician record
//                  use team_staff_certifications (verified / rejected / revoked here).
//   empty          the Training panel says "Not configured" while the catalog is empty — never a row of zeros.
//   permissions    view: the Team screen (pos.technicians.view); manage: technicians.edit or roles.manage; verify a staff
//                  certification: pos.technicians.skills.edit or roles.manage. Denied attempts are audited.
import { dateColumnYmd } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { N, iso, err, canAny, paging, served, teamPeriod, branchOf, UUID, actorOf, logGap, type TeamCtx } from '../team-screens/screen-kit';
import { writeAuditRow } from '../team-screens/audit-rows';
import { canMoveToSql } from '@aipowersalon/database';
import { TEAM_TRAINING_COURSE, TEAM_TRAINING_ASSIGNMENT, TEAM_STAFF_CERTIFICATION } from '../workforce-lifecycles';
import { resolveMember, type MemberRef } from './member-ref';

export const TRAINING_STATUSES = ['assigned', 'in_progress', 'completed', 'expired', 'canceled'] as const;
type TStatus = typeof TRAINING_STATUSES[number];
export type TrainingAction = 'start' | 'complete' | 'cancel' | 'expire';
export const TRAINING_TRANSITIONS: Record<TrainingAction, { from: TStatus[]; to: TStatus; event: string }> = {
  start: { from: ['assigned'], to: 'in_progress', event: 'STARTED' },
  complete: { from: ['assigned', 'in_progress'], to: 'completed', event: 'COMPLETED' },
  cancel: { from: ['assigned', 'in_progress'], to: 'canceled', event: 'CANCELED' },
  expire: { from: ['completed'], to: 'expired', event: 'EXPIRED' },
};
const MANAGE = ['technicians.edit', 'roles.manage'];
const VERIFY = ['pos.technicians.skills.edit', 'roles.manage'];
export const EXPIRING_DAYS = 30;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// DATE columns are selected as text (to_char … 'YYYY-MM-DD'): node-postgres hands a DATE back at LOCAL midnight and PGlite at
// UTC midnight, so formatting a Date is only right for one of them — the text is right for both
const ymd = (v: unknown) => dateColumnYmd(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const addMonths = (d: string, m: number) => { const [y, mo, da] = d.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1 + m, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(da, last)).padStart(2, '0')}`; };
/** the status a reader sees: a completion whose validity has passed is expired even before the sweep persists it */
export const effectiveStatus = (status: string, expiresOn: string | null, today: string): string => (status === 'completed' && expiresOn && expiresOn < today ? 'expired' : status);

export class TeamTrainingRepository {
  constructor(private readonly db: Kysely<any>) {}
  private async today(ctx: TeamCtx) { return (await teamPeriod(this.db, ctx, { preset: 'today' })).today; }
  private async denied(ctx: TeamCtx, action: string, requestId: string, message: string): Promise<never> {
    await writeAuditRow(this.db, ctx, { module: 'workforce', action: `team.training.${action}.denied`, resourceType: 'team_training', resourceId: null, status: 'denied', severity: 'warning',
      summary: `Denied: training ${action}`, metadata: {}, requestId }).catch(logGap('team_training_denial_not_recorded'));
    throw err(403, 'FORBIDDEN', message);
  }
  private async mustManage(ctx: TeamCtx, action: string, requestId: string) { if (!canAny(ctx, ...MANAGE)) await this.denied(ctx, action, requestId, 'You do not have permission to manage training.'); }

  // ── summary (the Training & Certifications panel) ─────────────────────────────────────────────────────────────
  async summary(ctx: TeamCtx) {
    const T = ctx.tenantId; const today = await this.today(ctx);
    const c = (await sql<any>`select count(*) filter (where c.status = 'active')::int as active, count(*)::int as total from team_training_courses c where c.tenant_id = ${T}`.execute(this.db)).rows[0];
    const a = (await sql<any>`select count(*) filter (where a.status = 'assigned')::int as assigned, count(*) filter (where a.status = 'in_progress')::int as in_progress,
        count(*) filter (where a.status = 'completed' and (a.expires_on is null or a.expires_on >= ${today}::date))::int as completed,
        count(*) filter (where a.status = 'completed' and a.expires_on >= ${today}::date and a.expires_on <= ${today}::date + ${EXPIRING_DAYS}::int)::int as expiring,
        count(*) filter (where a.status = 'expired' or (a.status = 'completed' and a.expires_on < ${today}::date))::int as expired,
        count(*) filter (where a.status = 'canceled')::int as canceled,
        count(*) filter (where a.status in ('assigned', 'in_progress') and a.due_date < ${today}::date)::int as overdue
      from team_training_assignments a where a.tenant_id = ${T}`.execute(this.db)).rows[0];
    const s = (await sql<any>`select count(*) filter (where s.verification_status = 'VERIFIED' and (s.expires_on is null or s.expires_on >= ${today}::date))::int as verified,
        count(*) filter (where s.verification_status = 'UNVERIFIED')::int as unverified,
        count(*) filter (where s.verification_status = 'VERIFIED' and s.expires_on >= ${today}::date and s.expires_on <= ${today}::date + ${EXPIRING_DAYS}::int)::int as expiring
      from team_staff_certifications s where s.tenant_id = ${T}`.execute(this.db)).rows[0];
    return { configured: N(c?.active) > 0, today, expiringWindowDays: EXPIRING_DAYS, courses: { active: N(c?.active), total: N(c?.total) },
      assignments: { assigned: N(a?.assigned), inProgress: N(a?.in_progress), completed: N(a?.completed), expiringSoon: N(a?.expiring), expired: N(a?.expired), canceled: N(a?.canceled), overdue: N(a?.overdue) },
      staffCertifications: { verified: N(s?.verified), unverified: N(s?.unverified), expiringSoon: N(s?.expiring) }, canManage: canAny(ctx, ...MANAGE) };
  }

  // ── catalog ───────────────────────────────────────────────────────────────────────────────────────────────────
  async courses(ctx: TeamCtx, f: { status?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const st = f.status === 'archived' ? 'archived' : f.status === 'all' ? 'all' : 'active';
    const w = sql`c.tenant_id = ${T} and (${st} = 'all' or c.status = ${st})`;
    const total = N((await sql<any>`select count(*)::int as n from team_training_courses c where c.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select c.id, c.name, c.category, c.description, c.validity_months, c.certification_name, c.status, c.version, c.created_at, (select count(*) from team_training_assignments a where a.tenant_id = ${T} and a.course_id = c.id and a.status in ('assigned', 'in_progress'))::int as open_n,
        (select count(*) from team_training_assignments a where a.tenant_id = ${T} and a.course_id = c.id and a.status = 'completed')::int as done_n
      from team_training_courses c where c.tenant_id = ${T} and ${w} order by lower(c.name), c.id limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { items: rows.map((c: any) => ({ id: String(c.id), name: String(c.name), category: c.category ?? null, description: c.description ?? null, validityMonths: c.validity_months == null ? null : N(c.validity_months),
      certificationName: c.certification_name ?? null, status: String(c.status), version: N(c.version), open: N(c.open_n), completed: N(c.done_n), createdAt: iso(c.created_at) })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages, canManage: canAny(ctx, ...MANAGE) };
  }
  async createCourse(ctx: TeamCtx, b: { name?: unknown; category?: unknown; description?: unknown; validityMonths?: unknown; certificationName?: unknown }, requestId: string) {
    await this.mustManage(ctx, 'course.create', requestId); const T = ctx.tenantId;
    const name = text(b.name, 120); if (name.length < 2) throw err(422, 'NAME_REQUIRED', 'Name the training.');
    const vm = b.validityMonths == null ? null : Math.trunc(Number(b.validityMonths)); if (vm != null && !(vm >= 1 && vm <= 120)) throw err(422, 'VALIDITY_INVALID', 'Validity is 1–120 months, or none.');
    const dup = (await sql<any>`select 1 as x from team_training_courses c where c.tenant_id = ${T} and c.status = 'active' and lower(c.name) = lower(${name})`.execute(this.db)).rows[0];
    if (dup) throw err(409, 'COURSE_EXISTS', 'A training with that name already exists.');
    const id = await this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`insert into team_training_courses (tenant_id, name, category, description, validity_months, certification_name, created_by)
        values (${T}, ${name}, ${text(b.category, 60) || null}, ${text(b.description, 1000) || null}, ${vm}, ${text(b.certificationName, 120) || null}, ${ctx.userId || null}::uuid) returning id`.execute(trx)).rows[0];
      await sql`insert into team_training_events (tenant_id, course_id, event_type, actor_user_id, metadata_json, request_id) values (${T}, ${r.id}, 'COURSE_CREATED', ${ctx.userId || null}::uuid, ${JSON.stringify({ name, validityMonths: vm })}::jsonb, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'team.training.course.created', resourceType: 'team_training_course', resourceId: String(r.id), summary: `Training added: ${name}`, after: { name, validityMonths: vm }, requestId });
      return String(r.id);
    });
    return (await this.courses(ctx, { status: 'all', pageSize: 100 })).items.find((c) => c.id === id);
  }
  async archiveCourse(ctx: TeamCtx, id: string, b: { expectedVersion?: unknown; reason?: unknown }, requestId: string) {
    await this.mustManage(ctx, 'course.archive', requestId); const T = ctx.tenantId;
    if (!UUID.test(String(id))) throw err(404, 'COURSE_NOT_FOUND', 'That training is not in this salon.');
    const reason = text(b.reason, 1000); if (reason.length < 5) throw err(422, 'REASON_REQUIRED', 'Say why (at least 5 characters).');
    await this.db.transaction().execute(async (trx) => {
      const c = (await sql<any>`select c.id, c.name, c.status, c.version from team_training_courses c where c.tenant_id = ${T} and c.id = ${id} for update`.execute(trx)).rows[0];
      if (!c) throw err(404, 'COURSE_NOT_FOUND', 'That training is not in this salon.');
      if (N(c.version) !== Number(b.expectedVersion)) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this training. Reload.', { currentVersion: N(c.version) });
      if (c.status === 'archived') throw err(422, 'INVALID_TRANSITION', 'That training is already archived.');
      const moved = await sql`update team_training_courses c set status = 'archived', version = c.version + 1, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where c.tenant_id = ${T} and c.id = ${id} and ${canMoveToSql(TEAM_TRAINING_COURSE, 'archived', 'c')}`.execute(trx);
      if (moved.numAffectedRows === 0n) throw err(409, 'INVALID_STATE_TRANSITION', 'That training cannot be archived from its current state. Reload.');
      await sql`insert into team_training_events (tenant_id, course_id, event_type, actor_user_id, reason, request_id) values (${T}, ${id}, 'COURSE_ARCHIVED', ${ctx.userId || null}::uuid, ${reason}, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'team.training.course.archived', resourceType: 'team_training_course', resourceId: id, summary: `Training archived: ${c.name}`, reason, requestId });
    });
    return { id, status: 'archived' };
  }

  // ── a member's training record (the profile overlay's Training tab) ─────────────────────────────────────────────
  async member(ctx: TeamCtx, memberId: string) {
    const m = await resolveMember(this.db, ctx, memberId); const T = ctx.tenantId; const today = await this.today(ctx);
    const conf = (await sql<any>`select count(*)::int as n from team_training_courses c where c.tenant_id = ${T} and c.status = 'active'`.execute(this.db)).rows[0];
    const rows = (await sql<any>`select a.id, a.course_id, a.status, to_char(a.due_date, 'YYYY-MM-DD') as due_date, a.assigned_at, a.started_at, to_char(a.completed_on, 'YYYY-MM-DD') as completed_on, to_char(a.expires_on, 'YYYY-MM-DD') as expires_on, a.canceled_at, a.cancel_reason, a.version,
        a.technician_certification_id, a.staff_certification_id, c.name as course, c.validity_months, c.certification_name from team_training_assignments a join team_training_courses c on c.id = a.course_id and c.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and ((${m.userId}::uuid is not null and a.user_id = ${m.userId}::uuid) or (${m.technicianId}::uuid is not null and a.technician_id = ${m.technicianId}::uuid))
      order by a.assigned_at desc, a.id desc limit 100`.execute(this.db)).rows;
    const ids = rows.map((r: any) => String(r.id));
    const ev = ids.length ? (await sql<any>`select e.assignment_id, e.event_type, e.from_status, e.to_status, e.reason, e.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor from team_training_events e
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.assignment_id in (${sql.join(ids)}) order by e.created_at desc, e.id desc limit 300`.execute(this.db)).rows : [];
    const techCerts = m.technicianId ? (await sql<any>`select tc.id, tc.name, tc.issuer, to_char(tc.issued_at, 'YYYY-MM-DD') as issued_at, to_char(tc.expires_at, 'YYYY-MM-DD') as expires_at, tc.verification_status, tc.verified_at from technician_certifications tc
      where tc.tenant_id = ${T} and tc.technician_id = ${m.technicianId} order by tc.expires_at asc nulls last, tc.id`.execute(this.db)).rows : [];
    const staffCerts = m.userId ? (await sql<any>`select s.id, s.name, s.issuer, to_char(s.issued_on, 'YYYY-MM-DD') as issued_on, to_char(s.expires_on, 'YYYY-MM-DD') as expires_on, s.verification_status, s.version from team_staff_certifications s where s.tenant_id = ${T} and s.user_id = ${m.userId} order by s.expires_on asc nulls last, s.id`.execute(this.db)).rows : [];
    const certState = (status: string, exp: string | null) => (status === 'REVOKED' ? 'revoked' : status === 'REJECTED' ? 'rejected' : exp && exp < today ? 'expired'
      : exp && Date.parse(exp) - Date.parse(today) <= EXPIRING_DAYS * 86_400_000 ? 'expiring' : 'valid');
    return { memberId: m.memberId, technicianId: m.technicianId, configured: N(conf?.n) > 0, today, canManage: canAny(ctx, ...MANAGE), canVerify: canAny(ctx, ...VERIFY),
      assignments: rows.map((a: any) => { const exp = ymd(a.expires_on); return { id: String(a.id), courseId: String(a.course_id), course: String(a.course), status: effectiveStatus(String(a.status), exp, today), storedStatus: String(a.status),
        dueDate: ymd(a.due_date), assignedAt: iso(a.assigned_at), startedAt: iso(a.started_at), completedOn: ymd(a.completed_on), expiresOn: exp, canceledAt: iso(a.canceled_at), cancelReason: a.cancel_reason ?? null,
        version: N(a.version), certificationName: a.certification_name ?? null, linkedCertification: a.technician_certification_id ? { kind: 'technician', id: String(a.technician_certification_id) } : a.staff_certification_id ? { kind: 'staff', id: String(a.staff_certification_id) } : null,
        actions: (Object.keys(TRAINING_TRANSITIONS) as TrainingAction[]).filter((k) => k !== 'expire' && TRAINING_TRANSITIONS[k].from.includes(String(a.status) as TStatus)),
        history: ev.filter((e: any) => String(e.assignment_id) === String(a.id)).slice(0, 8).map((e: any) => ({ type: String(e.event_type), from: e.from_status ?? null, to: e.to_status ?? null, reason: e.reason ?? null, at: iso(e.created_at), actor: e.actor ?? null })) }; }),
      certifications: [
        ...techCerts.map((c: any) => { const exp = ymd(c.expires_at); const v = String(c.verification_status ?? 'UNVERIFIED').toUpperCase();
          return { id: String(c.id), kind: 'technician', name: String(c.name ?? ''), issuer: c.issuer ?? null, issuedOn: ymd(c.issued_at), expiresOn: exp, verification: v, verified: v === 'VERIFIED', state: certState(v, exp), version: null }; }),
        ...staffCerts.map((c: any) => { const exp = ymd(c.expires_on); const v = String(c.verification_status);
          return { id: String(c.id), kind: 'staff', name: String(c.name), issuer: c.issuer ?? null, issuedOn: ymd(c.issued_on), expiresOn: exp, verification: v, verified: v === 'VERIFIED', state: certState(v, exp), version: N(c.version) }; }),
      ] };
  }

  // ── assignments ───────────────────────────────────────────────────────────────────────────────────────────────
  async assign(ctx: TeamCtx, b: { memberId?: unknown; courseId?: unknown; dueDate?: unknown }, requestId: string) {
    await this.mustManage(ctx, 'assign', requestId); const T = ctx.tenantId;
    const m = await resolveMember(this.db, ctx, String(b.memberId ?? ''));
    if (!m.current) throw err(422, 'MEMBER_NOT_CURRENT', 'That team member is no longer current.');
    const courseId = String(b.courseId ?? ''); if (!UUID.test(courseId)) throw err(404, 'COURSE_NOT_FOUND', 'That training is not in this salon.');
    const due = b.dueDate == null || b.dueDate === '' ? null : String(b.dueDate); if (due && !YMD.test(due)) throw err(422, 'DATE_INVALID', 'Use a real due date.');
    const c = (await sql<any>`select c.id, c.name, c.status from team_training_courses c where c.tenant_id = ${T} and c.id = ${courseId}`.execute(this.db)).rows[0];
    if (!c) throw err(404, 'COURSE_NOT_FOUND', 'That training is not in this salon.');
    if (c.status !== 'active') throw err(422, 'COURSE_ARCHIVED', 'That training is archived.');
    const open = (await sql<any>`select a.id from team_training_assignments a where a.tenant_id = ${T} and a.course_id = ${courseId} and a.status in ('assigned', 'in_progress')
      and coalesce(a.user_id, a.technician_id) = ${m.userId ?? m.technicianId}::uuid`.execute(this.db)).rows[0];
    if (open) throw err(409, 'ALREADY_ASSIGNED', 'That training is already assigned to this team member.', { assignmentId: String(open.id) });
    const id = await this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`insert into team_training_assignments (tenant_id, branch_id, course_id, user_id, technician_id, due_date, assigned_by)
        values (${T}, ${m.branchId ?? branchOf(ctx)}, ${courseId}, ${m.userId}, ${m.userId ? null : m.technicianId}, ${due}::date, ${ctx.userId || null}::uuid) returning id`.execute(trx)).rows[0];
      await sql`insert into team_training_events (tenant_id, assignment_id, course_id, event_type, to_status, actor_user_id, metadata_json, request_id)
        values (${T}, ${r.id}, ${courseId}, 'ASSIGNED', 'assigned', ${ctx.userId || null}::uuid, ${JSON.stringify({ dueDate: due })}::jsonb, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'team.training.assigned', resourceType: 'team_training_assignment', resourceId: String(r.id), summary: `Training assigned: ${c.name}`,
        after: { status: 'assigned', courseId, memberId: m.memberId, dueDate: due }, requestId });
      return String(r.id);
    });
    return this.assignment(ctx, id);
  }
  private async assignment(ctx: TeamCtx, id: string) {
    const a = (await sql<any>`select a.id, a.status, a.version, to_char(a.completed_on, 'YYYY-MM-DD') as completed_on, to_char(a.expires_on, 'YYYY-MM-DD') as expires_on, a.user_id, a.technician_id from team_training_assignments a where a.tenant_id = ${ctx.tenantId} and a.id = ${id}`.execute(this.db)).rows[0];
    return { id, status: String(a.status), version: N(a.version), completedOn: ymd(a.completed_on), expiresOn: ymd(a.expires_on), memberId: String(a.user_id ?? a.technician_id) };
  }
  async act(ctx: TeamCtx, id: string, action: TrainingAction, b: { expectedVersion?: unknown; completedOn?: unknown; note?: unknown; reason?: unknown }, requestId: string) {
    if (action !== 'expire') await this.mustManage(ctx, action, requestId);
    const T = ctx.tenantId; if (!UUID.test(String(id))) throw err(404, 'ASSIGNMENT_NOT_FOUND', 'That training record is not in this salon.');
    const expected = Number(b.expectedVersion); if (!Number.isInteger(expected) || expected < 1) throw err(400, 'EXPECTED_VERSION_REQUIRED', 'Reload and try again.');
    const today = await this.today(ctx);
    const reason = text(b.reason ?? b.note, 1000);
    if (action === 'cancel' && reason.length < 5) throw err(422, 'REASON_REQUIRED', 'Say why (at least 5 characters).');
    const on = b.completedOn == null || b.completedOn === '' ? today : String(b.completedOn);
    if (action === 'complete' && (!YMD.test(on) || on > today)) throw err(422, 'DATE_INVALID', 'The completion date cannot be in the future.');
    await this.db.transaction().execute(async (trx) => {
      const a = (await sql<any>`select a.id, a.course_id, a.user_id, a.technician_id, a.status, a.started_at, to_char(a.expires_on, 'YYYY-MM-DD') as expires_on, a.version, c.validity_months, c.name as course from team_training_assignments a join team_training_courses c on c.id = a.course_id and c.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and a.id = ${id} for update of a`.execute(trx)).rows[0];
      if (!a) throw err(404, 'ASSIGNMENT_NOT_FOUND', 'That training record is not in this salon.');
      if (N(a.version) !== expected) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this training record. Reload.', { currentVersion: N(a.version), currentStatus: String(a.status) });
      const t = TRAINING_TRANSITIONS[action]; const from = String(a.status) as TStatus;
      if (!t.from.includes(from)) throw err(422, 'INVALID_TRANSITION', `A ${from.replace('_', ' ')} training cannot do that.`, { status: from });
      const v = expected + 1;
      let moved: { numAffectedRows?: bigint };   // the row is locked; 0 rows here means the machine refused the move
      if (action === 'start') moved = await sql`update team_training_assignments a set status = 'in_progress', started_at = now(), version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_TRAINING_ASSIGNMENT, t.to, 'a')}`.execute(trx);
      else if (action === 'complete') {
        const exp = a.validity_months == null ? null : addMonths(on, N(a.validity_months));
        moved = await sql`update team_training_assignments a set status = 'completed', started_at = coalesce(a.started_at, now()), completed_at = now(), completed_on = ${on}::date, expires_on = ${exp}::date,
          completion_note = ${reason || null}, version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_TRAINING_ASSIGNMENT, t.to, 'a')}`.execute(trx);
      } else if (action === 'cancel') moved = await sql`update team_training_assignments a set status = 'canceled', canceled_at = now(), cancel_reason = ${reason}, version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_TRAINING_ASSIGNMENT, t.to, 'a')}`.execute(trx);
      else {
        if (!(a.expires_on && ymd(a.expires_on)! < today)) throw err(422, 'NOT_EXPIRED', 'That training has not expired.');
        moved = await sql`update team_training_assignments a set status = 'expired', expired_at = now(), version = ${v}, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${id} and ${canMoveToSql(TEAM_TRAINING_ASSIGNMENT, t.to, 'a')}`.execute(trx);
      }
      if (moved.numAffectedRows === 0n) throw err(409, 'INVALID_STATE_TRANSITION', `A ${from.replace('_', ' ')} training cannot move to ${t.to.replace('_', ' ')}.`, { status: from });
      await sql`insert into team_training_events (tenant_id, assignment_id, course_id, event_type, from_status, to_status, actor_user_id, reason, metadata_json, request_id)
        values (${T}, ${id}, ${a.course_id}, ${t.event}, ${from}, ${t.to}, ${ctx.userId || null}::uuid, ${reason || null}, ${JSON.stringify({ version: v, ...(action === 'complete' ? { completedOn: on } : {}) })}::jsonb, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: `team.training.${action === 'expire' ? 'expired' : action}`, resourceType: 'team_training_assignment', resourceId: id,
        summary: `Training ${a.course}: ${from} → ${t.to}`, before: { status: from, version: expected }, after: { status: t.to, version: v }, reason: reason || null, requestId });
    });
    return this.assignment(ctx, id);
  }
  /** the nightly sweep: persist expiry of completions whose validity has passed (idempotent; each one audited) */
  async expireDue(ctx: TeamCtx, requestId: string): Promise<number> {
    const today = await this.today(ctx);
    const due = (await sql<any>`select a.id, a.version from team_training_assignments a where a.tenant_id = ${ctx.tenantId} and a.status = 'completed' and a.expires_on < ${today}::date order by a.id limit 500`.execute(this.db)).rows;
    let n = 0;
    for (const r of due) { await this.act(ctx, String(r.id), 'expire', { expectedVersion: N(r.version) }, requestId); n++; }
    return n;
  }

  // ── certifications ────────────────────────────────────────────────────────────────────────────────────────────
  async addCertification(ctx: TeamCtx, b: { memberId?: unknown; name?: unknown; issuer?: unknown; credentialRef?: unknown; issuedOn?: unknown; expiresOn?: unknown; assignmentId?: unknown }, requestId: string) {
    await this.mustManage(ctx, 'certification.add', requestId); const T = ctx.tenantId;
    const m: MemberRef = await resolveMember(this.db, ctx, String(b.memberId ?? ''));
    const name = text(b.name, 120); if (name.length < 2) throw err(422, 'NAME_REQUIRED', 'Name the certification.');
    const issued = b.issuedOn ? String(b.issuedOn) : null; const exp = b.expiresOn ? String(b.expiresOn) : null;
    if ((issued && !YMD.test(issued)) || (exp && !YMD.test(exp)) || (issued && exp && exp < issued)) throw err(422, 'DATE_INVALID', 'Check the issue and expiry dates.');
    const asg = b.assignmentId ? String(b.assignmentId) : null;
    if (asg) { const ok = (await sql<any>`select a.id from team_training_assignments a where a.tenant_id = ${T} and a.id = ${asg}::uuid and coalesce(a.user_id, a.technician_id) = ${m.userId ?? m.technicianId}::uuid`.execute(this.db)).rows[0];
      if (!ok) throw err(404, 'ASSIGNMENT_NOT_FOUND', 'That training record is not this team member\'s.'); }
    const out = await this.db.transaction().execute(async (trx) => {
      let kind: 'technician' | 'staff'; let certId: string;
      if (m.technicianId) {
        // the canonical, portable technician record (584) — UNVERIFIED until a verifier checks it (existing verify route)
        const gp = (await sql<any>`select t.global_tech_profile_id from technicians t where t.tenant_id = ${T} and t.id = ${m.technicianId}`.execute(trx)).rows[0];
        certId = String((await sql<any>`insert into technician_certifications (tenant_id, global_tech_profile_id, technician_id, name, issuer, issued_at, expires_at, verification_status, created_by_user_id)
          values (${T}, ${gp?.global_tech_profile_id ?? null}, ${m.technicianId}, ${name}, ${text(b.issuer, 120) || null}, ${issued}::date, ${exp}::date, 'UNVERIFIED', ${ctx.userId || null}::uuid) returning id`.execute(trx)).rows[0].id);
        kind = 'technician';
        if (asg) await sql`update team_training_assignments a set technician_certification_id = ${certId}, version = a.version + 1, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${asg}::uuid`.execute(trx);
      } else {
        certId = String((await sql<any>`insert into team_staff_certifications (tenant_id, user_id, name, issuer, credential_ref, issued_on, expires_on, created_by)
          values (${T}, ${m.userId}, ${name}, ${text(b.issuer, 120) || null}, ${text(b.credentialRef, 120) || null}, ${issued}::date, ${exp}::date, ${ctx.userId || null}::uuid) returning id`.execute(trx)).rows[0].id);
        kind = 'staff';
        if (asg) await sql`update team_training_assignments a set staff_certification_id = ${certId}, version = a.version + 1, updated_by = ${actorOf(ctx)}::uuid, updated_at = now() where a.tenant_id = ${T} and a.id = ${asg}::uuid`.execute(trx);
      }
      await sql`insert into team_training_events (tenant_id, assignment_id, event_type, actor_user_id, metadata_json, request_id) values (${T}, ${asg}::uuid, 'CERTIFICATION_RECORDED', ${ctx.userId || null}::uuid,
        ${JSON.stringify({ kind, certificationId: certId, verification: 'UNVERIFIED' })}::jsonb, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'team.training.certification.recorded', resourceType: kind === 'technician' ? 'technician_certification' : 'team_staff_certification', resourceId: certId,
        summary: `Certification recorded (unverified): ${name}`, after: { verification: 'UNVERIFIED', expiresOn: exp, memberId: m.memberId }, requestId });
      return { id: certId, kind, verification: 'UNVERIFIED' };
    });
    return out;
  }
  async verifyStaffCertification(ctx: TeamCtx, id: string, b: { expectedVersion?: unknown; decision?: unknown; note?: unknown }, requestId: string) {
    if (!canAny(ctx, ...VERIFY)) await this.denied(ctx, 'certification.verify', requestId, 'You do not have permission to verify certifications.');
    const T = ctx.tenantId; if (!UUID.test(String(id))) throw err(404, 'CERTIFICATION_NOT_FOUND', 'That certification is not in this salon.');
    const decision = ['VERIFIED', 'REJECTED', 'REVOKED'].includes(String(b.decision)) ? String(b.decision) : null; if (!decision) throw err(422, 'DECISION_INVALID', 'Choose verified, rejected or revoked.');
    const note = text(b.note, 1000); if (note.length < 5) throw err(422, 'REASON_REQUIRED', 'Say what you checked (at least 5 characters).');
    return this.db.transaction().execute(async (trx) => {
      const c = (await sql<any>`select s.id, s.user_id, s.name, s.verification_status, s.version from team_staff_certifications s where s.tenant_id = ${T} and s.id = ${id} for update`.execute(trx)).rows[0];
      if (!c) throw err(404, 'CERTIFICATION_NOT_FOUND', 'That certification is not in this salon.');
      if (N(c.version) !== Number(b.expectedVersion)) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this certification. Reload.', { currentVersion: N(c.version) });
      const from = String(c.verification_status);
      const okFrom = decision === 'REVOKED' ? from === 'VERIFIED' : from === 'UNVERIFIED';
      if (!okFrom) throw err(422, 'INVALID_TRANSITION', `A ${from.toLowerCase()} certification cannot be ${decision.toLowerCase()}.`);
      if (c.user_id === ctx.userId) throw err(403, 'SELF_VERIFY', 'Someone else must verify your own certification.');
      const moved = await sql`update team_staff_certifications s set verification_status = ${decision}, verified_by = ${ctx.userId || null}::uuid, verified_at = now(), verification_note = ${note}, version = s.version + 1, updated_by = ${actorOf(ctx)}::uuid, updated_at = now()
        where s.tenant_id = ${T} and s.id = ${id} and ${canMoveToSql(TEAM_STAFF_CERTIFICATION, decision, 's')}`.execute(trx);
      if (moved.numAffectedRows === 0n) throw err(409, 'INVALID_STATE_TRANSITION', `A ${from.toLowerCase()} certification cannot be ${decision.toLowerCase()}.`);
      await sql`insert into team_training_events (tenant_id, event_type, from_status, to_status, actor_user_id, reason, metadata_json, request_id)
        values (${T}, ${decision === 'VERIFIED' ? 'CERTIFICATION_VERIFIED' : 'CERTIFICATION_REJECTED'}, ${from}, ${decision}, ${ctx.userId || null}::uuid, ${note}, ${JSON.stringify({ certificationId: id })}::jsonb, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: `team.training.certification.${decision.toLowerCase()}`, resourceType: 'team_staff_certification', resourceId: id,
        summary: `Certification ${c.name}: ${from} → ${decision}`, before: { verification: from }, after: { verification: decision }, reason: note, requestId });
      return { id, verification: decision, version: N(c.version) + 1 };
    });
  }
}
