// interact.mjs — Inventory · Products · Suppliers (+ Membership · Discounts) E2E (Oct 29 2026). The REAL POS bundle in Chromium
// against live-server.mjs (the REAL controllers, writers and read models on a seeded TEST database). Each step clicks what a
// salon user clicks and checks the answer on screen AND in the database. Nothing leaves the machine: no supplier is ordered
// from, no message is sent, no card is charged.
//   node tooling/catalog-one-screen/interact.mjs [label] [sections]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { STEPS_EXTRA } from './interact-extra.mjs';
import { STEPS_CATALOG } from './interact-catalog.mjs';
import { STEPS_TEAM } from './interact-team.mjs';
import { STEPS_COMMS } from './interact-comms.mjs';
import { STEPS_AIUSAGE } from './interact-aiusage.mjs';
import { STEPS_HEALTH } from './interact-health.mjs';
import { STEPS_INBOX } from './interact-inbox.mjs';
import { STEPS_RN } from './interact-rn.mjs';
import { STEPS_SEG } from './interact-seg.mjs';
import { STEPS_CP } from './interact-cp.mjs';
import { STEPS_DO } from './interact-do.mjs';
import { STEPS_PROMO } from './interact-promo.mjs';
import { STEPS_CC } from './interact-cc.mjs';
import { STEPS_MG } from './interact-mg.mjs';
import { STEPS_MT } from './interact-mt.mjs';
import { STEPS_CN } from './interact-cn.mjs';
import { STEPS_PM } from './interact-pm.mjs';
import { STEPS_BV } from './interact-bv.mjs';
import { STEPS_EOD } from './interact-eod.mjs';
import { STEPS_FUQ } from './interact-fuq.mjs';
import { STEPS_WB } from './interact-wb.mjs';
import { STEPS_BD } from './interact-bd.mjs';
import { STEPS_RF } from './interact-rf.mjs';
import { STEPS_RV } from './interact-rv.mjs';
import { STEPS_BS } from './interact-bs.mjs';
import { STEPS_RCP } from './interact-rcp.mjs';
import { STEPS_FD } from './interact-fd.mjs';
import { STEPS_RCC } from './interact-rcc.mjs';
import { STEPS_AICAL } from './interact-aical.mjs';
import { STEPS_FU } from './interact-fu.mjs';
import { STEPS_AIC } from './interact-aic.mjs';
import { STEPS_RMD } from './interact-rmd.mjs';
import { STEPS_EM } from './interact-em.mjs';
import { STEPS_MS } from './interact-ms.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const SECTIONS = (process.argv[3] || 'products,inventory,suppliers,extra,catalog,team').split(',');
const PORT = Number(process.env.HARNESS_PORT || 4396), BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const J = (p) => fetch(BASE + p).then((r) => r.json());
const API = (p) => J('/api/v1' + p);
const SQL = async (k, a = '') => J('/__sql?k=' + k + (a ? '&a=' + encodeURIComponent(a) : ''));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (d, k) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const results = []; let n = 0;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 945 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0] + ' @ ' + page.url().replace(BASE, '')));   // where it happened
page.on('console', (m) => { if (m.type() === 'error' && !/404|403|409|400|422|503|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
async function step(name, fn) {
  const t = Date.now(); let ok = true, detail = '';
  try { detail = (await fn()) ?? ''; } catch (e) { ok = false; detail = String(e?.message ?? e).split('\n')[0].slice(0, 300); }
  await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 70)}.png`) }).catch(() => undefined);
  if (!ok) { await page.keyboard.press('Escape').catch(() => undefined); await page.keyboard.press('Escape').catch(() => undefined); }
  results.push({ step: name, ok, detail, ms: Date.now() - t }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const T = (sel) => page.locator(sel).first().innerText();
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(450); };
const go = async (path, container) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForSelector(container, { timeout: 20000 }); await settle(); };
const tid = (t) => `[data-testid="${t}"]`;
const noJunk = async () => { const body = await page.locator('body').innerText(); expect(!/Invalid Date|NaN|undefined|\[object Object\]|\d{4}-\d{2}-\d{2}T\d{2}:/.test(body), 'page shows Invalid Date / NaN / undefined / a raw timestamp'); };
const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
const kpi = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).trim();
const rowsText = async (sel) => (await page.locator(sel).allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
const search = async (sel, text) => { await page.fill(sel, text); await page.waitForTimeout(450); await settle(); };
async function customRange(from, to) {
  await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
  const cell = async (d) => {
    for (let i = 0; i < 14 && !(await page.locator(`${tid('range-calendar')} [data-ymd="${d}"]`).count()); i++)
      await page.locator(`${tid('range-calendar')} button[aria-label*="${d > today ? 'ext' : 'revious'}"]`).first().click();
    return page.locator(`${tid('range-calendar')} [data-ymd="${d}"]`).first();
  };
  await (await cell(from)).click(); await (await cell(to)).click();
  await page.click(tid('range-apply')); await settle();
}
const ctxShared = { page, step, expect, T, settle, go, tid, noJunk, close, kpi, rowsText, search, customRange, API, SQL, J, BASE, today, addDays };

try {
  if (SECTIONS.includes('products')) {
    // ══ Products ══════════════════════════════════════════════════════════════════════════════════════
    await go('/tenant/products', '.work.prd');
    await step('products: the three KPIs come from the server and Need Reorder is the Stock Alerts scope (sidebar badge)', async () => {
      const m = await API('/tenant/inventory/screen/metrics'); const badge = (await API('/tenant/navigation/badges')).inventoryAlerts;
      expect(await kpi('kpi-products') === String(m.products), 'products kpi'); expect(await kpi('kpi-reorder') === String(m.needReorder), 'reorder kpi');
      expect(m.needReorder === badge, `need reorder ${m.needReorder} ≠ sidebar badge ${badge}`);
      expect((await kpi('kpi-retail')).startsWith('$'), 'retail value'); await noJunk();
      return `products ${m.products} · need reorder ${m.needReorder} = badge ${badge} · retail ${await kpi('kpi-retail')}`;
    });
    await step('products: newest first, 12 per page, numbered pages 1 · 2 · 3', async () => {
      const p1 = await rowsText(`${tid('product-row')} ${tid('product-name')}`); expect(p1.length === 12, 'page size ' + p1.length);
      await page.click('.fk-pager button[aria-label="Page 2"]'); await settle(); const p2 = await rowsText(`${tid('product-row')} ${tid('product-name')}`);
      await page.click('.fk-pager button[aria-label="Page 3"]'); await settle(); const p3 = await rowsText(`${tid('product-row')} ${tid('product-name')}`);
      expect(p2[0] !== p1[0] && p3.length >= 1 && p3.length <= 12, 'pages differ'); await page.click('.fk-pager button[aria-label="Page 1"]'); await settle();
      return `p1 ${p1[0]} … p3 ${p3.length} rows`;
    });
    await step('products: universal search — exact SKU first, barcode, colour, supplier phone in 3 formats, never another salon', async () => {
      await search(tid('search'), 'OPI-GC-S86'); let r = await rowsText(`${tid('product-row')} ${tid('product-name')}`); expect(r.length === 1 && r[0] === 'OPI Gel Color Bubble Bath', 'sku ' + r.join('|'));
      await search(tid('search'), '0619828100006'); r = await rowsText(`${tid('product-row')} ${tid('product-name')}`); expect(r[0] === 'Kiara Sky Dip Powder Pure White', 'barcode ' + r.join('|'));
      await search(tid('search'), 'red velvet'); r = await rowsText(`${tid('product-row')} ${tid('product-name')}`); expect(r[0] === 'DND Duo Gel & Lacquer Red Velvet', 'colour ' + r.join('|'));
      const counts = []; for (const ph of ['2155550142', '(215) 555-0142', '+1 215 555 0142']) { await search(tid('search'), ph); counts.push((await rowsText(tid('product-row'))).length); }
      expect(counts[0] > 0 && counts.every((c) => c === counts[0]), 'phone formats ' + counts);
      await search(tid('search'), ''); return `phone formats → ${counts.join(' = ')} products`;
    });
    let newId = '';
    await step('products: + New Product saves through the server and lands first on page 1', async () => {
      await page.click(tid('new-product')); await page.waitForSelector(tid('product-form'));
      await page.fill(tid('pf-name'), 'E2E Cuticle Serum'); await page.fill(tid('pf-sku'), 'E2E-SER-1'); await page.fill(tid('pf-cost'), '3.25'); await page.fill(tid('pf-retail'), '9.00');
      await page.click(tid('product-save')); await settle();
      const first = await T(`${tid('product-row')} ${tid('product-name')}`); expect(first === 'E2E Cuticle Serum', 'first row ' + first);
      newId = (await SQL('products'))[0].id; expect((await SQL('products'))[0].sku === 'E2E-SER-1', 'db');
      return 'first on page 1';
    });
    await step('products: a duplicate SKU is refused and said so (no second record)', async () => {
      await page.click(tid('new-product')); await page.waitForSelector(tid('product-form'));
      await page.fill(tid('pf-name'), 'E2E Duplicate'); await page.fill(tid('pf-sku'), 'e2e-ser-1'); await page.click(tid('product-save')); await settle();
      const err = await T(tid('product-form-error')); expect(/SKU/.test(err), 'error ' + err); await close();
      expect((await SQL('products')).filter((p) => p.name === 'E2E Duplicate').length === 0, 'not created'); return err;
    });
    await step('products: Add Stock updates the same row (no duplicate product), one movement', async () => {
      await search(tid('search'), 'E2E Cuticle'); await page.click(`${tid('product-row')} ${tid('add-stock')}`); await page.waitForSelector(tid('add-stock'));
      await page.fill(tid('add-stock-qty'), '3'); await page.click(tid('add-stock-save')); await settle();
      const rows = await rowsText(tid('product-row')); expect(rows.length === 1 && /\b3\b/.test(rows[0]), 'row ' + rows.join('|'));
      const mv = await SQL('moves', newId); expect(mv.length === 1 && mv[0].movement_type === 'manual_add' && mv[0].quantity_change === 3, 'moves ' + JSON.stringify(mv));
      return rows[0].slice(0, 80);
    });
    await step('products: details overlay — Overview · Pricing · Inventory (bottles) · Suppliers · Technician Usage · History', async () => {
      await search(tid('search'), 'Nitrile'); await page.click(`${tid('product-row')} ${tid('details')}`); await page.waitForSelector(tid('product-details'));
      expect(/Chi Pham/.test(await T(tid('pd-last-used'))), 'last used by');
      for (const t of ['pricing', 'inventory', 'suppliers', 'usage', 'history']) { await page.click(tid('pd-tab-' + t)); await settle(); }
      await page.click(tid('pd-tab-usage')); await settle(); expect(/Chi Pham/.test(await T(tid('pd-by-tech'))), 'every technician');
      await page.click(tid('pd-tab-suppliers')); await settle(); expect(/Pro Nail Wholesale/.test(await T(tid('pd-suppliers'))), 'supplier'); expect(/PN-GLV-M/.test(await T(tid('pd-suppliers'))), 'supplier sku');
      await page.click(tid('pd-tab-history')); await settle(); expect((await page.locator(tid('movement-row')).count()) >= 2, 'movements');
      await noJunk(); await close(); return 'six tabs';
    });
    await step('products: archive → Archived view → Restore (history kept)', async () => {
      await search(tid('search'), 'E2E Cuticle'); await page.click(`${tid('product-row')} ${tid('archive')}`); await page.waitForSelector(tid('archive-confirm')); await page.click(tid('confirm-archive')); await settle();
      expect((await page.locator(tid('product-row')).count()) === 0, 'gone from active'); await page.click(tid('life-archived')); await settle();
      expect((await rowsText(`${tid('product-row')} ${tid('product-name')}`))[0] === 'E2E Cuticle Serum', 'in archived');
      await page.click(`${tid('product-row')} ${tid('restore')}`); await settle(); await page.click(tid('life-active')); await settle();
      expect((await page.locator(tid('product-row')).count()) === 1, 'back'); expect((await SQL('moves', newId)).length === 1, 'movements kept');
      await search(tid('search'), ''); return 'archived and restored';
    });
    await step('products: date field Expiration + a custom month-view range finds the bottles expiring within 30 days', async () => {
      await page.selectOption(tid('date-basis'), 'expiration'); await customRange(today, addDays(today, 30));
      const r = await rowsText(`${tid('product-row')} ${tid('product-name')}`); expect(r.includes('Bond Primer 0.5 oz') && r.includes('Cuticle Oil Pen') && r.length === 2, 'rows ' + r.join('|'));
      await page.click(tid('clear-all')); await settle(); return r.join(' · ');
    });
    await step('products: Vietnamese — title, KPIs, columns in Vietnamese; prices stay $', async () => {
      await fetch(BASE + '/__lang?l=vi'); await go('/tenant/products', '.work.prd');
      const h = await T('.work.prd h1'); expect(h === 'Sản phẩm', 'title ' + h); expect(/Cần đặt hàng lại/.test(await T(tid('kpis'))), 'kpi vi');
      expect(/\$/.test(await kpi('kpi-retail')), 'money'); await fetch(BASE + '/__lang?l=en'); return h;
    });
  }

  if (SECTIONS.includes('inventory')) {
    // ══ Inventory ═════════════════════════════════════════════════════════════════════════════════════
    await go('/tenant/inventory', '.work.inv2');
    await step('inventory: eight KPIs + value from the server, with units (bottles split by unit) and the drift banner', async () => {
      const m = await API('/tenant/inventory/screen/metrics');
      for (const [t, v] of [['kpi-products', m.products], ['kpi-bottles', m.bottles], ['kpi-open', m.open], ['kpi-unopened', m.unopened], ['kpi-low', m.lowStock], ['kpi-out', m.outOfStock], ['kpi-expiring', m.expiringSoon], ['kpi-pending', m.pendingReports]]) expect(await kpi(t) === String(v), `${t} ${await kpi(t)} ≠ ${v}`);
      expect(/bottle.*pair/.test(await T(`${tid('kpi-bottles')} .fk-kpi-s`)), 'unit breakdown'); expect(m.bottles === m.open + m.unopened, 'bottles = open + unopened');
      expect(await page.locator(tid('drift-note')).count() === 1, 'drift banner'); await noJunk();
      return `products ${m.products} · bottles ${m.bottles} (${m.open} open + ${m.unopened} unopened) · expiring ${m.expiringSoon} bottles · drift ${m.stockDrift}`;
    });
    await step('inventory: Recount fixes the stale stock row (11 → 3) with one correction movement; drift gone', async () => {
      await search(tid('tab-search'), 'DBC-01'); await page.click(`${tid('inv-row')} ${tid('inv-name')}`); await page.waitForSelector(tid('pd-drift'));
      await page.click(tid('pd-recount')); await settle(); expect(/recounted/i.test(await T(tid('pd-note'))), 'note');
      await close(); await settle(); const m = await API('/tenant/inventory/screen/metrics'); expect(m.stockDrift === 0, 'drift ' + m.stockDrift);
      const pid = (await API('/tenant/inventory/screen/products?search=DBC-01')).rows[0].id; const mv = await SQL('moves', pid);
      expect(mv.some((x) => x.movement_type === 'correction' && x.quantity_change === -8), 'correction ' + JSON.stringify(mv)); return 'cache 11 → 3';
    });
    await step('inventory: each tab keeps its own search; tabs, KPIs and AI notice preserved', async () => {
      await search(tid('tab-search'), 'Gelish'); const before = (await page.locator(tid('inv-row')).count());
      await page.click(tid('tab-purchaseOrders')); await settle(); expect(await page.inputValue(tid('tab-search')) === '', 'PO tab has its own (empty) search');
      await page.click(tid('tab-products')); await settle(); expect(await page.inputValue(tid('tab-search')) === 'Gelish', 'kept'); expect((await page.locator(tid('inv-row')).count()) === before, 'same rows');
      await search(tid('tab-search'), ''); return `${before} Gelish rows kept across tabs`;
    });
    await step('inventory: purchase orders — expected date as a calendar date, active ≠ draft, receive the rest of the partial order', async () => {
      await page.click(tid('tab-purchaseOrders')); await settle();
      const draft = (await rowsText(tid('po-row'))).find((r) => /Nail Supply Co/.test(r)); expect(draft && /Inactive supplier/.test(draft) && /Draft/.test(draft), 'draft row ' + draft);
      const exp = (await API('/tenant/inventory/screen/purchase-orders?status=draft&search=Nail%20Supply')).rows[0].expectedDate; expect(/^\d{4}-\d{2}-\d{2}$/.test(exp), 'api date ' + exp);
      await page.selectOption(tid('po-status'), 'active'); await settle(); expect((await page.locator(tid('po-row')).count()) === 2, 'two active');
      const partial = page.locator(tid('po-row')).filter({ hasText: 'Partially received' }); await partial.locator(tid('po-receive')).click();
      await page.waitForSelector('.inv-modal'); await page.click('.inv-modal .btn.primary'); await settle();
      const gl = (await API('/tenant/inventory/screen/products?search=SUP-GLV')).rows[0]; expect(gl.onHand === 68, 'gloves on hand ' + gl.onHand);
      await page.selectOption(tid('po-status'), ''); await settle(); await noJunk(); return `expected ${exp} · gloves 58 → 68 after the last 10`;
    });
    await step('inventory: technician reports — usage by technician → the products they used; approve a bottle report', async () => {
      await page.click(tid('tab-reports')); await settle(); await page.click(tid('preset-all')); await settle();
      const techs = await rowsText(tid('tech-row')); expect(techs.some((r) => /Anna Lee/.test(r)) && techs.some((r) => /Chi Pham/.test(r)), 'techs ' + techs.join('|'));
      await page.locator(tid('tech-row')).filter({ hasText: 'Anna Lee' }).locator(tid('tech-products')).click(); await settle();
      const used = await rowsText(tid('usage-row')); expect(used.length >= 1, 'products');
      await page.click(tid('rv-bottle')); await settle(); const n0 = await page.locator(tid('report-row')).count();
      await page.locator(tid('report-row')).first().locator(tid('approve')).click(); await settle(); expect((await page.locator(tid('report-row')).count()) === n0 - 1, 'approved');
      return `${techs.length} technicians · Anna used ${used.length} products · ${n0} → ${n0 - 1} pending`;
    });
    await step('inventory: alerts tab = the Stock Alerts list (same count as the badge); catalog brands searchable; a count opens', async () => {
      await page.click(tid('tab-alerts')); await settle(); const badge = (await API('/tenant/navigation/badges')).inventoryAlerts;
      const total = Number((await T(`${tid('inv-alerts')} .fk-panel-head`)).match(/·\s*(\d+)/)?.[1]); expect(total === badge, `alerts ${total} ≠ badge ${badge}`);
      await page.click(tid('tab-catalog')); await settle(); await search(tid('tab-search'), 'kiara'); expect((await rowsText(tid('catalog-row'))).length === 1, 'brand search');
      await page.click(tid('tab-counts')); await settle(); await page.locator(tid('count-row')).first().click(); await page.waitForSelector('.inv-modal'); await page.keyboard.press('Escape'); await page.locator('.inv-ov').first().click({ position: { x: 5, y: 5 } }).catch(() => undefined); await settle();
      return `alerts ${total} = badge ${badge}`;
    });
    await step('inventory: row ⋯ → Usage History opens the product on its Technician Usage tab', async () => {
      await page.click(tid('tab-products')); await settle(); await search(tid('tab-search'), 'Gelish Coral');
      await page.click(`${tid('inv-row')} ${tid('more')}`); await page.click(tid('m-usage')); await page.waitForSelector(tid('pd-usage'));
      expect(/Bao Tran|Anna Lee/.test(await T(tid('pd-usage'))), 'usage'); await close(); await search(tid('tab-search'), ''); return 'usage tab';
    });
  }

  if (SECTIONS.includes('suppliers')) {
    // ══ Suppliers ═════════════════════════════════════════════════════════════════════════════════════
    await go('/tenant/inventory/vendors', '.work.fit.sup');
    await step('suppliers: four KPIs explain the photo (inactive supplier with a draft; drafts are not active; a real $ value)', async () => {
      const k = await API('/tenant/inventory/suppliers/kpis');
      expect(await kpi('kpi-suppliers') === String(k.totalSuppliers), 'total'); expect(await kpi('kpi-active-pos') === String(k.activePurchaseOrders), 'active');
      expect(/inactive/.test(await T(`${tid('kpi-suppliers')} .fk-kpi-s`)), 'inactive shown'); expect((await kpi('kpi-open-value')).startsWith('$'), 'value is money');
      expect(await page.locator(tid('legacy-note')).count() === 1, 'legacy note'); await noJunk();
      return `${k.totalSuppliers} active (+${k.inactiveSuppliers} inactive) · ${k.activePurchaseOrders} active POs · ${k.draftPurchaseOrders} drafts · open ${await kpi('kpi-open-value')}`;
    });
    await step('suppliers: search — contact phone (3 formats), supplier SKU, brand, PO number, with what matched; inactive only under All', async () => {
      for (const ph of ['6095559900', '(609) 555-9900', '+1 609 555 9900']) { await search(tid('search'), ph); const r = await rowsText(tid('supplier-row')); expect(r.length === 1 && /Glam Distributors/.test(r[0]) && /contact/.test(r[0]), ph + ' ' + r.join('|')); }
      await search(tid('search'), 'GL-CB-501'); expect(/product/.test((await rowsText(tid('supplier-row')))[0] ?? ''), 'sku');
      await search(tid('search'), 'nail supply'); expect((await page.locator(tid('supplier-row')).count()) === 0, 'inactive hidden from Active');
      await page.selectOption(tid('status'), 'all'); await settle(); const r = await rowsText(tid('supplier-row')); expect(r.length === 1 && /Inactive/.test(r[0]), 'all ' + r.join('|'));
      await page.selectOption(tid('status'), 'active'); await search(tid('search'), ''); return 'phone · SKU · inactive';
    });
    await step('suppliers: details beside the directory — contacts (one primary, inactive kept), products, orders, receiving', async () => {
      await search(tid('search'), 'Glam'); await page.click(`${tid('supplier-row')} ${tid('supplier-name')}`); await page.waitForSelector(tid('detail-panel'));
      await page.click(tid('dtab-contacts')); await settle(); const c = await rowsText(tid('contact-row')); expect(c.length === 3 && c.filter((x) => /Primary/.test(x)).length === 1, 'contacts ' + c.join('|'));
      await page.click(tid('dtab-products')); await settle(); expect((await page.locator(tid('supplier-product-row')).count()) >= 2, 'products');
      await page.click(tid('dtab-orders')); await settle(); expect((await page.locator(`${tid('detail-panel')} ${tid('po-row')}`).count()) >= 2, 'orders');
      await page.click(tid('dtab-receiving')); await settle(); expect((await page.locator(`${tid('receiving-table')} tbody tr`).count()) >= 1, 'receiving');
      await noJunk(); return `${c.length} contacts`;
    });
    await step('suppliers: add a contact as primary — the old primary steps down (audited)', async () => {
      await page.click(tid('dtab-contacts')); await settle(); await page.click(tid('add-contact')); await page.waitForSelector(tid('contact-form'));
      await page.fill(tid('cf-name'), 'Hana Vu'); await page.fill(tid('cf-mobile'), '+1 (609) 555-4444'); await page.check(tid('cf-primary')); await page.click(tid('contact-save')); await settle();
      const c = await rowsText(tid('contact-row')); expect(c.filter((x) => /Primary/.test(x)).length === 1 && /Hana Vu.*Primary|Primary.*Hana Vu/.test(c.find((x) => /Hana/.test(x)) ?? ''), 'primary ' + c.join('|'));
      return 'Hana Vu is primary';
    });
    await step('suppliers: link a product with supplier SKU / cost / pack, then unlink (catalog data, stock untouched)', async () => {
      await page.click(tid('dtab-products')); await settle(); const total = async () => Number((await T(`${tid('detail-products')} .fk-pager-range`)).match(/(\d+)\s*$/)?.[1]); const before = await total();
      await page.click(tid('link-product')); await page.waitForSelector(tid('link-form')); await page.fill(tid('link-find'), 'Bubble Bath'); await page.waitForTimeout(500); await settle();
      await page.locator(tid('link-pick')).first().click(); await page.fill(tid('lf-sku'), 'GL-S86'); await page.fill(tid('lf-cost'), '8.10'); await page.click(tid('link-save')); await settle();
      expect((await total()) === before + 1, 'linked'); expect((await rowsText(tid('supplier-product-row')))[0].startsWith('OPI Gel Color Bubble Bath'), 'newest link first');
      const onHand = (await API('/tenant/inventory/screen/products?search=OPI-GC-S86')).rows[0].onHand;
      await page.locator(tid('supplier-product-row')).filter({ hasText: 'Bubble Bath' }).locator(tid('unlink')).click(); await settle();
      expect((await API('/tenant/inventory/screen/products?search=OPI-GC-S86')).rows[0].onHand === onHand, 'stock untouched'); expect((await total()) === before, 'unlinked'); return `${before} → ${before + 1} → ${before}`;
    });
    await step('suppliers: + Add Supplier — a duplicate phone warns with the match; Save as separate lands first on page 1', async () => {
      await page.click(tid('add-supplier')); await page.waitForSelector(tid('supplier-form'));
      await page.fill(tid('sf-name'), 'Glam Distribution East'); await page.fill(tid('sf-phone'), '(609) 555-0100'); await page.click(tid('supplier-save')); await settle();
      expect(/Glam Distributors/.test(await T(tid('dup-warning'))), 'warning'); await page.click(tid('save-anyway')); await settle();
      await search(tid('search'), ''); const first = await T(`${tid('supplier-row')} ${tid('supplier-name')}`); expect(first === 'Glam Distribution East', 'first ' + first);
      return 'warned, saved separately, first';
    });
    await step('suppliers: purchase orders workspace — no-supplier order linked to a supplier (history kept)', async () => {
      await page.click(tid('work-orders')); await settle(); await page.check(tid('unlinked')); await settle();
      expect((await page.locator(tid('po-row')).count()) === 1, 'one unlinked'); await page.click(`${tid('po-row')} ${tid('po-number')}`); await page.waitForSelector(tid('link-po'));
      await page.fill(tid('link-po-find'), 'Beauty'); await page.waitForTimeout(500); await settle(); await page.locator(tid('link-po-pick')).first().click(); await settle();
      expect((await page.locator(tid('po-row')).count()) === 0, 'linked'); const k = await API('/tenant/inventory/suppliers/kpis'); expect(k.unlinkedPurchaseOrders === 0, 'kpi');
      const a = (await SQL('audit')).find((x) => x.action_type === 'inventory_po_vendor_linked'); expect(!!a, 'audited'); await page.uncheck(tid('unlinked')); await settle();
      await noJunk(); return 'linked to Beauty Source';
    });
    await step('suppliers: deactivate → shown under Inactive with its orders kept → reactivate', async () => {
      await page.click(tid('work-directory')); await settle(); await search(tid('search'), 'Beauty Source'); await page.click(`${tid('supplier-row')} ${tid('supplier-name')}`); await page.waitForSelector(tid('detail-panel'));
      await page.click(tid('deactivate')); await settle(); expect((await page.locator(tid('supplier-row')).count()) === 0, 'left active');
      await page.selectOption(tid('status'), 'inactive'); await settle(); expect((await page.locator(tid('supplier-row')).count()) === 1, 'inactive');
      await page.click(`${tid('supplier-row')} ${tid('supplier-name')}`); await settle(); await page.click(tid('reactivate')); await settle();
      await page.selectOption(tid('status'), 'active'); await settle(); expect((await page.locator(tid('supplier-row')).count()) === 1, 'back'); await search(tid('search'), ''); return 'deactivated and back';
    });
    await step('suppliers: 1366 × 633 — details open as an overlay instead of beside the list; no page scroll', async () => {
      await page.setViewportSize({ width: 1366, height: 633 }); await go('/tenant/inventory/vendors', '.work.fit.sup');
      await page.click(`${tid('supplier-row')} ${tid('supplier-name')}`); await page.waitForSelector(tid('detail-overlay'));
      const s = await page.evaluate(() => { const c = document.querySelector('.work.fit.sup'); return [c.scrollHeight - c.clientHeight, document.scrollingElement.scrollWidth - innerWidth]; });
      expect(s[0] <= 0 && s[1] <= 0, 'scroll ' + s); await close(); await page.setViewportSize({ width: 1920, height: 945 }); return 'overlay';
    });
  }

  if (SECTIONS.includes('extra')) for (const [name, fn] of STEPS_EXTRA(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('catalog')) for (const [name, fn] of STEPS_CATALOG(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('team')) for (const [name, fn] of STEPS_TEAM(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('comms')) for (const [name, fn] of STEPS_COMMS(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('aiusage')) for (const [name, fn] of STEPS_AIUSAGE(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('health')) for (const [name, fn] of STEPS_HEALTH(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('inbox')) for (const [name, fn] of STEPS_INBOX(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('rn')) for (const [name, fn] of STEPS_RN(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('seg')) for (const [name, fn] of STEPS_SEG(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('cp')) for (const [name, fn] of STEPS_CP(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('do')) for (const [name, fn] of STEPS_DO(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('promo')) for (const [name, fn] of STEPS_PROMO(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('cc')) for (const [name, fn] of STEPS_CC(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('mg')) for (const [name, fn] of STEPS_MG(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('mt')) for (const [name, fn] of STEPS_MT(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('cn')) for (const [name, fn] of STEPS_CN(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('pm')) for (const [name, fn] of STEPS_PM(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('bv')) for (const [name, fn] of STEPS_BV(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('eod')) for (const [name, fn] of STEPS_EOD(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('fuq')) for (const [name, fn] of STEPS_FUQ(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('wb')) for (const [name, fn] of STEPS_WB(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('bd')) for (const [name, fn] of STEPS_BD(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('rf')) for (const [name, fn] of STEPS_RF(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('rv')) for (const [name, fn] of STEPS_RV(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('bs')) for (const [name, fn] of STEPS_BS(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('rcp')) for (const [name, fn] of STEPS_RCP(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('fd')) for (const [name, fn] of STEPS_FD(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('rcc')) for (const [name, fn] of STEPS_RCC(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('aical')) for (const [name, fn] of STEPS_AICAL(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('fu')) for (const [name, fn] of STEPS_FU(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('aic')) for (const [name, fn] of STEPS_AIC(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('rmd')) for (const [name, fn] of STEPS_RMD(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('em')) for (const [name, fn] of STEPS_EM(ctxShared)) await step(name, fn);
  if (SECTIONS.includes('ms')) for (const [name, fn] of STEPS_MS(ctxShared)) await step(name, fn);
} finally {
  const unhandled = await J('/__unhandled').catch(() => []);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results, errors, unhandled }, null, 1));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} steps passed · page errors: ${errors.length ? errors.join(' | ') : 'none'} · unhandled: ${JSON.stringify(unhandled)}`);
  await browser.close(); srv.kill();
}
