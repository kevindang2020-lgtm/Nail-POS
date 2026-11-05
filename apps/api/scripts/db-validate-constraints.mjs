#!/usr/bin/env node
// db-validate-constraints.mjs — BUILD_PLAN Phase 10 (Constitution 1 §69–71): retry every constraint a migration deferred.
//
//   DATABASE_URL=… node scripts/db-validate-constraints.mjs            list the open deferrals and retry each one
//   DATABASE_URL=… node scripts/db-validate-constraints.mjs --list     list only (no retry)
//   DATABASE_URL=… node scripts/db-validate-constraints.mjs --json     machine-readable output
//
// For each open row of schema_deferred_constraints: re-count the blocking rows now; zero → run its retry statement and
// mark it resolved; otherwise leave it open with the fresh count. The logic is DbConstraintsService (src/common/
// db-constraints.service.ts — the same code the Super Admin Database page's "retry" action calls), loaded from the build.
// Exit code: 0 when nothing is left open, 2 when something is still blocked or failed, 1 on a connection error.
import pg from 'pg';

const args = new Set(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) { console.error('db-validate-constraints: DATABASE_URL is not set'); process.exit(1); }

const { DbConstraintsService } = await import('../dist/common/db-constraints.service.js');
const pool = new pg.Pool({ connectionString: url, max: 1, application_name: 'db-validate-constraints' });
let code = 0;
try {
  const svc = new DbConstraintsService(pool);
  const open = await svc.list();
  if (args.has('--list')) {
    if (args.has('--json')) console.log(JSON.stringify(open, null, 2));
    else if (!open.length) console.log('db-validate-constraints: no open deferrals');
    else for (const d of open) console.log(`OPEN  ${d.kind.padEnd(22)} ${d.tableName}.${d.name}  (${d.reason}; from ${d.migration})`);
    code = open.length ? 2 : 0;
  } else {
  const results = await svc.retryAll('db-validate-constraints');
  if (args.has('--json')) console.log(JSON.stringify(results, null, 2));
  else {
    if (!results.length) console.log('db-validate-constraints: no open deferrals');
    for (const r of results) console.log(`${r.status.toUpperCase().padEnd(14)} ${r.table}.${r.name}${r.blockingRows ? `  blocking=${r.blockingRows}` : ''}${r.error ? `  ${r.error}` : ''}`);
  }
  code = results.some((r) => r.status !== 'resolved' && r.status !== 'already_resolved') ? 2 : 0;
  }
} catch (e) {
  console.error('db-validate-constraints:', e?.code ?? '', String(e?.message ?? e).split('\n')[0]);
  code = 1;
} finally {
  await pool.end().catch(() => undefined);
}
process.exit(code);
