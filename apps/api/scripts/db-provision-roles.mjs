#!/usr/bin/env node
// db-provision-roles.mjs — create / converge the two least-privilege database logins (BUILD_PLAN Phase 14,
// Constitution 12 "Workers least privileged"). NOT part of migrate.mjs: creating roles needs a superuser (or CREATEROLE).
//
//   node apps/api/scripts/db-provision-roles.mjs --dry-run      print the SQL; with a URL, also run it in a transaction
//                                                               that is ROLLED BACK and report what would change
//   node apps/api/scripts/db-provision-roles.mjs                apply (one transaction), then print the result
//   node apps/api/scripts/db-provision-roles.mjs --write        regenerate db/roles/03_worker_grants.generated.sql
//   node apps/api/scripts/db-provision-roles.mjs --check        exit 1 when that file is stale (CI / tests)
//
// Options: --database-url <url> (default PROVISION_DATABASE_URL, then MIGRATE_DATABASE_URL, then DATABASE_URL — it must be
// the database OWNER's login), --api-role <name> (aps_api), --worker-role <name> (aps_worker). Passwords come only from
// APS_API_PASSWORD / APS_WORKER_PASSWORD (never arguments, never printed); a role created without one cannot log in with
// a password until it is set. Idempotent: run it again after any deploy whose 03 file changed; everything converges.
//
// The worker's tables are DERIVED, not hand-listed: WORKER_USES (each entry names the code that uses the DATABASE_WORKER
// handle) + every table the central retention executor owns in db/retention-policy.json. `worker-role.postgres-race`
// proves the result on a real Postgres: the worker's job types run as aps_worker, forbidden statements are refused.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROLES_DIR = join(HERE, '..', 'db', 'roles');
export const POLICY_FILE = join(HERE, '..', 'db', 'retention-policy.json');
export const WORKER_FILE = join(ROLES_DIR, '03_worker_grants.generated.sql');
export const ROLE_FILES = ['01_roles.sql', '02_api_grants.sql', '03_worker_grants.generated.sql'];
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Every code path that runs on the DATABASE_WORKER handle, and exactly what it touches. A new consumer of that handle
 *  fails `worker-role.vitest` until it is listed here (and 03 regenerated). Column lists where the code reads a few. */
export const WORKER_USES = [
  {
    source: 'apps/api/src/jobs/job-worker.ts → packages/database/src/job-queue.ts (claimJobs / renewJobLease / completeJob / failJob / reapExpiredLeases)',
    grants: {
      jobs: ['SELECT', 'UPDATE'],
      tenant_quotas: ['SELECT (tenant_id, jobs_in_flight)'],
      tenant_subscriptions: ['SELECT (tenant_id, plan, status, current_period_end)'],
      subscription_plans: ['SELECT (id, code, name)'],
      plan_quota_defaults: ['SELECT (plan_id, jobs_in_flight)'],
    },
  },
  {
    source: 'apps/api/src/observability/telemetry-store.ts (writeTelemetryBatch — the log / span sink)',
    grants: { telemetry_log_events: ['INSERT'], telemetry_spans: ['INSERT'] },
  },
  {
    source: 'modules/super-admin/src/super-admin-security/retention-executor.service.ts (its own bookkeeping; the tables it purges are derived from retention-policy.json)',
    grants: {
      data_retention_rules: ['SELECT'], audit_legal_holds: ['SELECT'], customer_legal_holds: ['SELECT'],
      data_retention_purge_runs: ['SELECT', 'INSERT'],
    },
  },
];

