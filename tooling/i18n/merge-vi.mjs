#!/usr/bin/env node
// merge-vi.mjs — fills apps/pos-web/src/i18n/catalog.vi.ts from JSON batches { key: vietnamese } (Oct 21 2026).
//   node tooling/i18n/merge-vi.mjs <batch.json> [...more]
// A key the English catalogue does not have is reported and skipped; an existing non-empty value is overwritten only
// when the batch gives a non-empty one; placeholders {name} must match the English (the check-i18n audit enforces it).
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const EN_FILE = ROOT + 'apps/pos-web/src/i18n/catalog.en.ts', VI_FILE = ROOT + 'apps/pos-web/src/i18n/catalog.vi.ts';
const read = (file) => { const out = {}; const re = /^\s*'((?:\\.|[^'\\])*)': '((?:\\.|[^'\\])*)',\s*(?:\/\/.*)?$/gm; let m; const src = readFileSync(file, 'utf8'); while ((m = re.exec(src))) out[m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\'); return out; };
const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const en = read(EN_FILE), vi = read(VI_FILE);
let added = 0, unknown = 0, bad = 0;
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).filter((n) => !/^plural\d*$/.test(n)).sort().join(",");   // {plural…} may be omitted in Vietnamese
for (const f of process.argv.slice(2)) {
  const batch = JSON.parse(readFileSync(f, 'utf8'));
  for (const [k, v] of Object.entries(batch)) {
    if (!(k in en)) { unknown++; console.error(`  unknown key: ${k}`); continue; }
    if (!String(v).trim()) continue;
    if (ph(en[k]) !== ph(v)) { bad++; console.error(`  placeholder mismatch: ${k}: ${en[k]} → ${v}`); continue; }
    if (!vi[k]) added++; vi[k] = String(v);
  }
}
const keys = Object.keys(en).sort();
const header = readFileSync(VI_FILE, 'utf8').split('export const POS_VI')[0];
writeFileSync(VI_FILE, header + `export const POS_VI: Record<keyof typeof POS_EN, string> = {\n${keys.map((k) => `  ${q(k)}: ${q(vi[k] ?? '')},`).join('\n')}\n};\n`);
const left = keys.filter((k) => !vi[k]).length;
console.log(`merged: +${added} translations (${unknown} unknown keys, ${bad} placeholder mismatches); ${keys.length - left}/${keys.length} translated, ${left} left`);
