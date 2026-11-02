// app-headers.vitest.spec — Constitution 12 §251: the static apps' page headers are generated, current, and no looser than needed.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { policyFor, headersFileFor, appDirs, appUsesCaptcha, appUsesWebPush, inlineScriptHashes, inlineStyleTexts, appInlineStyles } from '../../scripts/generate-app-headers.mjs';
import { createHash } from 'node:crypto';

const APPS = resolve(process.cwd(), '../');
describe('every app shell has a generated, up-to-date _headers file', () => {
  it.each(appDirs())('%s', (app) => {
    const file = join(APPS, app, 'public', '_headers');
    expect(existsSync(file), `${app}: run node apps/api/scripts/generate-app-headers.mjs`).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(headersFileFor(readFileSync(join(APPS, app, 'index.html'), 'utf8'), { captcha: appUsesCaptcha(app), webPush: appUsesWebPush(app), styles: appInlineStyles(app) }));
  });
  it('covers the plain-HTML public pages too, not only the Vite apps', () => {
    expect(appDirs()).toEqual(expect.arrayContaining(['booking-public', 'go-check-in-kiosk', 'pos-web', 'customer-web']));
  });
  it('the three legacy static pages removed in Phase 15 stay removed (their replacements live in admin-web, customer-web, pos-web)', () => {
    for (const gone of ['booking-html', 'booking-schedule-html', 'go-check-in-admin']) expect(appDirs()).not.toContain(gone);
  });
});

describe('browser push (developer merge, Oct 6 2026): the FCM token endpoints are allowed only where the ONE client is used', () => {
  it('pos-web and owner-web register for browser push; the customer app does not (it has the native client)', () => {
    expect(appUsesWebPush('pos-web')).toBe(true); expect(appUsesWebPush('owner-web')).toBe(true); expect(appUsesWebPush('customer-web')).toBe(false);
  });
  it('connect-src gains exactly the two Google endpoints, and script-src stays \'self\' (the SDK is bundled, the worker same-origin)', () => {
    const p = policyFor('<html></html>', { webPush: true });
    expect(p).toMatch(/connect-src [^;]*https:\/\/fcmregistrations\.googleapis\.com https:\/\/firebaseinstallations\.googleapis\.com;/);
    expect(p).toMatch(/script-src 'self';/); expect(p).not.toMatch(/gstatic/);
    expect(policyFor('<html></html>')).not.toMatch(/googleapis/);
  });
});

describe('the policy is derived, and tight', () => {
  it('a shell with no external script gets script-src \'self\' only — no CDN allowed "just in case"', () => {
    expect(policyFor('<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2"></head></html>')).toMatch(/script-src 'self';/);
  });
  it('a page that loads a script from cdnjs allows exactly that host, nothing wider', () => {
    // (the page that did — go-check-in-admin's qrcodejs — was removed in Phase 15; the derivation is still pinned)
    const p = policyFor('<html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script></head><body><script>new QRCode(document.body, "x")</script></body></html>');
    expect(p).toMatch(/script-src 'self' ('sha256-[A-Za-z0-9+/=]+' )*https:\/\/cdnjs\.cloudflare\.com;/);
    expect(p).not.toMatch(/unpkg|jsdelivr/);
  });
  it('never allows inline or eval SCRIPT, and never frames', () => {
    for (const app of appDirs()) {
      const p = policyFor(readFileSync(join(APPS, app, 'index.html'), 'utf8'));
      expect(p).not.toMatch(/script-src[^;]*'unsafe-inline'/); expect(p).not.toMatch(/'unsafe-eval'/); expect(p).toMatch(/frame-ancestors 'none'/);
    }
  });
});

describe('Phase 4: the single-file pages can actually run, and the captcha is allowed only where it is used', () => {
  it('every inline script is allowed by its exact sha256 — so the page runs under its own policy, still with no unsafe-inline', () => {
    for (const app of ['booking-public', 'go-check-in-kiosk']) {
      const html = readFileSync(join(APPS, app, 'index.html'), 'utf8');
      const body = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
      const want = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
      expect(inlineScriptHashes(html)).toEqual([want]);
      expect(policyFor(html)).toContain(want);
    }
  });
  it('one changed character in the script → a different hash (a tampered page does not run)', () => {
    expect(inlineScriptHashes('<script>a()</script>')).not.toEqual(inlineScriptHashes('<script>b()</script>'));
  });
  it('the captcha providers are allowed for the pages that load one (customer app, public link) — and not the POS', () => {
    expect(appUsesCaptcha('customer-web')).toBe(true);
    expect(appUsesCaptcha('booking-public')).toBe(true);
    expect(appUsesCaptcha('pos-web')).toBe(false);
    expect(policyFor('<html></html>', { captcha: true })).toMatch(/frame-src [^;]*challenges\.cloudflare\.com/);
    expect(policyFor('<html></html>')).not.toMatch(/challenges\.cloudflare\.com/);
  });
});


describe('Security Deep Scan §89: <style> elements by hash, no blanket unsafe-inline for elements where it can be avoided', () => {
  it('a static JSX <style> literal is hashed exactly as React renders it; a computed one makes the app dynamic', () => {
    const r = inlineStyleTexts("x = <style>{'@keyframes a{to{opacity:1}}'}</style>; y = <style>{`\n .b { color: red; }\n`}</style>");
    expect(r.dynamic).toBe(false);
    expect(r.texts).toEqual(['@keyframes a{to{opacity:1}}', '\n .b { color: red; }\n']);
    expect(inlineStyleTexts('<style>{`.c { color: ${GOLD}; }`}</style>').dynamic).toBe(true);
    expect(inlineStyleTexts("document.createElement('style')").dynamic).toBe(true);
  });
  it('the policy: style-src-elem lists the hashes (never unsafe-inline then); style-src-attr keeps inline style ATTRIBUTES', () => {
    const p = policyFor('<html></html>', { styles: { texts: ['@keyframes a{to{opacity:1}}'], dynamic: false } });
    const want = `'sha256-${createHash('sha256').update('@keyframes a{to{opacity:1}}', 'utf8').digest('base64')}'`;
    expect(p).toMatch(new RegExp(`style-src-elem 'self' ${want.replace(/[+/]/g, (c) => '\\' + c)};`));
    expect(p).not.toMatch(/style-src-elem[^;]*'unsafe-inline'/);
    expect(p).toMatch(/style-src-attr 'unsafe-inline'/);
    expect(policyFor('<html></html>', { styles: { texts: [], dynamic: true } })).toMatch(/style-src-elem 'self' 'unsafe-inline';/);
  });
  it('the generated apps: hashes everywhere a computed <style> does not force inline (the remaining apps are listed in the status report)', () => {
    const elem = (app: string) => /style-src-elem ([^;]*)/.exec(readFileSync(join(APPS, app, 'public', '_headers'), 'utf8'))?.[1] ?? '';
    for (const app of appDirs()) expect(elem(app), app).not.toBe('');
    const inline = appDirs().filter((a) => /'unsafe-inline'/.test(elem(a))).sort();
    expect(inline).toEqual(['admin-web', 'customer-web', 'pos-web']);   // each renders a computed <style> (SECURITY_DEEP_SCAN_STATUS §89)
    for (const app of ['booking-public', 'go-check-in-kiosk', 'owner-web', 'tech-web', 'manager-pay-web', 'customer-display']) expect(elem(app), app).toMatch(/'sha256-/);
  });
});
