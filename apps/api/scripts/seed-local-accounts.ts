/*
 * seed-local-accounts.ts — adds the browser-test login accounts the task spec asks for (front desk, technician,
 * customer) to a tenant, with the EXACT emails/passwords from LOCAL_BROWSER_TESTING_GUIDE.md, and links the technician
 * and customer logins to real records so tech-web / customer-web resolve them. Run AFTER seed.ts + seed-demo.ts.
 *
 *   DATABASE_URL=postgres://… [SEED_TENANT_CODE=LUXE] npx tsx apps/api/scripts/seed-local-accounts.ts
 *
 * Idempotent: each user is inserted only if its email doesn't already exist; links are only set when currently null.
 * These are LOCAL TEST accounts only — do not use in production.
 */
import { Pool } from 'pg';
import { hashPassword } from '../../../packages/auth/src/password';

const code = process.env.SEED_TENANT_CODE || 'LUXE';

// The accounts the testing guide documents. Passwords are hashed with the same hashPassword the login path verifies.
const ACCOUNTS = {
  frontDesk: { email: process.env.SEED_FRONTDESK_EMAIL || 'frontdesk@luxenails.test', password: process.env.SEED_FRONTDESK_PASSWORD || 'FrontDesk123!', first: 'Dana', last: 'Desk', role: 'FRONT_DESK' as const },
  technician: { email: process.env.SEED_TECH_EMAIL || 'tech@luxenails.test', password: process.env.SEED_TECH_PASSWORD || 'Tech123!', first: 'Tess', last: 'Tech', role: 'TECHNICIAN' as const },
  customer: { email: process.env.SEED_CUSTOMER_EMAIL || 'customer@test.com', password: process.env.SEED_CUSTOMER_PASSWORD || 'Customer123!', first: 'Cory', last: 'Customer', role: 'CUSTOMER' as const },
};

async function main() {
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const q = (sql: string, p: any[] = []) => c.query(sql, p);
  try {
    const t = (await q(`select id from tenants where tenant_code=$1 limit 1`, [code])).rows[0]
      || (await q(`select id from tenants where status='active' order by created_at desc limit 1`)).rows[0];
    if (!t) { console.error(`No tenant for code ${code} — run seed.ts first.`); process.exit(1); }
    const tenantId = t.id;
    const branch = (await q(`select id from branches where tenant_id=$1 order by created_at asc limit 1`, [tenantId])).rows[0];
    const branchId = branch ? branch.id : null;

    const ensureUser = async (a: { email: string; password: string; first: string; last: string; role: string }) => {
      const hash = await hashPassword(a.password);
      await q(
        `insert into users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled)
         select $1,$2,$3,$4,$5,$6,$7,'active',$8,false
         where not exists (select 1 from users where email=$6)`,
        [tenantId, branchId, a.first, a.last, `${a.first} ${a.last}`, a.email, hash, a.role]);
      const u = (await q(`select id from users where email=$1 limit 1`, [a.email])).rows[0];
      return u ? u.id : null;
    };

    // Front desk — signs into the POS portal (salon code + email + password).
    await ensureUser(ACCOUNTS.frontDesk);

    // Technician — signs into tech-web. Link to a real technician record (one with no user yet) so the app resolves it.
    const techUserId = await ensureUser(ACCOUNTS.technician);
    if (techUserId) {
      await q(
        `update technicians set user_id=$1, updated_at=now()
         where tenant_id=$2 and user_id is null
         and not exists (select 1 from technicians where tenant_id=$2 and user_id=$1)
         and id = (select id from technicians where tenant_id=$2 and (user_id is null) order by created_at asc limit 1)`,
        [techUserId, tenantId]).catch((e) => console.warn('technician link skipped:', e.message));
    }

    // Customer — signs into customer-web. Link to a real customer record (the portal resolves via customers.user_id).
    const custUserId = await ensureUser(ACCOUNTS.customer);
    if (custUserId) {
      await q(
        `update customers set user_id=$1
         where tenant_id=$2 and user_id is null
         and not exists (select 1 from customers where tenant_id=$2 and user_id=$1)
         and id = (select id from customers where tenant_id=$2 and (user_id is null) order by created_at asc limit 1)`,
        [custUserId, tenantId]).catch((e) => console.warn('customer link skipped:', e.message));
    }

    console.log(`Local test accounts ensured for tenant ${code}:`);
    console.log(`  FRONT_DESK  ${ACCOUNTS.frontDesk.email} / ${ACCOUNTS.frontDesk.password}  (POS portal, salon ${code})`);
    console.log(`  TECHNICIAN  ${ACCOUNTS.technician.email} / ${ACCOUNTS.technician.password}  (tech-web, salon ${code})`);
    console.log(`  CUSTOMER    ${ACCOUNTS.customer.email} / ${ACCOUNTS.customer.password}  (customer-web, salon ${code})`);

    // Make the tenant discoverable in the Customer app's "Find Salons" WITHOUT a Google Places key: opt the tenant into
    // public_listing + show_on_map (both default OFF) and give the branch coordinates (Merchantville, NJ) so it appears
    // in the partner directory and nearby search.
    try {
      for (const flag of ['public_listing', 'show_on_map'] as const) {
        await q(
          `insert into tenant_app_flags (tenant_id, flag_key, enabled) values ($1,$2,true)
           on conflict (tenant_id, flag_key) do update set enabled=true, updated_at=now()`,
          [tenantId, flag]);
      }
      if (branchId) {
        await q(
          `update branches set latitude=coalesce(latitude,$2), longitude=coalesce(longitude,$3), updated_at=now()
           where id=$1`,
          [branchId, 39.9468, -75.0496]);
      }
      console.log(`  Customer-app discovery: public_listing + show_on_map enabled, branch geocoded (no Google key needed).`);
    } catch (e: any) { console.warn('public-listing seed skipped:', e.message); }
  } catch (e) {
    console.error('seed-local-accounts failed:', e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}
main();
