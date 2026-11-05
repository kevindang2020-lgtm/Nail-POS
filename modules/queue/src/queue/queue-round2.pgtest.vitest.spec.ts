// queue-round2.pgtest.vitest.spec.ts — BUILD_PLAN Phase 6 round 2 on the real schema: the board row's lock, the Tech
// Queue's waiting guests (version + assignee), and what the TECHNICIAN sees — how a guest came to them (staff / AI
// suggestion / auto / repair / customer, from the latest assign row of pos_queue_status_history) and whether a manager
// locked the guest to them. Tech-queue tickets join to their pos_queue_items row.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyQueueRepository } from './queue.kysely.repository';
import { QueueService } from './queue.service';
import { KyselyTechQueueRepository } from '../tech-queue/tech-queue.kysely.repository';
import { KyselyTechRepository } from '../tech/tech.kysely.repository';
import type { QueueContext } from './queue.repository';
import { KyselyGoCheckInRepository } from '../go-check-in/go-check-in.kysely.repository';

const T = 'a6300000-0000-4000-8000-000000000001';
const B = 'a6300000-0000-4000-8000-000000000002';
const CAT = 'a6300000-0000-4000-8000-000000000004';
const SVC = 'a6300000-0000-4000-8000-000000000005';
const TA = 'a6300000-0000-4000-8000-0000000000a1';
const TB = 'a6300000-0000-4000-8000-0000000000b1';
const MGR = 'a6300000-0000-4000-8000-0000000000e2';
const PERMS = ['pos.queue.view', 'pos.queue.create', 'pos.queue.edit', 'pos.queue.assign_technician', 'pos.queue.move_to_tech_queue', 'ai_queue_assignment.override'];
const mgr: QueueContext = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: PERMS };
const system: QueueContext = { tenantId: T, branchId: B, userId: '', role: '', permissions: [], system: true };

