#!/usr/bin/env node
// pos-codemod.mjs — Oct 21 2026 (Kevin: "Build Vietnamese for the POS"): puts every English JSX text and read-attribute
// of the POS app behind t('key'), and writes the English catalogue from the EXACT text each screen showed, so switching
// nothing changes nothing (every existing POS test keeps asserting today's English).
//
//   node tooling/i18n/pos-codemod.mjs [--write] [--only <path-substring>]
//
// Rules:
//   • a key is derived from the English text itself (pos.<slug>), so the same words share ONE translation everywhere;
//     a slug that would collide with a different text gets a numeric suffix;
//   • JSX text → {t('key')}; the whitespace JSX would have kept next to an expression on the same line is kept as {' '};
//   • title / placeholder / aria-label / alt / aria-description string attributes → attr={t('key')};
//   • `t` is the module-level function from @aipowersalon/mobile-sdk/i18n (imported where missing); the app remounts its
//     tree on a language switch (POSLayout key={language}), so no hook has to be threaded into 260 files;
//   • the catalogue files are REGENERATED from scratch: apps/pos-web/src/i18n/catalog.en.ts (exact English) and the VI
//     file is merged — existing Vietnamese for a key is kept, new keys are added with an empty value the check-i18n audit
//     will refuse until translated.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { scanAll, decodeEntities, allFiles } from './pos-strings.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const WRITE = process.argv.includes('--write');
// Vietnamese POS mandate (Oct 26 2026, build plan §2 rule 1, WP-K): catalog.en.ts / catalog.vi.ts are FROZEN — Kevin
// approved the existing Vietnamese on Oct 26 and the 8,900 generated keys are never re-keyed or regenerated. New POS keys
// are hand-written semantic keys in apps/pos-web/src/i18n/ns/<ns>.{en,vi}.ts. This codemod may still run as a dry-run
// report; it refuses to write.
if (WRITE) {
  console.error('pos-codemod: refused — the generated POS catalogue is frozen (Vietnamese POS mandate, WP-K). Put new text behind t(\'<ns>.<area>.<item>\') with the key in apps/pos-web/src/i18n/ns/<ns>.en.ts + .vi.ts.');
  process.exit(2);
}
const onlyIdx = process.argv.indexOf('--only'); const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;
const I18N_DIR = join(ROOT, 'apps/pos-web/src/i18n');
const EN_FILE = join(I18N_DIR, 'catalog.en.ts'), VI_FILE = join(I18N_DIR, 'catalog.vi.ts');

/** pos.<slug>: lower-case words of the text, max 6 words; a hash tail keeps long texts apart */
export function slugOf(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const base = words.slice(0, 6).join('_') || 'text';
  if (words.length > 6 || text.length > 48) { let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `pos.${base}_${h.toString(36).slice(0, 4)}`; }
  return `pos.${base}`;
}

