#!/usr/bin/env node
// strict-bodies-typeproof.mjs — Security Deep Scan §40 (S-A14): the TYPE-AWARE half of the strict-bodies gate.
//
// The static scanner (lib/client-body-calls.mjs) reads object literals; a client that forwards a typed variable, spreads a
// form, builds the body in a helper or posts through a generic dispatcher is "unverifiable" to it. This proof reads the
// same clients with the TypeScript checker (lib/client-body-typeproof.mjs): the body's TYPE at every call, the callers of a
// wrapper whose body is a parameter (to the object each caller really passes), spreads and helper returns, FormData text
// fields, `fetch(url, { method, body: JSON.stringify(x) })` and prefix-building helpers — and compares every field (nested
// objects and array items too) with the route's declared schema.
//
// Verdict per body route: proven (every caller's fields declared) · undeclared (a caller sends a field the schema does not
// declare — named) · opaque (a caller's body is `any` / an index signature / a computed key: not provable) · no-caller.
// security/strict-bodies.typeproof.json is the committed result (verdicts only — no line numbers, so an unrelated edit does
// not churn it); strict-bodies.vitest.spec.ts accepts a strict route whose callers the static scanner cannot read when this
// file says `proven` (or the route is reviewed in strict-bodies.reviewed.json).
//
//   node apps/api/scripts/strict-bodies-typeproof.mjs           regenerate security/strict-bodies.typeproof.json
//   node apps/api/scripts/strict-bodies-typeproof.mjs --check   CI (check:strict-bodies-types): fail when a STRICT route has
//        an undeclared or opaque caller that is not reviewed, or when the committed file is not what the code gives
// Inputs are hashed (every client file + the route schemas + the proof's own source): an unchanged tree skips the analysis.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(API, '..', '..');
const OUT = join(API, 'security/strict-bodies.typeproof.json');
const REVIEWED = join(API, 'security/strict-bodies.reviewed.json');
const BASELINE = join(API, 'security/strict-bodies.baseline.json');
const CHECK = process.argv.includes('--check');
const PROJECTS = ['admin-web', 'customer-display', 'customer-web', 'manager-pay-web', 'owner-web', 'tech-web', 'pos-web', 'packages', 'js'];
const tmp = mkdtempSync(join(tmpdir(), 'typeproof-'));
const log = (s) => process.stderr.write(s + '\n');

try {
  // 1. every body route's schema, read from Nest's own metadata by the strict-bodies spec
  const schemasFile = join(tmp, 'schemas.json');
  const v = spawnSync('npx', ['vitest', 'run', 'src/common/strict-bodies.vitest.spec.ts'], { cwd: API, encoding: 'utf8', env: { ...process.env, TZ: 'UTC', BODY_SCHEMAS_OUT: schemasFile }, maxBuffer: 64 * 1024 * 1024 });
  if (!existsSync(schemasFile)) { log(v.stdout + v.stderr); throw new Error('the strict-bodies spec did not write the route schemas'); }
  const schemas = JSON.parse(readFileSync(schemasFile, 'utf8'));

  // 2. the inputs' hash
  const lib = await import('./lib/client-body-calls.mjs');
  const h = createHash('sha256');
  h.update(readFileSync(join(API, 'scripts/lib/client-body-typeproof.mjs'))); h.update(readFileSync(schemasFile));
  for (const f of lib.clientFiles(REPO).sort()) { h.update(f.slice(REPO.length)); h.update(readFileSync(f)); }
  const inputsHash = h.digest('hex').slice(0, 32);
  const committed = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;

  // 3. the proof, one TypeScript program per process (a 2-core / 7 GB CI runner holds one at a time)
  let routes;
  if (committed && committed.inputsHash === inputsHash) { routes = committed.routes; log('typeproof: inputs unchanged — the committed proof is current'); }
  else {
    const merged = new Map();
    for (const p of PROJECTS) {
      const out = join(tmp, `part-${p}.json`);
      const r = spawnSync(process.execPath, ['--max-old-space-size=3500', join(API, 'scripts/lib/client-body-typeproof.mjs'), p, schemasFile, out], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0 || !existsSync(out)) { log(r.stdout + r.stderr); throw new Error(`typeproof: project ${p} failed`); }
      log(`typeproof: ${p} — ${(r.stderr.trim().split('\n').pop() || '').trim()}`);
      for (const [k, cs] of Object.entries(JSON.parse(readFileSync(out, 'utf8')).routes)) {
        if (!merged.has(k)) merged.set(k, []);
        merged.get(k).push(...cs);
      }
    }
    routes = {};
    for (const k of Object.keys(schemas).sort()) {
      const cs = (merged.get(k) ?? []).filter((c) => !c.noCaller);
      const undeclared = [...new Set(cs.flatMap((c) => c.undeclared))].sort();
      const opaque = [...new Set(cs.flatMap((c) => c.opaque))].sort();
      const callers = [...new Set(cs.map((c) => c.at.split(':')[0]))].sort();
      routes[k] = { verdict: !cs.length ? 'no-caller' : undeclared.length ? 'undeclared' : opaque.length ? 'opaque' : 'proven', callers, ...(undeclared.length ? { undeclared } : {}), ...(opaque.length ? { opaque } : {}) };
    }
  }
  const doc = { note: 'Security Deep Scan §40 (S-A14): what every first-party client sends to each body route, proven with the TypeScript checker — generated by apps/api/scripts/strict-bodies-typeproof.mjs; do not edit.', inputsHash, routes };

  // 4. strict routes: an undeclared field is a 400 waiting to happen; an opaque caller needs a reviewed reason
  const reviewed = existsSync(REVIEWED) ? JSON.parse(readFileSync(REVIEWED, 'utf8')) : {};
  const exceptions = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')).exceptions ?? {}) : {};
  const strictKeys = Object.keys(schemas).filter((k) => !exceptions[k]);
  const bad = strictKeys.filter((k) => routes[k] && ['undeclared', 'opaque'].includes(routes[k].verdict) && !reviewed[k])
    .map((k) => `${k}: ${routes[k].verdict} — ${(routes[k].undeclared ?? routes[k].opaque ?? []).join(', ')} (${routes[k].callers.join(', ')})`);
  if (CHECK) {
    const stale = !committed || JSON.stringify(committed.routes) !== JSON.stringify(routes);
    if (bad.length) log(`typeproof: ${bad.length} strict route(s) a first-party caller may break — declare the field, stop sending it, or review the route in security/strict-bodies.reviewed.json:\n  ` + bad.join('\n  '));
    if (stale) log('typeproof: security/strict-bodies.typeproof.json is not what the code gives — regenerate: node apps/api/scripts/strict-bodies-typeproof.mjs');
    const c = Object.values(routes).reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {});
    log(`typeproof: ${Object.keys(routes).length} body routes — ${JSON.stringify(c)}`);
    process.exitCode = bad.length || stale ? 1 : 0;
  } else {
    writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
    log(`typeproof: wrote ${OUT.slice(REPO.length + 1)}${bad.length ? `\n  ${bad.length} strict route(s) not proven:\n  ` + bad.join('\n  ') : ''}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
