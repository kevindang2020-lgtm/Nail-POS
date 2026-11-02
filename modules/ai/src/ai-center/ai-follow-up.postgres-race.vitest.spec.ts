// ai-follow-up.postgres-race — AI Follow-Ups guide §11/§15 on REAL Postgres with REAL concurrency (four separate sessions):
//   • the same handoff delivered 8 times at once (webhook retries + the agent's own handoff) → ONE task, ONE handoff event per kind
//   • a double-tapped New Follow-Up (8 concurrent posts, one request key) → ONE task
//   • two staff assigning the same task at the same version → exactly one wins, the other gets RECORD_CHANGED_RELOAD
//   • the overdue job run 6 times at once → ONE owner alert
// Data: fresh random tenant per run (the CI race database is shared).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { recordHandoff } from '../voice-booking/ai-handoff';
import { AiFollowUpCenter, FollowUpCenterError, escalateOverdueFollowUps, type FuCtx } from './ai-follow-up-center';

const url = process.env.PG_RACE_URL;
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID(), FD = randomUUID(), MGR = randomUUID(), C = randomUUID();
const TAG = `fur${process.pid}${Date.now().toString(36)}`.slice(0, 16);

describe.skipIf(!url)('AI follow-ups on real Postgres: one task per handoff, idempotent create, versioned assign, one overdue alert', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const centers = dbs.map((d) => new AiFollowUpCenter(d, null));
  const ctx = (u: string, role: string): FuCtx => ({ tenantId: T, branchId: B, userId: u, role, permissions: ['ai.use', 'ai.manage', 'communications.manage'] });
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-9).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into users (id, tenant_id, branch_id, full_name, email, status, role) values (${OWNER}, ${T}, null, 'Owner', ${TAG + 'o@r.test'}, 'active', 'OWNER'),
      (${FD}, ${T}, ${B}, 'Desk', ${TAG + 'f@r.test'}, 'active', 'FRONT_DESK'), (${MGR}, ${T}, ${B}, 'Mgr', ${TAG + 'm@r.test'}, 'active', 'MANAGER')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${C}, ${T}, ${B}, 'Ava', 'Race', 'Ava Race', ${'+1609' + String(Math.floor(1e6 + Math.random() * 8.9e6))}, 'active')`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('the same handoff 8× at once over four sessions (6 webhook retries + 2 agent handoffs) → ONE task', async () => {
    const call = `call_${TAG}`;
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => dbs[i % 4].transaction().execute((trx) => recordHandoff(trx, {
      tenantId: T, branchId: B, providerCallId: call, source: i < 6 ? 'retell_webhook' : 'gateway_handoff', sourceKey: i < 6 ? `ev_${call}` : `gateway:${call}`,
      signal: { kind: i < 6 ? 'transfer_failed' : 'callback_requested', callbackRequired: true, reason: 'CALLBACK', priority: 'high', detail: 'race' }, callerPhone: '+16095550142' }))));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const ids = new Set(out.map((o: any) => o.value.followUpId));
    expect(ids.size).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from ai_receptionist_follow_ups where tenant_id = ${T} and provider_call_id = ${call}`))[0].n)).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from ai_handoff_events where tenant_id = ${T} and provider_call_id = ${call}`))[0].n)).toBe(2);   // one per (source key, kind)
  });

  it('a double-tapped New Follow-Up (8 concurrent posts, one request key) → ONE task', async () => {
    const key = `race-create-${TAG}`;
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => centers[i % 4].create(ctx(FD, 'FRONT_DESK'), { reason: 'CALLBACK', description: 'double tap', customerId: C, idempotencyKey: key })));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const vals = out.map((o: any) => o.value);
    expect(new Set(vals.map((v) => v.id)).size).toBe(1);
    expect(vals.filter((v) => !v.duplicate)).toHaveLength(1);
  });

  it('two staff REASSIGN the same task at the same version → one wins, the other is told to reload', async () => {
    // a REASSIGNMENT (assigned → assigned): the state machine cannot help here, only the row lock / version guard can
    const { id } = await centers[0].create(ctx(FD, 'FRONT_DESK'), { reason: 'OTHER', description: 'assign race', customerId: C, assignedUserId: FD, idempotencyKey: `race-assign-${TAG}` });
    // deterministic interleaving: a third session holds the row while both assigns read and pile up, then lets go
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    let locked!: () => void; const isLocked = new Promise<void>((r) => { locked = r; });
    const holder = dbs[3].transaction().execute(async (trx) => { await sql`select id from ai_receptionist_follow_ups where id = ${id} for update`.execute(trx); locked(); await gate; });
    await isLocked;
    const racing = Promise.allSettled([centers[1].assign(ctx(FD, 'FRONT_DESK'), id, { assignedUserId: OWNER, version: 1 }), centers[2].assign(ctx(MGR, 'MANAGER'), id, { assignedUserId: MGR, version: 1 })]);
    await new Promise((r) => setTimeout(r, 400)); release(); await holder;
    const out = await racing;
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const lost = out.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(FollowUpCenterError); expect((lost.reason as FollowUpCenterError).code).toBe('RECORD_CHANGED_RELOAD');
    expect(Number((await q(sql`select count(*)::int n from ai_follow_up_activity where follow_up_id = ${id} and event_type = 'reassigned'`))[0].n)).toBe(1);
  });

  it('the overdue job run 6× at once → ONE escalation and ONE owner alert for the task', async () => {
    const { id } = await centers[0].create(ctx(FD, 'FRONT_DESK'), { reason: 'CALLBACK', description: 'overdue race', customerId: C, dueLocal: '2026-01-05T09:00', idempotencyKey: `race-overdue-${TAG}` });
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => escalateOverdueFollowUps(dbs[i % 4])));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    expect(Number((await q(sql`select count(*)::int n from ai_follow_up_escalations where follow_up_id = ${id}`))[0].n)).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from owner_alerts where tenant_id = ${T} and metadata->>'followUpId' = ${id}`))[0].n)).toBe(1);
  });
});
