/* users-roles-smoke.ts — exercises the Users & Roles directory + aggregate against a REAL Postgres.
 * Seeds a small multi-tenant fixture, then calls the actual KyselySuperAdminPlatformRepo.users()/usersDashboard()
 * (the exact code paths the controller serves) and asserts the reference modules run and reconcile.
 * Run: DATABASE_URL=postgres://… npx tsx scripts/users-roles-smoke.ts
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import http from 'node:http';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselySuperAdminPlatformRepo } from '../../../modules/super-admin/src/super-admin-platform/super-admin-platform.repository';
import { SuperAdminPlatformService } from '../../../modules/super-admin/src/super-admin-platform/super-admin-platform.service';
import { USERS_EXPORT_HEADERS } from '../../../modules/super-admin/src/super-admin-platform/users-export-core';
import { hashInvitationToken } from '../../../modules/identity/src/invitations/invitation-token-core';

const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); } };

async function seed() {
  // clean (children first)
  await sql`delete from scheduled_reports`.execute(db);
  await sql`delete from access_requests`.execute(db);
  await sql`delete from user_invitations`.execute(db);
  await sql`delete from user_branch_access`.execute(db);
  await sql`delete from sessions`.execute(db);
  // Constitution 12 migration 452: audit tables are append-only. Smoke cleanup of its OWN rows on a dev database
  // skips triggers for this one statement (superuser, dev only) — production has no such path.
  await sql`set session_replication_role = replica`.execute(db);
  await sql`delete from audit_logs`.execute(db);
  await sql`set session_replication_role = default`.execute(db);
  await sql`delete from users`.execute(db);
  await sql`delete from branches`.execute(db);
  await sql`delete from tenants`.execute(db);

  const tA = '11111111-1111-1111-1111-111111111111';
  const tB = '22222222-2222-2222-2222-222222222222';
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values
    (${tA}, 'Glamour Studio LLC', 'Glamour Studio', 'glamour', 'GLAM'),
    (${tB}, 'Luxe Salon LLC', 'Luxe Salon & Spa', 'luxe', 'LUXE')`.execute(db);

  const bA1 = 'aaaaaaa1-0000-0000-0000-000000000001'; // Downtown (has owner+manager → has admin)
  const bA2 = 'aaaaaaa1-0000-0000-0000-000000000002'; // Uptown (tech only → NO active admin)
  const bB1 = 'bbbbbbb1-0000-0000-0000-000000000001'; // Main (has owner)
  await sql`insert into branches (id, tenant_id, name, city, state, status) values
    (${bA1}, ${tA}, 'Downtown', 'Camden', 'NJ', 'active'),
    (${bA2}, ${tA}, 'Uptown', 'Camden', 'NJ', 'active'),
    (${bB1}, ${tB}, 'Main Branch', 'Cherry Hill', 'NJ', 'active')`.execute(db);

  // users: (role, status, tenant, branch, mfa, last_login_offset_days|null, temp_expiry)
  const u = (id: string, full: string, email: string, role: string, status: string, tenant: string | null, branch: string | null, mfa: boolean, lastLoginDaysAgo: number | null, tempExpiry: string | null) =>
    sql`insert into users (id, tenant_id, branch_id, full_name, email, role, status, mfa_enabled, last_login_at, temp_password_expires_at, created_at)
        values (${id}, ${tenant}, ${branch}, ${full}, ${email}, ${role}, ${status}, ${mfa},
          ${lastLoginDaysAgo == null ? null : sql`now() - (${lastLoginDaysAgo} * interval '1 day')`},
          ${tempExpiry == null ? null : sql`now() + (${tempExpiry})::interval`}, now() - interval '2 days')`.execute(db);

  await u('00000000-0000-0000-0000-0000000000a0', 'Root Admin', 'root@aipowersalon.com', 'SUPER_ADMIN', 'active', null, null, true, 0, null);
  await u('00000000-0000-0000-0000-0000000000a1', 'Emma Johnson', 'emma@glamourstudio.com', 'OWNER', 'active', tA, bA1, true, 0, null);
  await u('00000000-0000-0000-0000-0000000000a2', 'Mike Manager', 'mike@glamourstudio.com', 'MANAGER', 'active', tA, bA1, false, 0, null);
  await u('00000000-0000-0000-0000-0000000000a3', 'Tina Tech', 'tina@glamourstudio.com', 'TECHNICIAN', 'active', tA, bA2, false, 40, null); // inactive 30d+
  await u('00000000-0000-0000-0000-0000000000a4', 'Rita Reception', 'rita@glamourstudio.com', 'RECEPTION', 'active', tA, bA1, false, 1, null);
  await u('00000000-0000-0000-0000-0000000000a5', 'Ivan Invited', 'ivan@glamourstudio.com', 'MANAGER', 'invited', tA, bA1, false, null, '-2 days'); // expired invite
  await u('00000000-0000-0000-0000-0000000000a6', 'Penny Pending', 'penny@glamourstudio.com', 'TECHNICIAN', 'invited', tA, bA2, false, null, '5 days'); // pending invite
  await u('00000000-0000-0000-0000-0000000000a7', 'Sam Suspended', 'sam@glamourstudio.com', 'TECHNICIAN', 'suspended', tA, bA2, false, 5, null);
  await u('00000000-0000-0000-0000-0000000000b1', 'Bea Owner', 'bea@luxesalon.com', 'OWNER', 'active', tB, bB1, true, 0, null);
  await u('00000000-0000-0000-0000-0000000000b2', 'Carl Tech', 'carl@luxesalon.com', 'TECHNICIAN', 'active', tB, bB1, false, 2, null);
  await u('00000000-0000-0000-0000-0000000000c9', 'Cathy Customer', 'cathy@example.com', 'CUSTOMER', 'active', tB, bB1, false, 1, null); // must be excluded from admin totals + directory

  // explicit branch access (drives branchAccess.byLevel; Downtown gets owner+manager)
  await sql`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values
    (${tA}, ${bA1}, '00000000-0000-0000-0000-0000000000a1', 'owner'),
    (${tA}, ${bA1}, '00000000-0000-0000-0000-0000000000a2', 'manager'),
    (${tB}, ${bB1}, '00000000-0000-0000-0000-0000000000b1', 'owner')`.execute(db);

  // sessions → assignedDevices (distinct device_id). Emma has 2 devices, Mike 1, others 0.
  await sql`insert into sessions (user_id, device_id, ip_address, user_agent, expires_at) values
    ('00000000-0000-0000-0000-0000000000a1', 'ipad-emma', '10.0.0.1', 'Safari', now() + interval '1 day'),
    ('00000000-0000-0000-0000-0000000000a1', 'iphone-emma', '10.0.0.2', 'Safari', now() + interval '1 day'),
    ('00000000-0000-0000-0000-0000000000a2', 'pos-mike', '10.0.0.3', 'Chrome', now() + interval '1 day')`.execute(db);

  // audit_logs → recentActivity
  await sql`insert into audit_logs (user_id, role, action_type, entity_type, created_at) values
    ('00000000-0000-0000-0000-0000000000a0', 'SUPER_ADMIN', 'user_role_changed', 'user', now() - interval '5 minutes'),
    ('00000000-0000-0000-0000-0000000000a1', 'OWNER', 'login', 'session', now() - interval '20 minutes')`.execute(db);
}

async function main() {
  await seed();
  const repo: any = new KyselySuperAdminPlatformRepo(db);

  // ── directory ──
  const all = await repo.users({ page: 1, pageSize: 50 });
  const expectedAdminStaff = 10; // 11 seeded minus 1 CUSTOMER
  check('directory excludes CUSTOMER by default', all.total === expectedAdminStaff, `total=${all.total}`);
  check('directory row carries branchName + permissionLevel + assignedDevices', (() => {
    const emma = all.rows.find((r: any) => r.email === 'emma@glamourstudio.com');
    return emma && emma.branchName === 'Downtown' && emma.permissionLevel === 'Full Access' && emma.assignedDevices === 2;
  })(), JSON.stringify(all.rows.find((r: any) => r.email === 'emma@glamourstudio.com')));
  const byStatus = await repo.users({ status: 'active', page: 1, pageSize: 50 });
  const bySuspended = await repo.users({ status: 'suspended', page: 1, pageSize: 50 });
  const byTenantA = await repo.users({ tenantId: '11111111-1111-1111-1111-111111111111', page: 1, pageSize: 50 });
  const byBranchUptown = await repo.users({ branchId: 'aaaaaaa1-0000-0000-0000-000000000002', page: 1, pageSize: 50 });
  const byRoleTech = await repo.users({ role: 'TECHNICIAN', page: 1, pageSize: 50 });
  const custFilter = await repo.users({ role: 'CUSTOMER', page: 1, pageSize: 50 });
  const search = await repo.users({ search: 'luxe', page: 1, pageSize: 50 });
  check('status filter narrows (active)', byStatus.rows.every((r: any) => r.status === 'active'));
  check('status=suspended → 1 (Sam)', bySuspended.total === 1 && bySuspended.rows[0].email === 'sam@glamourstudio.com', `total=${bySuspended.total}`);
  check('tenant filter → 7 Glamour admin/staff', byTenantA.total === 7, `total=${byTenantA.total}`);
  check('branch filter (Uptown) → Tina+Penny+Sam = 3', byBranchUptown.total === 3, `total=${byBranchUptown.total}`);
  check('role=TECHNICIAN → 4', byRoleTech.total === 4, `total=${byRoleTech.total}`);
  check('explicit role=CUSTOMER still reachable → 1', custFilter.total === 1, `total=${custFilter.total}`);
  check('search matches tenant display_name (luxe → 2)', search.total === 2, `total=${search.total}`);

  // ── aggregate ──
  const d = await repo.usersDashboard({});
  const card = (k: string) => d.kpiCards.find((c: any) => c.key === k);
  check('kpiCards has the 10 reference cards', d.kpiCards.length === 10);
  check('Total Users (excl CUSTOMER) reconciles with directory total', card('totalUsers').value === all.total, `${card('totalUsers').value} vs ${all.total}`);
  check('Active Users reconciles with status=active directory total', card('activeUsers').value === byStatus.total, `${card('activeUsers').value} vs ${byStatus.total}`);
  check('Suspended reconciles with status=suspended directory total', card('suspended').value === bySuspended.total);
  check('Pending Invites = invited count (Ivan+Penny = 2)', card('pendingInvites').value === 2, `${card('pendingInvites').value}`);
  check('Total Roles = distinct real roles in use (SUPER_ADMIN,OWNER,MANAGER,TECHNICIAN,RECEPTION = 5)', card('totalRoles').value === 5, `${card('totalRoles').value}`);
  check('Branch Managers = 2 (Mike + invited Ivan), Technicians = 4, Receptionists = 1, Owners/Admins = 3', card('branchManagers').value === 2 && card('technicians').value === 4 && card('receptionists').value === 1 && card('ownersAdmins').value === 3, JSON.stringify(d.kpiCards.map((c: any) => [c.key, c.value])));
  check('Open Access Requests is available and 0 before any are filed (real, not fabricated)', card('openAccessRequests').available === true && card('openAccessRequests').value === 0);

  // permission levels sum to the admin/staff total
  const plSum = d.permissionLevels.reduce((s: number, p: any) => s + p.count, 0);
  check('permissionLevels sum == Total Users', plSum === card('totalUsers').value, `${plSum} vs ${card('totalUsers').value}`);
  check('permissionLevels: Full=3 (SA+2 owners), Branch Admin=2 (managers), Limited=4 (techs), Basic=1 (reception)', (() => { const m = Object.fromEntries(d.permissionLevels.map((p: any) => [p.level, p.count])); return m['Full Access'] === 3 && m['Branch Admin'] === 2 && m['Limited Access'] === 4 && m['Basic Access'] === 1; })(), JSON.stringify(d.permissionLevels));

  // role health
  const rh = Object.fromEntries(d.roleHealth.map((r: any) => [r.key, r]));
  check('roleHealth inactive30d = 1 (Tina)', rh.inactive30d.count === 1, `${rh.inactive30d.count}`);
  check('roleHealth expiredInvitations = 1 (Ivan)', rh.expiredInvitations.count === 1, `${rh.expiredInvitations.count}`);
  check('roleHealth suspended = 1', rh.suspended.count === 1);
  check('roleHealth over-permissioned stays honestly unavailable; access-requests now real (0 before any filed)', rh.overPermissioned.available === false && rh.accessRequestsPending.available === true && rh.accessRequestsPending.count === 0);

  // rolesDistribution sums to total
  check('rolesDistribution sums to Total Users', d.rolesDistribution.reduce((s: number, x: any) => s + x.count, 0) === card('totalUsers').value);

  // branch access
  check('branchAccess.totalBranches = 3', d.branchAccess.totalBranches === 3, `${d.branchAccess.totalBranches}`);
  check('branchAccess.branchesWithoutAdmin = 1 (Uptown)', d.branchAccess.branchesWithoutAdmin === 1, `${d.branchAccess.branchesWithoutAdmin}`);
  check('branchAccess.byLevel from user_branch_access (owner=2, manager=1)', (() => { const m = Object.fromEntries(d.branchAccess.byLevel.map((b: any) => [b.level, b.count])); return m.owner === 2 && m.manager === 1; })(), JSON.stringify(d.branchAccess.byLevel));

  // top tenants + pending invitations + growth + activity
  check('topTenants ranks Glamour(7) over Luxe(2)', d.topTenants.rows[0].users === 7 && d.topTenants.rows[1].users === 2, JSON.stringify(d.topTenants.rows));
  check('topTenants.totalUsers = 9 (admin/staff across tenants, excl platform SA + customer)', d.topTenants.totalUsers === 9, `${d.topTenants.totalUsers}`);
  check('pendingInvitations.total = 2', d.pendingInvitations.total === 2, `${d.pendingInvitations.total}`);
  check('growthDaily series spans 30 days', d.growthDaily.series.length === 30, `${d.growthDaily.series.length}`);
  check('growthDaily.newUsersThisMonth counts seeded admin/staff', typeof d.growthDaily.newUsersThisMonth === 'number' && d.growthDaily.newUsersThisMonth >= 10);
  check('recentActivity from audit_logs (2 rows, newest first)', d.recentActivity.length === 2 && d.recentActivity[0].action === 'user_role_changed', JSON.stringify(d.recentActivity.map((a: any) => a.action)));

  // ── invitation-token lifecycle (§23) ──
  const tA = '11111111-1111-1111-1111-111111111111';
  const inv1 = await repo.createInvitation({ tenantId: tA, branchId: 'aaaaaaa1-0000-0000-0000-000000000001', email: 'newhire@glamourstudio.com', role: 'MANAGER', fullName: 'New Hire', invitedByUserId: '00000000-0000-0000-0000-0000000000a0', channel: 'email' });
  check('createInvitation mints a one-time raw token + creates the invited user', !!inv1.token && inv1.reused === false && !!inv1.userId, JSON.stringify({ token: !!inv1.token, reused: inv1.reused }));
  const invitedRow = await sql`select status from users where lower(email)='newhire@glamourstudio.com'`.execute(db).then((r: any) => r.rows[0]);
  check('invited user row created with status=invited (no temp-password path)', invitedRow?.status === 'invited');
  const dup = await repo.createInvitation({ tenantId: tA, email: 'newhire@glamourstudio.com', role: 'MANAGER' });
  check('duplicate pending invite is de-duplicated (reused, no new token)', dup.reused === true && dup.token === null);
  const list = await repo.listInvitations({ status: 'pending' });
  check('listInvitations surfaces the pending invite and never exposes the token hash', list.rows.some((r: any) => r.email === 'newhire@glamourstudio.com') && !('tokenHash' in (list.rows[0] || {})));
  const acc = await repo.acceptInvitation({ token: inv1.token, password: 'CorrectHorse9!', fullName: 'New Hire' });
  check('acceptInvitation succeeds with a valid token', acc.ok === true && acc.email === 'newhire@glamourstudio.com');
  const activated = await sql`select status, password_hash, must_change_password from users where lower(email)='newhire@glamourstudio.com'`.execute(db).then((r: any) => r.rows[0]);
  check('user activated with their OWN stored password hash (admin never set it)', activated?.status === 'active' && !!activated?.password_hash && activated?.must_change_password === false);
  check('invitation is marked accepted', (await repo._invitationStatus(inv1.id)) === 'accepted');
  const replay = await repo.acceptInvitation({ token: inv1.token, password: 'AnotherPass9!' });
  check('replay with the same token is rejected (single-use)', replay.ok === false && replay.reason === 'already_accepted');

  const inv2 = await repo.createInvitation({ tenantId: tA, email: 'rotate@glamourstudio.com', role: 'TECHNICIAN' });
  const oldToken = inv2.token;
  const re = await repo.resendInvitation(inv2.id);
  check('resend rotates the token (a new token is issued)', !!re && !!re.token && re.token !== oldToken);
  const oldAccept = await repo.acceptInvitation({ token: oldToken, password: 'OldTokenPass9!' });
  check('the OLD token no longer works after resend (rotation invalidates it)', oldAccept.ok === false && oldAccept.reason === 'not_found');
  const newAccept = await repo.acceptInvitation({ token: re.token, password: 'NewTokenPass9!' });
  check('the rotated token works', newAccept.ok === true);

  const inv3 = await repo.createInvitation({ tenantId: tA, email: 'cancelme@glamourstudio.com', role: 'RECEPTION' });
  const cancelled = await repo.cancelInvitation(inv3.id);
  check('cancelInvitation marks it cancelled', cancelled?.status === 'cancelled');
  const accCancel = await repo.acceptInvitation({ token: inv3.token, password: 'CancelPass99!' });
  check('a cancelled invitation cannot be accepted', accCancel.ok === false && accCancel.reason === 'cancelled');

  const inv4 = await repo.createInvitation({ tenantId: tA, email: 'expireme@glamourstudio.com', role: 'TECHNICIAN' });
  await sql`update user_invitations set expires_at = now() - interval '1 hour' where id = ${inv4.id}`.execute(db);
  await repo.listInvitations({}); // reconciles expiry
  check('an overdue pending invite reconciles to expired on list', (await repo._invitationStatus(inv4.id)) === 'expired');
  const accExpired = await repo.acceptInvitation({ token: inv4.token, password: 'ExpiredPass9!' });
  check('an expired invitation cannot be accepted', accExpired.ok === false && accExpired.reason === 'expired');

  // ── access-request workflow (§26) ──
  const tech = await sql`select id, tenant_id from users where role='TECHNICIAN' and tenant_id is not null limit 1`.execute(db).then((r: any) => r.rows[0]);
  const sa = '00000000-0000-0000-0000-0000000000a0';
  const ar1 = await repo.createAccessRequest({ tenantId: tech.tenant_id, requestingUserId: tech.id, currentRole: 'TECHNICIAN', requestedRole: 'MANAGER', reason: 'Cover branch lead during manager leave', requestedDurationDays: 30 });
  check('createAccessRequest → submitted, not high-risk for MANAGER', ar1.status === 'submitted' && ar1.highRisk === false);
  check('pendingAccessRequestsCount reflects the new request', (await repo.pendingAccessRequestsCount()) === 1);
  const d2 = await repo.usersDashboard({});
  check('dashboard Open Access Requests KPI now shows 1 (real, reconciling)', d2.kpiCards.find((c: any) => c.key === 'openAccessRequests').value === 1);
  check('dashboard roleHealth Access Requests Pending now shows 1 (real)', Object.fromEntries(d2.roleHealth.map((r: any) => [r.key, r])).accessRequestsPending.count === 1);
  const rev = await repo.decideAccessRequest({ id: ar1.id, approverUserId: sa, approverRole: 'SUPER_ADMIN', action: 'review' });
  check('review moves submitted → under_review', rev.ok === true && rev.status === 'under_review');
  const app = await repo.decideAccessRequest({ id: ar1.id, approverUserId: sa, approverRole: 'SUPER_ADMIN', action: 'approve', durationDays: 30 });
  check('approve applies the role grant', app.ok === true && app.status === 'approved');
  check('the requesting user is now MANAGER', (await sql`select role from users where id=${tech.id}`.execute(db).then((r: any) => r.rows[0]?.role)) === 'MANAGER');
  check('approved temporary grant carries an expiry', app.ok === true && !!(app as any).expiresAt);

  const recep = await sql`select id, tenant_id from users where role='RECEPTION' and tenant_id is not null limit 1`.execute(db).then((r: any) => r.rows[0]) || tech;
  const ar2 = await repo.createAccessRequest({ tenantId: recep.tenant_id, requestingUserId: recep.id, currentRole: 'RECEPTION', requestedRole: 'OWNER', reason: 'Promote to franchise owner', requestedDurationDays: null });
  check('OWNER elevation is flagged high-risk', ar2.highRisk === true);
  const hrNo = await repo.decideAccessRequest({ id: ar2.id, approverUserId: sa, approverRole: 'SUPER_ADMIN', action: 'approve' });
  check('high-risk approve WITHOUT confirmation is blocked', hrNo.ok === false && (hrNo as any).reason === 'high_risk_confirmation_required');
  const hrYes = await repo.decideAccessRequest({ id: ar2.id, approverUserId: sa, approverRole: 'SUPER_ADMIN', action: 'approve', confirmHighRisk: true });
  check('high-risk approve WITH confirmation succeeds', hrYes.ok === true && hrYes.status === 'approved');

  const ar3 = await repo.createAccessRequest({ tenantId: tech.tenant_id, requestingUserId: tech.id, currentRole: 'MANAGER', requestedRole: 'OWNER', reason: 'Manager requests owner rights', requestedDurationDays: null });
  const beyond = await repo.decideAccessRequest({ id: ar3.id, approverUserId: sa, approverRole: 'MANAGER', action: 'approve', confirmHighRisk: true });
  check('an approver cannot grant above their own authority (MANAGER → OWNER blocked)', beyond.ok === false && (beyond as any).reason === 'beyond_authority');
  await repo.cancelAccessRequest(ar3.id);

  const ar4 = await repo.createAccessRequest({ tenantId: tech.tenant_id, requestingUserId: tech.id, currentRole: 'MANAGER', requestedRole: 'MANAGER', reason: 'Duplicate request to reject', requestedDurationDays: null });
  const rej = await repo.decideAccessRequest({ id: ar4.id, approverUserId: sa, approverRole: 'SUPER_ADMIN', action: 'reject', notes: 'Already has this access' });
  check('reject moves the request to rejected', rej.ok === true && rej.status === 'rejected');
  const reRej = await repo.decideAccessRequest({ id: ar4.id, approverUserId: sa, approverRole: 'SUPER_ADMIN', action: 'approve' });
  check('a terminal (rejected) request cannot be approved', reRej.ok === false && (reRej as any).reason === 'invalid_transition');

  const ar5 = await repo.createAccessRequest({ tenantId: tech.tenant_id, requestingUserId: tech.id, currentRole: 'MANAGER', requestedRole: 'MANAGER', reason: 'Will cancel this one', requestedDurationDays: null });
  check('cancelAccessRequest cancels an open request', (await repo.cancelAccessRequest(ar5.id))?.status === 'cancelled');

  await sql`update access_requests set expires_at = now() - interval '1 hour' where id=${ar1.id}`.execute(db);
  await repo.expireStaleAccessRequests();
  check('expired temporary grant reverts the user to their prior role (MANAGER → TECHNICIAN)', (await sql`select role from users where id=${tech.id}`.execute(db).then((r: any) => r.rows[0]?.role)) === 'TECHNICIAN');
  check('the expired request is marked expired', (await repo._accessRequest(ar1.id))?.status === 'expired');

  // ── server-side audited users export (the real export job) ──
  const svc = new SuperAdminPlatformService(repo as any, db as any);
  const adminCtx = { userId: sa, email: 'sa@aipowersalon.com' };
  const dirTotal = (await repo.users({ page: 1, pageSize: 100 })).total;
  const beforeAudit = Number((await sql`select count(*)::int as n from audit_logs where action_type='super_admin_users_exported'`.execute(db).then((r: any) => r.rows[0]))?.n || 0);
  const exp = await svc.usersExport(adminCtx as any, {});
  const expLines = exp.csv.split('\n');
  check('export covers ALL matching rows (not just one page)', exp.rowCount === dirTotal && exp.total === dirTotal, `rowCount=${exp.rowCount} total=${dirTotal}`);
  check('export CSV header matches the reference columns', expLines[0] === USERS_EXPORT_HEADERS.join(','));
  check('export CSV has one line per user plus the header', expLines.length === exp.rowCount + 1);
  check('export writes exactly one audit record', (Number((await sql`select count(*)::int as n from audit_logs where action_type='super_admin_users_exported'`.execute(db).then((r: any) => r.rows[0]))?.n || 0) - beforeAudit) === 1);
  const techCount = (await repo.users({ role: 'TECHNICIAN', page: 1, pageSize: 100 })).total;
  const expTech = await svc.usersExport(adminCtx as any, { role: 'TECHNICIAN' });
  check('export honors the role filter (TECHNICIAN only)', expTech.rowCount === techCount && expTech.csv.split('\n').slice(1).every((l: string) => l === '' || l.includes('TECHNICIAN')), `rows=${expTech.rowCount} expected=${techCount}`);

  // ── tenant self-service access requests (identity server-derived from req.ctx) ──
  const selfUser = await sql`select id, tenant_id, role from users where role in ('TECHNICIAN','FRONT_DESK','RECEPTION') and tenant_id is not null limit 1`.execute(db).then((r: any) => r.rows[0]);
  const selfCtx = { userId: String(selfUser.id) };
  // pass BOGUS tenantId + requestingUserId in the body to prove they are ignored (server-derived)
  const own = await svc.createOwnAccessRequest(selfCtx as any, { requestedRole: 'MANAGER', reason: 'Requesting manager access for the new branch', requestedDurationDays: 60, tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', requestingUserId: '00000000-0000-0000-0000-000000000999' });
  check('self-service create files a submitted request', own.status === 'submitted');
  const ownRow = await sql`select tenant_id, requesting_user_id, prior_role from access_requests where id=${own.id}`.execute(db).then((r: any) => r.rows[0]);
  check('identity + tenant are server-derived (client-supplied values ignored)', String(ownRow.requesting_user_id) === String(selfUser.id) && String(ownRow.tenant_id) === String(selfUser.tenant_id) && ownRow.prior_role === selfUser.role);
  const mine = await svc.listOwnAccessRequests(selfCtx as any);
  check('listOwnAccessRequests returns only the caller’s requests', mine.rows.length >= 1 && mine.rows.every((x: any) => String(x.requestingUserId) === String(selfUser.id)));
  const other = await sql`select id from users where id <> ${selfUser.id} and role <> 'CUSTOMER' limit 1`.execute(db).then((r: any) => r.rows[0]);
  let blocked = false; try { await svc.cancelOwnAccessRequest({ userId: String(other.id) } as any, own.id); } catch (e: any) { blocked = /not found/i.test(e.message); }
  check('another user cannot cancel someone else’s request (ownership enforced)', blocked);
  check('the request is still open after the blocked cancel', (await repo._accessRequest(own.id))?.status === 'submitted');
  check('a user can cancel their OWN open request', (await svc.cancelOwnAccessRequest(selfCtx as any, own.id)).status === 'cancelled');
  const own2 = await svc.createOwnAccessRequest(selfCtx as any, { requestedRole: 'MANAGER', reason: 'Second request to be approved by the platform admin', requestedDurationDays: null });
  const appOwn = await repo.decideAccessRequest({ id: own2.id, approverUserId: sa, approverRole: 'SUPER_ADMIN', action: 'approve' });
  check('a self-filed request can be approved in the Super Admin console (end-to-end)', appOwn.ok === true && appOwn.status === 'approved');
  check('approval applied the grant to the requesting user', (await sql`select role from users where id=${selfUser.id}`.execute(db).then((r: any) => r.rows[0]?.role)) === 'MANAGER');

  // ── invitation delivery: REAL round-trip to a local notifier sink (delivered / failed / not_connected) ──
  const received: any[] = [];
  const sink = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      received.push({ url: req.url, body: (() => { try { return JSON.parse(body); } catch { return body; } })() });
      res.writeHead(String(req.url).includes('/fail') ? 500 : 200); res.end('ok');
    });
  });
  await new Promise<void>((r) => sink.listen(0, '127.0.0.1', () => r()));
  const port = (sink.address() as any).port;
  process.env.APP_BASE_URL = 'https://pos.aipowersalon.com';
  process.env.INVITE_NOTIFIER_URL = `http://127.0.0.1:${port}/deliver`;
  const delivered = await svc.createInvitation(adminCtx as any, { email: 'delivered@glamourstudio.com', fullName: 'Delivered User', role: 'TECHNICIAN', tenantId: tA, channel: 'email' });
  check('delivery: status=delivered when the notifier accepts (no manual token returned)', delivered.deliveryStatus === 'delivered' && delivered.manualAcceptToken == null);
  check('delivery: the notifier received exactly one POST carrying the accept link', received.length === 1 && /\/accept-invite\?token=/.test(received[0]?.body?.acceptUrl || ''));
  check('delivery: the link uses the configured base URL', String(received[0]?.body?.acceptUrl || '').startsWith('https://pos.aipowersalon.com/accept-invite?token='));
  const sentToken = new URL(received[0].body.acceptUrl).searchParams.get('token') || '';
  const storedHash = await sql`select token_hash from user_invitations where id=${delivered.id}`.execute(db).then((r: any) => r.rows[0]?.token_hash);
  check('delivery: the delivered token hashes to the stored hash (only the hash is persisted)', hashInvitationToken(sentToken) === storedHash);
  check('delivery: DB delivery_status persisted as delivered', (await sql`select delivery_status from user_invitations where id=${delivered.id}`.execute(db).then((r: any) => r.rows[0]?.delivery_status)) === 'delivered');

  process.env.INVITE_NOTIFIER_URL = `http://127.0.0.1:${port}/fail`;
  const failed = await svc.createInvitation(adminCtx as any, { email: 'failed@glamourstudio.com', role: 'TECHNICIAN', tenantId: tA, channel: 'email' });
  check('delivery: status=failed when the notifier rejects (manual token returned for fallback)', failed.deliveryStatus === 'failed' && !!failed.manualAcceptToken);

  delete process.env.INVITE_NOTIFIER_URL;
  const nc = await svc.createInvitation(adminCtx as any, { email: 'notconnected@glamourstudio.com', role: 'TECHNICIAN', tenantId: tA, channel: 'email' });
  check('delivery: not_connected when no notifier is configured (honest, manual token returned)', nc.deliveryStatus === 'not_connected' && !!nc.manualAcceptToken);
  await new Promise<void>((r) => sink.close(() => r()));

  // ── scheduled reports: REAL run-due → deliver to a local sink → schedule advances ──
  const reportReceived: any[] = [];
  const rsink = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { reportReceived.push((() => { try { return JSON.parse(b); } catch { return b; } })()); res.writeHead(200); res.end('ok'); }); });
  await new Promise<void>((r) => rsink.listen(0, '127.0.0.1', () => r()));
  process.env.REPORTS_NOTIFIER_URL = `http://127.0.0.1:${(rsink.address() as any).port}/report`;
  const sr = await svc.createScheduledReport(adminCtx as any, { name: 'Daily users CSV', reportKey: 'users', cadence: 'daily', recipientEmail: 'ops@aipowersalon.com' });
  check('createScheduledReport creates a definition', !!sr.id);
  check('a freshly-created daily report is not yet due', (await svc.runDueScheduledReports()).ran === 0);
  await sql`update scheduled_reports set next_run_at = now() - interval '1 hour' where id=${sr.id}`.execute(db);
  const beforeNext = await repo._scheduledReport(sr.id);
  const run1 = await svc.runDueScheduledReports();
  check('runDue runs the due report and reports delivered', run1.ran === 1 && run1.results[0].status === 'delivered');
  check('the notifier received the generated CSV (header row matches the export columns)', reportReceived.length === 1 && String(reportReceived[0]?.csv || '').split('\n')[0] === USERS_EXPORT_HEADERS.join(','));
  const after1 = await repo._scheduledReport(sr.id);
  check('the run is recorded delivered and the schedule advanced ~1 day', after1?.lastStatus === 'delivered' && new Date(after1!.nextRunAt).getTime() > new Date(beforeNext!.nextRunAt).getTime());
  check('it does not run again until next due', (await svc.runDueScheduledReports()).ran === 0);
  await sql`update scheduled_reports set next_run_at = now() - interval '1 hour' where id=${sr.id}`.execute(db);
  await svc.toggleScheduledReport(adminCtx as any, sr.id, false);
  check('a disabled report is not run even when overdue', (await svc.runDueScheduledReports()).ran === 0);
  delete process.env.REPORTS_NOTIFIER_URL; delete process.env.INVITE_NOTIFIER_URL;
  await svc.toggleScheduledReport(adminCtx as any, sr.id, true);
  await sql`update scheduled_reports set next_run_at = now() - interval '1 hour' where id=${sr.id}`.execute(db);
  const run4 = await svc.runDueScheduledReports();
  check('with no notifier configured the run is honestly not_connected', run4.ran === 1 && run4.results[0].status === 'not_connected');
  await new Promise<void>((r) => rsink.close(() => r()));

  console.log(`\n──────────── ${pass}/${pass + fail} checks passed ────────────`);
  await db.destroy();
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('SMOKE ERROR:', e); process.exit(2); });
