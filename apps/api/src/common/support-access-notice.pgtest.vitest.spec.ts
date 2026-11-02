// Constitution 7 §84 on the real schema: starting a support session (either store) tells the salon OWNER, in the same
// transaction — owner-only, with reason, scope and end time; if the notice cannot be written, no session exists.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselySuperAdminPlatformRepo, KyselySuperAdminTenantsRepo } from '@aipowersalon/super-admin';
import { seedRow } from '../events/pgtest-seed';

const T = '61616161-6161-4616-8616-616161616161', U = '62626262-6262-4626-8626-626262626262';
let db: any; let pg: any;
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'N', display_name: 'Notice Salon', tenant_slug: 'noticesalon', tenant_code: 'NOTI01', status: 'active' });
  await seedRow(pg, 'users', { id: U, email: 'agent@platform.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPPORT' });
});
const notices = async () => (await sql<any>`select category, severity, audience, title, body, metadata from owner_alerts where tenant_id = ${T} order by created_at`.execute(db)).rows;

describe('tenant notification of support access (§84)', () => {
  it('a Support Access session writes one owner-only notice with reason, scope and end time', async () => {
    const s: any = await new KyselySuperAdminPlatformRepo(db).startSupportSession({ tenantId: T, adminUserId: U, reason: 'customer cannot book online', minutes: 30, scope: 'READ_ONLY' });
    const n = await notices();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ category: 'support_access', severity: 'info', audience: 'owner', title: 'AI PowerSalon Support accessed your account' });
    expect(n[0].body).toMatch(/Reason: customer cannot book online\. Access is read-only and ends at \d\d:\d\d UTC/);
    expect(n[0].metadata).toMatchObject({ supportSessionId: String(s.id), scope: 'READ_ONLY' });
    expect(n[0].body).not.toMatch(/agent@platform/);                     // the owner sees the reason, not the agent
  });
  it('an ELEVATED session is a high-severity notice; a View POS session notifies too', async () => {
    await new KyselySuperAdminPlatformRepo(db).startSupportSession({ tenantId: T, adminUserId: U, reason: 'fixing a stuck ticket total', minutes: 15, scope: 'ELEVATED_SUPPORT' });
    await new KyselySuperAdminTenantsRepo(db).createSupportSession(T, { reason: 'owner reports checkout freezing', byUserId: U, ttlMinutes: 30 });
    const n = await notices();
    expect(n.map((x: any) => [x.severity, x.metadata.scope])).toEqual([['info', 'READ_ONLY'], ['high', 'ELEVATED_SUPPORT'], ['info', 'READ_ONLY']]);
  });
  it('no session without its notice: if the notice cannot be written, the session is rolled back', async () => {
    const before = Number((await sql<any>`select count(*)::int n from support_access_sessions`.execute(db)).rows[0].n);
    await pg.query(`alter table owner_alerts add constraint block_support_notice check (category <> 'support_access') not valid`);
    await expect(new KyselySuperAdminPlatformRepo(db).startSupportSession({ tenantId: T, adminUserId: U, reason: 'should not persist at all', minutes: 30 })).rejects.toBeTruthy();
    await pg.query(`alter table owner_alerts drop constraint block_support_notice`);
    expect(Number((await sql<any>`select count(*)::int n from support_access_sessions`.execute(db)).rows[0].n)).toBe(before);
  });
});
