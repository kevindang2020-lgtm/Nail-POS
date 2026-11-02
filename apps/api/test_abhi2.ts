import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const pt = await pool.query("SELECT id, ticket_id, customer_name FROM pos_tech_queue_tickets WHERE customer_name = 'abhi' ORDER BY created_at DESC LIMIT 1");
  console.log("Abhi:", pt.rows[0]);
  if (pt.rows[0].ticket_id) {
    const lines = await pool.query("SELECT * FROM ticket_service_lines WHERE ticket_id = $1", [pt.rows[0].ticket_id]);
    console.log("Lines for abhi:", lines.rows);
  }
  pool.end();
}
run();
