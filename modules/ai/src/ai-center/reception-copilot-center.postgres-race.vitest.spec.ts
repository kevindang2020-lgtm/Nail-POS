// reception-copilot-center.postgres-race — Reception Copilot guide CP15 / CP23 / CP26 on REAL Postgres with REAL
// concurrency (four Kysely sessions). The old ledger was find → run → record, so two simultaneous confirms of the same
// request could BOTH execute (two texts, two cancels). The ledger now CLAIMS the key before the domain call:
//   • the same reviewed action confirmed 8× at once (double taps, two stations) → the domain runs ONCE; the rest replay
//   • 6 different stations texting the same customer at once with their own reviews → each text sent exactly once
// Data: fresh random salon per run (the CI race database is shared); the ledger rows stay (append-only history).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { ReceptionCopilotActionService, KyselyActionLedgerRepo } from './reception-copilot-action.service';
import { ReceptionCopilotCenter, type CcCtx } from './reception-copilot-center';

const url = process.env.PG_RACE_URL;
const TAG = `rcc${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), TECH = randomUUID(), OWNER = randomUUID();
const PERMS = ['reception_copilot.use', 'reception_copilot.cancel_appointment', 'reception_copilot.send_message', 'pos.booking.cancel', 'communications.send'];

describe.skipIf(!url)('Reception Copilot confirm on real Postgres: claim-before-run', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const ctx: CcCtx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: PERMS };
  let calls = { cancel: 0, send: 0 };
  const settings = { get: async () => ({ enabled: true, actionsEnabled: true, allowCreate: true, allowReschedule: true, allowCancel: true, allowSendMessage: true }) };
  const centers = dbs.map((db) => {
    const booking = { cancel: async (c: any, id: string) => {
      calls.cancel++; await new Promise((r) => setTimeout(r, 40));   // a slow domain call: every racer is inside the window
      await sql`update pos_tech_appointments set status = 'cancelled' where tenant_id = ${c.tenantId} and id = ${id}`.execute(db); return { appointmentId: id };
    } };
    const notifications = { send: async (c: any, m: any) => {
      calls.send++; const id = randomUUID();
      await sql`insert into notifications (id, tenant_id, channel, to_address, body, status, provider_id) values (${id}, ${c.tenantId}, 'sms', ${m.to}, ${m.body}, 'sent', ${'SM-MOCK-' + id.slice(0, 8)})`.execute(db);
      return { sent: true, id, providerId: 'SM-MOCK-' + id.slice(0, 8) };
    } };
    const spine = new ReceptionCopilotActionService(booking as any, { record: async () => undefined } as any, new KyselyActionLedgerRepo(db), notifications as any, settings as any);
    return new ReceptionCopilotCenter(db, spine, null, settings as any, null, { AUTH_SESSION_SECRET: `race-${TAG}` } as any);
  });

  beforeAll(async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(0, 12)}, 'active')`.execute(dbs[0]);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'UTC')`.execute(dbs[0]);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${T}, ${B}, 'Lan', 'Tran', 'Lan Tran', 'active', true)`.execute(dbs[0]);
  }, 60_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('one reviewed cancel confirmed 8× at once over four sessions → the booking service runs ONCE, the rest replay', async () => {
    const id = randomUUID();
    await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, duration_minutes, status)
      values (${id}, ${T}, ${B}, ${TECH}, 'Ava Race', '2026-12-01', '10:00', '10:30', 30, 'booked')`.execute(dbs[0]);
    const a = { type: 'cancel_appointment', appointmentId: id, reason: 'Customer called to cancel' } as any;
    const p = await centers[0].prepare(ctx, a);
    calls = { cancel: 0, send: 0 };
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, k) => centers[k % 4].confirm(ctx, a, p.token!)));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const vals = out.map((o: any) => o.value);
    expect(calls.cancel).toBe(1);
    expect(vals.filter((v) => v.ok && !v.duplicate).length).toBe(1);
    expect(vals.every((v) => v.requestKey === vals[0].requestKey)).toBe(true);
    // the racers that lost either replay the finished result or are told it is still running — never a second cancel
    expect(vals.filter((v) => v.duplicate || v.errorCode === 'ACTION_IN_PROGRESS').length).toBe(7);
    const led = (await sql<any>`select state from reception_copilot_action_ledger where tenant_id = ${T} and idempotency_key = ${vals[0].requestKey}`.execute(dbs[0])).rows;
    expect(led).toEqual([{ state: 'succeeded' }]);
  });

  it('six stations each review and send the same text at once → six real sends, one per review, none swallowed or doubled', async () => {
    const a = { type: 'send_message', to: '+16095550142', body: 'Running about 10 minutes late, sorry!' } as any;
    const preps = await Promise.all(Array.from({ length: 6 }, (_, k) => centers[k % 4].prepare(ctx, a)));
    calls = { cancel: 0, send: 0 };
    const out = await Promise.all(preps.flatMap((p, k) => [centers[k % 4].confirm(ctx, a, p.token!), centers[(k + 1) % 4].confirm(ctx, a, p.token!)]));
    expect(calls.send).toBe(6);
    expect(new Set(out.map((r) => r.requestKey)).size).toBe(6);
    expect(out.filter((r) => r.ok && !r.duplicate).length).toBe(6);
    expect(Number((await sql<any>`select count(*)::int c from notifications where tenant_id = ${T} and channel = 'sms'`.execute(dbs[0])).rows[0].c)).toBe(6);
  });
});
