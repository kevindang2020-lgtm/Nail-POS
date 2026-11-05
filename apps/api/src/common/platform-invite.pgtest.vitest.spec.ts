// Constitution 7 §24/§25 on the real schema: inviting a PLATFORM user needs platform_roles.manage, names the platform
// role, obeys the grant ceiling — and the accepted account holds exactly that role.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { KyselySuperAdminPlatformRepo } from '@aipowersalon/super-admin';
import { SuperAdminPlatformService } from '@aipowersalon/super-admin';

const SA = '75757575-7575-4757-8757-757575757575';
let db: any; let svc: any;
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`insert into users (id, email, role, status, platform_role) values ($1, 'root@platform.test', 'SUPER_ADMIN', 'active', 'PLATFORM_SUPER_ADMIN')`, [SA]);
  svc = new SuperAdminPlatformService(new KyselySuperAdminPlatformRepo(db));
});
const sa = { userId: SA, email: 'root@platform.test', permissions: platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[] };
const admin = { userId: SA, email: 'x', permissions: platformPermissionsFor('PLATFORM_ADMIN') as string[] };

describe('platform user invitations', () => {
  it('a Platform Admin (no platform_roles.manage) cannot invite a platform user; a missing role is refused', async () => {
    await expect(svc.createInvitation(admin, { email: 'new@platform.test', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT', channel: 'manual' })).rejects.toThrow(/platform_roles\.manage/);
    await expect(svc.createInvitation(sa, { email: 'new@platform.test', role: 'SUPER_ADMIN', channel: 'manual' })).rejects.toThrow(/platform role/);
  });
  it('grant ceiling: an inviter holding the key but not every permission of the role is refused', async () => {
    const narrow = { ...sa, permissions: [...(platformPermissionsFor('PLATFORM_SUPPORT') as string[]), 'super_admin.platform_roles.manage', 'super_admin.users.manage'] };
    await expect(svc.createInvitation(narrow, { email: 'x2@platform.test', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_FINANCE', channel: 'manual' })).rejects.toThrow(/do not hold/);
  });
  it('a Super Admin invites a Support user; the accepted account holds PLATFORM_SUPPORT', async () => {
    const r = await svc.createInvitation(sa, { email: 'amy@platform.test', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT', channel: 'manual' });
    expect((await sql<any>`select platform_role from user_invitations where id = ${r.id}`.execute(db)).rows[0].platform_role).toBe('PLATFORM_SUPPORT');
    const token = (r as any).manualAcceptToken;
    expect(token, 'a manual invitation returns its accept token').toBeTruthy();   // the acceptance below must really run
    await svc.acceptInvitation({ token, password: 'A-strong-passphrase-2026!', fullName: 'Amy' });
    expect((await sql<any>`select role, platform_role from users where email = 'amy@platform.test'`.execute(db)).rows[0]).toEqual({ role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPPORT' });
  });
});
