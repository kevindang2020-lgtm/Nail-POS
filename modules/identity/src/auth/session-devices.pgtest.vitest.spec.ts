// session-devices.pgtest — Constitution 12 §144–146: a session names its device; a lost phone is revocable by name.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselySessionStore } from './session-store';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const U = 'e7e7e7e7-0000-4000-8000-00000000000a', T = 'e8e8e8e8-0000-4000-8000-00000000000a';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'D', 'D', 'dev-t', 'DEVT1', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${U}', '${T}', 'Maria', 'maria@dev.test', 'x', 'active', 'TECHNICIAN') ON CONFLICT DO NOTHING`);
});

describe('§144 the session row carries the device', () => {
  it('device id, name, platform and user agent are stored; last_seen_at starts at creation', async () => {
    const store = new KyselySessionStore(db);
    const sid = await store.create({ userId: U, tenantId: T, branchId: null, ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', deviceId: 'a1b2c3d4', deviceName: "iPhone · Tech app", platform: 'ios', ttlSeconds: 3600 });
    const r = (await pg.query(`SELECT device_id, device_name, platform, user_agent, last_seen_at FROM sessions WHERE id = $1`, [sid])).rows[0];
    expect(r).toMatchObject({ device_id: 'a1b2c3d4', device_name: 'iPhone · Tech app', platform: 'ios' });
    expect(r.user_agent).toMatch(/iPhone/); expect(r.last_seen_at).not.toBeNull();
  });
  it('labels are clipped — a 10 KB "device name" cannot bloat the row', async () => {
    const sid = await new KyselySessionStore(db).create({ userId: U, tenantId: T, branchId: null, deviceName: 'x'.repeat(10_000), ttlSeconds: 60 });
    expect((await pg.query(`SELECT length(device_name)::int n FROM sessions WHERE id = $1`, [sid])).rows[0].n).toBe(80);
  });
});

describe('§146 last_seen_at rides the revocation read, throttled', () => {
  it('a check after a minute touches last_seen_at; a check right after does not write again', async () => {
    const store = new KyselySessionStore(db);
    const sid = await store.create({ userId: U, tenantId: T, branchId: null, ttlSeconds: 3600 });
    await pg.query(`UPDATE sessions SET last_seen_at = now() - interval '5 minutes' WHERE id = $1`, [sid]);
    expect(await store.isRevoked(sid)).toBe(false);
    const t1 = (await pg.query(`SELECT last_seen_at FROM sessions WHERE id = $1`, [sid])).rows[0].last_seen_at;
    expect(Date.now() - new Date(t1).getTime()).toBeLessThan(10_000);          // touched
    (store as any).ok.delete(sid);                                              // bypass the in-process cache to reach the DB again
    expect(await store.isRevoked(sid)).toBe(false);
    const t2 = (await pg.query(`SELECT last_seen_at FROM sessions WHERE id = $1`, [sid])).rows[0].last_seen_at;
    expect(new Date(t2).getTime()).toBe(new Date(t1).getTime());                // NOT touched again within the minute
  });
  it('revocation is still detected through the same read', async () => {
    const store = new KyselySessionStore(db);
    const sid = await store.create({ userId: U, tenantId: T, branchId: null, ttlSeconds: 3600 });
    await pg.query(`UPDATE sessions SET status = 'revoked', revoked_at = now() WHERE id = $1`, [sid]);
    expect(await store.isRevoked(sid)).toBe(true);
  });
});

describe('§145 the login handler supplies the device from the request and the body', () => {
  it('user agent from the header; device from the body; platform validated', async () => {
    const { readFileSync } = await import('node:fs'); const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/auth/auth.controller.ts'), 'utf8');
    expect(src).toMatch(/userAgent: String\(req\?\.headers\?\.\['user-agent'\]/);
    expect(src).toMatch(/deviceName: typeof b\?\.device\?\.name === 'string'/);
    expect(src).toMatch(/\['ios', 'android', 'web'\]\.includes\(b\?\.device\?\.platform\)/);
  });
});
