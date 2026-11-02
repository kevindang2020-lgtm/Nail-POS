#!/usr/bin/env node
// drill-restore.mjs — backup → restore → verify, end to end (Constitution 4 §95–98, §99; Constitution 12 §225–238).
//
//   node apps/api/scripts/drills/drill-restore.mjs                 (local database; apps/api built)
//   DRILL_DATABASE_URL=postgres://…scratch-server…/db  DRILL_ALLOW_REMOTE=1  node …/drill-restore.mjs
//
// 1. Opens a REPEATABLE READ snapshot on the source and, INSIDE that snapshot, records the migration ledger, the row
//    count of every table in `public`, and a checksum (md5 over every row, ordered by id) of payments and tickets.
// 2. pg_dump --snapshot=<that snapshot> (custom format) — so the dump and the facts above describe the same instant even
//    while other processes keep writing.
// 3. Restores the dump into a scratch database `drill_restore` (dropped at the end).
// 4. Verifies the restore: identical ledger, identical row count in every table, identical payments/tickets checksums,
//    and the platform's own verifier (src/common/restore-verify.ts: schema vs the image's migration files, core tables
//    hold data, one sample of every encrypted column opens with this environment's keys).
// 5. Encryption round trip: when the source holds no encrypted row to sample (a development database), it seals a
//    sentinel with this environment's webhook key into the SCRATCH copy and proves the verifier opens it. Production
//    runs sample real rows — run it there with the production keys in the environment, against a scratch server.
// Prints the measured dump/restore times and the dump size (the RTO inputs for DISASTER_RECOVERY.md).
// Never writes to the source database.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startDrill, sourceDbUrl, createScratchDb, run, pg, require, API_DIR } from './_lib.mjs';

const drill = startDrill('restore', { timeoutMs: 15 * 60_000 });
const { check, note, onCleanup, finish } = drill;
const SRC = sourceDbUrl();
const SCRATCH = 'drill_restore';

