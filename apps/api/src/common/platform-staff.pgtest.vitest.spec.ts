// platform-staff.pgtest — Constitution 7 §24–§26 on the real schema: a role change applies, revokes the target's
// sessions and is audited; the last Platform Super Admin is protected; two administrators demoting each other leave one.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { KyselyPlatformStaffRepository } from '@aipowersalon/super-admin';
import { seedRow } from '../events/pgtest-seed';

const A = '51515151-5151-4515-8515-515151515151', B = '52525252-5252-4525-8525-525252525252', C = '53535353-5353-4535-8535-535353535353';
const all = platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[];
let db: any; let repo: KyselyPlatformStaffRepository;

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'users', { id: A, email: 'a@platform.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN', status: 'active' });
  await seedRow(pg, 'users', { id: B, email: 'b@platform.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN', status: 'active' });
  await seedRow(pg, 'users', { id: C, email: 'c@platform.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPPORT', status: 'active' });
  await seedRow(pg, 'sessions', { user_id: C, status: 'active', expires_at: new Date(Date.now() + 3600_000).toISOString() });
  repo = new KyselyPlatformStaffRepository(db);
});

describe('platform staff role changes', () => {
  it('lists the platform accounts with their roles', async () => {
    const rows = await repo.list();
    expect(rows.map((r) => [r.email, r.platformRole])).toEqual([['a@platform.test', 'PLATFORM_SUPER_ADMIN'], ['b@platform.test', 'PLATFORM_SUPER_ADMIN'], ['c@platform.test', 'PLATFORM_SUPPORT']]);
  });
  it('a change applies, revokes the target\'s sessions, and writes an audit row with from/to/reason', async () => {
    const d = await repo.changeRole({ userId: A, permissions: all }, C, 'PLATFORM_FINANCE', 'moved to the finance team');
    expect(d).toMatchObject({ ok: true, from: 'PLATFORM_SUPPORT', to: 'PLATFORM_FINANCE' });
    expect((await sql<any>`select platform_role from users where id = ${C}`.execute(db)).rows[0].platform_role).toBe('PLATFORM_FINANCE');
    expect((await sql<any>`select count(*)::int n from sessions where user_id = ${C} and revoked_at is null`.execute(db)).rows[0].n).toBe(0);
    const audit = (await sql<any>`select user_id, action_type, entity_id, metadata_json from audit_logs where action_type = 'platform_role_changed'`.execute(db)).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ user_id: A, entity_id: C });
    expect(audit[0].metadata_json).toEqual({ from: 'PLATFORM_SUPPORT', to: 'PLATFORM_FINANCE', reason: 'moved to the finance team' });
  });
  it('§26: A demotes B (two super admins → one); B, now not a super admin, cannot demote A — and A is the protected last one', async () => {
    expect(await repo.changeRole({ userId: A, permissions: all }, B, 'PLATFORM_ADMIN', 'no longer needs full control')).toMatchObject({ ok: true });
    const bPerms = platformPermissionsFor('PLATFORM_ADMIN') as string[];
    expect(await repo.changeRole({ userId: B, permissions: bPerms }, A, 'PLATFORM_ADMIN', 'trying to demote the last one')).toMatchObject({ ok: false, code: 'forbidden' });
    // even an actor with the key cannot move the last active Platform Super Admin
    expect(await repo.changeRole({ userId: C, permissions: all }, A, 'PLATFORM_ADMIN', 'trying to demote the last one')).toMatchObject({ ok: false, code: 'last_super_admin' });
    expect((await sql<any>`select count(*)::int n from users where platform_role = 'PLATFORM_SUPER_ADMIN'`.execute(db)).rows[0].n).toBe(1);
  });
  it('a refused change writes nothing: no role change, no audit row', async () => {
    const before = (await sql<any>`select count(*)::int n from audit_logs`.execute(db)).rows[0].n;
    expect(await repo.changeRole({ userId: A, permissions: all }, A, 'PLATFORM_AUDITOR', 'demoting myself for a test')).toMatchObject({ ok: false, code: 'self_change' });
    expect((await sql<any>`select count(*)::int n from audit_logs`.execute(db)).rows[0].n).toBe(before);
  });
});

// ── §24: suspend / reactivate, sessions, revoke ────────────────────────────────────────────────────────────────────
describe('platform account status and sessions (§24)', () => {
  const all = platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[];
  it('suspending a platform account signs it out and is audited; the last active Super Admin cannot be suspended; not yourself', async () => {
    await sql`insert into sessions (user_id, status, expires_at) values (${C}, 'active', now() + interval '1 hour')`.execute(db);
    expect(await repo.changeStatus({ userId: A, permissions: all }, C, 'suspended', 'left the company today')).toMatchObject({ ok: true, from: 'active', to: 'suspended' });
    expect((await sql<any>`select count(*)::int n from sessions where user_id = ${C} and revoked_at is null`.execute(db)).rows[0].n).toBe(0);
    expect((await sql<any>`select count(*)::int n from audit_logs where action_type = 'platform_user_suspended' and entity_id = ${C}`.execute(db)).rows[0].n).toBe(1);
    expect(await repo.changeStatus({ userId: C, permissions: all }, A, 'suspended', 'suspending the last one')).toMatchObject({ ok: false, code: 'last_super_admin' });
    expect(await repo.changeStatus({ userId: A, permissions: all }, A, 'suspended', 'suspending myself please')).toMatchObject({ ok: false, code: 'self_change' });
    expect(await repo.changeStatus({ userId: A, permissions: all }, C, 'active', 'returned from leave today')).toMatchObject({ ok: true, to: 'active' });
  });
  it('lists a platform account\'s sessions and revokes them all with a reason (audited); refuses a short reason', async () => {
    await sql`insert into sessions (user_id, status, expires_at) values (${C}, 'active', now() + interval '1 hour'), (${C}, 'active', now() + interval '1 hour')`.execute(db);
    expect((await repo.sessions(C)).filter((s) => !s.revokedAt)).toHaveLength(2);
    expect(await repo.revokeSessions({ userId: A, permissions: all }, C, 'x')).toMatchObject({ ok: false, code: 'reason_required' });
    expect(await repo.revokeSessions({ userId: A, permissions: all }, C, 'suspicious sign-in from abroad')).toEqual({ ok: true, revoked: 2 });
    expect((await repo.sessions(C)).filter((s) => !s.revokedAt)).toHaveLength(0);
    expect((await sql<any>`select metadata_json from audit_logs where action_type = 'platform_user_sessions_revoked'`.execute(db)).rows[0].metadata_json).toEqual({ revoked: 2, reason: 'suspicious sign-in from abroad' });
  });
});