let pg: any; let db: any; let svc: QueueService;
let seq = 0;
async function guest(over: Record<string, string> = {}): Promise<string> {
  const cols = { tenant_id: `'${T}'`, branch_id: `'${B}'`, customer_name: `'Guest ${++seq}'`, status: `'waiting'`, source: `'walk_in'`, priority: `'normal'`,
    requested_services: `'[{"serviceId":"${SVC}","serviceName":"Gel Manicure","estimatedDurationMinutes":45,"priceCents":4500}]'`, ...over };
  return (await pg.query(`INSERT INTO pos_queue_items (${Object.keys(cols).join(',')}) VALUES (${Object.values(cols).join(',')}) RETURNING id`)).rows[0].id;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'R2 Salon', 'R2 Salon', 'r2-salon', 'R2SALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO users (id, tenant_id, full_name, status, role) VALUES ('${MGR}', '${T}', 'Manager', 'active', 'MANAGER');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 45, 4500);
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES
      ('${TA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active'), ('${TB}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active');
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${TA}', '${SVC}'), ('${T}', '${B}', '${TB}', '${SVC}');
  `);
  svc = new QueueService(new KyselyQueueRepository(db as never));
}, 120000);

describe('board rows (GET pos/queue/state, items)', () => {
  it('carry lock { technicianId, reason } and locked; null when unlocked', async () => {
    const a = await guest(); const b = await guest();
    await svc.lock(mgr, a, { technicianId: TA, reason: 'regular of Ava' });
    const rows = (await svc.items(mgr, {})).items;
    expect(rows.find((r) => r.queueItemId === a)).toMatchObject({ locked: true, lock: { technicianId: TA, reason: 'regular of Ava' }, version: 2, groupId: null, requestedTechnicianId: null, assignedTechnicianId: null });
    expect(rows.find((r) => r.queueItemId === b)).toMatchObject({ locked: false, lock: null });
  });
});

describe('Tech Queue waitingGuests', () => {
  it('carry the queue item version and assignee (null when unassigned)', async () => {
    await pg.query(`DELETE FROM pos_queue_items WHERE tenant_id = '${T}'`);
    const a = await guest(); const b = await guest({ status: `'called'` });
    await svc.assignTechnician(mgr, b, { technicianId: TB });   // called → assigned is not "waiting" any more; keep a called one
    const c = await guest({ status: `'called'`, assigned_technician_id: `'${TA}'` });
    const st: any = await new KyselyTechQueueRepository(db as never).query({ tenantId: T, branchId: B } as never, {});
    const g = (id: string) => st.waitingGuests.find((x: any) => x.queueItemId === id);
    expect(g(a)).toMatchObject({ version: 1, assignedTechnicianId: null });
    expect(g(c)).toMatchObject({ version: 1, assignedTechnicianId: TA });
  });
});

describe('what the technician sees: assignSource, lock, lockedToYou', () => {
  it('myQueue / branchQueue / ticket detail join the queue item: an auto-assigned guest locked to Ava', async () => {
    await pg.query(`DELETE FROM pos_queue_items WHERE tenant_id = '${T}'`);
    const q = await guest();
    await svc.lock(mgr, q, { technicianId: TA, reason: 'her regular' });
    await svc.assignTechnician(system, q, { technicianId: TA, expectedTechnicianId: null, source: 'auto_assign' });
    await svc.moveToTechQueue(mgr, q);
    const staffQ = await guest();
    await svc.assignTechnician(mgr, staffQ, { technicianId: TA });
    await svc.moveToTechQueue(mgr, staffQ);
    const tech = new KyselyTechRepository(db as never);
    const ctx = { tenantId: T, branchId: B, userId: MGR, role: 'TECHNICIAN', permissions: [] } as never;
    const st: any = await tech.queueState(ctx, TA);
    const mine = (qid: string) => st.myQueue.find((e: any) => e.queueItemId === qid);
    expect(mine(q)).toMatchObject({ assignSource: 'auto_assign', lock: { technicianId: TA, reason: 'her regular' }, lockedToYou: true });
    expect(mine(staffQ)).toMatchObject({ assignSource: 'staff', lock: null, lockedToYou: false });
    const beaView: any = await tech.queueState(ctx, TB);
    expect(beaView.branchQueue.find((e: any) => e.queueItemId === q)).toMatchObject({ assignSource: 'auto_assign', lockedToYou: false });
    const ticketId = mine(q).ticketId;
    const detail: any = await tech.getTicket(ctx, ticketId);
    expect(detail).toMatchObject({ queueItemId: q, assignSource: 'auto_assign', lock: { technicianId: TA, reason: 'her regular' } });
  });
  it('the LATEST assignment wins: staff assigned, then cleared, then the auto-run → auto_assign', async () => {
    const q = await guest();
    await svc.assignTechnician(mgr, q, { technicianId: TB });
    await svc.unassignTechnician(mgr, q, { reason: 'Bea went home' });
    await svc.assignTechnician(system, q, { technicianId: TA, expectedTechnicianId: null, source: 'auto_assign' });
    await svc.moveToTechQueue(mgr, q);
    const st: any = await new KyselyTechRepository(db as never).queueState({ tenantId: T, branchId: B, userId: MGR, role: 'TECHNICIAN', permissions: [] } as never, TA);
    expect(st.myQueue.find((e: any) => e.queueItemId === q).assignSource).toBe('auto_assign');
  });
  it('an accepted AI suggestion reports ai_suggestion', async () => {
    const q = await guest();
    await svc.assignTechnician(mgr, q, { technicianId: TB, expectedTechnicianId: null, source: 'ai_suggestion' });
    await svc.moveToTechQueue(mgr, q);
    const st: any = await new KyselyTechRepository(db as never).queueState({ tenantId: T, branchId: B, userId: MGR, role: 'TECHNICIAN', permissions: [] } as never, TB);
    expect(st.myQueue.find((e: any) => e.queueItemId === q)).toMatchObject({ assignSource: 'ai_suggestion', lock: null, lockedToYou: false });
  });
});

describe('kiosk: only the session that checked a guest in may re-route them', () => {
  it('sessionOwnsQueueItem reads the session\'s own log lines (check-in or queue item id)', async () => {
    const S1 = 'a6300000-0000-4000-8000-0000000000c1', S2 = 'a6300000-0000-4000-8000-0000000000c2';
    const q = await guest();
    const r = new KyselyGoCheckInRepository(db as never);
    await r.insertLog({ tenantId: T, branchId: B, sessionId: S1, eventType: 'queue_item_created', metadata: { queueItemId: q } } as any);
    expect(await r.sessionOwnsQueueItem(T, S1, q)).toBe(true);
    expect(await r.sessionOwnsQueueItem(T, S2, q)).toBe(false);
    expect(await r.sessionOwnsQueueItem('a6300000-0000-4000-8000-00000000ffff', S1, q)).toBe(false);   // another salon
  });
});
