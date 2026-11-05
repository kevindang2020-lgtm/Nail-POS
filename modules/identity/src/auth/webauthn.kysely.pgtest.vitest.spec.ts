// webauthn.kysely.pgtest.vitest.spec.ts — the Face ID persistence, against the REAL schema.
//
// The standing lesson of this codebase: **a fake repository cannot see a column type.** The login-audit sink
// looked correct and unit-tested green, yet silently lost every record in production because `ip_address` is
// INET and Express hands you a proxy chain. These ports swallow errors the same way, so the same trap applies —
// and here the failure modes LIE to the user:
//
//   • `creds.save()` silently failing → the app says "Face ID is enabled", nothing was stored, and biometric
//     sign-in can never work. The customer has no idea why.
//   • `challenges.put()` silently failing → `consume()` finds nothing, and every enrollment fails with a
//     meaningless error.
//   • `challenges.consume()` not marking the row → a challenge could be REPLAYED. That is a security hole, not
//     just a bug.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { makeWebAuthnPorts } from './webauthn.kysely';
import type { Ports } from './webauthn.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
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

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = 'cccccccc-1111-1111-1111-111111111111';
const OTHER = 'cccccccc-2222-2222-2222-222222222222';

let db: Kysely<any>;
let ports: Ports;
const rows = async (q: string): Promise<any[]> => ((await sql.raw(q).execute(db)) as any).rows;

beforeAll(async () => {
  const pg = new PGlite();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* native */ }
  // The REAL tables — note sign_count is BIGINT and the audit sink writes to audit_logs.
  await pg.exec(`
    create table tenants (id uuid primary key, tenant_code text, tenant_slug text, display_name text);
    create table users (
      id uuid primary key, tenant_id uuid, branch_id uuid, role text not null, status text default 'active',
      full_name text, email text, normalized_phone text);
    create table webauthn_credentials (
      id uuid primary key default gen_random_uuid(), tenant_id uuid, user_id uuid not null,
      credential_id text not null unique, public_key text not null, sign_count bigint not null default 0,
      transports text, device_label text, last_used_at timestamptz, revoked_at timestamptz,
      created_at timestamptz default now());
    create table webauthn_challenges (
      id uuid primary key default gen_random_uuid(), handle text not null unique, user_id uuid, tenant_id uuid,
      challenge text not null, purpose text not null, expires_at timestamptz not null,
      consumed_at timestamptz, created_at timestamptz default now());
    create table audit_logs (
      id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, user_id uuid, role text,
      action_type text, entity_type text, entity_id uuid, metadata_json jsonb, created_at timestamptz default now());
    insert into tenants (id, tenant_code, tenant_slug, display_name) values ('${TENANT}', 'LUXE', 'luxe', 'Luxe Nails');
    insert into users (id, tenant_id, role, full_name, email, normalized_phone)
      values ('${USER}', '${TENANT}', 'CUSTOMER', 'Sam Client', 'sam@example.com', '+18565551234'),
             ('${OTHER}', '${TENANT}', 'CUSTOMER', 'Other Person', 'other@example.com', '+18565559999');
  `);
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg),
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  // no SessionStore + no DATABASE_URL → allowed (dev path); the fail-loud guard is tested separately
  ports = makeWebAuthnPorts(db as any);
});