const ORDER = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/** table → privilege list (table-level privileges in a fixed order, then column-level SELECTs not already covered). */
export function deriveWorkerGrants(policy = JSON.parse(readFileSync(POLICY_FILE, 'utf8'))) {
  const t = new Map();   // table → { privs:Set, cols:Set, why:Set }
  const add = (table, priv, why) => {
    if (!t.has(table)) t.set(table, { privs: new Set(), cols: new Set(), why: new Set() });
    const e = t.get(table); e.why.add(why);
    const m = /^SELECT \(([^)]+)\)$/.exec(priv);
    if (m) for (const c of m[1].split(',')) e.cols.add(c.trim()); else e.privs.add(priv);
  };
  for (const u of WORKER_USES) for (const [table, privs] of Object.entries(u.grants)) for (const p of privs) add(table, p, u.source.split(' ')[0]);
  for (const [table, p] of Object.entries(policy.tables ?? {})) {
    if (p.executor !== 'central') continue;
    const why = 'retention-policy.json (central executor)';
    add(table, 'SELECT', why); add(table, 'DELETE', why);
    if (p.delete_policy === 'anonymize_after_days') add(table, 'UPDATE', why);
    for (const ref of p.not_referenced_by ?? []) add(ref.table, `SELECT (${ref.column})`, why);
  }
  const out = [];
  for (const table of [...t.keys()].sort()) {
    const e = t.get(table);
    const privs = ORDER.filter((p) => e.privs.has(p));
    if (!e.privs.has('SELECT') && e.cols.size) privs.unshift(`SELECT (${[...e.cols].sort().join(', ')})`);
    out.push({ table, privs, why: [...e.why].sort() });
  }
  return out;
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function renderWorkerSql(grants = deriveWorkerGrants()) {
  const rows = grants.map((g) => `    (${sqlStr(g.table)}, ${sqlStr(g.privs.join(', '))}, ${sqlStr(g.why.join('; '))})`).join(',\n');
  const inserts = grants.filter((g) => g.privs.includes('INSERT')).map((g) => sqlStr(g.table)).join(', ');
  return `-- 03_worker_grants.generated.sql — GENERATED by \`node apps/api/scripts/db-provision-roles.mjs --write\`. Do not edit:
-- change WORKER_USES in that script (code that uses the DATABASE_WORKER handle) or db/retention-policy.json, regenerate,
-- and re-run the provisioning. ${grants.length} tables. Everything else is refused to {{WORKER_ROLE}} — including every
-- table it never touches (customers, payments, users …), all DDL, TRUNCATE, and role management.
--
-- Converges: every earlier table / column / sequence grant to the worker is revoked first, then exactly this set is granted.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "{{WORKER_ROLE}}";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "{{WORKER_ROLE}}";
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT DISTINCT table_name, column_name, privilege_type FROM information_schema.column_privileges
           WHERE grantee = '{{WORKER_ROLE}}' AND table_schema = 'public' LOOP
    EXECUTE format('REVOKE %s (%I) ON public.%I FROM %I', c.privilege_type, c.column_name, c.table_name, '{{WORKER_ROLE}}');
  END LOOP;
END $$;

DO $$
DECLARE g record; s record;
BEGIN
  FOR g IN SELECT * FROM (VALUES
${rows}
  ) AS v(tbl, privs, why) LOOP
    IF to_regclass(format('public.%I', g.tbl)) IS NULL THEN
      RAISE NOTICE 'worker grants: table % does not exist on this database — skipped', g.tbl;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT %s ON public.%I TO %I', g.privs, g.tbl, '{{WORKER_ROLE}}');
  END LOOP;
  -- sequences behind the tables the worker inserts into (serial / identity columns)
  FOR s IN SELECT DISTINCT seq.oid::regclass AS seq FROM pg_class seq
           JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
           JOIN pg_class tb ON tb.oid = d.refobjid
           WHERE seq.relkind = 'S' AND tb.relnamespace = 'public'::regnamespace AND tb.relname = ANY (ARRAY[${inserts || "''"}]::text[]) LOOP
    EXECUTE format('GRANT USAGE ON SEQUENCE %s TO %I', s.seq, '{{WORKER_ROLE}}');
  END LOOP;
END $$;
`;
}

