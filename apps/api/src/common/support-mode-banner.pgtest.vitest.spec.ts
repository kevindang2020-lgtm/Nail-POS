// Constitution 7 §75 on the real schema: the SUPPORT MODE banner lists THIS admin's live sessions (Support Access and
// View POS — one store since migration 541), never someone else's or an expired/ended one; Exit ends them.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselySuperAdminPlatformRepo } from '@aipowersalon/super-admin';
import { seedRow } from '../events/pgtest-seed';

const T = '5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a', ME = '5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b', OTHER = '5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c5c';
const A = '5d5d5d5d-5d5d-45d5-85d5-5d5d5d5d5d5d', V = '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e', X = '5f5f5f5f-5f5f-45f5-85f5-5f5f5f5f5f5f', OLD = '60606060-6060-4606-8606-606060606060';
let repo: KyselySuperAdminPlatformRepo;
const soon = () => new Date(Date.now() + 20 * 60_000).toISOString();
beforeAll(async () => {
  const pg = await migratedPglite(); const db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'B', display_name: 'Belle Palace', tenant_slug: 'bellepalace', tenant_code: 'BELL01', status: 'active' });
  for (const [id, email] of [[ME, 'me@platform.test'], [OTHER, 'other@platform.test']]) await seedRow(pg, 'users', { id, email, role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN' });
  await seedRow(pg, 'support_access_sessions', { id: A, tenant_id: T, admin_user_id: ME, reason: 'booking issue reported', scope: 'STANDARD_SUPPORT', expires_at: soon() });
  await seedRow(pg, 'support_access_sessions', { id: V, tenant_id: T, admin_user_id: ME, reason: 'checkout freezing at POS', scope: 'READ_ONLY', expires_at: soon() });
  await seedRow(pg, 'support_access_sessions', { id: X, tenant_id: T, admin_user_id: OTHER, reason: 'someone else session', expires_at: soon() });
  await seedRow(pg, 'support_access_sessions', { id: OLD, tenant_id: T, admin_user_id: ME, reason: 'long expired session', expires_at: new Date(Date.now() - 60_000).toISOString() });
  repo = new KyselySuperAdminPlatformRepo(db as any);
});

describe('SUPPORT MODE banner data (§75)', () => {
  it('lists my live sessions with tenant, reason, scope and expiry — not others\', not expired', async () => {
    const mine = await repo.mySupportSessions(ME);
    expect(mine.map((s) => [s.id, s.source, s.tenantName, s.scope]).sort()).toEqual([[A, 'support_access', 'Belle Palace', 'STANDARD_SUPPORT'], [V, 'support_access', 'Belle Palace', 'READ_ONLY']].sort());
    expect(mine.every((s) => new Date(s.expiresAt).getTime() > Date.now())).toBe(true);
  });
  it('Exit ends them', async () => {
    expect(await repo.endSupportSession(V, ME)).toBeTruthy();
    expect(await repo.endSupportSession(A, ME)).toBeTruthy();
    expect(await repo.mySupportSessions(ME)).toEqual([]);
  });
});
