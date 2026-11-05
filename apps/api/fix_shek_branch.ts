import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const branchId = '9ca3c746-fb14-41f6-9bad-bd076a335b8e';
  const d = await pool.query("SELECT id, ticket_id, customer_name, branch_id FROM pos_tech_queue_tickets WHERE customer_name = 'shek' ORDER BY created_at DESC LIMIT 1");
  const ticketId = d.rows[0]?.ticket_id;
  if (!ticketId) { console.log("No ticket found for shek"); return pool.end(); }
  await pool.query("UPDATE tickets SET branch_id = $1 WHERE id = $2", [branchId, ticketId]);
  await pool.query("UPDATE ticket_service_lines SET branch_id = $1 WHERE ticket_id = $2", [branchId, ticketId]);
  console.log("Fixed Shek's branch_id");
  pool.end();
}
run();
