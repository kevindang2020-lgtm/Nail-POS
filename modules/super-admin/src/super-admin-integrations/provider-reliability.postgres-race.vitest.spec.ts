// provider-reliability.postgres-race — BUILD_PLAN Phase 2: the durable integration-connection breaker on real Postgres.
// It now takes its decisions from THE breaker (circuit-breaker.ts), and the half-open probe is claimed atomically:
// before, every process that saw an expired open circuit flipped it to half_open and called the provider — N probes.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { ProviderReliabilityRepo } from './provider-reliability.kysely.repository';
import { ProviderReliabilityService } from './provider-reliability.service';

const url = process.env.PG_RACE_URL;
const hi = { limit: 10_000, windowSeconds: 60 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!url)('integration breaker on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 3 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk(), mk(), mk()] : [];
  const ids: string[] = [];
  afterAll(async () => {
    if (dbs[0] && ids.length) {
      await sql`delete from integration_circuit_breakers where connection_id = any(${ids}::uuid[])`.execute(dbs[0]);
      await sql`delete from integration_rate_limits where scope_key = any(${ids}) or scope_key like 'proof-provider-%'`.execute(dbs[0]);
    }
    await Promise.all(dbs.map((d) => d.destroy()));
  });
  const guard = (db: Kysely<any>) => new ProviderReliabilityService(new ProviderReliabilityRepo(db), undefined, { failureThreshold: 3, cooldownSeconds: 1, limits: { provider: hi, tenant: hi, connection: hi } });

  it('opens at the threshold and then refuses without calling the provider', async () => {
    const c = randomUUID(); ids.push(c);
    const g = guard(dbs[0]); let calls = 0;
    const ctx = { connectionId: c, providerKey: 'proof-provider-a', operation: 'sync' };
    for (let i = 0; i < 3; i++) await g.run(ctx, async () => { calls++; throw new Error('503 upstream'); });
    const r = await g.run(ctx, async () => { calls++; return 'x'; });
    expect(r).toMatchObject({ ok: false, blocked: 'circuit_open' });
    expect(calls).toBe(3);
  });

  it('six processes after the cooldown: exactly ONE probe reaches the provider; its success closes the circuit', async () => {
    const c = randomUUID(); ids.push(c);
    const ctx = { connectionId: c, providerKey: 'proof-provider-b', operation: 'sync' };
    for (let i = 0; i < 3; i++) await guard(dbs[0]).run(ctx, async () => { throw new Error('503 upstream'); });
    await sleep(1_100);
    let probes = 0;
    const outs = await Promise.all(dbs.map((db) => guard(db).run(ctx, async () => { probes++; await sleep(200); return 'ok'; })));
    expect(probes).toBe(1);
    expect(outs.filter((o) => o.ok)).toHaveLength(1);
    expect(outs.filter((o) => o.blocked === 'circuit_open')).toHaveLength(5);
    const row: any = (await sql`select state, failure_count from integration_circuit_breakers where connection_id = ${c}::uuid`.execute(dbs[0])).rows[0];
    expect(row).toMatchObject({ state: 'closed', failure_count: 0 });
  });

  it('the half-open probe slot is claimed atomically: six concurrent claims on an expired open circuit, ONE wins', async () => {
    const c = randomUUID(); ids.push(c);
    await sql`insert into integration_circuit_breakers (connection_id, state, failure_count, failure_threshold, cooldown_seconds, opened_at)
              values (${c}::uuid, 'open', 3, 3, 1, now() - interval '5 seconds')`.execute(dbs[0]);
    await Promise.all(dbs.map((db) => sql`select 1`.execute(db)));          // warm every pool: the claims race for real
    const wins = await Promise.all(dbs.map((db) => new ProviderReliabilityRepo(db).claimProbe(c)));
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(await new ProviderReliabilityRepo(dbs[0]).claimProbe(c)).toBe(false);   // in flight: nobody else probes
  });

  it('a probe whose process died (half_open, never reported) is reclaimable after the cooldown', async () => {
    const c = randomUUID(); ids.push(c);
    const ctx = { connectionId: c, providerKey: 'proof-provider-c', operation: 'sync' };
    for (let i = 0; i < 3; i++) await guard(dbs[0]).run(ctx, async () => { throw new Error('503 upstream'); });
    await sleep(1_100);
    expect(await new ProviderReliabilityRepo(dbs[1]).claimProbe(c)).toBe(true);        // the probe that will never report
    expect((await guard(dbs[2]).run(ctx, async () => 'ok')).blocked).toBe('circuit_open');
    await sleep(1_100);
    expect((await guard(dbs[2]).run(ctx, async () => 'ok')).ok).toBe(true);
  });
});
