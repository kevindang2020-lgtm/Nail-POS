import { describe, it, expect } from 'vitest';
import { KyselyQueueRepository } from './queue.kysely.repository';
import type { QueueContext } from './queue.repository';

// Cross-screen integrity (§3, §51 "Assignment updates Tech Queue"): moving a guest to the Tech Queue must PROJECT the
// existing Customer Queue record (linked by queue_item_id) rather than create a duplicate customer visit, must be
// idempotent (an existing projection is reused, never re-inserted), and must require an assigned technician. This
// drives the REAL production method `KyselyQueueRepository.projectToTechQueue` against a Kysely-shaped fake db (the
// same pattern as the checkout payment-persistence guard) — no live Postgres required.

const ctx: QueueContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: [] } as any;

function makeFakeDb(opts: { existing?: any; queueItem?: any }) {
  const inserts: Record<string, any> = {};
  const selectB = (result: any) => {
    const b: any = {};
    b.where = () => b; b.select = () => b;
    b.executeTakeFirst = async () => result;
    b.execute = async () => (result == null ? [] : Array.isArray(result) ? result : [result]);
    return b;
  };
  const insertB = (table: string) => {
    let vals: any; const b: any = {};
    b.values = (v: any) => { vals = v; return b; };
    b.onConflict = () => b; b.returning = () => b;
    b.executeTakeFirst = async () => { inserts[table] = vals; return { id: 'tq_new' }; };
    b.executeTakeFirstOrThrow = async () => { inserts[table] = vals; return { id: 'tq_new' }; };
    b.execute = async () => { inserts[table] = vals; return []; };
    return b;
  };
  const db: any = {
    selectFrom: (t: string) => selectB(t === 'pos_tech_queue_tickets' ? opts.existing : t === 'pos_queue_items' ? opts.queueItem : undefined),
    insertInto: (t: string) => insertB(t),
  };
  // the insert now runs in a transaction (it records technician.assigned with it); the fake runs the callback on itself
  db.transaction = () => ({ execute: async (fn: (trx: any) => Promise<any>) => fn(db) });
  return { db, inserts };
}

const queueItem = {
  id: 'q_5005', branch_id: 'br_cherryhill', customer_id: 'cust_jess', customer_name: 'Jessica Miller', customer_phone: '+1555',
  is_vip: true, source: 'walk_in', appointment_id: null, ticket_id: null, requested_services: '[]', priority: 'vip', assigned_technician_id: 'tech_mia',
};

describe('Customer Queue → Tech Queue projects one shared record', () => {
  it('inserts a tech-queue ticket linked by queue_item_id (not a duplicate visit)', async () => {
    const { db, inserts } = makeFakeDb({ existing: undefined, queueItem });
    const repo = new KyselyQueueRepository(db);
    const res = await repo.projectToTechQueue(ctx, 'q_5005');

    expect(res).toEqual({ created: true, techQueueTicketId: 'tq_new' });
    const row = inserts['pos_tech_queue_tickets'];
    expect(row).toBeTruthy();
    expect(row.queue_item_id).toBe('q_5005');               // same authoritative record
    expect(row.assigned_technician_id).toBe('tech_mia');
    expect(row.status).toBe('assigned');
    expect(row.customer_id).toBe('cust_jess');
    expect(row.customer_name).toBe('Jessica Miller');
  });

  it('is idempotent: an existing projection is reused, never re-inserted', async () => {
    const { db, inserts } = makeFakeDb({ existing: { id: 'tq_existing' }, queueItem });
    const repo = new KyselyQueueRepository(db);
    const res = await repo.projectToTechQueue(ctx, 'q_5005');
    expect(res).toEqual({ created: false, techQueueTicketId: 'tq_existing' });
    expect(inserts['pos_tech_queue_tickets']).toBeUndefined();  // no duplicate row
  });

  it('refuses to project without an assigned technician', async () => {
    const { db, inserts } = makeFakeDb({ existing: undefined, queueItem: { ...queueItem, assigned_technician_id: null } });
    const repo = new KyselyQueueRepository(db);
    const res = await repo.projectToTechQueue(ctx, 'q_5005');
    expect(res).toEqual({ created: false });
    expect(inserts['pos_tech_queue_tickets']).toBeUndefined();
  });
});
