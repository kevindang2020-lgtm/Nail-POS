// compensation-multitech.pgtest.vitest.spec.ts — the MONEY proof of multi-technician routing (contract §0 "money gap",
// §11): a 2-technician visit's ticket lines carry each LINE's technician (it used to stamp the lead on every line), so
// the paid ticket's compensation snapshot pays each technician THEIR lines' commission and their share of the tip under
// the salon's existing many-technician tip policy. A single-technician visit produces exactly the lines it always did.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CompensationService, KyselyCompensationPorts } from '@aipowersalon/workforce';
import { KyselyQueueRepository } from '../queue/queue.kysely.repository';
import { QueueService } from '../queue/queue.service';

const T = 'a5692000-0000-4000-8000-000000000001';
const B = 'a5692000-0000-4000-8000-000000000002';
const CP = 'a5692000-0000-4000-8000-0000000000c1', CM = 'a5692000-0000-4000-8000-0000000000c2';
const SP = 'a5692000-0000-4000-8000-0000000000d1', SM = 'a5692000-0000-4000-8000-0000000000d2', SA = 'a5692000-0000-4000-8000-0000000000d3';
const TP = 'a5692000-0000-4000-8000-0000000000a1', TM = 'a5692000-0000-4000-8000-0000000000a2';
const USER = 'a5692000-0000-4000-8000-0000000000e1';
const C1 = 'a5692000-0000-4000-8000-0000000000f1', C2 = 'a5692000-0000-4000-8000-0000000000f2';
// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the fixture holds it explicitly.
const desk: any = { tenantId: T, branchId: B, userId: USER, role: 'FRONT_DESK', permissions: ['pos.booking.override_conflict', 'pos.queue.view', 'pos.queue.edit', 'pos.queue.assign_technician', 'pos.queue.move_to_serving', 'pos.serving.view'] };
const SVCS = `[{"serviceId":"${SP}","serviceName":"Pedicure","estimatedDurationMinutes":50,"priceCents":6000},{"serviceId":"${SM}","serviceName":"Manicure","estimatedDurationMinutes":40,"priceCents":4000},{"serviceId":"${SA}","serviceName":"Nail Art","estimatedDurationMinutes":20,"priceCents":3000,"isAddon":true,"parentServiceId":"${SM}"}]`;

let pg: any; let db: any; let queue: QueueService; let comp: CompensationService;
const one = async (q: string) => (await pg.query(q)).rows[0];
const all = async (q: string) => (await pg.query(q)).rows;
const guest = async (customer: string) => (await one(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_id, customer_name, status, source, priority, requested_services)
  VALUES ('${T}', '${B}', '${customer}', 'Guest', 'waiting', 'walk_in', 'normal', '${SVCS}') RETURNING id`)).id;
async function pay(ticketId: string, tipCents: number) {
  await pg.query(`UPDATE tickets SET status = 'paid', paid_at = now(), tip_cents = ${tipCents}, subtotal_cents = 13000, total_cents = ${13000 + tipCents} WHERE id = '${ticketId}'`);
  const r = await comp.snapshotPaidTicket({ tenantId: T, branchId: B } as any, ticketId);
  expect(r).toMatchObject({ ok: true, reconciled: true });
}
const perTech = async (ticketId: string) => {
  const rows = await all(`SELECT technician_id, sum(tech_service_earnings_cents)::int AS earn, sum(card_tip_cents + cash_tip_cents)::int AS tips FROM ticket_compensation_snapshots WHERE ticket_id = '${ticketId}' GROUP BY technician_id`);
  return Object.fromEntries(rows.map((r: any) => [r.technician_id, { earn: r.earn, tips: r.tips }]));
};
const tipRows = async (ticketId: string) => Object.fromEntries((await all(`SELECT technician_id, tip_cents FROM ticket_tip_allocations WHERE ticket_id = '${ticketId}'`)).map((r: any) => [r.technician_id, r.tip_cents]));

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'CM Salon LLC', 'CM Salon', 'cm-salon', 'CMSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO users (id, tenant_id, full_name, status, role) VALUES ('${USER}', '${T}', 'Desk', 'active', 'CUSTOMER');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C1}', '${T}', '${B}', 'A', 'A', 'A A'), ('${C2}', '${T}', '${B}', 'B', 'B', 'B B');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CP}', '${T}', '${B}', 'Pedicure'), ('${CM}', '${T}', '${B}', 'Manicure');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) VALUES
      ('${SP}', '${T}', '${B}', '${CP}', 'Pedicure', 50, 6000, 'percent', 50), ('${SM}', '${T}', '${B}', '${CM}', 'Manicure', 40, 4000, 'percent', 50), ('${SA}', '${T}', '${B}', '${CM}', 'Nail Art', 20, 3000, 'percent', 50);
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TP}', '${T}', '${B}', 'Pia', 'P', 'Pia P', 'active'), ('${TM}', '${T}', '${B}', 'Mo', 'M', 'Mo M', 'active');
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${TP}', '${SP}'), ('${T}', '${B}', '${TM}', '${SM}'), ('${T}', '${B}', '${TM}', '${SA}'), ('${T}', '${B}', '${TP}', '${SM}'), ('${T}', '${B}', '${TP}', '${SA}');
  `);
  queue = new QueueService(new KyselyQueueRepository(db as never));
  comp = new CompensationService(new KyselyCompensationPorts(db as never));
}, 120000);

