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
  { app: 'booking-public', file: path.join(APPS_DIR, 'booking-public', 'index.html') },
];
// Phase 15 (Oct 10 2026): go-check-in-admin, booking-html and booking-schedule-html were removed (replaced by admin-web
// /check-in-devices, customer-web Book, pos-web /tenant/booking). A target that does not exist is a failure below, not a
// silent skip — a listed-but-unread file looks covered.

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

  const sizeKb = Math.round(html.length / 1024);
  console.log(`   ${dangling.length === 0 && syntaxOk && !origin ? '✓' : '·'} ${app}: ${sizeKb}KB, ${scripts.length} script block(s), ${ids.size} ids, ${refs.size} element reference(s)`);
}

console.log('');
if (failures) {
  console.log(`FAILED — ${failures} problem(s) in apps that have no other automated coverage.`);
  process.exit(1);
}
console.log('OK — the single-file HTML apps parse, reference only elements that exist, keep the API base');
console.log('     configurable, and carry no credentials.');
console.log('     NOT covered: runtime DOM behavior (needs a browser harness + live API).');
