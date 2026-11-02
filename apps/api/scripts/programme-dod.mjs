#!/usr/bin/env node
// programme-dod.mjs — the whole programme's script-checked Definition of Done in one reproducible number
// (BUILD_PLAN Phase 15; the table it feeds is docs/PROGRAMME_DOD_STATUS.md).
//
// Runs the four DoD scripts unmodified and reads each one's totals line (`§<n>: <k> DONE · <k> HOSTING (Kevin) ·
// <k> DECIDED · <k> PARTIAL · <k> NOT DONE of <count>`):
//   Constitution 7  Super Admin & Control Plane  §303  control-plane-dod-check.mjs
//   Constitution 10 AI Platform                  §304  audit-ai-dod.mjs   (runs the modules/ai suite: ~5-9 min)
//   Constitution 11 Observability                §396  observability-dod-check.mjs
//   Constitution 12 Security                     §324  security-dod-check.mjs
// Exit 1 when any script exits non-zero (a BROKEN CHECK), prints no totals line, or any line is PARTIAL / NOT DONE —
// the programme's exit criterion is "every line DONE, HOSTING or DECIDED".
// The other constitutions and the six specs are checked by their own gates and per-phase tables (no single script);
// docs/PROGRAMME_DOD_STATUS.md lists them with their evidence.
//
// Usage: node scripts/programme-dod.mjs [--json] [--skip-ai]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = [
  { c: 'C7', name: 'Super Admin & Control Plane', script: 'control-plane-dod-check.mjs' },
  { c: 'C10', name: 'AI Platform', script: 'audit-ai-dod.mjs' },
  { c: 'C11', name: 'Observability', script: 'observability-dod-check.mjs' },
  { c: 'C12', name: 'Security', script: 'security-dod-check.mjs' },
];
const KINDS = ['DONE', 'HOSTING', 'DECIDED', 'PARTIAL', 'NOT DONE'];

/** parse the `§n: … of N` totals line; null when absent */
export function parseTotals(out) {
  const m = /^§(\d+): (.+) of (\d+)\s*$/m.exec(out);
  if (!m) return null;
  const t = { section: m[1], total: Number(m[3]) };
  for (const k of KINDS) t[k] = Number(new RegExp(`(\\d+) ${k}\\b`).exec(m[2])?.[1] ?? 0);
  return t;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const skipAi = process.argv.includes('--skip-ai');
  const rows = []; let bad = false;
  for (const s of SCRIPTS) {
    if (skipAi && s.c === 'C10') { rows.push({ ...s, skipped: true }); continue; }
    const r = spawnSync(process.execPath, [join(API, 'scripts', s.script)], { cwd: API, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, DOD_TRACE: '' } });
    const out = (r.stdout || '') + (r.stderr || '');
    const t = parseTotals(out);
    const broken = r.status !== 0 || /BROKEN CHECK/.test(out);
    const sum = t ? KINDS.reduce((a, k) => a + t[k], 0) : 0;
    const row = { ...s, ...(t ?? {}), broken, ok: !!t && !broken && t.PARTIAL === 0 && t['NOT DONE'] === 0 && sum === t.total };
    if (!row.ok) bad = true;
    rows.push(row);
  }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(bad ? 1 : 0); }
  const pad = (v, n) => String(v).padStart(n);
  console.log('Programme Definition of Done — the four DoD scripts (BUILD_PLAN Phase 15)\n');
  console.log('const  name                          §      DONE  HOSTING  DECIDED  PARTIAL  NOT DONE  of');
  const tot = Object.fromEntries([...KINDS, 'total'].map((k) => [k, 0]));
  for (const r of rows) {
    if (r.skipped) { console.log(`${r.c.padEnd(6)} ${r.name.padEnd(29)} (skipped: --skip-ai)`); continue; }
    if (r.total == null) { console.log(`${r.c.padEnd(6)} ${r.name.padEnd(29)} NO TOTALS LINE${r.broken ? ' (BROKEN CHECK / exit != 0)' : ''}`); continue; }
    for (const k of [...KINDS, 'total']) tot[k] += r[k];
    console.log(`${r.c.padEnd(6)} ${r.name.padEnd(29)} ${('§' + r.section).padEnd(6)} ${pad(r.DONE, 4)} ${pad(r.HOSTING, 8)} ${pad(r.DECIDED, 8)} ${pad(r.PARTIAL, 8)} ${pad(r['NOT DONE'], 9)}  ${pad(r.total, 3)}${r.broken ? '  BROKEN CHECK' : ''}`);
  }
  console.log(`${'all'.padEnd(6)} ${''.padEnd(29)} ${''.padEnd(6)} ${pad(tot.DONE, 4)} ${pad(tot.HOSTING, 8)} ${pad(tot.DECIDED, 8)} ${pad(tot.PARTIAL, 8)} ${pad(tot['NOT DONE'], 9)}  ${pad(tot.total, 3)}`);
  console.log(`\n${bad ? 'NOT MET' : 'MET'}: every line DONE, HOSTING (Kevin, docs/HOSTING_ACTIONS_FOR_KEVIN.md) or DECIDED (recorded decision)${bad ? ' — see the rows above' : ''}`);
  process.exit(bad ? 1 : 0);
}
