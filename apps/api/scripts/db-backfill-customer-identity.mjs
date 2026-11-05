#!/usr/bin/env node
// db-backfill-customer-identity.mjs — BUILD_PLAN Phase 10 (Constitution 1 §9, §11): links the two customer roots.
// customer_identities (the customer app's sign-in, unique normalized_phone) and global_customers (the cross-salon
// profile) had no bridge; migration 541 added global_customers.customer_identity_id. This fills it where the normalized
// phone matches — resumable through runBackfill (schema_backfills 'global_customers_customer_identity'), one batch per
// transaction. It only LINKS: which root wins a merge is Kevin's decision, and nothing is merged or deleted.
//
//   DATABASE_URL=… node apps/api/scripts/db-backfill-customer-identity.mjs [--batch 500]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');
const { Kysely, PostgresDialect, sql } = require('kysely');
const { runBackfill } = require('@aipowersalon/database');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: DB, max: 2 }) }) });
try {
  const r = await runBackfill({
    db, name: 'global_customers_customer_identity', table: 'global_customers', keyColumn: 'id', batchSize: Number(arg('--batch', '500')),
    select: async (lastKey, limit, trx) => (lastKey === null
      ? await sql`select id from global_customers order by id limit ${limit}`.execute(trx)
      : await sql`select id from global_customers where id > ${lastKey}::uuid order by id limit ${limit}`.execute(trx)).rows,
    apply: async (trx, rows) => {
      await sql`update global_customers g set customer_identity_id = c.id, updated_at = now()
                  from customer_identities c
                 where g.id = any(${rows.map((x) => String(x.id))}::uuid[]) and g.customer_identity_id is null
                   and g.normalized_phone is not null and c.normalized_phone = g.normalized_phone`.execute(trx);
    },
  });
  const linked = (await sql`select count(*)::int n from global_customers where customer_identity_id is not null`.execute(db)).rows[0].n;
  console.log(`global_customers → customer_identities: ${r.status}; ${r.rows} row(s) walked this run; ${linked} linked in total`);
} finally { await db.destroy(); }
