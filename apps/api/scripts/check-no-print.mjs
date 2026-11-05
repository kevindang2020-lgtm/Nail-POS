#!/usr/bin/env node
// check-no-print.mjs — OWNER DECISION GATE (Kevin, Jul 30 2026): AI PowerSalon does NOT print schedules,
// queues, or service tickets. These three controls were removed from the POS and must never return.
//
// WHY THIS GATE EXISTS: the owner does not want printed schedules / queue lists / service tickets in the
// product. Two of the removed controls called window.print() (browser print dialog on a POS screen), two were
// placeholders that displayed "isn't connected yet". Wiring any of them back — even "temporarily" — is a
// product regression, not a feature. If a customer or developer asks for it, the answer is: not in scope.
//
// WHAT IS STILL ALLOWED: checkout RECEIPT delivery, including the 'print' receipt channel. Receipts are a
// separate, wanted feature (POSCheckoutScreen / CheckoutTicketInner). This gate does not touch them.
//
// Exit 1 on any violation. Run: npm run check:no-print   (part of the standard gate battery)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname; // repo root
const SCAN = ['apps', 'packages'];
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', 'ios', 'android']);
const EXT = /\.(ts|tsx|js|jsx|html)$/;

// Banned control labels (the three removed features, incl. plausible renamings).
const LABEL = /\b(print|printing)\s*(the\s*)?(schedule|queue|service\s*ticket|serve\s*ticket|ticket\s*list|tech\s*queue|customer\s*queue)\b/i;
// Banned mechanism: the browser print dialog anywhere in a frontend. Receipts do not use it.
const MECHANISM = /\bwindow\s*\.\s*print\s*\(|\bdocument\s*\.\s*execCommand\s*\(\s*['"]print/i;

const violations = [];
(function walk(dir) {
  let entries; try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (!EXT.test(e)) continue;
    if (p.includes('check-no-print.mjs')) continue;
    const src = readFileSync(p, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.includes('check:no-print') || /allow-print-gate/.test(line)) return;
      const rel = p.slice(ROOT.length);
      if (LABEL.test(line)) violations.push({ rel, n: i + 1, why: 'banned print control label', line: line.trim().slice(0, 120) });
      else if (MECHANISM.test(line)) violations.push({ rel, n: i + 1, why: 'browser print dialog in a frontend', line: line.trim().slice(0, 120) });
    });
  }
})(join(ROOT, SCAN[0]));
walkDirs();
function walkDirs() { /* packages/ */
  const p = join(ROOT, 'packages');
  try { statSync(p); } catch { return; }
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      if (SKIP.has(e)) continue;
      const q = join(dir, e); const st = statSync(q);
      if (st.isDirectory()) { walk(q); continue; }
      if (!EXT.test(e)) continue;
      const src = readFileSync(q, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.includes('check:no-print') || /allow-print-gate/.test(line)) return;
        const rel = q.slice(ROOT.length);
        if (LABEL.test(line)) violations.push({ rel, n: i + 1, why: 'banned print control label', line: line.trim().slice(0, 120) });
        else if (MECHANISM.test(line)) violations.push({ rel, n: i + 1, why: 'browser print dialog in a frontend', line: line.trim().slice(0, 120) });
      });
    }
  })(p);
}

if (violations.length) {
  console.error('\n❌ check:no-print FAILED — printing of schedules/queues/service tickets is not part of this product.\n');
  for (const v of violations) console.error(`  ${v.rel}:${v.n}  (${v.why})\n    ${v.line}`);
  console.error(`\n${violations.length} violation(s). This is an OWNER DECISION, not a technical limitation.`);
  console.error('Do not re-add these controls. See ENGINEERING_RULES.md rule 17 and PRINT_FEATURES_REMOVED.md.\n');
  process.exit(1);
}
console.log('✅ check:no-print — no print-schedule / print-queue / print-service-ticket controls, no browser print dialogs in frontends.');
