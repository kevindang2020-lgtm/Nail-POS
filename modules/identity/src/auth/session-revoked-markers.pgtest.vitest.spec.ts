// session-revoked-markers.pgtest — Oct 12 2026 merge (other-chat workforce audit P0 #4): a session is dead when its
// row says so in ANY of the three ways the schema can say it — status 'revoked', revoked_at stamped, or expires_at in
// the past. The Super Admin suspend/lock/revoke-sessions path used to write only `revoked_at` while this guard read
// only `status`, so a session the operator was told had been killed kept working until it expired.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselySessionStore } from './session-store';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const U = 'e7e7e7e7-0000-4000-8000-00000000001b', T = 'e8e8e8e8-0000-4000-8000-00000000001b';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'R', 'R', 'rev-t', 'REVT1', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${U}', '${T}', 'Riley', 'riley@rev.test', 'x', 'active', 'TECHNICIAN') ON CONFLICT DO NOTHING`);
});

const fresh = async () => (await new KyselySessionStore(db).create({ userId: U, tenantId: T, branchId: null, ttlSeconds: 3600 }))!;

describe('every revocation marker ends the session', () => {
  it('a live session is not revoked', async () => {
    const sid = await fresh();
    expect(await new KyselySessionStore(db).isRevoked(sid)).toBe(false);
  });
  it('revoked_at alone (status still active — the old platform write) is revoked', async () => {
    const sid = await fresh();
    await pg.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sid]);
    expect((await pg.query(`SELECT status FROM sessions WHERE id = $1`, [sid])).rows[0].status).toBe('active');
    expect(await new KyselySessionStore(db).isRevoked(sid)).toBe(true);
  });
  it('an expired row is revoked even with status active and no revoked_at', async () => {
    const sid = await fresh();
    await pg.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [sid]);
    expect(await new KyselySessionStore(db).isRevoked(sid)).toBe(true);
  });
  it('status revoked (the normal write) is still revoked', async () => {
    const sid = await fresh();
    await pg.query(`UPDATE sessions SET status = 'revoked' WHERE id = $1`, [sid]);
    expect(await new KyselySessionStore(db).isRevoked(sid)).toBe(true);
  });
  it('the last_seen_at touch path sees the markers too (a minute-old session)', async () => {
    const sid = await fresh();
    await pg.query(`UPDATE sessions SET last_seen_at = now() - interval '5 minutes', revoked_at = now() WHERE id = $1`, [sid]);
    expect(await new KyselySessionStore(db).isRevoked(sid)).toBe(true);
  });
});
