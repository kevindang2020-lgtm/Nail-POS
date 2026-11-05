// queue-phase6.pgtest.vitest.spec.ts — BUILD_PLAN Phase 6 (ai_queue_assignment → complete), the queue domain on the
// REAL migrated schema (PGlite, every migration incl. 524 + 525). What it pins:
//   • every transition bumps pos_queue_items.version and writes pos_queue_status_history + pos_queue_audit in the
//     SAME transaction — also for writers outside the POS Queue (migration 525's trigger)        (audit bug 15)
//   • the repository's REAL updated_at                                                                 (bug 3)
//   • ALL active entries, no 20-row cap, in service included; not the branch's whole history          (bug 4)
//   • requested + previous technician reach the engine; previous is stamped at check-in               (bug 1)
//   • an appointment's 'HH:MM' read on its date in the BRANCH's zone                                  (bug 2)
//   • a lock refuses another technician; the same idempotency key never writes twice
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyQueueRepository } from './queue.kysely.repository';
import { QueueService, QueueAssignmentLocked, QueueAssignmentConflict } from './queue.service';
import type { QueueContext } from './queue.repository';

const T = 'a6000000-0000-4000-8000-000000000001';
const B = 'a6000000-0000-4000-8000-000000000002';
const B2 = 'a6000000-0000-4000-8000-000000000003';
const CAT = 'a6000000-0000-4000-8000-000000000004';
const SVC = 'a6000000-0000-4000-8000-000000000005';
const TA = 'a6000000-0000-4000-8000-0000000000a1';
const TB = 'a6000000-0000-4000-8000-0000000000b1';
const TC = 'a6000000-0000-4000-8000-0000000000c1';   // works at the OTHER branch
const CUST = 'a6000000-0000-4000-8000-0000000000d1';
const USER = 'a6000000-0000-4000-8000-0000000000e1';
const MGR = 'a6000000-0000-4000-8000-0000000000e2';
const APPT = 'a6000000-0000-4000-8000-0000000000f1';
const PERMS = ['pos.queue.view', 'pos.queue.create', 'pos.queue.edit', 'pos.queue.assign_technician', 'pos.queue.update_priority', 'pos.queue.cancel', 'pos.queue.call_next'];
const desk: QueueContext = { tenantId: T, branchId: B, userId: USER, role: 'FRONT_DESK', permissions: PERMS };
const mgr: QueueContext = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: [...PERMS, 'ai_queue_assignment.override'] };

