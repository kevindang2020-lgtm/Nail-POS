// Constitution 7 — ONE Support Mode store. The memberships screen's "enter support mode" writes the canonical
// support_access_sessions row (owner told in the same transaction), shows in the SUPPORT MODE banner, and "active" /
// "exit" act only on the caller's own session. membership_support_sessions was merged in and dropped (migration 541).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MembershipProgramsRepository, KyselySuperAdminPlatformRepo } from '@aipowersalon/super-admin';
import { seedRow } from '../events/pgtest-seed';

const T = '7a7a7a7a-7a7a-47a7-87a7-7a7a7a7a7a7a', ME = '7b7b7b7b-7b7b-47b7-87b7-7b7b7b7b7b7b', OTHER = '7c7c7c7c-7c7c-47c7-87c7-7c7c7c7c7c7c';
let db: any;
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'M', display_name: 'Member Salon', tenant_slug: 'membersalon', tenant_code: 'MEMB01', status: 'active' });
  for (const [id, e] of [[ME, 'me@platform.test'], [OTHER, 'other@platform.test']]) await seedRow(pg, 'users', { id, email: e, role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN' });
});

describe('memberships support mode uses the one store', () => {
  it('opens a canonical session with the owner notice; the banner shows it; the old membership store is gone', async () => {
    const repo = new MembershipProgramsRepository(db);
    const s = await repo.openSupportSession({ userId: ME } as any, { tenantId: T, reason: 'member billing dispute review', durationMinutes: 30, accessLevel: 'assist' });
    expect((await sql<any>`select scope, reason from support_access_sessions where id = ${s.id}`.execute(db)).rows[0]).toEqual({ scope: 'STANDARD_SUPPORT', reason: 'member billing dispute review' });
    expect((await sql<any>`select count(*)::int n from owner_alerts where tenant_id = ${T} and category = 'support_access'`.execute(db)).rows[0].n).toBe(1);
    expect((await sql<any>`select to_regclass('membership_support_sessions') as t`.execute(db)).rows[0].t).toBeNull();
    expect((await new KyselySuperAdminPlatformRepo(db).mySupportSessions(ME)).map((x) => x.id)).toContain(s.id);
  });
  it('"active" and "exit" act only on the caller\'s own session', async () => {
    const repo = new MembershipProgramsRepository(db);
    expect(await repo.activeSupportSession({ userId: OTHER } as any)).toBeNull();
    const mine = await repo.activeSupportSession({ userId: ME } as any);
    expect(mine).toMatchObject({ tenant: 'Member Salon', accessLevel: 'assist' });
    expect(await repo.closeSupportSession({ userId: OTHER } as any, mine.id)).toBe(false);
    expect(await repo.closeSupportSession({ userId: ME } as any, mine.id)).toBe(true);
    expect(await repo.activeSupportSession({ userId: ME } as any)).toBeNull();
  });
});

// ── the Tenants-screen Support Mode and realtime scoping use the one store too ─────────────────────────────────────
import { KyselySuperAdminTenantsRepo } from '@aipowersalon/super-admin';
import { KyselySupportSessionSource } from '../realtime/support-session-realtime';
describe('Tenants-screen Support Mode and realtime scoping (one store)', () => {
  const ADMIN2 = '7d7d7d7d-7d7d-47d7-87d7-7d7d7d7d7d7d';
  it('opens a canonical READ_ONLY session; realtime scopes the admin to that tenant; an ended session loses scope', async () => {
    await sql`insert into users (id, email, role, status, platform_role) values (${ADMIN2}, 'a2@platform.test', 'SUPER_ADMIN', 'active', 'PLATFORM_SUPER_ADMIN')`.execute(db);
    const s = await new KyselySuperAdminTenantsRepo(db).createSupportSession(T, { reason: 'owner reports checkout freezing', byUserId: ADMIN2, ttlMinutes: 30 });
    expect((await sql<any>`select scope, admin_user_id from support_access_sessions where id = ${s.token}`.execute(db)).rows[0]).toEqual({ scope: 'READ_ONLY', admin_user_id: ADMIN2 });
    expect((await sql<any>`select to_regclass('super_admin_support_sessions') as t`.execute(db)).rows[0].t).toBeNull();
    const facts = await new KyselySupportSessionSource(db).activeSessionFor(ADMIN2, new Date());
    expect(facts).toMatchObject({ sessionId: s.token, tenantId: T });
    await sql`update support_access_sessions set ended_at = now() where id = ${s.token}`.execute(db);
    expect(await new KyselySupportSessionSource(db).activeSessionFor(ADMIN2, new Date())).toBeNull();
  });
  it('a legacy session copied in by migration 541 keeps its scope until it ends', async () => {
    const L = '7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e';
    await sql`insert into support_access_sessions (id, admin_user_id, tenant_id, reason, scope, started_at, expires_at) values (${L}, ${ADMIN2}, ${T}, 'opened before the merge', 'READ_ONLY', now(), now() + interval '20 minutes')`.execute(db);
    expect(await new KyselySupportSessionSource(db).activeSessionFor(ADMIN2, new Date())).toMatchObject({ sessionId: L, tenantId: T });
  });
});
