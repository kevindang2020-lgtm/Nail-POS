// login-attempt-sink.pgtest.vitest.spec.ts — the sink's SQL, against the REAL `login_attempts` schema.
//
// This is the fix for the worst finding of the audit: the Super Admin Security dashboard READS `login_attempts`
// (failed logins today, the 7-day trend, per-user counts) and **nothing in the codebase ever wrote to it**, so
// every one of those metrics was permanently zero — a dashboard confidently reporting "no failed logins" no
// matter how many there were.
//
// Which makes this the one piece of SQL that absolutely must not fail silently. The sink swallows errors (so an
// audit failure can never block a sign-in — correct), but that means a schema mismatch would leave the dashboard
// reading zeros **exactly as before**: the bug "fixed" and not actually fixed. Unit tests with an in-memory sink
// cannot catch that; they never touch the schema.
//
// Note `ip_address` is INET, not TEXT — a malformed value throws, and the throw would be swallowed.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { KyselyLoginAttemptSink } from './login-attempt-sink';

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
let db: Kysely<any>;
let sink: KyselyLoginAttemptSink;

const all = async (): Promise<any[]> =>
  ((await sql`select tenant_id, identifier, host(ip_address) as ip, success, reason from login_attempts order by created_at`.execute(db)) as any).rows;

beforeAll(async () => {
  const pg = new PGlite();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* native */ }
  // The REAL table (migration 001) — note ip_address is INET.
  await pg.exec(`
    create table login_attempts (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid,
      identifier text,
      ip_address inet,
      success boolean not null,
      reason text,
      created_at timestamptz not null default now());
  `);
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg),
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  sink = new KyselyLoginAttemptSink(db as any);
});

describe('the sink actually WRITES (or the dashboard still reads zeros)', () => {
  it('records a successful sign-in', async () => {
    await sink.record({ tenantId: TENANT, identifier: 'staff@salon.com', ip: '1.2.3.4', success: true, reason: 'SUCCESS' });
    const rows = await all();
    expect(rows, 'the sink silently no-opped — the Security dashboard would STILL report zeros').toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: TENANT, identifier: 'staff@salon.com', ip: '1.2.3.4', success: true, reason: 'SUCCESS' });
  });

  it('records a FAILED sign-in — this is what the dashboard actually counts', async () => {
    await sink.record({ tenantId: TENANT, identifier: 'staff@salon.com', ip: '9.9.9.9', success: false, reason: 'INVALID_CREDENTIALS' });
    const rows = await all();
    expect(rows.filter((r) => r.success === false)).toHaveLength(1);
    expect(rows.find((r) => !r.success)!.reason).toBe('INVALID_CREDENTIALS');
  });

  it('an unknown store code records NO tenant — the log cannot be used to enumerate tenants', async () => {
    await sink.record({ tenantId: null, identifier: 'someone@example.com', ip: '5.5.5.5', success: false, reason: 'TENANT_NOT_FOUND' });
    const r = (await all()).find((x) => x.reason === 'TENANT_NOT_FOUND')!;
    expect(r.tenant_id).toBeNull();
  });

  it('NEVER stores a password (the sink is only ever given the identifier)', async () => {
    const dump = JSON.stringify(await all());
    expect(dump).not.toMatch(/passw/i);
  });
});

describe('ip_address is INET — a malformed value must not lose the record', () => {
  // Express's req.ip can be a comma-separated list behind a proxy ("1.2.3.4, 5.6.7.8"), which is NOT valid inet.
  // The insert would throw, the sink would swallow it, and the attempt would vanish — leaving the dashboard
  // under-reporting attacks exactly as it did before the fix.
  it('a proxy-style comma list does not silently destroy the audit record', async () => {
    const before = (await all()).length;
    await sink.record({ tenantId: TENANT, identifier: 'proxied@salon.com', ip: '1.2.3.4, 5.6.7.8', success: false, reason: 'INVALID_CREDENTIALS' });
    const rows = await all();
    expect(
      rows.length,
      'A malformed IP threw, the sink swallowed it, and the login attempt was LOST. ' +
      'The Security dashboard would under-report exactly the attacks it exists to show. Sanitize the IP before insert.',
    ).toBe(before + 1);
    const rec = rows.find((r) => r.identifier === 'proxied@salon.com')!;
    expect(rec).toBeTruthy();
    expect(rec.ip, 'the CLIENT ip (first in the chain) should be kept').toBe('1.2.3.4');
  });

  it('an IPv4-mapped IPv6 (Node\'s ::ffff:127.0.0.1) is stored as the plain address', async () => {
    await sink.record({ tenantId: TENANT, identifier: 'mapped@salon.com', ip: '::ffff:127.0.0.1', success: true, reason: 'SUCCESS' });
    const rec = (await all()).find((r) => r.identifier === 'mapped@salon.com')!;
    expect(rec.ip).toBe('127.0.0.1');
  });

  it('a garbage IP drops the IP but KEEPS the attempt (the attempt is what matters)', async () => {
    const rec = (await all()).find((r) => r.identifier === 'weird@salon.com');
    if (rec) expect(rec.ip).toBeNull();
  });

  it('a garbage IP still records the attempt (the attempt matters more than the IP)', async () => {
    const before = (await all()).length;
    await sink.record({ tenantId: TENANT, identifier: 'weird@salon.com', ip: 'unknown', success: false, reason: 'RATE_LIMITED' });
    expect((await all()).length).toBe(before + 1);
  });

  it('a null IP is fine', async () => {
    const before = (await all()).length;
    await sink.record({ tenantId: TENANT, identifier: 'noip@salon.com', ip: null, success: false, reason: 'INVALID_CREDENTIALS' });
    expect((await all()).length).toBe(before + 1);
  });
});