let pg: any; let db: any; let repo: KyselyQueueRepository; let svc: QueueService;
const one = async (q: string) => (await pg.query(q)).rows[0];
const all = async (q: string) => (await pg.query(q)).rows;
let seq = 0;
async function guest(over: Record<string, string> = {}): Promise<string> {
  // one active visit per customer (migration 503): close Rita's previous one first
  if (over.customer_id) await pg.query(`UPDATE pos_queue_items SET status = 'cancelled' WHERE customer_id = ${over.customer_id} AND status NOT IN ('completed','done','cancelled','removed')`);
  const cols = { tenant_id: `'${T}'`, branch_id: `'${B}'`, customer_name: `'Guest ${++seq}'`, status: `'waiting'`, source: `'walk_in'`, priority: `'normal'`,
    requested_services: `'[{"serviceId":"${SVC}","serviceName":"Gel Manicure","estimatedDurationMinutes":45,"priceCents":4500}]'`, ...over };
  return (await one(`INSERT INTO pos_queue_items (${Object.keys(cols).join(',')}) VALUES (${Object.values(cols).join(',')}) RETURNING id`)).id;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'P6 Salon LLC', 'P6 Salon', 'p6-salon', 'P6SALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'West', 'active'), ('${B2}', '${T}', 'East', 'active');
    UPDATE branches SET timezone = 'America/Los_Angeles' WHERE id = '${B}';
    INSERT INTO users (id, tenant_id, full_name, status, role) VALUES ('${USER}', '${T}', 'Desk', 'active', 'CUSTOMER'), ('${MGR}', '${T}', 'Manager', 'active', 'MANAGER');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 45, 4500);
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES
      ('${TA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active'), ('${TB}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active'), ('${TC}', '${T}', '${B2}', 'Cal', 'C', 'Cal C', 'active');
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${TA}', '${SVC}'), ('${T}', '${B}', '${TB}', '${SVC}');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) VALUES ('${CUST}', '${T}', '${B}', 'Rita', 'R', 'Rita R', '${USER}');
    INSERT INTO tickets (tenant_id, branch_id, customer_id, primary_technician_id, status, service_done_at, paid_at) VALUES
      ('${T}', '${B}', '${CUST}', '${TB}', 'paid', now() - interval '30 days', now() - interval '30 days'),
      ('${T}', '${B}', '${CUST}', '${TA}', 'paid', now() - interval '3 days', now() - interval '3 days'),
      ('${T}', '${B}', '${CUST}', '${TB}', 'cancelled', now() - interval '1 day', NULL);
  `);
  repo = new KyselyQueueRepository(db as never); svc = new QueueService(repo);
}, 120000);

describe('versioned, audited transitions in one transaction (bug 15)', () => {
  it('assign: version 1 → 2, history check_in + assign (who / source / reason), a pos_queue_audit row', async () => {
    const id = await guest();
    const d = await svc.assignTechnician(desk, id, { technicianId: TA, reason: 'her regular' });
    expect(d.version).toBe(2);
    const h = await svc.history(desk, id);
    expect(h.history.map((x) => [x.version, x.action, x.source, x.fromStatus, x.toStatus, x.toTechnicianId])).toEqual([[1, 'check_in', 'system', null, 'waiting', null], [2, 'assign', 'staff', 'waiting', 'assigned', TA]]);
    expect(h.history[1]).toMatchObject({ actorId: USER, reason: 'her regular' });
    const a = await one(`SELECT user_id, role, action_type, entity_id, metadata FROM pos_queue_audit WHERE entity_id = '${id}'`);
    expect(a).toMatchObject({ user_id: USER, role: 'FRONT_DESK', action_type: 'pos_queue_technician_assigned', entity_id: id });
    expect(a.metadata).toMatchObject({ source: 'staff', reason: 'her regular' });
  });
  it('a writer OUTSIDE the queue screen (serving, booking …) also bumps the version and leaves history', async () => {
    const id = await guest({ assigned_technician_id: `'${TA}'`, status: `'assigned'` });
    await pg.query(`UPDATE pos_queue_items SET status = 'in_service', started_at = now() WHERE id = '${id}'`);
    const r = await one(`SELECT version FROM pos_queue_items WHERE id = '${id}'`);
    expect(r.version).toBe(2);
    expect((await svc.history(desk, id)).history.at(-1)).toMatchObject({ action: 'status', source: 'system', fromStatus: 'assigned', toStatus: 'in_service', actorId: null });
  });
  it('a non-transition write (ticket link, notes) does NOT bump the version', async () => {
    const id = await guest();
    await pg.query(`UPDATE pos_queue_items SET notes = 'likes coffee' WHERE id = '${id}'`);
    expect((await one(`SELECT version FROM pos_queue_items WHERE id = '${id}'`)).version).toBe(1);
  });
  it('a failed write leaves NO history and NO audit (same transaction)', async () => {
    const id = await guest();
    await expect(svc.assignTechnician(desk, id, { technicianId: TA, expectedTechnicianId: TB })).rejects.toBeInstanceOf(QueueAssignmentConflict);
    expect((await all(`SELECT 1 FROM pos_queue_status_history WHERE queue_item_id = '${id}' AND action <> 'check_in'`)).length).toBe(0);
    expect((await all(`SELECT 1 FROM pos_queue_audit WHERE entity_id = '${id}'`)).length).toBe(0);
  });
});

describe('the real updated_at (bug 3)', () => {
  it('scan entries show the row\'s own updated_at, and a transition stamps a new one', async () => {
    const id = await guest({ updated_at: `now() - interval '2 hours'`, checked_in_at: `now() - interval '2 hours'` });
    const before = (await svc.scanEntries(desk)).find((e) => e.queueEntryId === id)!;
    expect(Date.now() - Date.parse(before.updatedAt)).toBeGreaterThan(110 * 60000);
    await svc.assignTechnician(desk, id, { technicianId: TB });
    const after = (await svc.scanEntries(desk)).find((e) => e.queueEntryId === id)!;
    expect(Date.now() - Date.parse(after.updatedAt)).toBeLessThan(60000);
  });
});

describe('ALL active entries, no cap (bug 4)', () => {
  it('25 guests on one technician: the scan sees every one (in service included), the workload counts all 25', async () => {
    await pg.query(`DELETE FROM pos_queue_items WHERE tenant_id = '${T}'`);
    for (let i = 0; i < 24; i++) await guest({ assigned_technician_id: `'${TB}'`, status: `'assigned'` });
    await guest({ assigned_technician_id: `'${TB}'`, status: `'in_service'`, started_at: `now() - interval '20 minutes'` });
    await guest({ status: `'completed'`, checked_in_at: `now() - interval '9 days'` });   // history, not active
    const target = await guest();
    const scan = await svc.scanEntries(desk);
    expect(scan).toHaveLength(26);
    expect(scan.filter((e) => e.status === 'in_service')).toHaveLength(1);
    const inputs = await svc.assignmentInputs(desk, target);
    const bea = inputs.candidates.find((c) => c.technicianId === TB)!;
    expect(bea.activeAssignments).toBe(25);
    expect(bea.assignedMinutes).toBe(24 * 45 + 25);
    expect(bea.availableInMinutes).toBe(25);   // her current service started 20 min ago, 45 min long
    expect(bea.isPrevious).toBe(false);
  });
  it("the board no longer loads the branch's whole history", async () => {
    const st = await svc.getState(desk, { status: 'completed' });
    expect(st.queue.items).toHaveLength(0);   // the 9-day-old completed visit is not read
  });
});

describe('requested + previous technician (bug 1), real branch', () => {
  it('previous_technician_id is stamped at check-in from the last FINISHED visit (not a cancelled one)', async () => {
    const id = await guest({ customer_id: `'${CUST}'`, requested_technician_id: `'${TB}'` });
    expect((await one(`SELECT previous_technician_id FROM pos_queue_items WHERE id = '${id}'`)).previous_technician_id).toBe(TA);
    const inputs = await svc.assignmentInputs(desk, id);
    expect(inputs.entry).toMatchObject({ requestedTechnicianId: TB, previousTechnicianId: TA });
    expect(inputs.candidates.find((c) => c.technicianId === TA)!.isPrevious).toBe(true);
  });
  it('a row checked in before migration 525 falls back to computing it', async () => {
    const id = await guest({ customer_id: `'${CUST}'` });
    await pg.query(`UPDATE pos_queue_items SET previous_technician_id = NULL WHERE id = '${id}'`);
    expect((await svc.detail(desk, id)).previousTechnicianId).toBe(TA);
  });
  it("each candidate carries the technician's REAL branch (a salon-wide caller sees Cal at East)", async () => {
    const id = await guest();
    const r = await svc.assignmentInputs({ ...desk, branchId: '' }, id);
    expect(r.candidates.find((c) => c.technicianId === TC)?.branchId).toBe(B2);
    expect(r.candidates.find((c) => c.technicianId === TA)?.branchId).toBe(B);
  });
});

describe("an appointment's start in the BRANCH zone (bug 2)", () => {
  it("'09:30' on 2026-10-07 in Los Angeles is 16:30Z; checked in at 16:45Z = 15 minutes late", async () => {
    await pg.query(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) VALUES ('${APPT}', '${T}', '${B}', '${TA}', 'Rita', '2026-10-07', '09:30', '10:15', 'checked_in')`);
    const id = await guest({ source: `'appointment'`, appointment_id: `'${APPT}'`, checked_in_at: `'2026-10-07T16:45:00Z'` });
    const d = await svc.detail(desk, id);
    expect(d.appointmentStartAt).toBe('2026-10-07T16:30:00.000Z');
    expect(d.lateMinutes).toBe(15);
    const s = (await svc.scanEntries(desk)).find((e) => e.queueEntryId === id)!;
    expect(s).toMatchObject({ isAppointment: true, appointmentStartAt: '2026-10-07T16:30:00.000Z', lateMinutes: 15 });
  });
});

