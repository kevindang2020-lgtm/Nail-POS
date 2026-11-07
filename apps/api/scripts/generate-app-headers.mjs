#!/usr/bin/env node
// generate-app-headers.mjs — Constitution 12 §68, §251–252 (finding H2): page headers for the STATIC web apps.
//
// The API does not serve the apps; each is a static site. This writes `public/_headers` for every app (Vite copies
// public/ into dist/ verbatim). `_headers` is the header file Netlify, Cloudflare Pages and Render honour; whether
// Railway's static sites honour it is NOT known here — DEPLOY_RAILWAY.md says so and gives the same headers for
// manual configuration. The policy is DERIVED from each app's index.html (script/style/font origins actually
// referenced) plus the API origin, so it can never allow less than the app needs — and a test regenerates and diffs.
//
//   node scripts/generate-app-headers.mjs            write every apps/*/public/_headers
//   node scripts/generate-app-headers.mjs --check    exit 1 if any file would change (CI)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const APPS = join(ROOT, 'apps');
const API_ORIGIN = "'self' https://api.aipowersalon.com https://*.up.railway.app";   // same-origin deploys + the API host

// The human check a code send can demand (BUILD_PLAN Phase 4): Cloudflare Turnstile, hCaptcha or reCAPTCHA, loaded on
// demand. Allowed only for an app whose code actually loads one.
const CAPTCHA_SCRIPT = ['https://challenges.cloudflare.com', 'https://js.hcaptcha.com', 'https://www.google.com', 'https://www.gstatic.com'];
const CAPTCHA_FRAME = ['https://challenges.cloudflare.com', 'https://*.hcaptcha.com', 'https://www.google.com'];
export const usesCaptcha = (code) => /challenges\.cloudflare\.com\/turnstile/.test(code);
// Developer merge (Oct 6 2026): browser push. The Firebase JS SDK (bundled, never a CDN script) talks to exactly these two
// Google endpoints to mint a web token; the worker is same-origin. Allowed only for an app whose code uses the ONE client.
const WEB_PUSH_CONNECT = ['https://fcmregistrations.googleapis.com', 'https://firebaseinstallations.googleapis.com'];
// Nov 5 2026: owner, tech and customer get push from @aipowersalon/mobile-sdk/web-push (one hook for native + browser).
// In a browser build that hook mints an FCM web token too, so those apps need the same two endpoints.
export const usesWebPush = (code) => /@aipowersalon\/(mobile-sdk\/)?web-push/.test(code);

/** sha256 of each INLINE <script> block — the single-file HTML apps run one, and `script-src 'self'` alone blocked it
 *  (Phase 4: found while building the public link's code step; every plain-HTML page was dead under its own policy).
 *  A hash allows exactly that script, never 'unsafe-inline'. */
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
}

/** Security Deep Scan §89: the inline <style> ELEMENTS an app renders, so style-src-elem can allow each by its sha256 instead of
 *  'unsafe-inline'. Static only: an index.html <style> block, or a JSX <style>{'…'}</style> / {`…`} literal with no ${…}
 *  (React sets that exact text). Anything else (a computed <style>, createElement('style')) makes the app DYNAMIC — it keeps
 *  'unsafe-inline' for elements and is listed in SECURITY_DEEP_SCAN_STATUS §89. Style ATTRIBUTES (React style props) stay
 *  allowed through style-src-attr 'unsafe-inline' — the remaining, lower-risk half (no CSS rules / selectors / @import). */
