import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  const pt = await pool.query("SELECT id, ticket_id, customer_name, requested_services FROM pos_tech_queue_tickets WHERE customer_name = 'shek' ORDER BY created_at DESC LIMIT 1");
  const row = pt.rows[0];
  if (!row.ticket_id) return console.log("No ticket_id");
  
  const raw = row.requested_services;
  try {
    for (const s of raw) {
      console.log("Inserting:", s.serviceName);
      const serviceId = (s.serviceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.serviceId)) ? s.serviceId : '00000000-0000-0000-0000-000000000000';
      
      await pool.query(`
        INSERT INTO ticket_service_lines (
          tenant_id, branch_id, ticket_id, service_id, technician_id,
          service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot,
          line_total_cents, status, completed_at
        ) VALUES (
          '4b470d6e-aeaa-42c0-8788-a46314762767',
          '9ca3c746-fb14-41f6-9bad-bd076a335b8e',
          $1, $2, null, $3, $4, $5, $6, 'completed', NOW()
        )
      `, [row.ticket_id, serviceId, s.serviceName, s.priceCents, s.estimatedDurationMinutes, s.priceCents]);
    }
    console.log("Success!");
  } catch (e: any) {
    console.log("Error inserting:", e.message);
  }
  pool.end();
}
run();
