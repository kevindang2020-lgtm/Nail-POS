// tech-shared-visit.pgtest.vitest.spec.ts — multi-technician routing, serving per line (contract §3) on the REAL
// migrated schema (PGlite incl. 569). A split visit moved to the Tech Queue becomes one part per technician; each part
// starts / pauses / finishes ONLY its own lines; the visit (ticket + queue item) completes exactly once, when the last
// part finishes — with ONE service.completed. A whole visit (legacy) keeps the old path. (Concurrent completes run on
// real Postgres in queue-multitech.postgres-race.vitest.spec.ts.)
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyQueueRepository } from '../queue/queue.kysely.repository';
import { QueueService } from '../queue/queue.service';
import { KyselyTechRepository } from './tech.kysely.repository';

const T = 'a5691000-0000-4000-8000-000000000001';
const B = 'a5691000-0000-4000-8000-000000000002';
const CP = 'a5691000-0000-4000-8000-0000000000c1', CM = 'a5691000-0000-4000-8000-0000000000c2';
const SP = 'a5691000-0000-4000-8000-0000000000d1', SM = 'a5691000-0000-4000-8000-0000000000d2', SA = 'a5691000-0000-4000-8000-0000000000d3';
const TP = 'a5691000-0000-4000-8000-0000000000a1', TM = 'a5691000-0000-4000-8000-0000000000a2';
const USER = 'a5691000-0000-4000-8000-0000000000e1';
const CUST = 'a5691000-0000-4000-8000-0000000000f1';
const desk: any = { tenantId: T, branchId: B, userId: USER, role: 'FRONT_DESK', permissions: ['pos.queue.view', 'pos.queue.edit', 'pos.queue.assign_technician', 'pos.queue.move_to_tech_queue'] };
const tctx: any = { tenantId: T, branchId: B, userId: USER, role: 'TECHNICIAN', permissions: [] };
const SVCS = `[{"serviceId":"${SP}","serviceName":"Pedicure","estimatedDurationMinutes":50,"priceCents":6000},{"serviceId":"${SM}","serviceName":"Manicure","estimatedDurationMinutes":40,"priceCents":4000},{"serviceId":"${SA}","serviceName":"Nail Art","estimatedDurationMinutes":20,"priceCents":3000,"isAddon":true,"parentServiceId":"${SM}"}]`;

let pg: any; let db: any; let queue: QueueService; let tech: KyselyTechRepository;
const one = async (q: string) => (await pg.query(q)).rows[0];
const all = async (q: string) => (await pg.query(q)).rows;
let n = 0;
async function guest(services = SVCS): Promise<string> {
  return (await one(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_id, customer_name, status, source, priority, requested_services)
    VALUES ('${T}', '${B}', '${CUST}', 'Guest ${++n}', 'waiting', 'walk_in', 'normal', '${services}') RETURNING id`)).id;
}
async function splitVisit(): Promise<{ id: string; partP: string; partM: string }> {
  await pg.query(`UPDATE pos_queue_items SET status = 'cancelled' WHERE tenant_id = '${T}' AND status NOT IN ('completed','cancelled','removed')`);   // one active visit per customer
  const id = await guest();
  await queue.assignPlan(desk, { items: [{ queueItemId: id, expectedVersion: 1, expectedTechnicianId: null, lines: [
    { serviceId: SP, technicianId: TP, expectedTechnicianId: null }, { serviceId: SM, technicianId: TM, expectedTechnicianId: null }, { serviceId: SA, technicianId: TM, expectedTechnicianId: null }] }],
    idempotencyKey: `sv-${id}`, source: 'staff' });
  const moved = await queue.moveToTechQueue(desk, id);
  const parts = await all(`SELECT id, assigned_technician_id FROM pos_tech_queue_tickets WHERE queue_item_id = '${id}' ORDER BY visit_part`);
  expect(moved.techQueueTicketIds).toEqual(parts.map((p: any) => p.id));
  return { id, partP: parts.find((p: any) => p.assigned_technician_id === TP).id, partM: parts.find((p: any) => p.assigned_technician_id === TM).id };
}
const ticketLines = (ticketId: string) => all(`SELECT service_id, technician_id, status, completed_at IS NOT NULL AS done FROM ticket_service_lines WHERE ticket_id = '${ticketId}' ORDER BY service_name_snapshot`);
const completedEvents = (ticketId: string) => all(`SELECT 1 FROM outbox_events WHERE event_type = 'service.completed' AND aggregate_id = '${ticketId}'`);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'SV Salon LLC', 'SV Salon', 'sv-salon', 'SVSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO users (id, tenant_id, full_name, status, role) VALUES ('${USER}', '${T}', 'Desk', 'active', 'CUSTOMER');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CUST}', '${T}', '${B}', 'Rita', 'R', 'Rita R');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CP}', '${T}', '${B}', 'Pedicure'), ('${CM}', '${T}', '${B}', 'Manicure');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES
      ('${SP}', '${T}', '${B}', '${CP}', 'Pedicure', 50, 6000), ('${SM}', '${T}', '${B}', '${CM}', 'Manicure', 40, 4000), ('${SA}', '${T}', '${B}', '${CM}', 'Nail Art', 20, 3000);
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TP}', '${T}', '${B}', 'Pia', 'P', 'Pia P', 'active'), ('${TM}', '${T}', '${B}', 'Mo', 'M', 'Mo M', 'active');
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${TP}', '${SP}'), ('${T}', '${B}', '${TM}', '${SM}'), ('${T}', '${B}', '${TM}', '${SA}');
  `);
  const outbox = new OutboxWriter();
  queue = new QueueService(new KyselyQueueRepository(db as never, outbox)); tech = new KyselyTechRepository(db as never, outbox);
}, 120000);

