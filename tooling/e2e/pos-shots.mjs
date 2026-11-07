#!/usr/bin/env node
// pos-shots.mjs — screenshots of POS routes at given viewports against the real stack (developer evidence helper).
//   DATABASE_URL=… CHROMIUM_PATH=… ROUTES=/tech-queue,/tenant/team/payroll VIEWPORTS=1920x945 SHOTS=/tmp/s [CLICK='button:has-text("History")'] [FULL=1] node tooling/e2e/pos-shots.mjs
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
    if (process.env.CLICK) { await page.locator(process.env.CLICK).first().click().catch((e) => console.error('click failed', e.message)); await sleep(1500); }
    const f = `${SHOTS}/${r.replace(/\W+/g, '_')}${process.env.TAG ? '-' + process.env.TAG : ''}-${w}x${h}.png`;
    await page.screenshot({ path: f, fullPage: process.env.FULL === '1' });
    console.log(f);
  }
} finally { await stack.stop(); }
