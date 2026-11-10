#!/usr/bin/env node
// check-english-only-apps.mjs — POSLanguage.pdf (Oct 28 2026, the authoritative language-scope mandate) §1 / §20 / §21 / §36:
//
//   FRONT DESK POS = ENGLISH + TIẾNG VIỆT · EVERY OTHER APPLICATION / CUSTOMER SURFACE = ENGLISH ONLY
//
// The English-only rule is enforced at each application's BOOTSTRAP, not by a hidden toggle. This gate fails the build when
// an English-only application could show Vietnamese again. Super Admin has its own gate (check-admin-english-only.mjs).
//
//   Customer / Technician / Owner / Tap to Pay apps (customer-web, tech-web, owner-web, manager-pay-web):
//     • src/main.tsx's FIRST import is './language-policy', and that file applies APPLICATION_LOCALE_POLICY.<its app>;
//     • no Vietnamese catalogue (`export const *_VI`, registerCatalog('vi', …)) and no language switch (setLanguage,
//       useLanguage, changeLanguage, LanguageSwitch) in product code; no import of the POS language layer;
//     • no Vietnamese letters in product code (comments stripped; Vietnamese user data lives in the database, not here);
//     • index.html is lang="en".
//   Customer Display: DISPLAY_LANGUAGES is exactly ['en'], no Vietnamese catalogue, no Vietnamese letters, lang="en".
//   Online booking page / check-in kiosk (plain HTML): the dictionary has only 'en', no Vietnamese letters, no browser-
//     language detection, lang="en".
//   Contracts: APPLICATION_LOCALE_POLICY gives 'vi' to FRONT_DESK_POS only; customerMessageLanguage() answers English.
//   Shared layer: packages/mobile-sdk i18n keeps setLanguagePolicy and refuses a catalogue / switch the policy forbids.
//   AI phone receptionist: the voice provider always speaks English; the POS offers no other receptionist language.
//
// Run: node tooling/ci/check-english-only-apps.mjs — part of tooling/ci/run-gates.mjs.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VI_LETTER = /[ăđơưĂĐƠƯĩũĨŨẠ-ỹ]/u;
const IS_TEST = /\.(test|spec)\.[tj]sx?$|\/test\//;
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length));
const problems = [];
let scanned = 0;

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e); const st = statSync(p);
    if (st.isDirectory()) { if (!['node_modules', 'dist', 'test', 'android', 'ios'].includes(e)) yield* files(p); }
    else if (/\.(tsx?|jsx?)$/.test(e) && !IS_TEST.test(p)) yield p;
  }
}
function htmlLangEn(file) {
  const tag = /<html\b[^>]*>/i.exec(read(file))?.[0] ?? '';
  if (!/\blang="en"/.test(tag)) problems.push(`${file}: <html> must be lang="en" (found ${tag || 'no <html> tag'})`);
}
function scanProductCode(app, rules) {
  for (const f of files(join(ROOT, `apps/${app}/src`))) {
    scanned++;
    const rel = relative(ROOT, f);
    const lines = stripComments(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      const at = `${rel}:${i + 1}`;
      for (const [re, why] of rules) if (re.test(line)) problems.push(`${at}: ${why} — ${line.trim().slice(0, 100)}`);
      if (VI_LETTER.test(line)) problems.push(`${at}: Vietnamese text in an English-only app — ${line.trim().slice(0, 100)}`);
    });
  }
}

