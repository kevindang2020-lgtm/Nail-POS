// Constitution 7 §78 on the real schema: an admin extends ONLY their own live session (one store since migration 541); the extension is
// counted, capped, and told to the owner in the same transaction.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselySuperAdminPlatformRepo } from '@aipowersalon/super-admin';
import { seedRow } from '../events/pgtest-seed';

const T = '61616161-6161-4616-8616-616161616161', ME = '62626262-6262-4626-8626-626262626262', OTHER = '63636363-6363-4636-8636-636363636363';
const A = '64646464-6464-4646-8646-646464646464', V = '65656565-6565-4656-8656-656565656565';
let db: any; let repo: KyselySuperAdminPlatformRepo;
const R = 'still reproducing the booking bug';
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'E', display_name: 'Extend Salon', tenant_slug: 'extendsalon', tenant_code: 'EXTD01', status: 'active' });
  for (const [id, email] of [[ME, 'me@platform.test'], [OTHER, 'other@platform.test']]) await seedRow(pg, 'users', { id, email, role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN' });
  const start = new Date(Date.now() - 10 * 60_000).toISOString(), end = new Date(Date.now() + 20 * 60_000).toISOString();
  await seedRow(pg, 'support_access_sessions', { id: A, tenant_id: T, admin_user_id: ME, reason: 'booking issue reported', started_at: start, expires_at: end });
  await seedRow(pg, 'support_access_sessions', { id: V, tenant_id: T, admin_user_id: ME, reason: 'checkout freezing at POS', scope: 'READ_ONLY', started_at: start, expires_at: end });   // a Tenants-screen (View POS) session — the same store since 541
  repo = new KyselySuperAdminPlatformRepo(db);
});

describe('support session extension (real schema)', () => {
  it('extends my Support Access session, counts it, and tells the owner', async () => {
    const r: any = await repo.extendSupportSession(A, ME, 30, R);
    expect(r).toMatchObject({ ok: true, source: 'support_access', extensionCount: 1 });
    const n = (await sql<any>`select title, audience, metadata from owner_alerts where tenant_id = ${T} and metadata->>'extended' = 'true'`.execute(db)).rows;
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ title: 'AI PowerSalon Support extended its access', audience: 'owner' });
  });
  it('another admin cannot extend my session; a Tenants-screen session extends the same way', async () => {
    expect(await repo.extendSupportSession(A, OTHER, 30, R)).toMatchObject({ ok: false, notFound: true });
    expect(await repo.extendSupportSession(V, ME, 15, R)).toMatchObject({ ok: true, source: 'support_access', extensionCount: 1 });
  });
  it('the cap holds on the real rows: a third extension is refused and nothing changes', async () => {
    expect(await repo.extendSupportSession(A, ME, 15, R)).toMatchObject({ ok: true, extensionCount: 2 });
    const before = (await sql<any>`select expires_at from support_access_sessions where id = ${A}`.execute(db)).rows[0].expires_at;
    expect(await repo.extendSupportSession(A, ME, 15, R)).toMatchObject({ ok: false });
    expect((await sql<any>`select expires_at, extension_count from support_access_sessions where id = ${A}`.execute(db)).rows[0]).toMatchObject({ extension_count: 2 });
    expect(new Date((await sql<any>`select expires_at from support_access_sessions where id = ${A}`.execute(db)).rows[0].expires_at).getTime()).toBe(new Date(before).getTime());
  });
});
