#!/usr/bin/env node
// check-ns-collisions.mjs — POS i18n namespaces must never share a key (ns/index.ts rule: keys are '<ns>.<area>.<item>'
// "so namespaces never collide"). registerCatalog() merges every namespace into ONE map, so a key defined twice is
// silently won by whichever file registers last — Oct 31 2026: the Phone Number Management namespace reused 'pm.*'
// and turned the Phone & Caller ID dashboard's Vietnamese title into "Quản lý số điện thoại". Fails on ANY key that
// two namespace files of the same language define, even with an identical value (the second owner is still a bug).
//   node --experimental-strip-types tooling/i18n/check-ns-collisions.mjs
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const NS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'pos-web', 'src', 'i18n', 'ns');
let bad = 0;
for (const lang of ['en', 'vi']) {
  const owner = new Map();
  for (const f of readdirSync(NS).filter((n) => n.endsWith(`.${lang}.ts`)).sort()) {
    const mod = await import(pathToFileURL(join(NS, f)).href);
    for (const cat of Object.values(mod)) {
      if (!cat || typeof cat !== 'object') continue;
      for (const k of Object.keys(cat)) {
        const prev = owner.get(k);
        if (prev && prev !== f) { bad++; console.error(`  ${lang}: "${k}" is defined by both ${prev} and ${f}`); }
        else owner.set(k, f);
      }
    }
  }
  console.log(`check:i18n-ns-collisions ${lang}: ${owner.size} keys across ${readdirSync(NS).filter((n) => n.endsWith(`.${lang}.ts`)).length} namespace files`);
}
if (bad) { console.error(`check:i18n-ns-collisions FAILED — ${bad} key(s) owned by two namespaces; give the newer namespace its own prefix`); process.exit(1); }
console.log('check:i18n-ns-collisions OK');
