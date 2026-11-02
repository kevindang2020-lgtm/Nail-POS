#!/usr/bin/env node
// db-backfill-summaries.mjs — BUILD_PLAN Phase 10 (audit bug 2): fills the daily summary tables for HISTORY (the hourly
// `summaries.daily` job only rewrites today and yesterday). Walks branches in key order through runBackfill
// (@aipowersalon/database): each batch of branches is one transaction recorded in schema_backfills, so an interrupted
// run resumes after the last finished batch. Every write is an upsert — re-running a range is harmless.
//
//   DATABASE_URL=… node apps/api/scripts/db-backfill-summaries.mjs [--from 2025-01-01] [--to 2026-10-08] [--batch 20] [--restart]
//
// --from defaults to the earliest payment / ticket / appointment / customer date, --to to today (UTC). --restart forgets
// a completed run of the same range so it can run again.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');
const { Kysely, PostgresDialect, sql } = require('kysely');
const { runBackfill } = require('@aipowersalon/database');
const { writeDailySummaries } = require('@aipowersalon/super-admin');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: DB, max: 2 }) }) });
try {
  const first = (await sql`select least(
      (select min(created_at) from payments), (select min(created_at) from tickets),
      (select min(appt_date)::timestamptz from pos_tech_appointments), (select min(created_at) from customers))::date::text as d`.execute(db)).rows[0]?.d;
  const from = arg('--from', first ?? new Date().toISOString().slice(0, 10));
  const to = arg('--to', new Date().toISOString().slice(0, 10));
  const name = `daily_summaries:${from}:${to}`;
  if (process.argv.includes('--restart')) await sql`delete from schema_backfills where name = ${name}`.execute(db);
  const r = await runBackfill({
    db, name, table: 'branches', keyColumn: 'id', batchSize: Number(arg('--batch', '20')),
    select: async (lastKey, limit, trx) => (lastKey === null
      ? await sql`select id from branches order by id limit ${limit}`.execute(trx)
      : await sql`select id from branches where id > ${lastKey}::uuid order by id limit ${limit}`.execute(trx)).rows,
    apply: async (trx, rows) => { await writeDailySummaries(trx, { branchIds: rows.map((x) => String(x.id)), from, to }); },
  });
  console.log(`daily summaries ${from}..${to}: ${r.status}, ${r.rows} branch(es) in ${r.batches} batch(es) this run`);
} finally { await db.destroy(); }
