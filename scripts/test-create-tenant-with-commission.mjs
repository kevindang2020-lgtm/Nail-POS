import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })();
const client = new pg.Client({ connectionString: dbUrl });

async function main() {
  await client.connect();
  console.log('Querying latest tenants in database...');
  const res = await client.query(`
    SELECT t.id, t.display_name, t.tenant_code, t.status, t.created_at, u.full_name AS owner_name, u.email AS owner_email
    FROM tenants t
    LEFT JOIN users u ON u.id = t.owner_user_id
    ORDER BY t.created_at DESC
    LIMIT 5;
  `);
  console.log('Latest 5 Tenants:');
  console.table(res.rows);
  await client.end();
}

main().catch(console.error);
