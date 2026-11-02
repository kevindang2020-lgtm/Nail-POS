// team-staff.pgtest — Team Management round 2 (Four-Module Completion Guide §10 / §17, 30 Oct 2026, migration 727) against the
// REAL schema:
//   TM-06  all-role onboarding: front desk cannot add staff (403, audited); a manager cannot add a manager, an owner or a
//          platform role; a manager adds a receptionist (one canonical user, invited, branch access, no technician-only data)
//          who appears on page 1 of the directory as a receptionist; idempotent retry returns the same member; a reused key
//          with another body and a duplicate e-mail / phone are refused; an owner may add a manager; branch scope holds.
//   TM-07  nightly scan: orphaned assignments + missing branch association found; a rerun for the same salon-local date is
//          a no-op; the next date dedupes (seen_count / last_seen_at / last_run_id move, the reviewer's decision does not);
//          failures are recorded and escalate once; nothing the alerts point at is changed; the scheduler enqueues once.
//   TM-08  birthdays: month/day validation (Feb 29 valid, shown Feb 28 in a non-leap year), privacy (hidden from colleagues
//          unless shared; managers see), only a manager or the member edits, "not recorded" only when absent.
//   TM-09  training: lifecycle with versions / transitions / history, expiry (read-time and persisted by the sweep), and
//          completion ≠ verified certification; a technician's certification is the 584 record (linked, not copied).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import { TeamOnboardingRepository, type DeliverPort } from './team-onboarding.repository';
import { TeamBirthdaysRepository, validMonthDay, nextOccurrence } from './team-birthdays.repository';
import { TeamTrainingRepository } from './team-training.repository';
import { runTeamDataNightly, enqueueDueNightly, TEAM_DATA_NIGHTLY_JOB } from './team-data-nightly';
import { TeamDataAlertsRepository } from '../team-screens/team-data-alerts.repository';
import { TeamMembersScreenRepository } from '../team-screens/team-members-screen.repository';

