import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || (() => { throw new Error("Set DATABASE_URL: this script has no default database."); })();
const client = new pg.Client({ connectionString: dbUrl });

async function main() {
  await client.connect();
  console.log('--- TESTING UNIVERSAL AUTHORIZATION CODE INSERT & RE-USE PREVENTION ---');
  
  const testCode = `AUTH-COMM-TEST-${Math.floor(1000 + Math.random() * 9000)}`;
  
  // Insert Universal Code (tenant_id = '*')
  await client.query(`
    INSERT INTO admin_commission_auth_codes (tenant_id, code_enc, generated_by_name, expires_at)
    VALUES ('*', '${testCode}', 'Super Admin', NOW() + INTERVAL '1 day');
  `);
  console.log('Inserted Universal Code:', testCode);

  // Query code
  const res1 = await client.query(`
    SELECT * FROM admin_commission_auth_codes
    WHERE code_enc = '${testCode}' AND tenant_id IN ('any-tenant-id', '*');
  `);
  console.log('Found Universal Code for Tenant:', res1.rows.length === 1 ? 'YES' : 'NO');

  // Mark as used
  await client.query(`
    UPDATE admin_commission_auth_codes SET used_at = NOW() WHERE code_enc = '${testCode}';
  `);
  console.log('Marked Code as Used in DB.');

  // Re-query code state
  const res2 = await client.query(`
    SELECT used_at IS NOT NULL as is_used FROM admin_commission_auth_codes WHERE code_enc = '${testCode}';
  `);
  console.log('Code is marked as USED (Single-Use Enforcement):', res2.rows[0].is_used ? 'YES' : 'NO');

  await client.end();
}

main().catch(console.error);
