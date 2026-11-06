// secrets-exposure-check.mjs — Constitution 7 §303 "No raw secrets exposed" (screen by screen, via the code that feeds screens).
//
// Finds every table column that holds a secret (name ends in _enc / secret / *_hash / api_key / auth_key / private_key /
// client_secret / otp_code …) from db/migrations, then scans every repository/service for a read that could ship such a
// column to a response: `select *` / `selectAll()` on such a table, or the column named in a select list. A hit is a
// FINDING unless the file is on the reviewed allowlist below with its reason (auth verifies hashes; the payment resolver
// and integration adapters decrypt credentials in-process to call the provider; sealers never return the plaintext).
// The count is a RATCHET: new findings fail the gate.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
const ROOT = resolve(new URL('..', import.meta.url).pathname, '..', '..');
const MIG = join(ROOT, 'apps', 'api', 'db', 'migrations');
// Credentials and their sealed/hashed forms. NOT content hashes (file_hash, import_hash), NOT identity hashes of data
// (phone_hash — PII-derived but not a credential; it has its own rules), NOT ids/prefixes.
const SECRET_COL = /^(.*_enc|.*secret.*|password_hash|pin_hash|switch_pin_hash|token_hash|device_token_hash|pairing_code_hash|code_hash|otp_hash|api_key|auth_key|private_key|client_secret|otp_code|access_token|refresh_token|signing_secret.*)$/i;
const NOT_SECRET = /^(id|status|.*_at|.*_id|is_.*|.*_count|.*_prefix|token_prefix|file_hash|import_hash|phone_hash|content_hash|body_hash)$/i;