const P = 'fb720000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b9');
const OWNER = id('e1'), MGR = id('e2'), DESK = id('e3'), GONE = id('e6'), T2_U = id('e7');
const ANNA = id('c1'), ARCH = id('c2'), LOST = id('c3');
const perms = (r: string) => [...((ROLE_PERMISSIONS as Record<string, readonly string[]>)[r] ?? [])];
const owner = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: [...perms('OWNER'), 'pos.technicians.view'] };
const mgr = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: [...perms('MANAGER'), 'pos.technicians.view'] };
const desk = { tenantId: T, branchId: B, userId: DESK, role: 'FRONT_DESK', permissions: [...perms('FRONT_DESK'), 'pos.technicians.view'] };
const other = { tenantId: T2, branchId: BX, userId: T2_U, role: 'MANAGER', permissions: mgr.permissions };
let pg: any; let db: any; let onboarding: TeamOnboardingRepository; let birthdays: TeamBirthdaysRepository; let training: TeamTrainingRepository; let alerts: TeamDataAlertsRepository;
const sent: any[] = [];
const fakeDeliver: DeliverPort = { async deliver(i) { sent.push(i); return { deliveryStatus: 'not_connected', manualToken: 'manual-token-for-test' }; } };
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e: any) { return { status: e?.getStatus?.() ?? e?.status, code: e?.response?.code ?? e?.code, body: e?.response }; } throw new Error('expected a failure'); };
let today = '';

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','ts-a','TSA001','active'), ($2,'Other LLC','Other','ts-b','TSB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Second','active','America/New_York'), ($4,$5,'Elsewhere','active','America/New_York')`, [B, T, B2, BX, T2]);
  for (const [uid, tenant, name, role, status, phone] of [[OWNER, T, 'Olive Owner', 'OWNER', 'active', '+18565550001'], [MGR, T, 'Mai Manager', 'MANAGER', 'active', '+18565550002'], [DESK, T, 'Vy Desk', 'FRONT_DESK', 'active', '+18565550003'],
    [GONE, T, 'Gone User', 'FRONT_DESK', 'inactive', '+18565550006'], [T2_U, T2, 'Other Boss', 'MANAGER', 'active', '+18565550007']])
    await q(`insert into users (id, tenant_id, branch_id, full_name, email, normalized_phone, role, status) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [uid, tenant, tenant === T ? B : BX, name, name.split(' ')[0].toLowerCase() + '@pilot.test', phone, role, status]);
  const tech = (tid: string, name: string, branch: string | null, status = 'active', archived = false, phone = '+18565557001') =>
    q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label, normalized_phone, archived_at) values ($1,$2,$3,$4,'x',$4,$5,true,'Technician',$6, case when $7 then now() else null end)`,
      [tid, T, branch, name, status, phone, archived]);
  await tech(ANNA, 'Anna Lee', B, 'active', false, '+18565557001'); await tech(ARCH, 'Arch Ived', B, 'archived', true, '+18565557002'); await tech(LOST, 'Lost Branch', id('b7'), 'active', false, '+18565557003');
  today = (await q(`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as t`)).rows[0].t;
  // TM-07 fixtures: an upcoming booking on an archived technician; a role template left on an inactive login; a technician on a branch that is not this salon's
  await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status) values ($1,$2,$3,$4,'Mai Le','[{"name":"Gel"}]'::jsonb, $5::date + 2, '11:00','11:45',45,'booked')`, [id('f1'), T, B, ARCH, today]);
  await q(`insert into staff_role_assignments (tenant_id, user_id, template_key, assigned_by) values ($1,$2,'SUPPORT_STAFF',$3)`, [T, GONE, OWNER]);
  onboarding = new TeamOnboardingRepository(db, fakeDeliver); birthdays = new TeamBirthdaysRepository(db); training = new TeamTrainingRepository(db); alerts = new TeamDataAlertsRepository(db);
}, 180_000);

let rec: any;
describe('TM-06 all-role onboarding', () => {
  it('front desk cannot add staff — 403, and the denial is audited', async () => {
    const f = await fails(onboarding.create(desk, { role: 'receptionist', fullName: 'New Person', email: 'np@pilot.test', idempotencyKey: 'desk-key-0001' }, 'req-1'));
    expect(f).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect((await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'team.staff.onboard.denied' and actor_user_id = $2`, [T, DESK])).rows[0].n).toBe(1);
    expect((await onboarding.options(desk)).canOnboard).toBe(false);
  });
  it('a manager cannot add a manager, an owner-level role or anything unknown', async () => {
    expect(await fails(onboarding.create(mgr, { role: 'manager', fullName: 'Second Manager', email: 'm2@pilot.test', idempotencyKey: 'mgr-key-0001' }, 'r'))).toMatchObject({ status: 403, code: 'ROLE_ABOVE_YOURS' });
    await q(`insert into tenant_custom_roles (id, tenant_id, name, base_role, scope, permissions, created_by) values ($1,$2,'Co-Owner','OWNER','TENANT','["pos.login"]'::jsonb,$3)`, [id('d1'), T, OWNER]);
    expect(await fails(onboarding.create(owner, { role: 'custom:' + id('d1'), fullName: 'Co Owner', email: 'co@pilot.test', idempotencyKey: 'own-key-0001' }, 'r'))).toMatchObject({ status: 422, code: 'ROLE_NOT_GRANTABLE' });
    expect(await fails(onboarding.create(owner, { role: 'owner', fullName: 'Owner Two', email: 'o2@pilot.test', idempotencyKey: 'own-key-0002' }, 'r'))).toMatchObject({ status: 422, code: 'ROLE_UNKNOWN' });
    expect(await fails(onboarding.create(owner, { role: 'SUPER_ADMIN', fullName: 'Platform', email: 'pa@pilot.test', idempotencyKey: 'own-key-0003' }, 'r'))).toMatchObject({ status: 422, code: 'ROLE_UNKNOWN' });
    const o = await onboarding.options(mgr); const by = (k: string) => o.roles.find((r: any) => r.key === k);
    expect(by('manager')).toMatchObject({ allowed: false, reason: 'ROLE_ABOVE_YOURS' }); expect(by('receptionist')).toMatchObject({ allowed: true, flow: 'staff' });
    expect(by('nail_technician')).toMatchObject({ provider: true, flow: 'technician' }); expect(by('custom:' + id('d1'))).toMatchObject({ allowed: false, reason: 'ROLE_NOT_GRANTABLE' });
    expect((await q(`select count(*)::int as n from users where tenant_id = $1`, [T])).rows[0].n).toBe(4);
  });
  it('a manager adds a receptionist: one invited login, branch access, no technician-only data, page 1 of the directory', async () => {
    rec = await onboarding.create(mgr, { role: 'receptionist', fullName: 'Rita Reception', email: 'Rita@Pilot.test', phone: '(856) 555-0101', idempotencyKey: 'mgr-key-rita-1' }, 'req-rita');
    expect(rec).toMatchObject({ role: 'receptionist', accountRole: 'RECEPTION', status: 'invited', replayed: false, technicianRecord: false, branchIds: [B] });
    expect(rec.invite).toMatchObject({ deliveryStatus: 'not_connected' }); expect(rec.invite.acceptUrl).toContain('accept-invite?token=');
    const u = (await q(`select role, status, email, normalized_phone, branch_id from users where id = $1 and tenant_id = $2`, [rec.userId, T])).rows[0];
    expect(u).toMatchObject({ role: 'RECEPTION', status: 'invited', email: 'rita@pilot.test', normalized_phone: '+18565550101', branch_id: B });
    expect((await q(`select count(*)::int as n from technicians where tenant_id = $1 and user_id = $2`, [T, rec.userId])).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int as n from staff_role_assignments where tenant_id = $1 and user_id = $2`, [T, rec.userId])).rows[0].n).toBe(0);
    expect((await q(`select branch_id, access_level from user_branch_access where tenant_id = $1 and user_id = $2`, [T, rec.userId])).rows).toEqual([{ branch_id: B, access_level: 'staff' }]);
    expect((await q(`select job_role from team_staff_profiles where tenant_id = $1 and user_id = $2`, [T, rec.userId])).rows[0].job_role).toBe('receptionist');
    const inv = (await q(`select role, user_id, status, token_hash from user_invitations where tenant_id = $1 and user_id = $2`, [T, rec.userId])).rows;
    expect(inv).toHaveLength(1); expect(inv[0]).toMatchObject({ role: 'RECEPTION', status: 'pending' }); expect(inv[0].token_hash).not.toContain('manual-token');
    expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ channel: 'email', to: 'rita@pilot.test', role: 'RECEPTION' });
    expect((await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'team.staff.onboarded' and resource_id = $2`, [T, rec.userId])).rows[0].n).toBe(1);
    const dir: any = await new TeamMembersScreenRepository(db).directory(mgr, { page: 1, pageSize: 10 });
    expect(dir.items[0]).toMatchObject({ memberId: rec.userId, roles: ['receptionist'], isProvider: false });
  });
  it('a retry with the same key returns the same member; a reused key with another body is refused', async () => {
    const again: any = await onboarding.create(mgr, { role: 'receptionist', fullName: 'Rita Reception', email: 'Rita@Pilot.test', phone: '(856) 555-0101', idempotencyKey: 'mgr-key-rita-1' }, 'req-rita-2');
    expect(again).toMatchObject({ userId: rec.userId, replayed: true });
    expect(sent).toHaveLength(1);
    expect((await q(`select count(*)::int as n from users where tenant_id = $1 and lower(email) = 'rita@pilot.test'`, [T])).rows[0].n).toBe(1);
    expect(await fails(onboarding.create(mgr, { role: 'assistant', fullName: 'Someone Else', email: 'se@pilot.test', idempotencyKey: 'mgr-key-rita-1' }, 'r'))).toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });
  it('one canonical identity: an e-mail or phone already in the salon (login or technician) is refused', async () => {
    const e = await fails(onboarding.create(mgr, { role: 'assistant', fullName: 'Rita Again', email: 'rita@pilot.test', idempotencyKey: 'mgr-key-dup-01' }, 'r'));
    expect(e).toMatchObject({ status: 409, code: 'DUPLICATE_IDENTITY' }); expect(e.body.existingMemberId).toBe(rec.userId);
    const p = await fails(onboarding.create(mgr, { role: 'assistant', fullName: 'Anna Twin', phone: '856.555.7001', idempotencyKey: 'mgr-key-dup-02' }, 'r'));
    expect(p).toMatchObject({ status: 409, code: 'DUPLICATE_IDENTITY' }); expect(p.body).toMatchObject({ existingMemberId: ANNA, existingKind: 'technician' });
  });
  it('branch scope: a manager adds only to their own branch; an owner may add a manager to any branch', async () => {
    expect(await fails(onboarding.create(mgr, { role: 'assistant', fullName: 'Second Branch', email: 'sb@pilot.test', branchIds: [B2], idempotencyKey: 'mgr-key-br-01' }, 'r'))).toMatchObject({ status: 403, code: 'BRANCH_NOT_YOURS' });
    expect(await fails(onboarding.create(owner, { role: 'assistant', fullName: 'Wrong Salon', email: 'ws@pilot.test', branchIds: [BX], idempotencyKey: 'own-key-br-01' }, 'r'))).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    const m: any = await onboarding.create(owner, { role: 'manager', fullName: 'Max Manager', email: 'max@pilot.test', branchIds: [B2], idempotencyKey: 'own-key-mgr-01' }, 'r');
    expect(m).toMatchObject({ accountRole: 'MANAGER', template: 'BRANCH_MANAGER', branchIds: [B2] });
    expect((await q(`select template_key from staff_role_assignments where tenant_id = $1 and user_id = $2`, [T, m.userId])).rows[0].template_key).toBe('BRANCH_MANAGER');
    expect(await fails(onboarding.create(mgr, { role: 'nail_technician', fullName: 'Tech Person', email: 'tp@pilot.test', idempotencyKey: 'mgr-key-tech-1' }, 'r'))).toMatchObject({ status: 422, code: 'USE_TECHNICIAN_FLOW' });
  });
});

