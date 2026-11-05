#!/usr/bin/env node
// check-app-types.mjs — every web app type-checks (tsc --noEmit with its own tsconfig).
// Oct 6 2026: CI built the apps with Vite (which strips types without checking them) and ran their vitest suites, but
// never ran tsc on them — admin-web's own `npm run build` had been failing at TS7016 with nobody noticing.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPS = ['pos-web', 'admin-web', 'owner-web', 'tech-web', 'customer-web', 'customer-display', 'manager-pay-web'];
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const failed = [];
for (const app of APPS) {
  const r = spawnSync(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.json'], { cwd: join(ROOT, 'apps', app), encoding: 'utf8', timeout: 600_000 });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${app}`);
  if (!ok) { failed.push(app); console.log(((r.stdout || '') + (r.stderr || '')).split('\n').filter(Boolean).slice(0, 8).map((l) => '      ' + l).join('\n')); }
}
console.log(failed.length ? `\napp types: ${failed.length} FAILED (${failed.join(', ')})` : `\napp types: all ${APPS.length} apps type-check`);
process.exit(failed.length ? 1 : 0);