describe('projection: one part per technician', () => {
  it('2 parts (visit_part 1..2), each with only its technician\'s services; the lines record their part; a second move adds nothing', async () => {
    const { id, partP, partM } = await splitVisit();
    const parts = await all(`SELECT id, visit_part, assigned_technician_id, requested_services, status FROM pos_tech_queue_tickets WHERE queue_item_id = '${id}' ORDER BY visit_part`);
    expect(parts.map((p: any) => [p.visit_part, p.assigned_technician_id, p.requested_services.map((s: any) => s.serviceName), p.status]))
      .toEqual([[1, TP, ['Pedicure'], 'assigned'], [2, TM, ['Manicure', 'Nail Art'], 'assigned']]);
    expect((await all(`SELECT service_id, tech_queue_ticket_id FROM queue_service_assignments WHERE queue_item_id = '${id}' ORDER BY sequence`)).map((r: any) => r.tech_queue_ticket_id)).toEqual([partP, partM, partM]);
    expect(await all(`SELECT 1 FROM outbox_events WHERE event_type = 'technician.assigned' AND aggregate_id IN ('${partP}', '${partM}')`)).toHaveLength(2);
    const again = await queue.moveToTechQueue(desk, id);
    expect(again.duplicate).toBe(true);
    expect(await all(`SELECT 1 FROM pos_tech_queue_tickets WHERE queue_item_id = '${id}'`)).toHaveLength(2);
  });
  it('a whole visit (one technician) is ONE legacy row (visit_part null)', async () => {
    await pg.query(`UPDATE pos_queue_items SET status = 'cancelled' WHERE tenant_id = '${T}' AND status NOT IN ('completed','cancelled','removed')`);
    const id = await guest(`[{"serviceId":"${SM}","serviceName":"Manicure","estimatedDurationMinutes":40,"priceCents":4000}]`);
    await queue.assignTechnician(desk, id, { technicianId: TM });
    await queue.moveToTechQueue(desk, id);
    expect(await all(`SELECT visit_part FROM pos_tech_queue_tickets WHERE queue_item_id = '${id}'`)).toEqual([{ visit_part: null }]);
  });
});

describe('serving per part', () => {
  it('part A start moves only A\'s lines; the ticket carries each LINE technician; the visit is in service once', async () => {
    const { id, partP, partM } = await splitVisit();
    expect(await tech.accept(tctx, partP)).toBe(true);
    expect(await tech.start(tctx, partP)).toBe(true);
    const ticketId = (await one(`SELECT ticket_id FROM pos_queue_items WHERE id = '${id}'`)).ticket_id;
    expect(ticketId).toBeTruthy();
    expect(await ticketLines(ticketId)).toEqual([
      { service_id: SM, technician_id: TM, status: 'pending', done: false },
      { service_id: SA, technician_id: TM, status: 'pending', done: false },
      { service_id: SP, technician_id: TP, status: 'in_progress', done: false },
    ]);
    expect((await one(`SELECT primary_technician_id, status FROM tickets WHERE id = '${ticketId}'`))).toEqual({ primary_technician_id: TM, status: 'serving' });   // the lead
    expect((await one(`SELECT status FROM pos_queue_items WHERE id = '${id}'`)).status).toBe('in_service');
    expect((await all(`SELECT service_id, status FROM queue_service_assignments WHERE queue_item_id = '${id}' ORDER BY sequence`)).map((r: any) => r.status)).toEqual(['in_service', 'assigned', 'assigned']);
    // the part's own view: only its lines, and who has the rest
    const view = await tech.getTicket(tctx, partP);
    expect(view!.services!.map((s) => s.name)).toEqual(['Pedicure']);
    expect(view!.sharedVisit).toEqual({ visitPart: 1, partCount: 2, others: [{ technicianName: 'Mo M', serviceNames: ['Manicure', 'Nail Art'], status: 'assigned' }] });
    // B starts: the visit is already in service — its version does not move again
    const v = (await one(`SELECT version FROM pos_queue_items WHERE id = '${id}'`)).version;
    await tech.accept(tctx, partM); await tech.start(tctx, partM);
    expect((await one(`SELECT version FROM pos_queue_items WHERE id = '${id}'`)).version).toBe(v);
    expect((await ticketLines(ticketId)).map((l: any) => l.status)).toEqual(['in_progress', 'in_progress', 'in_progress']);
    // pausing B pauses only B's lines
    await tech.pause(tctx, partM);
    expect((await ticketLines(ticketId)).map((l: any) => l.status)).toEqual(['paused', 'paused', 'in_progress']);
    await tech.resume(tctx, partM);
  });
  it('A done → the ticket stays serving (a line event, no service.completed); B done → service_done, the queue item completed, ONE service.completed', async () => {
    const { id, partP, partM } = await splitVisit();
    for (const p of [partP, partM]) { await tech.accept(tctx, p); await tech.start(tctx, p); }
    const ticketId = (await one(`SELECT ticket_id FROM pos_queue_items WHERE id = '${id}'`)).ticket_id;
    await tech.complete(tctx, partP, {} as any);
    expect((await one(`SELECT status FROM tickets WHERE id = '${ticketId}'`)).status).toBe('serving');
    expect((await one(`SELECT status FROM pos_queue_items WHERE id = '${id}'`)).status).toBe('in_service');
    expect((await one(`SELECT status FROM pos_tech_queue_tickets WHERE id = '${partP}'`)).status).toBe('service_done');
    expect((await ticketLines(ticketId)).map((l: any) => [l.technician_id, l.done])).toEqual([[TM, false], [TM, false], [TP, true]]);
    expect(await completedEvents(ticketId)).toHaveLength(0);
    expect(await all(`SELECT 1 FROM outbox_events WHERE event_type = 'ticket.service_line_updated' AND aggregate_id = '${ticketId}'`)).toHaveLength(1);
    expect((await tech.getTicket(tctx, partP))!.status).toBe('done');   // "my lines" are done
    expect((await tech.getTicket(tctx, partM))!.status).toBe('serving');
    await tech.complete(tctx, partM, {} as any);
    expect((await one(`SELECT status FROM tickets WHERE id = '${ticketId}'`)).status).toBe('service_done');
    expect((await one(`SELECT status FROM pos_queue_items WHERE id = '${id}'`)).status).toBe('completed');
    expect(await completedEvents(ticketId)).toHaveLength(1);
    expect((await all(`SELECT status FROM queue_service_assignments WHERE queue_item_id = '${id}'`)).every((r: any) => r.status === 'done')).toBe(true);
    // a repeated "done" on the last part completes nothing twice
    await tech.complete(tctx, partM, {} as any);
    expect(await completedEvents(ticketId)).toHaveLength(1);
    expect((await all(`SELECT 1 FROM pos_queue_status_history WHERE queue_item_id = '${id}' AND to_status = 'completed'`))).toHaveLength(1);
  });
});

describe('a whole visit (one technician) is editable WHILE it is served (wave 4 PILOT)', () => {
  // Found by live-pilot-day.mjs: Mary started Kim's pedicure in the Tech App and tapped "add add-on" → 400 "This ticket
  // has no active service to edit yet." A one-technician visit got its canonical ticket only at Service Done, so every
  // in-service edit (add-on, add service, change a line) was refused for the most common visit there is.
  it('start creates the visit\'s ticket (serving, lines in progress, linked to the queue item and the part); Service Done reuses it — ONE ticket, ONE service.completed', async () => {
    await pg.query(`UPDATE pos_queue_items SET status = 'cancelled' WHERE tenant_id = '${T}' AND status NOT IN ('completed','cancelled','removed')`);
    const id = await guest(`[{"serviceId":"${SM}","serviceName":"Manicure","estimatedDurationMinutes":40,"priceCents":4000}]`);
    await queue.assignTechnician(desk, id, { technicianId: TM });
    await queue.moveToTechQueue(desk, id);
    const part = (await one(`SELECT id FROM pos_tech_queue_tickets WHERE queue_item_id = '${id}'`)).id;
    await tech.accept(tctx, part);
    expect(await tech.start(tctx, part)).toBe(true);
    const view = await tech.getTicket(tctx, part);
    expect(view?.realTicketId).toBeTruthy();
    const ticketId = view!.realTicketId!;
    expect((await one(`SELECT ticket_id FROM pos_queue_items WHERE id = '${id}'`)).ticket_id).toBe(ticketId);
    expect((await one(`SELECT status FROM tickets WHERE id = '${ticketId}'`)).status).toBe('serving');
    expect((await ticketLines(ticketId)).map((l: any) => [l.technician_id, l.status])).toEqual([[TM, 'in_progress']]);
    await tech.complete(tctx, part, {} as any);
    expect((await all(`SELECT id FROM tickets WHERE queue_item_id = '${id}'`)).map((r: any) => r.id)).toEqual([ticketId]);
    expect((await one(`SELECT status FROM tickets WHERE id = '${ticketId}'`)).status).toBe('service_done');
    expect(await completedEvents(ticketId)).toHaveLength(1);
  });
});
