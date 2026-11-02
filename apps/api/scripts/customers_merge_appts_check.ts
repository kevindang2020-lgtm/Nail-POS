/*
 * customers_merge_appts_check.ts — drives the REAL KyselyCustomersRepository against Postgres to prove (1) the
 * customer-detail appointments tab reads pos_tech_appointments (was the writer-less `appointments` table → empty),
 * and (2) customer MERGE reassigns the surviving customer's pos_tech_appointments rows instead of orphaning them
 * (the merge previously updated the empty legacy table, so a merged-away customer's real bookings were lost).
 *
 * Run: NODE_PATH=<workspace>/node_modules <tsx> apps/api/scripts/customers_merge_appts_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, Client } from 'pg';
import { KyselyCustomersRepository } from '../../../modules/customers/src/customers/customers.kysely.repository';

const CONN = { host: '127.0.0.1', port: 5433, user: 'postgres', database: 'aps_iso' };
const TENANT = 'becf33f6-413d-47b9-9db6-0253d6375bb6';
const BRANCH = '11111111-1111-1111-1111-111111111111';
const ctx = { tenantId: TENANT, branchId: BRANCH, userId: 'u1', role: 'OWNER', permissions: ['pos.customers.merge', 'pos.customers.view'] };
const PHONE = '+18565550777';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  \u2713', n); } else { fail++; console.log('  \u2717', n); } };

async function mkCust(seed: Client) {
  return (await seed.query(
    `insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, status, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, 'Dup', 'Test', 'Dup Test', $3, 'active', now(), now()) returning id`, [TENANT, BRANCH, PHONE])).rows[0].id;
}

async function main() {
  const seed = new Client(CONN); await seed.connect();
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool(CONN) }) });
  const repo = new KyselyCustomersRepository(db as any);
  let primaryId = '', loserId = '', apptId = '', tech = '';
  try {
    tech = (await seed.query(
      `insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, default_commission_split_percent, is_active, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'Ada', 'Lin', 'Ada Lin', 'Nail Tech', 'active', 'percent', 40, 40, true, now(), now()) returning id`, [TENANT, BRANCH])).rows[0].id;
    primaryId = await mkCust(seed);
    loserId = await mkCust(seed);
    // a real booking owned by the LOSER
    apptId = (await seed.query(
      `insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
       values (gen_random_uuid(), $1, $2, $3, $4, 'Dup Test', $5::jsonb, current_date + 2, '11:00', '11:30', 30, 'booked', 'manual') returning id`,
      [TENANT, BRANCH, tech, loserId, JSON.stringify([{ serviceId: 'svc_mani', serviceName: 'Classic Manicure', durationMinutes: 30 }])])).rows[0].id;

    // detail appointments tab reads the booking off the LOSER (proves the repoint, pre-merge)
    const loserAppts = await repo.appointments(ctx as any, loserId);
    const la = (loserAppts || []).find((a: any) => a.appointmentId === apptId);
    ok('detail appointments() reads pos_tech_appointments', !!la);
    ok('startsAt is a combined date+time ISO timestamp', !!la && la.startsAt.includes('T') && !isNaN(Date.parse(la.startsAt)));
    ok('serviceName resolved from the services JSONB', !!la && la.serviceName === 'Classic Manicure');
    ok('technicianName resolved via the full_name join (was a dead display_name column)', !!la && la.technicianName === 'Ada Lin');

    // the two same-phone records should be detected as a duplicate group
    const groups = await repo.duplicates(ctx as any);
    const grp = groups.find((g: any) => g.members.some((m: any) => m.customerId === primaryId) && g.members.some((m: any) => m.customerId === loserId));
    ok('duplicate group containing both records is detected', !!grp);

    if (grp) {
      const res = await repo.merge(ctx as any, grp.duplicateGroupId, primaryId);
      ok('merge() returns the surviving customer detail', !!res);
      const moved = (await seed.query('select customer_id, tenant_id from pos_tech_appointments where id=$1', [apptId])).rows[0];
      ok('THE FIX: the booking was reassigned to the surviving customer (not orphaned)', moved && moved.customer_id === primaryId);
      ok('reassignment stayed tenant-scoped', moved && moved.tenant_id === TENANT);
      const loser = (await seed.query('select status from customers where id=$1', [loserId])).rows[0];
      ok('merged-away record is archived', loser && loser.status === 'archived');
      const survAppts = await repo.appointments(ctx as any, primaryId);
      ok('the booking now shows under the surviving customer', (survAppts || []).some((a: any) => a.appointmentId === apptId));
    }
  } finally {
    if (apptId) await seed.query('delete from pos_tech_appointments where id=$1', [apptId]).catch(() => {});
    for (const id of [primaryId, loserId]) if (id) await seed.query('delete from customers where id=$1', [id]).catch(() => {});
    if (tech) await seed.query('delete from technicians where id=$1', [tech]).catch(() => {});
    await seed.end().catch(() => {}); await db.destroy().catch(() => {});
  }
  console.log(`\ncustomers_merge_appts_check: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
