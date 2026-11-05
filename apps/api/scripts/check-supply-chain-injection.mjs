#!/usr/bin/env node
// check-supply-chain-injection.mjs — fails the build if a known code-injection pattern is present (Oct 13 2026).
//
// Why: the developer's Oct 6 2026 tree (Power-Salon-main) carried an obfuscated payload hidden at the end of
// eslint.config.mjs line 35 (thousands of spaces push it off-screen), a new obfuscated `api.js` at the repo root, and
// root package.json `build` / `dev` scripts that ran `node api.js` before the real build. A lint config executes on every
// lint run and when an editor's ESLint extension loads the folder — opening the repo was enough to run it.
// None of it was ever brought into this tree. This gate keeps it that way:
//   R1 a source / config line with a run of 200+ spaces or tabs (code hidden off-screen)
//   R2 javascript-obfuscator identifiers (_0x1a2b…) in tracked source / config
//   R3 the payload's marker `global['!']`
//   R4 a root / workspace package.json script that runs a root-level .js/.mjs/.cjs file, or an install hook
//      (preinstall / install / postinstall / prepare) — none is needed here; an allowlist entry needs a reason
//   R5 a stray root-level .js / .cjs file (configs at the root are .mjs / .ts and reviewed below)
//   R6 editor auto-run tasks (.vscode/tasks.json with runOn: folderOpen)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = join(new URL('.', import.meta.url).pathname, '..', '..', '..');
const SCAN_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|json|ya?ml|sh|html)$/;
const SKIP = /(^|\/)(node_modules|dist|build|coverage|\.harness|android|ios|ios-native|\.git)(\/|$)|\.min\.js$|package-lock\.json$/;
// reviewed root-level scripts that legitimately exist (reason each)
const ROOT_FILES_OK = new Map([
  ['eslint.config.mjs', 'flat ESLint config — scanned line by line by R1–R3'],
]);
const SCRIPT_FILE_OK = new Set([]);   // root scripts allowed to be executed by a package.json script (none)

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];
const add = (rule, file, line, what) => problems.push(`${rule}  ${file}${line ? ':' + line : ''}  ${what}`);

for (const f of tracked) {
  if (SKIP.test(f) || !SCAN_EXT.test(f)) continue;
  const abs = join(ROOT, f);
  if (!existsSync(abs) || statSync(abs).size > 3_000_000) continue;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (/[ \t]{200,}\S/.test(l)) add('R1', f, i + 1, 'code hidden after a long run of whitespace');
    if (/\b_0x[0-9a-f]{4,}\b/.test(l) && !f.startsWith('apps/api/scripts/check-supply-chain-injection')) add('R2', f, i + 1, 'obfuscator identifier (_0x…)');
    if (/global\[\s*['"]!['"]\s*\]/.test(l) && !f.startsWith('apps/api/scripts/check-supply-chain-injection')) add('R3', f, i + 1, "payload marker global['!']");
  });
}

const pkgs = tracked.filter((f) => /(^|\/)package\.json$/.test(f) && !SKIP.test(f));
for (const p of pkgs) {
  let j; try { j = JSON.parse(readFileSync(join(ROOT, p), 'utf8')); } catch { continue; }
  for (const [name, cmd] of Object.entries(j.scripts ?? {})) {
    if (/^(preinstall|install|postinstall|prepare)$/.test(name)) add('R4', p, 0, `install hook "${name}": ${cmd}`);
    if (p === 'package.json') {
      for (const m of String(cmd).matchAll(/\bnode\s+(?:--[^\s]+\s+)*([^\s&|;]+\.(?:m?js|cjs))\b/g)) {
        const target = m[1].replace(/^\.\//, '');
        if (!target.includes('/') && !SCRIPT_FILE_OK.has(target)) add('R4', p, 0, `script "${name}" runs root file ${target}`);
      }
    }
  }
}

for (const f of tracked) {
  if (f.includes('/')) continue;
  if (/\.(js|cjs)$/.test(f) || (/\.mjs$/.test(f) && !ROOT_FILES_OK.has(f))) add('R5', f, 0, 'unreviewed root-level script file');
}

for (const f of tracked.filter((x) => /(^|\/)\.vscode\/tasks\.json$/.test(x))) {
  if (/folderOpen/.test(readFileSync(join(ROOT, f), 'utf8'))) add('R6', f, 0, 'editor task runs on folder open');
}

if (problems.length) {
  console.error(`supply-chain-injection: ${problems.length} finding(s) — see the header of this script for why each matters:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`supply-chain-injection: OK — ${tracked.length} tracked files, ${pkgs.length} package.json files, no hidden code, obfuscation, root-script runner, install hook or editor auto-run`);
