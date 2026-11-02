// code-lookup-limit.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 14 (Constitution 12), migration 564: the
// lookup-by-code limit on a REAL Postgres (PG_RACE_URL) with real concurrency. The store is the production one.
//   • 40 concurrent wrong guesses by one caller over two connection pools: EXACTLY the caller budget is admitted
//   • a busy salon's peak (3 stations, hits with the odd typo) is never refused
//   • the refusal carries a Retry-After within the window; a hit costs 0.1; a neutral outcome is refunded
// Every time comparison is the database's own now() — no process clock is mixed in.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { CODE_LOOKUP_BUDGET, CODE_LOOKUP_WINDOW_MS, type CodeLookupKeys } from '@aipowersalon/security';
import { PostgresCodeLookupStore } from './code-lookup-limit.store';

const url = process.env.PG_RACE_URL;
const T1 = 'c1400000-0000-4000-8000-000000000001';
const TAG = `cl${process.pid}`;
const keys = (o: Partial<CodeLookupKeys> = {}): CodeLookupKeys => ({ kind: 'gift_card', caller: `user:${TAG}-a`, ip: `10.${process.pid % 250}.0.1`, tenantId: T1, ...o });

describe.skipIf(!url)('the lookup-by-code limit on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 10 }) }) });
  const a = url ? mk() : (null as any), b = url ? mk() : (null as any);
  const sa = url ? new PostgresCodeLookupStore(a) : (null as any), sb = url ? new PostgresCodeLookupStore(b) : (null as any);
  beforeAll(async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T1}, 'cl-one', 'cl-one', 'cl-one', 'CLONE', 'active') on conflict (id) do nothing`.execute(a);
  });
  beforeEach(async () => { await sql`delete from code_lookup_attempts where tenant_id = ${T1}::uuid or caller_key like ${'user:' + TAG + '%'}`.execute(a); });
  afterAll(async () => { if (!a) return; await sql`delete from code_lookup_attempts where tenant_id = ${T1}::uuid or caller_key like ${'user:' + TAG + '%'}`.execute(a); await a.destroy(); await b.destroy(); });

  it('40 concurrent wrong guesses by one caller admit EXACTLY the caller budget', async () => {
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? sa : sb).admit(keys())));
    const admitted = results.filter((r) => r.allowed);
    expect(admitted.length).toBe(CODE_LOOKUP_BUDGET.caller);
    await Promise.all(admitted.map((r) => sa.settle(r.attemptId!, 'miss')));
    const refused = results.filter((r) => !r.allowed);
    expect(refused.every((r) => r.blockedBy === 'caller' && r.retryAfterMs >= 1000 && r.retryAfterMs <= CODE_LOOKUP_WINDOW_MS)).toBe(true);
    const n = (await sql<any>`select count(*)::int n, sum(weight)::float8 w from code_lookup_attempts where caller_key = ${keys().caller}`.execute(a)).rows[0];
    expect(n).toEqual({ n: CODE_LOOKUP_BUDGET.caller, w: CODE_LOOKUP_BUDGET.caller });
  });

  it('concurrent guesses by 80 rotating users at one salon stop at the salon budget', async () => {
    const results = await Promise.all(Array.from({ length: 80 }, (_, i) => (i % 2 ? sa : sb).admit(keys({ caller: `user:${TAG}-r${i}`, ip: `192.0.2.${i}` }))));
    expect(results.filter((r) => r.allowed).length).toBe(CODE_LOOKUP_BUDGET.tenant);
    expect(results.filter((r) => !r.allowed).every((r) => r.blockedBy === 'tenant')).toBe(true);
  });

  it('a busy salon at its peak: 3 stations, 30 lookups each with 2 typos — nothing refused', async () => {
    let refused = 0;
    await Promise.all(['s1', 's2', 's3'].map(async (st) => {
      for (let i = 0; i < 32; i++) {
        const r = await (st === 's2' ? sb : sa).admit(keys({ caller: `user:${TAG}-${st}` }));
        if (!r.allowed) { refused++; continue; }
        await sa.settle(r.attemptId!, i % 16 === 15 ? 'miss' : 'hit');
      }
    }));
    expect(refused).toBe(0);
    const w = (await sql<any>`select sum(weight)::float8 w from code_lookup_attempts where tenant_id = ${T1}::uuid`.execute(a)).rows[0].w;
    expect(w).toBeCloseTo(3 * (30 * 0.1 + 2 * 1), 5);   // the stored weights are the model's
  });

  it('a neutral outcome is refunded (the row is gone); settle never touches a row twice', async () => {
    const r = await sa.admit(keys());
    await sa.settle(r.attemptId!, 'neutral');
    expect((await sql<any>`select count(*)::int n from code_lookup_attempts where caller_key = ${keys().caller}`.execute(a)).rows[0].n).toBe(0);
    const h = await sa.admit(keys());
    await sa.settle(h.attemptId!, 'hit'); await sa.settle(h.attemptId!, 'miss');   // second settle is a no-op
    expect((await sql<any>`select outcome, weight::float8 w from code_lookup_attempts where id = ${h.attemptId}::bigint`.execute(a)).rows[0]).toEqual({ outcome: 'hit', w: 0.1 });
  });

  it('rows outside the window no longer count (aged with the database clock)', async () => {
    for (let i = 0; i < CODE_LOOKUP_BUDGET.caller; i++) { const r = await sa.admit(keys()); await sa.settle(r.attemptId!, 'miss'); }
    expect((await sa.admit(keys())).allowed).toBe(false);
    await sql`update code_lookup_attempts set created_at = created_at - interval '16 minutes' where caller_key = ${keys().caller}`.execute(a);
    expect((await sa.admit(keys())).allowed).toBe(true);
  });
});
