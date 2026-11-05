import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })()
});
async function run() {
  try {
    const tid = '68c3f6fc-fcdc-4722-ab36-c0e92c076797';
    const techId = 'd8b6d01c-5b90-474b-8461-f550ce32b56f';
    const tenantId = '4b470d6e-aeaa-42c0-8788-a46314762767';
    const branchId = 'd8c6f843-b5f8-4bf7-bb2e-99243836c16b'; // using ticket's branchId
    
    // Fix ticket status (it was inserted as 'completed' due to my earlier change missing the completion, or before my change)
    await pool.query("UPDATE tickets SET status = 'service_done' WHERE id = $1", [tid]);

    const lines = [
      { id: 'a1d50e4b-3905-40be-9046-c57d4d8f70f7', price: 5500, name: 'Gel Manicure', dur: 45 },
      { id: '5693bf6e-240d-49e9-bbe6-3fab809a64d2', price: 4800, name: 'Classic Pedicure', dur: 50 },
      { id: '00000000-0000-0000-0000-000000000000', price: 1500, name: 'Paraffin', dur: 10 }
    ];

    for (const l of lines) {
      await pool.query(`
        INSERT INTO ticket_service_lines (
          tenant_id, branch_id, ticket_id, service_id, technician_id,
          service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot,
          line_total_cents, status, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', NOW())
      `, [tenantId, branchId, tid, l.id, techId, l.name, l.price, l.dur, l.price]);
    }
    console.log("Fixed Palal!");
    
    // Check Nitin's ticket (id: 6807689e-227e-4b2c-9e59-4131d0233c69)
    await pool.query("UPDATE tickets SET status = 'service_done' WHERE id = '6807689e-227e-4b2c-9e59-4131d0233c69'");
    const linesNitin = [
      { id: '5693bf6e-240d-49e9-bbe6-3fab809a64d2', price: 4800, name: 'Classic Pedicure', dur: 50 },
      { id: '00000000-0000-0000-0000-000000000000', price: 1500, name: 'Paraffin', dur: 10 }
    ];
    for (const l of linesNitin) {
      await pool.query(`
        INSERT INTO ticket_service_lines (
          tenant_id, branch_id, ticket_id, service_id, technician_id,
          service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot,
          line_total_cents, status, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', NOW())
      `, [tenantId, branchId, '6807689e-227e-4b2c-9e59-4131d0233c69', l.id, techId, l.name, l.price, l.dur, l.price]);
    }
    console.log("Fixed Nitin!");

  } catch (e) {
    console.error(e);
  }
  pool.end();
}
run();
