import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })();
const client = new pg.Client({ connectionString: dbUrl });

async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT table_name 
    from information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('Tables in database:', res.rows.map((r) => r.table_name).join(', '));
  await client.end();
}

main().catch(console.error);
