#!/usr/bin/env node
// purge-raw-card-numbers.mjs — PCI remediation for c5f7c9d.
//
// Until c5f7c9d the customer app's add-card form sent the RAW card number to the API as the saved card's "token", and it
// was stored in customer_payment_methods.token. The API refuses that now; this finds any rows already stored that way.
// (hardware_payment_methods is checked too — its old guard refused PAN-shaped values, so it should be clean.)
//
//   DATABASE_URL=postgres://… node scripts/purge-raw-card-numbers.mjs            # DRY RUN: counts per salon, changes nothing
//   DATABASE_URL=postgres://… node scripts/purge-raw-card-numbers.mjs --apply    # deletes those rows, in one transaction
//
// A row counts as a raw card number when its token is 13–19 digits, does not start with 9 (CardSecure tokens do), AND
// passes the Luhn check — the same rule the API enforces (modules/payments card-data.ts). Nothing else is touched, and no
// card number is ever printed. After --apply, affected customers re-add their card through the new secure form.
import pg from 'pg';
import { looksLikeRawPan } from '@aipowersalon/payments';   // the SAME rule the API enforces — not a copy

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) { console.error('set DATABASE_URL'); process.exit(2); }

const isPan = (t) => looksLikeRawPan(String(t ?? ''));

const TABLES = [
  { table: 'customer_payment_methods', col: 'token' },
  { table: 'hardware_payment_methods', col: 'gateway_payment_method_token' },
];

const client = new pg.Client({ connectionString: url });
await client.connect();
let total = 0;
try {
  await client.query('BEGIN');
  for (const { table, col } of TABLES) {
    const exists = (await client.query(`SELECT to_regclass($1) AS t`, [table])).rows[0].t;
    if (!exists) { console.log(`${table}: not present`); continue; }
    // pre-filter in SQL (digits only, not starting with 9), confirm with Luhn in JS; ids only leave the database
    const rows = (await client.query(`SELECT id, tenant_id, ${col} AS v FROM ${table} WHERE ${col} ~ '^[0-8][0-9]{12,18}$'`)).rows.filter((r) => isPan(r.v));
    const perTenant = rows.reduce((m, r) => (m.set(r.tenant_id, (m.get(r.tenant_id) || 0) + 1), m), new Map());
    console.log(`${table}: ${rows.length} row(s) holding a raw card number${rows.length ? ' — by salon: ' + [...perTenant].map(([t, n]) => `${t}=${n}`).join(', ') : ''}`);
    if (apply && rows.length) {
      const del = await client.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
      console.log(`  deleted ${del.rowCount}`);
    }
    total += rows.length;
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('failed, nothing changed:', e.message);
  process.exit(1);
} finally { await client.end(); }
console.log(apply ? `\nDone: ${total} row(s) removed.` : `\nDRY RUN: ${total} row(s) would be removed. Re-run with --apply to delete them.`);
