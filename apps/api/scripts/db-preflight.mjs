#!/usr/bin/env node
// db-preflight.mjs — BUILD_PLAN Phase 10 (Constitution 1 §68–71 "large migrations are safe", §98 migration control).
// Runs BEFORE scripts/migrate.mjs on every start (Dockerfile CMD and railway.json startCommand) and tells the deploy log
// what the migration run is about to do to THIS database. Plain Node + `pg` (production dependency), read-only.
//
// Hard failures — exit 1, the deploy stops before touching the schema:
//   * DATABASE_URL missing, or the server cannot be reached;
//   * Postgres major version below 14 (PREFLIGHT_MIN_PG_MAJOR to change);
//   * a schema_migrations row whose file no longer exists and is not a known rename (MIGRATION_RENAMES) — the code no
//     longer knows what that database contains.
// Warnings — exit 0, printed so a human can decide whether to wait for a quieter hour:
//   * a required extension (pgcrypto, pg_trgm, btree_gist) neither installed nor available;
//   * each pending file; a pending file that sorts before the newest applied one; an applied file edited since;
//   * for every table a pending file ALTERs, CREATEs a non-concurrent index on, or UPDATEs/DELETEs from: its estimated
//     row count (pg_class.reltuples), flagged above PREFLIGHT_BIG_TABLE_ROWS (default 1,000,000);
//   * a non-CONCURRENTLY index build on such a table (it blocks writes for the whole build);
//   * transactions open longer than PREFLIGHT_LONG_TX_SECONDS (default 300) and locks held on the touched tables —
//     pid, state, application name and age only; never another session's query text.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { isNoTransaction, MIGRATION_RENAMES } from '../db/migration-sql.mjs';

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const MIN_MAJOR = Number(process.env.PREFLIGHT_MIN_PG_MAJOR ?? 14);
const BIG_ROWS = Number(process.env.PREFLIGHT_BIG_TABLE_ROWS ?? 1_000_000);
const LONG_TX_S = Number(process.env.PREFLIGHT_LONG_TX_SECONDS ?? 300);
const CONNECT_MS = Number(process.env.PREFLIGHT_CONNECT_TIMEOUT_MS ?? 10_000);
const REQUIRED_EXTENSIONS = ['pgcrypto', 'pg_trgm', 'btree_gist'];

let hard = 0; let warn = 0;
const line = (tag, what, detail = '') => console.log(`db-preflight: ${tag.padEnd(4)} ${what}${detail ? '  ' + detail : ''}`);
const ok = (w, d) => line('OK', w, d);
const warning = (w, d) => { warn++; line('WARN', w, d); };
const fail = (w, d) => { hard++; line('FAIL', w, d); };

