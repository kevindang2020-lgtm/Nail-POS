// customers-appointments.pgtest — w4 sweep SW-09 (Oct 13 2026): POS → Customer profile → Appointments was ALWAYS empty.
// The query joined pos_tech_appointments.ticket_id and read duration_mins / actual_duration_mins / cancel_reason — none of
// which exist — so PostgreSQL refused it, .catch(() => []) returned nothing, and every guest showed "no appointments"
// (found in the PostgreSQL error log during the live route sweep: "column a.ticket_id does not exist", x105).
// The appointment's money comes from the ticket its visit produced: appointment → queue item (appointment_id) → ticket.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';

const P = 'c5e70000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), B = id('b1'), C = id('c0'), MIA = id('e001'), A1 = id('a101'), A2 = id('a102'), QI = id('9001'), TK = id('f001');
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view'] } as any;
let repo: KyselyCustomersRepository;

beforeAll(async () => {
  const pg: any = await migratedPglite();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Appt LLC','Appt','cust-appt','CAPT01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Mia','C','Mia C','active',true)`, [MIA, T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [C, T, B]);
  const svc = JSON.stringify([{ serviceName: 'Gel Manicure', durationMinutes: 45, priceCents: 4500 }]);
  await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
           values ($1,$2,$3,$4,$5,'Ann Guest',$6,'2026-10-01','10:00','10:45',45,'completed','online'), ($7,$2,$3,$4,$5,'Ann Guest',$6,'2026-10-20','14:00','14:45',45,'booked','phone')`, [A1, T, B, MIA, C, svc, A2]);
  await q(`insert into pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, appointment_id, status) values ($1,$2,$3,$4,'Ann Guest',$5,'completed')`, [QI, T, B, C, A1]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, ticket_number, subtotal_cents, tax_cents, tip_cents, discount_cents, total_cents, queue_item_id)
           values ($1,$2,$3,$4,$5,'paid','T1',4500,300,900,500,5200,$6)`, [TK, T, B, C, MIA, QI]);
  repo = new KyselyCustomersRepository(kyselyFor(pg) as never);
}, 180_000);

describe('POS → Customer profile → Appointments', () => {
  it('lists the guest\'s appointments, newest first, with the technician and the scheduled length', async () => {
    const rows = (await repo.appointments(ctx, C))!;
    expect(rows.map((r) => r.appointmentId)).toEqual([A2, A1]);
    expect(rows[1]).toMatchObject({ technicianName: 'Mia C', status: 'completed', source: 'online', scheduledDurationMinutes: 45, serviceName: expect.stringContaining('Gel') });
  });
  it('a completed appointment carries the money of the ticket its visit produced (tip, tax, discount, total)', async () => {
    const done = (await repo.appointments(ctx, C))!.find((r) => r.appointmentId === A1)!;
    expect(done).toMatchObject({ totalCents: 5200, taxCents: 300, tipCents: 900, discountsCents: 500 });
    const future = (await repo.appointments(ctx, C))!.find((r) => r.appointmentId === A2)!;
    expect(future.totalCents).toBe(0);
  });
});
