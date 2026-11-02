/*
 * customer_appointments_check.ts — drives the REAL KyselyCustomerRepository against Postgres to prove the customer
 * "my appointments" list + next-appointment now read pos_tech_appointments (they previously read the writer-less
 * `appointments` table, so a customer saw NOTHING). Seeds a past booking-shaped row ({serviceName}) and a future
 * customer-booking-shaped row ({name}) to also exercise the defensive JSONB name extraction across both shapes.
 *
 * Run: NODE_PATH=<workspace>/node_modules <tsx> apps/api/scripts/customer_appointments_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, Client } from 'pg';
import { KyselyCustomerRepository } from '../src/customer/customer.kysely.repository';

const CONN = { host: '127.0.0.1', port: 5433, user: 'postgres', database: 'aps_iso' };
const TENANT = 'becf33f6-413d-47b9-9db6-0253d6375bb6';
const BRANCH = '11111111-1111-1111-1111-111111111111';
const ctx = { tenantId: TENANT, branchId: BRANCH, userId: 'u1', role: 'CUSTOMER', permissions: [] };

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  \u2713', n); } else { fail++; console.log('  \u2717', n); } };

async function main() {
  const seed = new Client(CONN); await seed.connect();
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool(CONN) }) });
  const repo = new KyselyCustomerRepository(db as any);
  let custId = '', pastId = '', futureId = '';
  try {
    const tech = (await seed.query(
      `insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, default_commission_split_percent, is_active, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'Ada', 'Lin', 'Ada Lin', 'Nail Tech', 'active', 'percent', 40, 40, true, now(), now()) returning id`, [TENANT, BRANCH])).rows[0].id;
    custId = (await seed.query(
      `insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, status, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'Grace', 'Kim', 'Grace Kim', '+18565550101', 'active', now(), now()) returning id`, [TENANT, BRANCH])).rows[0].id;
    // PAST, booking-shaped JSONB ({serviceName})
    pastId = (await seed.query(
      `insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
       values (gen_random_uuid(), $1, $2, $3, $4, 'Grace Kim', $5::jsonb, current_date - 7, '09:00', '09:45', 45, 'completed', 'manual') returning id`,
      [TENANT, BRANCH, tech, custId, JSON.stringify([{ serviceId: 'svc_gel', serviceName: 'Gel Manicure', durationMinutes: 45 }])])).rows[0].id;
    // FUTURE, customer-booking-shaped JSONB ({name}, no serviceId)
    futureId = (await seed.query(
      `insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
       values (gen_random_uuid(), $1, $2, $3, $4, 'Grace Kim', $5::jsonb, current_date + 3, '14:00', '14:50', 50, 'booked', 'customer_app') returning id`,
      [TENANT, BRANCH, tech, custId, JSON.stringify([{ name: 'Spa Pedicure', durationMinutes: 50 }])])).rows[0].id;

    const list = await repo.appointments(ctx as any, custId);
    const past = list.find((a: any) => a.appointmentId === pastId);
    const future = list.find((a: any) => a.appointmentId === futureId);
    ok('appointments() returns both rows from pos_tech_appointments', !!past && !!future);
    ok('service name from booking-shaped JSONB ({serviceName})', !!past && past.serviceName === 'Gel Manicure');
    ok('service name from customer-booking-shaped JSONB ({name})', !!future && future.serviceName === 'Spa Pedicure');
    ok('startTime is a combined date+time ISO timestamp', !!future && future.startTime.includes('T') && !isNaN(Date.parse(future.startTime)));
    ok('technician name resolved', !!future && future.technicianName === 'Ada Lin');
    ok('ordered newest-first (future appt before the week-old one)', list.length >= 2 && list[0].appointmentId === futureId);

    const home = await repo.homeRaw(ctx as any, custId);
    ok('homeRaw().nextAppointment is the upcoming one (past excluded by >= now())', !!home.nextAppointment && home.nextAppointment.appointmentId === futureId);
    ok('nextAppointment service name resolved from JSONB', !!home.nextAppointment && home.nextAppointment.serviceName === 'Spa Pedicure');
  } finally {
    for (const id of [pastId, futureId]) if (id) await seed.query('delete from pos_tech_appointments where id=$1', [id]).catch(() => {});
    await seed.end().catch(() => {}); await db.destroy().catch(() => {});
  }
  console.log(`\ncustomer_appointments_check: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
