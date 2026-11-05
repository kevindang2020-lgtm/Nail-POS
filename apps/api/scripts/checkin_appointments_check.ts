/*
 * checkin_appointments_check.ts — drives the REAL KyselyCheckInRepository against Postgres to prove the check-in flow
 * now reads/writes pos_tech_appointments (it previously read/wrote the writer-less `appointments` table, so appointment
 * lookup/list/mark-checked-in were all non-functional). Seeds today's appointment, then exercises the actual repo.
 *
 * Run: NODE_PATH=<workspace>/node_modules <tsx> apps/api/scripts/checkin_appointments_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, Client } from 'pg';
import { KyselyCheckInRepository } from '../../../modules/queue/src/check-in/check-in.kysely.repository';

const CONN = { host: '127.0.0.1', port: 5433, user: 'postgres', database: 'aps_iso' };
const TENANT = 'becf33f6-413d-47b9-9db6-0253d6375bb6';
const BRANCH = '11111111-1111-1111-1111-111111111111';
const ctx = { tenantId: TENANT, branchId: BRANCH, userId: 'u1', role: 'OWNER', permissions: ['pos.check_in.view', 'pos.check_in.appointment'] };

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  \u2713', n); } else { fail++; console.log('  \u2717', n); } };

async function main() {
  const seed = new Client(CONN); await seed.connect();
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool(CONN) }) });
  const repo = new KyselyCheckInRepository(db as any);
  let apptId = '';
  try {
    const tech = (await seed.query(
      `insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, default_commission_split_percent, is_active, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'Ada', 'Lin', 'Ada Lin', 'Nail Tech', 'active', 'percent', 40, 40, true, now(), now()) returning id`, [TENANT, BRANCH])).rows[0].id;
    const cust = (await seed.query(
      `insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, status, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'Grace', 'Kim', 'Grace Kim', '+18565550101', 'active', now(), now()) returning id`, [TENANT, BRANCH])).rows[0].id;
    apptId = (await seed.query(
      `insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
       values (gen_random_uuid(), $1, $2, $3, $4, 'Grace Kim', $5::jsonb, current_date, '10:00', '10:30', 30, 'booked', 'online') returning id`,
      [TENANT, BRANCH, tech, cust, JSON.stringify([{ serviceId: 'svc_mani', serviceName: 'Signature Manicure', durationMinutes: 30 }])])).rows[0].id;

    const a = await repo.appointment(ctx as any, apptId);
    ok('appointment() reads the row from pos_tech_appointments', !!a);
    ok('serviceIds extracted from the services JSONB', !!a && a.serviceIds.length === 1 && a.serviceIds[0] === 'svc_mani');
    ok('startTime is the HH:MM text (not mangled by a timestamp parse)', !!a && a.startTime === '10:00');
    ok('customer + technician names resolved', !!a && a.customerName === 'Grace Kim' && a.technicianName === 'Ada Lin');
    ok('not yet checked in', !!a && a.checkedIn === false);

    const ready = await repo.appointmentsReady(ctx as any);
    ok('appointmentsReady() lists today\u2019s appointment', ready.some((r: any) => r.appointmentId === apptId));

    await repo.markAppointmentCheckedIn(ctx as any, apptId);
    const a2 = await repo.appointment(ctx as any, apptId);
    ok('markAppointmentCheckedIn() persists status=checked_in', !!a2 && a2.checkedIn === true);
  } finally {
    if (apptId) await seed.query('delete from pos_tech_appointments where id=$1', [apptId]).catch(() => {});
    await seed.end().catch(() => {}); await db.destroy().catch(() => {});
  }
  console.log(`\ncheckin_appointments_check: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
