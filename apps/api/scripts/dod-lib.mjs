// dod-lib.mjs — the shared evidence vocabulary of the Definition-of-Done scripts (control-plane / observability /
// security -dod-check.mjs). BUILD_PLAN Phase 14.
//
// A DoD line is a predicate over EVIDENCE in the tree — an export, a route decorator, a migration, a test, a CI step —
// never a comment, a TODO, or a bare `true`. Statuses are explicit:
//   DONE      the evidence exists (and, where the line is "X passes", the gate that enforces it exists — `--run` measures it);
//   HOSTING   the code is built and proven, and the remaining step is an action only Kevin can take on the hosting
//             (named in the note, and listed in docs/HOSTING_ACTIONS_FOR_KEVIN.md);
//   DECIDED   the mechanism exists and a RECORDED decision (its text is part of the evidence) says the rest is not to be
//             built — counted apart from DONE (BUILD_PLAN Phase 15);
//   PARTIAL   the evidence exists AND the note names what is still missing in the code — not counted as done;
//   NOT DONE  the evidence is missing.
// A grep against a file that does not exist is a BROKEN CHECK (files moved, the line silently flipped): it fails the run.
//
// DOD_ROOT (env) points the scripts at another apps/api directory — the predicate tests
// (src/common/dod-predicates.vitest.spec.ts) copy ONE line's evidence into a scratch tree and prove the line flips to
// NOT DONE when that evidence is removed.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { spawnSync } from 'node:child_process';

// every path a predicate touched since the previous line was built — the item constructors below take it, so each
// line knows its own evidence (printed with DOD_TRACE=1; the predicate tests copy exactly those files)
let ACCESS = [];
const take = () => { const a = [...new Set(ACCESS)]; ACCESS = []; return a; };

export function evidence(scriptUrl) {
  const ROOT = process.env.DOD_ROOT ? resolve(process.env.DOD_ROOT) : resolve(new URL('..', scriptUrl).pathname);
  const R = (p) => resolve(ROOT, p);
  const MISSING = new Set();
  const has = (p) => { ACCESS.push(p); const ok = existsSync(R(p)); if (!ok) MISSING.add(p); return ok; };
  const read = (p) => (has(p) ? readFileSync(R(p), 'utf8') : '');
  const grep = (p, re) => { if (!has(p)) return false; return re.test(readFileSync(R(p), 'utf8')); };
  /** a file that may legitimately be absent (an optional artefact): no BROKEN CHECK */
  const exists = (p) => { ACCESS.push(p); return existsSync(R(p)); };
  process.on('exit', () => {
    if (MISSING.size) { console.error(`\nBROKEN CHECK — these files do not exist (moved?): ${[...MISSING].join(', ')}`); process.exitCode = 1; }
  });

  // ── gates every push runs (the "X passes" lines are enforced by these; --run measures them here) ─────────────────
  const W = '../../.github/workflows/';
  const ci = {
    /** the API (and every package + module it needs) is BUILT on every push: the image build runs the Dockerfile's build */
    build: () => grep(W + 'build-image.yml', /\non:\n\s+push:/) && grep('../../Dockerfile', /npm run build:packages[\s\S]*npm run build:modules[\s\S]*npm run build --workspace @aipowersalon\/api/)
      && grep(W + 'security.yml', /run: npm run build:modules/),
    /** type checking: the API build is tsc over src (tsconfig.build.json), and the gates typecheck every SPA ('app types') */
    types: () => grep('package.json', /"build": "tsc -p tsconfig\.build\.json"/) && grep('../../tooling/ci/run-gates.mjs', /\['app types', 'node', \['tooling\/ci\/check-app-types\.mjs'\]\]/),
    /** every suite runs on every push (4-way matrix) plus the real-Postgres race lane */
    tests: () => grep(W + 'security.yml', /suite: \[api, modules, apps, packages\]/) && grep(W + 'security.yml', /npm run ci:test:race/) && has('../../tooling/ci/run-tests.mjs'),
    /** lint is a gate: 0 errors and no rule above its baseline — in the gate list, and `npm run lint` IS the ratchet */
    lint: () => grep('../../tooling/ci/run-gates.mjs', /\n\s+'lint',\n/) && grep('package.json', /"check:lint": "node \.\.\/\.\.\/tooling\/ci\/lint-ratchet\.mjs"/)
      && grep('../../package.json', /"lint": "node tooling\/ci\/lint-ratchet\.mjs"/) && grep('../../tooling/ci/lint-ratchet.mjs', /process\.exit\(errors\.length \|\| grew\.length \? 1 : 0\)/)
      && has('../../tooling/ci/lint-baseline.json') && grep(W + 'security.yml', /npm run ci:gates/),
  };
  ACCESS = [];   // what the script read before its first line (the --run lane lists) belongs to no line
  return { ROOT, R, has, read, grep, exists, ci, take };
}

