/**
 * seed.ts — first-run seed for AIPowerSalon: a platform SUPER_ADMIN plus one pilot tenant (branch + OWNER user +
 * active subscription). This is the step the integration runbook calls for before you can sign in.
 *
 * Passwords are hashed with the SAME `hashPassword` the login path verifies against, so the produced rows authenticate
 * correctly. Credentials come from env (with obvious change-me defaults). The script is idempotent: it checks for an
 * existing SUPER_ADMIN (by email) and tenant (by tenant_code) before inserting.
 *
 * Run:
 *   DATABASE_URL=postgres://… \
 *   SEED_SUPER_ADMIN_EMAIL=you@company.com SEED_SUPER_ADMIN_PASSWORD='…' \
 *   SEED_TENANT_CODE=PILOT01 SEED_OWNER_EMAIL=owner@salon.com SEED_OWNER_PASSWORD='…' \
 *   npx tsx apps/api/scripts/seed.ts
 *
 * Dry run (no DB; prints the planned rows + REAL password hashes so you can verify hashing):
 *   npx tsx apps/api/scripts/seed.ts --dry-run
 *
 * * NOTE: SUPER_ADMIN sign-in requires MFA. Real TOTP is implemented; locally an unenrolled admin may use any 6-digit
 * * code (convenience). In production set MFA_REQUIRE_TOTP=1 and enroll via scripts/enroll-mfa.ts (see MFA_PRODUCTION.md).
 */
import { hashPassword } from '../../../packages/auth/src/password';

interface SeedConfig {
  superAdminEmail: string; superAdminPassword: string;
  tenantCode: string; tenantSlug: string; tenantDisplayName: string; tenantLegalName: string; tenantEmail: string;
  branchName: string;
  ownerEmail: string; ownerPassword: string; ownerFirstName: string; ownerLastName: string;
  plan: string;
}

function configFromEnv(): SeedConfig {
  const code = process.env.SEED_TENANT_CODE || 'PILOT01';
  return {
    superAdminEmail: process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@aipowersalon.com',
    superAdminPassword: process.env.SEED_SUPER_ADMIN_PASSWORD || 'ChangeMe!SuperAdmin1',
    tenantCode: code,
    tenantSlug: (process.env.SEED_TENANT_SLUG || code).toLowerCase(),
    tenantDisplayName: process.env.SEED_TENANT_NAME || 'Pilot Nail Salon',
    tenantLegalName: process.env.SEED_TENANT_LEGAL || process.env.SEED_TENANT_NAME || 'Pilot Nail Salon LLC',
    tenantEmail: process.env.SEED_TENANT_EMAIL || 'hello@pilotsalon.com',
    branchName: process.env.SEED_BRANCH_NAME || 'Main',
    ownerEmail: process.env.SEED_OWNER_EMAIL || 'owner@pilotsalon.com',
    ownerPassword: process.env.SEED_OWNER_PASSWORD || 'ChangeMe!Owner1',
    ownerFirstName: process.env.SEED_OWNER_FIRST || 'Pat',
    ownerLastName: process.env.SEED_OWNER_LAST || 'Owner',
    plan: process.env.SEED_PLAN || 'Standard',
  };
}

const usingDefaults = (cfg: SeedConfig) =>
  cfg.superAdminPassword === 'ChangeMe!SuperAdmin1' || cfg.ownerPassword === 'ChangeMe!Owner1';

