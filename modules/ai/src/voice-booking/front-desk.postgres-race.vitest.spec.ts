// front-desk.postgres-race — AI Front Desk guide TWI-03 / §10.1 on REAL Postgres with real concurrency (separate sessions):
//   • the SAME agent activated by owners on four sessions at once (different keys) → one activation, the rest "already live"
//   • TWO agents mapped to the route activated at once → exactly one live agent on the route at the end, the other demoted
//     (the per-route advisory lock serializes them; the partial unique index is the backstop), never a raw unique error
//   • a double-tapped Save Draft with the same expected version → one save, the other a version conflict
// Opt-in: PG_RACE_URL=postgres://… (migrated). Fresh random salon per run; the append-only event rows stay (by design).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { ReceptionistCenter, type RcCtx, type RcAccessRepo } from './receptionist-center';
import { FrontDeskCenter } from './front-desk-center';

const url = process.env.PG_RACE_URL;
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID();
const TAG = `fdr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const REF = 'agent_' + TAG;
const allowed: RcAccessRepo = { loadSnapshot: async () => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true }) as never };
const biz = { readiness: async () => ({ core: [{ key: 'hours', status: 'READY', detail: 'ok' }] }) };
const ENV = { RETELL_API_KEY: 'rk', VOICE_WRITE_TOOLS_ENABLED: 'true' } as NodeJS.ProcessEnv;

describe.skipIf(!url)('AI Front Desk on real Postgres: one activation per agent, one live agent per route, one save per version', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const rcs = dbs.map((d) => new ReceptionistCenter(d, allowed, biz, ENV));
  const fds = dbs.map((d, i) => new FrontDeskCenter(d, rcs[i], biz));
  const ctx: RcCtx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const agentIds: string[] = [];
  const reason = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? String((r.reason as { code?: string })?.code ?? (r.reason as Error)?.message) : 'ok');

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', ${TAG + '@race.test'}, 'active', 'OWNER')`);
    await q(sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, status, last_validated_at) values (${T}, 'twilio', 'AC_race', 'enc', '+16095550100', 'configured', now())`);
    await q(sql`insert into voice_integration_keys (tenant_id, branch_id, label, provider, prefix, secret_hash) values (${T}, ${B}, 'live', 'retell', ${'vk_' + TAG.slice(0, 6)}, 'h')`);
    // two complete agents mapped to the SAME provider agent (a duplicate mapping the system check flags) — both pass preflight
    for (const n of ['Desk One', 'Desk Two']) {
      const r = await q(sql`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id, handoff_destination, booking_mode, wizard_state)
        values (${T}, ${B}, ${n}, 'ready', 'retell', ${REF}, 'front_desk', 'handoff_only', '{"steps":{"1":true,"2":true,"3":true,"4":true},"complete":true}'::jsonb) returning id`);
      agentIds.push(r[0].id);
    }
    await q(sql`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, started_at, ended_at, duration_seconds, intents, abandoned, follow_up_required, agent_ref)
      values (${T}, ${B}, 'retell', ${'call_' + TAG}, now() - interval '5 minutes', now() - interval '4 minutes', 60, '["booking"]'::jsonb, false, false, ${REF})`);
    await rcs[0].controlAction(ctx, { action: 'verify_test_call', expectedVersion: 0, reason: 'race test call', providerCallRef: 'call_' + TAG, idempotencyKey: TAG + ':verify' });
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('the same agent activated on four sessions at once → exactly one activation; the rest are "already live"', async () => {
    const out = await Promise.allSettled(fds.map((f, i) => f.activate(ctx, agentIds[0], { expectedVersion: 1, reason: 'race go-live', idempotencyKey: `${TAG}:a1:${i}`, confirm: true })));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(out.map(reason).filter((r) => r !== 'ok').sort()).toEqual(['AI_FD_ALREADY_LIVE', 'AI_FD_ALREADY_LIVE', 'AI_FD_ALREADY_LIVE']);
    const ev = await q(sql`select count(*)::int n from ai_receptionist_agent_events where tenant_id = ${T} and agent_id = ${agentIds[0]} and action = 'activated'`);
    expect(Number(ev[0].n)).toBe(1);
  });

  it('two agents on one route activated at once → one live agent at the end, the other demoted; no raw unique-index error', async () => {
    // put Desk One back to ready (pause → resume never live again is not wanted here: use the demotion path instead)
    const out = await Promise.allSettled([0, 1, 2, 3].map((i) => fds[i].activate(ctx, agentIds[1], { expectedVersion: 1, reason: 'switch route', idempotencyKey: `${TAG}:a2:${i}`, confirm: true })));
    expect(out.map(reason).filter((r) => r !== 'ok' && r !== 'AI_FD_ALREADY_LIVE')).toEqual([]);
    const live = await q(sql`select id from ai_receptionist_agents where tenant_id = ${T} and status = 'live'`);
    expect(live.map((r) => r.id)).toEqual([agentIds[1]]);
    const st = await q(sql`select status from ai_receptionist_agents where id = ${agentIds[0]}`);
    expect(st[0].status).toBe('ready');
    const demoted = await q(sql`select count(*)::int n from ai_receptionist_agent_events where tenant_id = ${T} and agent_id = ${agentIds[0]} and action = 'demoted'`);
    expect(Number(demoted[0].n)).toBe(1);
    // and both agents racing each other: exactly one ends live
    await q(sql`update ai_receptionist_agents set status = 'ready' where tenant_id = ${T}`);
    await q(sql`update ai_receptionist_agents set config_version = 1 where tenant_id = ${T}`);
    const both = await Promise.allSettled([0, 1, 2, 3].map((i) => fds[i].activate(ctx, agentIds[i % 2], { expectedVersion: 1, reason: 'both at once', idempotencyKey: `${TAG}:a3:${i}`, confirm: true })));
    expect(both.map(reason).filter((r) => r !== 'ok' && r !== 'AI_FD_ALREADY_LIVE')).toEqual([]);
    const liveNow = await q(sql`select count(*)::int n from ai_receptionist_agents where tenant_id = ${T} and status = 'live'`);
    expect(Number(liveNow[0].n)).toBe(1);
  });

  it('a double-tapped Save Draft with the same version → one save, one version conflict', async () => {
    const d = await fds[0].create(ctx, { name: 'Draft Race', branchId: B, idempotencyKey: TAG + ':draft' });
    const out = await Promise.allSettled([0, 1, 2, 3].map((i) => fds[i].save(ctx, d.agent.id, { expectedVersion: 1, step: 2, description: 'tap ' + i })));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(out.map(reason).filter((r) => r !== 'ok')).toEqual(['AI_FD_VERSION_CONFLICT', 'AI_FD_VERSION_CONFLICT', 'AI_FD_VERSION_CONFLICT']);
    const v = await q(sql`select config_version from ai_receptionist_agents where id = ${d.agent.id}`);
    expect(Number(v[0].config_version)).toBe(2);
  });
});