describe('credential storage really persists (or "Face ID enabled" is a lie)', () => {
  it('save() WRITES the credential — otherwise enrollment reports success and stores nothing', async () => {
    await ports.creds.save({
      credentialId: 'cred-abc', userId: USER, tenantId: TENANT, publicKey: 'pk-1', signCount: 0,
      transports: 'internal', deviceLabel: 'iPhone',
    });
    const found = await ports.creds.findByCredentialId('cred-abc');
    expect(found, 'creds.save() silently no-opped — Face ID could never sign anyone in').toBeTruthy();
    expect(found!.userId).toBe(USER);
    expect(found!.publicKey).toBe('pk-1');
    expect(found!.signCount).toBe(0);
  });

  it('listByUser returns it, scoped to the tenant', async () => {
    const list = await ports.creds.listByUser(TENANT, USER);
    expect(list.map((c) => c.credentialId)).toContain('cred-abc');
    expect(await ports.creds.listByUser(TENANT, OTHER)).toHaveLength(0);   // never another user's credential
  });

  it('sign_count is BIGINT — a large counter must not be mangled (clone detection depends on it)', async () => {
    await ports.creds.updateSignCount('cred-abc', 4_000_000_000);
    const found = await ports.creds.findByCredentialId('cred-abc');
    expect(found!.signCount).toBe(4_000_000_000);      // a 32-bit truncation here would break clone detection
  });

  it('a REVOKED credential disappears from lookups', async () => {
    await rows(`update webauthn_credentials set revoked_at = now() where credential_id = 'cred-abc'`);
    expect(await ports.creds.findByCredentialId('cred-abc')).toBeNull();
    expect(await ports.creds.listByUser(TENANT, USER)).toHaveLength(0);
    await rows(`update webauthn_credentials set revoked_at = null where credential_id = 'cred-abc'`);
  });
});

describe('challenges: single use, or they can be REPLAYED', () => {
  it('put() then consume() round-trips', async () => {
    await ports.challenges.put('h-1', { challenge: 'chal-1', userId: USER, tenantId: TENANT, purpose: 'register', expiresAt: Date.now() + 300_000 });
    const c = await ports.challenges.consume('h-1');
    expect(c, 'challenges.put() silently no-opped — every enrollment would fail').toBeTruthy();
    expect(c!.challenge).toBe('chal-1');
    expect(c!.purpose).toBe('register');
    expect(c!.userId).toBe(USER);
  });

  it('SECURITY: a consumed challenge cannot be consumed AGAIN (no replay)', async () => {
    expect(await ports.challenges.consume('h-1')).toBeNull();
    const r = await rows(`select consumed_at from webauthn_challenges where handle = 'h-1'`);
    expect(r[0].consumed_at, 'consume() did not mark the row — the challenge could be replayed').toBeTruthy();
  });

  it('an authentication challenge may carry no user (discoverable credential)', async () => {
    await ports.challenges.put('h-2', { challenge: 'chal-2', userId: null, tenantId: null, purpose: 'authenticate', expiresAt: Date.now() + 300_000 });
    const c = await ports.challenges.consume('h-2');
    expect(c).toBeTruthy();
    expect(c!.userId).toBeNull();
  });
});

describe('users + tenants lookups', () => {
  it('findById returns the active user', async () => {
    const u = await ports.users.findById(USER);
    expect(u!.userId).toBe(USER);
    expect(u!.tenantId).toBe(TENANT);
  });

  it('findForAuthn matches by email OR phone, scoped to the tenant', async () => {
    expect((await ports.users.findForAuthn(TENANT, 'sam@example.com'))!.userId).toBe(USER);
    expect((await ports.users.findForAuthn(TENANT, '+18565551234'))!.userId).toBe(USER);
    expect(await ports.users.findForAuthn(TENANT, 'nobody@example.com')).toBeNull();
  });

  it('resolveId maps a salon code or slug to its tenant', async () => {
    expect(await ports.tenants.resolveId('LUXE')).toBe(TENANT);
    expect(await ports.tenants.resolveId('luxe')).toBe(TENANT);
    expect(await ports.tenants.resolveId('nope')).toBeNull();
  });
});

describe('the audit sink actually writes', () => {
  it('records a webauthn event to audit_logs', async () => {
    await ports.audit.record({ actionType: 'passkey_registration_started', userId: USER, tenantId: TENANT, metadata: { device: 'iPhone' } });
    const r = await rows(`select action_type, user_id, tenant_id from audit_logs where action_type like 'webauthn.%'`);
    expect(r, 'the webauthn audit sink silently no-opped').toHaveLength(1);
    expect(r[0].action_type).toBe('webauthn.passkey_registration_started');
    expect(r[0].user_id).toBe(USER);
  });

  it('a NULL tenant (platform-level event) does not destroy the record', async () => {
    const before = (await rows(`select id from audit_logs`)).length;
    await ports.audit.record({ actionType: 'passkey_authentication_started', userId: USER, tenantId: null, metadata: {} });
    expect((await rows(`select id from audit_logs`)).length).toBe(before + 1);
  });
});
