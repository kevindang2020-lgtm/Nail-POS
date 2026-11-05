import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })();
const client = new pg.Client({ connectionString: dbUrl });

async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name IN ('pos_tech_appointments', 'pos_tech_queue_tickets')
    ORDER BY table_name, column_name;
  `);
  console.log('Columns:', res.rows.map((r) => r.column_name));
  await client.end();
}

main().catch(console.error);
