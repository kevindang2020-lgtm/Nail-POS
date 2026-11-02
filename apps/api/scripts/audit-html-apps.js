#!/usr/bin/env node
/**
 * audit-html-apps.js — the FIRST automated check that actually opens go-check-in-kiosk and (until Phase 15) go-check-in-admin
 * (Jul 28, 2026).
 *
 * Those two apps are shipped production surfaces — the customer check-in kiosk and the device manager — written as
 * single HTML files with hand-written JavaScript. They have no tsconfig and no test suite, so nothing verified them
 * at all until the cross-wire extractor was taught to read .html earlier today. Cross-wire only checks that their
 * API paths resolve; it never looks at the JavaScript itself.
 *
 * This gate checks the failure modes that actually kill a single-file app, all of which are silent today:
 *
 *   1. SYNTAX. The script blocks are extracted and run through `node --check`. A stray brace ships a blank kiosk
 *      to a salon floor — there is no compiler, no bundler and no test between the edit and the customer.
 *   2. DANGLING ELEMENT REFERENCES. Every getElementById('x') / querySelector('#x') must have a matching id in the
 *      markup. Renaming an id in the HTML and missing one reference in the JS is the classic bug here, and it fails
 *      at runtime as a null dereference on a device nobody is watching.
 *   3. HARDCODED ORIGINS. The API base must stay configurable (?api= / window.APS_API_BASE). A pasted
 *      http://localhost or a baked production hostname is how a kiosk ends up pointing at the wrong backend.
 *   4. CREDENTIALS. No live-key patterns in files that ship to a browser.
 *   5. ESCAPING (Security Deep Scan §87, Oct 26 2026). Both apps build markup with template literals for innerHTML /
 *      render(). Every `${…}` inside a template that contains markup must produce escaped text: esc(…) / escAttr(…),
 *      t('key') / T('key') with NO variables (i18n strings are ours; a vars argument may carry API data — wrap it in esc),
 *      money(…) / Number(…) / encodeURIComponent(…), a string or number literal, a nested template (checked on its own),
 *      a .map(… => `…`).join(…) whose items are templates, or a call to a function defined in the same file (its own
 *      templates are checked). Conditions of a ternary / && / || do not render and are ignored; their branches are
 *      checked. Anything else — a bare API field like `${s.name}` — fails the gate.
 *
 * Deliberately NOT checked: DOM behavior. Verifying that tapping "Check In" moves the queue needs a browser
 * harness and a live API; this gate is static. It is a floor under two files that had nothing, not a test suite —
 * and it is not a substitute for the restructuring those apps still deserve.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const APPS_DIR = path.resolve(__dirname, '..', '..');
const TARGETS = [
  { app: 'go-check-in-kiosk', file: path.join(APPS_DIR, 'go-check-in-kiosk', 'www', 'index.html') },
  // the web build's source (package.json build copies it to dist/) — the same app as www/ (Capacitor), kept identical
  { app: 'go-check-in-kiosk (web)', file: path.join(APPS_DIR, 'go-check-in-kiosk', 'index.html') },
  { app: 'booking-public', file: path.join(APPS_DIR, 'booking-public', 'index.html') },
];
// Phase 15 (Oct 10 2026): go-check-in-admin, booking-html and booking-schedule-html were removed (replaced by admin-web
// /check-in-devices, customer-web Book, pos-web /tenant/booking). A target that does not exist is a failure below, not a
// silent skip — a listed-but-unread file looks covered.

// ── (5) escaping: a small template-literal scanner (handles nesting, strings and comments) ──────────────────────
function templatesIn(js) {
  const out = [];
  const skipString = (i, q) => { let m = i + 1; while (m < js.length && js[m] !== q && js[m] !== '\n') { if (js[m] === '\\') m++; m++; } return m + 1; };
  function scanTemplate(start) {
    let j = start, text = ''; const exprs = [];
    while (j < js.length) {
      const c = js[j];
      if (c === '\\') { text += js.slice(j, j + 2); j += 2; continue; }
      if (c === '`') return { end: j + 1, text, exprs };
      if (c === '$' && js[j + 1] === '{') {
        let depth = 1, k = j + 2, e = '';
        while (k < js.length && depth > 0) {
          const d = js[k];
          if (d === '`') { const r = scanTemplate(k + 1); out.push(r); e += js.slice(k, r.end); k = r.end; continue; }
          if (d === "'" || d === '"') { const m = skipString(k, d); e += js.slice(k, m); k = m; continue; }
          if (d === '{') depth++;
          if (d === '}') { depth--; if (depth === 0) break; }
          e += d; k++;
        }
        exprs.push(e.trim()); text += '${}'; j = k + 1; continue;
      }
      text += c; j++;
    }
    return { end: j, text, exprs };
  }
  let i = 0;
  while (i < js.length) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') { while (i < js.length && js[i] !== '\n') i++; continue; }
    if (c === '/' && js[i + 1] === '*') { const e = js.indexOf('*/', i + 2); i = e < 0 ? js.length : e + 2; continue; }
    if (c === "'" || c === '"') { i = skipString(i, c); continue; }
    if (c === '`') { const r = scanTemplate(i + 1); out.push(r); i = r.end; continue; }
    i++;
  }
  return out;
}
/** Split at top-level occurrences of the given operator characters (outside brackets, strings and templates). */
function splitTop(e, test) {
  const parts = []; let depth = 0, cur = '', i = 0;
  while (i < e.length) {
    const c = e[i];
    if (c === "'" || c === '"' || c === '`') { let m = i + 1; while (m < e.length && e[m] !== c) { if (e[m] === '\\') m++; m++; } cur += e.slice(i, m + 1); i = m + 1; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    const n = depth === 0 ? test(e, i) : 0;
    if (n) { parts.push(cur); cur = ''; i += n; continue; }
    cur += c; i++;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}
const stripParens = (e) => { let x = e.trim(); while (x.startsWith('(') && x.endsWith(')') && splitTop(x.slice(1, -1), () => 0).length === 1 && balanced(x.slice(1, -1))) x = x.slice(1, -1).trim(); return x; };
function balanced(x) { let d = 0; for (const c of x) { if (c === '(') d++; if (c === ')') { d--; if (d < 0) return false; } } return d === 0; }
function unsafeLeaves(expr, localFns) {
  const e = stripParens(expr);
  if (!e) return [];
  // ternary: condition ignored, branches checked
  const q = splitTop(e, (s, i) => (s[i] === '?' && s[i + 1] !== '.' && s[i + 1] !== '?' && s[i - 1] !== '?' ? 1 : 0));
  if (q.length > 1) { const rest = q.slice(1).join('?'); const br = splitTop(rest, (s, i) => (s[i] === ':' ? 1 : 0)); return br.flatMap((b) => unsafeLeaves(b, localFns)); }
  const or = splitTop(e, (s, i) => ((s[i] === '|' && s[i + 1] === '|') || (s[i] === '?' && s[i + 1] === '?') ? 2 : 0));
  if (or.length > 1) return or.flatMap((b) => unsafeLeaves(b, localFns));
  const and = splitTop(e, (s, i) => (s[i] === '&' && s[i + 1] === '&' ? 2 : 0));
  if (and.length > 1) return unsafeLeaves(and[and.length - 1], localFns);
  const plus = splitTop(e, (s, i) => (s[i] === '+' ? 1 : 0));
  if (plus.length > 1) return plus.flatMap((b) => unsafeLeaves(b, localFns));
  if (/^(['"])[\s\S]*\1$/.test(e) || /^-?\d+(\.\d+)?$/.test(e) || /^(true|false|null|undefined)$/.test(e)) return [];
  if (e.startsWith('`')) return [];                                                  // nested template: checked on its own
  if (/^(esc|escAttr|money|Number|encodeURIComponent)\s*\(/.test(e)) return [];
  if (/^[tT]\s*\(\s*(['"])[^'"]*\1\s*\)$/.test(e)) return [];                       // t('key') with no variables
  if (/\.map\s*\([\s\S]*=>\s*`[\s\S]*`\s*\)\s*\.join\s*\(\s*(['"])\1\s*\)$/.test(e)) return [];
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(e);
  if (call && localFns.has(call[1]) && !['t', 'T'].includes(call[1])) return [];
  const byRef = /^[\w$.]+\.map\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.join\s*\(\s*(['"])\2\s*\)$/.exec(e);   // list.map(rowHtml).join('')
  if (byRef) return localFns.has(byRef[1]) ? [] : [e];
  if (/^[\w$.]+\.map\s*\(\s*[\w$]+\s*=>\s*[A-Za-z_$][\w$]*\s*\([\s\S]*\)\s*\)\s*\.join\s*\(\s*(['"])\1\s*\)$/.test(e)) {
    const fn = /=>\s*([A-Za-z_$][\w$]*)\s*\(/.exec(e)[1]; return localFns.has(fn) ? [] : [e];
  }
  return [e];
}
function escapingProblems(js) {
  const localFns = new Set([...js.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g), ...js.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)].map((m) => m[1]));
  const bad = [];
  for (const t of templatesIn(js)) {
    if (!/<[a-zA-Z/]/.test(t.text)) continue;
    for (const e of t.exprs) for (const leaf of unsafeLeaves(e, localFns)) bad.push(leaf);
  }
  return bad;
}
module.exports = { escapingProblems, templatesIn };
if (require.main !== module) return;

const SECRET = /(sk_live_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{16}|SG\.[A-Za-z0-9_-]{20,}|BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY)/;
const BAD_ORIGIN = /(https?:\/\/localhost(?::\d+)?|https?:\/\/127\.0\.0\.1(?::\d+)?)/;

let failures = 0;
const note = (app, msg) => { console.log(`   ✗ ${app}: ${msg}`); failures++; };

console.log('=== SINGLE-FILE HTML APP AUDIT ===');

for (const { app, file } of TARGETS) {
  if (!fs.existsSync(file)) { note(app, `missing entry file ${path.relative(APPS_DIR, file)}`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  // (1) syntax — extracted scripts must parse
  let syntaxOk = true;
  scripts.forEach((js, i) => {
    const tmp = path.join(os.tmpdir(), `htmlaudit-${app}-${i}-${process.pid}.js`);
    try {
      fs.writeFileSync(tmp, js);
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      syntaxOk = false;
      const first = String(e.stderr || e.message).split('\n').find((l) => /SyntaxError|Unexpected/.test(l)) || 'parse failed';
      note(app, `script block ${i + 1} does not parse — ${first.trim()}`);
    } finally { try { fs.unlinkSync(tmp); } catch { /* temp file */ } }
  });

  // (2) dangling element references
  const ids = new Set([...html.matchAll(/\bid=["']([A-Za-z0-9_-]+)["']/g)].map((m) => m[1]));
  const refs = new Set([
    ...[...html.matchAll(/getElementById\(\s*["']([A-Za-z0-9_-]+)["']/g)].map((m) => m[1]),
    ...[...html.matchAll(/querySelector\(\s*["']#([A-Za-z0-9_-]+)["']/g)].map((m) => m[1]),
    // The booking pages use a `$('id')` shorthand for getElementById — count those as references too, so a
    // renamed id still fails the gate there. Only bare `$('x')` (not `$$` or method calls) is matched.
    ...[...html.matchAll(/(?<![\w$.])\$\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g)].map((m) => m[1]),
  ]);
  const dangling = [...refs].filter((r) => !ids.has(r));
  for (const d of dangling) note(app, `JavaScript reads #${d}, but no element with that id exists in the markup`);

  // (3) hardcoded origins — the API base must remain configurable
  const origin = html.match(BAD_ORIGIN);
  if (origin) note(app, `hardcoded origin ${origin[1]} — the API base must stay configurable (?api= / window.APS_API_BASE)`);

  // (4) credentials
  if (SECRET.test(html)) note(app, 'a live-credential pattern appears in a file served to the browser');

  // (5) escaping — every ${…} in a markup template renders escaped text (Security Deep Scan §87)
  const unescaped = escapingProblems(scripts.join('\n'));
  for (const u of unescaped) note(app, `unescaped value in a markup template: \${${u.slice(0, 80)}} — wrap it in esc(…)`);

  const sizeKb = Math.round(html.length / 1024);
  console.log(`   ${dangling.length === 0 && syntaxOk && !origin ? '✓' : '·'} ${app}: ${sizeKb}KB, ${scripts.length} script block(s), ${ids.size} ids, ${refs.size} element reference(s)`);
}

console.log('');
if (failures) {
  console.log(`FAILED — ${failures} problem(s) in apps that have no other automated coverage.`);
  process.exit(1);
}
console.log('OK — the single-file HTML apps parse, reference only elements that exist, keep the API base');
console.log('     configurable, carry no credentials, and escape every value they write into markup.');
console.log('     NOT covered: runtime DOM behavior (needs a browser harness + live API).');
