#!/usr/bin/env node
// check-outbound-requests.mjs — Platform Architecture Audit §192 / Security Deep Scan §91–§93 (Nov 5 2026): the egress gate.
//
// Server code may call out to the network in exactly two ways:
//   1. safeOutboundRequest() (packages/security/src/safe-outbound.ts) — required for ANY URL a tenant, owner or Super Admin
//      typed in (https only, the connection's own DNS answer is checked against private / special ranges, no redirects);
//   2. a reviewed call to a fixed, operator-configured endpoint (a provider API base from env, the telemetry exporter, …),
//      listed in apps/api/scripts/outbound-requests.allowlist.json with the reason it cannot reach an internal address.
// This gate finds every raw network call in server code — bare fetch(), http(s).request(), node:https request imports,
// axios / got — and FAILS when a file has more than its reviewed count (a new call must be reviewed or use (1)); a file
// whose count dropped must shrink its entry (--update rewrites counts, never reasons; a NEW file needs a hand-written reason).
// Front-end packages (ui, mobile-sdk, api-client, realtime-client) and tests are out of scope: browsers call their own API.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const ALLOW = join(ROOT, 'apps/api/scripts/outbound-requests.allowlist.json');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);
const CLIENT_PACKAGES = new Set(['ui', 'mobile-sdk', 'api-client', 'realtime-client', 'testing']);
const IS_TEST = /\.(test|spec)\.[cm]?[tj]sx?$|\.pgtest\.|\.postgres-race\.|test-support/;
const CALLS = [
  /(?<![\w.$])fetch\s*\(/g,                       // bare fetch(…) — a method x.fetch(…) is not a network call by itself
  /globalThis(?:\s+as\s+any\))?\.fetch\s*\(/g,   // (globalThis as any).fetch(…)
  /\bhttps?\.request\s*\(/g, /\bhttps?\.get\s*\(/g,
  /\bhttpsRequest\s*\(/g, /\bhttpRequest\s*\(/g,
  /\bfrom\s+['"](?:axios|got|node-fetch|undici)['"]/g,
];

function* walk(dir) {
  let names; try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (SKIP_DIRS.has(n)) continue;
    const p = join(dir, n); const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.[cm]?ts$/.test(n) && !n.endsWith('.d.ts') && !IS_TEST.test(n)) yield p;
  }
}
function roots() {
  const out = [join(ROOT, 'apps/api/src')];
  for (const m of readdirSync(join(ROOT, 'modules'))) out.push(join(ROOT, 'modules', m, 'src'));
  for (const p of readdirSync(join(ROOT, 'packages'))) if (!CLIENT_PACKAGES.has(p)) out.push(join(ROOT, 'packages', p, 'src'));
  return out;
}
export function scan() {
  const found = {};
  for (const r of roots()) for (const f of walk(r)) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    let n = 0; for (const re of CALLS) n += [...src.matchAll(re)].length;
    if (n) found[relative(ROOT, f)] = n;
  }
  return found;
}
export function verdict(found, allow) {
  const problems = [];
  for (const [f, n] of Object.entries(found)) {
    const a = allow[f];
    if (!a) problems.push(`NEW      ${f}  ${n} raw network call(s) — use safeOutboundRequest() for any URL a person typed, or review it into outbound-requests.allowlist.json with the reason`);
    else if (n > a.count) problems.push(`GREW     ${f}  ${n} raw network call(s) (reviewed ${a.count}) — review the new call(s)`);
    else if (n < a.count) problems.push(`SHRINK   ${f}  reviewed ${a.count} → ${n}: run node apps/api/scripts/check-outbound-requests.mjs --update`);
  }
  for (const f of Object.keys(allow)) if (!(f in found)) problems.push(`STALE    ${f}  no raw network call left — remove its entry (--update)`);
  for (const [f, a] of Object.entries(allow)) if (!a.reason || a.reason.length < 20) problems.push(`REASON   ${f}  needs a written reason`);
  return problems;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : {};
  const found = scan();
  if (process.argv.includes('--update')) {
    const next = {};
    for (const [f, n] of Object.entries(found).sort()) if (allow[f]) next[f] = { count: n, reason: allow[f].reason };
    writeFileSync(ALLOW, JSON.stringify(next, null, 2) + '\n');
    const missing = Object.keys(found).filter((f) => !allow[f]);
    console.log(`outbound-requests: counts updated (${Object.keys(next).length} reviewed files)` + (missing.length ? `; NOT added (write a reason by hand): ${missing.join(', ')}` : ''));
    process.exit(missing.length ? 1 : 0);
  }
  const problems = verdict(found, allow);
  if (problems.length) { console.log('❌ outbound-requests:\n' + problems.map((p) => '   ' + p).join('\n')); process.exit(1); }
  console.log(`✅ outbound-requests — ${Object.values(found).reduce((a, b) => a + b, 0)} raw network calls in ${Object.keys(found).length} server files, all reviewed; user-typed URLs go through safeOutboundRequest()`);
}
