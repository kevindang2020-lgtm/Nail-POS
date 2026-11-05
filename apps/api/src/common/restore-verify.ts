// restore-verify.ts — Constitution 12 §225–238: prove a restored backup is USABLE, not merely present.
//
// Constitution 11 can RECEIVE a restore-drill report; nothing PERFORMED one. And Phase 7 created a hazard no drill
// checked: the backup contains ENCRYPTED columns (payment, Twilio, bank, MFA secrets). A backup restores perfectly and
// is still useless if the key that opens those columns was lost or rotated away — the database says "success" while
// every payment credential in it is unreadable.
//
// Run against a SCRATCH database a backup was restored into (never production). READ-ONLY. It checks:
//   schema     — every migration file in db/migrations is in schema_migrations (a partial restore is caught);
//   data       — the core tables hold rows (a backup of an empty database is not a backup);
//   keys       — ONE sample of every encrypted column decrypts with the keys in this environment. A column with no
//                rows is "not sampled", never "ok" — nothing was proven about it.
// It never prints a decrypted value — only whether decryption succeeded.
import { open } from '@aipowersalon/security';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { keysFor } from './key-ring';

// One decryptor per purpose, straight from the package and the key ring — the platform never imports a domain
// module for this (Constitution 13 §101; these were five of the fifteen cycle back-edges).
const DOTTED = { layout: 'dotted' } as const;
const decryptProvider = (v: string) => open(keysFor('provider'), v, DOTTED);
const decryptFunding = (v: string) => open(keysFor('funding'), v, DOTTED);
const decryptWebhook = (v: string) => open(keysFor('webhook'), v, DOTTED);
const decryptMfa = (v: string) => (v.startsWith('v1:') ? open(keysFor('mfa'), v, { layout: 'prefixed', prefix: 'v1' }) : v);
const decryptPaymentSecret = (v: string) => v.startsWith('v2p:') ? open(keysFor('payments'), v, { layout: 'prefixed', prefix: 'v2p' })
  : v.startsWith('v1:') ? open([...keysFor('payments'), ...(() => { try { return keysFor('mfa'); } catch { return []; } })()], v, { layout: 'prefixed', prefix: 'v1' }) : v;
const decryptDeletionCode = (v: string) => (v.startsWith('v1:') ? open(keysFor('ticket_deletion'), v, { layout: 'prefixed', prefix: 'v1' }) : '');
import { readdirSync } from 'node:fs';

import { sql } from 'kysely';

/** Every encrypted column the platform keeps, and the function that opens it. Kept honest by a test against the schema. */
export const ENCRYPTED_COLUMNS: ReadonlyArray<{ table: string; column: string; purpose: string; decrypt: (v: string) => string }> = [
  { table: 'communication_providers', column: 'credential_enc', purpose: 'provider', decrypt: decryptProvider },
  { table: 'tenant_messaging_credentials', column: 'auth_token_enc', purpose: 'provider', decrypt: decryptProvider },
  { table: 'tenant_messaging_credentials', column: 'api_key_secret_enc', purpose: 'provider', decrypt: decryptProvider },   // BUILD_PLAN Phase 4: the Twilio API key secret
  { table: 'merchant_funding_profiles', column: 'bank_account_enc', purpose: 'funding', decrypt: decryptFunding },
  { table: 'merchant_funding_profiles', column: 'routing_number_enc', purpose: 'funding', decrypt: decryptFunding },
  { table: 'tenant_webhooks', column: 'signing_secret_enc', purpose: 'webhook', decrypt: decryptWebhook },
  { table: 'integration_credential_references', column: 'secret_enc', purpose: 'webhook', decrypt: decryptWebhook },
  { table: 'bank_webhook_endpoints', column: 'signing_secret_enc', purpose: 'webhook', decrypt: decryptWebhook },
  { table: 'mfa_factors', column: 'secret_enc', purpose: 'mfa', decrypt: decryptMfa },
  { table: 'tenant_payment_config', column: 'api_username_enc', purpose: 'payments', decrypt: decryptPaymentSecret },
  { table: 'tenant_payment_config', column: 'api_password_enc', purpose: 'payments', decrypt: decryptPaymentSecret },
  { table: 'tenant_payment_config', column: 'bolt_api_key_enc', purpose: 'payments', decrypt: decryptPaymentSecret },
  { table: 'tenant_payment_config', column: 'webhook_secret_enc', purpose: 'payments', decrypt: decryptPaymentSecret },   // written by payment-gateway.resolver via the payments key
  { table: 'payment_merchant_accounts', column: 'api_username_enc', purpose: 'payments', decrypt: decryptPaymentSecret },   // 638 branch merchant (same resolver key)
  { table: 'payment_merchant_accounts', column: 'api_password_enc', purpose: 'payments', decrypt: decryptPaymentSecret },   // 638 branch merchant (same resolver key)
  { table: 'payment_merchant_accounts', column: 'bolt_api_key_enc', purpose: 'payments', decrypt: decryptPaymentSecret },   // 638 branch merchant (same resolver key)
  { table: 'payment_merchant_accounts', column: 'webhook_secret_enc', purpose: 'payments', decrypt: decryptPaymentSecret },   // 638 branch merchant (same resolver key)
  { table: 'ticket_deletion_codes', column: 'code_enc', purpose: 'ticket_deletion', decrypt: decryptDeletionCode },
];
export const CORE_TABLES = ['tenants', 'users', 'customers', 'tickets', 'payments'] as const;

