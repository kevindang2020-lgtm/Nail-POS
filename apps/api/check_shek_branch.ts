import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const d = await pool.query("SELECT id, ticket_id, customer_name, branch_id FROM pos_tech_queue_tickets WHERE customer_name = 'shek' ORDER BY created_at DESC LIMIT 1");
  console.log("Shek queue row:", d.rows[0]);
  if (d.rows[0]?.ticket_id) {
    const t = await pool.query("SELECT id, branch_id, status FROM tickets WHERE id = $1", [d.rows[0].ticket_id]);
    console.log("Shek ticket row:", t.rows[0]);
    const lines = await pool.query("SELECT id, branch_id, service_name_snapshot, line_total_cents FROM ticket_service_lines WHERE ticket_id = $1", [d.rows[0].ticket_id]);
    console.log("Shek lines:", lines.rows);
  }
  pool.end();
}
run();