// ── the four mobile-sdk apps ──────────────────────────────────────────────────────────────────────────────────────────────
const MOBILE = [['customer-web', 'CUSTOMER_APP'], ['tech-web', 'TECHNICIAN_APP'], ['owner-web', 'OWNER_APP'], ['manager-pay-web', 'TAP_TO_PAY_APP']];
const MOBILE_RULES = [
  [/\bexport\s+const\s+\w+_VI\b/, 'a Vietnamese catalogue'],
  [/registerCatalog\(\s*['"]vi['"]/, "registerCatalog('vi', …)"],
  [/\b(setLanguage|useLanguage|changeLanguage|LanguageSwitch)\s*\(/, 'a language switch'],
  [/from\s+['"][^'"]*(pos-web|pos-language)[^'"]*['"]/, 'imports the POS language layer'],
];
for (const [app, id] of MOBILE) {
  const main = `apps/${app}/src/main.tsx`;
  const first = stripComments(read(main)).split('\n').map((l) => l.trim()).find((l) => l.startsWith('import '));
  if (!/^import\s+['"]\.\/language-policy['"]/.test(first ?? '')) problems.push(`${main}: the FIRST import must be './language-policy' (found: ${first ?? 'none'})`);
  const pol = `apps/${app}/src/language-policy.ts`;
  if (!existsSync(join(ROOT, pol))) problems.push(`${pol}: missing — the app's English-only bootstrap`);
  else if (!new RegExp(`setLanguagePolicy\\(\\s*APPLICATION_LOCALE_POLICY\\.${id}\\s*\\)`).test(stripComments(read(pol)))) problems.push(`${pol}: must call setLanguagePolicy(APPLICATION_LOCALE_POLICY.${id})`);
  scanProductCode(app, MOBILE_RULES);
  htmlLangEn(`apps/${app}/index.html`);
}

// ── Customer Display ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const msgs = stripComments(read('apps/customer-display/src/i18n/messages.ts'));
  if (!/export const DISPLAY_LANGUAGES = \['en'\] as const;/.test(msgs)) problems.push("apps/customer-display/src/i18n/messages.ts: DISPLAY_LANGUAGES must be exactly ['en']");
  scanProductCode('customer-display', [[/\bexport\s+const\s+VI\b/, 'a Vietnamese catalogue']]);
  htmlLangEn('apps/customer-display/index.html');
}

// ── plain-HTML customer pages ────────────────────────────────────────────────────────────────────────────────────────────
for (const page of ['apps/booking-public/index.html', 'apps/go-check-in-kiosk/index.html', 'apps/go-check-in-kiosk/www/index.html']) {
  const src = read(page);
  scanned++;
  const m = /const I18N = (\{[\s\S]*?\});\s*$/m.exec(src);
  let langs = null; try { langs = m ? Object.keys(JSON.parse(m[1])) : null; } catch { langs = null; }
  if (!langs || langs.join(',') !== 'en') problems.push(`${page}: the dictionary must have English only (found: ${langs ? langs.join(', ') : 'unreadable'})`);
  if (VI_LETTER.test(src)) problems.push(`${page}: Vietnamese text on an English-only customer page`);
  if (/navigator\.language/.test(src)) problems.push(`${page}: browser-language detection on an English-only page`);
  htmlLangEn(page);
}

// ── contracts + the shared layer ─────────────────────────────────────────────────────────────────────────────────────────
{
  const lang = read('packages/api-contracts/src/language.ts');
  const block = /APPLICATION_LOCALE_POLICY[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(lang)?.[1] ?? '';
  const rows = [...block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map((r) => [r[1], r[2]]);
  if (!rows.length) problems.push('packages/api-contracts/src/language.ts: APPLICATION_LOCALE_POLICY not found');
  for (const [app, list] of rows) {
    const vi = /['"]vi['"]/.test(list);
    if (app === 'FRONT_DESK_POS' && !vi) problems.push('APPLICATION_LOCALE_POLICY.FRONT_DESK_POS must keep Vietnamese');
    if (app !== 'FRONT_DESK_POS' && vi) problems.push(`APPLICATION_LOCALE_POLICY.${app} must be English only`);
  }
  if (!/export function customerMessageLanguage\([^)]*\): AppLanguage \{\s*return DEFAULT_LANGUAGE;/.test(lang)) problems.push('packages/api-contracts/src/language.ts: customerMessageLanguage() must answer English (DEFAULT_LANGUAGE)');
  const sdk = read('packages/mobile-sdk/src/i18n/i18n.ts');
  if (!/export function setLanguagePolicy\(/.test(sdk) || !/registerCatalog\([^)]*\): void \{[^}]*if \(!permitted\(lang\)\) return;/.test(sdk) || !/!permitted\(l\)\) return;/.test(sdk)) problems.push('packages/mobile-sdk/src/i18n/i18n.ts: the language policy (setLanguagePolicy / permitted guards) was removed');
}

// ── the AI phone receptionist (Kevin, Oct 28 2026): English only ─────────────────────────────────────────────────────────
{
  const prov = stripComments(read('modules/ai/src/voice-booking/retell-voice.provider.ts'));
  if (/['"](es-ES|vi-VN)['"]/.test(prov) || !/VOICE_RECEPTIONIST_LOCALE/.test(prov)) problems.push('modules/ai/src/voice-booking/retell-voice.provider.ts: the AI receptionist must always speak VOICE_RECEPTIONIST_LOCALE (English)');
  for (const f of ['apps/pos-web/src/screens/POSAISettingsScreen.tsx', 'apps/pos-web/src/screens/POSAIFrontDeskScreen.tsx']) {
    if (/<option value="(es|vi)">/.test(read(f))) problems.push(`${f}: offers a receptionist language other than English`);
  }
}

// ── what customers receive (Kevin, Nov 9 2026: "all the apps and customers are in English because they are Americans") ──
// The unused Vietnamese receipt / reminder / notice / review-request / reschedule wording was deleted; it may not return.
{
  const CUSTOMER_TEXT = [
    'modules/checkout/src/checkout/checkout-receipt-text.ts',
    'modules/communications/src/reminders/reminder-core.ts',
    'modules/communications/src/reminders/reminders.service.ts',
    'packages/api-contracts/src/customer-notification-text.ts',
    'modules/ai/src/ai-review-reputation/ai-review-reputation.integrations.ts',
    'modules/ai/src/ai-scheduling-optimizer/ai-scheduling-proposals.ts',
    'modules/memberships/src/membership-comms-core.ts',
    'modules/booking/src/customer-phone/customer-phone-notify.ts',
  ];
  for (const f of CUSTOMER_TEXT) {
    if (!existsSync(join(ROOT, f))) { problems.push(`${f}: missing — update the customer-text list`); continue; }
    stripComments(read(f)).split('\n').forEach((line, i) => {
      if (VI_LETTER.test(line)) problems.push(`${f}:${i + 1}: Vietnamese text in a customer message — ${line.trim().slice(0, 100)}`);
      if (/['"`]vi-VN['"`]/.test(line)) problems.push(`${f}:${i + 1}: Vietnamese date format in a customer message`);
    });
  }
  // AI prose: Vietnamese only when the request comes from the web POS (X-Client-Type: pos)
  const res = stripComments(read('modules/ai/src/ai/ai-response-language.ts'));
  if (!/export function isFrontDeskPosRequest\(/.test(res) || !/if \(!this\.isPos\(\)\) return 'en';/.test(res)) problems.push("modules/ai/src/ai/ai-response-language.ts: AI prose must be English outside the web POS (isFrontDeskPosRequest guard removed)");
}

if (problems.length) {
  console.error(`❌ english-only-apps — ${problems.length} problem(s). Only the Front Desk POS is bilingual (POSLanguage.pdf):`);
  for (const p of problems.slice(0, 50)) console.error('   ' + p);
  if (problems.length > 50) console.error(`   … and ${problems.length - 50} more`);
  process.exit(1);
}
console.log(`✅ english-only-apps — ${scanned} files in 5 apps + 3 customer pages: English-only bootstrap in place, no Vietnamese catalogue, switch or text outside the Front Desk POS; contracts English-only for customers`);
