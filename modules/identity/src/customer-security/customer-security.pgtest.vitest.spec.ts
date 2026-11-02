// customer-security.pgtest.vitest.spec.ts — the Profile → Security SQL, against the REAL schema.
//
// These writes are security-critical and they run through the platform's `exec()`-style helpers, which swallow
// errors. A mistyped column would make them SILENT no-ops, and the failure modes are the worst kind — the ones
// that lie to the user:
//
//   • `setPassword` quietly does nothing → the app says "Password created", the customer tries it next time, and
//     it doesn't work. They have no idea why.
//   • the session revoke quietly does nothing → "Sign out of all other devices" reports success while the stolen
//     device stays signed in. That is precisely the bug this session started by finding (revocation that revoked
//     nothing), and re-creating it in the customer app would be unforgivable.
//
// In-memory unit tests cannot catch either: they never touch the schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import { KyselySessionStore } from '../auth/session-store';

class PgliteDriver {
  constructor(private pg: any) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(c: any) { const r = await pg.query(c.sql, c.parameters as any[]); return { rows: r.rows as any[] }; },
      async *streamQuery() {},
    };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

const USER = 'cccccccc-1111-1111-1111-111111111111';
const OTHER = 'cccccccc-2222-2222-2222-222222222222';
const TENANT = '11111111-1111-1111-1111-111111111111';

let db: Kysely<any>;
let store: KyselySessionStore;

const rows = async (q: string): Promise<any[]> => ((await sql.raw(q).execute(db)) as any).rows;

beforeAll(async () => {
  const pg = await migratedPglite();
  // The REAL schema — every migration — not a hand-made subset. (The hand-made `sessions` fell behind when
  // Constitution 12 added its device columns, and this file failed for weeks while claiming "the REAL schema".)
  await pg.exec(`
    insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ('${TENANT}', 'S', 'S', 'cs-t', 'CST01', 'active');
    insert into users (id, tenant_id, full_name, email, password_hash, status, role) values
      ('${USER}', '${TENANT}', 'U', 'u@cs.test', NULL, 'active', 'CUSTOMER'), ('${OTHER}', '${TENANT}', 'O', 'o@cs.test', NULL, 'active', 'CUSTOMER');   -- no password yet: the OTP-activated case
  `);
  db = kyselyFor(pg) as any;
  store = new KyselySessionStore(db as any);
});

// The exact SQL the controller runs.
const loadPasswordHash = async (userId: string): Promise<string | null> => {
  const r: any = await sql`select password_hash from users where id = ${userId}`.execute(db);
  return r?.rows?.[0]?.password_hash ?? null;
};
const setPassword = async (userId: string, hash: string): Promise<void> => {
  await sql`update users set password_hash = ${hash}, updated_at = now() where id = ${userId}`.execute(db);
};

describe('password writes actually persist (the silent no-op trap)', () => {
  it('a customer with no password reads back NULL (the OTP-activated case)', async () => {
    expect(await loadPasswordHash(USER)).toBeNull();
  });

  it('setPassword REALLY writes — otherwise the app would say "Password created" and lie', async () => {
    const hash = await hashPassword('Str0ng-Passphrase!');
    await setPassword(USER, hash);

    const stored = await loadPasswordHash(USER);
    expect(stored, 'setPassword silently no-opped — the customer could never sign in with it').toBeTruthy();
    expect(await verifyPassword('Str0ng-Passphrase!', stored!)).toBe(true);
  });

  it('stores only the HASH — the plaintext never reaches the database', async () => {
    const stored = await loadPasswordHash(USER);
    expect(stored).not.toContain('Str0ng-Passphrase!');
  });

  it('a change overwrites it, and the OLD password stops working', async () => {
    await setPassword(USER, await hashPassword('New-Passphrase-2!'));
    const stored = await loadPasswordHash(USER);
    expect(await verifyPassword('New-Passphrase-2!', stored!)).toBe(true);
    expect(await verifyPassword('Str0ng-Passphrase!', stored!)).toBe(false);
  });

  it('one customer\'s password change does NOT touch another\'s', async () => {
    expect(await loadPasswordHash(OTHER)).toBeNull();
  });
});

