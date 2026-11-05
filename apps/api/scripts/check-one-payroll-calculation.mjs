#!/usr/bin/env node
// check-one-payroll-calculation.mjs — ONE-PAY (Kevin, Oct 13 2026): "there is still only one payroll system … can you
// make into one only." There is exactly ONE place that calculates commission, tip shares, technician earnings and
// payroll amounts:
//
//   modules/workforce/src/compensation/   the engine (compensation-engine.ts, commission-basis.ts lineCommissionCents,
//                                         compensation-rule-loader.ts precedence, the snapshot + adjustments ledger)
//   modules/workforce/src/payroll/        pay periods / lines built FROM the snapshot + ledger
//   packages/money/src/index.ts           the integer primitives the engine uses (percentOfCents, splitByPercent,
//                                         allocateByLargestRemainder) — no rule knowledge
//
// Everything else READS the snapshot / ledger / payroll lines, or asks CompensationService.previewForTicket (which runs
// the same engine) for unpaid work. Frontends display server numbers. Without the authority a field is null + a note,
// never an estimate. This gate FAILS when commission / earnings / tip-share arithmetic appears anywhere else:
//
//   R1 a percent applied to an amount on a payroll line        x * rate / 100, x * (pct / 100), pct / 100 * x, x * 0.4
//   R2 a payroll-named value assigned from a multiplication     commissionCents = sales * …, techShare: elig * …
//   R3 a tip divided by a head count                            tipCents / techs.length, Math.floor(tip / n)
//   R4 a retired second formula by name                         commissionForLine, earningsSnapshot, COMMISSION_RATE = …
//   R5 an engine / primitive call outside the authority         splitByPercent( lineCommissionCents( computeTicketCompensation( …
//   R6 SQL arithmetic on a commission rate column               sum(price * commission_value / 100)
//   R7 a ticket's whole tip credited to its primary technician  sum(tip_cents) … group by primary_technician_id
//   R8 a line rate stamped outside the one precedence           commission_value_snapshot: resolved ? … : service.value
//
// Scans every non-test source file of modules/*/src, apps/*/src (the API and all seven frontends), packages/*/src and
// apps/api/scripts. A reviewed exception lives in one-payroll-calculation.allowlist.json ({ file, rule, reason }) —
// kept as small as possible; an entry that no longer matches anything FAILS too (the list only shrinks).
//
// Run: npm run check:one-payroll-calculation (apps/api) — part of tooling/ci/run-gates.mjs.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const ALLOWLIST = join(ROOT, 'apps/api/scripts/one-payroll-calculation.allowlist.json');
const AUTHORITY = ['modules/workforce/src/compensation/', 'modules/workforce/src/payroll/', 'packages/money/src/index.ts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', 'ios', 'android', '__tests__', 'story', 'e2e']);
const IS_TEST = /\.(test|spec)\.[cm]?[tj]sx?$|\.pgtest\.|\.postgres-race\./;
const EXT = /\.(ts|tsx|mjs|js)$/;

