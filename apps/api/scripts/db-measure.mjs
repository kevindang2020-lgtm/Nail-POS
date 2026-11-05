#!/usr/bin/env node
// db-measure.mjs — BUILD_PLAN Phase 10 (Constitution 1 §104 documentation, §111 "existing schema inspected"): measure a
// migrated database and write docs/DB_SCHEMA_MEASUREMENTS_<date>.md. Read-only; reads DATABASE_URL (stops without it).
//
//   DATABASE_URL=… node scripts/db-measure.mjs                 print the markdown
//   DATABASE_URL=… node scripts/db-measure.mjs --out <file>    write it (repo-relative or absolute)
//   DATABASE_URL=… node scripts/db-measure.mjs --json          the raw figures
//
// Every figure is a query against the catalog (listed in the doc next to the number), so a later run is comparable.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(API, '..', '..');
const url = process.env.DATABASE_URL;
if (!url) { console.error('db-measure: DATABASE_URL is required (a migrated database — local or a scratch copy)'); process.exit(1); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

// [key, label, sql returning one row {n} (a count) — or {v} (text)]
const TENANT_TABLES = `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'`;
const LISTS = {
  no_tenant_leading_index: `SELECT tt.table_name AS v FROM (${TENANT_TABLES}) tt WHERE NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = tt.table_name AND (i.indexdef ~ '\\((tenant_id)[,)]' OR i.indexdef ~ '\\(tenant_id ')) ORDER BY 1`,
  status_without_check: `SELECT c.table_name AS v FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'status' AND c.data_type IN ('text', 'character varying')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_class r ON r.oid = k.conrelid WHERE r.relname = c.table_name AND k.contype = 'c' AND pg_get_constraintdef(k.oid) ILIKE '%status%') ORDER BY 1`,
  unique_without_tenant: `SELECT i.tablename || '.' || i.indexname AS v FROM pg_indexes i WHERE i.schemaname = 'public' AND i.indexdef LIKE 'CREATE UNIQUE INDEX%' AND i.indexname NOT LIKE '%_pkey'
    AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = i.tablename AND c.column_name = 'tenant_id') AND i.indexdef NOT LIKE '%tenant_id%' ORDER BY 1`,
  text_tenant_or_branch_id: `SELECT table_name || '.' || column_name || ' ' || data_type AS v FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('tenant_id', 'branch_id') AND data_type <> 'uuid' ORDER BY 1`,
  not_valid_constraints: `SELECT r.relname || '.' || k.conname AS v FROM pg_constraint k JOIN pg_class r ON r.oid = k.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public' AND NOT k.convalidated ORDER BY 1`,
  rls_tables: `SELECT relname || CASE WHEN relforcerowsecurity THEN ' (forced)' ELSE '' END AS v FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace ORDER BY 1`,
  invalid_indexes: `SELECT c.relname AS v FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT i.indisvalid ORDER BY 1`,
};
const COUNTS = [
  ['tables', 'Tables', `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`],
  ['tenant_tables', 'Tables with tenant_id', `SELECT count(*)::int n FROM (${TENANT_TABLES}) x`],
  ['tenant_id_nullable', '… of which tenant_id is nullable', `SELECT count(*)::int n FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.is_nullable = 'YES'`],
  ['fks', 'Foreign keys', `SELECT count(*)::int n FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname = 'public' AND k.contype = 'f'`],
  ['fks_not_valid', '… NOT VALID (validation deferred)', `SELECT count(*)::int n FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname = 'public' AND k.contype = 'f' AND NOT k.convalidated`],
  ['no_tenant_leading_index', 'Tenant tables with no tenant-leading index', null],
  ['indexes', 'Indexes', `SELECT count(*)::int n FROM pg_indexes WHERE schemaname = 'public'`],
  ['invalid_indexes', 'INVALID indexes (interrupted CONCURRENTLY builds)', null],
  ['checks', 'CHECK constraints', `SELECT count(*)::int n FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname = 'public' AND k.contype = 'c'`],
  ['not_valid_constraints', 'Constraints NOT VALID (any kind)', null],
  ['status_without_check', 'Text `status` columns without a CHECK', null],
  ['unique_without_tenant', 'Non-PK unique indexes on tenant tables that omit tenant_id', null],
  ['text_tenant_or_branch_id', 'Non-uuid tenant_id / branch_id columns', null],
  ['version_cols', 'Version columns (version / record_version)', `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('version', 'record_version')`],
  ['created_by', 'created_by / created_by_user_id columns', `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('created_by', 'created_by_user_id')`],
  ['updated_by', 'updated_by / updated_by_user_id columns', `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('updated_by', 'updated_by_user_id')`],
  ['deleted_at', 'deleted_at columns', `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'deleted_at'`],
  ['deleted_by', 'deleted_by columns', `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'deleted_by'`],
  ['rls_tables', 'Tables with row-level security', null],
  ['migrations', 'Migrations in the ledger', `SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 0 ELSE (SELECT count(*)::int FROM schema_migrations) END n`],
  ['deferred_open', 'Open schema_deferred_constraints', `SELECT CASE WHEN to_regclass('public.schema_deferred_constraints') IS NULL THEN 0 ELSE (SELECT count(*)::int FROM schema_deferred_constraints WHERE resolved_at IS NULL) END n`],
  ['backfills_running', 'Backfills not completed (schema_backfills)', `SELECT CASE WHEN to_regclass('public.schema_backfills') IS NULL THEN 0 ELSE (SELECT count(*)::int FROM schema_backfills WHERE status <> 'completed') END n`],
];
const FACTS = [
  ['users_unique', '`users` unique indexes', `SELECT coalesce(string_agg(indexname, ', ' ORDER BY indexname), 'none') v FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users' AND indexdef LIKE 'CREATE UNIQUE%'`],
  ['loyalty_profiles_unique', '`customer_loyalty_profiles` unique indexes', `SELECT coalesce(string_agg(indexname, ', ' ORDER BY indexname), 'none') v FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'customer_loyalty_profiles' AND indexdef LIKE 'CREATE UNIQUE%'`],
  ['pge_unique', '`payment_gateway_events` unique indexes', `SELECT coalesce(string_agg(indexname, ', ' ORDER BY indexname), 'none') v FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payment_gateway_events' AND indexdef LIKE 'CREATE UNIQUE%'`],
  ['sms_logs_unique', '`sms_delivery_logs` unique indexes', `SELECT coalesce(string_agg(indexname, ', ' ORDER BY indexname), 'none') v FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sms_delivery_logs' AND indexdef LIKE 'CREATE UNIQUE%'`],
  ['core_fks', 'FKs on payments / payment_refunds / tickets / ticket_service_lines / customers', `SELECT coalesce(string_agg(r.relname || '.' || k.conname || CASE WHEN k.convalidated THEN '' ELSE ' (NOT VALID)' END, ', ' ORDER BY 1), 'none') v FROM pg_constraint k JOIN pg_class r ON r.oid = k.conrelid WHERE k.contype = 'f' AND r.relname IN ('payments', 'payment_refunds', 'tickets', 'ticket_service_lines', 'customers') AND r.relnamespace = 'public'::regnamespace`],
  ['version_missing', 'Version column missing on pos_queue_items / inventory_location_stock / technician_schedules', `SELECT coalesce(string_agg(t, ', '), 'none') v FROM unnest(array['pos_queue_items', 'inventory_location_stock', 'technician_schedules']) t WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name IN ('version', 'record_version'))`],
  ['pg_version', 'Server', `SELECT split_part(version(), ' on ', 1) v`],
  ['latest_migration', 'Latest migration in the ledger', `SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'none' ELSE (SELECT max(filename) FROM schema_migrations) END v`],
];

const c = new pg.Client({ connectionString: url, application_name: 'db-measure' });
await c.connect();
const out = { measured_at: new Date().toISOString(), counts: {}, lists: {}, facts: {} };
try {
  for (const [k, , sql] of COUNTS) {
    if (sql) out.counts[k] = (await c.query(sql)).rows[0].n;
    else { out.lists[k] = (await c.query(LISTS[k])).rows.map((r) => r.v); out.counts[k] = out.lists[k].length; }
  }
  for (const [k, , sql] of FACTS) out.facts[k] = (await c.query(sql)).rows[0].v;
} finally { await c.end(); }

// The ownership registry's summary (committed file), when present — the classification side of the same schema.
const regPath = join(API, 'db', 'ownership', 'registry.generated.json');
const reg = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')).summary : null;

if (process.argv.includes('--json')) { console.log(JSON.stringify({ ...out, ownership: reg }, null, 1)); process.exit(0); }

const day = out.measured_at.slice(0, 10);
let md = `# Database schema measurements — ${day}\n\n`;
md += `**Generated by \`apps/api/scripts/db-measure.mjs\` against a migrated database — do not hand-edit; re-run it.**\n`;
md += `Server: ${out.facts.pg_version}. Ledger: ${out.counts.migrations} migrations, latest \`${out.facts.latest_migration}\`. Measured ${out.measured_at}.\n\n`;
md += `BUILD_PLAN Phase 10 (Constitution 1). The first run (before the Phase 10 migrations) recorded: 709 tables; 539 with tenant_id\n(86 nullable); 293 FKs; 81 tenant tables with no tenant-leading index; 2,117 indexes; 740 CHECKs; 102 text \`status\` columns\nwithout a CHECK; 91 non-PK unique indexes on tenant tables omitting tenant_id; 14 text tenant_id + 3 text branch_id; 69 version\ncolumns; created_by 129 / updated_by 47 / deleted_at 8 / deleted_by 0; RLS on 1 table.\n\n`;
md += `## Counts\n\n| Measure | Value |\n| --- | ---: |\n`;
for (const [k, label] of COUNTS) md += `| ${label} | ${out.counts[k]} |\n`;
md += `\n## Specific facts\n\n| Fact | Value |\n| --- | --- |\n`;
for (const [k, label] of FACTS.filter(([k]) => !['pg_version', 'latest_migration'].includes(k))) md += `| ${label} | ${String(out.facts[k]).replace(/\|/g, '\\|')} |\n`;
if (reg) {
  md += `\n## Ownership registry (apps/api/db/ownership/registry.generated.json)\n\n${reg.tables} tables. Ownership: ${Object.entries(reg.ownership).map(([k, v]) => `${k} ${v}`).join(' · ')}.\n`;
  md += `Domains: ${Object.entries(reg.domain).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}.\nAppend-only tables: ${reg.append_only}; tables whose tenant_id may be NULL by design (platform rows): ${reg.platform_rows}.\n`;
}
md += `\n## Lists\n\nEach list is the rows behind its count above.\n`;
for (const [k, label] of COUNTS.filter(([, , s]) => !s)) {
  const l = out.lists[k];
  md += `\n### ${label} (${l.length})\n\n${l.length ? l.map((x) => '`' + x + '`').join(', ') : '_none_'}\n`;
}
const target = arg('--out');
if (target) { const p = isAbsolute(target) ? target : resolve(ROOT, target); writeFileSync(p, md); console.log(`db-measure: wrote ${p}`); }
else process.stdout.write(md);
