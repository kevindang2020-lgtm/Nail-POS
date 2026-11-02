// customer-activation.pgtest.vitest.spec.ts — runs the REAL KyselyActivationRepo against the REAL schema.
//
// Why this matters more than it looks: the repository's `exec()` helper (the platform's established pattern)
// SWALLOWS errors. So a single mistyped column would make every write a silent no-op — and the failure mode is
// nasty: `storeCode` quietly does nothing, the SMS still goes out, `latestCode` returns null, and the customer is
// told "this code has expired, request a new one" **forever**. They could never activate, and nothing would show
// up as an error anywhere.
//
// Unit tests with an in-memory repo cannot catch that: they never touch the schema. This runs the actual SQL.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyActivationRepo } from './customer-activation.repository';

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

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
const C1 = 'aaaaaaaa-1111-1111-1111-111111111111';
const C2 = 'aaaaaaaa-2222-2222-2222-222222222222';
const PHONE = '+18565551234';

let repo: KyselyActivationRepo;
let db: Kysely<any>;

beforeAll(async () => {
  const pg = new PGlite();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* native */ }

  // The real shape of the tables this repo touches.
  await pg.exec(`
    create table tenants (id uuid primary key, display_name text not null);
    create table customers (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid,
      first_name text, last_name text, full_name text, email text,
      normalized_phone text, status text default 'active', archived_at timestamptz,
      phone_verified_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    create table users (
      id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, role text not null,
      status text default 'active', first_name text, last_name text, full_name text, email text,
      normalized_phone text, password_hash text, created_at timestamptz default now(), updated_at timestamptz default now());
    create table customer_phone_verifications (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid not null,
      destination text not null, code_hash text not null, expires_at timestamptz not null,
      consumed_at timestamptz, attempts int not null default 0, created_at timestamptz default now());
    -- Phase 3 (E14): the lookup also reads the customer's phone rows (a staff-typed, never-proved number is no claim key)
    create table customer_phones (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid not null,
      normalized_phone text not null, status text not null, verification_provider text);
  `);
  // …then the real migration that makes it work pre-auth.
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/364_customer_activation.sql`, 'utf8'));

  await pg.exec(`
    insert into tenants (id, display_name) values ('${T1}', 'Polished'), ('${T2}', 'Luxe Nails');
    insert into customers (id, tenant_id, branch_id, full_name, email, normalized_phone)
      values ('${C1}', '${T1}', null, 'Sam Client', 'sam@example.com', '${PHONE}'),
             ('${C2}', '${T2}', null, 'Sam Client', null, '${PHONE}');
  `);

  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg),
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  repo = new KyselyActivationRepo(db as any);
});

describe('directory lookup (real SQL)', () => {
  it('finds the customer in EVERY salon that knows the number', async () => {
    const found = await repo.findByPhone(PHONE);
    expect(found).toHaveLength(2);
    expect(found.map((m) => m.salonName).sort()).toEqual(['Luxe Nails', 'Polished']);
    expect(found.every((m) => !m.inactive)).toBe(true);
  });

  it('returns nothing for an unknown number (and does not throw)', async () => {
    expect(await repo.findByPhone('+19999999999')).toEqual([]);
  });

  it('excludes ARCHIVED salon records', async () => {
    await sqlExec(db, `update customers set archived_at = now() where id = '${C2}'`);
    const found = await repo.findByPhone(PHONE);
    expect(found.filter((m) => !m.inactive)).toHaveLength(1);
    await sqlExec(db, `update customers set archived_at = null where id = '${C2}'`);
  });
});

describe('OTP storage really persists (the exec() no-op trap)', () => {
  it('storeCode WRITES — latestCode reads it back', async () => {
    await repo.storeCode({ phone: PHONE, codeHash: 'hash-1', expiresAt: new Date(Date.now() + 600_000), ip: '1.2.3.4', deviceId: 'dev-1' });
    const c = await repo.latestCode(PHONE);
    expect(c, 'storeCode silently no-opped — the customer could NEVER activate').toBeTruthy();
    expect(c!.codeHash).toBe('hash-1');
    expect(c!.consumed).toBe(false);
    expect(c!.attempts).toBe(0);
  });

  it('bumpAttempts and consume actually update the row', async () => {
    const c = (await repo.latestCode(PHONE))!;
    await repo.bumpAttempts(c.id);
    expect((await repo.latestCode(PHONE))!.attempts).toBe(1);
    await repo.consume(c.id);
    expect((await repo.latestCode(PHONE))!.consumed).toBe(true);
  });

  it('a new code INVALIDATES the outstanding one (two live codes must never coexist)', async () => {
    await repo.invalidateOutstanding(PHONE);
    await repo.storeCode({ phone: PHONE, codeHash: 'hash-2', expiresAt: new Date(Date.now() + 600_000) });
    await repo.invalidateOutstanding(PHONE);
    await repo.storeCode({ phone: PHONE, codeHash: 'hash-3', expiresAt: new Date(Date.now() + 600_000) });

    const live = await sqlRows(db, `select code_hash from customer_phone_verifications
      where purpose = 'activation' and normalized_phone = '${PHONE}' and consumed_at is null`);
    expect(live).toHaveLength(1);
    expect(live[0].code_hash).toBe('hash-3');
  });

  it('source counts really query ip/device (per-IP + per-device throttle)', async () => {
    const c = await repo.sourceCounts('1.2.3.4', 'dev-1');
    expect(c.ipLastHour).toBeGreaterThanOrEqual(1);
    expect(c.deviceLastHour).toBeGreaterThanOrEqual(1);
    const none = await repo.sourceCounts('9.9.9.9', 'dev-none');
    expect(none.ipLastHour).toBe(0);
  });
});

describe('account linking (no duplicate customers)', () => {
  it('creates the login account from the EXISTING customer record — never a second profile', async () => {
    const match = { customerId: C1, tenantId: T1, branchId: null, salonName: 'Polished' };
    const linked = await repo.linkAccount(match, PHONE);
    expect(linked, 'linkAccount silently failed').toBeTruthy();
    expect(linked!.created).toBe(true);

    const users = await sqlRows(db, `select id, role, email, tenant_id from users where normalized_phone = '${PHONE}'`);
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe('CUSTOMER');
    expect(users[0].email).toBe('sam@example.com');       // copied from the existing customer profile
    expect(users[0].tenant_id).toBe(T1);

    // the customers table is untouched — no duplicate profile
    const custs = await sqlRows(db, `select id from customers where normalized_phone = '${PHONE}'`);
    expect(custs).toHaveLength(2);                        // still just the two original salon records
  });

  it('REUSES the account on a second activation — it does not create another', async () => {
    const match = { customerId: C1, tenantId: T1, branchId: null, salonName: 'Polished' };
    const again = await repo.linkAccount(match, PHONE);
    expect(again!.created).toBe(false);
    const users = await sqlRows(db, `select id from users where normalized_phone = '${PHONE}' and tenant_id = '${T1}'`);
    expect(users).toHaveLength(1);
  });

  it('markPhoneVerified actually stamps the customer row', async () => {
    await repo.markPhoneVerified({ customerId: C1, tenantId: T1, branchId: null, salonName: 'Polished' });
    const r = await sqlRows(db, `select phone_verified_at from customers where id = '${C1}'`);
    expect(r[0].phone_verified_at, 'markPhoneVerified silently no-opped').toBeTruthy();
  });
});

// small helpers
async function sqlRows(k: Kysely<any>, q: string): Promise<any[]> {
  const { sql } = await import('kysely');
  const r: any = await sql.raw(q).execute(k);
  return r.rows;
}
async function sqlExec(k: Kysely<any>, q: string): Promise<void> { await sqlRows(k, q); }

describe('Phase 3 (E14): a number staff typed WITHOUT an SMS is not a claim key (real SQL)', () => {
  it('a staff-override unverified row hides that salon\u2019s match; a proven row does not', async () => {
    await sqlExec(db, `insert into customer_phones (tenant_id, customer_id, normalized_phone, status, verification_provider) values ('${T2}', '${C2}', '${PHONE}', 'active_unverified', 'staff_override')`);
    expect((await repo.findByPhone(PHONE)).map((m) => m.salonName)).toEqual(['Polished']);
    await sqlExec(db, `update customer_phones set status = 'active_verified', verification_provider = 'twilio_verify' where customer_id = '${C2}'`);
    expect(await repo.findByPhone(PHONE)).toHaveLength(2);
    await sqlExec(db, `delete from customer_phones where customer_id = '${C2}'`);
  });
});

