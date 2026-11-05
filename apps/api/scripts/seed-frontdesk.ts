// seed-frontdesk.ts — insert a FRONT_DESK staff user in tenant PALACE (frontdesk@palace.test / Front!2345) for RBAC tests.
import { hashPassword } from '../../../packages/auth/src/password';
(async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const t = await c.query(`SELECT id FROM tenants WHERE tenant_code=$1 LIMIT 1`, ['PALACE']);
    if (!t.rows.length) throw new Error('PALACE tenant not found — run seed.ts first');
    const tenantId = t.rows[0].id;
    const b = await c.query(`SELECT id FROM branches WHERE tenant_id=$1 LIMIT 1`, [tenantId]);
    const branchId = b.rows[0]?.id || null;
    const email = 'frontdesk@palace.test';
    const exists = await c.query(`SELECT id FROM users WHERE tenant_id=$1 AND email=$2 LIMIT 1`, [tenantId, email]);
    if (exists.rows.length) { console.log('FRONT_DESK already exists:', exists.rows[0].id); return; }
    const hash = await hashPassword('Front!2345');
    const r = await c.query(
      `INSERT INTO users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled)
       VALUES ($1,$2,'Front','Desk','Front Desk',$3,$4,'active','FRONT_DESK',false) RETURNING id`,
      [tenantId, branchId, email, hash]);
    console.log('FRONT_DESK created:', r.rows[0].id, '(', email, '/ Front!2345 )');
  } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error(e); process.exit(1); });