export function inlineStyleTexts(src, isHtml = false) {
  const texts = []; let dynamic = false;
  if (isHtml) {
    for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) texts.push(m[1]);
    // a script that builds markup with a <style> element at run time cannot be hashed
    for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) if (/<style|createElement\(['"]style/.test(m[1])) dynamic = true;
    return { texts, dynamic };
  }
  if (/createElement\(\s*['"]style['"]/.test(src)) dynamic = true;
  for (const m of src.matchAll(/<style\b[^>]*>\s*\{([\s\S]*?)\}\s*<\/style>/g)) {
    const e = m[1].trim();
    const tpl = /^`([\s\S]*)`$/.exec(e); const q1 = /^'((?:[^'\\]|\\.)*)'$/.exec(e); const q2 = /^"((?:[^"\\]|\\.)*)"$/.exec(e);
    const raw = tpl ? tpl[1] : q1 ? q1[1] : q2 ? q2[1] : null;
    if (raw === null || raw.includes('${') || /\\(?![\\'"n])/.test(raw)) { dynamic = true; continue; }
    texts.push(raw.replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1'));
  }
  return { texts, dynamic };
}
const sha = (t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;

export function policyFor(html, opts = {}) {
  const origins = (attr) => [...new Set([...html.matchAll(new RegExp(`${attr}=["'](https://[^/"']+)`, 'g'))].map((m) => m[1]))];
  const captcha = opts.captcha ?? usesCaptcha(html);
  const webPush = opts.webPush ?? false;
  const scripts = [...inlineScriptHashes(html), ...origins('src').filter((o) => /cdnjs|jsdelivr|unpkg/.test(o)), ...(captcha ? CAPTCHA_SCRIPT : [])];
  const styles = origins('href').filter((o) => /fonts\.googleapis/.test(o));
  const fonts = [...new Set([...html.matchAll(/https:\/\/fonts\.gstatic\.com/g)].map(() => 'https://fonts.gstatic.com'))];
  return [
    `default-src 'self'`,
    `script-src 'self'${scripts.length ? ' ' + scripts.join(' ') : ''}`,
    `style-src 'self' 'unsafe-inline'${styles.length ? ' ' + styles.join(' ') : ''}`,          // CSP2 fallback only (browsers without style-src-elem / -attr)
    // §89: <style> elements by hash (or 'unsafe-inline' only for an app that builds one at run time); style attributes stay inline
    ...(opts.styles ? [
      `style-src-elem 'self'${styles.length ? ' ' + styles.join(' ') : ''}${opts.styles.dynamic ? " 'unsafe-inline'" : [...new Set(opts.styles.texts.map(sha))].map((h) => ' ' + h).join('')}`,
      `style-src-attr 'unsafe-inline'`,
    ] : []),
    `font-src 'self' data:${fonts.length ? ' ' + fonts.join(' ') : ''}`,
    `img-src 'self' data: blob: https:`,                                                          // salon photos, logos, receipts from storage
    `connect-src ${API_ORIGIN} wss://api.aipowersalon.com wss://*.up.railway.app${webPush ? ' ' + WEB_PUSH_CONNECT.join(' ') : ''}`,   // API + realtime (+ FCM web-token minting where the app registers for push)
    `media-src 'self' blob: https:`,
    `worker-src 'self' blob:`,
    `frame-src https://*.cardconnect.com${captcha ? ' ' + CAPTCHA_FRAME.join(' ') : ''}`,         // the salon's CardSecure hosted card tokenizer (+ the captcha widget where used)
    `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, `upgrade-insecure-requests`,
  ].join('; ');
}

export function headersFileFor(html, opts = {}) {
  return [
    '/*',
    `  Content-Security-Policy: ${policyFor(html, opts)}`,
    '  Strict-Transport-Security: max-age=63072000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',   // camera: QR/receipt capture; geolocation: nearby salons
    '',
    '# Constitution 12 §251. GENERATED by apps/api/scripts/generate-app-headers.mjs from index.html — do not edit by hand.',
    '',
  ].join('\n');
}

export function appDirs() {
  // Every app with a page shell — including the three plain-HTML ones (booking pages, the check-in admin page) that
  // have no package.json; my first version filtered on package.json and silently skipped exactly those, which are
  // the PUBLIC surfaces a CSP protects most.
  return readdirSync(APPS).filter((d) => d !== 'api' && existsSync(join(APPS, d, 'index.html')));
}

/** Does any non-test source file under this app's src/ match? */
function srcMatches(app, test) {
  const walk = (d) => { if (!existsSync(d)) return false; for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'node_modules' && walk(p)) return true; } else if (/\.(tsx?|jsx?)$/.test(f) && !/\.(test|spec)\./.test(f) && test(readFileSync(p, 'utf8'))) return true; } return false; };
  return walk(join(APPS, app, 'src'));
}
/** Does this app's own code (its page or its src/) load a captcha widget? */
export function appUsesCaptcha(app) {
  const html = readFileSync(join(APPS, app, 'index.html'), 'utf8');
  if (usesCaptcha(html)) return true;
  return srcMatches(app, usesCaptcha);
}
/** §89: every static inline <style> text this app can render (its page, its src/, and @aipowersalon/ui when it uses it). */
export function appInlineStyles(app) {
  const texts = []; let dynamic = false;
  const add = (r) => { texts.push(...r.texts); dynamic = dynamic || r.dynamic; };
  add(inlineStyleTexts(readFileSync(join(APPS, app, 'index.html'), 'utf8'), true));
  const walk = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); } else if (/\.(tsx?|jsx?)$/.test(f) && !/\.(test|spec)\.|testkit/.test(f)) add(inlineStyleTexts(readFileSync(p, 'utf8'))); } };
  walk(join(APPS, app, 'src'));
  const pkg = join(APPS, app, 'package.json');
  if (existsSync(pkg) && /@aipowersalon\/ui/.test(readFileSync(pkg, 'utf8'))) walk(join(ROOT, 'packages', 'ui', 'src'));
  return { texts: [...new Set(texts)].sort(), dynamic };
}
/** Does this app register for browser push (imports the ONE web-push client)? */
export function appUsesWebPush(app) { return srcMatches(app, usesWebPush); }

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
const check = process.argv.includes('--check');
let changed = 0;
if (isMain) for (const app of appDirs()) {
  const html = readFileSync(join(APPS, app, 'index.html'), 'utf8');
  const out = headersFileFor(html, { captcha: appUsesCaptcha(app), webPush: appUsesWebPush(app), styles: appInlineStyles(app) });
  const dir = join(APPS, app, 'public'); const file = join(dir, '_headers');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current !== out) { changed++; if (!check) { mkdirSync(dir, { recursive: true }); writeFileSync(file, out); } }
}
if (isMain) {
  console.log(check ? `${changed} app header file(s) out of date` : `wrote ${appDirs().length} app header files (${changed} changed)`);
  if (check && changed) process.exit(1);
}
