/*
 * customer_booking_jsonb_shape_check.ts — drives the REAL KyselyCustomerBookingRepository to prove customer-app
 * bookings now write the canonical services JSONB element ({serviceId, serviceName, durationMinutes, priceCents},
 * matching front-desk booking) instead of the old {name, durationMinutes}. It then feeds the new row to the REAL
 * KyselyCheckInRepository to prove the previously-missing serviceId is now present, so check-in-from-appointment
 * can resolve the customer's services (the one functional gap that remained after the legacy-table sweep).
 *
 * Run: NODE_PATH=<workspace>/node_modules <tsx> apps/api/scripts/customer_booking_jsonb_shape_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, Client } from 'pg';
import { KyselyCustomerBookingRepository } from '../../../modules/booking/src/customer-booking/customer-booking.kysely.repository';
import { KyselyCheckInRepository } from '../../../modules/queue/src/check-in/check-in.kysely.repository';

const CONN = { host: '127.0.0.1', port: 5433, user: 'postgres', database: 'aps_iso' };
const TENANT = 'becf33f6-413d-47b9-9db6-0253d6375bb6';
const BRANCH = '11111111-1111-1111-1111-111111111111';
const ciCtx = { tenantId: TENANT, branchId: BRANCH, userId: 'u1', role: 'OWNER', permissions: ['pos.check_in.appointment'] };

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  \u2713', n); } else { fail++; console.log('  \u2717', n); } };

async function main() {
  const seed = new Client(CONN); await seed.connect();
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool(CONN) }) });
  const cb = new KyselyCustomerBookingRepository(db as any);
  const ci = new KyselyCheckInRepository(db as any);
  let svcId = '', tech = '', cust = '', apptId = '';
  try {
    tech = (await seed.query(
      `insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, default_commission_split_percent, is_active, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'Ada', 'Lin', 'Ada Lin', 'Nail Tech', 'active', 'percent', 40, 40, true, now(), now()) returning id`, [TENANT, BRANCH])).rows[0].id;
    cust = (await seed.query(
      `insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, status, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'Grace', 'Kim', 'Grace Kim', '+18565550101', 'active', now(), now()) returning id`, [TENANT, BRANCH])).rows[0].id;
    svcId = (await seed.query(
      `insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value, online_booking_enabled, customer_app_booking_enabled, ai_booking_enabled, status, sort_order, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, gen_random_uuid(), 'Signature Manicure', 30, 4500, 'percent', 40, true, true, true, 'active', 1, now(), now()) returning id`, [TENANT, BRANCH])).rows[0].id;

    const res = await cb.insertBookingAtomic({
      tenantId: TENANT, branchId: BRANCH, technicianId: tech, customerId: cust, customerName: 'Grace Kim',
      serviceId: svcId, serviceName: 'Signature Manicure', durationMinutes: 30, priceCents: 4500,
      date: '2099-01-15', startTime: '10:00', endTime: '10:30',
    } as any);
    ok('insertBookingAtomic succeeded', (res as any).ok === true);
    apptId = (res as any).id;

    const row = (await seed.query('select services, source from pos_tech_appointments where id=$1', [apptId])).rows[0];
    const arr = typeof row.services === 'string' ? JSON.parse(row.services) : row.services;
    const el = (arr && arr[0]) || {};
    ok('written as a customer_app booking', row.source === 'customer_app');
    ok('services element carries serviceId (was absent before)', el.serviceId === svcId);
    ok('services element carries serviceName (canonical key, not legacy "name")', el.serviceName === 'Signature Manicure' && el.name === undefined);
    ok('services element carries durationMinutes + priceCents', el.durationMinutes === 30 && el.priceCents === 4500);

    // the gap-closer: check-in now extracts a real serviceId from a customer-app booking
    const appt = await ci.appointment(ciCtx as any, apptId);
    ok('check-in appointment() extracts the serviceId from the customer-app booking', !!appt && appt.serviceIds.length === 1 && appt.serviceIds[0] === svcId);
    ok('that serviceId is a real catalog service (so resolveServices/check-in-from-appointment succeeds)', !!appt && appt.serviceIds[0] === svcId);
  } finally {
    if (apptId) await seed.query('delete from pos_tech_appointments where id=$1', [apptId]).catch(() => {});
    if (svcId) await seed.query('delete from services where id=$1', [svcId]).catch(() => {});
    if (cust) await seed.query('delete from customers where id=$1', [cust]).catch(() => {});
    if (tech) await seed.query('delete from technicians where id=$1', [tech]).catch(() => {});
    await seed.end().catch(() => {}); await db.destroy().catch(() => {});
  }
  console.log(`\ncustomer_booking_jsonb_shape_check: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
