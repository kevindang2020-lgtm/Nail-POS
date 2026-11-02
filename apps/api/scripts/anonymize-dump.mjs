#!/usr/bin/env node
// anonymize-dump.mjs — Security Deep Scan §157: produce a lower-environment database from a production COPY with no real
// personal data and no secrets (policy: docs/security/DATA_HANDLING.md). Steps:
//   1. restore the production backup into a NEW, isolated database (never the production database itself);
//   2. node apps/api/scripts/anonymize-dump.mjs --database-url=<that copy> --confirm-copy=<its database name>
//      → rewrites every PII / secret column by the rules in scripts/lib/anonymize.mjs, empties session / token / credential
//        tables, then samples every rewritten table and FAILS if an e-mail / phone shape survived;
//   3. pg_dump the anonymised copy (--out=<file> runs it for you) and drop the copy.
// Refuses: NODE_ENV=production; a URL whose database name does not equal --confirm-copy; a database that still has a
// DB_TENANT_RLS application role connected (the live app); a database name without copy / anon / staging / dev / test in it
// unless --i-understand-this-is-a-copy.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { anonymize, residualPii } from './lib/anonymize.mjs';

const require = createRequire(import.meta.url);
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const url = arg('database-url') ?? process.env.ANON_DATABASE_URL;
const confirm = arg('confirm-copy');
const out = arg('out');
const fail = (m) => { console.error(`✖ ${m}`); process.exit(2); };
if (process.env.NODE_ENV === 'production') fail('refusing to run with NODE_ENV=production');
if (!url) fail('--database-url=<the restored COPY> is required');
const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
if (!confirm || confirm !== dbName) fail(`--confirm-copy must name the copy's database exactly (got "${confirm ?? ''}", the URL names "${dbName}")`);
if (!/(copy|anon|staging|stage|dev|test|scratch)/i.test(dbName) && !process.argv.includes('--i-understand-this-is-a-copy')) fail(`"${dbName}" does not look like a copy — rename it (e.g. ${dbName}_copy) or pass --i-understand-this-is-a-copy`);

const pg = require('pg');
const client = new pg.Client({ connectionString: url }); await client.connect();
const exec = async (sql) => (await client.query(sql)).rows;
const others = (await exec(`select count(*)::int n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and application_name not in ('psql', '')`))[0].n;
if (others > 0 && !process.argv.includes('--force-while-connected')) fail(`${others} other connection(s) to "${dbName}" — is the application pointed at it? Stop them (or --force-while-connected)`);

const plan = await anonymize(exec, { log: (m) => console.log('  ' + m) });
let residual = [];
for (const u of plan.updates) {
  const rows = await exec(`select ${u.cols.map((c) => `"${c}"`).join(', ')} from "${u.table}" limit 200`);
  residual.push(...residualPii(JSON.stringify(rows)).map((x) => `${u.table}: ${x}`));
}
await client.end();
console.log(`anonymized "${dbName}": ${plan.empty.length} credential tables emptied, ${plan.updates.reduce((n, u) => n + u.cols.length, 0)} columns rewritten in ${plan.updates.length} tables`);
if (residual.length) { console.error(`✖ residual personal data shapes after anonymisation (${residual.length}) — extend scripts/lib/anonymize.mjs, re-run:`); for (const r of residual.slice(0, 40)) console.error('  ' + r); process.exit(1); }
if (out) {
  const r = spawnSync('pg_dump', ['--no-owner', '--no-privileges', '--format=custom', `--file=${out}`, url], { stdio: 'inherit' });
  if (r.status !== 0) fail('pg_dump failed');
  console.log(`✔ dump written: ${out}`);
}
