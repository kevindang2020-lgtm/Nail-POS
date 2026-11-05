#!/usr/bin/env node
// build-packages.mjs — build every packages/* workspace in DEPENDENCY order.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKGS = join(ROOT, 'packages');
const pkgs = readdirSync(PKGS).filter((p) => existsSync(join(PKGS, p, 'package.json')));
const name = (p) => JSON.parse(readFileSync(join(PKGS, p, 'package.json'), 'utf8')).name;
const byName = new Map(pkgs.map((p) => [name(p), p]));
const deps = (p) => Object.keys(JSON.parse(readFileSync(join(PKGS, p, 'package.json'), 'utf8')).dependencies ?? {}).filter((d) => byName.has(d)).map((d) => byName.get(d));

const order = []; const state = new Map();
const visit = (p, path = []) => {
  if (state.get(p) === 'done') return;
  if (state.get(p) === 'visiting') throw new Error(`package dependency cycle: ${[...path, p].join(' -> ')}`);
  state.set(p, 'visiting');
  for (const d of deps(p)) visit(d, [...path, p]);
  state.set(p, 'done'); order.push(p);
};
for (const p of pkgs.sort()) visit(p);

if (process.argv.includes('--print')) { console.log(order.join(' ')); process.exit(0); }
const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
for (const p of order) {
  const tsconfig = join(PKGS, p, 'tsconfig.json');
  if (existsSync(tsconfig)) {
    const tsconfigJson = JSON.parse(readFileSync(tsconfig, 'utf8'));
    if (tsconfigJson.compilerOptions?.noEmit) continue;
    execFileSync(process.execPath, [tsc, '-p', tsconfig], { cwd: ROOT, stdio: 'inherit' });
  }
}
