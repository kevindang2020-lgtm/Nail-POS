import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const t = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC LIMIT 5");
  console.log("Tickets:");
  for (const row of t.rows) console.log(row.id, row.status, row.branch_id);
  
  const pt = await pool.query("SELECT * FROM pos_tech_queue_tickets ORDER BY created_at DESC LIMIT 5");
  console.log("Tech Queue Tickets:");
  for (const row of pt.rows) console.log(row.id, row.customer_name, row.status, row.branch_id, row.ticket_id);
  pool.end();
}
run();
