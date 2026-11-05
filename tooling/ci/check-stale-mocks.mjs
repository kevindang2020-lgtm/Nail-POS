#!/usr/bin/env node
// check-stale-mocks.mjs — BUILD_PLAN Phase 13 (Constitution 6 audit bug 12): every relative `vi.mock('./x')` in an app
// test names a module that EXISTS.
//
// Vitest accepts a mock of a path that does not exist (it registers a virtual module), so when a screen stops importing
// a module and the module is deleted or moved, the test keeps "mocking" it and stays green while the real dependency
// runs unmocked. tech-web's LoginScreen and manager-pay's LoginScreen tests mocked removed modules for weeks; the
// Phase 13 sweep found two more (`../hooks/useEscapeKey`, which moved into @aipowersalon/ui). This fails on any such mock.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

function* walk(d) {
  for (const f of readdirSync(d)) {
    if (f === 'node_modules' || f === 'dist' || f.startsWith('.')) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(test|spec)\.(tsx?|jsx?|mjs)$/.test(f)) yield p;
  }
}

/** Relative mock targets in `source` that resolve to no file next to `file`. Exported for the gate's own test. */
export function staleMocks(file, source, exists = (p) => existsSync(p) && statSync(p).isFile()) {
  const out = [];
  for (const m of source.matchAll(/vi\.(?:mock|doMock)\(\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = resolve(dirname(file), m[1]);
    if (!EXT.some((e) => exists(base + e))) out.push(m[1]);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const bad = [];
  let files = 0;
  for (const top of ['apps', 'packages', 'modules']) {
    for (const a of readdirSync(join(ROOT, top))) {
      const src = join(ROOT, top, a, 'src');
      if (!existsSync(src)) continue;
      for (const f of walk(src)) {
        files++;
        for (const target of staleMocks(f, readFileSync(f, 'utf8'))) bad.push(`${f.slice(ROOT.length + 1)}: vi.mock('${target}') — no such module`);
      }
    }
  }
  for (const b of bad) console.log('  ' + b);
  console.log(bad.length ? `stale mocks: ${bad.length} FAILED` : `stale mocks: none in ${files} test files`);
  process.exit(bad.length ? 1 : 0);
}