describe('locks, idempotency, reorder, parties, multi-technician visits', () => {
  it('a lock to Ava refuses Bea and bumps the version with a "lock" history row; unlock frees it', async () => {
    const id = await guest();
    const d = await svc.lock(mgr, id, { technicianId: TA, reason: 'regular of Ava', expiresInMinutes: 60 });
    expect(d.version).toBe(2);
    expect(d.lock).toMatchObject({ technicianId: TA, technicianName: 'Ava A', reason: 'regular of Ava', lockedBy: MGR });
    const e = await svc.assignTechnician(desk, id, { technicianId: TB }).catch((x) => x);
    expect(e).toBeInstanceOf(QueueAssignmentLocked);
    expect((await svc.scanEntries(desk)).find((x) => x.queueEntryId === id)?.lock).toEqual({ technicianId: TA, reason: 'regular of Ava' });
    await svc.unlock(mgr, id, { reason: 'Ava left early' });
    expect((await svc.assignTechnician(desk, id, { technicianId: TB })).assignedTechnicianId).toBe(TB);
    expect((await svc.history(desk, id)).history.map((x) => x.action)).toEqual(['check_in', 'lock', 'unlock', 'assign']);
    expect((await all(`SELECT 1 FROM queue_assignment_locks WHERE queue_item_id = '${id}' AND released_at IS NULL`)).length).toBe(0);
  });
  it('an expired lock no longer holds', async () => {
    const id = await guest();
    await svc.lock(mgr, id, { technicianId: null, reason: 'hold' });
    await pg.query(`UPDATE queue_assignment_locks SET expires_at = now() - interval '1 minute' WHERE queue_item_id = '${id}'`);
    expect((await svc.assignTechnician(desk, id, { technicianId: TA })).assignedTechnicianId).toBe(TA);
  });
  it('the same idempotency key writes once; the history row carries the key', async () => {
    const id = await guest();
    const a = await svc.assignTechnician(desk, id, { technicianId: TA, expectedTechnicianId: null, source: 'ai_suggestion', idempotencyKey: 'p6-key-1' });
    const b = await svc.assignTechnician(desk, id, { technicianId: TA, expectedTechnicianId: null, source: 'ai_suggestion', idempotencyKey: 'p6-key-1' });
    expect(b.version).toBe(a.version);
    expect((await all(`SELECT 1 FROM pos_queue_status_history WHERE idempotency_key = 'p6-key-1'`)).length).toBe(1);
    expect((await all(`SELECT 1 FROM pos_queue_audit WHERE entity_id = '${id}'`)).length).toBe(1);
  });
  it("the repository's compare-and-set includes the version (a change between the service's read and the write)", async () => {
    const id = await guest();
    await pg.query(`UPDATE pos_queue_items SET priority = 'high' WHERE id = '${id}'`);   // version 2 behind the caller's back
    const e = await repo.assign(desk, id, TA, { status: 'waiting', technicianId: null, version: 1 }, { action: 'assign', source: 'auto_assign' }).catch((x) => x);
    expect(e).toBeInstanceOf(QueueAssignmentConflict);
    expect(e.currentVersion).toBe(2);
    expect((await one(`SELECT assigned_technician_id FROM pos_queue_items WHERE id = '${id}'`)).assigned_technician_id).toBeNull();
  });
  it('reorder: positions in one transaction; a stale version refuses all of it', async () => {
    const a = await guest(); const b = await guest();
    const r = await svc.reorder(desk, { order: [{ queueItemId: b, expectedVersion: 1 }, { queueItemId: a, expectedVersion: 1 }] });
    expect(r.order.map((o) => [o.queueItemId, o.position, o.version])).toEqual([[b, 1, 2], [a, 2, 2]]);
    await expect(svc.reorder(desk, { order: [{ queueItemId: a, expectedVersion: 2 }, { queueItemId: b, expectedVersion: 1 }] })).rejects.toBeInstanceOf(QueueAssignmentConflict);
    expect((await one(`SELECT position FROM pos_queue_items WHERE id = '${a}'`)).position).toBe(2);   // rolled back
  });
  it('a party, and a visit split between two technicians', async () => {
    const a = await guest(); const b = await guest();
    const g = await svc.createGroup(desk, { label: 'Bridal party', queueItemIds: [a, b] });
    expect(g).toMatchObject({ label: 'Bridal party', size: 2, status: 'waiting' });
    expect(g.members.map((m) => m.queueItemId).sort()).toEqual([a, b].sort());
    expect((await svc.detail(desk, a)).groupId).toBe(g.groupId);
    const d = await svc.setServiceAssignments(desk, a, { assignments: [{ serviceId: SVC, technicianId: TB }] });
    expect(d.serviceAssignments).toMatchObject([{ serviceId: SVC, serviceName: 'Gel Manicure', technicianId: TB, technicianName: 'Bea B', status: 'assigned', sequence: 0, timing: 'parallel', version: 1 }]);
    // multi-technician routing: the old PUT now goes through the ONE plan writer (the line's technician leads the visit)
    expect((await svc.history(desk, a)).history.map((x) => x.action)).toEqual(['check_in', 'group', 'assign_plan']);
    expect(d.assignedTechnicianId).toBe(TB);
  });
  it('the customer accepts another technician (source customer)', async () => {
    const id = await guest({ customer_id: `'${CUST}'`, requested_technician_id: `'${TB}'` });
    const cust: QueueContext = { tenantId: T, branchId: '', userId: USER, role: 'CUSTOMER', permissions: [] };
    const alts = await svc.customerAlternates(cust, id);
    expect(alts.alternates.map((x) => x.technicianId)).toEqual([TA]);
    const r = await svc.acceptAlternate(cust, id, { technicianId: TA });
    expect(r).toMatchObject({ requestedTechnicianId: TA, version: 2 });
    expect((await svc.history(desk, id)).history.at(-1)).toMatchObject({ action: 'accept_alternate', source: 'customer', actorId: USER });
  });
});

