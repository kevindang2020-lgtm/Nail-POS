import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  try {
    const dikshaId = '66cd57ca-01be-4b79-9704-d2776508d895'; // Diksha's ticket id
    const correctBranchId = '9ca3c746-fb14-41f6-9bad-bd076a335b8e';
    
    await pool.query("UPDATE tickets SET branch_id = $1 WHERE id = $2", [correctBranchId, dikshaId]);
    await pool.query("UPDATE ticket_service_lines SET branch_id = $1 WHERE ticket_id = $2", [correctBranchId, dikshaId]);

    console.log("Fixed Diksha!");
  } catch (e) {
    console.error(e);
  }
  pool.end();
}
run();
