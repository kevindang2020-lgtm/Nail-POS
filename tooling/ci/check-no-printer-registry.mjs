#!/usr/bin/env node
// check-no-printer-registry.mjs — Kevin's decision (Nov 9 2026): AI PowerSalon has NO receipt-printer registry. Receipts
// are digital (Email / SMS / No receipt on the customer display) and Receipt Devices says NOT CONFIGURED. A printer
// registry was built once by mistake and removed the same day; this gate stops it from being added again by accident.
// It fails on: a migration that creates a printer table, an API route with "printer" in its path, or a client that calls
// one. Changing this decision is Kevin's call only — delete this gate in the same change, with his written go-ahead.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const hits = [];
const walk = (dir, test, out = []) => {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n); const st = statSync(p);
    if (st.isDirectory()) walk(p, test, out); else if (test(p)) out.push(p);
  }
  return out;
};

// 1) no migration creates (or renames to) a printer table
for (const f of walk(join(ROOT, 'apps/api/db/migrations'), (p) => p.endsWith('.sql'))) {
  const sql = readFileSync(f, 'utf8');
  const re = /\b(create\s+table(\s+if\s+not\s+exists)?|alter\s+table[^;]*rename\s+to)\s+("?[a-z0-9_]*printer[a-z0-9_]*"?)/gi;
  for (const m of sql.matchAll(re)) hits.push(`${relative(ROOT, f)}: creates table ${m[3]}`);
}
// 2) no API route has "printer" in its path
for (const line of readFileSync(join(ROOT, 'apps/api/openapi/manifest.txt'), 'utf8').split('\n')) {
  const m = /^(GET|POST|PUT|PATCH|DELETE) (\S*printer\S*)/i.exec(line);
  if (m) hits.push(`apps/api/openapi/manifest.txt: route ${m[1]} ${m[2]}`);
}
// 3) no source file declares a printer controller / calls a printer route
const SRC = ['apps', 'modules', 'packages'].map((d) => join(ROOT, d));
for (const dir of SRC) {
  for (const f of walk(dir, (p) => /\.(ts|tsx|mjs|js)$/.test(p) && !/\.d\.ts$/.test(p) && !p.includes('/i18n/'))) {
    if (f.endsWith('check-no-printer-registry.mjs')) continue;
    const s = readFileSync(f, 'utf8');
    if (/@Controller\(\s*['"`][^'"`]*printer/i.test(s)) hits.push(`${relative(ROOT, f)}: @Controller path contains "printer"`);
    if (/['"`]\/[^'"`]*\bprinters?\b[^'"`]*['"`]/i.test(s) && /api\.(get|post|patch|put|del)/.test(s) && /['"`]\/[a-z/-]*printers?\b/i.test(s)) hits.push(`${relative(ROOT, f)}: calls a printer route`);
    if (/\bfrom\s*\(\s*['"]receipt_printers['"]|\b(selectFrom|insertInto|updateTable)\(\s*['"][a-z_]*printer/i.test(s)) hits.push(`${relative(ROOT, f)}: reads/writes a printer table`);
  }
}

if (hits.length) {
  console.error('❌ no-printer-registry — Kevin decided (Nov 9 2026) there is NO receipt-printer registry; it was added by mistake once and removed:');
  for (const h of hits) console.error('   ' + h);
  console.error('   Receipts stay digital and Receipt Devices stays NOT CONFIGURED. Do not add printer tables, routes or screens without Kevin’s written go-ahead.');
  process.exit(1);
}
console.log('✅ no-printer-registry — no printer table, route or client (Kevin’s Nov 9 2026 decision)');