const facts = async (client) => {
  const tables = (await client.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map((r) => r.tablename);
  const counts = {};
  for (const t of tables) counts[t] = (await client.query(`select count(*)::bigint n from "${t}"`)).rows[0].n;
  const sum = async (t) => (await client.query(`select count(*)::int n, coalesce(md5(string_agg(md5(x::text), '' order by x.id::text)), 'empty') h from "${t}" x`)).rows[0];
  const ledger = (await client.query(`select filename from schema_migrations order by filename`)).rows.map((r) => r.filename);
  return { tables, counts, payments: await sum('payments'), tickets: await sum('tickets'), ledger };
};

const work = mkdtempSync(join(tmpdir(), 'aps-drill-restore-'));
onCleanup(async () => { rmSync(work, { recursive: true, force: true }); note(`cleanup: dump directory ${work} removed`); });
const dumpFile = join(work, 'source.dump');

// ── 1+2: snapshot, facts, dump ───────────────────────────────────────────────────────────────────────────────────────
const src = new pg.Client({ connectionString: SRC }); await src.connect();
onCleanup(async () => { await src.end().catch(() => undefined); });
await src.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const snap = (await src.query('select pg_export_snapshot() s')).rows[0].s;
const before = await facts(src);
note(`source: ${before.tables.length} tables, ${before.ledger.length} migrations applied, payments ${before.payments.n} rows, tickets ${before.tickets.n} rows (snapshot ${snap})`);

const tDump = Date.now();
const dump = await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--snapshot=${snap}`, '--file', dumpFile, '--dbname', SRC]);
const dumpMs = Date.now() - tDump;
await src.query('COMMIT');
const dumpBytes = dump.code === 0 ? statSync(dumpFile).size : 0;
check('pg_dump of the source (custom format, consistent snapshot) succeeded', dump.code === 0 && dumpBytes > 0, `${(dumpBytes / 1e6).toFixed(1)} MB in ${(dumpMs / 1000).toFixed(1)} s${dump.code ? ' · ' + dump.err.split('\n').slice(-3).join(' ') : ''}`);
if (dump.code !== 0) await finish();

// ── 3: restore into a scratch database ───────────────────────────────────────────────────────────────────────────────
const scratchUrl = await createScratchDb(drill, SRC, SCRATCH);
const tRestore = Date.now();
const rest = await run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', scratchUrl, dumpFile]);
const restoreMs = Date.now() - tRestore;
check(`pg_restore into ${SCRATCH} succeeded`, rest.code === 0, `${(restoreMs / 1000).toFixed(1)} s${rest.code ? ' · ' + rest.err.split('\n').filter(Boolean).slice(-3).join(' ') : ''}`);

// ── 4: verify ────────────────────────────────────────────────────────────────────────────────────────────────────────
const dst = new pg.Client({ connectionString: scratchUrl }); await dst.connect();
onCleanup(async () => { await dst.end().catch(() => undefined); });
const after = await facts(dst);
const ledgerSame = after.ledger.length === before.ledger.length && after.ledger.every((f, i) => f === before.ledger[i]);
check('migration ledger identical (every applied migration, same order)', ledgerSame, `${after.ledger.length}/${before.ledger.length} · latest ${after.ledger.at(-1)}`);
const diffs = before.tables.filter((t) => String(after.counts[t]) !== String(before.counts[t]));
const missingTables = before.tables.filter((t) => !(t in after.counts));
check(`row count identical in every table (${before.tables.length} tables)`, diffs.length === 0 && missingTables.length === 0,
  diffs.length || missingTables.length ? `differs: ${[...missingTables.map((t) => t + '(missing)'), ...diffs.slice(0, 8).map((t) => `${t} ${before.counts[t]}→${after.counts[t]}`)].join(', ')}` : `${Object.values(after.counts).reduce((a, b) => a + Number(b), 0)} rows`);
check('payments checksum identical (md5 over every row)', after.payments.h === before.payments.h && after.payments.n === before.payments.n, `${after.payments.n} rows · ${after.payments.h.slice(0, 12)}…`);
check('tickets checksum identical (md5 over every row)', after.tickets.h === before.tickets.h && after.tickets.n === before.tickets.n, `${after.tickets.n} rows · ${after.tickets.h.slice(0, 12)}…`);

// The platform's own verifier, from the built API (the same code scripts/restore-verify.ts runs).
const { Kysely, PostgresDialect } = require('kysely');
const { verifyRestore, defaultMigrationsDir, ENCRYPTED_COLUMNS } = require(join(API_DIR, 'dist/common/restore-verify.js'));
const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: scratchUrl, max: 2 }) }) });
onCleanup(async () => { await db.destroy().catch(() => undefined); });
const r1 = await verifyRestore(db, defaultMigrationsDir());
note(`restore-verify: ${r1.summary}`);
// The image may carry migration files the SOURCE had not applied yet (a newer build than the backup). The restore must
// lose nothing: every file missing from the restored ledger must be missing from the source's ledger too.
const lost = r1.schema.missing.filter((f) => before.ledger.includes(f));
check('restore-verify: no applied migration lost', lost.length === 0, r1.schema.missing.length ? `files newer than the backup (not applied at the source either): ${r1.schema.missing.join(', ')}` : `schema complete (${r1.schema.expected} files)`);
check('restore-verify: core tables hold data', r1.data.every((d) => d.rows > 0), r1.data.map((d) => `${d.table} ${d.rows}`).join(', '));
const failedKeys = r1.keys.filter((k) => k.result === 'failed');
check('restore-verify: no encrypted column fails to decrypt with this environment\'s keys', failedKeys.length === 0, failedKeys.map((k) => `${k.table}.${k.column}`).join(', ') || `${r1.keys.filter((k) => k.result === 'ok').length} sampled ok, ${r1.keys.filter((k) => k.result === 'not_sampled').length} empty`);

// ── 5: encryption round trip ─────────────────────────────────────────────────────────────────────────────────────────
const sampled = r1.keys.filter((k) => k.result === 'ok');
if (sampled.length) {
  check('encryption round trip: real encrypted rows from the backup open with the configured keys', true, sampled.map((k) => `${k.table}.${k.column}`).join(', '));
} else {
  const { seal, open } = require('@aipowersalon/security');
  const { keysFor } = require(join(API_DIR, 'dist/common/key-ring.js'));
  const plaintext = `drill-sentinel-${randomBytes(8).toString('hex')}`;
  const sealed = seal(keysFor('webhook')[0], plaintext, { layout: 'dotted' });
  const tenant = (await dst.query(`select id from tenants order by created_at limit 1`)).rows[0]?.id;
  await dst.query(`insert into tenant_webhooks (tenant_id, name, url, signing_secret_enc, status) values ($1, 'DR drill sentinel', 'https://drill.invalid/hook', $2, 'disabled')`, [tenant, sealed]);
  const stored = (await dst.query(`select signing_secret_enc v from tenant_webhooks where name = 'DR drill sentinel'`)).rows[0].v;
  const back = open(keysFor('webhook'), stored, { layout: 'dotted' });
  const r2 = await verifyRestore(db, defaultMigrationsDir());
  const col = r2.keys.find((k) => k.table === 'tenant_webhooks' && k.column === 'signing_secret_enc');
  check('encryption round trip: a value sealed with the configured webhook key, stored and read back, opens to the same text', back === plaintext && !stored.includes(plaintext), 'source held no encrypted rows — sentinel sealed into the SCRATCH copy only');
  check('…and the platform verifier opens it (tenant_webhooks.signing_secret_enc = ok)', col?.result === 'ok', `${col?.result} · ${ENCRYPTED_COLUMNS.length} encrypted columns registered`);
}
// ── 6: post-restore hold (mandate §212, Oct 20 2026) — on EVERY drill, whichever branch of §5 ran (the first version sat
// inside the no-encrypted-rows branch and was skipped on a database that holds sealed rows — the final run's rerun showed
// 10 checks where the first pass had 13). With POST_RESTORE_HOLD=1 the worker claims nothing from the restored copy —
// nothing already sent / billed before the snapshot is re-done. Proven against the SCRATCH copy with the real JobClassLoop.
{
  const { enqueueJob, registerJobHandler, resetJobHandlers } = await import('@aipowersalon/database');
  const { JobClassLoop } = require(join(API_DIR, 'dist/jobs/job-worker.js'));   // the built worker, like restore-verify above
  const { sql } = await import('kysely');
  const kdb = db;   // the SCRATCH copy
  const jobType = 'drill.restore_hold';
  let ran = 0; resetJobHandlers(); registerJobHandler(jobType, async () => { ran++; });
  await sql`delete from jobs where job_type = ${jobType}`.execute(kdb);
  await enqueueJob(kdb, { jobClass: 'standard', jobType, payload: { n: 1 } });
  const quiet = { warn: () => undefined, error: () => undefined, log: () => undefined };
  const loop = new JobClassLoop(kdb, 'standard', 'drill', { pollMs: 10, idlePollMs: 20, leaseMs: 60_000, concurrency: 2, perTenantCap: 10 }, quiet);
  process.env.POST_RESTORE_HOLD = '1';
  const claimedHeld = await loop.pump();
  const stillQueued = (await sql`select count(*)::int n from jobs where job_type = ${jobType} and status = 'queued' and lease_owner is null`.execute(kdb)).rows[0].n;
  check('POST_RESTORE_HOLD=1: the worker claims nothing from the restored database (the job stays queued, unleased)', claimedHeld === 0 && ran === 0 && stillQueued === 1, `claimed ${claimedHeld}, ran ${ran}, queued ${stillQueued}`);
  delete process.env.POST_RESTORE_HOLD;
  const claimedFree = await loop.pump();
  for (let i = 0; i < 100 && ran < 1; i++) await new Promise((r) => setTimeout(r, 20));
  await loop.stop();
  check('hold cleared: the same job runs exactly once', claimedFree === 1 && ran === 1, `claimed ${claimedFree}, ran ${ran}`);
  await sql`delete from jobs where job_type = ${jobType}`.execute(kdb);
}

note(`RTO inputs at this size: dump ${(dumpMs / 1000).toFixed(1)} s, restore ${(restoreMs / 1000).toFixed(1)} s, ${(dumpBytes / 1e6).toFixed(1)} MB dump of a ${before.tables.length}-table database`);
await finish(`dump ${(dumpMs / 1000).toFixed(1)}s, restore ${(restoreMs / 1000).toFixed(1)}s, ${(dumpBytes / 1e6).toFixed(1)} MB`);
