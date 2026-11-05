// failsoft-audit.mjs — every `.catch(() => <fallback>)` on a data read, classified by what it hides.
//
// Five of the six schema bugs found today failed SILENTLY, and four of them through a catch like this:
//
//   .catch(() => 0)     → branch-transfer impact said "0 appointments" before an irreversible move
//   .catch(() => [])    → menu-insights cost was 0, so every service reported a 100% margin
//   .catch(() => 0)     → the POS "Service Done" badge read 0 forever
//   catch { /* schema may differ */ } → Super Admin's AI allowance % has always been null
//
// The pattern is load-bearing in two completely OPPOSITE ways, and nothing in the code distinguishes them:
//
//   BENIGN    a sidebar badge. A missing count must not break the page. 0 is a fine answer.
//   DANGEROUS a number someone makes a decision from. 0 is not "unknown" — it is a CONFIDENT, WRONG ANSWER,
//             and it is indistinguishable from a real 0.
//
// The difference is not the catch. It is what the value FEEDS. This finds them all so a human can judge.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../src');

function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) out.push(p);
  }
  return out;
}

// Words that mean "somebody decides something from this number".
const MONEY = /revenue|amount|cents|price|cost|payout|refund|settle|deposit|balance|invoice|payroll|commission|tip/i;
const DESTRUCTIVE = /transfer|migrat|delete|remove|purge|merge|archive|suspend|deactivat|impact|preflight|attachment/i;
const SECURITY = /permission|role|access|grant|verif|auth|lock|block|scan|malware|fraud|abuse|limit|quota|entitle/i;
const BADGE = /badge|count|nav|sidebar|unread|pending|indicator/i;

const hits = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    // .catch(() => 0) / .catch(() => []) / .catch(() => null) / catch { } with a silent fallback
    const m = /\.catch\(\s*\(\s*\)\s*=>\s*([^)]*)\)/.exec(line);
    if (!m) return;
    const fallback = m[1].trim();
    // Only the ones that SWALLOW into a value. A `.catch(() => undefined)` on a fire-and-forget write is fine.
    // NARROWED, deliberately.
    //
    // `[]` and `null` are SHAPED like nothing. A caller that receives them has at least a chance of noticing,
    // and a UI rendering an empty list says "empty" rather than a number.
    //
    // `0` is different in kind. It is a real, plausible, confident answer, and it is INDISTINGUISHABLE from a
    // true zero. "0 appointments will be affected by this branch transfer" reads exactly like a fact. That is
    // the one that lies, so that is the one worth auditing.
    if (fallback !== '0') return;

    // Context: the surrounding few lines, which is where the intent lives.
    const ctx = lines.slice(Math.max(0, i - 4), i + 2).join(' ');
    const rel = file.replace(SRC + '/', '');

    let severity = 'review';
    const why = [];
    if (MONEY.test(ctx) || MONEY.test(rel)) { severity = 'DANGEROUS'; why.push('money'); }
    if (DESTRUCTIVE.test(ctx) || DESTRUCTIVE.test(rel)) { severity = 'DANGEROUS'; why.push('destructive/impact'); }
    if (SECURITY.test(ctx) || SECURITY.test(rel)) { severity = 'DANGEROUS'; why.push('security/limit'); }
    if (severity === 'review' && (BADGE.test(ctx) || BADGE.test(rel))) { severity = 'benign'; why.push('badge/count'); }

    hits.push({ file: rel, line: i + 1, fallback, severity, why: why.join(', '), code: line.trim().slice(0, 100) });
  });
}

const bySeverity = { DANGEROUS: [], review: [], benign: [] };
for (const h of hits) bySeverity[h.severity].push(h);

console.log(`fail-soft catches on data reads: ${hits.length}\n`);
console.log(`  DANGEROUS (money / destructive / security):  ${bySeverity.DANGEROUS.length}`);
console.log(`  review    (unclassified):                    ${bySeverity.review.length}`);
console.log(`  benign    (badges / counts):                 ${bySeverity.benign.length}`);

console.log(`\n${'='.repeat(100)}`);
console.log('DANGEROUS — a silent 0/[]/null here is a CONFIDENT WRONG ANSWER someone acts on');
console.log('='.repeat(100));
for (const h of bySeverity.DANGEROUS.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(`\n${h.file}:${h.line}   [${h.why}]  → ${h.fallback}`);
  console.log(`   ${h.code}`);
}
