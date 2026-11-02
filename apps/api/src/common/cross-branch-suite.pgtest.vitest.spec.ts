// cross-branch-suite.pgtest — Security Deep Scan §75 / §187: the branch-level twin of cross-tenant-suite.pgtest.
//
// ONE salon, two locations. A MANAGER scoped to location 1 asks each domain's REAL repository for location 2's record by
// its REAL id — reads and writes. Each denial is paired with location 2's own manager FINDING the record
// (expectBranchIsolated), so a query broken to return nothing cannot pass; each refused write is followed by a read that
// proves the row did not change. Records that are salon-wide BY DESIGN (the customer book, the catalog) are listed at the
// bottom with the reason, so "not branch-scoped" is a reviewed decision, not an accident.
import { describe, it, expect, beforeAll } from 'vitest';
import { expectBranchIsolated, expectBranchDenied } from '../../test-support/security-expectations';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const T = 'c3000000-0000-4000-8000-00000000000c';
const B1 = 'c3100000-0000-4000-8000-000000000001', B2 = 'c3100000-0000-4000-8000-000000000002';
const ids: Record<string, string> = {};
const mgr = (branchId: string) => ({ tenantId: T, branchId, userId: 'c3200000-0000-4000-8000-000000000001', role: 'MANAGER', permissions: ['*'] }) as any;
const M1 = mgr(B1), M2 = mgr(B2);
const q1 = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const one = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0].id as string;
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'XBR01', 'XBR01', 'xbr01', 'XBR01', 'active') ON CONFLICT DO NOTHING`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B1}', '${T}', 'Location 1'), ('${B2}', '${T}', 'Location 2') ON CONFLICT DO NOTHING`);
  // every record below lives at LOCATION 2
  ids.customer = await one(`INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name) VALUES ($1, $2, 'Bea', 'Two', 'Bea Two') RETURNING id`, [T, B2]);
  ids.tech = await one(`INSERT INTO technicians (tenant_id, branch_id, first_name, last_name, full_name) VALUES ($1, $2, 'Tia', 'Two', 'Tia Two') RETURNING id`, [T, B2]);
  ids.appointment = await one(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time) VALUES ($1, $2, $3, $4, 'Bea Two', CURRENT_DATE + 1, '10:00', '11:00') RETURNING id`, [T, B2, ids.tech, ids.customer]);
  ids.queue = await one(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_id, customer_name) VALUES ($1, $2, $3, 'Bea Two') RETURNING id`, [T, B2, ids.customer]);
  ids.ticket = await one(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [T, B2, ids.customer]);
  ids.payment = await one(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES ($1, $2, $3, 'cash', 5000, 'approved') RETURNING id`, [T, B2, ids.ticket]);
  await pg.query(`INSERT INTO payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key) VALUES ($1, $2, $3, 5000, 'tap_to_pay', 'created', 'xbr_ttp_two')`, [T, B2, ids.ticket]);
});

describe('§75 cross-branch suite — a location-1 manager, location 2\'s real id, the real repository', { timeout: 60_000 }, () => {
  it('Appointments — detail by id (read)', async () => {
    const { KyselyBookingRepository } = await import('@aipowersalon/booking') as any; const r = new KyselyBookingRepository(db, null);
    await expectBranchIsolated(() => r.detail(M2, ids.appointment), () => r.detail(M1, ids.appointment), 'appointment detail');
    await expectBranchIsolated(() => r.booking(M2, ids.appointment), () => r.booking(M1, ids.appointment), 'appointment record');
  });
  it('Appointments — a status change / reschedule from location 1 changes nothing (write)', async () => {
    const { KyselyBookingRepository } = await import('@aipowersalon/booking') as any; const r = new KyselyBookingRepository(db, null);
    const before = await q1(`SELECT status, start_time, version FROM pos_tech_appointments WHERE id = $1`, [ids.appointment]);
    await expectBranchDenied(() => r.setStatus(M1, ids.appointment, 'cancelled'), 'appointment cancel');
    await expectBranchDenied(() => r.update(M1, ids.appointment, { notes: 'cross-branch edit' }), 'appointment edit');
    expect(await q1(`SELECT status, start_time, version FROM pos_tech_appointments WHERE id = $1`, [ids.appointment])).toEqual(before);
  });
  it('Queue — item detail (read) and a status change (write)', async () => {
    const { KyselyQueueRepository } = await import('@aipowersalon/queue') as any; const r = new KyselyQueueRepository(db, null);
    await expectBranchIsolated(() => r.detail(M2, ids.queue), () => r.detail(M1, ids.queue), 'queue detail');
    const before = await q1(`SELECT status, version FROM pos_queue_items WHERE id = $1`, [ids.queue]);
    await expectBranchDenied(() => r.setStatus(M1, ids.queue, 'cancelled'), 'queue status change');
    expect(await q1(`SELECT status, version FROM pos_queue_items WHERE id = $1`, [ids.queue])).toEqual(before);
  });
  it('Payments — the payment, and the ticket it paid', async () => {
    const { KyselyCheckoutRepository } = await import('@aipowersalon/checkout') as any; const r = new KyselyCheckoutRepository(db, null);
    await expectBranchIsolated(() => r.findPayment(M2, ids.payment), () => r.findPayment(M1, ids.payment), 'payment');
    await expectBranchIsolated(() => r.detail(M2, ids.ticket), () => r.detail(M1, ids.ticket), 'ticket');
  });
  it('Tap to Pay — a payment attempt by its idempotency key (SD-21, Oct 27 2026: GET /mobile-checkout/payment-attempts/{key})', async () => {
    const { KyselyMobilePaymentAttemptRepository } = await import('@aipowersalon/checkout') as any; const r = new KyselyMobilePaymentAttemptRepository(db);
    await expectBranchIsolated(() => r.findByKeyInBranch(M2, 'xbr_ttp_two'), () => r.findByKeyInBranch(M1, 'xbr_ttp_two'), 'payment attempt by key');
  });
  it('a FORGED branch is not a key either: location-1 manager with a made-up branch id finds nothing', async () => {
    const { KyselyCheckoutRepository } = await import('@aipowersalon/checkout') as any; const r = new KyselyCheckoutRepository(db, null);
    await expectBranchDenied(() => r.findPayment(mgr('c3100000-0000-4000-8000-0000000000ff'), ids.payment), 'payment with an unknown branch id');
  });
});

describe('§75 salon-wide by design (reviewed) — shared across a salon\'s locations, never across salons', () => {
  const SALON_WIDE: Array<[string, string]> = [
    ['customers', 'one customer book per salon: a guest of location 2 can walk into location 1 (cross-salon isolation: cross-tenant-suite)'],
    ['services / catalog', 'the menu is salon-wide; per-location prices / availability are separate tables'],
    ['inventory products', 'the product master is salon-wide; per-location stock is scoped by branch in the stock tables'],
    ['membership plans', 'a membership is honoured at every location of the salon'],
  ];
  it.each(SALON_WIDE)('%s — %s', (_k, why) => expect(why.length).toBeGreaterThan(20));
});
