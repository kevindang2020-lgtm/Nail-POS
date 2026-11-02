import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const t = await pool.query("SELECT * FROM ticket_service_lines ORDER BY created_at DESC LIMIT 5");
  console.log("Lines:", t.rows);
  pool.end();
}
run();