export interface RestoreReport {
  ok: boolean;
  schema: { expected: number; applied: number; missing: string[] };
  data: Array<{ table: string; rows: number }>;
  keys: Array<{ table: string; column: string; purpose: string; result: 'ok' | 'failed' | 'not_sampled'; error?: string }>;
  summary: string;
}

export async function verifyRestore(db: any, migrationsDir: string): Promise<RestoreReport> {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(((await sql<any>`select filename from schema_migrations`.execute(db).catch(() => ({ rows: [] }))).rows).map((r: any) => r.filename));
  const missing = files.filter((f) => !applied.has(f));
  const data: RestoreReport['data'] = [];
  for (const t of CORE_TABLES) data.push({ table: t, rows: (await sql<any>`select count(*)::int n from ${sql.table(t)}`.execute(db).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n });
  const keys: RestoreReport['keys'] = [];
  for (const c of ENCRYPTED_COLUMNS) {
    let sample: string | null = null;
    try { sample = (await sql<any>`select ${sql.ref(c.column)} v from ${sql.table(c.table)} where ${sql.ref(c.column)} is not null limit 1`.execute(db)).rows[0]?.v ?? null; }
    catch (e) { keys.push({ table: c.table, column: c.column, purpose: c.purpose, result: 'failed', error: `unreadable: ${String((e as Error).message).slice(0, 80)}` }); continue; }
    if (!sample) { keys.push({ table: c.table, column: c.column, purpose: c.purpose, result: 'not_sampled' }); continue; }
    try { c.decrypt(String(sample)); keys.push({ table: c.table, column: c.column, purpose: c.purpose, result: 'ok' }); }
    catch { keys.push({ table: c.table, column: c.column, purpose: c.purpose, result: 'failed', error: `the ${c.purpose} key in this environment cannot open it` }); }
  }
  const failedKeys = keys.filter((k) => k.result === 'failed');
  const emptyCore = data.filter((d) => d.rows <= 0);
  const ok = missing.length === 0 && failedKeys.length === 0 && emptyCore.length === 0;
  const summary = [
    missing.length ? `${missing.length} migration(s) missing` : `schema complete (${files.length} migrations)`,
    emptyCore.length ? `empty core tables: ${emptyCore.map((d) => d.table).join(', ')}` : 'core tables hold data',
    failedKeys.length ? `CANNOT DECRYPT: ${failedKeys.map((k) => `${k.table}.${k.column}`).join(', ')}` : `${keys.filter((k) => k.result === 'ok').length} encrypted column(s) decrypt, ${keys.filter((k) => k.result === 'not_sampled').length} had no rows to test`,
  ].join('; ');
  return { ok, schema: { expected: files.length, applied: files.length - missing.length, missing }, data, keys, summary };
}

// Stated by the database package (Constitution 13), not assumed from the working directory. In the container this is
// /app/apps/api/db/migrations either way; locally it no longer depends on where the process was started.
export const defaultMigrationsDir = () => MIGRATIONS_DIR;