async function run() {
  const dryRun = process.argv.includes('--dry-run') || !process.env.DATABASE_URL;
  const cfg = configFromEnv();

  // Real hashes (same function the login path verifies against).
  const superAdminHash = await hashPassword(cfg.superAdminPassword);
  const ownerHash = await hashPassword(cfg.ownerPassword);

  if (usingDefaults(cfg)) {
    console.warn('\n⚠️  Using DEFAULT seed passwords. Set SEED_SUPER_ADMIN_PASSWORD and SEED_OWNER_PASSWORD to your own before seeding production.\n');
  }

  if (dryRun) {
    console.log('— DRY RUN (no database connection) —\n');
    console.log('SUPER_ADMIN user:');
    console.log(`  email         = ${cfg.superAdminEmail}`);
    console.log(`  role          = SUPER_ADMIN / platform role PLATFORM_SUPER_ADMIN  (tenant_id NULL, status active, mfa_enabled true)`);
    console.log(`  password_hash = ${superAdminHash}`);
    console.log('\nPilot tenant:');
    console.log(`  display_name  = ${cfg.tenantDisplayName}`);
    console.log(`  tenant_code   = ${cfg.tenantCode}   tenant_slug = ${cfg.tenantSlug}   status = active`);
    console.log(`  branch        = ${cfg.branchName} (status active)`);
    console.log(`  subscription  = plan ${cfg.plan}, status active, period end now+30d`);
    console.log('\nOWNER user:');
    console.log(`  email         = ${cfg.ownerEmail}   salon code (to sign in) = ${cfg.tenantCode}`);
    console.log(`  role          = OWNER (status active)`);
    console.log(`  password_hash = ${ownerHash}`);
    console.log('\nSet DATABASE_URL and re-run (without --dry-run) to write these rows.');
    return;
  }

  // Live path — lazy-require pg so the dry run needs no driver.
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) SUPER_ADMIN (idempotent by email).
    const saExisting = await client.query(`SELECT id FROM users WHERE role='SUPER_ADMIN' AND email=$1 LIMIT 1`, [cfg.superAdminEmail]);
    let superAdminId: string;
    // The first platform account is the PLATFORM_SUPER_ADMIN (Constitution 7 §5). Migration 460 backfilled the platform
    // role for accounts that existed when it ran, but this seed runs AFTER the migrations: an account inserted without
    // platform_role resolves to the least-privileged fallback (PLATFORM_AUDITOR) and the fresh install's only Super Admin
    // could not create a tenant, approve an application or reset an owner's password (found by live-pilot-day, Oct 13).
    if (saExisting.rows[0]) {
      superAdminId = saExisting.rows[0].id;
      const fixed = await client.query(`UPDATE users SET platform_role = 'PLATFORM_SUPER_ADMIN' WHERE id = $1 AND platform_role IS NULL`, [superAdminId]);
      console.log(`SUPER_ADMIN already exists (${cfg.superAdminEmail}) — leaving as-is${fixed.rowCount ? ' (platform role was missing → PLATFORM_SUPER_ADMIN)' : ''}.`);
    } else {
      const r = await client.query(
        `INSERT INTO users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, platform_role, mfa_enabled)
         VALUES (NULL, NULL, 'Super', 'Admin', 'Super Admin', $1, $2, 'active', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', TRUE) RETURNING id`,
        [cfg.superAdminEmail, superAdminHash],
      );
      superAdminId = r.rows[0].id;
      console.log(`Created SUPER_ADMIN ${cfg.superAdminEmail}`);
    }

    // 2) Pilot tenant (idempotent by tenant_code).
    const tExisting = await client.query(`SELECT id FROM tenants WHERE tenant_code=$1 LIMIT 1`, [cfg.tenantCode]);
    let tenantId: string;
    if (tExisting.rows[0]) {
      tenantId = tExisting.rows[0].id;
      console.log(`Tenant ${cfg.tenantCode} already exists — reusing.`);
    } else {
      const r = await client.query(
        `INSERT INTO tenants (legal_name, display_name, tenant_slug, tenant_code, status, email)
         VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id`,
        [cfg.tenantLegalName, cfg.tenantDisplayName, cfg.tenantSlug, cfg.tenantCode, cfg.tenantEmail],
      );
      tenantId = r.rows[0].id;
      console.log(`Created tenant ${cfg.tenantDisplayName} (${cfg.tenantCode})`);
    }

    // 3) Branch (idempotent by tenant + name).
    const bExisting = await client.query(`SELECT id FROM branches WHERE tenant_id=$1 AND name=$2 LIMIT 1`, [tenantId, cfg.branchName]);
    let branchId: string;
    if (bExisting.rows[0]) {
      branchId = bExisting.rows[0].id;
      console.log(`Branch "${cfg.branchName}" already exists — reusing.`);
    } else {
      const r = await client.query(`INSERT INTO branches (tenant_id, name, status) VALUES ($1, $2, 'active') RETURNING id`, [tenantId, cfg.branchName]);
      branchId = r.rows[0].id;
      console.log(`Created branch "${cfg.branchName}"`);
    }

    // Service catalog (idempotent) — the check-in → queue → serving → checkout journey needs at least one
    // bookable service; without it the walk-in form refuses to complete. Real rows, real prices (integer cents).
    const svcCount = await client.query(`SELECT count(*)::int AS c FROM services WHERE tenant_id = $1`, [tenantId]);
    if (svcCount.rows[0].c === 0) {
      const cat = await client.query(
        `INSERT INTO service_categories (tenant_id, branch_id, name, sort_order) VALUES ($1, $2, 'Nails', 0) RETURNING id`,
        [tenantId, branchId],
      );
      for (const [name, mins, cents] of [['Gel Manicure', 45, 5500], ['Classic Pedicure', 50, 4800]] as const) {
        await client.query(
          `INSERT INTO services (tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, branchId, cat.rows[0].id, name, mins, cents],
        );
      }
      console.log('Seeded service catalog (Nails: Gel Manicure, Classic Pedicure)');
    }

    // 4) OWNER user (idempotent by tenant + email).
    const oExisting = await client.query(`SELECT id FROM users WHERE tenant_id=$1 AND email=$2 LIMIT 1`, [tenantId, cfg.ownerEmail]);
    let ownerId: string;
    if (oExisting.rows[0]) {
      ownerId = oExisting.rows[0].id;
      console.log(`Owner ${cfg.ownerEmail} already exists — leaving as-is.`);
    } else {
      const r = await client.query(
        `INSERT INTO users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'OWNER', FALSE) RETURNING id`,
        [tenantId, branchId, cfg.ownerFirstName, cfg.ownerLastName, `${cfg.ownerFirstName} ${cfg.ownerLastName}`, cfg.ownerEmail, ownerHash],
      );
      ownerId = r.rows[0].id;
      console.log(`Created OWNER ${cfg.ownerEmail}`);
    }

    // Link owner on the tenant.
    await client.query(`UPDATE tenants SET owner_user_id=$1, updated_at=now() WHERE id=$2 AND (owner_user_id IS NULL OR owner_user_id<>$1)`, [ownerId, tenantId]);
    // The owner's membership grant — the Owner app signs in through it (no Store Code; her portfolio is her grants).
    // Without it the seeded owner could use the POS but the Owner app answered TENANT_NOT_FOUND (wave 4 UI sweep).
    await client.query(
      `INSERT INTO user_branch_access (tenant_id, branch_id, user_id, role, access_level, is_primary_owner)
       SELECT $1, $2, $3, 'OWNER', 'owner', TRUE
       WHERE NOT EXISTS (SELECT 1 FROM user_branch_access WHERE tenant_id = $1 AND branch_id = $2 AND user_id = $3)`,
      [tenantId, branchId, ownerId],
    );

    // 5) Active subscription (insert if none).
    const subExisting = await client.query(`SELECT id FROM tenant_subscriptions WHERE tenant_id=$1 LIMIT 1`, [tenantId]);
    if (subExisting.rows[0]) {
      console.log(`Subscription already present for tenant — leaving as-is.`);
    } else {
      await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan, status, current_period_end)
         VALUES ($1, $2, 'active', now() + interval '30 days')`,
        [tenantId, cfg.plan],
      );
      console.log(`Created active subscription (plan ${cfg.plan})`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Seed complete.');
    console.log(`   SUPER_ADMIN sign-in: email ${cfg.superAdminEmail} + password + any 6-digit code (MFA is format-gated until real TOTP).`);
    console.log(`   OWNER sign-in:       salon code ${cfg.tenantCode} + email ${cfg.ownerEmail} + password.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seed failed, rolled back:', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
