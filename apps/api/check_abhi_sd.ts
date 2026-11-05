import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const d = await pool.query("SELECT id, ticket_id, customer_name FROM pos_tech_queue_tickets WHERE customer_name = 'abhi' ORDER BY created_at DESC LIMIT 1");
  const ticketId = d.rows[0]?.ticket_id;
  console.log("Abhi ticket ID:", ticketId);
  if (ticketId) {
    const t = await pool.query("SELECT status, ready_checkout_at, service_done_at FROM tickets WHERE id = $1", [ticketId]);
    console.log("Abhi ticket:", t.rows[0]);
    const lines = await pool.query("SELECT * FROM ticket_service_lines WHERE ticket_id = $1", [ticketId]);
    console.log("Lines for abhi:", lines.rows.map(l => ({ name: l.service_name_snapshot, status: l.status, line_total: l.line_total_cents })));
  }
  pool.end();
}
run();