export const RUN = process.argv.includes('--run');
/** run a command (in apps/api unless cwd given); true when it exits 0 */
export function runOk(cmd, args, cwd, timeout = 600_000) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && process.env.DOD_VERBOSE) console.error(`[${cmd} ${args.join(' ')}] exit ${r.status}\n${(r.stdout || '').slice(-1500)}${(r.stderr || '').slice(-800)}`);
  return r.status === 0;
}

export const D = (name, ok, note = null) => ({ name, ok, kind: 'DONE', note, files: take() });
export const H = (name, ok, action) => ({ name, ok, kind: 'HOSTING', note: action, files: take() });
export const DC = (name, ok, decision) => ({ name, ok, kind: 'DECIDED', note: decision, files: take() });
export const P = (name, ok, missing) => ({ name, ok, kind: 'PARTIAL', note: missing, files: take() });
export const N = (name, why) => ({ name, ok: false, kind: 'NOT DONE', note: why, files: take() });
/** the tuple form ([name, ok, note]) of control-plane-dod-check.mjs, with its evidence attached */
export const T = (name, ok, note) => [name, ok, note, take()];

/** print every line, then the totals line `§<n>: … of <count>`; returns the counts */
export function report(section, items, expected) {
  const c = { DONE: 0, HOSTING: 0, DECIDED: 0, PARTIAL: 0, 'NOT DONE': 0 };
  const md = process.argv.includes('--markdown');   // the audit docs' DoD table is this output, pasted verbatim
  if (md) console.log('| # | §' + section + ' line | Status | Evidence / Kevin action |\n|---|---|---|---|');
  let n = 0;
  for (const it of items) {
    n++;
    if (md) {
      const st = it.ok ? it.kind : 'NOT DONE';
      c[st]++;
      const ev = (it.files ?? []).map((f) => '`' + posix.normalize('apps/api/' + f) + '`').join(', ');
      const note = String((!it.ok ? (it.kind === 'NOT DONE' ? it.note : 'evidence missing') : it.note) ?? '').replace(/\|/g, '\\|');
      console.log(`| ${n} | ${it.name} | **${st}** | ${[note, ev].filter(Boolean).join(' — ')} |`);
      continue;
    }
    const status = it.ok ? it.kind : 'NOT DONE';
    c[status]++;
    const note = !it.ok ? (it.kind === 'NOT DONE' ? it.note : 'evidence missing' + (it.note ? ` (was: ${it.note})` : '')) : it.note;
    console.log(`${status.padEnd(9)} ${it.name}${note ? '  — ' + note : ''}`);
    if (process.env.DOD_TRACE) console.log(`    files: ${JSON.stringify(it.files ?? [])}`);
  }
  console.log(`\n§${section}: ${c.DONE} DONE · ${c.HOSTING} HOSTING (Kevin) · ${c.DECIDED ? `${c.DECIDED} DECIDED · ` : ''}${c.PARTIAL} PARTIAL · ${c['NOT DONE']} NOT DONE of ${items.length}`);
  if (expected && items.length !== expected) { console.error(`expected ${expected} §${section} lines, have ${items.length}`); process.exitCode = 2; }
  return c;
}
