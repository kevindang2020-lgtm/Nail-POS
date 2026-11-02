/*
 * dashboard_appts_check.ts — live Postgres proof that the dashboard's appointment KPIs read the populated table.
 *
 * The owner dashboard's "online bookings today" and appointment-status breakdown queried the `appointments` table, but
 * every booking module writes `pos_tech_appointments` (the `appointments` table has zero writers), so those KPIs always
 * read 0. The fix repoints them to pos_tech_appointments (filtering its appt_date DATE column). This probe seeds today's
 * appointments and shows the old table returns 0 while the new one returns the real online count + status breakdown.
 *
 * Run: NODE_PATH=<api>/node_modules <tsx> apps/api/scripts/dashboard_appts_check.ts
 */
import { Client } from 'pg';

const CONN = { host: '127.0.0.1', port: 5433, user: 'postgres', database: 'aps_iso' };
const TENANT = 'becf33f6-413d-47b9-9db6-0253d6375bb6';
const ONLINE = ['online', 'online_booking', 'customer_app', 'google', 'google_booking_link', 'ai', 'ai_phone'];
const TODAY = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  \u2713', n); } else { fail++; console.log('  \u2717', n); } };

async function main() {
  const c = new Client(CONN); await c.connect();
  try {
    const tech = (await c.query(
      `insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, default_commission_split_percent, is_active, created_at, updated_at)
       values (gen_random_uuid(), $1, gen_random_uuid(), 'Dash', 'Tech', 'Dash Tech', 'Nail Tech', 'active', 'percent', 40, 40, true, now(), now()) returning id`,
      [TENANT])).rows[0].id;
    await c.query('delete from pos_tech_appointments where tenant_id=$1 and appt_date=$2', [TENANT, TODAY]);
    const mk = (source: string, status: string, st: string) => c.query(
      `insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
       values (gen_random_uuid(), $1, gen_random_uuid(), $2, 'Cust', '[]'::jsonb, $3, $4, $4, 30, $5, $6)`, [TENANT, tech, TODAY, st, status, source]);
    await mk('online', 'completed', '10:00');
    await mk('customer_app', 'booked', '11:00');
    await mk('walk_in', 'no_show', '12:00');

    // OLD: the empty `appointments` table
    const oldCount = Number((await c.query("select count(*) c from appointments where tenant_id=$1 and (start_time at time zone 'UTC')::date = $2", [TENANT, TODAY])).rows[0].c);
    ok('OLD: appointments table (no writers) returns 0 today (the bug)', oldCount === 0);

    // NEW: pos_tech_appointments by appt_date
    const onlineCount = Number((await c.query(`select count(*) c from pos_tech_appointments where tenant_id=$1 and source = any($2) and appt_date=$3`, [TENANT, ONLINE, TODAY])).rows[0].c);
    ok('NEW: online bookings today = 2 (online + customer_app, not walk_in)', onlineCount === 2);

    const rows = (await c.query(`select status, count(*) n from pos_tech_appointments where tenant_id=$1 and appt_date=$2 group by status`, [TENANT, TODAY])).rows;
    const by: Record<string, number> = {}; let tot = 0; for (const r of rows) { by[r.status] = Number(r.n); tot += Number(r.n); }
    ok('NEW: status breakdown counts all 3 today', tot === 3);
    ok('NEW: completed=1, no_show=1 captured from real data', (by['completed'] || 0) === 1 && (by['no_show'] || 0) === 1);
  } finally {
    await c.end().catch(() => {});
  }
  console.log(`\ndashboard_appts_check: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
