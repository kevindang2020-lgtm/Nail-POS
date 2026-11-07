#!/usr/bin/env node
// pos-shots.mjs — screenshots of POS routes at given viewports against the real stack (developer evidence helper).
//   DATABASE_URL=… CHROMIUM_PATH=… ROUTES=/tech-queue,/tenant/team/payroll VIEWPORTS=1920x945 SHOTS=/tmp/s [CLICK='button:has-text("History")' — or 'sel1||sel2' for a sequence] [METRICS=1] [FULL=1] node tooling/e2e/pos-shots.mjs
import { mkdirSync } from 'node:fs';
import { startPosStack } from './lib/pos-stack.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROUTES = (process.env.ROUTES || '/overview').split(',');
const VPS = (process.env.VIEWPORTS || '1920x945').split(',').map((v) => v.split('x').map(Number));
const SHOTS = process.env.SHOTS || '/tmp/pos-shots'; mkdirSync(SHOTS, { recursive: true });
const stack = await startPosStack();
try {
  await stack.setLanguage(process.env.LANG_CODE || 'en');
  const page = await stack.ctx.newPage();
  for (const r of ROUTES) for (const [w, h] of VPS) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(stack.WEB + r, { waitUntil: 'domcontentloaded' });
    await page.locator('.main').first().waitFor({ timeout: 30000 }).catch(() => undefined);
    await sleep(2500);
    // CLICK may be a sequence: 'sel1||sel2' clicks each in turn (e.g. a tab, then a button inside it)
    for (const sel of (process.env.CLICK || '').split('||').filter(Boolean)) { await page.locator(sel).first().click().catch((e) => console.error('click failed', e.message)); await sleep(1500); }
    if (process.env.METRICS === '1') console.log(JSON.stringify(await page.evaluate(() => { const m = document.querySelector('.main'); const out = { doc: [document.documentElement.scrollHeight, innerHeight], main: m ? [m.scrollHeight, m.clientHeight] : null, cards: {} }; document.querySelectorAll('[data-module-id]').forEach((e) => { const r = e.getBoundingClientRect(); out.cards[e.getAttribute('data-module-id')] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }); return out; })));
    const f = `${SHOTS}/${r.replace(/\W+/g, '_')}${process.env.TAG ? '-' + process.env.TAG : ''}-${w}x${h}.png`;
    await page.screenshot({ path: f, fullPage: process.env.FULL === '1' });
    console.log(f);
  }
} finally { await stack.stop(); }
