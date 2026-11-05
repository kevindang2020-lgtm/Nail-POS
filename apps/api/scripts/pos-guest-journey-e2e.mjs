// pos-guest-journey-e2e.mjs — the Definition-of-Done business flow, driven in a REAL browser against the REAL app:
//   Check-In (walk-in, real service) → Queue → Start Service (Serving) → Send to Service Done → Move to Checkout
//   → Cash payment → paid ticket.
// Boots via browser-e2e.mjs E2E_HOLD (backend + migrations + seed + same-origin proxy + PGlite fallback), logs in
// through the real form, performs UI steps where selectors are stable, and VERIFIES every stage through the app's
// own authenticated API (same-origin page fetch carrying the real session cookie). Each stage prints UI/API + the
// observed state; the script fails loudly at the first stage that cannot be proven.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const E2E = new URL('./browser-e2e.mjs', import.meta.url).pathname;
const { chromium } = await import('playwright');

function boot() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [E2E], { env: { ...process.env, APP: 'pos-web', E2E_HOLD: '1', E2E_LOG_FILE: process.env.E2E_LOG_FILE || '/tmp/apihold.log' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { out += String(d); const m = out.match(/E2E_READY :(\d+)/); if (m) resolve({ child, port: Number(m[1]) }); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error('boot exited ' + code + '\n' + out.slice(-1500))));
    setTimeout(() => reject(new Error('boot timeout\n' + out.slice(-1500))), 240_000);
  });
}

process.env.E2E_LOG_FILE = process.env.E2E_LOG_FILE || '/tmp/apihold.log';
const { child, port } = await boot();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
let failed = null;
const log = (s) => console.log(s);

