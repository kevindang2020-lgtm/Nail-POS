import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })();
const client = new pg.Client({ connectionString: dbUrl });

async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conname LIKE '%pos_queue_items_status_check%';
  `);
  console.log('Constraint def:', res.rows);
  await client.end();
}

main().catch(console.error);