describe('TM-08 optional birthdays', () => {
  it('month/day validation — Feb 29 is valid and shown on Feb 28 in a non-leap year', async () => {
    expect(validMonthDay(2, 29)).toBe(true); expect(validMonthDay(2, 30)).toBe(false); expect(validMonthDay(4, 31)).toBe(false); expect(validMonthDay(13, 1)).toBe(false); expect(validMonthDay(0, 5)).toBe(false);
    expect(nextOccurrence(2, 29, '2027-01-10')).toBe('2027-02-28'); expect(nextOccurrence(2, 29, '2028-01-10')).toBe('2028-02-29'); expect(nextOccurrence(1, 5, '2027-01-10')).toBe('2028-01-05');
    expect(await fails(birthdays.set(mgr, rec.userId, { month: 2, day: 30 }, 'r'))).toMatchObject({ status: 422, code: 'BIRTHDAY_INVALID' });
    expect(await fails(birthdays.set(mgr, rec.userId, { month: 13, day: 1 }, 'r'))).toMatchObject({ status: 422, code: 'BIRTHDAY_INVALID' });
  });
  it('"not recorded" only when absent; a private birthday is hidden from colleagues; managers and the member see it', async () => {
    expect(await birthdays.upcoming(mgr)).toMatchObject({ recorded: false, items: [] });
    const soon = (await q(`select extract(month from $1::date + 5)::int as m, extract(day from $1::date + 5)::int as d`, [today])).rows[0];
    await birthdays.set(mgr, rec.userId, { month: soon.m, day: soon.d, visibleToTeam: false }, 'r-bd');
    const forMgr: any = await birthdays.upcoming(mgr);
    expect(forMgr.recorded).toBe(true); expect(forMgr.items).toHaveLength(1); expect(forMgr.items[0]).toMatchObject({ memberId: rec.userId, inDays: 5, private: true });
    expect(forMgr.items[0]).not.toHaveProperty('year');
    expect(await birthdays.upcoming(desk)).toMatchObject({ recorded: false, items: [] });
    expect(await birthdays.get(desk, rec.userId)).toMatchObject({ recorded: false, hidden: true, month: null, day: null, canEdit: false });
    expect(await birthdays.get(mgr, rec.userId)).toMatchObject({ recorded: true, month: soon.m, day: soon.d, visibleToTeam: false });
    const audit = (await q(`select metadata::text as m from audit_events where tenant_id = $1 and action = 'team.staff.birthday.set'`, [T])).rows;
    expect(audit).toHaveLength(1); expect(audit[0].m).not.toContain(`"month"`);
    await birthdays.set(mgr, rec.userId, { month: soon.m, day: soon.d, visibleToTeam: true }, 'r-bd2');
    expect((await birthdays.upcoming(desk) as any).items.map((x: any) => x.memberId)).toEqual([rec.userId]);
  });
  it('only a staff-profile manager or the member edits; another salon cannot see the member', async () => {
    expect(await fails(birthdays.set(desk, rec.userId, { month: 3, day: 3 }, 'r'))).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    const mine: any = await birthdays.set(desk, DESK, { month: 2, day: 29, visibleToTeam: false }, 'r-self');
    expect(mine).toMatchObject({ month: 2, day: 29, canEdit: true });
    expect(await birthdays.get(mgr, DESK)).toMatchObject({ month: 2, day: 29 });
    expect(await fails(birthdays.get(other, rec.userId))).toMatchObject({ status: 404, code: 'MEMBER_NOT_FOUND' });
    await birthdays.set(desk, DESK, { month: null, day: null }, 'r-clear');
    expect(await birthdays.get(desk, DESK)).toMatchObject({ recorded: false, hidden: false });
  });
});

