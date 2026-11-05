// customer-checkin.pgtest.vitest.spec.ts — the spec requires "prevent duplicate check-in". This pins it against the
// real schema: a second check-in of the same appointment (double-tap / retry) must return the SAME queue item and never
// create a second one. The write path also takes an advisory lock + re-checks inside the txn, closing the concurrent race.
import { describe, it, expect, beforeAll } from 'vitest';
import { OutboxWriter } from '@aipowersalon/events';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCustomerRepository } from './customer.kysely.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'cc000000-0000-0000-0000-000000000001';
const BR = 'cc000000-0000-0000-0000-0000000000b1';
const CUST = 'cc000000-0000-0000-0000-0000000000c1';
const APPT = 'cc000000-0000-0000-0000-0000000000a1';
const ctx: any = { tenantId: T, branchId: BR, userId: 'u1', role: 'CUSTOMER', permissions: [] };

let pg: PGlite;
let repo: KyselyCustomerRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
const activeQueueCount = () => q(`select count(*)::int as c from pos_queue_items where appointment_id=$1`, [APPT]).then((r) => r[0].c);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyCustomerRepository(db as any, new OutboxWriter());
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'L','D','slug','CODE')`, [T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Lisa','R','Lisa R')`, ['cc000000-0000-0000-0000-0000000000e1', T, BR]);
  // a booked appointment for TODAY in the branch's zone (America/New_York, the default — check-in compares the BRANCH's
  // day since Oct 2 2026; `current_date` is UTC and made this test fail every evening after 8 pm Eastern)
  await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, customer_id, technician_id, customer_name, customer_phone, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status)
           values ($1,$2,$3,$4,$5,'Jess','+1',false,'online','[]', (now() at time zone 'America/New_York')::date, '10:00','10:45',45,'booked')`, [APPT, T, BR, CUST, 'cc000000-0000-0000-0000-0000000000e1']);
});

describe('customer check-in — duplicate prevention', () => {
  it('first check-in creates exactly one active queue item and marks the appointment checked in', async () => {
    const r = await repo.checkInAppointment(ctx, CUST, APPT);
    expect(r.ok).toBe(true);
    expect((r as any).alreadyCheckedIn).toBeFalsy();
    expect(await activeQueueCount()).toBe(1);
    const appt = (await q(`select status from pos_tech_appointments where id=$1`, [APPT]))[0];
    expect(String(appt.status)).toBe('checked_in');
    // developer merge (Oct 6 2026): the queue item asks for the technician the appointment was booked with — the POS
    // board showed the guest as "any technician" and the booked technician was not preferred by routing
    const qi = (await q(`select requested_technician_id from pos_queue_items where appointment_id=$1`, [APPT]))[0];
    expect(qi.requested_technician_id).toBe('cc000000-0000-0000-0000-0000000000e1');
    // and the fact is recorded with the row (the in-app feed, the customer's / technician's push and the live boards
    // all hang off checkin.customer_checked_in — the customer app's own path emitted nothing before)
    const ev = (await q(`select payload_json as payload from outbox_events where event_type = 'checkin.customer_checked_in' and aggregate_id = $1`, [APPT]));
    expect(ev).toHaveLength(1);
    expect(typeof ev[0].payload === 'string' ? JSON.parse(ev[0].payload) : ev[0].payload).toMatchObject({ appointmentId: APPT, status: 'checked_in', source: 'customer_app' });
  });

  it('a second check-in (double-tap / retry) returns the SAME queue item — no duplicate', async () => {
    const first = (await q(`select id from pos_queue_items where appointment_id=$1`, [APPT]))[0].id;
    const r = await repo.checkInAppointment(ctx, CUST, APPT);
    expect(r.ok).toBe(true);
    expect((r as any).alreadyCheckedIn).toBe(true);
    expect((r as any).queueItemId).toBe(first);
    expect(await activeQueueCount()).toBe(1); // still exactly one
  });

  it("rejects checking into someone else's appointment (ownership)", async () => {
    const r = await repo.checkInAppointment(ctx, 'cc000000-0000-0000-0000-0000000000c9', APPT);
    expect(r.ok).toBe(false);
  });
});
