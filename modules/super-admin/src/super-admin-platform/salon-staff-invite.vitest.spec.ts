// salon-staff-invite.vitest.spec.ts — wave 4 pilot P3: the salon owner could not invite her own front desk or manager;
// only the Super Admin could. The salon now invites RECEPTION / FRONT_DESK / MANAGER through the SAME invitation path
// (user_invitations, token, delivery, public accept) — permission-based (roles.manage), always into the actor's own salon,
// never above the actor's own permissions (the grant ceiling), and audited against the salon.
import { describe, it, expect } from 'vitest';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';
import { InMemorySuperAdminPlatformRepo } from './super-admin-platform.repository';

const T = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999', B = '22222222-2222-4222-8222-222222222222';
function harness(branchTenant: string | null = T) {
  const created: any[] = []; const audits: any[] = [];
  const repo: any = new InMemorySuperAdminPlatformRepo();
  repo.createInvitation = async (i: any) => { created.push(i); return { id: 'inv1', userId: 'u-new', token: 'tok-123456789', tokenPrefix: 'tok-1234', expiresAt: '2026-10-20T00:00:00Z', reused: false }; };
  repo.setInvitationDelivery = async () => undefined;
  const chain: any = { select: () => chain, where: () => chain, executeTakeFirst: async () => (branchTenant === T ? { id: B } : undefined) };
  const db: any = {
    selectFrom: () => chain,
    insertInto: (table: string) => ({ values: (v: any) => ({ execute: async () => { audits.push({ table, ...v }); } }) }),
  };
  return { svc: new SuperAdminPlatformService(repo, db), created, audits };
}
const owner = { tenantId: T, userId: 'owner-1', role: 'OWNER', permissions: [...(ROLE_PERMISSIONS as any).OWNER] };

describe('the salon invites its own front desk and manager', () => {
  it('an owner invites a receptionist into HER salon (a tenantId in the body is ignored), audited against the salon', async () => {
    const { svc, created, audits } = harness();
    const out: any = await svc.inviteSalonStaff(owner, { email: 'Rae@Desk.test', fullName: 'Rae Desk', role: 'RECEPTIONIST', branchId: B, tenantId: OTHER });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ tenantId: T, branchId: B, email: 'rae@desk.test', role: 'RECEPTION', invitedByUserId: 'owner-1' });
    expect(out).toMatchObject({ id: 'inv1', status: 'pending', role: 'RECEPTION' });
    const a = audits.find((x) => x.action_type === 'salon_staff_invitation_created');
    expect(a).toBeTruthy();
    expect(a.tenant_id).toBe(T);
    expect(a.role).toBe('OWNER');
  });
  it('a manager invite works too (after the inviter confirmed it is her — step-up)', async () => {
    const { svc, created } = harness();
    await svc.inviteSalonStaff({ ...owner, stepUpFresh: async () => true }, { phone: '(856) 555-0101', fullName: 'Max Floor', role: 'MANAGER' });
    expect(created[0]).toMatchObject({ tenantId: T, role: 'MANAGER', phone: '+18565550101' });
  });
  it('only front-desk / manager roles: an owner, technician or platform role is refused', async () => {
    const { svc } = harness();
    for (const role of ['OWNER', 'TECHNICIAN', 'SUPER_ADMIN', 'CUSTOMER'])
      await expect(svc.inviteSalonStaff(owner, { email: 'x@y.test', fullName: 'X Y', role })).rejects.toBeInstanceOf(PlatformError);
  });
  it('without roles.manage → forbidden', async () => {
    const { svc } = harness();
    const desk = { tenantId: T, userId: 'd1', role: 'FRONT_DESK', permissions: [...(ROLE_PERMISSIONS as any).FRONT_DESK] };
    await expect(svc.inviteSalonStaff(desk, { email: 'x@y.test', fullName: 'X Y', role: 'RECEPTION' })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('never above the inviter\'s own permissions (the grant ceiling)', async () => {
    const { svc, created } = harness();
    const narrowed = { ...owner, permissions: owner.permissions.filter((p: string) => p !== 'pos.refunds.create' && p !== 'reports.view') };
    const lacking = ((ROLE_PERMISSIONS as any).MANAGER as string[]).filter((p) => !narrowed.permissions.includes(p));
    expect(lacking.length).toBeGreaterThan(0);
    await expect(svc.inviteSalonStaff({ ...narrowed, stepUpFresh: async () => true }, { email: 'x@y.test', fullName: 'X Y', role: 'MANAGER' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(created).toHaveLength(0);
  });
  it('a branch of another salon is refused', async () => {
    const { svc, created } = harness(OTHER);
    await expect(svc.inviteSalonStaff(owner, { email: 'x@y.test', fullName: 'X Y', role: 'RECEPTION', branchId: B })).rejects.toMatchObject({ code: 'invalid' });
    expect(created).toHaveLength(0);
  });
});

// wave 4 SQL item 5: inviting a MANAGER hands over refunds, payroll, reports and staff control — a sensitive action like
// a role change, so it needs step-up (403 STEP_UP_REQUIRED until POST /auth/step-up). A receptionist invite does not.
describe('a MANAGER invite needs step-up; a receptionist invite does not', () => {
  it('no fresh step-up → refused with STEP_UP_REQUIRED, nothing created', async () => {
    const { svc, created } = harness();
    await expect(svc.inviteSalonStaff(owner, { email: 'm@floor.test', fullName: 'Max Floor', role: 'MANAGER' })).rejects.toMatchObject({ code: 'forbidden', reason: 'STEP_UP_REQUIRED' });
    await expect(svc.inviteSalonStaff({ ...owner, stepUpFresh: async () => false }, { email: 'm@floor.test', fullName: 'Max Floor', role: 'manager' })).rejects.toMatchObject({ reason: 'STEP_UP_REQUIRED' });
    expect(created).toHaveLength(0);
  });
  it('a receptionist / front desk invite never asks for step-up', async () => {
    const { svc, created } = harness();
    let asked = 0;
    const actor = { ...owner, stepUpFresh: async () => { asked++; return false; } };
    await svc.inviteSalonStaff(actor, { email: 'r@desk.test', fullName: 'Rae Desk', role: 'RECEPTION' });
    await svc.inviteSalonStaff(actor, { email: 'f@desk.test', fullName: 'Fay Desk', role: 'FRONT_DESK' });
    expect(created).toHaveLength(2);
    expect(asked).toBe(0);
  });
  it('the controller answers 403 { code: STEP_UP_REQUIRED } (the shape the POS step-up prompt listens for)', async () => {
    const { run } = await import('./super-admin-platform.controller');
    const err: any = await run(async () => { throw new PlatformError('forbidden', 'Confirm it is you.', 'STEP_UP_REQUIRED'); }).catch((e) => e);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});
