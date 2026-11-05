#!/usr/bin/env node
// seal-bank-webhook-secrets.mjs — BUILD_PLAN Phase 10 (Constitution 12 M6, migration 542). On a database where 542 had to
// DEFER dropping bank_webhook_endpoints.signing_secret (rows still held a plaintext secret with no encrypted twin), this
// seals each such secret with the webhook key (WEBHOOK_SIGNING_KEK, the API's own sealer from the compiled build),
// clears the plaintext in the same statement, and — once none is left — drops the column and closes the deferral.
// Prints counts only, never a secret. Needs the API built (npm run build in apps/api).
//
//   DATABASE_URL=… WEBHOOK_SIGNING_KEK=… node apps/api/scripts/seal-bank-webhook-secrets.mjs [--dry-run]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');
const { encryptSecret } = require('../dist/common/webhook-crypto.js');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const dry = process.argv.includes('--dry-run');
const c = new pg.Client({ connectionString: DB }); await c.connect();
try {
  const has = (await c.query(`select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'bank_webhook_endpoints' and column_name = 'signing_secret'`)).rowCount > 0;
  if (!has) { console.log('bank_webhook_endpoints.signing_secret is already gone — nothing to seal'); process.exit(0); }
  const rows = (await c.query(`select id, tenant_id, signing_secret from bank_webhook_endpoints where signing_secret is not null and signing_secret_enc is null`)).rows;
  console.log(`${rows.length} plaintext signing secret(s) without an encrypted twin`);
  if (dry) process.exit(0);
  let sealed = 0;
  for (const r of rows) {
    const u = await c.query(`update bank_webhook_endpoints set signing_secret_enc = $1, signing_secret = null where id = $2 and tenant_id = $3 and signing_secret_enc is null`, [encryptSecret(String(r.signing_secret)), r.id, r.tenant_id]);
    sealed += u.rowCount;
  }
  const left = Number((await c.query(`select count(*)::int n from bank_webhook_endpoints where signing_secret is not null and signing_secret_enc is null`)).rows[0].n);
  console.log(`sealed ${sealed}; ${left} left`);
  if (left === 0) {
    await c.query('begin');
    await c.query(`alter table bank_webhook_endpoints drop column if exists signing_secret`);
    await c.query(`update schema_deferred_constraints set resolved_at = now(), resolved_by = 'seal-bank-webhook-secrets' where name = 'bank_webhook_endpoints.signing_secret' and resolved_at is null`);
    await c.query('commit');
    console.log('dropped bank_webhook_endpoints.signing_secret and closed the deferral');
  }
} finally { await c.end(); }
