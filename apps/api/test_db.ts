import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const res = await pool.query("SELECT id, branch_id, status FROM tickets ORDER BY created_at DESC LIMIT 10");
  console.log('Tickets:', res.rows);
  pool.end();
}
run();
