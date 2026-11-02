#!/usr/bin/env node
// check-admin-english-only.mjs — English + Vietnamese POS mandate (Oct 26 2026, §13 / §93 / §103; build plan WP-K, conflict 6):
// Super Admin (apps/admin-web) stays ENGLISH. It has no i18n runtime, no language switch, the page is lang="en", and no
// Vietnamese text ships in its product code. It gains exactly two tenant-language features, both with an English UI: the
// salon's default POS language control (TenantsScreen — the options read "English" / "Vietnamese") and the optional
// Vietnamese version of a platform announcement that a person writes (PlatformAnnouncementsScreen — Vietnamese input
// fields and a Vietnamese POS preview, marked lang="vi"; the Vietnamese itself is data typed by Super Admin, never source).
//
// Fails on, in apps/admin-web/src (tests excluded) and apps/admin-web/index.html:
//   • an import of an i18n runtime (@aipowersalon/mobile-sdk/i18n, i18next, react-i18next, react-intl, @lingui, a local i18n/ module);
//   • a language switch: setLanguage / useLanguage / changeLanguage / LanguageSwitch / initLanguage, or an assignment to
//     document.documentElement.lang;
//   • index.html whose <html> is not lang="en";
//   • a Vietnamese letter (ă đ ơ ư ĩ ũ and the Vietnamese tone-mark block U+1EA0–U+1EF9) in product code — except the
//     language's own name "Tiếng Việt" (a tenant-language label) and the files in ALLOW below;
//   • a lang attribute other than "en" outside ALLOW.
// Run: node tooling/ci/check-admin-english-only.mjs — part of tooling/ci/run-gates.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = join(ROOT, 'apps/admin-web/src');
/** files where Super Admin AUTHORS / PREVIEWS Vietnamese announcement text (reviewed; English UI around it) */
const ALLOW = new Map([
  ['apps/admin-web/src/screens/PlatformAnnouncementsScreen.tsx', 'WP-F §56–§57: Vietnamese title / message inputs (lang="vi") and the Vietnamese POS preview (lang={shown.language})'],
]);
const VI_LETTER = /[ăđơưĂĐƠƯĩũĨŨẠ-ỹ]/u;
const LANG_NAME = /Tiếng Việt/gu;
const I18N_IMPORT = /\bfrom\s+['"](@aipowersalon\/mobile-sdk\/i18n[^'"]*|i18next|react-i18next|react-intl|@lingui\/[^'"]+|(\.{1,2}\/)+(?:[\w-]+\/)*i18n(\/[^'"]*)?)['"]|\brequire\(\s*['"](i18next|react-intl)['"]/;
const SWITCH = /\b(setLanguage|useLanguage|changeLanguage|initLanguage|LanguageSwitch)\b|document\.documentElement\.lang\s*=(?!=)/;
const LANG_ATTR = /\blang=(?:"([^"]*)"|'([^']*)'|\{)/g;
const IS_TEST = /\.(test|spec)\.[tj]sx?$|\/test\//;

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e); const st = statSync(p);
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== 'dist' && e !== 'test') yield* files(p); }
    else if (/\.(tsx?|css|html)$/.test(e) && !IS_TEST.test(p)) yield p;
  }
}

const problems = [];
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length));
let n = 0;
for (const f of files(SRC)) {
  n++;
  const rel = relative(ROOT, f);
  const code = stripComments(readFileSync(f, 'utf8'));
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (I18N_IMPORT.test(line)) problems.push(`${at}: imports an i18n runtime — Super Admin is English-only`);
    if (SWITCH.test(line)) problems.push(`${at}: language switch (${line.match(SWITCH)[0]}) — Super Admin has no language switch`);
    if (!ALLOW.has(rel)) {
      if (VI_LETTER.test(line.replace(LANG_NAME, ''))) problems.push(`${at}: Vietnamese text in Super Admin product code: ${line.trim().slice(0, 100)}`);
      for (const m of line.matchAll(LANG_ATTR)) { const v = m[1] ?? m[2]; if (v === undefined || v !== 'en') problems.push(`${at}: lang=${v === undefined ? '{…}' : `"${v}"`} — Super Admin pages are lang="en"`); }
    }
  });
}
const html = readFileSync(join(ROOT, 'apps/admin-web/index.html'), 'utf8');
const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] ?? '';
if (!/\blang="en"/.test(htmlTag)) problems.push(`apps/admin-web/index.html: <html> must be lang="en" (found ${htmlTag || 'no <html> tag'})`);
if (VI_LETTER.test(html.replace(LANG_NAME, ''))) problems.push('apps/admin-web/index.html: Vietnamese text');

if (problems.length) {
  console.error(`❌ admin-english-only — ${problems.length} problem(s); Super Admin stays English (mandate §103):`);
  for (const p of problems.slice(0, 40)) console.error('   ' + p);
  if (problems.length > 40) console.error(`   … and ${problems.length - 40} more`);
  process.exit(1);
}
console.log(`✅ admin-english-only — ${n} admin-web files: no i18n runtime, no language switch, index.html lang="en", no Vietnamese outside ${ALLOW.size} reviewed announcement-authoring file(s)`);
