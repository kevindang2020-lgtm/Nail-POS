// receptionist-center.postgres-race — AI Receptionist guide §13 / §18 on REAL Postgres with real concurrency (separate
// sessions): eight AI calls holding the SAME slot at once → exactly one hold (the canonical SlotHoldService the voice
// tools use); two managers arming at once with the same version → one wins, the other is a version conflict; a prepared
// action confirmed by two managers at once → ONE follow-up task; a double-tapped "prepare" → one open action.
// Opt-in: PG_RACE_URL=postgres://… (migrated). Fresh random salon per run; the append-only event rows stay (by design).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { SlotHoldService } from '@aipowersalon/booking';
import { ReceptionistCenter, type RcCtx, type RcAccessRepo } from './receptionist-center';

const url = process.env.PG_RACE_URL;
const T = randomUUID(), B = randomUUID(), CAT = randomUUID(), SVC = randomUUID(), TECH = randomUUID(), OWNER = randomUUID(), MGR = randomUUID();
const TAG = `rcr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const DAY = '2999-06-11';
const allowed: RcAccessRepo = { loadSnapshot: async () => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true }) as any };
const biz = { readiness: async () => ({ core: [{ key: 'hours', status: 'READY', detail: 'ok' }] }) };
const ENV = { RETELL_API_KEY: 'rk', VOICE_WRITE_TOOLS_ENABLED: 'true' } as NodeJS.ProcessEnv;

describe.skipIf(!url)('AI Receptionist on real Postgres: one hold per slot, one control change per version, one task per action', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const centers = dbs.map((d) => new ReceptionistCenter(d, allowed, biz, ENV));
  const ctx = (u: string): RcCtx => ({ tenantId: T, branchId: B, userId: u, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] });
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 60, 4500, 'active')`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${T}, ${B}, 'Solo', 'R', 'Solo R', 'active', true)`);
    await q(sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values (${T}, ${B}, ${TECH}, ${SVC})`);
    await q(sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, status, last_validated_at) values (${T}, 'twilio', 'AC_race', 'enc', '+16095550100', 'configured', now())`);
    await q(sql`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values (${T}, ${B}, 'Desk', 'live', 'retell', ${'agent_' + TAG})`);
    await q(sql`insert into voice_integration_keys (tenant_id, branch_id, label, provider, prefix, secret_hash) values (${T}, ${B}, 'live', 'retell', ${'vk_' + TAG.slice(0, 6)}, 'h')`);
  }, 120_000);
  afterAll(async () => {
    if (dbs[0]) await q(sql`delete from booking_holds where tenant_id = ${T}`).catch(() => undefined);
    await Promise.all(dbs.map((d) => d.destroy()));
  });

  it('BK-02/BK-04: eight AI calls hold the same slot at once over four sessions → exactly one live hold', async () => {
    const holds = dbs.map((d) => new SlotHoldService(d as any));
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => holds[i % 4].place({ tenantId: T, branchId: B, date: DAY, startTime: '10:00', serviceIds: [SVC], technicianId: TECH, bookingSessionId: randomUUID(), channel: 'ai_receptionist' })));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(out.filter((o) => o.status === 'rejected').every((o: any) => /taken|held|unavailable/i.test(String(o.reason?.message ?? o.reason?.code ?? o.reason)))).toBe(true);
    const live = (await q(sql`select count(*)::int n from booking_holds where tenant_id = ${T} and released_at is null and converted_appointment_id is null`))[0].n;
    expect(Number(live)).toBe(1);
  });

  it('two managers arm booking at once with the same version → one change, one conflict, one event row', async () => {
    const out = await Promise.allSettled([0, 1, 2, 3].map((i) => centers[i].controlAction(ctx(i % 2 ? MGR : OWNER), { action: 'arm_booking', expectedVersion: 0, reason: 'gates passed, approved', idempotencyKey: `${TAG}-arm-${i}` })));
    const ok = out.filter((o) => o.status === 'fulfilled' && !(o as any).value.replayed);
    expect(ok.length).toBe(1);
    expect(out.filter((o) => o.status === 'rejected').every((o: any) => o.reason?.code === 'AI_RCPT_VERSION_CONFLICT')).toBe(true);
    expect(Number((await q(sql`select count(*)::int n from ai_receptionist_control_events where tenant_id = ${T} and action = 'arm_booking'`))[0].n)).toBe(1);
    expect(await centers[0].bookingArmed(T, B)).toBe(true);
  });

  it('AI-01: a double-tapped prepare → one open action; two managers confirming at once → ONE follow-up task', async () => {
    await q(sql`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, abandoned) values (${T}, ${B}, 'retell', ${'missed_' + TAG}, true)`);
    const prep = await Promise.allSettled([0, 1, 2, 3].map((i) => centers[i].prepareAction(ctx(OWNER), { sourceType: 'call', sourceRef: 'missed_' + TAG, kind: 'create_follow_up', idempotencyKey: `${TAG}-prep-${i}` })));
    const prepared = prep.filter((o) => o.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(prepared.length).toBe(1);
    expect(prep.filter((o) => o.status === 'rejected').every((o: any) => o.reason?.code === 'AI_RCPT_ACTION_EXISTS')).toBe(true);
    const id = prepared[0].value.id;
    const dec = await Promise.allSettled([0, 1, 2, 3].map((i) => centers[i].decideAction(ctx(i % 2 ? MGR : OWNER), id, { decision: 'confirm', expectedVersion: 1, reason: 'call back' })));
    expect(dec.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.code ?? o.reason))).toEqual([]);
    expect(dec.filter((o: any) => o.status === 'fulfilled' && !o.value.replayed).length).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from ai_receptionist_follow_ups where tenant_id = ${T} and provider_call_id = ${'missed_' + TAG}`))[0].n)).toBe(1);
  });
});
