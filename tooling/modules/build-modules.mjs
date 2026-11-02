#!/usr/bin/env node
// build-modules.mjs — build every modules/* workspace in DEPENDENCY order (Constitution 13 §94 allows a module to
// depend on another module's public entry; a fixed list broke the first time one did: deals was built before the
// customers module it imports). Order is derived from each module's package.json; a cycle fails loudly (§105).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODS = join(ROOT, 'modules');
const mods = readdirSync(MODS).filter((m) => existsSync(join(MODS, m, 'package.json')));
const name = (m) => JSON.parse(readFileSync(join(MODS, m, 'package.json'), 'utf8')).name;
const byName = new Map(mods.map((m) => [name(m), m]));
const deps = (m) => Object.keys(JSON.parse(readFileSync(join(MODS, m, 'package.json'), 'utf8')).dependencies ?? {}).filter((d) => byName.has(d)).map((d) => byName.get(d));

const order = []; const state = new Map();
const visit = (m, path = []) => {
  if (state.get(m) === 'done') return;
  if (state.get(m) === 'visiting') throw new Error(`module dependency cycle: ${[...path, m].join(' -> ')}`);
  state.set(m, 'visiting');
  for (const d of deps(m)) visit(d, [...path, m]);
  state.set(m, 'done'); order.push(m);
};
for (const m of mods.sort()) visit(m);

if (process.argv.includes('--print')) { console.log(order.join(' ')); process.exit(0); }
for (const m of order) execFileSync('npm', ['run', 'build', '--workspace', name(m)], { cwd: ROOT, stdio: 'inherit' });
