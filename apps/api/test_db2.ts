import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  try {
    await pool.query(`
      INSERT INTO ticket_service_lines (
        tenant_id, branch_id, ticket_id, service_id, technician_id,
        service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot,
        line_total_cents, status, completed_at
      ) VALUES (
        '4b470d6e-aeaa-42c0-8788-a46314762767', '9ca3c746-fb14-41f6-9bad-bd076a335b8e', '68c3f6fc-fcdc-4722-ab36-c0e92c076797', 'svc_gen', 'd8b6d01c-5b90-474b-8461-f550ce32b56f',
        'Service', 0, 30, 0, 'completed', NOW()
      )
    `);
    console.log("Success");
  } catch (e) {
    console.error(e);
  }
  pool.end();
}
run();
