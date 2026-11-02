#!/usr/bin/env node
// check-one-tax-calculation.mjs — Oct 14 build plan §33 ("one tax / percentage helper + gate"), rebuilt Oct 21 2026.
// There is exactly ONE place sales tax is computed: packages/money/src/index.ts taxCents(taxableCents, ratePercent).
// Six copies of `Math.round(x * (taxRate / 100))` lived in checkout, the customer display, two owner dashboards and the AI
// workflow — and the reports demo data hard-coded 7.75 %. Each rounds the same today; the first one that doesn't is a
// cash drawer that does not reconcile. This gate FAILS when tax arithmetic appears anywhere else:
//   T1  a tax rate applied to an amount          x * (taxRate / 100), x * taxRatePercent / 100, taxRate / 100 * x
//   T2  a tax-named value assigned from a multiplication   taxCents = sub * …, tax: net * …
//   T3  a hard-coded tax rate                     * 0.0775, * 0.07, * 0.0625 on a tax-named line
// Scans every non-test source file of modules/*/src, apps/*/src and packages/*/src. A reviewed exception lives in
// one-tax-calculation.allowlist.json ({ file, rule, reason }); an entry that matches nothing FAILS too (only shrinks).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const ALLOWLIST = join(ROOT, 'apps/api/scripts/one-tax-calculation.allowlist.json');
const AUTHORITY = ['packages/money/src/index.ts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', 'ios', 'android', '__tests__', 'story', 'e2e']);
const IS_TEST = /\.(test|spec)\.[cm]?[tj]sx?$|\.pgtest\.|\.postgres-race\./;
const EXT = /\.(ts|tsx|mjs|js)$/;

const TAX = /\btax/i;
const RULES = {
  T1: { why: 'a tax rate applied to an amount (use taxCents from @aipowersalon/money)', test: (l) => TAX.test(l) && /(\*\s*\(?\s*[\w.$?\[\]'"]*tax\w*\s*\)?\s*\/\s*100(?![\d.])|tax\w*\s*\/\s*100(?![\d.])\s*\)?\s*\*|\*\s*\(\s*[\w.$]*tax\w*\s*\/\s*100(?![\d.])\s*\))/i.test(l) },
  T2: { why: 'a tax-named value assigned from a multiplication', test: (l) => /\btax\w*(cents|amount)?\s*(=(?!=)|:)\s*(Math\.round\()?\s*\(?[\w.$]+\s*[-+]?\s*[\w.$]*\)?\s*\*/i.test(l) && !/taxCents\(/.test(l) },
  T3: { why: 'a hard-coded tax rate', test: (l) => TAX.test(l) && /\*\s*0?\.0\d{2,4}\b/.test(l) },
};

function code(line) {
  line = line.replace(/\/\*.*?\*\//g, '');
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return '';
  const i = line.search(/(^|[^:'"`\\])\/\/(?![^'"`]*['"`]\s*[,)])/);
  return i >= 0 ? line.slice(0, i + 1) : line;
}
function* files(dir) {
  let entries; try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* files(p);
    else if (EXT.test(e) && !IS_TEST.test(e) && !e.endsWith('.d.ts')) yield p;
  }
}
const roots = [];
for (const base of ['modules', 'apps', 'packages']) {
  for (const d of readdirSync(join(ROOT, base))) { const src = join(ROOT, base, d, 'src'); if (existsSync(src)) roots.push(src); }
}
const allow = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')).entries : [];
const used = new Set(); const findings = []; let scanned = 0;
for (const root of roots) {
  for (const f of files(root)) {
    const rel = relative(ROOT, f);
    if (AUTHORITY.some((a) => rel === a || rel.startsWith(a))) continue;
    scanned++;
    const lines = readFileSync(f, 'utf8').split('\n');
    const codeLines = lines.map(code);
    lines.forEach((raw, i) => {
      const l = codeLines[i]; if (!l.trim()) return;
      for (const [id, r] of Object.entries(RULES)) {
        if (!r.test(l, codeLines, i)) continue;
        const k = allow.findIndex((a) => a.file === rel && a.rule === id);
        if (k >= 0) { used.add(k); continue; }
        findings.push(`${rel}:${i + 1}  [${id} ${r.why}]  ${raw.trim().slice(0, 150)}`);
      }
    });
  }
}
const stale = allow.filter((_, k) => !used.has(k)).map((a) => `${a.file} [${a.rule}] — no longer matches; remove it from the allowlist`);
if (findings.length || stale.length) {
  if (findings.length) { console.error(`\n❌ ${findings.length} tax calculation(s) outside the ONE authority (packages/money taxCents):\n`); for (const x of findings) console.error('   ' + x); console.error(''); }
  if (stale.length) { console.error('\n❌ stale allowlist entries:\n'); for (const x of stale) console.error('   ' + x); }
  process.exit(1);
}
console.log(`✅ one tax calculation — ${scanned} files outside the authority, no tax arithmetic (${allow.length} reviewed exception${allow.length === 1 ? '' : 's'})`);
