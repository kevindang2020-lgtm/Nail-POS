import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })();
const client = new pg.Client({ connectionString: dbUrl });

async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT c.id, c.tenant_id as "tenantId", t.display_name as "tenantName",
           c.technician_id as "technicianId", c.target_type as "targetType",
           c.old_commission_percent as "oldCommissionPercent",
           c.new_commission_percent as "newCommissionPercent",
           c.requested_by_name as "requestedByName",
           c.requested_by_role as "requestedByRole",
           c.authorized_by_name as "authorizedByName",
           c.auth_code_used as "authCodeUsed",
           c.created_at as "createdAt"
    FROM commission_change_audit_logs c
    LEFT JOIN tenants t ON t.id::text = c.tenant_id
    ORDER BY c.created_at DESC
    LIMIT 100;
  `);
  console.log('Query output:', res.rows);
  await client.end();
}

main().catch(console.error);
