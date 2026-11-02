#!/usr/bin/env node
// check-i18n.mjs — Oct 14 build plan §97 / Phase 13 E (Vietnamese parity), rebuilt Oct 21 2026; POS only since Oct 28 2026. Every EN/VI dictionary
// in the product has the SAME key set, no empty Vietnamese value, and the same {placeholders} per key — a Vietnamese
// guest never meets a blank where an English word was, and a `{name}` the screen fills in is never lost in translation.
// The TypeScript catalogs already type VI against EN's keys; this audit covers the two inline HTML dictionaries (the
// public booking page, the Go check-in kiosk) and the mobile-sdk common catalog, which are plain objects, and re-checks
// the typed ones from the outside so a `as any` can never hide a gap.
import { readFileSync, readdirSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;

/** pull `{ 'key': 'value', ... }` pairs out of a TS/JS object literal body (keys quoted with ' or ") */
function pairsOf(body) {
  const out = {};
  const re = /(['"])((?:\\.|(?!\1).)*)\1\s*:\s*(['"`])((?:\\.|(?!\3)[\s\S])*)\3/g;
  let m; while ((m = re.exec(body))) out[m[2]] = m[4];
  return out;
}
function tsObject(src, name) {
  const start = src.search(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{`));
  if (start < 0) throw new Error(`no ${name}`);
  let i = src.indexOf('{', start), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return pairsOf(src.slice(i + 1, j));
}
// an English plural suffix placeholder ({plural}, {plural2} …) may be left out of a Vietnamese text — Vietnamese has no
// plural ending; every other placeholder must survive translation
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).filter((n) => !/^plural\d*$/.test(n)).sort().join(',');

const SOURCES = [
  // POSLanguage.pdf (Oct 28 2026): ONLY the Front Desk POS is bilingual. The Customer / Technician / Owner / Tap to Pay apps,
  // the Customer Display, the public booking page and the check-in kiosk are English only — they have no Vietnamese to keep
  // in step (check-english-only-apps.mjs fails the build if any comes back). The shared common catalogue is the POS's too.
  { name: 'packages/mobile-sdk/src/i18n/common.ts', load: (s) => [tsObject(s, 'COMMON_EN'), tsObject(s, 'COMMON_VI')] },
  // the POS app (Oct 21 2026): two generated files, EN exact screen text, VI typed against EN's keys
  { name: 'apps/pos-web/src/i18n', file: 'apps/pos-web/src/i18n/catalog.en.ts', load: () => [tsObject(readFileSync(ROOT + 'apps/pos-web/src/i18n/catalog.en.ts', 'utf8'), 'POS_EN'), tsObject(readFileSync(ROOT + 'apps/pos-web/src/i18n/catalog.vi.ts', 'utf8'), 'POS_VI')] },
  // the POS namespace catalogues (Vietnamese POS mandate, WP-B): hand-written semantic keys, one file pair per namespace
  { name: 'apps/pos-web/src/i18n/ns', file: 'apps/pos-web/src/i18n/ns/nav.en.ts', load: () => {
    const dir = ROOT + 'apps/pos-web/src/i18n/ns/', en = {}, vi = {};
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.en.ts'))) {
      const ns = f.slice(0, -'.en.ts'.length), N = ns.toUpperCase();
      Object.assign(en, tsObject(readFileSync(dir + f, 'utf8'), `${N}_EN`));
      Object.assign(vi, tsObject(readFileSync(dir + `${ns}.vi.ts`, 'utf8'), `${N}_VI`));
    }
    return [en, vi];
  } },
];
let bad = 0, keys = 0;
for (const src of SOURCES) {
  let en, vi;
  try { [en, vi] = src.load(readFileSync(ROOT + (src.file ?? src.name), 'utf8'), src.name); } catch (e) { console.error(`❌ ${src.name}: ${e.message}`); bad++; continue; }
  const ek = Object.keys(en), vk = Object.keys(vi);
  if (!ek.length) { console.error(`❌ ${src.name}: no English keys parsed`); bad++; continue; }
  const missing = ek.filter((k) => !(k in vi)), extra = vk.filter((k) => !(k in en));
  const empty = ek.filter((k) => k in vi && !String(vi[k]).trim());
  const ph = ek.filter((k) => k in vi && placeholders(en[k]) !== placeholders(vi[k]));
  for (const [what, list] of [['missing in VI', missing], ['only in VI', extra], ['empty VI', empty], ['placeholder mismatch', ph]]) {
    if (list.length) { console.error(`❌ ${src.name}: ${what}: ${list.slice(0, 8).join(', ')}${list.length > 8 ? ` (+${list.length - 8})` : ''}`); bad++; }
  }
  keys += ek.length;
}
if (bad) process.exit(1);
console.log(`✅ i18n — ${SOURCES.length} POS EN/VI dictionaries, ${keys} keys, Vietnamese complete with matching placeholders`);