let course: any; let asg: any;
describe('TM-09 training & certification', () => {
  it('"Not configured" until the catalog has a course; front desk cannot manage training', async () => {
    expect(await training.summary(mgr)).toMatchObject({ configured: false });
    expect(await fails(training.createCourse(desk, { name: 'Safety' }, 'r'))).toMatchObject({ status: 403 });
    course = await training.createCourse(mgr, { name: 'Sanitation & Safety', category: 'Compliance', validityMonths: 12, certificationName: 'State sanitation' }, 'r-c');
    expect(course).toMatchObject({ name: 'Sanitation & Safety', validityMonths: 12, status: 'active' });
    expect(await fails(training.createCourse(mgr, { name: 'sanitation & safety' }, 'r'))).toMatchObject({ status: 409, code: 'COURSE_EXISTS' });
    expect(await training.summary(mgr)).toMatchObject({ configured: true, assignments: { assigned: 0, inProgress: 0, completed: 0 } });
  });
  it('lifecycle: assigned → in progress → completed (versioned, append-only history); expiry shown at read time and persisted by the sweep', async () => {
    asg = await training.assign(mgr, { memberId: rec.userId, courseId: course.id, dueDate: today }, 'r-a');
    expect(asg).toMatchObject({ status: 'assigned', version: 1 });
    expect(await fails(training.assign(mgr, { memberId: rec.userId, courseId: course.id }, 'r'))).toMatchObject({ status: 409, code: 'ALREADY_ASSIGNED' });
    const s1: any = await training.act(mgr, asg.id, 'start', { expectedVersion: 1 }, 'r-s');
    expect(s1).toMatchObject({ status: 'in_progress', version: 2 });
    expect(await fails(training.act(mgr, asg.id, 'complete', { expectedVersion: 1 }, 'r'))).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(await fails(training.act(mgr, asg.id, 'cancel', { expectedVersion: 2, reason: 'no' }, 'r'))).toMatchObject({ status: 422, code: 'REASON_REQUIRED' });
    const longAgo = (await q(`select to_char($1::date - 400, 'YYYY-MM-DD') as d`, [today])).rows[0].d;
    const c: any = await training.act(mgr, asg.id, 'complete', { expectedVersion: 2, completedOn: longAgo }, 'r-done');
    expect(c).toMatchObject({ status: 'completed', completedOn: longAgo });
    expect(c.expiresOn < today).toBe(true);
    expect(await fails(training.act(mgr, asg.id, 'start', { expectedVersion: 3 }, 'r'))).toMatchObject({ status: 422, code: 'INVALID_TRANSITION' });
    let m: any = await training.member(mgr, rec.userId);
    expect(m.assignments[0]).toMatchObject({ status: 'expired', storedStatus: 'completed' });
    expect(m.assignments[0].history.map((h: any) => h.type)).toEqual(['COMPLETED', 'STARTED', 'ASSIGNED']);
    expect(await training.summary(mgr)).toMatchObject({ assignments: { completed: 0, expired: 1 } });
    expect(await training.expireDue({ ...mgr, userId: '', role: 'SYSTEM', permissions: [] }, 'r-sweep')).toBe(1);
    expect(await training.expireDue({ ...mgr, userId: '', role: 'SYSTEM', permissions: [] }, 'r-sweep-2')).toBe(0);
    m = await training.member(mgr, rec.userId);
    expect(m.assignments[0]).toMatchObject({ status: 'expired', storedStatus: 'expired' });
    expect(m.assignments[0].history[0].type).toBe('EXPIRED');
    await expect(q(`update team_training_events set reason = 'x' where tenant_id = $1`, [T])).rejects.toThrow(/append-only/);
    await expect(q(`delete from team_training_assignments where tenant_id = $1`, [T])).rejects.toThrow(/never deleted/);
    // a new assignment may follow an expired one (history kept)
    const again: any = await training.assign(mgr, { memberId: rec.userId, courseId: course.id }, 'r-a2');
    expect(again.status).toBe('assigned');
  });
  it('completion is not certification: a certification starts unverified and only a verifier (not the holder) verifies it', async () => {
    const cert: any = await training.addCertification(mgr, { memberId: rec.userId, name: 'State sanitation', issuer: 'NJ Board', expiresOn: '2099-01-01', assignmentId: asg.id }, 'r-cert');
    expect(cert).toMatchObject({ kind: 'staff', verification: 'UNVERIFIED' });
    let sum: any = await training.summary(mgr); expect(sum.staffCertifications).toMatchObject({ verified: 0, unverified: 1 });
    let m: any = await training.member(mgr, rec.userId);
    expect(m.certifications[0]).toMatchObject({ kind: 'staff', verified: false, verification: 'UNVERIFIED' });
    expect(m.assignments.find((a: any) => a.id === asg.id).linkedCertification).toEqual({ kind: 'staff', id: cert.id });
    expect(await fails(training.verifyStaffCertification(desk, cert.id, { expectedVersion: 1, decision: 'VERIFIED', note: 'checked card' }, 'r'))).toMatchObject({ status: 403 });
    expect(await fails(training.verifyStaffCertification({ ...mgr, userId: rec.userId }, cert.id, { expectedVersion: 1, decision: 'VERIFIED', note: 'my own one' }, 'r'))).toMatchObject({ status: 403, code: 'SELF_VERIFY' });
    const v: any = await training.verifyStaffCertification(mgr, cert.id, { expectedVersion: 1, decision: 'VERIFIED', note: 'Checked the license card' }, 'r-v');
    expect(v).toMatchObject({ verification: 'VERIFIED', version: 2 });
    sum = await training.summary(mgr); expect(sum.staffCertifications).toMatchObject({ verified: 1, unverified: 0 });
    m = await training.member(mgr, rec.userId); expect(m.certifications[0].verified).toBe(true);
  });
  it('a technician\'s certification is the canonical technician_certifications record — linked, never copied', async () => {
    const before = (await q(`select count(*)::int as n from team_staff_certifications`)).rows[0].n;
    const c: any = await training.addCertification(mgr, { memberId: ANNA, name: 'Gel Certification', issuer: 'OPI' }, 'r-tc');
    expect(c).toMatchObject({ kind: 'technician', verification: 'UNVERIFIED' });
    expect((await q(`select verification_status, technician_id from technician_certifications where tenant_id = $1 and id = $2`, [T, c.id])).rows[0]).toEqual({ verification_status: 'UNVERIFIED', technician_id: ANNA });
    expect((await q(`select count(*)::int as n from team_staff_certifications`)).rows[0].n).toBe(before);
    expect((await training.member(mgr, ANNA) as any).certifications.map((x: any) => x.kind)).toEqual(['technician']);
    expect(await fails(training.member(other, ANNA))).toMatchObject({ status: 404 });
  });
});

