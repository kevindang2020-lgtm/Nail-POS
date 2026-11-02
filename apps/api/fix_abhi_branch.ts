import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const branchId = '9ca3c746-fb14-41f6-9bad-bd076a335b8e';
  const ticketId = 'dd2415f2-3b55-4f1f-aa53-b0eac6f6d125';
  await pool.query("UPDATE tickets SET branch_id = $1 WHERE id = $2", [branchId, ticketId]);
  await pool.query("UPDATE ticket_service_lines SET branch_id = $1 WHERE ticket_id = $2", [branchId, ticketId]);
  console.log("Fixed Abhi's branch_id");
  pool.end();
}
run();
