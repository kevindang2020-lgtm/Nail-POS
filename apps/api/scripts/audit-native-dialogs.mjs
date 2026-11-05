/* audit-native-dialogs.mjs — the gate that keeps the OS out of the salon's UI.
 *
 * == WHY THIS EXISTS =======================================================================================
 *
 * On Jul 27, 2026 every `window.prompt` (29 sites) and `window.confirm` (22 sites) across all five frontends was
 * replaced by the in-app `useInlineAsk` / `useInlineConfirm` dialogs. That was not a cosmetic pass:
 *
 *   • Two screens (POS Devices, POS APIs & Webhooks) carried a helper that returned **true** when
 *     `window.confirm` was unavailable — so in any environment without the native dialog, "Revoke device",
 *     "Revoke API key" and "Rotate signing secret" executed with NO confirmation at all.
 *   • On a locked-down ASUS kiosk or an iPad web-app, native dialogs can be restyled unpredictably or suppressed
 *     outright, which lets a destructive action fire — or silently not fire — with nothing shown to the person.
 *   • A native prompt cannot enforce the rules the actions need: a required reason, a 3-character minimum, an
 *     optional-vs-required distinction. Those rules were being enforced (or quietly dropped) by hand at each site.
 *
 * A single `window.confirm(...)` added back in a hurry re-opens all three holes at once, and nothing else in the
 * test suite would notice: dialogs are stubbed in tests, so a native call passes green.
 *
 * == WHAT IT CHECKS ========================================================================================
 *
 * No `window.prompt` / `window.confirm` / `window.alert` (or bare `prompt(` / `confirm(` / `alert(` calls) in any
 * frontend source file. Excluded, deliberately:
 *
 *   • test files            — a test may legitimately spy on window.confirm to prove it is NOT called
 *   • the dialog components — InlineAsk / InlineConfirm define the replacements
 *
 * Use `useInlineAsk()` for text input and `useInlineConfirm()` for yes/no. Both preserve the semantics the old
 * sites had: required by default, `{ optional: true }` where the original allowed an empty answer,
 * `{ minLength: n }` where it enforced a minimum, `{ destructive: false }` for non-destructive confirmations.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APPS = ['pos-web', 'admin-web', 'owner-web', 'tech-web', 'customer-web', 'manager-pay-web', 'customer-display'];  // manager-pay + display added Jul 29 — they were invisible to this gate (found via a live window.prompt)
const ROOT = resolve(process.cwd(), '..');
// Constitution 13: code moved into packages/ must not leave the gate's view — scan every package's src too.
for (const p of (await import('node:fs')).readdirSync(resolve(ROOT, '..', 'packages'))) APPS.push(`../packages/${p}`);
const EXEMPT_FILES = /(InlineAsk|InlineConfirm)\.tsx$/;
const IS_TEST = /\.(test|spec)\.[tj]sx?$/;

// `window.x(` and bare `x(` — the bare form must not match `.confirm(`, `askConfirm(`, `confirmEditor(` etc.
const PATTERNS = [
  { name: 'prompt', re: /(?<![.\w])(?:window\s*\.\s*)?prompt\s*\(/g },
  { name: 'confirm', re: /(?<![.\w])(?:window\s*\.\s*)?confirm\s*\(/g },
  { name: 'alert', re: /(?<![.\w])(?:window\s*\.\s*)?alert\s*\(/g },
];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walk(p, out); }
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** Blank out comments and string/template literals so prose can't look like code.
 *  ("… ${r.count} alert(s) marked read." is not a call to alert(); "// two-step inline confirm" is not confirm().)
 *  Replacing with same-length spaces keeps every line/column offset intact for accurate reporting. */
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const blank = (n) => ' '.repeat(n);
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') { const end = src.indexOf('\n', i); const stop = end === -1 ? src.length : end; out += blank(stop - i); i = stop; continue; }
    if (two === '/*') { const end = src.indexOf('*/', i + 2); const stop = end === -1 ? src.length : end + 2; out += src.slice(i, stop).replace(/[^\n]/g, ' '); i = stop; continue; }
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (c === '`' && src.slice(j, j + 2) === '${') { depth++; j += 2; continue; }
        if (c === '`' && depth > 0 && src[j] === '}') { depth--; j++; continue; }
        if (src[j] === c && depth === 0) { j++; break; }
        j++;
      }
      out += src.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** A file that defines its own `confirm` / `alert` / `prompt` is not calling the browser's. */
function locallyDefined(src, name) {
  return new RegExp(`(?:const|let|var|function|async function)\\s+${name}\\b|\\b${name}\\s*[,}]\\s*=|\\{[^}\\n]*\\b${name}\\s*[:,][^}\\n]*\\}\\s*=`).test(src);
}

const findings = [];
for (const app of APPS) {
  for (const file of walk(join(ROOT, app, 'src'))) {
    if (IS_TEST.test(file) || EXEMPT_FILES.test(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const src = stripNonCode(raw);
    const lines = raw.split('\n');
    for (const { name, re } of PATTERNS) {
      if (locallyDefined(raw, name)) continue;   // a local helper of the same name, not the browser dialog
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const line = src.slice(0, m.index).split('\n').length;
        const text = (lines[line - 1] || '').trim();
        findings.push({ app, file: file.slice(ROOT.length + 1), line, name, text: text.slice(0, 120) });
      }
    }
  }
}

if (findings.length) {
  console.error(`\n❌ native browser dialogs found (${findings.length}):\n`);
  for (const f of findings) console.error(`   ${f.file}:${f.line}  ${f.name}()  →  ${f.text}`);
  console.error('\n   Use useInlineAsk() for text input, useInlineConfirm() for yes/no.');
  console.error('   Native dialogs can be suppressed or restyled on kiosk/web-app installs, cannot enforce');
  console.error('   required/optional/minimum-length rules, and are invisible to the test suite when stubbed.\n');
  process.exit(1);
}

console.log('✅ no native browser dialogs — every frontend and shared package uses the in-app ask/confirm dialogs.');
