import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })();
const client = new pg.Client({ connectionString: dbUrl });

async function main() {
  await client.connect();
  console.log('--- LATEST 5 TENANTS IN DB ---');
  const resTenants = await client.query(`
    SELECT t.id, t.display_name, t.tenant_code, t.status, t.created_at, u.full_name AS owner_name, u.email AS owner_email
    FROM tenants t
    LEFT JOIN users u ON u.id = t.owner_user_id
    ORDER BY t.created_at DESC
    LIMIT 5;
  `);
  console.table(resTenants.rows);

  console.log('\n--- LATEST COMMISSION AUDIT LOGS IN DB ---');
  const resAudit = await client.query(`
    SELECT id, tenant_id, target_type, old_commission_percent, new_commission_percent, requested_by_name, authorized_by_name, auth_code_used, created_at
    FROM commission_change_audit_logs
    ORDER BY created_at DESC
    LIMIT 5;
  `);
  console.table(resAudit.rows);

  await client.end();
}

main().catch(console.error);
