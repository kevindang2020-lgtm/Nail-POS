#!/usr/bin/env node
// check-vi-glossary.mjs — English + Vietnamese POS mandate §28–§37 / §122 (build plan WP-D1, Oct 26 2026). The Vietnamese POS
// uses ONE glossary (docs/i18n/VI_GLOSSARY.md, Kevin's ruling: technician = "Thợ"). This gate keeps the catalogues on it:
//   1. FAIL  — docs/i18n/VI_GLOSSARY.md and apps/pos-web/src/i18n/ns/glossary.{en,vi}.ts list the same keys / English /
//              Vietnamese (the document is what reviewers sign; the namespace is what the app shows).
//   2. FAIL  — a forbidden variant (the glossary's "Forbidden variants" table: "Kỹ thuật viên", "KTV", "hàng đợi",
//              "biên nhận", "thẻ quà" without "tặng", "Dịch vụ xong", …) in any POS Vietnamese catalogue.
//   3. FAIL  — a generated catalogue entry (catalog.en.ts / catalog.vi.ts) whose English IS a glossary term but whose
//              Vietnamese is not the approved term (case follows the English).
//   4. REPORT — the same check for the hand-written namespace files (ns/*.vi.ts): a namespace may use a glossary English
//              word in another sense (a product "Available" is not a technician "Có thể phục vụ"), so it is listed, not failed.
// Not yet registered in tooling/ci/run-gates.mjs (single owner: WP-K) — run it with `node tooling/ci/check-vi-glossary.mjs`.
import { readFileSync, readdirSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const I18N = ROOT + 'apps/pos-web/src/i18n/';
const read = (p) => readFileSync(p, 'utf8');

function pairsOf(body) {
  const out = {};
  const re = /(['"])((?:\\.|(?!\1).)*)\1\s*:\s*(['"`])((?:\\.|(?!\3)[\s\S])*)\3/g;
  let m; while ((m = re.exec(body))) out[m[2]] = m[4].replace(/\\'/g, "'");
  return out;
}
function tsObject(src, name) {
  const start = src.search(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{`));
  if (start < 0) throw new Error(`no ${name}`);
  let i = src.indexOf('{', start), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return pairsOf(src.slice(i + 1, j));
}

const errors = [];
const reports = [];

// 1 — the document and the namespace agree
const doc = read(ROOT + 'docs/i18n/VI_GLOSSARY.md');
const docRows = [...doc.matchAll(/^\|\s*`(glossary\.[\w.]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => ({ key: m[1], en: m[2], vi: m[3] }));
const GEN = tsObject(read(I18N + 'ns/glossary.en.ts'), 'GLOSSARY_EN');
const GVI = tsObject(read(I18N + 'ns/glossary.vi.ts'), 'GLOSSARY_VI');
if (!docRows.length) errors.push('docs/i18n/VI_GLOSSARY.md has no glossary rows');
for (const r of docRows) {
  if (GEN[r.key] !== r.en) errors.push(`glossary ${r.key}: document English "${r.en}" ≠ ns/glossary.en.ts "${GEN[r.key] ?? '(missing)'}"`);
  if (GVI[r.key] !== r.vi) errors.push(`glossary ${r.key}: document Vietnamese "${r.vi}" ≠ ns/glossary.vi.ts "${GVI[r.key] ?? '(missing)'}"`);
}
for (const k of Object.keys(GEN)) if (!docRows.some((r) => r.key === k)) errors.push(`glossary ${k} is in ns/glossary.en.ts but not in docs/i18n/VI_GLOSSARY.md`);

// the forbidden variants (kept here as patterns; the document's table is the human-readable twin)
const FORBIDDEN = [
  [/kỹ thuật viên/i, 'Kỹ thuật viên → Thợ (Kevin\'s ruling)'],
  [/(^|[^\p{L}])KTV($|[^\p{L}])/u, 'KTV → Thợ'],
  [/nhân viên nail|thợ nail/i, 'technician variant → thợ'],
  [/hàng đợi/i, 'hàng đợi → hàng chờ'],
  [/biên nhận/i, 'biên nhận → hóa đơn'],
  [/thẻ quà(?! tặng)/i, 'thẻ quà → thẻ quà tặng'],
  [/dịch vụ xong/i, 'Dịch vụ xong → Hoàn tất dịch vụ'],
];
const EXACT_FORBIDDEN = [[/^nhận thanh toán$/i, 'Take Payment = Thu tiền']];

// every POS Vietnamese catalogue: the generated one + each namespace
const viFiles = [['catalog.vi.ts', 'POS_VI'], ...readdirSync(I18N + 'ns').filter((f) => f.endsWith('.vi.ts')).map((f) => {
  const name = (/export const (\w+_VI)\b/.exec(read(I18N + 'ns/' + f)) || [])[1];
  return ['ns/' + f, name];
}).filter(([, n]) => n)];

// 2 — forbidden variants
for (const [file, name] of viFiles) {
  const vi = tsObject(read(I18N + file), name);
  for (const [k, v] of Object.entries(vi)) {
    for (const [re, why] of FORBIDDEN) if (re.test(v)) errors.push(`${file} ${k}: "${v.slice(0, 70)}" — forbidden variant (${why})`);
    for (const [re, why] of EXACT_FORBIDDEN) if (re.test(v.trim())) errors.push(`${file} ${k}: "${v}" — ${why}`);
  }
}

// 2b — Oct 28 2026 (VietnamesePOS audit): the same forbidden variants in the OTHER apps' Vietnamese text. The Tech app said
// "Chỉ dành cho kỹ thuật viên" because only the POS catalogues were scanned. Every quoted string with Vietnamese letters in
// these files is checked (they mix English and Vietnamese, so a key/value split is not needed for a forbidden-word scan).
const OTHER_VI = [
  'apps/owner-web/src/i18n/catalog.ts', 'apps/owner-web/src/i18n/errors.generated.ts',
  'apps/tech-web/src/i18n/catalog.ts', 'apps/tech-web/src/i18n/errors.generated.ts',
  'apps/manager-pay-web/src/i18n/catalog.ts', 'apps/customer-web/src/i18n/catalog.ts', 'apps/customer-display/src/i18n/messages.ts',
  'packages/mobile-sdk/src/i18n/common.ts', 'packages/mobile-sdk/src/i18n/error-message.ts',
];
let otherStrings = 0;
for (const file of OTHER_VI) {
  let src; try { src = read(ROOT + file); } catch { errors.push(`${file}: missing (listed in check-vi-glossary OTHER_VI)`); continue; }
  for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\n])*)\1/g)) {
    const v = m[2];
    if (!/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(v)) continue;
    otherStrings++;
    for (const [re, why] of FORBIDDEN) if (re.test(v)) errors.push(`${file}: "${v.slice(0, 70)}" — forbidden variant (${why})`);
  }
}

// 3 / 4 — an entry whose English is a glossary term shows the approved Vietnamese
const TERM = new Map();
for (const k of Object.keys(GEN)) if (!TERM.has(GEN[k].toLowerCase())) TERM.set(GEN[k].toLowerCase(), GVI[k]);
const caseLike = (en, vi) => (en === en.toUpperCase() && /[A-Z]/.test(en) ? vi.toUpperCase() : /^[a-z]/.test(en) ? vi[0].toLowerCase() + vi.slice(1) : vi);
// a catalogue key whose English is a glossary word used in ANOTHER sense (reviewed; the glossary term does not apply)
const EXEMPT = new Set([
  'pos.tq_status_break',   // a queue STATUS "Break" — "Nghỉ giải lao" (the glossary "Break" is the noun "Giờ nghỉ")
]);
function checkTerms(file, en, vi, sink) {
  for (const [k, e] of Object.entries(en)) {
    if (EXEMPT.has(k) || k.startsWith('glossary.')) continue;
    const g = TERM.get(e.trim().toLowerCase());
    if (!g || vi[k] == null) continue;
    const want = caseLike(e.trim(), g);
    if (vi[k] !== want) sink.push(`${file} ${k}: English "${e}" is a glossary term — Vietnamese "${vi[k]}" should be "${want}"`);
  }
}
checkTerms('catalog.vi.ts', tsObject(read(I18N + 'catalog.en.ts'), 'POS_EN'), tsObject(read(I18N + 'catalog.vi.ts'), 'POS_VI'), errors);
for (const [file, name] of viFiles.slice(1)) {
  const enFile = file.replace('.vi.ts', '.en.ts');
  const enName = name.replace(/_VI$/, '_EN');
  checkTerms(file, tsObject(read(I18N + enFile), enName), tsObject(read(I18N + file), name), reports);
}

if (reports.length) {
  console.log(`ℹ️  vi-glossary — ${reports.length} namespace label(s) use a glossary English word with another Vietnamese (report only; review the sense):`);
  for (const r of reports.slice(0, 40)) console.log('   ' + r);
  if (reports.length > 40) console.log(`   … and ${reports.length - 40} more`);
}
if (errors.length) {
  console.error(`❌ vi-glossary — ${errors.length} problem(s):`);
  for (const e of errors.slice(0, 40)) console.error('   ' + e);
  if (errors.length > 40) console.error(`   … and ${errors.length - 40} more`);
  console.error('   fix: use the approved term from docs/i18n/VI_GLOSSARY.md (and list the change in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md)');
  process.exit(1);
}
console.log(`✅ vi-glossary — ${docRows.length} glossary terms in step with ns/glossary; no forbidden variant in ${viFiles.length} POS Vietnamese catalogue(s) or ${otherStrings} Vietnamese strings of the other apps; every catalogue glossary term uses the approved Vietnamese`);
