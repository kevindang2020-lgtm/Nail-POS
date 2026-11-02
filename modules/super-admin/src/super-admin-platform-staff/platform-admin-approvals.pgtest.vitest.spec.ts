// platform-admin-approvals.pgtest — Security Deep Scan §134: platform-admin invitation and platform role change are
// approvable actions. Policy OFF (default) → they run at once as before. Policy ON → a REQUEST; the requester cannot approve
// it; another platform administrator with super_admin.platform_roles.manage approves → it runs (attributed to the requester,
// within the APPROVER's permissions — PlatformApprovals' rule), every step audited.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { PlatformApprovals } from '@aipowersalon/platform';
import { PlatformStaffController } from './platform-staff.controller';
import { KyselyPlatformStaffRepository } from './platform-staff.repository';
import { SuperAdminPlatformController } from '../super-admin-platform/super-admin-platform.controller';
import { PLATFORM_ADMIN_INVITE, PLATFORM_ROLE_CHANGE } from './platform-admin-approvals';

const A = '61616161-6161-4616-8616-616161616161', B = '62626262-6262-4626-8626-626262626262', C = '63636363-6363-4636-8636-636363636363';
const all = platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[];
let db: any; let approvals: PlatformApprovals; let staff: PlatformStaffController; let platform: SuperAdminPlatformController;
const invites: any[] = [];
const req = (userId: string) => ({ ctx: { userId, role: 'SUPER_ADMIN', permissions: all }, ip: '203.0.113.5' });
// the real policy switch (Super Admin → Approvals → policies), audited
const policy = (key: string, on: boolean) => approvals.setPolicy(key, on, 'turning on dual approval for platform admin changes', { userId: A, permissions: all });

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [id, email, role] of [[A, 'a@p.test', 'PLATFORM_SUPER_ADMIN'], [B, 'b@p.test', 'PLATFORM_SUPER_ADMIN'], [C, 'c@p.test', 'PLATFORM_SUPPORT']])
    await pg.query(`insert into users (id, full_name, email, password_hash, status, role, platform_role) values ($1, $2, $2, 'x', 'active', 'SUPER_ADMIN', $3)`, [id, email, role]);
  approvals = new PlatformApprovals(db);
  const moduleRef: any = { get: () => approvals };
  staff = new PlatformStaffController(new KyselyPlatformStaffRepository(db), moduleRef);
  const svc: any = { createInvitation: async (ctx: any, input: any) => { invites.push({ by: ctx.userId, input }); return { id: 'inv-' + invites.length, status: 'pending' }; } };
  platform = new SuperAdminPlatformController(svc, {} as any, undefined, moduleRef);
  staff.onModuleInit(); platform.onModuleInit();
});

describe('§134 platform-admin actions are approvable (registered at boot)', () => {
  it('both actions are registered with the platform_roles.manage approver permission', () => {
    const keys = approvals.registered().map((a) => [a.key, a.requiredPermission]);
    expect(keys).toEqual(expect.arrayContaining([[PLATFORM_ROLE_CHANGE, 'super_admin.platform_roles.manage'], [PLATFORM_ADMIN_INVITE, 'super_admin.platform_roles.manage']]));
  });

  it('policy OFF (default): a role change and a platform invitation run at once', async () => {
    const r: any = await staff.changeRole(C, { platformRole: 'PLATFORM_FINANCE', reason: 'moved to finance team' }, req(A));
    expect(r).toMatchObject({ ok: true, from: 'PLATFORM_SUPPORT', to: 'PLATFORM_FINANCE' });
    const i: any = await platform.createInvitation(req(A), { email: 'new@p.test', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT' });
    expect(i).toMatchObject({ status: 'pending' });
    expect(invites.at(-1)).toMatchObject({ by: A, input: { email: 'new@p.test', role: 'SUPER_ADMIN' } });
    expect((await sql<any>`select count(*)::int n from platform_approvals`.execute(db)).rows[0].n).toBe(0);
  });

  it('policy ON: the role change becomes a request; the requester cannot approve; another admin approves → applied, audited', async () => {
    await policy(PLATFORM_ROLE_CHANGE, true);
    const r: any = await staff.changeRole(C, { platformRole: 'PLATFORM_SUPPORT', reason: 'back to the support desk' }, req(A));
    expect(r).toMatchObject({ ok: true, pending: true });
    expect((await sql<any>`select platform_role from users where id = ${C}`.execute(db)).rows[0].platform_role).toBe('PLATFORM_FINANCE');   // not yet
    await expect(approvals.approve(r.approvalId, { userId: A, permissions: all }, 'self')).rejects.toMatchObject({ response: { code: 'separation' } });
    await expect(approvals.approve(r.approvalId, { userId: C, permissions: platformPermissionsFor('PLATFORM_FINANCE') as string[] }, 'no perm')).rejects.toMatchObject({ response: { code: 'forbidden' } });
    await approvals.approve(r.approvalId, { userId: B, permissions: all }, 'agreed');
    expect((await sql<any>`select platform_role from users where id = ${C}`.execute(db)).rows[0].platform_role).toBe('PLATFORM_SUPPORT');
    const audit = (await sql<any>`select action_type, user_id from audit_logs where action_type in ('approval_requested', 'approval_approved', 'platform_role_changed') order by created_at`.execute(db)).rows.map((x: any) => `${x.action_type}:${x.user_id}`);
    expect(audit).toEqual(expect.arrayContaining([`approval_requested:${A}`, `approval_approved:${B}`, `platform_role_changed:${A}`]));   // attributed to the requester; the approval names the checker
  });

  it('policy ON: a platform-admin invitation needs a reason, becomes a request, and is created only on approval', async () => {
    await policy(PLATFORM_ADMIN_INVITE, true);
    const before = invites.length;
    await expect(platform.createInvitation(req(A), { email: 'second@p.test', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT' })).rejects.toMatchObject({ response: { code: 'reason_required' } });
    const r: any = await platform.createInvitation(req(A), { email: 'second@p.test', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT', approvalReason: 'new support hire starting Monday' });
    expect(r).toMatchObject({ pending: true });
    expect(invites.length).toBe(before);   // nothing created yet
    await approvals.approve(r.approvalId, { userId: B, permissions: all });
    expect(invites.at(-1)).toMatchObject({ by: A, input: { email: 'second@p.test', platformRole: 'PLATFORM_SUPPORT' } });   // the inviter stays the requester
    expect(invites.at(-1).input.approvalReason).toBeUndefined();
  });

  it('a SALON-role invitation never goes through dual approval', async () => {
    const before = invites.length;
    const r: any = await platform.createInvitation(req(A), { email: 'owner@salon.test', role: 'OWNER', tenantId: '64646464-6464-4646-8646-646464646464' });
    expect(r).toMatchObject({ status: 'pending' });
    expect(invites.length).toBe(before + 1);
  });
});
