// support-session-gate.pgtest.vitest.spec.ts — BUILD_PLAN Phase 14: the support-session lookup on the REAL schema
// (support_access_sessions, the one Support Mode store since migration 541). A session opened by the real Super Admin
// repository is admitted while live; ended through the real repository, or past expires_at, it is refused.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselySuperAdminTenantsRepo, KyselySuperAdminPlatformRepo } from '@aipowersalon/super-admin';
import { seedRow } from '../events/pgtest-seed';
import { KyselySupportSessionLookup, assertLiveSupportSession } from './support-session-gate';

const T = '8a8a8a8a-8a8a-48a8-88a8-8a8a8a8a8a8a', T2 = '8b8b8b8b-8b8b-48b8-88b8-8b8b8b8b8b8b', ADMIN = '8c8c8c8c-8c8c-48c8-88c8-8c8c8c8c8c8c';
let db: any;
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'G', display_name: 'Gate Salon', tenant_slug: 'gatesalon', tenant_code: 'GATE01', status: 'active' });
  await seedRow(pg, 'tenants', { id: T2, legal_name: 'H', display_name: 'Other Salon', tenant_slug: 'othersalon', tenant_code: 'OTHR01', status: 'active' });
  await seedRow(pg, 'users', { id: ADMIN, email: 'gate@platform.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN' });
});

describe('support-session gate on the real schema', () => {
  it('live → admitted; wrong salon → refused; ended → refused; expired → refused', async () => {
    const lookup = new KyselySupportSessionLookup(db);
    const s = await new KyselySuperAdminTenantsRepo(db).createSupportSession(T, { reason: 'checkout freezing at the front desk', byUserId: ADMIN, ttlMinutes: 30 });
    const id = String(s.token);
    const dbNow = new Date((await sql<any>`select now() as n`.execute(db)).rows[0].n);   // the database's clock, one clock
    expect((await assertLiveSupportSession(lookup, id, ADMIN, T, dbNow)).tenantId).toBe(T);
    await expect(assertLiveSupportSession(lookup, id, ADMIN, T2, dbNow)).rejects.toMatchObject({ code: 'support_session_wrong_tenant' });
    const past = new Date(dbNow.getTime() + 31 * 60_000);
    await expect(assertLiveSupportSession(lookup, id, ADMIN, T, past)).rejects.toMatchObject({ code: 'support_session_expired' });
    await new KyselySuperAdminPlatformRepo(db).endSupportSession(id, ADMIN);
    await expect(assertLiveSupportSession(lookup, id, ADMIN, T, dbNow)).rejects.toMatchObject({ code: 'support_session_ended' });
  });
  it('an id that is not a uuid, or not a row, is refused without a query error', async () => {
    const lookup = new KyselySupportSessionLookup(db);
    await expect(assertLiveSupportSession(lookup, "x' or 1=1 --", ADMIN, T)).rejects.toMatchObject({ code: 'support_session_required' });
    await expect(assertLiveSupportSession(lookup, '00000000-0000-4000-8000-000000000000', ADMIN, T)).rejects.toMatchObject({ code: 'support_session_required' });
  });
});