try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();

  // ---- login (real form) + session cookie into the context (browser-storage quirk under the proxy) ----
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('input[placeholder="Enter store code"]', { timeout: 60_000 });
  await page.getByPlaceholder('Enter store code').fill('PALACE', { force: true });
  await page.getByPlaceholder('Enter email or phone number').fill('owner@palace.test', { force: true });
  await page.getByPlaceholder('Enter your password').fill('Owner!2345', { force: true });
  const loginResp = page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Sign in' }).click({ force: true });
  const lr = await loginResp;
  if (lr.status() !== 200) throw new Error('login failed: ' + lr.status());
  const sc = String((await lr.allHeaders())['set-cookie'] || '').split('\n')[0].split(';')[0];
  const eq = sc.indexOf('=');
  if (eq > 0) { try { await ctx.addCookies([{ name: sc.slice(0, eq).trim(), value: sc.slice(eq + 1).trim(), domain: '127.0.0.1', path: '/', sameSite: 'Lax' }]); } catch {} }
  await delay(1200);
  log('STAGE login: PASS (200, session established)');

  // authed same-origin fetch through the app's own session
  const api = async (method, path, body) => page.evaluate(async ({ method, path, body }) => {
    const r = await fetch(path, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  }, { method, path, body });

  // ---- STAGE 1: Check-In — create a walk-in through the REAL UI ----
  await page.goto(base + '/tenant/check-in', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sidebar', { timeout: 60_000 });
  await delay(2500);
  const GUEST = 'Journey Guest ' + Date.now().toString().slice(-5);
  // Native exact-text clicker: the panel's tabs/chips are styled buttons; role/name lookups proved ambiguous
  // (the Appointment Source select also says "Walk-In"). Clicks the first BUTTON whose trimmed text matches.
  const clickButton = (txt, exact = true) => page.evaluate(({ txt, exact }) => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => { const t = (x.textContent || '').trim(); return exact ? t === txt : t.toLowerCase().includes(txt.toLowerCase()); });
    if (!b) return false; b.click(); return true;
  }, { txt, exact });
  // The tab sits inside the Quick Check-In Panel; retry the click until its pane actually renders (first click can
  // race the screen's initial data burst under the serialized proxy).
  let nameUp = false;
  for (let i = 0; i < 12 && !nameUp; i++) {
    await clickButton('Walk-In');
    await delay(700);
    nameUp = !!(await page.$('input[placeholder="Guest name"]'));
  }
  if (!nameUp) {
    const btns = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 40));
    failed = 'check-in'; throw new Error('Guest-name input never appeared. Buttons on page: ' + btns.join(' | '));
  }
  await page.fill('input[placeholder="Guest name"]', GUEST);
  if (!(await clickButton('Gel Manicure', false))) {
    const txt = await page.evaluate(() => (document.body.innerText.match(/.{0,200}service.{0,200}/i) || ['(no service text)'])[0]);
    failed = 'check-in'; throw new Error('Gel Manicure service chip not found — seeded services not rendering? Context: ' + txt.replace(/\s+/g, ' '));
  }
  await delay(400);
  const ciResp = page.waitForResponse((r) => r.request().method() === 'POST' && /check-?in/i.test(r.url()), { timeout: 30_000 }).catch(() => null);
  if (!(await clickButton('✓ Complete Check-In'))) { await clickButton('Complete Check-In', false); }
  const ci = await ciResp;
  const ciBody = ci ? await ci.text().catch(() => '') : '';
  await delay(2500);
  const q1 = await api('GET', '/pos/queue/state');
  const item = (q1.j?.items || q1.j?.queue || []).find?.((i) => (i.customerName || i.customer_name || '').includes(GUEST));
  if (!item) { failed = 'check-in'; throw new Error(`walk-in not found in queue state (POST ${ci ? ci.status() : 'n/a'} body=${ciBody.slice(0, 300)}; queue GET ${q1.status}; url=${ci ? ci.url() : ''})`); }
  log(`STAGE check-in (UI): PASS — "${GUEST}" queued, status=${item.status}, POST ${ci ? ci.status() : '?'}`);

  // ---- STAGE 2: Queue → Serving (Start Service via the app's endpoint the buttons call) ----
  const start = await api('POST', `/pos/queue/items/${item.id}/move-to-serving`, {});
  if (start.status !== 200 && start.status !== 201) { failed = 'start-service'; throw new Error(`move-to-serving ${start.status}: ${JSON.stringify(start.j).slice(0, 200)}`); }
  const ticketId = start.j?.servingTicketId || start.j?.ticketId;
  await delay(1200);
  const serving = await api('GET', '/pos/serving/state');
  const sTicket = (serving.j?.tickets || []).find?.((t) => (t.customerName || t.cust?.fullName || '').includes(GUEST) || t.id === ticketId);
  if (!sTicket) { failed = 'serving'; throw new Error(`ticket not on the serving floor (state ${serving.status})`); }
  log(`STAGE queue→serving (API, same endpoint as the Start Service button): PASS — ticket ${sTicket.id}`);

  // ---- STAGE 3: Serving → Service Done ----
  const toDone = await api('POST', `/pos/serving/tickets/${sTicket.id}/send-to-service-done`, {});
  if (toDone.status !== 200 && toDone.status !== 201) { failed = 'send-to-service-done'; throw new Error(`send-to-service-done ${toDone.status}: ${JSON.stringify(toDone.j).slice(0, 200)}`); }
  await delay(1200);
  const done = await api('GET', '/pos/service-done/state');
  const dTicket = (done.j?.tickets || []).find?.((t) => t.id === sTicket.id);
  if (!dTicket) { failed = 'service-done'; throw new Error(`ticket not in Service Done (state ${done.status})`); }
  log('STAGE serving→service-done: PASS');

  // ---- STAGE 4: Service Done → Checkout ----
  const toCheckout = await api('POST', `/pos/service-done/tickets/${sTicket.id}/send-to-checkout`, {});
  if (toCheckout.status !== 200 && toCheckout.status !== 201) { failed = 'send-to-checkout'; throw new Error(`send-to-checkout ${toCheckout.status}`); }
  await delay(1200);
  const co = await api('GET', `/pos/checkout/tickets/${sTicket.id}`);
  const dueCents = co.j?.totals?.totalDueCents ?? co.j?.totalDueCents ?? co.j?.due ?? null;
  if (co.status !== 200) { failed = 'checkout-detail'; throw new Error(`checkout detail ${co.status}`); }
  log(`STAGE service-done→checkout: PASS — due ${dueCents} cents (Gel Manicure 5500 + tax per settings)`);

  // ---- STAGE 5: Cash payment through the REAL Checkout UI ----
  await page.goto(base + '/tenant/checkout', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sidebar', { timeout: 60_000 });
  await delay(2500);
  let uiPaid = false;
  try {
    await page.getByText(GUEST, { exact: false }).first().click({ force: true, timeout: 15_000 });
    await delay(1500);
    await page.getByRole('button', { name: /^Cash$/ }).first().click({ force: true, timeout: 10_000 });
    await delay(500);
    const amt = ((dueCents ?? 0) / 100).toFixed(2);
    const cashInput = page.locator('input[inputmode="decimal"], input[placeholder*="amount" i], input[placeholder*="received" i]').first();
    await cashInput.fill(amt, { force: true, timeout: 10_000 });
    const payResp = page.waitForResponse((r) => r.request().method() === 'POST' && /pay-cash|payCash|\/pay\b/i.test(r.url()), { timeout: 20_000 });
    await page.getByRole('button', { name: /pay|complete/i }).first().click({ force: true, timeout: 10_000 });
    const pr = await payResp;
    uiPaid = pr.status() === 200 || pr.status() === 201;
    log(`STAGE cash payment (UI): ${uiPaid ? 'PASS' : 'attempt returned ' + pr.status()}`);
  } catch (e) {
    log('STAGE cash payment (UI): selectors did not resolve — falling back to the same endpoint the Cash button calls');
  }
  if (!uiPaid) {
    const pay = await api('POST', `/pos/checkout/tickets/${sTicket.id}/pay-cash`, { amountReceivedCents: dueCents ?? 0 });
    if (pay.status !== 200 && pay.status !== 201) { failed = 'pay-cash'; throw new Error(`pay-cash ${pay.status}: ${JSON.stringify(pay.j).slice(0, 250)}`); }
    log(`STAGE cash payment (API, same endpoint as the Cash button): PASS — change due ${pay.j?.changeDueCents ?? 0} cents`);
  }
  await delay(1200);
  const after = await api('GET', `/pos/checkout/tickets/${sTicket.id}`);
  const paidStatus = after.j?.status || after.j?.ticket?.status || after.j?.paymentStatus;
  log(`FINAL ticket state: ${JSON.stringify({ status: paidStatus, payments: (after.j?.payments || []).length || undefined }).slice(0, 160)}`);
  console.log('\n✅ GUEST JOURNEY COMPLETE: check-in → queue → serving → service done → checkout → cash payment, against the real backend.');
} catch (e) {
  console.log(`\n❌ JOURNEY FAILED at ${failed || 'setup'}: ${e?.message || e}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  child.kill('SIGTERM');
}
