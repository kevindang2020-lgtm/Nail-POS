#!/usr/bin/env node
// audit-realtime-pushes.mjs — Constitution 8: how many DIRECT realtime pushes are left in services, counted
// properly instead of by grep. A naive grep miscounts three ways, and did so repeatedly during this arc:
//   1. `private readonly realtime?: RealtimeEmitter` field declarations look like calls
//   2. a call inside `if (!this.repo.emitsDomainEvents?.()) { ... }` is RETIRED, but the guard is on another line
//   3. a helper body (booking's announce()) is one line serving many call sites — gating the callers is the work
// This walks each file, tracks brace depth of any emitsDomainEvents guard, and reports ungated call sites only.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.service.ts') && !e.includes('.spec.')) files.push(p);
  }
})(SRC);
// Constitution 13: the services now live mostly in modules/*/src — count their pushes too, or this reports only the API's.
const MODULES_DIR = new URL('../../../modules/', import.meta.url).pathname;
for (const m of (existsSync(MODULES_DIR) ? readdirSync(MODULES_DIR) : [])) {
  const root = join(MODULES_DIR, m, 'src');
  if (!existsSync(root)) continue;
  (function walkM(dir) { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walkM(p); else if (e.endsWith('.service.ts') && !e.includes('.spec.')) files.push(p); } })(root);
}

const CALL = /\bthis\.realtime\s*\??\s*\.\s*to(Tenant|Technician|Ticket|Owner|Customer|CustomerDisplay)\s*\??\s*\.?\s*\(/;
// Two guard shapes count as "retired": the block form `if (!…emitsDomainEvents()) { push }` and the early-return
// form `if (…emitsDomainEvents()) return;` at the top of a helper, which retires every push below it in that helper.
const GUARD = /if\s*\(\s*!\s*this\.(repo\.)?emitsDomainEvents\s*\??\s*\.?\s*\(\s*\)\s*\)/;
const EARLY_RETURN = /if\s*\(\s*this\.(repo\.)?emitsDomainEvents\s*\??\s*\.?\s*\(\s*\)\s*\)\s*return\s*;/;
let ungated = 0, gated = 0;
const rows = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let guardDepth = null, depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isDecl = /^\s*(private|public|protected|readonly|@Optional|@Inject)/.test(line) || /\breadonly realtime\b/.test(line);
    if (GUARD.test(line)) guardDepth = depth;                       // everything deeper than here is retired
    if (EARLY_RETURN.test(line)) guardDepth = depth - 1;             // retires the rest of the enclosing function
    if (CALL.test(line) && !isDecl) {
      if (guardDepth !== null) { gated++; } else { ungated++; rows.push(`${file.replace(SRC, '')}:${i + 1}`); }
    }
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (guardDepth !== null && depth <= guardDepth) guardDepth = null; } }
    if (GUARD.test(line) && !line.includes('{')) guardDepth = null;  // single-statement guard covers only that line
  }
}
console.log(`Direct realtime pushes in services — gated (retired): ${gated} · UNGATED: ${ungated}`);
for (const r of rows) console.log(`  ungated: ${r}`);
