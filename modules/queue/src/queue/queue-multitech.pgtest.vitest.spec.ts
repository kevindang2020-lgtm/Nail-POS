// queue-multitech.pgtest.vitest.spec.ts — multi-technician routing (contract §3) on the REAL migrated schema (PGlite,
// every migration incl. 569). The ONE multi-line writer, QueueService.assignPlan:
//   • writes the lines + the lead + ONE history row per guest + the audit row + queue.customer_assigned and
//     queue.service_lines_assigned — in one transaction
//   • all or none: a partial body is 400, a stale line is 409 and changes NOTHING (a party with one stale member too)
//   • the same key replays (no second write); unassign resets the lines; a removed service cancels its line
//   • capacity: a technician holding a line of a visit (not its lead) is counted busy by techSignals
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyQueueRepository } from './queue.kysely.repository';
import { QueueService, QueueAssignmentConflict, QueueAssignmentLocked, ValidationError } from './queue.service';
import type { QueueContext } from './queue.repository';

const T = 'a5690000-0000-4000-8000-000000000001';
const B = 'a5690000-0000-4000-8000-000000000002';
const CP = 'a5690000-0000-4000-8000-0000000000c1', CM = 'a5690000-0000-4000-8000-0000000000c2', CA = 'a5690000-0000-4000-8000-0000000000c3';
const SP = 'a5690000-0000-4000-8000-0000000000d1', SM = 'a5690000-0000-4000-8000-0000000000d2', SA = 'a5690000-0000-4000-8000-0000000000d3';
const TP = 'a5690000-0000-4000-8000-0000000000a1', TM = 'a5690000-0000-4000-8000-0000000000a2', TX = 'a5690000-0000-4000-8000-0000000000a3';
const USER = 'a5690000-0000-4000-8000-0000000000e1';
const PERMS = ['pos.queue.view', 'pos.queue.create', 'pos.queue.edit', 'pos.queue.assign_technician', 'pos.queue.move_to_tech_queue', 'pos.queue.move_to_serving', 'pos.serving.view'];
const desk: QueueContext = { tenantId: T, branchId: B, userId: USER, role: 'FRONT_DESK', permissions: PERMS };
const SVCS = `[{"serviceId":"${SP}","serviceName":"Pedicure","estimatedDurationMinutes":50,"priceCents":6000},{"serviceId":"${SM}","serviceName":"Manicure","estimatedDurationMinutes":40,"priceCents":4000},{"serviceId":"${SA}","serviceName":"Nail Art","estimatedDurationMinutes":20,"priceCents":2000,"isAddon":true,"parentServiceId":"${SM}"}]`;

