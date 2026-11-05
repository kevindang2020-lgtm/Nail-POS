/**
 * enroll-mfa.ts — operator bootstrap for real TOTP MFA.
 *
 * Enrolls a CONFIRMED TOTP factor for a user directly in the database, then prints the secret + otpauth URI so the
 * person scans it into their authenticator app (Google Authenticator, 1Password, Authy, …). This solves the
 * chicken-and-egg when `MFA_REQUIRE_TOTP=1` is set in production: a privileged user can't reach the in-app enrollment
 * endpoint until they have a session, but they can't get a session until MFA is satisfied. Run this once per admin.
 *
 * IMPORTANT: run it with the SAME secret-encryption key the API uses (MFA_ENC_KEY, or AUTH_SESSION_SECRET if MFA_ENC_KEY
 * is unset) so the stored secret can be decrypted at login.
 *
 *   DATABASE_URL=postgres://…  AUTH_SESSION_SECRET='<same as API>' \
 *   npx tsx apps/api/scripts/enroll-mfa.ts --email admin@company.com --super-admin
 *
 *   DATABASE_URL=postgres://…  AUTH_SESSION_SECRET='<same as API>' \
 *   npx tsx apps/api/scripts/enroll-mfa.ts --email owner@salon.com --salon LUXE
 *
 * Flags: --email <addr> (required); --salon <CODE> (tenant user) OR --super-admin (platform admin, tenant_id NULL).
 */
import { generateSecret, otpauthUri, totpCode } from '../../../modules/identity/src/auth/totp';
import { encryptSecret } from '../src/common/mfa-enc';

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const email = arg('--email');
  const salon = arg('--salon');
  const isSuper = process.argv.includes('--super-admin');
  if (!email || (!salon && !isSuper)) {
    console.error('Usage: enroll-mfa.ts --email <addr> (--salon <CODE> | --super-admin)');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required.'); process.exit(2); }
  if (!process.env.MFA_ENC_KEY && !process.env.AUTH_SESSION_SECRET) {
    console.error('Set MFA_ENC_KEY (or AUTH_SESSION_SECRET) to the SAME value the API uses, or the secret cannot be decrypted at login.');
    process.exit(2);
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // resolve the user
    let userId: string | undefined;
    if (isSuper) {
      const r = await client.query(`SELECT id FROM users WHERE role='SUPER_ADMIN' AND lower(email)=lower($1) AND tenant_id IS NULL LIMIT 1`, [email]);
      userId = r.rows[0]?.id;
    } else {
      const t = await client.query(`SELECT id FROM tenants WHERE tenant_code=$1 LIMIT 1`, [salon]);
      const tenantId = t.rows[0]?.id;
      if (!tenantId) { console.error(`No tenant with code ${salon}.`); process.exit(1); }
      const r = await client.query(`SELECT id FROM users WHERE lower(email)=lower($1) AND tenant_id=$2 LIMIT 1`, [email, tenantId]);
      userId = r.rows[0]?.id;
    }
    if (!userId) { console.error(`No matching user for ${email}.`); process.exit(1); }

    // generate + store a CONFIRMED factor (replacing any existing TOTP factors for this user)
    const secret = generateSecret();
    await client.query('BEGIN');
    await client.query(`DELETE FROM mfa_factors WHERE user_id=$1 AND type='totp'`, [userId]);
    await client.query(`INSERT INTO mfa_factors (user_id, type, secret_enc, confirmed) VALUES ($1, 'totp', $2, TRUE)`, [userId, encryptSecret(secret)]);
    await client.query(`UPDATE users SET mfa_enabled=TRUE, updated_at=now() WHERE id=$1`, [userId]);
    await client.query('COMMIT');

    const uri = otpauthUri(email, 'AIPowerSalon', secret);
    console.log('\n✅ TOTP enrolled for', email);
    console.log('   Secret (base32):', secret);
    console.log('   otpauth URI    :', uri);
    console.log('   Current code   :', totpCode(secret, Date.now()), '(for a quick verify)');
    console.log('\n   Add the secret/URI to an authenticator app, then sign in with the 6-digit code it shows.');
    console.log('   (Generate a QR from the otpauth URI to scan, e.g. with any qrcode tool.)\n');
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    console.error('Enrollment failed:', e?.message || e);
    process.exit(1);
  } finally {
    client.release(); await pool.end();
  }
}
main();
