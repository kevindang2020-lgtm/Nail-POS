// ai-queue-assignment-center.pgtest — A6 AI Queue guide (Nov 4 2026): history search over every row with numbered pages,
// the guest overlay's verified facts, and Check AI Queue System (per-component, read-only, recorded).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { QueueAssignmentCenter } from './ai-queue-assignment-center';
import { InMemoryQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { InMemoryQueueOps } from './ai-queue-assignment-ops.ports';

const T = 'a7e40000-0000-4000-8000-000000000001', B = 'a7e40000-0000-4000-8000-000000000002', B2 = 'a7e40000-0000-4000-8000-000000000003', T2 = 'a7e40000-0000-4000-8000-000000000009';
const C1 = 'a7e40000-0000-4000-8000-0000000000c1', C2 = 'a7e40000-0000-4000-8000-0000000000c2';
const Q1 = 'a7e40000-0000-4000-8000-0000000000a1', Q2 = 'a7e40000-0000-4000-8000-0000000000a2', Q3 = 'a7e40000-0000-4000-8000-0000000000a3';
const TE1 = 'a7e40000-0000-4000-8000-0000000000e1', TE2 = 'a7e40000-0000-4000-8000-0000000000e2';
const ctx: any = { tenantId: T, branchId: B, userId: 'a7e40000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: ['ai_queue_assignment.view'] };
let pg: any; let center: QueueAssignmentCenter;

beforeAll(async () => {
  pg = await migratedPglite(); await pg.exec(`SET TIME ZONE 'UTC'`);
  await pg.exec(`
    insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ('${T}','Q','Q','aq-c','AQC01','active'), ('${T2}','O','O','aq-o','AQO01','active');
    insert into branches (id, tenant_id, name, timezone) values ('${B}','${T}','Main','America/New_York'), ('${B2}','${T}','Second','America/New_York'), ('a7e40000-0000-4000-8000-00000000000b','${T2}','Other','UTC');
    insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, preferred_technician_id) values
      ('${C1}','${T}','${B}','Thảo','Nguyễn','Thảo Nguyễn','${TE1}'), ('${C2}','${T}','${B}','Ava','Kim','Ava Kim', null);
    insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ('${TE1}','${T}','${B}','Lan','Tran','Lan Tran'), ('${TE2}','${T}','${B}','Mai','Le','Mai Le');
    insert into pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, customer_phone, status) values
      ('${Q1}','${T}','${B}','${C1}','Thảo Nguyễn','(856) 555-1234','waiting'),
      ('${Q2}','${T}','${B}','${C2}','Ava Kim','609-555-9876','assigned'),
      ('${Q3}','${T}','${B2}', null,'Other Location Guest','(856) 555-1234','waiting');
  `);
  // 25 decisions at this location (newest = n24), one at the other location
  for (let n = 0; n < 25; n++) {
    await pg.query(`insert into queue_assignment_decisions (tenant_id, branch_id, queue_entry_id, decision, chosen_technician, decided_by, created_at) values ($1,$2,$3,$4,$5,'u',$6)`,
      [T, B, n % 2 ? Q2 : Q1, n % 5 === 0 ? 'rejected' : 'accepted', n % 2 ? TE2 : TE1, new Date(Date.UTC(2026, 9, 1, 12, n)).toISOString()]);
  }
  await pg.query(`insert into queue_assignment_decisions (tenant_id, branch_id, queue_entry_id, decision, decided_by, created_at) values ($1,$2,$3,'accepted','u','2026-10-01T12:30:00Z')`, [T, B2, Q3]);
  const ops = new InMemoryQueueOps({ entries: [{ queueEntryId: Q1, status: 'waiting', waitMinutes: 5, assignedTechnicianId: null, isAppointment: false, updatedAt: null }, { queueEntryId: Q2, status: 'assigned', waitMinutes: 2, assignedTechnicianId: TE2, isAppointment: false, updatedAt: null }] as any,
    technicians: [{ technicianId: TE1, status: 'available', available: true }, { technicianId: TE2, status: 'busy' }] as any });
  center = new QueueAssignmentCenter(kyselyFor(pg) as any, new InMemoryQueueAssignmentSettings(), ops, { isEnabled: async () => true } as any);
}, 180_000);

describe('A6 history — server search, numbered pages, newest first', () => {
  it('pages of 10 / 20 / 50 over every row of this location, newest first; never the other location', async () => {
    const p1 = await center.history(ctx, { pageSize: 10 });
    expect(p1).toMatchObject({ page: 1, pageSize: 10, totalItems: 25, totalPages: 3 });
    expect(p1.items[0].createdAt).toBe('2026-10-01T12:24:00.000Z');
    const p3 = await center.history(ctx, { pageSize: 10, page: 3 });
    expect(p3.items).toHaveLength(5);
    expect((await center.history(ctx, { pageSize: 7 })).pageSize).toBe(20);   // only 10 / 20 / 50
  });
  it('finds by accent-free name, by phone digits, by technician, by queue entry id; filters by decision', async () => {
    expect((await center.history(ctx, { q: 'thao nguyen' })).totalItems).toBe(13);   // Q1 rows (n even)
    expect((await center.history(ctx, { q: '555-9876' })).totalItems).toBe(12);      // Q2 rows
    expect((await center.history(ctx, { q: '8565551234' })).totalItems).toBe(13);    // digits only; the other location's guest with the same phone is not here
    expect((await center.history(ctx, { q: 'mai le' })).totalItems).toBe(12);
    expect((await center.history(ctx, { q: Q2 })).totalItems).toBe(12);
    expect((await center.history(ctx, { decision: 'rejected' })).totalItems).toBe(5);
    const r = await center.history(ctx, { q: 'ava' });
    expect(r.items[0]).toMatchObject({ customerName: 'Ava Kim', maskedPhone: '••• 9876', technicianName: 'Mai Le' });
    expect(JSON.stringify(r)).not.toContain('609-555');                                // the phone is masked
  });
  it('From → To is the salon day; a bad range is refused', async () => {
    expect((await center.history(ctx, { from: '2026-10-01', to: '2026-10-01' })).totalItems).toBe(25);
    expect((await center.history(ctx, { from: '2026-10-02', to: '2026-10-09' })).totalItems).toBe(0);
    const y = await center.history(ctx, { preset: 'yesterday' });
    expect(y.period.from).toBe(y.period.to); expect(y.period.tz).toBe('America/New_York');
    const w = await center.history(ctx, { preset: 'week' });
    expect(new Date(w.period.from + 'T00:00:00Z').getUTCDay()).toBe(1);   // the week starts Monday
    await expect(center.history(ctx, { from: '2026-10-05', to: '2026-10-01' })).rejects.toThrow(/before/);
  });
});

describe('A6 guest overlay facts', () => {
  it('shows the customer record\'s preferred technician and visits — verified facts only', async () => {
    const d = await center.entryDetail(ctx, Q1);
    expect(d.customer).toMatchObject({ customerId: C1, preferredTechnicianId: TE1, paidVisits: 0, maskedPhone: '••• 1234' });
    expect(d.status).toBe('waiting');
  });
  it('another location\'s entry is not found', async () => {
    await expect(center.entryDetail(ctx, Q3)).rejects.toThrow(/could not be found/);
  });
});

describe('A6 Check AI Queue System', () => {
  it('every component reports a status with evidence; it assigns no one; the run is recorded and read back', async () => {
    const before = (await pg.query(`select count(*)::int n from queue_assignment_decisions`)).rows[0].n;
    const r = await center.health(ctx);
    const keys = r.checks.map((c) => c.key);
    for (const k of ['entitlement', 'settings', 'queue_sync', 'customers', 'technicians', 'schedules', 'breaks', 'booking_conflicts', 'kill_switch', 'auto_jobs', 'realtime_events', 'idempotency', 'audit']) expect(keys).toContain(k);
    for (const c of r.checks) { expect(['READY', 'ATTENTION_REQUIRED', 'FAILED', 'DISABLED', 'NOT_CONFIGURED', 'UNKNOWN']).toContain(c.status); expect(c.evidence.length).toBeGreaterThan(5); }
    expect(r.checks.find((c) => c.key === 'queue_sync')?.status).toBe('READY');           // 2 active in both
    expect(r.checks.find((c) => c.key === 'idempotency')?.status).toBe('READY');
    expect(r.checks.find((c) => c.key === 'schedules')).toMatchObject({ status: 'ATTENTION_REQUIRED' });   // no shifts today
    expect(r.overall).toBe('ATTENTION_REQUIRED');
    expect((await pg.query(`select count(*)::int n from queue_assignment_decisions`)).rows[0].n).toBe(before);
    const last = await center.lastHealth(ctx);
    expect(last).toMatchObject({ runId: r.runId, overall: 'ATTENTION_REQUIRED' });
    expect(await center.lastHealth({ ...ctx, branchId: B2 })).toBeNull();                 // per location
  });
  it('a queue the AI sees differently from the table is flagged; a disabled add-on reads DISABLED', async () => {
    const blind = new QueueAssignmentCenter(kyselyFor(pg) as any, new InMemoryQueueAssignmentSettings(), new InMemoryQueueOps({ entries: [], technicians: [] }), { isEnabled: async () => false } as any);
    const r = await blind.health(ctx);
    expect(r.checks.find((c) => c.key === 'queue_sync')?.status).toBe('ATTENTION_REQUIRED');
    expect(r.checks.find((c) => c.key === 'entitlement')?.status).toBe('DISABLED');
    expect(r.checks.find((c) => c.key === 'technicians')?.status).toBe('NOT_CONFIGURED');
  });
  it('without the view permission nothing is read', async () => {
    await expect(center.history({ ...ctx, permissions: [], role: 'TECHNICIAN' }, {})).rejects.toThrow(/permission/);
  });
});
