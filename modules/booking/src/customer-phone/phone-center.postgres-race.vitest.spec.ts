// phone-center.postgres-race — Phone Number Management Complete Build Guide §05 "concurrent operations" / §12 invariants, on REAL Postgres
// with four real sessions. The service-level races (two terminals start at once, the same code twice, a profile edit mid-check) are in
// customer-phone.postgres-race (it needs the Kysely query builder: CI). This file proves the DATABASE backstops they rely on, with raw
// SQL that writes exactly what the service writes — so the invariants hold even if a future code path forgets its lock:
//   • eight terminals open a change for the same customer at once → exactly ONE open request (uq_cpus_one_open)
//   • eight terminals add a pending number for the same customer at once → exactly ONE pending number (uq_customer_phones_one_pending)
//   • eight activations at once → exactly ONE active number (uq_customer_phones_one_active) — never two trusted numbers
//   • the same idempotency key replayed eight times → ONE request (uq_cpus_idempotency)
// Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { phoneKey, maskPhone } from '@aipowersalon/customers';

const url = process.env.PG_RACE_URL;
const T = randomUUID(), B = randomUUID();
const TAG = `pcr${process.pid}`;

describe.skipIf(!url)('phone numbers under real concurrency (database backstops)', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const one = (i: number) => dbs[i % dbs.length];
  let seq = 0;
  async function customer() {
    const p = `+1609555${String(1000 + ++seq).slice(-4)}`;
    const id = String((await sql<any>`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values (${T}, ${B}, 'Race', ${TAG + seq}, ${'Race ' + seq}, ${p}) returning id`.execute(dbs[0])).rows[0].id);
    return { id, phone: p };
  }
  const settled = (xs: PromiseSettledResult<unknown>[]) => ({ ok: xs.filter((x) => x.status === 'fulfilled').length, err: xs.filter((x) => x.status === 'rejected').map((x: any) => String(x.reason?.code ?? x.reason?.message ?? x.reason)) });

  beforeAll(async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(0, 12)}, 'active')`.execute(dbs[0]);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`.execute(dbs[0]);
  });
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('eight terminals open a change for one customer at once → exactly one open request; the rest are refused, not duplicated', async () => {
    const c = await customer();
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => {
      const np = `+1609777${String(2000 + i)}`;
      return sql`insert into customer_phone_update_sessions (tenant_id, branch_id, customer_id, proposed_phone, proposed_phone_hash, proposed_phone_mask, state, update_source, expires_at)
        values (${T}, ${B}, ${c.id}, ${np}, ${phoneKey(np)}, ${maskPhone(np)}, 'pending_phone_saved', 'staff_pos', now() + interval '30 minutes')`.execute(one(i));
    }));
    const r = settled(out);
    expect(r.ok).toBe(1);
    expect(r.err.every((e) => e === '23505' || /unique|duplicate/i.test(e))).toBe(true);
    const open = (await sql<any>`select count(*)::int n from customer_phone_update_sessions where tenant_id = ${T} and customer_id = ${c.id} and completed_at is null`.execute(dbs[0])).rows[0].n;
    expect(Number(open)).toBe(1);
  });

  it('eight pending numbers at once for one customer → exactly one pending number', async () => {
    const c = await customer();
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => {
      const np = `+1609888${String(3000 + i)}`;
      return sql`insert into customer_phones (tenant_id, customer_id, normalized_phone, phone_mask, phone_hash, status, update_source)
        values (${T}, ${c.id}, ${np}, ${maskPhone(np)}, ${phoneKey(np)}, 'pending_verification', 'staff_pos')`.execute(one(i));
    }));
    expect(settled(out).ok).toBe(1);
    expect(Number((await sql<any>`select count(*)::int n from customer_phones where tenant_id = ${T} and customer_id = ${c.id} and status = 'pending_verification'`.execute(dbs[0])).rows[0].n)).toBe(1);
  });

  it('eight activations at once → exactly one trusted (active) number, never two', async () => {
    const c = await customer();
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => {
      const np = `+1609999${String(4000 + i)}`;
      return sql`insert into customer_phones (tenant_id, customer_id, normalized_phone, phone_mask, phone_hash, status, verification_provider, verified_at, update_source)
        values (${T}, ${c.id}, ${np}, ${maskPhone(np)}, ${phoneKey(np)}, 'active_verified', 'twilio_verify', now(), 'staff_pos')`.execute(one(i));
    }));
    expect(settled(out).ok).toBe(1);
    expect(Number((await sql<any>`select count(*)::int n from customer_phones where tenant_id = ${T} and customer_id = ${c.id} and status in ('active_verified', 'active_unverified')`.execute(dbs[0])).rows[0].n)).toBe(1);
  });

  it('the same idempotency key replayed eight times at once → one request', async () => {
    const c = await customer();
    const key = `${TAG}-idem-1`;
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => {
      const np = '+16095550777';
      return sql`insert into customer_phone_update_sessions (tenant_id, branch_id, customer_id, proposed_phone, proposed_phone_hash, proposed_phone_mask, state, update_source, idempotency_key, expires_at)
        values (${T}, ${B}, ${c.id}, ${np}, ${phoneKey(np)}, ${maskPhone(np)}, 'pending_phone_saved', 'staff_pos', ${key}, now() + interval '30 minutes')
        on conflict do nothing`.execute(one(i));
    }));
    expect(settled(out).err).toEqual([]);
    expect(Number((await sql<any>`select count(*)::int n from customer_phone_update_sessions where tenant_id = ${T} and idempotency_key = ${key}`.execute(dbs[0])).rows[0].n)).toBe(1);
  });
});
