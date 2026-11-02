// workforce-status-producer.pgtest — technician.status_changed (merge Oct 12 2026, WF). Every move of the ONE workforce
// state (579 CAS: clock in / break / clock out / unavailable / serving) records the event in the CAS transaction, and the
// projection refreshes the boards (technician_status_updated + technician_clock_updated, branch room) and the
// technician's own app (technician room) — the pushes WorkforceStatusService / TimeClockService used to make by hand.
// The CAS also refuses a clock move its machine does not list (TECH_WORKFORCE_CLOCK), whatever the caller computed.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyWorkforceStateStore, WorkforceStatusService } from '@aipowersalon/workforce';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';
import { seedTechnician } from './pgtest-seed';

const T = '17171717-1717-4171-8171-171717171717', B = '18181818-1818-4181-8181-181818181818', TECH = '19191919-1919-4191-8191-191919191919';
let db: any; let store: KyselyWorkforceStateStore; let svc: WorkforceStatusService;
const rows = async () => (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = 'technician.status_changed' ORDER BY created_at, id`.execute(db)).rows as any[];
async function project(e: any) {
  const sent: any[] = [];
  await new RealtimeProjectionConsumer({
    toTenant: (scope: any, event: any, payload: any) => sent.push({ to: 'branch', scope, event, payload }),
    toTechnician: (technicianId: string, event: any, payload: any) => sent.push({ to: 'technician', technicianId, event, payload }),
  } as any).handle({ eventType: e.event_type, tenantId: e.tenant_id, branchId: e.branch_id, aggregateId: e.aggregate_id, payload: e.payload_json } as any);
  return sent;
}

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','W','Workforce Salon','wfstate','WFST01','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main') ON CONFLICT (id) DO NOTHING;
  `);
  await seedTechnician(pg, TECH, T, B);
  store = new KyselyWorkforceStateStore(db, new OutboxWriter());
  svc = new WorkforceStatusService(store, null);
}, 240000);

describe('workforce state moves record technician.status_changed (§343)', () => {
  it('clock in → break → back: one event per move, in the CAS transaction, ids + derived facts only', async () => {
    await svc.clockIn(T, TECH, { branchId: B });
    await svc.breakStart(T, TECH);
    await svc.breakEnd(T, TECH);
    const ev = await rows();
    expect(ev.map((e) => e.payload_json.clock)).toEqual(['CLOCKED_IN', 'ON_BREAK', 'CLOCKED_IN']);
    expect(ev.map((e) => e.payload_json.version)).toEqual([2, 3, 4]);
    for (const e of ev) {
      expect(e).toMatchObject({ tenant_id: T, branch_id: B, aggregate_id: TECH });
      expect(Object.keys(e.payload_json).sort()).toEqual(['branchId', 'clock', 'employment', 'queue', 'service', 'shift', 'technicianId', 'version']);
    }
    expect(ev[1].payload_json).toMatchObject({ queue: 'BREAK', shift: 'ON_SHIFT' });
  });

  it('the projection refreshes the branch boards and the technician\'s own app; a break reads as on_break on the time clock', async () => {
    const [, brk] = await rows();
    const sent = await project(brk);
    expect(sent.map((s) => `${s.to}:${s.event}`)).toEqual(['branch:technician_status_updated', 'branch:technician_clock_updated', 'technician:technician_status_updated']);
    expect(sent[0].scope).toEqual({ tenantId: T, branchId: B });
    expect(sent[1].payload).toMatchObject({ technicianId: TECH, state: 'on_break', shiftId: null });   // §43: + the resource envelope
    expect(sent[2].technicianId).toBe(TECH);
  });

  it('a stale version writes nothing and records nothing; a move the clock machine does not list is refused in the CAS', async () => {
    const before = (await rows()).length;
    const cur = (await store.get(T, TECH))!;
    expect(await store.cas(T, TECH, cur.version - 1, { ...cur, clock: 'CLOCKED_OUT' } as any, {}, 'off_shift')).toBeNull();
    await svc.clockOut(T, TECH);
    const out = (await store.get(T, TECH))!;
    expect(out.clock).toBe('CLOCKED_OUT');
    // CLOCKED_OUT → ON_BREAK is not a move (TECH_WORKFORCE_CLOCK): the store refuses it even when a caller asks directly
    await expect(store.cas(T, TECH, out.version, { ...out, clock: 'ON_BREAK' } as any, {}, 'on_break')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect((await store.get(T, TECH))!.clock).toBe('CLOCKED_OUT');
    expect((await rows()).length).toBe(before + 1);   // only the clock-out
  });
});
