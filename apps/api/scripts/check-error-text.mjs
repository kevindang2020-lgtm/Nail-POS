#!/usr/bin/env node
// check-error-text.mjs — Vietnamese POS §2 / §21 / §58 (V-5, Oct 27 2026): a refusal a person reads travels as a REGISTRY
// code (packages/api-contracts errors.ts) beside its English, so the POS, the Owner App and the Tech App word it in the
// user's language. A RATCHET over every free-text `throw` in modules/*/src and apps/api/src (the TypeScript-parser scan in
// scripts/lib/throw-sites.mjs): a literal sentence thrown WITHOUT a code — not wrapped in withCode(…), no UPPER_CASE code
// argument, no `code:` in its body — that is not the 500 path (Error, InternalServerErrorException …) nor a 403 class
// (PERMISSION_DENIED words it).
//
// tooling/ci/error-text.baseline.json lists, per file, the free-text throws that were REVIEWED and stay English on purpose
// (`reviewed`: internal assertions, client / device contracts, deployment-without-database, background jobs, Super Admin —
// English-only by design §103 — and the customer app / kiosk / display device, which are not POS / Owner / Tech screens),
// each with its reason and sentences; `pending` holds user-facing ones not converted yet (only shrinks — ends empty).
//   FAIL — a file with more free-text throws than its baseline: a NEW one — wrap it: throw withCode(new XError('…'), 'CODE')
//          (add the code to errors.ts and its EN / VI text to apps/pos-web/src/i18n/ns/errors.{en,vi}.ts)
//   FAIL — a file with fewer: run `node apps/api/scripts/check-error-text.mjs --update` so the baseline shrinks
//   FAIL — the Owner / Tech App error catalogues are not in sync with the POS (tooling/i18n/sync-app-error-catalogs.mjs)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, productFiles, scanFile, isFreeText } from './lib/throw-sites.mjs';

const BASELINE = join(ROOT, 'tooling/ci/error-text.baseline.json');
const now = new Map();
for (const f of productFiles()) {
  const free = scanFile(f).filter(isFreeText);
  if (free.length) now.set(relative(ROOT, f), free);
}
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { reviewed: {}, pending: {} };
const allowed = (f) => (base.reviewed[f]?.count ?? 0) + (base.pending[f] ?? 0);

if (process.argv.includes('--update')) {
  // shrink only: pending first, then the reviewed count (a file may never grow here — that is a new throw to convert)
  for (const f of new Set([...Object.keys(base.reviewed), ...Object.keys(base.pending)])) {
    const have = now.get(f)?.length ?? 0;
    if (have > allowed(f)) continue;
    let extra = allowed(f) - have;
    const p = base.pending[f] ?? 0; const dp = Math.min(p, extra); if (p) { if (p - dp) base.pending[f] = p - dp; else delete base.pending[f]; } extra -= dp;
    if (extra && base.reviewed[f]) {
      base.reviewed[f].count -= extra;
      const msgs = new Set((now.get(f) ?? []).map((s) => s.message));
      base.reviewed[f].sentences = (base.reviewed[f].sentences ?? []).filter((s) => msgs.has(s));
      if (base.reviewed[f].count <= 0) delete base.reviewed[f];
    }
  }
  writeFileSync(BASELINE, JSON.stringify(base, null, 1) + '\n');
  console.log(`error-text: baseline shrunk — ${Object.values(base.reviewed).reduce((a, r) => a + r.count, 0)} reviewed, ${Object.values(base.pending).reduce((a, n) => a + n, 0)} pending`);
  process.exit(0);
}

const grew = []; const shrank = [];
for (const [f, sites] of now) if (sites.length > allowed(f)) grew.push([f, sites]);
for (const f of new Set([...Object.keys(base.reviewed), ...Object.keys(base.pending)])) if ((now.get(f)?.length ?? 0) < allowed(f)) shrank.push(f);
const sync = spawnSync('node', [join(ROOT, 'tooling/i18n/sync-app-error-catalogs.mjs'), '--check'], { encoding: 'utf8' });
if (grew.length || shrank.length || sync.status !== 0) {
  for (const [f, sites] of grew) {
    console.log(`error-text: NEW free-text refusal in ${f} (${sites.length} > ${allowed(f)}) — throw withCode(new XError('…'), 'CODE', { params }):`);
    const known = new Set(base.reviewed[f]?.sentences ?? []);
    for (const s of sites.filter((x) => !known.has(x.message))) console.log(`  ${f}:${s.line}  ${s.cls}('${s.message}')`);
  }
  if (shrank.length) { console.log('error-text: fewer free-text throws than the baseline — run `node apps/api/scripts/check-error-text.mjs --update` to shrink it:'); for (const f of shrank) console.log(`  ${f}`); }
  if (sync.status !== 0) console.log((sync.stdout || '') + (sync.stderr || ''));
  process.exit(1);
}
const reviewed = Object.values(base.reviewed).reduce((a, r) => a + r.count, 0);
const pending = Object.values(base.pending).reduce((a, n) => a + n, 0);
console.log(`error-text: no new free-text refusals — ${reviewed} reviewed English-only throws in ${Object.keys(base.reviewed).length} files, ${pending} pending; Owner / Tech catalogues in sync`);