describe('technician signals from schedules, breaks and blocked time', () => {
  it('a blocked technician and one on a manual break', async () => {
    const r2 = new KyselyQueueRepository(db as never);
    r2.now = () => Date.parse('2026-10-07T18:00:00Z');   // 11:00 in Los Angeles (a Wednesday)
    await pg.exec(`
      INSERT INTO technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) VALUES ('${T}', '${B}', '${TA}', 3, '09:00', '17:00', true);
      INSERT INTO technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason) VALUES ('${T}', '${B}', '${TA}', '2026-10-07', '10:30', '11:20', 'training');
      INSERT INTO technician_statuses (tenant_id, branch_id, technician_id, status) VALUES ('${T}', '${B}', '${TB}', 'on_break');
    `);
    const rows = await r2.techSignals(desk, []);
    expect(rows.find((t) => t.technicianId === TA)!.signals).toMatchObject({ blocked: true, availableInMinutes: 20, shiftEndsInMinutes: 360, status: 'blocked' });
    expect(rows.find((t) => t.technicianId === TB)!.signals).toMatchObject({ onBreak: true, status: 'on_break' });
    const avail = await new QueueService(r2).technicianAvailability(desk);
    expect(avail.find((a) => a.technicianId === TA)).toMatchObject({ status: 'blocked', availableInMinutes: 20, shiftEndsInMinutes: 360, onBreak: false });
  });
});