// 1. secret columns per table, from migrations
const cols = new Map();
for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(MIG, f), 'utf8').replace(/--[^\n]*/g, '');   // strip comments: a ';' inside one ended an ALTER early (found by the probe)
  for (const m of sql.matchAll(/create table if not exists\s+([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
    for (const line of m[2].split('\n')) { const c = line.trim().match(/^([a-z_]+)\s+[a-z]/i); if (c && SECRET_COL.test(c[1]) && !NOT_SECRET.test(c[1])) { if (!cols.has(m[1])) cols.set(m[1], new Set()); cols.get(m[1]).add(c[1].toLowerCase()); } }
  }
  // one ALTER may add several columns (ADD COLUMN a, ADD COLUMN b) — take every one
  for (const m of sql.matchAll(/alter table\s+([a-z_]+)([\s\S]*?);/gi)) {
    for (const c of m[2].matchAll(/add column(?: if not exists)?\s+([a-z_]+)/gi)) {
      if (SECRET_COL.test(c[1]) && !NOT_SECRET.test(c[1])) { if (!cols.has(m[1])) cols.set(m[1], new Set()); cols.get(m[1]).add(c[1].toLowerCase()); }
    }
  }
}
// 2. scan source
function* walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue; const s = statSync(p); if (s.isDirectory()) yield* walk(p); else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p) && !/pgtest|vitest/.test(p)) yield p; } }
const ALLOW = {
  'settings/settings.terminals.kysely.repository.ts': 'E2 Payment Terminals (reviewed Nov 5 2026): processors() selects only `(bolt_base_url is not null and bolt_api_key_enc is not null) as terminal_api` — a boolean, never the encrypted key',
  'oauth/oauth.service.ts': 'Constitution 3 Step 10d: compares sha256(presented client secret) to oauth_clients.client_secret_hash in-process to authenticate a confidential client — never returned',
  'common/api-key-auth.ts': 'Constitution 3 Step 7: compares sha256(presented key) to tenant_api_keys.secret_hash / previous_secret_hash in the WHERE clause — the hash is never returned, only whether it matched',
  // file fragment → why reading the secret column is legitimate (reviewed Sep 29 2026; none reaches a screen)
  'identity/src/auth/': 'sign-in verifies password_hash / TOTP secrets in-process; never returned',
  'identity/src/customer-security/': 'customer password change verifies the current hash in-process',
  'payments/src/payments/payment-gateway.resolver.ts': 'decrypts gateway credentials in-process to build the processor; branch merchant reads (wave 3 PAYI, 638) map through maskBranchRow — masked MID + configured booleans, never ciphertext',
  'payments/src/payments/payment-gateways-core.ts': 'masks credentials for the Super Admin panel (MaskedPaymentGateway)',
  'payments/src/deposit-reconciliation/deposit-reconciliation.webhook.repository.ts': 'bank webhook signing secret verified in-process',
  'super-admin-integrations/': 'decrypts integration credentials in-process to call providers; the API returns masked views',
  'apps/api/src/common/step-up.ts': 'verifies password_hash and the TOTP secret for THIS session; returns ok only',
  'identity/src/auth/mfa': 'enrolment/recovery seal and verify the TOTP secret; shown once to its owner at enrolment',
  'security/src/': 'the sealers themselves',
  'super-admin-platform/super-admin-platform.repository.ts': 'invitation and OTP hashes are compared in-process (accept / verify)',
  'super-admin-platform/super-admin-platform.service.ts': 'legacy inline step-up verifies password_hash / TOTP in-process (superseded by the global step-up)',
  'notifications/notifications.kysely': 'Twilio credentials decrypted in-process to send',
  'communications/src/': 'provider credentials decrypted in-process to send',
  'ai/src/': 'AI provider keys decrypted in-process to call the provider; the control plane returns masked views',
  'analytics/src/owner/owner.kysely.repository.ts': 'ownerPasswordHash() verifies the owner re-auth in-process; switch_pin_hash becomes a boolean (hasSwitchPin)',
  'queue/src/serving/manager-pin.kysely.ts': 'B-19: the manager-at-till PIN is compared in-process (verifyPassword against users.pin_hash); only { userId, name } leaves the port',
  'booking/src/customer-activation/': 'activation code hash compared in-process',
  'booking/src/customer-booking/booking-verification': 'tenant messaging auth token decrypted in-process to call Twilio Verify',
  'booking/src/customer-phone/': 'customer identity password_hash compared in-process (phone sign-in)',
  'queue/src/go-check-in/go-check-in.kysely.repository.ts': 'device token hash compared in-process; the service maps devices to a view without it',
  'super-admin-ticket-removal/': 'the removal code is decrypted in-process to compare with the typed code',
  'workforce/src/tech-profile/tech-profile.service.ts': 'global_tech_profiles carries only phone_hash (not a credential); technicians rows are mapped to profile views',
  'workforce/src/technician-clock-pin/': 'clock-in PIN hash compared in-process',
  'apps/api/src/api-webhooks/api-webhooks.kysely.repository.ts': 'API-key hashes and sealed webhook secrets stay in the repository; keyView()/hookView() omit them; the signing secret is decrypted only to sign a delivery',
  'apps/api/src/customer/customer.kysely.repository.ts': 'reset / verification code hashes compared in-process',
  'apps/api/src/customer-display/terminal-capture.service.ts': 'the Bolt terminal API key is decrypted in-process to call the terminal; never returned',
  // 23-inch dual-screen spec §8–§12 (Oct 6 2026). (The tenants settings device list no longer reads any hash: it selects
  // the columns it shows, so its entry was removed.)
  'apps/api/src/customer-display/display-pairing.repository.ts': 'a display pairing\'s poll-secret hash is compared in-process (constant time) with the secret the display presents; never returned — the code and the device credential are never stored at all',
};
const findings = [];
for (const root of [join(ROOT, 'modules'), join(ROOT, 'apps', 'api', 'src')]) for (const f of walk(root)) {
  const rel = f.replace(ROOT + '/', '');
  const allowed = Object.keys(ALLOW).find((k) => rel.includes(k));
  const src = readFileSync(f, 'utf8');
  for (const [table, set] of cols) {
    // select * / selectAll on a secret-bearing table
    for (const m of src.matchAll(new RegExp(`selectFrom\\('${table}'\\)(?:(?!selectFrom)[\\s\\S]){0,240}?\\.selectAll\\(\\)|select\\s+\\*\\s+from\\s+${table}\\b|select\\s+[a-z]\\.\\*\\s+from\\s+${table}\\b`, 'gi'))) {
      findings.push({ rel, line: src.slice(0, m.index).split('\n').length, table, col: '*', allowed });
    }
    // a secret column in the SELECT LIST (before FROM <table>), a RETURNING list of that table, or a Kysely select([...]) right after selectFrom(table)
    for (const col of set) {
      for (const m of src.matchAll(new RegExp(`select\\s+([^;]*?)\\s+from\\s+${table}\\b`, 'gi'))) {
        if (new RegExp(`\\b${col}\\b`, 'i').test(m[1])) findings.push({ rel, line: src.slice(0, m.index).split('\n').length, table, col, allowed });
      }
      for (const m of src.matchAll(new RegExp(`(?:insert\\s+into|update)\\s+${table}\\b[^;]*?returning\\s+([^;\\x60]*)`, 'gi'))) {
        if (/\*/.test(m[1]) || new RegExp(`\\b${col}\\b`, 'i').test(m[1])) findings.push({ rel, line: src.slice(0, m.index).split('\n').length, table, col: /\*/.test(m[1]) ? '*' : col, allowed });
      }
      for (const m of src.matchAll(new RegExp(`selectFrom\\('${table}'\\)[\\s\\S]{0,300}?\\.select\\(\\[([^\\]]*)\\]`, 'gi'))) {
        if (new RegExp(`'${col}'`, 'i').test(m[1])) findings.push({ rel, line: src.slice(0, m.index).split('\n').length, table, col, allowed });
      }
    }
  }
}
const open = findings.filter((x) => !x.allowed);
const byFile = {}; for (const x of open) (byFile[x.rel] ??= []).push(`${x.line}:${x.table}.${x.col}`);
for (const [f, l] of Object.entries(byFile)) console.log(`FINDING  ${f}  ${[...new Set(l)].join(' ')}`);
console.log(`secrets-exposure: ${cols.size} tables with secret columns, ${findings.length} reads, ${findings.length - open.length} allowlisted, ${open.length} open`);
process.exit(open.length ? 1 : 0);
