#!/usr/bin/env node
// pos-module-inventory.mjs — SUNMI FLEX 3 mandates (Nov 6 2026): "create a versioned inventory from the actual repository
// AND RUNNING APPLICATION" (Full-System addendum §03; every page addendum's BEFORE / AFTER module manifest).
//
// Boots the real stack (lib/pos-stack.mjs), opens every registered POS page (apps/pos-web/src/shell/module-registry.json)
// at each requested viewport, and records for every element that carries data-module-id or a container-sized data-testid:
// its id, rectangle, whether it is visible and whether it lies fully inside the content viewport at scroll 0; plus the
// page's scroll metrics. For registered modules it also reports PRESENT / VISIBLE / IN-VIEW and the child count used by the
// "all nine KPIs" style checks. Read-only: it never clicks anything.
//
//   DATABASE_URL=postgres://…/aps CHROMIUM_PATH=… OUT=docs/sunmi/inventory-before.json \
//     [VIEWPORTS=1920x945,1920x952] [ONLY=overview,payroll] node tooling/e2e/pos-module-inventory.mjs
// Exit code 0 always unless the stack cannot boot (it is an inventory, not a gate; the gate is pos-vi-one-screen's
// registry check and apps/api check:pos-module-registry).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { startPosStack } from './lib/pos-stack.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const REG = JSON.parse(readFileSync(ROOT + 'apps/pos-web/src/shell/module-registry.json', 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = (process.env.VIEWPORTS || '1920x945').split(',').map((v) => v.split('x').map(Number));
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const OUT = process.env.OUT || '/tmp/pos-module-inventory.json';

/** In-page: every module-like element + the registered modules' status. Runs in the browser. */
export const inspectPage = (page, registered) => page.evaluate((reg) => {
  const main = document.querySelector('.main');
  const top = document.querySelector('.main > .topbar');
  const mr = main.getBoundingClientRect();
  const content = { left: mr.left, top: top ? top.getBoundingClientRect().bottom : mr.top, right: mr.right, bottom: Math.min(mr.bottom, window.innerHeight) };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const inView = (r) => r.left >= content.left - 1 && r.right <= content.right + 1 && r.top >= content.top - 1 && r.bottom <= content.bottom + 1;
  const all = [];
  for (const el of document.querySelectorAll('.main [data-module-id], .main [data-testid]')) {
    const id = el.getAttribute('data-module-id') || el.getAttribute('data-testid');
    const r = el.getBoundingClientRect();
    if (!el.hasAttribute('data-module-id') && (r.width < 120 || r.height < 40)) continue;   // controls, not modules
    all.push({ id, kind: el.hasAttribute('data-module-id') ? 'module-id' : 'testid', visible: vis(el), inView: inView(r), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const find = (id) => document.querySelector(`.main [data-module-id="${id}"]`) || document.querySelector(`.main [data-testid="${id}"]`);
  const mods = reg.map((m) => {
    const el = find(m.id);
    if (!el) return { id: m.id, label: m.label, present: false, visible: false, inView: false };
    const r = el.getBoundingClientRect();
    const children = (m.items ? [...el.querySelectorAll(m.items)] : [...el.children]).filter((c) => vis(c)).length;
    return { id: m.id, label: m.label, present: true, visible: vis(el), inView: vis(el) && inView(r), children, minChildren: m.minItems ?? null, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const se = document.scrollingElement;
  const root = main.querySelector(':scope > :not(.topbar):not(.community-alert-slot)');
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, density: document.documentElement.getAttribute('data-density') },
    content: { w: Math.round(content.right - content.left), h: Math.round(content.bottom - content.top) },
    scroll: { docY: se.scrollHeight - se.clientHeight, docX: se.scrollWidth - se.clientWidth, mainY: main.scrollHeight - main.clientHeight, mainX: main.scrollWidth - main.clientWidth, rootY: root ? root.scrollHeight - root.clientHeight : 0 },
    registered: mods, all,
  };
}, registered);

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const stack = await startPosStack();
  const results = [];
  try {
    await stack.setLanguage(process.env.LANG_CODE || 'en');
    const page = await stack.ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
    for (const p of REG.pages) {
      if (ONLY && !ONLY.includes(p.key)) continue;
      for (const [w, h] of VPS) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(stack.WEB + p.routes[0], { waitUntil: 'domcontentloaded' });
        await page.locator('.main').first().waitFor({ timeout: 30000 }).catch(() => undefined);
        for (let i = 0; i < 40; i++) { const tx = await page.locator('.main').first().innerText().catch(() => ''); if (tx.length > 80 && !/^\s*(Loading|Đang tải)/m.test(tx.slice(0, 200))) break; await sleep(250); }
        await sleep(1500);
        const r = await inspectPage(page, p.modules);
        const missing = r.registered.filter((m) => !m.present).map((m) => m.id);
        const out = r.registered.filter((m) => m.present && !m.inView).map((m) => m.id);
        const few = r.registered.filter((m) => m.minChildren != null && m.present && m.children < m.minChildren).map((m) => `${m.id} ${m.children}/${m.minChildren}`);
        results.push({ key: p.key, route: p.routes[0], w, h, ...r, missing, outOfView: out, fewChildren: few, pageErrors: errors.splice(0) });
        console.log(`${p.key.padEnd(16)} ${w}x${h} density=${r.viewport.density} docY${r.scroll.docY} mainY${r.scroll.mainY} rootY${r.scroll.rootY} reg ${r.registered.length - missing.length}/${r.registered.length} present, ${r.registered.length - missing.length - out.length} in view${missing.length ? ' MISSING ' + missing.join(',') : ''}${out.length ? ' OUT ' + out.join(',') : ''}${few.length ? ' FEW ' + few.join(',') : ''}`);
      }
    }
  } finally { await stack.stop(); }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log('inventory →', OUT);
}
