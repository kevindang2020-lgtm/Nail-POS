import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const c = await pool.query("SELECT COUNT(*) FROM tickets WHERE branch_id = '9ca3c746-fb14-41f6-9bad-bd076a335b8e'");
  console.log("Total tickets in branch:", c.rows[0].count);
  
  const d = await pool.query("SELECT customer_name, tickets.status FROM pos_tech_queue_tickets JOIN tickets ON pos_tech_queue_tickets.ticket_id = tickets.id WHERE tickets.branch_id = '9ca3c746-fb14-41f6-9bad-bd076a335b8e' ORDER BY tickets.created_at DESC");
  console.log("Tickets:");
  for (const row of d.rows) console.log(row.customer_name, row.status);
  
  pool.end();
}
run();
