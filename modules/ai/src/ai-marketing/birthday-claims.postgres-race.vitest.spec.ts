// birthday-claims.postgres-race — Birthday Campaigns guide (Oct 31 2026) §13–§14 (B17, B19) on REAL Postgres with REAL concurrency:
// one birthday message per customer per occasion year per channel, decided by the database BEFORE the provider is called.
//   • 3 birthday campaigns × 8 concurrent claims for the same customer over 4 sessions → exactly ONE allowed
//   • after that claim is released (a failed send), 8 concurrent re-claims → exactly ONE allowed again
//   • 20 customers claimed by 2 campaigns at once → 20 claims in all, one per customer, never two
// Data: fresh random salon / customers (the CI race database is shared); the claim rows stay (append-style history).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyOccasionGuard } from './ai-marketing-send.adapters';

const url = process.env.PG_RACE_URL;
const TAG = `bdr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID();
const CUST = Array.from({ length: 20 }, () => randomUUID());
const CAMPS = Array.from({ length: 3 }, () => randomUUID());

describe.skipIf(!url)('birthday message claims on real Postgres: one per customer per occasion year', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const guards = dbs.map((d) => new KyselyOccasionGuard(d));
  const ctx: any = { tenantId: T, branchId: B, userId: 'system', role: 'system', permissions: [] };
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-9).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    for (let i = 0; i < CUST.length; i++)
      await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in, birthday) values (${CUST[i]}, ${T}, ${B}, 'R', ${String(i)}, ${'R ' + i}, ${'+1215777' + String(1000 + i)}, true, ${'1990-' + String((i % 12) + 1).padStart(2, '0') + '-15'}::date)`);
    for (const c of CAMPS) await q(sql`insert into campaigns (id, tenant_id, branch_id, name, channel, status, audience_size, occasion) values (${c}, ${T}, ${B}, 'Birthdays', 'sms', 'scheduled', 0, 'birthday')`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('24 concurrent claims (3 campaigns × 8) for one customer over 4 sessions → exactly one allowed', async () => {
    const out = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => guards[i % 4].claim(ctx, CAMPS[i % 3], CUST[0], 'sms')));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const vals = out.map((o: any) => o.value);
    expect(vals.filter((v) => v.allowed).length).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from birthday_message_claims where tenant_id = ${T} and customer_id = ${CUST[0]} and channel = 'sms'`))[0].n)).toBe(1);
  });

  it('after a failed send releases it, 8 concurrent re-claims → exactly one allowed again', async () => {
    const row = (await q(sql`select id from birthday_message_claims where tenant_id = ${T} and customer_id = ${CUST[0]} and channel = 'sms'`))[0];
    await guards[0].settle(ctx, String(row.id), 'released');
    const out = await Promise.all(Array.from({ length: 8 }, (_, i) => guards[i % 4].claim(ctx, CAMPS[(i % 2) + 1], CUST[0], 'sms')));
    expect(out.filter((v) => v.allowed).length).toBe(1);
  });

  it('two birthday campaigns over the same 19 customers at once → 19 claims, one per customer', async () => {
    const rest = CUST.slice(1);
    const jobs = rest.flatMap((c, i) => [guards[i % 4].claim(ctx, CAMPS[0], c, 'sms'), guards[(i + 1) % 4].claim(ctx, CAMPS[1], c, 'sms')]);
    const out = await Promise.all(jobs);
    expect(out.filter((v) => v.allowed).length).toBe(19);
    const per = await q(sql`select customer_id, count(*)::int n from birthday_message_claims where tenant_id = ${T} and channel = 'sms' and customer_id = any(${rest}::uuid[]) group by customer_id`);
    expect(per.length).toBe(19); expect(per.every((r: any) => Number(r.n) === 1)).toBe(true);
  });
});
