// ai-calls.postgres-race — AI Calls guide §14 / §22 on REAL Postgres with REAL concurrency (four sessions):
//   • the same provider event delivered 8× at once → ONE event row (deliveries = 8) and ONE call record
//   • call_started / call_ended for a brand-new call racing each other → ONE call record that converges to ended
//   • the same tool request retried 6× at once → ONE ledger row (requests = 6)
// Fresh random salon per run (the CI race database is shared). Event / ledger rows are history and stay.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { AiCallsIngest } from './ai-calls-ingest';

const url = process.env.PG_RACE_URL;
const TAG = `acr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID();
const AGENT = `agent_${TAG}`;

describe.skipIf(!url)('AI Calls ingestion on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const ing = dbs.map((d) => new AiCallsIngest(d));
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const body = (event: string, callId: string, c: Record<string, unknown> = {}) => ({ event, call: { call_id: callId, agent_id: AGENT, ...c } });

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values (${T}, ${B}, 'race agent', 'live', 'retell', ${AGENT})`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('8 simultaneous deliveries of one event → one event row (8 deliveries) and one call record', async () => {
    const b = body('call_ended', `${TAG}-c1`, { start_timestamp: Date.now() - 600_000, end_timestamp: Date.now() - 300_000, duration_ms: 300_000 });
    const raw = JSON.stringify(b);
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => ing[i % 4].applyRetellEvent(raw, JSON.parse(raw))));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    expect(out.filter((o: any) => o.value.duplicate).length).toBe(7);
    const e = (await q(sql`select count(*)::int n, max(deliveries)::int d from voice_call_events where tenant_id = ${T} and provider_call_id = ${`${TAG}-c1`}`))[0];
    expect({ n: Number(e.n), d: Number(e.d) }).toEqual({ n: 1, d: 8 });
    expect(Number((await q(sql`select count(*)::int n from voice_call_outcomes where tenant_id = ${T} and provider_call_id = ${`${TAG}-c1`}`))[0].n)).toBe(1);
  });

  it('start and end of a NEW call racing each other converge to one ended record', async () => {
    const ref = `${TAG}-c2`; const st = Date.now() - 900_000;
    const evs = [body('call_started', ref, { start_timestamp: st }), body('call_ended', ref, { start_timestamp: st, end_timestamp: st + 240_000, duration_ms: 240_000 }),
      body('call_analyzed', ref, { start_timestamp: st, end_timestamp: st + 240_000, call_analysis: { call_summary: 'Asked about gel prices' } })];
    const out = await Promise.allSettled([...evs, ...evs].map((b, i) => { const raw = JSON.stringify(b); return ing[i % 4].applyRetellEvent(raw, JSON.parse(raw)); }));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const rows = await q(sql`select started_at, ended_at, duration_seconds, summary from voice_call_outcomes where tenant_id = ${T} and provider_call_id = ${ref}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].started_at).not.toBeNull(); expect(rows[0].ended_at).not.toBeNull(); expect(Number(rows[0].duration_seconds)).toBe(240); expect(rows[0].summary).toBe('Asked about gel prices');
    expect(Number((await q(sql`select count(*)::int n from voice_call_events where tenant_id = ${T} and provider_call_id = ${ref}`))[0].n)).toBe(3);
  });

  it('the same tool request retried 6× at once → one ledger row', async () => {
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => ing[i % 4].toolRequested({ tenantId: T, branchId: B }, `${TAG}-c2`, 'hold_slot', 'write', '{"same":true}')));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    expect(out.filter((o: any) => o.value && !o.value.repeat).length).toBe(1);
    const r = (await q(sql`select count(*)::int n, max(requests)::int k from voice_tool_executions where tenant_id = ${T} and provider_call_id = ${`${TAG}-c2`}`))[0];
    expect({ n: Number(r.n), k: Number(r.k) }).toEqual({ n: 1, k: 6 });
  });
});