/** Tables a migration file touches in ways that matter on a big table. Comments are stripped first. */
export function touchedTables(sql) {
  const body = String(sql).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const name = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;
  const out = { alter: new Set(), index: [], write: new Set() };
  for (const m of body.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${name}`, 'gi'))) out.alter.add(m[1].toLowerCase());
  for (const m of body.matchAll(new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)?"?\s*ON\s+(?:ONLY\s+)?${name}`, 'gi'))) {
    out.index.push({ concurrent: !!m[1], index: (m[2] ?? '').toLowerCase(), table: m[3].toLowerCase() });
  }
  for (const m of body.matchAll(new RegExp(String.raw`\b(?:UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?${name}`, 'gi'))) out.write.add(m[1].toLowerCase());
  return out;
}

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;   // the runner's own URL (migrate.mjs)
  if (!url) { fail('config', 'DATABASE_URL is required'); return; }
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: CONNECT_MS, application_name: 'db-preflight' });
  try { await c.connect(); await c.query('SELECT 1'); }
  catch (e) { fail('connectivity', `cannot connect: ${String(e?.message ?? e).slice(0, 160)}`); return; }
  try {
    ok('connectivity');
    const num = Number((await c.query('SHOW server_version_num')).rows[0].server_version_num);
    const major = Math.floor(num / 10000);
    if (major < MIN_MAJOR) fail('postgres', `${major} is below the required ${MIN_MAJOR}`); else ok('postgres', String(major));

    const ext = (await c.query(`SELECT a.name, a.installed_version IS NOT NULL AS installed FROM pg_available_extensions a WHERE a.name = ANY($1)`, [REQUIRED_EXTENSIONS])).rows;
    for (const e of REQUIRED_EXTENSIONS) {
      const r = ext.find((x) => x.name === e);
      if (!r) warning('extension', `${e} is not available on this server — migrations that need it will fail`);
      else ok('extension', `${e} ${r.installed ? 'installed' : 'available (a migration creates it)'}`);
    }

    // Ledger integrity.
    const files = existsSync(MIGRATIONS_DIR) ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort() : [];
    const fileSet = new Set(files);
    const hasLedger = (await c.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`)).rows[0].ok;
    const hasSum = hasLedger && (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'checksum'`)).rowCount > 0;
    const ledger = hasLedger ? (await c.query(`SELECT filename, ${hasSum ? 'checksum' : 'NULL::text AS checksum'} FROM schema_migrations ORDER BY filename`)).rows : [];
    const applied = new Set();
    for (const r of ledger) {
      if (fileSet.has(r.filename)) {
        applied.add(r.filename);
        if (r.checksum) {
          const now = createHash('sha256').update(readFileSync(join(MIGRATIONS_DIR, r.filename), 'utf8')).digest('hex');
          if (now !== r.checksum) warning('ledger', `${r.filename} changed since it was applied (the change will NOT reach this database)`);
        }
        continue;
      }
      const renamedTo = MIGRATION_RENAMES[r.filename];
      if (renamedTo && fileSet.has(renamedTo)) { applied.add(renamedTo); ok('ledger', `${r.filename} → ${renamedTo} (known rename, migrate reconciles it)`); continue; }
      fail('ledger', `${r.filename} is recorded as applied but has no file — this code does not know that database's schema`);
    }
    if (!hasLedger) ok('ledger', 'no schema_migrations yet (fresh database)');
    else ok('ledger', `${applied.size} applied of ${files.length} files`);

    const pending = files.filter((f) => !applied.has(f));
    const newest = files.filter((f) => applied.has(f)).pop();
    if (!pending.length) { ok('pending', '0 pending'); return; }
    line('INFO', 'pending', `${pending.length} pending: ${pending.slice(0, 20).join(', ')}${pending.length > 20 ? ` … (+${pending.length - 20})` : ''}`);
    for (const f of pending) if (newest && f < newest) warning('order', `${f} sorts before the already-applied ${newest} (applied out of order)`);

    // What the pending files touch, and how big those tables are on THIS database. Skipped on a fresh database (nothing
    // to measure, and hundreds of files).
    if (!hasLedger) return;
    const touched = new Map();   // table → Set(files)
    const nonConcurrent = [];
    for (const f of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      const t = touchedTables(sql);
      for (const tbl of [...t.alter, ...t.write, ...t.index.map((i) => i.table)]) { if (!touched.has(tbl)) touched.set(tbl, new Set()); touched.get(tbl).add(f); }
      for (const i of t.index) if (!i.concurrent && !isNoTransaction(sql)) nonConcurrent.push({ ...i, file: f });
    }
    if (!touched.size) return;
    const names = [...touched.keys()];
    const sizes = new Map((await c.query(`SELECT c.relname, greatest(c.reltuples, 0)::bigint AS rows FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1)`, [names])).rows.map((r) => [r.relname, Number(r.rows)]));
    for (const [tbl, fs] of touched) {
      if (!sizes.has(tbl)) continue;   // created by a pending file
      const rows = sizes.get(tbl);
      if (rows > BIG_ROWS) warning('big table', `${tbl} ~${rows} rows, touched by ${[...fs].join(', ')}`);
      else ok('table', `${tbl} ~${rows} rows`);
    }
    for (const i of nonConcurrent) if ((sizes.get(i.table) ?? 0) > BIG_ROWS) warning('non-concurrent index', `${i.index || '(unnamed)'} on ${i.table} in ${i.file} blocks writes while it builds — use a -- migrate: no-transaction file with CONCURRENTLY`);

    const locks = (await c.query(`SELECT c.relname, l.mode, l.pid, a.state, a.application_name, extract(epoch FROM now() - coalesce(a.xact_start, a.query_start))::int AS age_s
      FROM pg_locks l JOIN pg_class c ON c.oid = l.relation JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE n.nspname = 'public' AND c.relname = ANY($1) AND l.granted AND l.pid <> pg_backend_pid() ORDER BY 1, 3`, [names])).rows;
    for (const l of locks) warning('lock', `${l.relname} ${l.mode} held by pid ${l.pid} (${l.state ?? '?'}, ${l.application_name || 'no app name'}, ${l.age_s}s)`);
    const longTx = (await c.query(`SELECT pid, state, application_name, extract(epoch FROM now() - xact_start)::int AS age_s FROM pg_stat_activity
      WHERE xact_start IS NOT NULL AND pid <> pg_backend_pid() AND datname = current_database() AND now() - xact_start >= make_interval(secs => $1) ORDER BY xact_start`, [LONG_TX_S])).rows;
    for (const t of longTx) warning('long transaction', `pid ${t.pid} open ${t.age_s}s (${t.state ?? '?'}, ${t.application_name || 'no app name'}) — a pending ALTER waits behind it`);
  } finally { await c.end().catch(() => undefined); }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().then(() => {
    console.log(`db-preflight: ${hard ? `FAILED (${hard} hard failure(s))` : 'passed'}${warn ? `, ${warn} warning(s)` : ''}`);
    process.exit(hard ? 1 : 0);
  }, (e) => { console.error(`db-preflight: FAIL unexpected: ${String(e?.message ?? e).slice(0, 200)}`); process.exit(1); });
}
