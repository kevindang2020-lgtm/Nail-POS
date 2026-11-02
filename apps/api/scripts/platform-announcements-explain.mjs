#!/usr/bin/env node
// platform-announcements-explain.mjs — Platform Announcement mandate §98 (Oct 27 2026): "indexes reviewed against query
// plans". Creates a scratch database (default pa_explain), migrates it with the real runner, seeds a platform-scale fixture
// with plain SQL, and runs EXPLAIN (ANALYZE, BUFFERS) — best of 5 — for every query the feature issues, copied from
// platform-notice.service.ts / platform-notice-admin.queries.ts:
//   POS   active() snapshot · nextChangeAt · receipt (dismiss / ack) lookups
//   Admin list page (no filter / status filter / search) · its count · detail stats
// Three passes: migration 699's indexes DROPPED with the pre-Oct-27 salon search, dropped with the rewritten search, and
// rebuilt — so each change is shown on its own. (Candidates that did not help are listed in 699's header.) PERFORMANCE_REPORT.md "Platform Announcements (§98)" records one run. Drops the database unless --keep.
//
// FIXTURE (platform scale, ~3 years of history): 3,000 salons × 2 branches; 20,000 notices — 19,800 historical (published and
// expired, or archived), 60 drafts, 140 live/scheduled (all-tenants, 500-salon and 40-branch audiences); ~620k target rows;
// ~1.2M receipts (delivered / dismissed / acknowledged).
//   DATABASE_URL=postgres://… node apps/api/scripts/platform-announcements-explain.mjs [--keep]
// Never point it at production: it creates and DROPS the database named PA_EXPLAIN_DB (default pa_explain).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pg = require('pg');
const HERE = dirname(fileURLToPath(import.meta.url));
const base = process.env.DATABASE_URL;
if (!base) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!/localhost|127\.0\.0\.1/.test(base)) { console.error('refusing a non-local server'); process.exit(2); }
const NAME = process.env.PA_EXPLAIN_DB || 'pa_explain';
if (!/^[a-z0-9_]+$/.test(NAME) || !/explain|scratch|perf/.test(NAME)) { console.error('PA_EXPLAIN_DB must look like a scratch name (explain / scratch / perf)'); process.exit(2); }
const url = (db) => { const u = new URL(base); u.pathname = '/' + db; return u.toString(); };

