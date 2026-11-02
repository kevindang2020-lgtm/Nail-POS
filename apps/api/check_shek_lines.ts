import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const d = await pool.query("SELECT id, ticket_id, customer_name, requested_services FROM pos_tech_queue_tickets WHERE customer_name = 'shek' ORDER BY created_at DESC LIMIT 1");
  const row = d.rows[0];
  const lines = await pool.query("SELECT * FROM ticket_service_lines WHERE ticket_id = $1", [row.ticket_id]);
  console.log("Shek lines count:", lines.rows.length);
  pool.end();
}
run();
