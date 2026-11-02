import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const d = await pool.query("SELECT id, ticket_id, customer_name, branch_id FROM pos_tech_queue_tickets WHERE customer_name = 'abhi' ORDER BY created_at DESC LIMIT 1");
  console.log("Abhi queue row:", d.rows[0]);
  if (d.rows[0]?.ticket_id) {
    const t = await pool.query("SELECT id, branch_id FROM tickets WHERE id = $1", [d.rows[0].ticket_id]);
    console.log("Abhi ticket row:", t.rows[0]);
  }
  pool.end();
}
run();
