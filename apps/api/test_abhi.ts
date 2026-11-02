import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const pt = await pool.query("SELECT id, customer_name, requested_services FROM pos_tech_queue_tickets WHERE customer_name = 'abhi' ORDER BY created_at DESC LIMIT 1");
  console.log("Abhi:", pt.rows[0]);
  pool.end();
}
run();