const FIXTURE = `SET session_replication_role = replica;
INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, lifecycle_state)
  SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Salon ' || g, 'Salon ' || g, 'pa-salon-' || g, 'PAX' || g, 'active', tenant_default_lifecycle('active') FROM generate_series(1, 3000) g;
INSERT INTO branches (id, tenant_id, name, status, timezone)
  SELECT ('00000000-0000-4000-9000-' || lpad((g * 10 + b)::text, 12, '0'))::uuid, ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Branch ' || b, 'active', 'America/New_York'
  FROM generate_series(1, 3000) g, generate_series(1, 2) b;
INSERT INTO users (id, tenant_id, full_name, email, role, status) VALUES ('00000000-0000-4000-a000-000000000001', NULL, 'Platform Admin', 'pa@example.test', 'SUPER_ADMIN', 'active');
-- notices: n 1..19800 history, 19801..19860 drafts, 19861..20000 live / scheduled
INSERT INTO platform_notices (id, title, message, type, priority, audience, lifecycle_status, starts_at, ends_at, dismissible, requires_ack, published_at, archived_at, created_by, updated_by, created_at, updated_at, version, content_version)
  SELECT ('00000000-0000-4000-b000-' || lpad(n::text, 12, '0'))::uuid,
    CASE WHEN n % 7 = 0 THEN 'Holiday hours' ELSE NULL END,
    'Platform notice ' || n || CASE WHEN n % 11 = 0 THEN ' — holiday schedule for card payments' ELSE ' — scheduled update window' END,
    (ARRAY['info','update','maintenance','warning','urgent'])[1 + n % 5],
    (ARRAY['low','normal','normal','high','critical'])[1 + n % 5],
    CASE WHEN n % 10 < 6 THEN 'all_tenants' WHEN n % 10 < 9 THEN 'selected_tenants' ELSE 'selected_branches' END,
    CASE WHEN n <= 19800 THEN (CASE WHEN n % 4 = 0 THEN 'archived' ELSE 'published' END) WHEN n <= 19860 THEN 'draft' ELSE 'published' END,
    CASE WHEN n <= 19800 THEN now() - ((20000 - n) * interval '75 minutes') - interval '2 days'
         WHEN n <= 19860 THEN NULL
         WHEN n <= 19960 THEN now() - interval '1 hour' ELSE now() + ((n - 19960) * interval '1 hour') END,
    CASE WHEN n <= 19800 THEN now() - ((20000 - n) * interval '75 minutes') - interval '1 day'
         WHEN n <= 19860 THEN NULL
         WHEN n % 3 = 0 THEN NULL ELSE now() + interval '3 days' END,
    true, n % 13 = 0,
    CASE WHEN n BETWEEN 19801 AND 19860 THEN NULL ELSE now() - interval '1 day' END,
    CASE WHEN n <= 19800 AND n % 4 = 0 THEN now() - interval '1 day' ELSE NULL END,
    '00000000-0000-4000-a000-000000000001'::uuid, '00000000-0000-4000-a000-000000000001'::uuid,
    now() - ((20000 - n) * interval '75 minutes'), now() - ((20000 - n) * interval '60 minutes'), 3, 1
  FROM generate_series(1, 20000) n;
-- targets: a selected-tenants notice targets 300 salons (live ones 500); a selected-branches notice 40 branches
INSERT INTO platform_notice_targets (notice_id, tenant_id, branch_id, target_type)
  SELECT n.id, ('00000000-0000-4000-8000-' || lpad((1 + ((k * 7 + x.i * 13) % 3000))::text, 12, '0'))::uuid, NULL, 'tenant'
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS i, (CASE WHEN id > '00000000-0000-4000-b000-000000019860' THEN 500 ELSE 300 END) AS cnt FROM platform_notices WHERE audience = 'selected_tenants' AND lifecycle_status <> 'draft') x
  JOIN platform_notices n ON n.id = x.id, generate_series(1, x.cnt) k
  ON CONFLICT DO NOTHING;
INSERT INTO platform_notice_targets (notice_id, tenant_id, branch_id, target_type)
  SELECT x.id, ('00000000-0000-4000-8000-' || lpad(t::text, 12, '0'))::uuid, ('00000000-0000-4000-9000-' || lpad((t * 10 + 1)::text, 12, '0'))::uuid, 'branch'
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS i FROM platform_notices WHERE audience = 'selected_branches' AND lifecycle_status <> 'draft') x,
       LATERAL (SELECT 1 + ((k * 31 + x.i * 17) % 3000) AS t FROM generate_series(1, 40) k) tt
  ON CONFLICT DO NOTHING;
-- receipts: every 5th historical all-tenants notice was delivered to 120 salons × 2 users; a third dismissed, some acknowledged
INSERT INTO platform_notice_receipts (tenant_id, notice_id, user_id, kind, content_version, created_at)
  SELECT ('00000000-0000-4000-8000-' || lpad((1 + (s * 23 + x.i) % 3000)::text, 12, '0'))::uuid, x.id,
         ('00000000-0000-4000-c000-' || lpad(((1 + (s * 23 + x.i) % 3000) * 2 + u)::text, 12, '0'))::uuid, k.kind, 1, now() - interval '1 day'
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS i FROM platform_notices WHERE audience = 'all_tenants' AND lifecycle_status <> 'draft') x,
       generate_series(1, 120) s, generate_series(0, 1) u, (VALUES ('delivered'), ('dismissed')) k(kind)
  WHERE x.i % 5 = 0 AND (k.kind = 'delivered' OR s % 3 = 0)
  ON CONFLICT DO NOTHING;
SET session_replication_role = origin;
ANALYZE platform_notices; ANALYZE platform_notice_targets; ANALYZE platform_notice_receipts; ANALYZE tenants; ANALYZE users;`;

// The tenant / branch / user a POS snapshot is taken for: a salon targeted by live selected-tenant notices
const T = '00000000-0000-4000-8000-000000000101', B = '00000000-0000-4000-9000-000000001011', U = '00000000-0000-4000-c000-000000000202';
const STATUS = `CASE WHEN n.lifecycle_status <> 'published' THEN n.lifecycle_status WHEN n.ends_at IS NOT NULL AND n.ends_at <= now() THEN 'expired' WHEN n.starts_at IS NOT NULL AND n.starts_at > now() THEN 'scheduled' ELSE 'active' END`;
const CREATOR = `(SELECT coalesce(nullif(u.full_name, ''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email) FROM users u WHERE u.id = n.created_by AND u.tenant_id IS NULL) AS created_by_name`;
// the salon-name part of the admin search, as the service wrote it before Oct 27 (correlated EXISTS → a scan of every target
// row per candidate notice) and as it is written now (matching salons first — a handful — then their targets by the
// PARTIAL (tenant_id, notice_id[, branch_id]) unique indexes, one UNION branch per target_type — platform-notice.service.ts)
let REWRITE = false;
const SALON_MATCH = (term) => REWRITE
  ? `('${term}' <> '' AND n.id IN (SELECT t.notice_id FROM platform_notice_targets t JOIN tenants tn ON tn.id = t.tenant_id WHERE t.target_type = 'tenant' AND (tn.display_name ILIKE '%${term}%' OR tn.tenant_code ILIKE '%${term}%')
      UNION ALL SELECT t.notice_id FROM platform_notice_targets t JOIN tenants tn ON tn.id = t.tenant_id WHERE t.target_type = 'branch' AND (tn.display_name ILIKE '%${term}%' OR tn.tenant_code ILIKE '%${term}%')))`
  : `EXISTS (SELECT 1 FROM platform_notice_targets t JOIN tenants tn ON tn.id = t.tenant_id WHERE t.notice_id = n.id AND (tn.display_name ILIKE '%${term}%' OR tn.tenant_code ILIKE '%${term}%'))`;
