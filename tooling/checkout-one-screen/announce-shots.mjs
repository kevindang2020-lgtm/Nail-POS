// announce-shots.mjs — screenshots of the POS top-bar Platform Announcement (shell/PlatformAnnouncementBar.tsx) in its
// real place in the shared header, on the Checkout screen at 1920×945 (1920×1080 with browser chrome + taskbar).
// Also confirms the header does not grow: the Checkout board still has no page scroll with an announcement up.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const OUT = join(HERE, 'results', 'announce'); mkdirSync(OUT, { recursive: true });
const PORT = 4319, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
try {
  for (const [kind, lang, action] of [['info', 'en', null], ['info', 'vi', null], ['long', 'en', null], ['long', 'en', 'more'], ['critical', 'en', null], ['none', 'en', null]]) {
    await fetch(`${BASE}/__state?name=normal`); await fetch(`${BASE}/__announce?kind=${kind}`);
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 945 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript(([k, l]) => { try { localStorage.setItem(k, l); } catch {} }, ['aps.language', lang]);
    await page.goto(`${BASE}/checkout`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="checkout-workspace-body"]', { timeout: 15000 });
    await page.waitForTimeout(900);
    if (lang === 'vi') { await page.locator('header.topbar button', { hasText: 'English' }).first().click(); await page.locator('[role="menu"] [role="menuitem"], [role="menu"] button', { hasText: 'Tiếng Việt' }).first().click(); await page.waitForTimeout(700); }
    if (action === 'more') { await page.locator('[data-testid="platform-announcement"] button', { hasText: /More|Thêm/ }).first().click(); await page.waitForTimeout(400); }
    const m = await page.evaluate(() => { const b = document.querySelector('[data-testid="platform-announcement"]'); const h = document.querySelector('header.topbar'); const cp = document.querySelector('.checkout-page'); const r = (e) => e ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(e.getBoundingClientRect()) : null;
      return { bar: r(b), header: r(h), text: b?.textContent?.trim().slice(0, 160) ?? null, pageScroll: cp ? cp.scrollHeight - cp.clientHeight : null, docScroll: document.scrollingElement.scrollHeight - innerHeight }; });
    const name = `announce-${kind}-${lang}${action ? '-' + action : ''}`;
    await page.screenshot({ path: join(OUT, name + '.png') });
    await page.screenshot({ path: join(OUT, name + '-header.png'), clip: { x: 0, y: 0, width: 1920, height: action === 'more' ? 420 : 70 } });
    console.log(name, JSON.stringify(m));
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }
