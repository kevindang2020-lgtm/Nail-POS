import { describe, it, expect } from 'vitest';
import { KyselyQueueRepository } from './queue.kysely.repository';
import type { QueueContext } from './queue.repository';

// Cross-screen integrity (§3, §39, §51): when a guest starts service, the Customer Queue item must materialize into the
// SAME authoritative `tickets` row that Serving / Service Done / Checkout read — linked by queue_item_id — rather than a
// duplicate customer visit, and the queue item must be back-linked to that ticket. This drives the REAL production
// repository method (`createTicketFromQueueItem`) against a Kysely-shaped fake db (the project's established pattern,
// per checkout-payment-persistence) and asserts the linkage, so no live Postgres is required.

const ctx: QueueContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: [] } as any;

// Multi-technician routing: the ticket is built by ensureVisitTicket from the queue ROW (read FOR UPDATE in a transaction),
// so the fake answers that read with the item's row and runs the transaction on itself.
function makeFakeDb(row: any = null) {
  const inserts: Record<string, any> = {};
  const updates: Record<string, any> = {};
  const selectB = (result: any) => {
    const b: any = {};
    b.where = () => b; b.select = () => b; b.forUpdate = () => b;
    b.execute = async () => (result == null ? [] : Array.isArray(result) ? result : [result]);
    b.executeTakeFirst = async () => result;
    return b;
  };
  const insertB = (table: string) => {
    let vals: any; const b: any = {};
    b.values = (v: any) => { vals = v; return b; };
    b.onConflict = () => b; b.returning = () => b;
    const ret = () => (table === 'ticket_number_counters' ? { last_seq: 7 } : { id: 'tk_new' });
    b.executeTakeFirst = async () => { inserts[table] = vals; return ret(); };
    b.executeTakeFirstOrThrow = async () => { inserts[table] = vals; return ret(); };
    b.execute = async () => { inserts[table] = vals; return []; };
    return b;
  };
  const updateB = (table: string) => {
    let set: any; const b: any = {};
    b.set = (s: any) => { set = s; return b; };
    b.where = () => b;
    b.executeTakeFirst = async () => { updates[table] = set; return { numUpdatedRows: 1 }; };
    b.execute = async () => { updates[table] = updates[table] ?? set; return []; };
    return b;
  };
  const db: any = { insertInto: (t: string) => insertB(t), selectFrom: (t: string) => selectB(t === 'pos_queue_items' ? row : undefined), updateTable: (t: string) => updateB(t) };
  db.transaction = () => ({ execute: (fn: any) => fn(db) });
  return { db, inserts, updates };
}

const item: any = {
  queueItemId: 'q_5005', customerId: 'cust_jess', customerName: 'Jessica Miller', assignedTechId: 'tech_mia',
  services: [
    { serviceId: 'svc_gelx', serviceName: 'Gel X Full Set', estimatedDurationMinutes: 60, priceCents: 9500 },
    { serviceId: 'svc_art', serviceName: 'Nail Art', estimatedDurationMinutes: 20, priceCents: 2000 },
  ],
};

const rowOf = (it: any) => ({ id: it.queueItemId, branch_id: 'br_cherryhill', customer_id: it.customerId, ticket_id: null, requested_services: JSON.stringify(it.services), assigned_technician_id: it.assignedTechId });

describe('Customer Queue → Serving share one authoritative record', () => {
  it('materializes a single serving ticket linked by queue_item_id and back-links the queue item', async () => {
    const { db, inserts, updates } = makeFakeDb(rowOf(item));
    const repo = new KyselyQueueRepository(db);
    const ticketId = await repo.createTicketFromQueueItem(ctx, item);

    expect(ticketId).toBe('tk_new');
    // ONE tickets row, carrying the shared-record link + serving state + correct ownership
    expect(inserts['tickets']).toBeTruthy();
    expect(inserts['tickets'].queue_item_id).toBe('q_5005');     // same authoritative record, not a duplicate visit
    expect(inserts['tickets'].customer_id).toBe('cust_jess');
    expect(inserts['tickets'].primary_technician_id).toBe('tech_mia');
    expect(inserts['tickets'].status).toBe('serving');
    expect(inserts['tickets'].serving_started_at).toBeTruthy();
    // service lines attach to that same ticket (one per requested service)
    expect(Array.isArray(inserts['ticket_service_lines'])).toBe(true);
    expect(inserts['ticket_service_lines']).toHaveLength(2);
    expect(inserts['ticket_service_lines'].every((l: any) => l.ticket_id === 'tk_new')).toBe(true);
    // queue item is back-linked to the ticket (so the two screens resolve to one record)
    expect(updates['pos_queue_items'].ticket_id).toBe('tk_new');
  });

  it('a guest with no services still produces exactly one linked ticket (no service-line insert)', async () => {
    const { db, inserts } = makeFakeDb(rowOf({ ...item, services: [] }));
    const repo = new KyselyQueueRepository(db);
    const ticketId = await repo.createTicketFromQueueItem(ctx, { ...item, services: [] });
    expect(ticketId).toBe('tk_new');
    expect(inserts['tickets'].queue_item_id).toBe('q_5005');
    expect(inserts['ticket_service_lines']).toBeUndefined();
  });
});
