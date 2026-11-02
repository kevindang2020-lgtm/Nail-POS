import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })();
const client = new pg.Client({ connectionString: dbUrl });

async function main() {
  await client.connect();
  console.log('Connected to Postgres database...');

  const tables = [
    'ticket_service_lines',
    'ticket_change_requests',
    'pos_tech_queue_tickets',
    'pos_queue_items',
    'pos_tech_appointments',
    'tickets',
    'public_check_in_sessions',
    'pos_queue_audit',   // (pos_tech_queue_audit / pos_service_done_audit / pos_tech_appointments_audit dropped by migration 542)
    'service_follow_up_tasks'
  ];

  for (const table of tables) {
    try {
      const res = await client.query(`TRUNCATE TABLE ${table} CASCADE;`);
      console.log(`Truncated table ${table}.`);
    } catch (e) {
      console.log(`Table ${table} note:`, e.message);
    }
  }

  await client.end();
  console.log('Successfully deleted all existing bookings, tickets, and queue data!');
}

main().catch((err) => {
  console.error('Error clearing bookings:', err);
  process.exit(1);
});