const adminWhere = (status, term) => `WHERE (${status ? `'${status}'` : 'NULL'}::text IS NULL OR ${STATUS} = ${status ? `'${status}'` : 'NULL'})
  AND (${`'${term}'`} = '' OR n.title ILIKE '%${term}%' OR n.message ILIKE '%${term}%'
    OR ${SALON_MATCH(term)})`;
const queries = () => ({
  'POS active() snapshot': `SELECT n.id, n.title, n.message, n.title_vi, n.message_vi, n.english_only, n.type, n.priority, n.dismissible, n.requires_ack, n.starts_at, n.ends_at, n.version, n.content_version, n.published_at,
      EXISTS (SELECT 1 FROM platform_notice_receipts r WHERE r.tenant_id = '${T}' AND r.notice_id = n.id AND r.user_id = '${U}' AND r.kind = 'dismissed' AND r.content_version = n.content_version) AS dismissed,
      EXISTS (SELECT 1 FROM platform_notice_receipts r WHERE r.tenant_id = '${T}' AND r.notice_id = n.id AND r.user_id = '${U}' AND r.kind = 'acknowledged' AND r.content_version = n.content_version) AS acknowledged
    FROM platform_notices n
    WHERE n.lifecycle_status = 'published' AND 'pos' = ANY (n.surfaces)
      AND (n.starts_at IS NULL OR n.starts_at <= now()) AND (n.ends_at IS NULL OR n.ends_at > now())
      AND (n.audience = 'all_tenants'
        OR (n.audience = 'selected_tenants' AND EXISTS (SELECT 1 FROM platform_notice_targets t WHERE t.notice_id = n.id AND t.tenant_id = '${T}' AND t.target_type = 'tenant'))
        OR (n.audience = 'selected_branches' AND '${B}'::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM platform_notice_targets t WHERE t.notice_id = n.id AND t.tenant_id = '${T}' AND t.target_type = 'branch' AND t.branch_id = '${B}'::uuid)))`,
  'POS nextChangeAt': `SELECT min(x) AS at FROM (
      SELECT n.starts_at AS x FROM platform_notices n WHERE n.lifecycle_status = 'published' AND n.starts_at > now()
        AND (n.audience = 'all_tenants' OR EXISTS (SELECT 1 FROM platform_notice_targets t WHERE t.notice_id = n.id AND t.tenant_id = '${T}' AND (t.target_type = 'tenant' OR t.branch_id = '${B}'::uuid)))
      UNION ALL
      SELECT n.ends_at FROM platform_notices n WHERE n.lifecycle_status = 'published' AND n.ends_at > now()
        AND (n.audience = 'all_tenants' OR EXISTS (SELECT 1 FROM platform_notice_targets t WHERE t.notice_id = n.id AND t.tenant_id = '${T}' AND (t.target_type = 'tenant' OR t.branch_id = '${B}'::uuid)))) s`,
  'Admin list page 1 (no filter)': `SELECT n.*, (SELECT count(*) FROM platform_notice_targets t WHERE t.notice_id = n.id)::int AS target_count, ${CREATOR}
    FROM platform_notices n ${adminWhere(null, '')} ORDER BY n.updated_at DESC, n.id LIMIT 25 OFFSET 0`,
  'Admin list status=active': `SELECT n.*, (SELECT count(*) FROM platform_notice_targets t WHERE t.notice_id = n.id)::int AS target_count, ${CREATOR}
    FROM platform_notices n ${adminWhere('active', '')} ORDER BY n.updated_at DESC, n.id LIMIT 25 OFFSET 0`,
  'Admin count status=active': `SELECT count(*)::int AS c FROM platform_notices n ${adminWhere('active', '')}`,
  'Admin search "holiday" page 1': `SELECT n.*, (SELECT count(*) FROM platform_notice_targets t WHERE t.notice_id = n.id)::int AS target_count, ${CREATOR}
    FROM platform_notices n ${adminWhere(null, 'holiday')} ORDER BY n.updated_at DESC, n.id LIMIT 25 OFFSET 0`,
  'Admin detail stats': `SELECT count(*) FILTER (WHERE kind = 'delivered')::int, count(*) FILTER (WHERE kind = 'dismissed')::int, count(*) FILTER (WHERE kind = 'acknowledged')::int, count(DISTINCT tenant_id) FILTER (WHERE kind = 'delivered')::int
    FROM platform_notice_receipts WHERE notice_id = '00000000-0000-4000-b000-000000019800'`,
  'Admin search salon "Salon 101" page 1': `SELECT n.*, (SELECT count(*) FROM platform_notice_targets t WHERE t.notice_id = n.id)::int AS target_count, ${CREATOR}
    FROM platform_notices n ${adminWhere(null, 'Salon 101')} ORDER BY n.updated_at DESC, n.id LIMIT 25 OFFSET 0`,
  'Admin count search "holiday"': `SELECT count(*)::int AS c FROM platform_notices n ${adminWhere(null, 'holiday')}`,
});
// migration 699's indexes: measured DROPPED ("before") and rebuilt ("after")
const MIGRATION_699 = [
  ['idx_platform_notices_live_ends', `CREATE INDEX idx_platform_notices_live_ends ON platform_notices (ends_at) WHERE lifecycle_status = 'published'`],
  ['idx_platform_notices_recent', `CREATE INDEX idx_platform_notices_recent ON platform_notices (updated_at DESC, id)`],
];

