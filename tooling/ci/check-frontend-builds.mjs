#!/usr/bin/env node
// check-frontend-builds.mjs — every browser app must survive a PRODUCTION build (vite build), not only tsc and vitest.
//
// Oct 6 2026: six of the eight web apps had stopped building — `"isClientAction" is not exported by
// packages/api-contracts/dist/index.js` (and, for admin-web, the same for money and realtime-contracts). Both resolve
// fine under tsc and vitest (Node reads the CommonJS dist), so every gate stayed green while scripts/build-frontends.sh —
// the deploy artifact — failed. Vite's production build does not run the CommonJS transform on a linked workspace
// package; the apps now take those packages from source (tooling/vite/contracts-from-source.mjs and their aliases).
// This builds each app into a throw-away directory and fails on the first error, so that cannot happen silently again.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPS = ['pos-web', 'admin-web', 'owner-web', 'tech-web', 'customer-web', 'customer-display', 'manager-pay-web'];   // the Vite apps (go-check-in-kiosk and -admin are static copies)
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const out = mkdtempSync(join(tmpdir(), 'frontend-builds-'));
const failed = [];
try {
  for (const app of APPS) {
    const cwd = join(ROOT, 'apps', app);
    if (!existsSync(join(cwd, 'vite.config.ts'))) { failed.push(`${app}: no vite.config.ts`); continue; }
    const r = spawnSync(process.execPath, [VITE, 'build', '--outDir', join(out, app), '--emptyOutDir', '--logLevel', 'error'], { cwd, encoding: 'utf8', timeout: 600_000 });
    const ok = r.status === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${app}`);
    if (!ok) { failed.push(app); console.log(((r.stdout || '') + (r.stderr || '')).split('\n').filter((l) => l && !/^\s+at /.test(l)).slice(0, 6).map((l) => '      ' + l).join('\n')); }
  }
} finally { rmSync(out, { recursive: true, force: true }); }
console.log(failed.length ? `\nfrontend builds: ${failed.length} FAILED (${failed.join(', ')})` : `\nfrontend builds: all ${APPS.length} apps build for production`);
process.exit(failed.length ? 1 : 0);