/** read an existing catalogue file: `'key': 'value',` lines */
function readCatalog(file) {
  if (!existsSync(file)) return {};
  const out = {}; const re = /^\s*'((?:\\.|[^'\\])*)': '((?:\\.|[^'\\])*)',\s*(?:\/\/.*)?$/gm; let m;
  const src = readFileSync(file, 'utf8');
  while ((m = re.exec(src))) out[m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  return out;
}
const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`;

const allStrings = scanAll();
// labels the API sends verbatim (src/i18n/server-labels.ts) get keys too, so serverText() can translate them
{ const f = join(I18N_DIR, 'server-labels.ts'); if (existsSync(f)) { const re = /^\s*'((?:\\.|[^'\\])*)',\s*$/gm; let m; const src = readFileSync(f, 'utf8'); while ((m = re.exec(src))) allStrings.push({ file: 'apps/pos-web/src/i18n/server-labels.ts', kind: 'server', text: m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') }); } }
const referenced = new Set();
{ const re = /\b(?:t|tx|i18nText)\(\s*'((?:\\.|[^'\\])*)'/g; for (const f of allFiles()) { const src = readFileSync(f, 'utf8'); let m; while ((m = re.exec(src))) referenced.add(m[1].replace(/\\'/g, "'")); } }
const usedByT = (text) => { const k = Object.entries(existingEn).find(([, v]) => v === text)?.[0]; return !!k && referenced.has(k); };
const strings = allStrings.filter((s) => s.kind !== 'server' && (!ONLY || s.file.includes(ONLY)));
const present = new Set(allStrings.filter((s) => s.kind !== 'plural').map((s) => s.text));
// key assignment: text → key (stable: same text = same key; collisions get -2, -3 …)
const keyOf = new Map(); const used = new Map();
const existingEn = readCatalog(EN_FILE);
for (const [k, v] of Object.entries(existingEn)) { if (present.has(v) || usedByT(v)) { keyOf.set(v, k); used.set(k, v); } }   // keep today's keys for text still shown
for (const s of allStrings) {
  if (s.kind === 'plural') continue;
  if (keyOf.has(s.text)) continue;
  let k = slugOf(s.text), n = 2; while (used.has(k) && used.get(k) !== s.text) k = `${slugOf(s.text)}_${n++}`;
  keyOf.set(s.text, k); used.set(k, s.text);
}

// rewrite each file, from the END so positions stay valid
const byFile = new Map(); for (const s of strings) { if (!byFile.has(s.file)) byFile.set(s.file, []); byFile.get(s.file).push(s); }
let filesChanged = 0, replaced = 0;
for (const [rel, list] of byFile) {
  const abs = join(ROOT, rel); let src = readFileSync(abs, 'utf8');
  // a file that already binds `t` (a totals object, a loop variable…) gets the function under the name `tr`
  const sf0 = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bound = new Set();
  const findBound = (n) => { if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isImportSpecifier(n) || ts.isImportClause(n)) && n.name && ts.isIdentifier(n.name)) bound.add(n.name.text); ts.forEachChild(n, findBound); };
  findBound(sf0);
  // a file that already imports the function (the first pass) keeps using that local name
  let imported = null;
  for (const st of sf0.statements) { if (ts.isImportDeclaration(st) && st.moduleSpecifier.text === '@aipowersalon/mobile-sdk/i18n' && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) { for (const el of st.importClause.namedBindings.elements) if ((el.propertyName ?? el.name).text === 't') imported = el.name.text; } }
  const T = imported ?? ['t', 'tx', 'i18nText'].find((c) => !bound.has(c));
  const edits = [];
  for (const s of list) {
    const key = keyOf.get(s.text);
    if (s.kind === 'plural') {
      edits.push({ pos: s.pos, end: s.end, build: (slice) => `enPlural(${slice(s.pos, s.end)})`, plural: true });
      continue;
    }
    if (s.kind === 'tpl') {
      // `…${expr}…` → T('key', { name: String(expr), … }); the expressions are read from the CURRENT source so a string
      // inside them that this pass also translated keeps its own edit (inner edits are applied first, see below)
      edits.push({ pos: s.pos, end: s.end, build: (slice) => `${T}(${q(key)}, { ${s.vars.map((v) => `${v.name}: String(${slice(v.start, v.end)})`).join(', ')} })` });
    } else if (s.kind === 'cattr') {
      const before = src.slice(Math.max(0, s.pos - 1), s.pos);
      edits.push({ pos: s.pos, end: s.end, text: before === '{' ? `${T}(${q(key)})` : `{${T}(${q(key)})}` });
    } else if (s.kind === 'prop' || s.kind === 'array' || s.kind === 'call' || s.kind === 'expr') {
      edits.push({ pos: s.pos, end: s.end, text: `${T}(${q(key)})` });   // the string literal (quotes included) → t('key')
    } else if (s.kind === 'attr') {
      // the string literal node (quotes included) → {t('key')}; if it sat inside a JsxExpression `={'x'}` the braces are already there
      const before = src.slice(Math.max(0, s.pos - 1), s.pos);
      const inBraces = before === '{';
      edits.push({ pos: s.pos, end: s.end, text: inBraces ? `${T}(${q(key)})` : `{${T}(${q(key)})}` });
    } else {
      // JSX text: keep the whitespace JSX keeps (a space on the same line as the text, touching an expression)
      const raw = src.slice(s.pos, s.end);
      const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
      const core = raw.slice(lead.length, raw.length - trail.length);
      if (decodeEntities(core).replace(/\s+/g, ' ').trim() !== s.text) continue;   // (should not happen) never rewrite what we did not scan
      const keepLead = lead.length > 0 && !lead.includes('\n') ? "{' '}" : lead;
      const keepTrail = trail.length > 0 && !trail.includes('\n') ? "{' '}" : trail;
      edits.push({ pos: s.pos, end: s.end, text: `${keepLead}{${T}(${q(key)})}${keepTrail}` });
    }
  }
  // applied from the END; an edit that CONTAINS earlier-applied edits (a template whose ${…} held a translated string)
  // maps its original offsets through their length changes
  edits.sort((a, b) => b.pos - a.pos || a.end - b.end);
  const applied = [];
  const mapPos = (p) => p + applied.reduce((d, a) => (a.end <= p ? d + a.delta : d), 0);
  for (const e of edits) {
    const end = mapPos(e.end);
    const text = e.build ? e.build((a, b) => src.slice(mapPos(a), mapPos(b))) : e.text;
    src = src.slice(0, e.pos) + text + src.slice(end);
    applied.push({ pos: e.pos, end: e.end, delta: text.length - (end - e.pos) });
    replaced++;
  }
  if (edits.some((e) => e.plural) && !/\benPlural\b[^(]/.test(src.split('\n').filter((l) => l.startsWith('import')).join('\n'))) {
    if (/import \{[^}]*\} from '@aipowersalon\/mobile-sdk\/i18n';/.test(src)) src = src.replace(/import \{([^}]*)\} from '@aipowersalon\/mobile-sdk\/i18n';/, (m, names) => `import {${names.replace(/\s*$/, '')}, enPlural } from '@aipowersalon/mobile-sdk/i18n';`);
    else { const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let lastImportEnd = 0; for (const st of sf.statements) { if (ts.isImportDeclaration(st)) lastImportEnd = st.getEnd(); else break; } src = src.slice(0, lastImportEnd) + "\nimport { enPlural } from '@aipowersalon/mobile-sdk/i18n';" + src.slice(lastImportEnd); }
  }
  if (edits.some((e) => !e.plural) && !imported && /from '@aipowersalon\/mobile-sdk\/i18n'/.test(src) && !new RegExp(`import \\{[^}]*\\b(t|t as ${T})\\b[^}]*\\} from '@aipowersalon/mobile-sdk/i18n'`).test(src)) {
    // the file imports other names from the i18n module (useLanguage …) but not t → add it to that import
    src = src.replace(/import \{([^}]*)\} from '@aipowersalon\/mobile-sdk\/i18n';/, (m, names) => `import {${names.replace(/\s*$/, '')}, ${T === 't' ? 't' : `t as ${T}`} } from '@aipowersalon/mobile-sdk/i18n';`);
  } else if (edits.some((e) => !e.plural) && !/from '@aipowersalon\/mobile-sdk\/i18n'/.test(src)) {
    // add the import after the last import line
    const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let lastImportEnd = 0; for (const st of sf.statements) { if (ts.isImportDeclaration(st)) lastImportEnd = st.getEnd(); else break; }
    const line = T === 't' ? "import { t } from '@aipowersalon/mobile-sdk/i18n';" : `import { t as ${T} } from '@aipowersalon/mobile-sdk/i18n';`;
    src = lastImportEnd ? src.slice(0, lastImportEnd) + '\n' + line + src.slice(lastImportEnd) : line + '\n' + src;
  }
  if (edits.length) { filesChanged++; if (WRITE) writeFileSync(abs, src); }
}

// catalogues
const en = {}; for (const [text, key] of keyOf) en[key] = text;
const keys = Object.keys(en).sort();
const header = (what) => `// ${what} — GENERATED by tooling/i18n/pos-codemod.mjs (Oct 21 2026, Kevin: "Build Vietnamese for the POS").\n// Keys are derived from the English text; the same words share one key everywhere in the POS. Every English value is the\n// EXACT text the screen showed before the key existed. Do not edit the English by hand — change the screen and re-run\n// the codemod; edit the Vietnamese freely (the check-i18n audit refuses an empty or missing translation).\n`;
const enSrc = header('catalog.en.ts — the POS app\'s English') + `export const POS_EN = {\n${keys.map((k) => `  ${q(k)}: ${q(en[k])},`).join('\n')}\n};\n`;
const existingVi = readCatalog(VI_FILE);
const viSrc = header('catalog.vi.ts — the POS app\'s Vietnamese') + `import type { POS_EN } from './catalog.en';\nexport const POS_VI: Record<keyof typeof POS_EN, string> = {\n${keys.map((k) => `  ${q(k)}: ${q(existingVi[k] ?? '')},`).join('\n')}\n};\n`;
if (WRITE) { mkdirSync(I18N_DIR, { recursive: true }); writeFileSync(EN_FILE, enSrc); writeFileSync(VI_FILE, viSrc); }
const untranslated = keys.filter((k) => !existingVi[k]).length;
console.log(`${WRITE ? 'wrote' : 'would write'}: ${replaced} replacements in ${filesChanged} files; catalogue ${keys.length} keys (${untranslated} without Vietnamese)`);
