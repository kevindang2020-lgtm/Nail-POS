// attempt-budget.postgres-race — Security Deep Scan C4 on REAL Postgres with real concurrency (opt-in: PG_RACE_URL).
// 40 concurrent wrong guesses for one account over two connection pools admit EXACTLY the budget: the advisory lock
// makes count-then-charge atomic, so parallel requests cannot multiply an attacker's guesses.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { PostgresAttemptBudget, ATTEMPT_LIMITS } from './auth-attempt-budget';

const url = process.env.PG_RACE_URL;
const T = 'ab100000-0000-4000-8000-0000000000c4', U = 'ab100000-0000-4000-8000-0000000000d4';

describe.skipIf(!url)('the attempt budget on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 10 }) }) });
  const a = url ? mk() : (null as any), b = url ? mk() : (null as any);
  beforeAll(async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'AB', 'AB', 'ab-race', 'ABRACE', 'active') on conflict (id) do nothing`.execute(a);
    await sql`insert into users (id, tenant_id, email, password_hash, status, role) values (${U}, ${T}, 'ab-race@example.test', 'x', 'active', 'MANAGER') on conflict (id) do nothing`.execute(a);
    await sql`delete from auth_events where user_id = ${U}::uuid`.execute(a);
  });
  afterAll(async () => { if (!a) return; await sql`delete from auth_events where user_id = ${U}::uuid`.execute(a); await a.destroy(); await b.destroy(); });

  it('40 concurrent wrong MFA guesses for one account admit EXACTLY the budget', async () => {
    const ba = new PostgresAttemptBudget(a), bb = new PostgresAttemptBudget(b);
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? ba : bb).admit('mfa', U)));
    const admitted = results.filter((r) => r.allowed);
    expect(admitted).toHaveLength(ATTEMPT_LIMITS.mfa.max);
    await Promise.all(admitted.map((r) => r.settle(false)));
    expect(results.filter((r) => !r.allowed).every((r) => r.retryAfterMs >= 1000 && r.retryAfterMs <= ATTEMPT_LIMITS.mfa.windowMs)).toBe(true);
    const n = (await sql<any>`select count(*)::int n from auth_events where user_id = ${U}::uuid and event_type = 'ATTEMPT_BUDGET_SPENT' and reason = 'mfa'`.execute(a)).rows[0].n;
    expect(n).toBe(ATTEMPT_LIMITS.mfa.max);
    expect((await ba.admit('mfa', U)).allowed).toBe(false);
  });
});
