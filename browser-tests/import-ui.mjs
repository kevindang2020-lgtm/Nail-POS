// browser-tests/import-ui.mjs — drives the REAL Customers > Import panel in a headless browser end-to-end:
// login -> Customers -> open import -> paste CSV -> Preview -> Import -> assert the new customer appears.
// Saves screenshots to SHOTS_DIR. Exits non-zero on any failed check.
//
// Prereqs (run the API + pos-web dev server first, then this from the REPO ROOT so `playwright` resolves):
//   API:      DATABASE_URL=... REPO_DRIVER=postgres AUTH_SESSION_SECRET=... PORT=3000 node apps/api/dist/main.js
//   pos-web:  (cd apps/pos-web && node ../../node_modules/.bin/vite --port 5173 --host)
//   browsers: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers   (or wherever Chromium is installed)
//   run:      APP_URL=http://localhost:5173 SHOTS_DIR=/tmp/shots node browser-tests/import-ui.mjs
//
// Env: APP_URL (default http://localhost:5173), SHOTS_DIR (default /tmp/shots),
//      LOGIN_CODE/LOGIN_USER/LOGIN_PASS (default LUXE / owner@luxenails.test / Owner123!).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const APP = process.env.APP_URL || 'http://localhost:5173';
const SHOTS = process.env.SHOTS_DIR || '/tmp/shots';
const CODE = process.env.LOGIN_CODE || 'LUXE';
const USER = process.env.LOGIN_USER || 'owner@luxenails.test';
const PASS = process.env.LOGIN_PASS || 'Owner123!';
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { log(`${c ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

const csv = [
  'first name,last name,phone,email,birthday',
  'Browser,Alpha,609-555-1001,alpha@example.com,1991-02-03',
  'Browser,Bravo,(609) 555-1002,bravo@example.com,4/5/1990',
  'Browser,Alpha,6095551001,dup@example.com,1991-02-03', // repeated phone → duplicate
  'WalkIn Guest,,,,',                                      // name only → create
].join('\n');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByPlaceholder('Salon code').fill(CODE);
  await page.getByPlaceholder('Email or phone').fill(USER);
  await page.getByPlaceholder('Password').fill(PASS);
  await page.screenshot({ path: `${SHOTS}/01-login.png` });
  await page.getByRole('button', { name: /sign in/i }).click();

  const customersLink = page.getByRole('link', { name: 'Customers', exact: true });
  try { await customersLink.waitFor({ timeout: 8000 }); }
  catch {
    // optional branch-selection step: click the first non-Back button, then retry
    const btns = page.getByRole('button'); const n = await btns.count();
    for (let i = 0; i < n; i++) { const t = (await btns.nth(i).innerText().catch(() => '')).trim(); if (t && !/back/i.test(t)) { await btns.nth(i).click().catch(() => {}); break; } }
    await customersLink.waitFor({ timeout: 10000 });
  }
  ok('logged in (authenticated POS shell rendered)', true);

  await customersLink.click();
  await page.getByRole('heading', { name: 'Customers' }).waitFor({ timeout: 12000 });
  ok('navigated to the Customers screen', true);

  await page.getByRole('button', { name: /import customers/i }).click();
  await page.getByRole('heading', { name: /import customers from csv/i }).waitFor({ timeout: 8000 });
  ok('Import panel opens', true);
  await page.locator('textarea').first().fill(csv);

  await page.getByRole('button', { name: /^preview$/i }).click();
  await page.getByText(/to create/i).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/04-preview.png` });
  ok('Preview shows a classification summary', true);

  await page.getByRole('button', { name: /^import \d+ customer/i }).click();
  await page.getByText(/imported \d+ customer/i).waitFor({ timeout: 15000 });
  const resultText = await page.getByText(/imported \d+ customer/i).innerText().catch(() => '');
  ok('Import commits and confirms', /imported \d+/i.test(resultText), resultText.slice(0, 90));
  await page.screenshot({ path: `${SHOTS}/05-imported.png` });

  await page.waitForTimeout(900);
  ok('imported customer appears in the directory', (await page.getByText('Browser Bravo').count()) > 0);
  // benign pre-login 401 auth-checks are not JS errors; ignore those
  const jsErrors = errors.filter((e) => !/401|Unauthorized|Failed to load resource/i.test(e));
  ok('no uncaught JS errors during the flow', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
} catch (e) {
  ok('flow completed without throwing', false, String(e).slice(0, 160));
  await page.screenshot({ path: `${SHOTS}/zz-failure.png` }).catch(() => {});
} finally {
  await browser.close();
  log(`\n${fail === 0 ? '✅ IMPORT UI VERIFIED IN BROWSER' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
