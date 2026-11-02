#!/usr/bin/env node
// check-npm-audit.mjs — Security Deep Scan B6 (mandate §13–§14, §143): the dependency gate that runs on EVERY push and
// pull request, not only nightly.
//
// Runs `npm audit --omit=dev --json` at the WORKSPACE ROOT (every app, module and package that ships — the nightly job
// audited 6 directories and missed the root) and fails on any HIGH or CRITICAL advisory that is not in the reviewed
// allowlist tooling/security/npm-audit-allowlist.json. Each allowlist entry names the advisory (GHSA id), the package,
// WHY it is not reachable or acceptable, and a review-by date — an entry past its date fails the gate, so an accepted
// risk cannot quietly become permanent. An allowlist entry that no longer matches any advisory also fails (remove it).
//
//   node tooling/security/check-npm-audit.mjs            check (needs registry access)
//   node tooling/security/check-npm-audit.mjs --offline  read an `npm audit --json` report from stdin instead
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ALLOW = JSON.parse(readFileSync(join(HERE, 'npm-audit-allowlist.json'), 'utf8'));
const GATED = new Set(['high', 'critical']);

function report() {
  if (process.argv.includes('--offline')) return JSON.parse(readFileSync(0, 'utf8'));
  try { return JSON.parse(execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })); }
  catch (e) { if (e?.stdout) return JSON.parse(String(e.stdout)); throw e; }   // npm audit exits 1 when it finds anything
}

const r = report();
if (!r?.vulnerabilities) { console.error('❌ npm-audit: no report (registry unreachable?) — the gate fails closed'); process.exit(1); }
const ghsa = (url) => String(url ?? '').match(/GHSA-[a-z0-9-]+/i)?.[0]?.toUpperCase() ?? null;
const found = [];
for (const [pkg, v] of Object.entries(r.vulnerabilities)) {
  for (const via of v.via ?? []) {
    if (typeof via !== 'object' || !GATED.has(via.severity)) continue;
    found.push({ pkg, id: ghsa(via.url) ?? String(via.source), severity: via.severity, title: via.title });
  }
}
const today = new Date().toISOString().slice(0, 10);
const allowed = new Map((ALLOW.advisories ?? []).map((a) => [`${a.package}|${String(a.id).toUpperCase()}`, a]));
const bad = [], expired = [], used = new Set();
for (const f of found) {
  const k = `${f.pkg}|${f.id}`; const a = allowed.get(k);
  if (!a) { bad.push(f); continue; }
  used.add(k);
  if (String(a.reviewBy) < today) expired.push({ ...f, reviewBy: a.reviewBy });
}
const stale = [...allowed.keys()].filter((k) => !used.has(k));
let fail = false;
if (bad.length) { fail = true; console.error(`❌ npm-audit: ${bad.length} unreviewed HIGH/CRITICAL production advisory(ies):`); for (const b of bad) console.error(`   ${b.severity.toUpperCase()} ${b.pkg} ${b.id} — ${b.title}`); console.error('   Upgrade, or review reachability and add it to tooling/security/npm-audit-allowlist.json with a reason and review-by date.'); }
if (expired.length) { fail = true; console.error(`❌ npm-audit: ${expired.length} allowlisted advisory(ies) past their review-by date:`); for (const e of expired) console.error(`   ${e.pkg} ${e.id} (review by ${e.reviewBy})`); }
if (stale.length) { fail = true; console.error(`❌ npm-audit: allowlist entries that no longer match any advisory (remove them): ${stale.join(', ')}`); }
if (fail) process.exit(1);
const m = r.metadata?.vulnerabilities ?? {};
console.log(`✅ npm-audit (production deps, workspace root): critical ${m.critical ?? 0}, high ${m.high ?? 0} (${found.length} reviewed in allowlist), moderate ${m.moderate ?? 0}, low ${m.low ?? 0}`);