describe('TM-07 nightly data-accuracy job', () => {
  const snapshot = async () => (await q(`select (select string_agg(status || coalesce(technician_id::text, ''), ',' order by id) from pos_tech_appointments)::text as appts,
    (select string_agg(coalesce(branch_id::text, '-') || status, ',' order by id) from technicians)::text as techs, (select string_agg(role || status, ',' order by id) from users)::text as users,
    (select count(*) from staff_role_assignments)::int as roles, (select count(*) from user_branch_access)::int as access`)).rows[0];
  let first: any;
  it('runs the detectors for the salon-local date, records the run, finds orphaned assignments + missing branch — and changes nothing', async () => {
    const before = await snapshot();
    const r = await runTeamDataNightly(db, { tenantId: T, runDate: today });
    expect(r.outcome).toBe('succeeded');
    const run = (await q(`select status, attempts, alert_run_id, summary_json from team_data_nightly_runs where tenant_id = $1 and run_date = $2::date`, [T, today])).rows[0];
    expect(run).toMatchObject({ status: 'succeeded', attempts: 1 }); expect(run.alert_run_id).toBe(r.runId);
    expect((await q(`select run_trigger from team_data_alert_runs where tenant_id = $1 and id = $2`, [T, r.runId])).rows[0].run_trigger).toBe('nightly');
    const list: any = await alerts.list(mgr, { status: 'all', pageSize: 50 });
    const orphan = list.items.filter((a: any) => a.type === 'ORPHANED_ASSIGNMENT');
    expect(orphan.map((a: any) => a.evidence.kind).sort()).toEqual(['appointment', 'role_template']);
    const appt = orphan.find((a: any) => a.evidence.kind === 'appointment');
    expect(appt).toMatchObject({ tenantId: T, branchId: B, category: 'assignments', severity: 'medium', status: 'OPEN', seenCount: 1 });
    expect(appt.remediation).toMatch(/Reassign/); expect(appt.evidencePointers).toEqual(expect.arrayContaining([{ kind: 'appointment', id: id('f1') }]));
    const lost = list.items.find((a: any) => a.type === 'MISSING_BRANCH_ASSOCIATION');
    expect(lost).toMatchObject({ technicianId: LOST, severity: 'high', category: 'branch' });
    first = appt;
    expect(await snapshot()).toEqual(before);
    expect((await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'team.data_alert.scan.nightly'`, [T])).rows[0].n).toBe(1);
  });
  it('a rerun for the same salon-local date is a no-op; the next date dedupes and only refreshes last seen', async () => {
    const n0 = (await q(`select count(*)::int as n from team_data_alerts where tenant_id = $1`, [T])).rows[0].n;
    expect(await runTeamDataNightly(db, { tenantId: T, runDate: today })).toEqual({ outcome: 'already_done' });
    expect((await q(`select count(*)::int as n from team_data_alert_runs where tenant_id = $1 and run_trigger = 'nightly'`, [T])).rows[0].n).toBe(1);
    await alerts.act(mgr, first.id, 'assign', { expectedVersion: 1, assigneeUserId: MGR }, 'r-asg');
    const next = (await q(`select to_char($1::date + 1, 'YYYY-MM-DD') as d`, [today])).rows[0].d;
    const r2 = await runTeamDataNightly(db, { tenantId: T, runDate: next });
    expect(r2.outcome).toBe('succeeded');
    expect((await q(`select count(*)::int as n from team_data_alerts where tenant_id = $1`, [T])).rows[0].n).toBe(n0);
    const after: any = await alerts.detail(mgr, first.id);
    expect(after).toMatchObject({ status: 'ASSIGNED', assigneeUserId: MGR, seenCount: 2, lastRunId: r2.runId });
    expect(Date.parse(after.lastSeenAt) >= Date.parse(first.lastSeenAt)).toBe(true); expect(after.firstSeenAt).toBe(first.firstSeenAt);
    expect(after.history.items.filter((e: any) => e.type === 'DETECTED')).toHaveLength(1);
  });
  it('a failing run is recorded (never silently zero), retried, and escalates once to an in-app alert', async () => {
    const day = (await q(`select to_char($1::date + 2, 'YYYY-MM-DD') as d`, [today])).rows[0].d;
    const boom = async () => { const e: any = new Error('db timeout'); e.code = 'SCAN_TIMEOUT'; throw e; };
    for (let i = 1; i <= 3; i++) await expect(runTeamDataNightly(db, { tenantId: T, runDate: day }, { scan: boom })).rejects.toThrow(/db timeout/);
    const run = (await q(`select status, attempts, last_error, escalated_at from team_data_nightly_runs where tenant_id = $1 and run_date = $2::date`, [T, day])).rows[0];
    expect(run).toMatchObject({ status: 'failed', attempts: 3, last_error: 'SCAN_TIMEOUT' }); expect(run.escalated_at).not.toBeNull();
    const esc = (await alerts.list(mgr, { status: 'all', type: 'DATA_CHECK_JOB_FAILED', pageSize: 10 }) as any).items;
    expect(esc).toHaveLength(1); expect(esc[0]).toMatchObject({ severity: 'high', category: 'job' }); expect(esc[0].evidence).toMatchObject({ failingSince: day, lastError: 'SCAN_TIMEOUT' });
    await expect(runTeamDataNightly(db, { tenantId: T, runDate: day }, { scan: boom })).rejects.toThrow();
    expect((await alerts.list(mgr, { status: 'all', type: 'DATA_CHECK_JOB_FAILED', pageSize: 10 }) as any).items).toHaveLength(1);
    const lr: any = (await alerts.list(mgr, { status: 'all', pageSize: 1 }) as any).lastRun;
    expect(lr.nightly).toMatchObject({ runDate: day, status: 'failed', attempts: 4, lastError: 'SCAN_TIMEOUT', escalated: true });
    // the retry that finally works succeeds for that date
    expect((await runTeamDataNightly(db, { tenantId: T, runDate: day })).outcome).toBe('succeeded');
    await expect(runTeamDataNightly(db, { tenantId: 'nope', runDate: day })).rejects.toThrow(/bad team nightly payload/);
  });
  it('the scheduler enqueues one staggered job per salon per salon-local date on the durable queue', async () => {
    const r1 = await enqueueDueNightly(db, { hour: 0 });
    expect(r1.checked).toBe(2);
    const jobs = (await q(`select tenant_id, idempotency_key, job_class, max_attempts, run_after >= now() - interval '1 minute' as staggered from jobs where job_type = $1 order by tenant_id`, [TEAM_DATA_NIGHTLY_JOB])).rows;
    // T already succeeded today → only T2 is queued
    expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ tenant_id: T2, job_class: 'report', max_attempts: 4, staggered: true }); expect(jobs[0].idempotency_key).toBe(`${T2}:${today}`);
    const r2 = await enqueueDueNightly(db, { hour: 0 });
    expect(r2).toMatchObject({ enqueued: 0, duplicates: 1 });
    expect((await enqueueDueNightly(db, { hour: 24 })).enqueued).toBe(0);
  });
  it('Run Check by hand still works and is permission-gated', async () => {
    expect(await fails(alerts.runCheck(desk, 'r'))).toMatchObject({ status: 403 });
    const r: any = await alerts.runCheck(mgr, 'r-manual'); expect(r).toMatchObject({ trigger: 'manual' }); expect(r.detected).toBe(0);
  });
});