describe('a 2-technician visit pays each technician their lines', () => {
  it('ticket lines carry the LINE technician with the commission baked; the snapshot splits commission and the tip by line', async () => {
    const id = await guest(C1);
    await queue.assignPlan(desk, { items: [{ queueItemId: id, expectedVersion: 1, expectedTechnicianId: null, lines: [
      { serviceId: SP, technicianId: TP, expectedTechnicianId: null }, { serviceId: SM, technicianId: TM, expectedTechnicianId: null }, { serviceId: SA, technicianId: TM, expectedTechnicianId: null }] }],
      idempotencyKey: 'comp-split', source: 'staff' });
    const { servingTicketId } = await queue.moveToServing(desk, id);
    const lines = await all(`SELECT service_id, technician_id, commission_type_snapshot, commission_value_snapshot, line_total_cents FROM ticket_service_lines WHERE ticket_id = '${servingTicketId}' ORDER BY line_total_cents DESC`);
    expect(lines).toEqual([
      { service_id: SP, technician_id: TP, commission_type_snapshot: 'percent', commission_value_snapshot: '50.0000', line_total_cents: 6000 },
      { service_id: SM, technician_id: TM, commission_type_snapshot: 'percent', commission_value_snapshot: '50.0000', line_total_cents: 4000 },
      { service_id: SA, technician_id: TM, commission_type_snapshot: 'percent', commission_value_snapshot: '50.0000', line_total_cents: 3000 },
    ].map((l) => ({ ...l, commission_value_snapshot: expect.anything() })));
    await pay(servingTicketId, 1300);
    // commission: Pia 50% of 60.00 = 30.00; Mo 50% of (40.00 + 30.00) = 35.00. Tip: the salon's EXISTING policy over the
    // line technicians (compensation.service.ts §10: exactly two technicians → 50/50; three or more → by commission pool,
    // or equal when the salon opted in) — before this fix the lead got 100% of both.
    expect(await perTech(servingTicketId)).toEqual({ [TP]: { earn: 3000, tips: 650 }, [TM]: { earn: 3500, tips: 650 } });
    expect(await tipRows(servingTicketId)).toEqual({ [TP]: 650, [TM]: 650 });
  });
});

describe('a single-technician visit is unchanged', () => {
  it('every line carries the one technician; the whole commission and tip go to them', async () => {
    const id = await guest(C2);
    await queue.assignTechnician(desk, id, { technicianId: TP, managerOverride: true });
    const { servingTicketId } = await queue.moveToServing(desk, id);
    const lines = await all(`SELECT technician_id, commission_type_snapshot, supply_method_snapshot, status, is_add_on FROM ticket_service_lines WHERE ticket_id = '${servingTicketId}' ORDER BY line_total_cents DESC`);
    expect(lines).toEqual([
      { technician_id: TP, commission_type_snapshot: 'percent', supply_method_snapshot: 'none', status: 'in_service', is_add_on: false },
      { technician_id: TP, commission_type_snapshot: 'percent', supply_method_snapshot: 'none', status: 'in_service', is_add_on: false },
      { technician_id: TP, commission_type_snapshot: 'percent', supply_method_snapshot: 'none', status: 'in_service', is_add_on: true },
    ]);
    expect((await one(`SELECT primary_technician_id, status FROM tickets WHERE id = '${servingTicketId}'`))).toEqual({ primary_technician_id: TP, status: 'serving' });
    await pay(servingTicketId, 1300);
    expect(await perTech(servingTicketId)).toEqual({ [TP]: { earn: 6500, tips: 1300 } });
  });
});