const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
await admin.query(`CREATE DATABASE ${NAME}`);
const mig = spawnSync(process.execPath, [join(HERE, 'migrate.mjs')], { env: { ...process.env, DATABASE_URL: url(NAME) }, encoding: 'utf8' });
if (mig.status !== 0) { console.error(mig.stdout?.slice(-2000), mig.stderr?.slice(-2000)); process.exit(1); }
const c = new pg.Client({ connectionString: url(NAME) });
await c.connect();
const t0 = Date.now();
await c.query(FIXTURE);
const sizes = (await c.query(`SELECT (SELECT count(*) FROM platform_notices) AS notices, (SELECT count(*) FROM platform_notice_targets) AS targets, (SELECT count(*) FROM platform_notice_receipts) AS receipts`)).rows[0];
console.log(`# fixture ${JSON.stringify(sizes)} seeded in ${Math.round((Date.now() - t0) / 1000)} s`);

async function measure(label) {
  const out = [];
  for (const [name, q] of Object.entries(queries())) {
    let best = null;
    for (let i = 0; i < 5; i++) {
      const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`);
      const plan = r.rows[0]['QUERY PLAN'][0];
      if (!best || plan['Execution Time'] < best['Execution Time']) best = plan;
    }
    const nodes = []; const walk = (p) => { if (p['Index Name']) nodes.push(`${p['Node Type']}(${p['Index Name']})`); else if (/Scan/.test(p['Node Type'])) nodes.push(`${p['Node Type']}(${p['Relation Name'] ?? ''})`); (p.Plans ?? []).forEach(walk); };
    walk(best.Plan);
    out.push({ label, name, ms: best['Execution Time'], buffers: (best.Plan['Shared Hit Blocks'] ?? 0) + (best.Plan['Shared Read Blocks'] ?? 0), nodes: [...new Set(nodes)].join(', ') });
  }
  return out;
}
for (const [name] of MIGRATION_699) await c.query(`DROP INDEX IF EXISTS ${name}`);
await c.query('ANALYZE platform_notices');
const before = await measure('without 699, old search');
REWRITE = true;
const rewritten = await measure('without 699, new search');
for (const [, ddl] of MIGRATION_699) await c.query(ddl);
await c.query('ANALYZE platform_notices');
const after = await measure('with 699, new search');
console.log('query\tbefore (674 indexes, old search) ms\tnew search ms\t+ 699 indexes ms\tplan before\tplan after');
for (const b of before) {
  const r = rewritten.find((x) => x.name === b.name); const a = after.find((x) => x.name === b.name);
  console.log(`${b.name}\t${b.ms.toFixed(3)}\t${r.ms.toFixed(3)}\t${a.ms.toFixed(3)}\t${b.nodes}\t${a.nodes}`);
}
await c.end();
if (!process.argv.includes('--keep')) await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
await admin.end();
