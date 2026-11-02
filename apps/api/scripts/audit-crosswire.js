#!/usr/bin/env node
/* THE BIG ONE: extract every HTTP call every frontend makes, and match it against the
 * 1,909 real registered backend routes. Anything unmatched = a call that 404s at runtime. */
const fs = require('fs');
const path = require('path');
// The APPS directory (scripts/ -> apps/api -> apps). Path-independent so it runs in CI on any checkout.
const ROOT = require('path').resolve(__dirname, '../..');
// ONE source of truth for the route table: import it from audit-routes.js.
//
// It used to read `/home/claude/work/api-routes.json` — an absolute path into a scratch directory that exists on
// exactly one machine. In CI it would have crashed on line 8, and **a check that cannot run is a check that is not
// running** — the same as no check, except that it looks like one.
//
// Then I wrote a SECOND route collector here. It found 2,191 routes where audit-routes finds 2,218, and produced
// **24 fake orphans**. Two collectors always drift, and the drift shows up as a checker crying wolf on correct
// code — which is how a checker gets ignored, and the real findings get through with it.
const { routes } = require('./audit-routes.js');

// build matcher: normalized path segments, with :param wildcards
const routeSet = routes.map((r) => ({
  method: r.method,
  segs: r.path.split('/').filter(Boolean),
  raw: r.path,
  controller: r.controller,
}));

function matches(method, callPath) {
  const cs = callPath.split('/').filter(Boolean);
  for (const r of routeSet) {
    if (r.method !== method && r.method !== 'ALL') continue;
    if (r.segs.length !== cs.length) continue;
    let ok = true;
    for (let i = 0; i < cs.length; i++) {
      const rs = r.segs[i];
      if (rs.startsWith(':')) continue;          // param — matches anything
      if (rs.includes('*')) continue;
      if (rs === cs[i]) continue;
      if (cs[i] === '${}') continue;             // interpolated segment on the client
      ok = false; break;
    }
    if (ok) { r.hit = true; return r; }   // Jul 29: mark matched routes so CROSSWIRE_UNUSED=1 can report the reverse direction
  }
  return null;
}

// ── the extractor now lives in ONE place ──────────────────────────────────────────────────────────────────
//
// It used to live HERE, in a copy — and a second copy in audit-unreached-routes.js. The copies drifted, and the
// drift was not cosmetic: building the second audit turned up FIVE extraction bugs, every one of them present in
// this file too. A base-path constant collapsed into one wildcard. An entire CALL STYLE — the bare
// `http<T>(path, { method })` used by sixteen api files (checkout, queue, serving, check-in, booking…) — was
// invisible. A base path hidden inside a local helper. A generic matcher that spanned newlines and swallowed
// real call sites whole. And go-check-in-admin / go-check-in-kiosk were never scanned at all.
//
// So "0 orphaned" was true — over a SUBSET of the calls this codebase actually makes. See scripts/frontend-calls.js.
const { extractFrontendCalls } = require('./frontend-calls');

const orphans = [];
const wired = [];

for (const call of extractFrontendCalls()) {
  let p = call.path;
  if (!p.startsWith('/')) continue;
  p = p.split('?')[0].replace(/\/+$/, '');

  // A trailing `${}` GLUED to the last segment is almost always an appended query string
  // (`/x${qs ? `?${qs}` : ''}`), not a path segment. Try the literal path, then the de-glued variants.
  const candidates = [p];
  let q = p;
  while (/[^/]\$\{\}$/.test(q)) { q = q.replace(/\$\{\}$/, ''); candidates.push(q.replace(/\/+$/, '')); }

  let hit = null;
  for (const c of candidates) { hit = matches(call.method, c); if (hit) { p = c; break; } }

  const rec = { app: call.app, method: call.method, path: p, file: call.file };
  if (hit) wired.push(rec); else orphans.push(rec);
}

// dedupe orphans by app+method+path
const seen = new Set();
const uniq = orphans.filter((o) => {
  const k = o.app + o.method + o.path;
  if (seen.has(k)) return false;
  seen.add(k); return true;
});

console.log('=== FRONTEND → BACKEND CROSS-WIRE AUDIT ===');
console.log(`frontend API calls found: ${wired.length + orphans.length}`);
console.log(`   wired to a real route: ${wired.length}`);
console.log(`   ORPHANED (would 404):  ${orphans.length}  (${uniq.length} distinct)`);
console.log('');
const byApp = {};
for (const o of uniq) (byApp[o.app] ||= []).push(o);
for (const [app, list] of Object.entries(byApp)) {
  console.log(`## ${app} — ${list.length} orphan call(s)`);
  for (const o of list.sort((a,b)=>a.path.localeCompare(b.path))) {
    console.log(`   ${o.method.padEnd(6)} ${o.path}`);
    console.log(`          ↳ ${o.file}`);
  }
  console.log('');
}


// Exit NON-ZERO on any orphan, or this is decoration. A frontend call that 404s is a button that does nothing —
// invisible to `tsc` (the URL is a string) and invisible to every unit test (the API client is mocked).
// `uniq` is the orphan list. My first version guarded on `orphanCount` — a variable that does not exist — so the
// check DETECTED the orphan, printed it, and exited 0. CI would have gone green on a 404-ing endpoint.
//
// That is the third time today I have written a checker that reports a problem and then passes. It is worse than
// no checker: it is a green light with the wires cut.
if (process.env.CROSSWIRE_UNUSED === '1') {
  // ADDITIVE report mode (gate behavior unchanged): routes no scanned client ever calls. Many are clientless BY
  // DESIGN — AI-agent APIs, webhooks, voice, internal/cron — so this is an inventory for human review, not a gate.
  const unused = routeSet.filter((r) => !r.hit).map((r) => `${r.method} ${r.raw}`).sort();
  console.log(`\nUNUSED-ROUTE INVENTORY (${unused.length}):`);
  for (const u of unused) console.log('  ' + u);
}
if (uniq.length > 0) process.exit(1);
process.exit(0);