let pg: any; let db: any; let repo: KyselyQueueRepository; let svc: QueueService;
const one = async (q: string) => (await pg.query(q)).rows[0];
const all = async (q: string) => (await pg.query(q)).rows;
let seq = 0;
async function guest(over: Record<string, string> = {}): Promise<string> {
  const cols = { tenant_id: `'${T}'`, branch_id: `'${B}'`, customer_name: `'Guest ${++seq}'`, status: `'waiting'`, source: `'walk_in'`, priority: `'normal'`, requested_services: `'${SVCS}'`, ...over };
  return (await one(`INSERT INTO pos_queue_items (${Object.keys(cols).join(',')}) VALUES (${Object.values(cols).join(',')}) RETURNING id`)).id;
}
const split = (id: string, key: string, over: { version?: number; expected?: string | null; lineExpect?: Record<string, string | null> } = {}) => ({
  items: [{ queueItemId: id, expectedVersion: over.version ?? 1, expectedTechnicianId: over.expected ?? null,
    lines: [{ serviceId: SP, technicianId: TP, expectedTechnicianId: over.lineExpect?.[SP] ?? null }, { serviceId: SM, technicianId: TM, expectedTechnicianId: over.lineExpect?.[SM] ?? null },
      { serviceId: SA, technicianId: TM, expectedTechnicianId: over.lineExpect?.[SA] ?? null }] }],
  idempotencyKey: key, source: 'staff' as const,
});
const lines = (id: string) => all(`SELECT service_id, technician_id, status, version, timing, after_service_id FROM queue_service_assignments WHERE queue_item_id = '${id}' ORDER BY sequence`);
const events = (id: string) => all(`SELECT event_type, payload_json AS payload FROM outbox_events WHERE aggregate_id = '${id}' ORDER BY occurred_at, event_type`);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'MT Salon LLC', 'MT Salon', 'mt-salon', 'MTSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO users (id, tenant_id, full_name, status, role) VALUES ('${USER}', '${T}', 'Desk', 'active', 'CUSTOMER');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CP}', '${T}', '${B}', 'Pedicure'), ('${CM}', '${T}', '${B}', 'Manicure'), ('${CA}', '${T}', '${B}', 'Nail Art');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES
      ('${SP}', '${T}', '${B}', '${CP}', 'Pedicure', 50, 6000), ('${SM}', '${T}', '${B}', '${CM}', 'Manicure', 40, 4000), ('${SA}', '${T}', '${B}', '${CA}', 'Nail Art', 20, 2000);
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES
      ('${TP}', '${T}', '${B}', 'Pia', 'P', 'Pia P', 'active'), ('${TM}', '${T}', '${B}', 'Mo', 'M', 'Mo M', 'active'), ('${TX}', '${T}', '${B}', 'Xi', 'X', 'Xi X', 'active');
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES
      ('${T}', '${B}', '${TP}', '${SP}'), ('${T}', '${B}', '${TM}', '${SM}'), ('${T}', '${B}', '${TM}', '${SA}'), ('${T}', '${B}', '${TX}', '${SM}');
  `);
  repo = new KyselyQueueRepository(db as never, new OutboxWriter()); svc = new QueueService(repo);
}, 120000);

describe('assignPlan — one transaction', () => {
  it('lines + lead + one history row + audit + queue.customer_assigned + queue.service_lines_assigned', async () => {
    const id = await guest();
    const r = await svc.assignPlan(desk, split(id, 'k-one'));
    expect(r).toMatchObject({ applied: true, replayed: false });
    // the lead: the earliest-starting line's technician; Pedicure and Manicure start side by side, Mo has more minutes (60 > 50)
    const row = await one(`SELECT status, version, assigned_technician_id FROM pos_queue_items WHERE id = '${id}'`);
    expect(row).toMatchObject({ status: 'assigned', version: 2, assigned_technician_id: TM });
    expect(await lines(id)).toEqual([
      { service_id: SP, technician_id: TP, status: 'assigned', version: 1, timing: 'parallel', after_service_id: null },
      { service_id: SM, technician_id: TM, status: 'assigned', version: 1, timing: 'parallel', after_service_id: null },
      { service_id: SA, technician_id: TM, status: 'assigned', version: 1, timing: 'after', after_service_id: SM },
    ]);
    const h = await all(`SELECT version, action, source, idempotency_key, to_technician FROM pos_queue_status_history WHERE queue_item_id = '${id}' AND version > 1`);
    expect(h).toEqual([{ version: 2, action: 'assign_plan', source: 'staff', idempotency_key: `k-one:${id}`, to_technician: TM }]);
    const a = await all(`SELECT action_type, after FROM pos_queue_audit WHERE entity_id = '${id}'`);
    expect(a).toHaveLength(1);
    expect(a[0].action_type).toBe('pos_queue_plan_assigned');
    const ev = await events(id);
    expect(ev.map((e: any) => e.event_type).sort()).toEqual(['queue.customer_assigned', 'queue.service_lines_assigned']);
    const lineEv = ev.find((e: any) => e.event_type === 'queue.service_lines_assigned').payload;
    expect(lineEv).toMatchObject({ queueItemId: id, leadTechnicianId: TM, source: 'staff', version: 2 });
    expect(lineEv.lines).toEqual([
      { serviceId: SP, technicianId: TP, previousTechnicianId: null, timing: 'parallel' }, { serviceId: SM, technicianId: TM, previousTechnicianId: null, timing: 'parallel' },
      { serviceId: SA, technicianId: TM, previousTechnicianId: null, timing: 'after' },
    ]);
    expect(JSON.stringify(lineEv)).not.toMatch(/Guest/);   // ids only — never the guest's name
    // the item detail shows the shared visit
    const d = await svc.detail(desk, id);
    expect(d.sharedVisit).toBe(true);
    expect(d.lineTechnicianIds).toEqual([TM, TP]);
  });
  it('the same key replays: no second history row, no version bump', async () => {
    const id = await guest();
    await svc.assignPlan(desk, split(id, 'k-replay'));
    const again = await svc.assignPlan(desk, split(id, 'k-replay'));
    expect(again.replayed).toBe(true);
    expect((await one(`SELECT version FROM pos_queue_items WHERE id = '${id}'`)).version).toBe(2);
    expect((await all(`SELECT 1 FROM pos_queue_status_history WHERE queue_item_id = '${id}' AND action = 'assign_plan'`))).toHaveLength(1);
    expect((await events(id)).filter((e: any) => e.event_type === 'queue.service_lines_assigned')).toHaveLength(1);
  });
});

describe('all or none', () => {
  it('a partial body (a service without a technician) is 400 and writes nothing', async () => {
    const id = await guest();
    const body = split(id, 'k-partial'); body.items[0].lines.pop();
    await expect(svc.assignPlan(desk, body)).rejects.toBeInstanceOf(ValidationError);
    expect(await lines(id)).toEqual([]);
    expect((await one(`SELECT version, assigned_technician_id FROM pos_queue_items WHERE id = '${id}'`))).toMatchObject({ version: 1, assigned_technician_id: null });
  });
  it('a technician not skilled for THAT line is refused without a manager override', async () => {
    const id = await guest();
    const body = split(id, 'k-skill'); body.items[0].lines[0].technicianId = TX;   // Xi does manicures, not pedicures
    await expect(svc.assignPlan(desk, body)).rejects.toThrow(/not skilled for Pedicure/);
  });
  it('a stale line → 409 naming the line, and NOTHING changes (lead, version, lines, history, events)', async () => {
    const id = await guest();
    await svc.assignPlan(desk, split(id, 'k-base'));
    const before = { lines: await lines(id), ev: (await events(id)).length };
    // another desk re-plans the manicure to Xi; this desk still thinks Mo has it → the line is stale
    const body = { items: [{ queueItemId: id, expectedVersion: 2, expectedTechnicianId: TM, lines: [
      { serviceId: SP, technicianId: TP, expectedTechnicianId: TP }, { serviceId: SM, technicianId: TX, expectedTechnicianId: TX }, { serviceId: SA, technicianId: TM, expectedTechnicianId: TM }] }],
      idempotencyKey: 'k-stale', source: 'staff' as const };
    const err: any = await svc.assignPlan(desk, body).catch((e) => e);
    expect(err).toBeInstanceOf(QueueAssignmentConflict);
    expect(err).toMatchObject({ queueItemId: id, serviceId: SM, currentTechnicianId: TM });
    expect(await lines(id)).toEqual(before.lines);
    expect((await one(`SELECT version, assigned_technician_id FROM pos_queue_items WHERE id = '${id}'`))).toMatchObject({ version: 2, assigned_technician_id: TM });
    expect((await events(id)).length).toBe(before.ev);
  });
  it('a stale guest version → 409 naming the guest', async () => {
    const id = await guest();
    const err: any = await svc.assignPlan(desk, split(id, 'k-ver', { version: 7 })).catch((e) => e);
    expect(err).toBeInstanceOf(QueueAssignmentConflict);
    expect(err.queueItemId).toBe(id);
  });
  it('a party: one stale member → 409 and NO member is assigned', async () => {
    const a = await guest(); const b = await guest();
    const g = await svc.createGroup(desk, { label: 'Smiths', queueItemIds: [a, b], together: true });
    const va = (await one(`SELECT version FROM pos_queue_items WHERE id = '${a}'`)).version;
    const body = { groupId: g.groupId, idempotencyKey: 'k-party', source: 'staff' as const, items: [
      { queueItemId: a, expectedVersion: va, expectedTechnicianId: null, lines: [{ serviceId: SP, technicianId: TP, expectedTechnicianId: null }, { serviceId: SM, technicianId: TM, expectedTechnicianId: null }, { serviceId: SA, technicianId: TM, expectedTechnicianId: null }] },
      { queueItemId: b, expectedVersion: 1, expectedTechnicianId: null, lines: [{ serviceId: SP, technicianId: TP, expectedTechnicianId: null }, { serviceId: SM, technicianId: TX, expectedTechnicianId: null }, { serviceId: SA, technicianId: TM, expectedTechnicianId: null }] },
    ] };
    const err: any = await svc.assignPlan(desk, body).catch((e) => e);   // b is at version 2 (the party write bumped it)
    expect(err).toBeInstanceOf(QueueAssignmentConflict);
    expect(err.queueItemId).toBe(b);
    expect((await all(`SELECT 1 FROM queue_service_assignments WHERE queue_item_id IN ('${a}', '${b}')`))).toHaveLength(0);
    expect((await all(`SELECT assigned_technician_id FROM pos_queue_items WHERE id IN ('${a}', '${b}') AND assigned_technician_id IS NOT NULL`))).toHaveLength(0);
    // with the right versions the whole party is assigned in one call
    body.items[1].expectedVersion = (await one(`SELECT version FROM pos_queue_items WHERE id = '${b}'`)).version; body.idempotencyKey = 'k-party-2';
    const ok = await svc.assignPlan(desk, body);
    expect(ok.items.map((i) => i.assignedTechnicianId)).toEqual([TM, TP]);   // b: Pia 50 vs Xi 40 / Mo 20 → Pia leads
  });
  it('a manager lock to another technician refuses the plan (ASSIGNMENT_LOCKED)', async () => {
    const id = await guest();
    await pg.query(`INSERT INTO queue_assignment_locks (tenant_id, branch_id, queue_item_id, technician_id, reason) VALUES ('${T}', '${B}', '${id}', '${TM}', 'regular')`);
    await expect(svc.assignPlan(desk, split(id, 'k-lock'))).rejects.toBeInstanceOf(QueueAssignmentLocked);
  });
});

describe('the plan lives with the visit', () => {
  it('unassign resets the lines to "nobody yet"; a removed service cancels its line', async () => {
    const id = await guest();
    await svc.assignPlan(desk, split(id, 'k-unassign'));
    await svc.unassignTechnician(desk, id, { reason: 'guest stepped out' });
    expect((await lines(id)).map((l: any) => [l.technician_id, l.status])).toEqual([[null, 'pending'], [null, 'pending'], [null, 'pending']]);
    const id2 = await guest();
    await svc.assignPlan(desk, split(id2, 'k-remove'));
    await svc.updateServices(desk, id2, { serviceIds: [SP, SM] });
    expect((await lines(id2)).map((l: any) => [l.service_id, l.status])).toEqual([[SP, 'assigned'], [SM, 'assigned'], [SA, 'cancelled']]);
  });
  it('the old PUT service-assignments now goes through assignPlan (one writer)', async () => {
    const id = await guest({ assigned_technician_id: `'${TM}'`, status: `'assigned'` });
    const d = await svc.setServiceAssignments(desk, id, { assignments: [{ serviceId: SP, technicianId: TP }] });
    expect(d.serviceAssignments!.map((l) => l.technicianId)).toEqual([TP, TM, TM]);
    expect((await all(`SELECT action FROM pos_queue_status_history WHERE queue_item_id = '${id}' AND version > 1`)).map((r: any) => r.action)).toEqual(['assign_plan']);
  });
  it('capacity: a technician holding a LINE of a visit (not its lead) is busy — once per visit, their own minutes', async () => {
    await pg.query(`UPDATE pos_queue_items SET status = 'cancelled' WHERE tenant_id = '${T}' AND status NOT IN ('completed','cancelled','removed')`);
    const id = await guest();
    await svc.assignPlan(desk, split(id, 'k-cap'));
    const entries = await repo.activeEntries(desk);
    const e = entries.find((x) => x.queueItemId === id)!;
    expect(e.lineTechnicianIds).toEqual([TM, TP]);
    expect(e.lineMinutes).toEqual({ [TP]: 50, [TM]: 60 });
    const sig = await repo.techSignals(desk, entries);
    const by = Object.fromEntries(sig.map((s) => [s.technicianId, s]));
    expect(by[TP].activeAssignments).toBe(1);   // Pia is not the lead, but she holds the pedicure
    expect(by[TM].activeAssignments).toBe(1);   // two lines, one slot
    expect(by[TX].activeAssignments).toBe(0);
    expect(by[TP].assignedMinutes).toBe(50); expect(by[TM].assignedMinutes).toBe(60);
  });
});
