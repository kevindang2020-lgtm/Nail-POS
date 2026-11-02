// session-revocation-status.pgtest — Security Deep Scan C10: the store says WHICH answer it has (active / revoked /
// unknown / error) so the middleware can fail closed where it must; isRevoked keeps its documented fail-open answer.
// On the old store an unknown sid was cached as live and a lookup error was indistinguishable from "not revoked".
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselySessionStore, InMemorySessionStore } from './session-store';

let pg: any; let db: any;
const U = 'ad000000-0000-4000-8000-0000000000c1', T = 'ad000000-0000-4000-8000-0000000000c2';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'S', 'S', 'c10-t', 'C10T', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${U}', '${T}', 'Sam', 'sam@c10.test', 'x', 'active', 'MANAGER') ON CONFLICT DO NOTHING`);
});

describe('C10 — KyselySessionStore.revocationStatus', () => {
  it('is durable with a database', () => expect(new KyselySessionStore(db).durable).toBe(true));
  it('active → revoked', async () => {
    const s = new KyselySessionStore(db);
    const sid = (await s.create({ userId: U, tenantId: T, branchId: null, ttlSeconds: 3600 }))!;
    expect(await s.revocationStatus(sid)).toBe('active');
    await s.revoke(sid);
    expect(await s.revocationStatus(sid)).toBe('revoked');
  });
  it('an id with no row is UNKNOWN — and is not cached as live', async () => {
    const s = new KyselySessionStore(db);
    const ghost = 'ad000000-0000-4000-8000-00000000ffff';
    expect(await s.revocationStatus(ghost)).toBe('unknown');
    expect(await s.isRevoked(ghost)).toBe(false);                 // the documented fail-open answer is unchanged
    expect(await s.revocationStatus(ghost)).toBe('unknown');      // still unknown on a second ask (old: cached as fine)
  });
  it('a lookup failure is ERROR (reported, not swallowed into "not revoked")', async () => {
    const broken: any = new Proxy({}, { get() { throw new Error('db down'); } });
    const s = new KyselySessionStore(broken);
    expect(await s.revocationStatus('ad000000-0000-4000-8000-00000000eeee')).toBe('error');
    expect(await s.isRevoked('ad000000-0000-4000-8000-00000000eeee')).toBe(false);
    expect(s.lastError).toBeTruthy();
  });
  it('the in-memory store is not durable', async () => {
    const m = new InMemorySessionStore();
    expect(m.durable).toBe(false);
    expect(await m.revocationStatus('nope')).toBe('unknown');
  });
});