export function renderTemplate(text, vars) {
  return text.replace(/\{\{(API_ROLE|WORKER_ROLE|DATABASE|OWNER)\}\}/g, (_, k) => {
    const v = vars[k];
    if (!v) throw new Error(`db-provision-roles: no value for {{${k}}}`);
    if (/["\\']/.test(v) || /[\x00-\x1f]/.test(v)) throw new Error(`db-provision-roles: unsafe ${k}`);
    return v;
  });
}

/** The full provisioning SQL (01 → 02 → 03) for these names. */
export function provisioningSql(vars, files = ROLE_FILES) {
  return files.map((f) => `-- ── ${f} ──\n` + renderTemplate(readFileSync(join(ROLES_DIR, f), 'utf8'), vars)).join('\n');
}

function parseArgs(argv) {
  const a = { dryRun: false, write: false, check: false, url: '', apiRole: 'aps_api', workerRole: 'aps_worker' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--write') a.write = true;
    else if (k === '--check') a.check = true;
    else if (k === '--database-url') a.url = argv[++i] ?? '';
    else if (k === '--api-role') a.apiRole = argv[++i] ?? '';
    else if (k === '--worker-role') a.workerRole = argv[++i] ?? '';
    else throw new Error(`db-provision-roles: unknown argument ${k}`);
  }
  if (!ROLE_NAME.test(a.apiRole) || !ROLE_NAME.test(a.workerRole) || a.apiRole === a.workerRole) throw new Error('db-provision-roles: role names must be distinct lower-case identifiers');
  return a;
}

/** What exists now — printed before and after, and compared by --dry-run. */
async function snapshot(c, roles) {
  const r = await c.query(`SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`, [roles]);
  const g = await c.query(`SELECT grantee, count(*)::int n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = ANY($1) GROUP BY grantee`, [roles]);
  return { roles: r.rows, tableGrants: Object.fromEntries(g.rows.map((x) => [x.grantee, x.n])) };
}

/** Apply (or dry-run) against a database. Exported so the real-Postgres test drives exactly this. */
export async function provision({ url, apiRole = 'aps_api', workerRole = 'aps_worker', dryRun = false, passwords = {}, log = console.log }) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const me = (await c.query(`SELECT current_user AS u, current_database() AS d, (SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user) AS can`)).rows[0];
    if (!me.can) throw new Error(`db-provision-roles: ${me.u} can not create roles — run it as the database owner / a superuser`);
    const owner = (await c.query(`SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schema_migrations'`)).rows[0]?.tableowner;
    if (!owner) throw new Error('db-provision-roles: schema_migrations not found — migrate the database first');
    if ([apiRole, workerRole].includes(owner)) throw new Error(`db-provision-roles: ${owner} owns the schema — the least-privilege roles must not be the owner`);
    const before = await snapshot(c, [apiRole, workerRole]);
    const text = provisioningSql({ API_ROLE: apiRole, WORKER_ROLE: workerRole, DATABASE: me.d, OWNER: owner });
    await c.query('BEGIN');
    try {
      await c.query(text);
      for (const [role, pw] of [[apiRole, passwords.api], [workerRole, passwords.worker]]) {
        if (pw) await c.query(`ALTER ROLE "${role}" PASSWORD ${c.escapeLiteral(pw)}`);
      }
      const after = await snapshot(c, [apiRole, workerRole]);
      await c.query(dryRun ? 'ROLLBACK' : 'COMMIT');
      log(`${dryRun ? '[dry-run, rolled back] ' : ''}database ${me.d}, owner ${owner}`);
      log(`  before: ${JSON.stringify(before)}`);
      log(`  after:  ${JSON.stringify(after)}`);
      for (const [role, pw] of [[apiRole, passwords.api], [workerRole, passwords.worker]]) log(`  ${role}: password ${pw ? 'set' : 'unchanged (APS_' + (role === apiRole ? 'API' : 'WORKER') + '_PASSWORD not given)'}`);
      return { before, after, owner, database: me.d };
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; }
  } finally { await c.end(); }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.write || a.check) {
    const want = renderWorkerSql();
    let have = ''; try { have = readFileSync(WORKER_FILE, 'utf8'); } catch { /* missing */ }
    if (a.write) { writeFileSync(WORKER_FILE, want); console.log(`wrote ${WORKER_FILE} (${deriveWorkerGrants().length} tables)`); return; }
    if (have !== want) { console.error(`${WORKER_FILE} is stale — run: node apps/api/scripts/db-provision-roles.mjs --write`); process.exit(1); }
    console.log('worker grants file is current'); return;
  }
  const url = a.url || process.env.PROVISION_DATABASE_URL || process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL || '';
  if (!url) {
    if (!a.dryRun) { console.error('db-provision-roles: no database URL (--database-url or PROVISION_DATABASE_URL / MIGRATE_DATABASE_URL / DATABASE_URL)'); process.exit(1); }
    console.log(provisioningSql({ API_ROLE: a.apiRole, WORKER_ROLE: a.workerRole, DATABASE: '<database>', OWNER: '<owner>' }));
    console.log('-- (dry-run without a database: SQL only. Passwords are set from APS_API_PASSWORD / APS_WORKER_PASSWORD and never printed.)');
    return;
  }
  if (a.dryRun) console.log(provisioningSql({ API_ROLE: a.apiRole, WORKER_ROLE: a.workerRole, DATABASE: '<current database>', OWNER: '<schema owner>' }));
  await provision({ url, apiRole: a.apiRole, workerRole: a.workerRole, dryRun: a.dryRun, passwords: { api: process.env.APS_API_PASSWORD, worker: process.env.APS_WORKER_PASSWORD } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
}