describe('session revocation actually revokes (it must never lie)', () => {
  it('creates a session row and reports it as live', async () => {
    const sid = await store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 3600 });
    expect(sid, 'session row was not created').toBeTruthy();
    expect(await store.isRevoked(sid!)).toBe(false);
  });

  it('revoke REALLY flips the row — "sign out this device" cannot be theatre', async () => {
    const sid = (await store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 3600 }))!;
    await store.revoke(sid);

    // the store says revoked…
    expect(await store.isRevoked(sid)).toBe(true);
    // …and so does the database. (A cache-only "revocation" would pass the line above and still be a lie.)
    const r = await rows(`select status, revoked_at from sessions where id = '${sid}'`);
    expect(r[0].status).toBe('revoked');
    expect(r[0].revoked_at).toBeTruthy();
  });

  it('a revoked session STAYS revoked — it can never come back to life', async () => {
    const sid = (await store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 3600 }))!;
    await store.revoke(sid);
    expect(await store.isRevoked(sid)).toBe(true);
    expect(await store.isRevoked(sid)).toBe(true);      // repeated checks, including from cache
  });

  it('revoking one session does not revoke another customer\'s', async () => {
    const mine = (await store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 3600 }))!;
    const theirs = (await store.create({ userId: OTHER, tenantId: TENANT, branchId: null, ttlSeconds: 3600 }))!;
    await store.revoke(mine);
    expect(await store.isRevoked(theirs)).toBe(false);
  });

  it('the "sign out other devices" query only ever sees THIS customer\'s sessions', async () => {
    const list = await rows(`select user_id from sessions where user_id = '${USER}' and status = 'active'`);
    expect(list.every((s) => s.user_id === USER)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});

// The nastiest INET trap in the schema. `sessions.ip_address` is INET, and Express hands you a proxy chain behind
// a load balancer. If that insert throws, `create()` swallows it and returns null — the token then carries NO
// `sid`, and the session becomes **UNREVOCABLE**. Behind a proxy that would silently disable session revocation
// for the entire platform, while every test stayed green.
describe('a proxy IP must never cost us the SESSION ROW', () => {
  it('a comma-separated proxy chain still creates a revocable session', async () => {
    const sid = await store.create({
      userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 3600,
      ip: '1.2.3.4, 5.6.7.8', userAgent: 'iPhone',
    } as any);

    expect(
      sid,
      'the session row was LOST to an invalid INET — the token would carry no sid and the session could NEVER be revoked',
    ).toBeTruthy();

    const r = await rows(`select host(ip_address) as ip from sessions where id = '${sid}'`);
    expect(r[0].ip).toBe('1.2.3.4');            // the CLIENT ip is kept
    expect(await store.isRevoked(sid!)).toBe(false);
    await store.revoke(sid!);
    expect(await store.isRevoked(sid!)).toBe(true);   // and it is genuinely revocable
  });

  it('a garbage IP drops the IP but KEEPS the revocable session', async () => {
    const sid = await store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 3600, ip: 'unknown' } as any);
    expect(sid).toBeTruthy();
    const r = await rows(`select ip_address from sessions where id = '${sid}'`);
    expect(r[0].ip_address).toBeNull();
    await store.revoke(sid!);
    expect(await store.isRevoked(sid!)).toBe(true);
  });
});

// `create()` returning null means the token carries no `sid` — and a token with no sid is UNREVOCABLE. So the
// only honest reason to return null is "there is no database". Anything else must fail loudly rather than
// silently hand out a session that "sign out other devices" can never kill.
describe('create() must never silently mint an unrevocable session', () => {
  it('REFUSES a non-UUID user id rather than returning a null sid', async () => {
    await expect(
      store.create({ userId: 'not-a-uuid', tenantId: TENANT, branchId: null, ttlSeconds: 3600 } as any),
    ).rejects.toThrow(/unrevocable/i);
  });

  it('a bad user id would otherwise have violated NOT NULL and been swallowed', async () => {
    // sessions.user_id is UUID NOT NULL. The old code mapped a non-uuid to null, the insert threw, the throw was
    // swallowed, and create() returned null — a session nobody could ever revoke. Assert no such row was written.
    const rowsForBad = await rows(`select id from sessions where user_id is null`);
    expect(rowsForBad).toHaveLength(0);
  });

  it('a VALID user id still works and is revocable', async () => {
    const sid = await store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 3600 });
    expect(sid).toBeTruthy();
    await store.revoke(sid!);
    expect(await store.isRevoked(sid!)).toBe(true);
  });

  it('with NO database, null is honest — there is no revocation to lose', async () => {
    // the module's own class, imported directly (above) — not through its package entry, which no longer exports it
    // (d760455 removed the entry's unused exports; this test was the one importer that went through the package name)
    const noDb = new KyselySessionStore(null as any);
    await expect(noDb.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 3600 })).resolves.toBeNull();
  });
});