const TERM = /commission|earning|payout|payroll|tech_?share|salon_?share|owner_?share|helper_?share|tip_?share|tip_?split|tip_?alloc|techCents|ownerCents|(tech|split)\w*(pct|percent|rate)\b/i;
const RULES = {
  R1: { why: 'a percent applied to an amount on a payroll line', test: (l) => TERM.test(l) && /\*\s*\(?\s*[\w.$?\[\]'"]+\s*\)?\s*\/\s*100(?![\d.])|\*\s*\(\s*[\w.$]+\s*\/\s*100(?![\d.])\s*\)|\/\s*100(?![\d.])\s*\)?\s*\*\s*[\w(]|\*\s*0\.\d+/.test(l) },
  R2: { why: 'a payroll-named value assigned from a multiplication', test: (l) => /\b(commission|earning|payout|techShare|salonShare|ownerShare|helperShare|tipShare|techCents|ownerCents)\w*\s*(=(?!=)|:)\s*[^;,]*?[\w)\]]\s*\*\s*(?!100\b)[\w(]/i.test(l) },
  R3: { why: 'a tip divided by a head count', test: (l) => /\btips?\w*\s*\/\s*([\w.]+\.(length|size)\b|\(?\s*\w*(count|techs|technicians|participants|people|heads)\b|n\b)/i.test(l) },
  R4: { why: 'a retired second formula by name', test: (l) => /\b(commissionForLine|earningsSnapshot|summarizeEarnings|estimateCommissionCents|estimateServingCommissionCents)\b|\bCOMMISSION_RATE\s*=/.test(l) },
  R5: { why: 'an engine / primitive call outside the authority', test: (l) => /\b(splitByPercent|percentOfCents|lineCommissionCents|computeTicketCompensation|computeServiceLine|allocateTips)\s*\(/.test(l) || (TERM.test(l) || /\btips?\b|tipCents/i.test(l)) && /\ballocateByLargestRemainder\s*\(/.test(l) },
  R6: { why: 'SQL arithmetic on a commission rate column', test: (l) => /commission_(value|percent|rate|split_percent)\w*\s*[*\/]|[*]\s*[\w.]*commission_(value|percent|rate|split_percent)|default_commission_(split_)?percent\s*[*\/]/i.test(l) },
  // a ticket's WHOLE tip credited to one technician (a second tip allocation): summing tickets.tip_cents per primary
  // technician, or an allocation row built from primary_technician_id — the split is ticket_tip_allocations / the snapshot
  R7: { why: "a ticket's whole tip attributed to its primary technician", test: (l, lines, i) =>
    (/sum\(\s*['"`]?[\w.]*\btip_cents\b/.test(l) && lines.slice(Math.max(0, i - 3), i + 4).some((x) => /primary_technician_id/.test(x)))
    || /technician_id\s*:\s*[\w.]*primary_technician_id[^;]{0,60}tip_cents\s*:/.test(l) },
  // a line's rate stamped from anything but THE precedence (pickLineCommission / resolveLineCommissionWithDefault →
  // `picked`): a private "rule → service row as-is → null" resolution is a second commission authority
  R8: { why: 'a line commission rate stamped outside the one precedence (pickLineCommission)', test: (l) =>
    /commission_(type|value)_snapshot\s*:\s*(?!\s|picked\.)(?!(number|string|boolean|null|Generated|ColumnType|Numeric)\b)[^,;]*[.(?'"\d]/.test(l) },
};

/** strip comments well enough for a line scan: whole comment lines, and a trailing // comment outside a string */
function code(line) {
  line = line.replace(/\/\*.*?\*\//g, '');   // inline block comments
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
roots.push(join(ROOT, 'apps/api/scripts'));

const allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8')).entries;
const used = new Set();
const findings = [];
let scanned = 0;
for (const root of roots) {
  for (const f of files(root)) {
    const rel = relative(ROOT, f);
    if (AUTHORITY.some((a) => rel === a || rel.startsWith(a))) continue;
    if (rel === 'apps/api/scripts/check-one-payroll-calculation.mjs') continue;
    scanned++;
    const lines = readFileSync(f, 'utf8').split('\n');
    const codeLines = lines.map(code);
    lines.forEach((raw, i) => {
      const l = codeLines[i];
      if (!l.trim()) return;
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
  if (findings.length) {
    console.error(`\n❌ ${findings.length} payroll calculation(s) outside the ONE authority (modules/workforce/src/compensation + payroll):\n`);
    for (const x of findings) console.error('   ' + x);
    console.error('\n   Read the snapshot / ledger / payroll lines (CompensationSnapshotRepository), or ask CompensationService.previewForTicket.');
    console.error('   Without the authority return null + a note — never an estimate. Frontends display server numbers.\n');
  }
  if (stale.length) { console.error('\n❌ stale allowlist entries:\n'); for (const x of stale) console.error('   ' + x); }
  process.exit(1);
}
console.log(`✅ one payroll calculation — ${scanned} files outside the authority, no commission / earnings / tip-share arithmetic (${allow.length} reviewed exception${allow.length === 1 ? '' : 's'}).`);
