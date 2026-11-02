// di-dead-inject-check.mjs — every @Inject('token') must have a provider.
//
// ══ WHY ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// The single most common bug in this codebase — I have shipped it TWICE in one session — is a module that is
// built, fully tested, and NEVER WIRED:
//
//   * the fraud engine was @Optional() @Inject('BookingRiskCounters') and nothing provided it. `screen()` returned
//     immediately on every request, and its 19 passing tests described a code path that could never run.
//   * the OCR pipeline had the same shape.
//
// It is the easiest bug here to ship, because **everything is green and nothing is connected.** `tsc` cannot see
// it (the token is a string). The unit tests cannot see it (they construct the service by hand). Only a DI-graph
// check can.
//
// A missing provider on a REQUIRED dependency crashes at boot, loudly. On an @Optional() one it is SILENT — the
// feature simply never runs, forever, and every test still passes.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(new URL('../src', import.meta.url).pathname);

// Constitution 13: domain modules live in modules/*/src and are part of the API's surface — a gate that walked only
// apps/api/src would lose sight of a controller or repository the moment it moved. Every root is walked.
const MODULE_SRC_ROOTS = (() => { const d = new URL('../../../modules', import.meta.url).pathname; try { return readdirSync(d).map((m) => `${d}/${m}/src`).filter((p) => existsSync(p)); } catch { return []; } })();


function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}

// Ignore COMMENT LINES, not "comments".
//
// The first version of this check regex-stripped /* ... */ blocks, and it silently ate the real code: a `/*`
// inside a string literal opened a fake block comment and the non-greedy match swallowed everything up to the
// next `*/` -- including the @Inject I was looking for. The check then reported "OK" on a codebase where I had
// DELIBERATELY removed a provider to test it.
//
// I only found that because I tried to prove the checker catches a real bug instead of assuming it did. A checker
// that reports OK when it is blind is worse than no checker: it is a green light with the wires cut.
//
// Skipping lines that BEGIN with a comment marker cannot misfire that way -- and a decorator is never on such a
// line.
const codeLines = (s) =>
  s.split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

const files = [SRC, ...MODULE_SRC_ROOTS].flatMap((r) => walk(r));
const injected = new Map();   // token -> [files]
const provided = new Set();

for (const f of files) {
  const src = codeLines(readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/@Inject\(\s*'([^']+)'\s*\)/g)) {
    const t = m[1];
    if (!injected.has(t)) injected.set(t, []);
    injected.get(t).push(f.replace(SRC + '/', ''));
  }
  for (const m of src.matchAll(/provide\s*:\s*'([^']+)'/g)) provided.add(m[1]);
}

const dead = [...injected.entries()].filter(([t]) => !provided.has(t));

console.log(`@Inject string tokens: ${injected.size}   providers declared: ${provided.size}`);

if (dead.length) {
  console.log(`\nDEAD INJECTS (${dead.length}) — injected, but NOTHING provides them:\n`);
  for (const [t, fs] of dead) {
    console.log(`  '${t}'`);
    for (const f of fs) console.log(`     ${f}`);
  }
  console.log('\nAn @Optional() dead inject fails SILENTLY: the feature never runs, and every test still passes.');
  process.exit(1);
}

console.log('\nOK — every injected token has a provider.');
process.exit(0);
