#!/usr/bin/env node
// customer-display-layout.mjs — 23-inch dual-screen spec §121 ("Test screenshot/visual regression at 1920×1080,
// 1600×900, 1366×768 [Dual-Screen mandate §94: and 1280×800; and the longer Vietnamese words, §119] — no clipped controls, no hidden total, no overlapping cards, no horizontal page scroll, no
// vertical primary-page scroll, number pad remains usable, tip buttons remain usable, advertisement maintains aspect
// ratio"), in a REAL browser (Chromium) against the BUILT display app.
//
// The server is replaced by canned, customer-safe responses (page.route) so every screen is reproducible: idle with the
// salon's ads, an appointment found, a walk-in with services, the check-in result, a normal ticket, a 24-line ticket,
// a payment in flight, the completed summary, and full-screen idle ads. Each screen is checked by measurement (not by
// eye) and photographed into $SHOTS.
//   node tooling/e2e/customer-display-layout.mjs            (DISPLAY_DIST defaults to apps/customer-display/dist)
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = require(join(ROOT, 'node_modules', 'playwright'));
const { PNG } = require(join(ROOT, 'node_modules', 'pngjs'));
const DIST = process.env.DISPLAY_DIST || join(ROOT, 'apps', 'customer-display', 'dist');
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'display-layout-')); mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.PORT_UI || 4188);
if (!existsSync(join(DIST, 'index.html'))) { console.error(`no built display app at ${DIST} — run: (cd apps/customer-display && npx vite build)`); process.exit(2); }

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const b = '/opt/pw-browsers';
  if (existsSync(b)) for (const d of readdirSync(b).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) for (const s of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = `${b}/${d}/${s}`; if (existsSync(p)) return p; }
  return undefined;
}

// ── canned pictures: a tall promo (the recommended 2:3 panel creative) and a landscape full-screen creative ─────────────
function picture(w, h, hue) {
  const img = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const band = Math.floor(y / (h / 8)) % 2 === 0;
    img.data[i] = Math.min(255, hue[0] + (y * 60) / h); img.data[i + 1] = Math.min(255, hue[1] + (x * 40) / w + (band ? 10 : 0)); img.data[i + 2] = hue[2]; img.data[i + 3] = 255;
  }
  return PNG.sync.write(img);
}
const IMG = {
  '/media/display-ads/a1/medium.png': picture(720, 1080, [150, 70, 60]),
  '/media/display-ads/a1/large.png': picture(1280, 1920, [150, 70, 60]),
  '/media/display-ads/a2/medium.png': picture(720, 1080, [60, 90, 130]),
  '/media/display-ads/a2/large.png': picture(1280, 1920, [60, 90, 130]),
  '/media/display-ads/a2/full.png': picture(1920, 1080, [60, 90, 130]),
  '/media/salon-logos/t/logo-0123456789abcdef01234567.png': picture(320, 120, [190, 150, 80]),
};

const AD = (id, headline, full) => ({
  id, version: 1, fit: 'cover', focalX: 0.5, focalY: 0.4, durationSeconds: 8,
  image: { url: `/media/display-ads/${id}/medium.png`, width: 720, height: 1080 },
  imageLarge: { url: `/media/display-ads/${id}/large.png`, width: 1280, height: 1920 },
  fullscreenImage: full ? { url: `/media/display-ads/${id}/full.png`, width: 1920, height: 1080 } : null,
  headline, subheadline: headline ? 'Relax • Refresh • Renew' : null, description: headline ? '$10 off Monday–Thursday' : null,
  ctaText: headline ? 'Ask your technician today' : null, qr: headline ? { label: 'Book online', url: 'https://book.example.com/luxury' } : null,
});
const PLAYLIST = (fullScreen) => ({
  enabled: true, offReason: null, ads: [AD('a1', 'Deluxe spa pedicure', false), AD('a2', null, true)],
  fullScreenIdle: { enabled: fullScreen, afterSeconds: 30 }, playlistVersion: 'v1', generatedAt: new Date().toISOString(), refreshAfterSeconds: 900, validUntil: null,
});
const BRANDING = { salonName: 'Luxury Nails', logoUrl: '/media/salon-logos/t/logo-0123456789abcdef01234567.png', tagline: 'Luxury for every hand', branchName: 'Cherry Hill', idleMessage: 'Ready for our next guest' };
const TIPS = (sub) => [15, 18, 20, 25].map((p) => ({ label: `${p}%`, tipType: 'percent', percent: p, amountCents: Math.round(sub * p / 100), selected: p === 20 }));
const LINE = (name, tech, cents, kind = 'service', quantity = 1, originalCents) => ({ kind, name, ...(tech ? { technicianName: tech } : {}), quantity, amountCents: cents, ...(originalCents ? { originalCents } : {}) });
const CHECKOUT = (lines) => {
  const items = lines.reduce((a, l) => a + l.amountCents, 0);
  return {
    ticketNumber: '#12', date: new Date().toISOString(), lines,
    adjustments: [{ kind: 'membership', label: 'VIP Membership', amountCents: 1000 }, { kind: 'loyalty', label: 'Loyalty Reward', amountCents: 500 }],
    itemsSubtotalCents: items, discountCents: 1500, taxCents: 868, customerFeeCents: 0, tipCents: 2172, giftCardSaleCents: 0,
    totalCents: items - 1500 + 868 + 2172, paidCents: 0, balanceDueCents: items - 1500 + 868 + 2172, payments: [], paymentStatus: 'unpaid', paymentMethod: 'card',
  };
};
const SPEC_LINES = [LINE('Gel Manicure', 'Olivia', 4500), LINE('Spa Pedicure', 'Lisa', 6000), LINE('French Tip', 'Olivia', 1000, 'add_on'), LINE('Cuticle Oil', null, 1200, 'product')];
const LONG_LINES = Array.from({ length: 24 }, (_, i) => LINE(['Gel Manicure', 'Spa Pedicure', 'Nail Art — per nail', 'Paraffin Dip', 'Cuticle Oil'][i % 5], i % 5 === 4 ? null : ['Olivia', 'Lisa', 'Mia'][i % 3], 1000 + i * 150, i % 5 === 4 ? 'product' : i % 3 === 2 ? 'add_on' : 'service', i % 5 === 4 ? 2 : 1, i % 7 === 0 ? 1400 + i * 150 : undefined));
const STATE = (o = {}) => ({ state: 'idle', salonName: 'Luxury Nails', branding: BRANDING, tipOptions: [], selectedTipCents: 0, totals: { subtotalCents: 0, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 0 }, payButtonEnabled: false, checkIn: true, ...o });
const CHECKOUT_STATE = (lines, o = {}) => { const c = CHECKOUT(lines); return STATE({ state: 'tip_selected', sessionId: 's1', version: 1, customer: { firstName: 'Sophia' }, checkout: c, tipOptions: TIPS(c.itemsSubtotalCents - 1500), selectedTipCents: 2172, totals: { subtotalCents: c.itemsSubtotalCents - 1500, tipCents: 2172, taxCents: 868, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: c.totalCents, paymentMethod: 'card' }, ...o }); };

const KIOSK = { sessionId: 'k1', sessionToken: 'kt', config: { salonName: 'Luxury Nails', branchName: 'Cherry Hill', settings: { enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true, serviceSelectionEnabled: true, technicianPreferenceEnabled: true, tenantPhoneLookupEnabled: true, centralLookupEnabled: false, customerLinkingEnabled: true, showWaitEstimate: true, autoSendToQueue: true, requireFrontDeskApproval: false, confirmationTimeoutSeconds: 10 } } };
// the branch's menu as the Unit 7 API answers it: seven services (more than the six tiles shown) and two add-ons
const SERVICES = { services: [
  ...['Gel Manicure', 'Spa Pedicure', 'Acrylic Fill', 'Builder Gel', 'Dip Powder', 'Polish Change', 'Gel Removal'].map((n, i) => ({ id: `s${i}`, name: n, priceCents: [4500, 6000, 5500, 6500, 5000, 2000, 1500][i], durationMinutes: 45, category: i === 1 ? 'Pedicure' : 'Manicure', isAddOn: false })),
  ...['Nail Art', 'Paraffin Dip'].map((n, i) => ({ id: `a${i}`, name: n, priceCents: [1500, 1200][i], durationMinutes: 15, category: 'Add-ons', isAddOn: true })),
] };
const TECHS = { technicians: [{ technicianId: 't2', name: 'Lisa', fromLabel: 'From 2:00 PM' }, { technicianId: 't1', name: 'Olivia' }] };
// §16–§17: a visit of two appointments, three services — compact rows, then "+ 1 more"
const VISIT = { appointmentId: 'a1', startTimeLabel: '11:00 AM', serviceName: 'Gel Manicure', technicianName: 'Olivia', items: [
  { serviceName: 'Gel Manicure', technicianName: 'Olivia', startTimeLabel: '11:00 AM' }, { serviceName: 'Spa Pedicure', technicianName: 'Lisa', startTimeLabel: '11:00 AM' },
  { serviceName: 'Paraffin Dip', technicianName: 'Lisa', startTimeLabel: '11:00 AM' }] };

// ── a static server for the built app (same origin; every API path is answered by page.route) ─────────────────────────
const srv = http.createServer((req, res) => {
  let f = join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html');
  const type = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
  res.writeHead(200, { 'content-type': type }); createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

const browser = await chromium.launch({ executablePath: chromiumPath() });
// Dual-Screen mandate §14/§94 (Oct 12 2026): the portable 16:10 monitor's 1280×800 too
const SIZES = [[1920, 1080], [1600, 900], [1366, 768], [1280, 800]];

async function open(size, state, { fullScreen = false, lookup = null, walkIn = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const fontHosts = []; page.on('request', (r) => { const h = new URL(r.url()).hostname; if (/fonts\.(googleapis|gstatic)\.com$/.test(h)) fontHosts.push(h); });
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/\/media\//, (route) => { const p = new URL(route.request().url()).pathname; const b = IMG[p]; return b ? route.fulfill({ status: 200, contentType: 'image/png', body: b }) : route.fulfill({ status: 404, body: '' }); });
  await page.route(/\/customer-display\/device\/stream/, (route) => route.abort());
  await page.route(/\/customer-display\/device\/ads\/displays/, (route) => json(route, { accepted: 1, duplicate: false }));
  await page.route(/\/customer-display\/device\/ads(\?|$)/, (route) => json(route, PLAYLIST(fullScreen)));
  await page.route(/\/customer-display\/device\/current/, (route) => json(route, state));
  await page.route(/\/customer-display\/device\/check-in\/session/, (route) => json(route, KIOSK));   // the display's own check-in (Unit 7)
  await page.route(/\/go-check-in\/session\/[^/]+\/complete/, (route) => json(route, { ok: true }));
  await page.route(/\/go-check-in\/session\/[^/]+\/heartbeat/, (route) => json(route, { ok: true }));
  await page.route(/\/go-check-in\/session\/[^/]+\/services/, (route) => json(route, SERVICES));
  await page.route(/\/go-check-in\/session\/[^/]+\/technicians/, (route) => json(route, TECHS));
  await page.route(/\/go-check-in\/session\/[^/]+\/lookup-phone/, (route) => json(route, lookup ?? { match: null, foundInTenant: false, appointment: null, canWalkIn: true, canCreate: true }));
  await page.route(/\/go-check-in\/session\/[^/]+\/check-in-appointment/, (route) => json(route, { status: 'checked_in', firstName: 'Sophia', estimatedWaitMinutes: 25, estimatedWait: { fromMinutes: 25, toMinutes: 35 }, appointmentsCheckedIn: 2, checkInId: 'ci1' }));
  await page.route(/\/go-check-in\/session\/[^/]+\/check-in-walk-in/, (route) => json(route, walkIn ?? { status: 'checked_in', firstName: 'Alex', estimatedWaitMinutes: 15, estimatedWait: { fromMinutes: 15, toMinutes: 25 }, checkInId: 'ci2' }));
  await page.route(/\/go-check-in\/session\/[^/]+\/place-in-line/, (route) => json(route, { position: 3, waitingAhead: 2 }));
  await page.goto(`${BASE}/?device=layout-test-token`);
  await page.locator('[data-testid="display-23"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors, fontHosts };
}

/** §121 measurements on whatever is on screen. */
async function measure(page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight, se = document.scrollingElement;
    const r = (el) => el.getBoundingClientRect();
    const visible = (el) => { const b = r(el); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
    // a control is clipped when it sticks out of the viewport, or out of a card that hides its overflow (and is not
    // inside a deliberately scrolling list)
    const clipped = [];
    for (const el of document.querySelectorAll('button, input, select')) {
      if (!visible(el)) continue;
      const b = r(el);
      if (b.left < -1 || b.top < -1 || b.right > vw + 1 || b.bottom > vh + 1) { clipped.push(`${el.textContent?.trim().slice(0, 30) || el.tagName} out of viewport`); continue; }
      const scroller = el.closest('.ck-lines, .d23-svc-grid.all, .kiosk-lines');
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (scroller && (p === scroller || scroller.contains(p))) continue;
        const cs = getComputedStyle(p);
        if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const pb = r(p);
        if (b.top < pb.top - 1 || b.bottom > pb.bottom + 1 || b.left < pb.left - 1 || b.right > pb.right + 1) { clipped.push(`${el.textContent?.trim().slice(0, 30) || el.tagName} clipped by .${(p.className || p.tagName).toString().split(' ')[0]}`); break; }
      }
    }
    const small = [...document.querySelectorAll('button')].filter(visible).filter((el) => { const b = r(el); return b.height < 43.5 || b.width < 43.5; }).map((el) => `${el.textContent?.trim().slice(0, 24)} ${Math.round(r(el).width)}×${Math.round(r(el).height)}`);
    const boxes = ['.d23-col-left', '.d23-col-center', '.d23-right', '.d23-head', '.d23-foot'].map((s) => document.querySelector(s)).filter(Boolean).map((el) => ({ s: el.className.split(' ')[0], b: r(el) }));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b, c = boxes[j].b;
      const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (ix > 1 && iy > 1) overlaps.push(`${boxes[i].s}×${boxes[j].s}`);
    }
    const due = document.querySelector('.ck-due');
    const dueBox = due ? r(due) : null;
    const panel = document.querySelector('.d23-right')?.getBoundingClientRect();
    const keys = [...document.querySelectorAll('.d23-key')].filter(visible).map(r);
    const tips = [...document.querySelectorAll('.kiosk-tip-opt, .kiosk-tip-row button')].filter(visible).map(r);
    const imgs = [...document.querySelectorAll('.d23-right img, .d23-fullscreen img')].filter(visible).map((im) => ({ fit: getComputedStyle(im).objectFit, nat: im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 0 }));
    // Oct 6 2026: text whose own box is shorter than its line — clipped at the bottom (the y / p / g of "Acrylic", "Spa",
    // "Dip" were cut off in every service tile once the real typeface loaded)
    const cutText = [...document.querySelectorAll('[data-testid="display-23"] *')].filter(visible).filter((el) => { const cs = getComputedStyle(el); return el.childElementCount === 0 && el.textContent.trim() && (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 1; }).map((el) => `${el.textContent.trim().slice(0, 24)} (${el.clientHeight}/${el.scrollHeight}px)`);
    const list = document.querySelector('.ck-lines');
    const lb = list ? r(list) : null;
    const lines = list ? [...list.querySelectorAll('.ck-line')].map(r) : [];
    const linesShown = lb ? lines.filter((b) => b.top >= lb.top - 1 && b.bottom <= lb.bottom + 1).length : 0;
    const textOverflow = [...document.querySelectorAll('.d23-welcome span, .d23-appt-name, .ck-line-name, .d23-walkin-title, .d23-result-text .t, .kiosk-h')].filter(visible).filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).textOverflow !== 'ellipsis').map((el) => el.textContent.trim().slice(0, 30));
    return {
      pageScroll: { h: se.scrollHeight - vh, w: se.scrollWidth - vw }, clipped, small, overlaps,
      due: dueBox ? { inView: dueBox.top >= 0 && dueBox.bottom <= vh + 1 && dueBox.right <= vw + 1, inPanel: panel ? dueBox.bottom <= panel.bottom + 1 && dueBox.top >= panel.top - 1 : true, h: Math.round(dueBox.height) } : null,
      keys: { n: keys.length, minW: Math.round(Math.min(...keys.map((k) => k.width), 999)), minH: Math.round(Math.min(...keys.map((k) => k.height), 999)) },
      tips: { n: tips.length, minH: Math.round(Math.min(...tips.map((k) => k.height), 999)) },
      imgs, textOverflow, cutText, lines: { total: lines.length, shown: linesShown, shortPx: lb && lines.length ? Math.max(0, Math.ceil(Math.max(...lines.map((b) => b.bottom)) - lb.bottom)) : 0 },
    };
  });
}

function assertScreen(label, m, { expectKeys = false, expectTips = false, expectDue = false, expectAdImage = false, allLines = false } = {}) {
  if (allLines) check(`${label}: a normal ticket shows every line without scrolling (§93)`, m.lines.total > 0 && m.lines.shown === m.lines.total, `${m.lines.shown}/${m.lines.total} lines in view${m.lines.shortPx ? `, ${m.lines.shortPx}px short` : ''}`);
  check(`${label}: no page scroll`, m.pageScroll.h <= 1 && m.pageScroll.w <= 1, `overflow v=${m.pageScroll.h}px h=${m.pageScroll.w}px`);
  check(`${label}: no clipped controls`, m.clipped.length === 0, m.clipped.slice(0, 3).join('; '));
  check(`${label}: every button ≥ 44×44`, m.small.length === 0, m.small.slice(0, 3).join('; '));
  check(`${label}: no overlapping columns`, m.overlaps.length === 0, m.overlaps.join(', '));
  check(`${label}: no cut-off headings`, m.textOverflow.length === 0, m.textOverflow.join(', '));
  check(`${label}: no text cut off at the bottom (descenders)`, m.cutText.length === 0, m.cutText.slice(0, 4).join(', '));
  if (expectKeys) check(`${label}: number pad usable (12 keys ≥ 44 px)`, m.keys.n === 12 && m.keys.minW >= 44 && m.keys.minH >= 44, `${m.keys.n} keys, min ${m.keys.minW}×${m.keys.minH}`);
  if (expectTips) check(`${label}: tip buttons usable`, m.tips.n >= 6 && m.tips.minH >= 44, `${m.tips.n} buttons, min height ${m.tips.minH}`);
  if (expectDue) check(`${label}: TOTAL DUE on screen`, !!m.due && m.due.inView && m.due.inPanel, m.due ? `height ${m.due.h}px` : 'missing');
  if (expectAdImage) check(`${label}: the ad keeps its aspect ratio (cover/contain, never stretched)`, m.imgs.length > 0 && m.imgs.every((i) => i.fit === 'cover' || i.fit === 'contain'), m.imgs.map((i) => i.fit).join(','));
}

try {
  for (const size of SIZES) {
    const tag = `${size[0]}×${size[1]}`;
    // 1) idle: check-in left/centre, the salon's ad right
    {
      const { ctx, page, errors, fontHosts } = await open(size, STATE());
      await page.locator('.d23-right img').first().waitFor({ timeout: 10000 });
      // Oct 6 2026: the two typefaces ship with the app — loaded with no font CDN (this machine has no internet, so a
      // loaded face can only have come from the app itself)
      const fonts = await page.evaluate(async () => { await document.fonts.ready; return { loaded: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/["']/g, '')} ${f.weight}`))], body: getComputedStyle(document.body).fontFamily }; });
      check(`${tag} idle: the display's own typefaces are loaded, from the app (no font CDN)`, ['Hanken Grotesk 400', 'Hanken Grotesk 700', 'Playfair Display 700'].every((f) => fonts.loaded.includes(f)) && /^["']?Hanken Grotesk/.test(fonts.body) && fontHosts.length === 0,
        `loaded: ${fonts.loaded.join(', ') || 'none'}; body: ${fonts.body}; CDN requests: ${fontHosts.length}`);
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(SHOTS, `${tag}-1-idle-ads.png`) });
      assertScreen(`${tag} idle + ad`, await measure(page), { expectKeys: true, expectAdImage: true });
      check(`${tag} idle: the salon's brand heads the screen`, (await page.locator('.d23-head .salon-name').textContent()) === 'Luxury Nails' && (await page.locator('.d23-head img.salon-logo').count()) === 1);
      // 2) a phone typed → appointment found
      for (const d of '8565550142') await page.getByRole('button', { name: d, exact: true }).first().click();
      await page.route(/\/go-check-in\/session\/[^/]+\/lookup-phone/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ match: { source: 'tenant', firstName: 'Sophia', lastInitial: 'L', customerId: 'c1' }, foundInTenant: true, appointment: VISIT, canWalkIn: true, canCreate: false }) }));
      await page.getByRole('button', { name: 'Find My Appointment' }).click();
      await page.getByText('Appointment Found').waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, `${tag}-2-appointment-found.png`) });
      assertScreen(`${tag} appointment found (a visit, compact)`, await measure(page), { expectKeys: true });
      await page.getByRole('button', { name: '+ 1 more' }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${tag}-2b-visit-opened.png`) });
      assertScreen(`${tag} the visit opened ("+ 1 more")`, await measure(page), { expectKeys: true });
      // 3) I'm Here → the result footer
      await page.getByRole('button', { name: "I'm Here" }).click();
      await page.getByText('You’re checked in!').waitFor();
      await page.getByText(/#3/).waitFor();
      await page.screenshot({ path: join(SHOTS, `${tag}-3-checked-in.png`) });
      assertScreen(`${tag} checked in`, await measure(page), { expectKeys: true });
      check(`${tag} checked in: what was typed is gone (privacy)`, (await page.locator('.d23-phone .val.ph').count()) === 1 && (await page.getByText('Appointment Found').count()) === 0);
      check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
    // 4) a walk-in choosing services and a technician
    {
      const { ctx, page } = await open(size, STATE());
      for (const d of '8565550199') await page.getByRole('button', { name: d, exact: true }).first().click();
      await page.getByRole('button', { name: 'Find My Appointment' }).click();
      await page.getByText('No appointment found').waitFor();
      await page.getByPlaceholder('First name').fill('Alex');
      await page.getByRole('button', { name: /Gel Manicure/ }).click();
      await page.getByRole('button', { name: /Spa Pedicure/ }).click();
      await page.getByRole('button', { name: /^Nail Art/ }).click();   // an add-on, with a service (§20)
      await page.getByRole('button', { name: 'View all services' }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${tag}-4-walk-in.png`) });
      assertScreen(`${tag} walk-in`, await measure(page), { expectKeys: true });
      await ctx.close();
    }
    // 5) checkout: the spec's §33 ticket and a 24-line ticket
    for (const [name, lines] of [['5-checkout', SPEC_LINES], ['6-checkout-24-lines', LONG_LINES]]) {
      const { ctx, page } = await open(size, CHECKOUT_STATE(lines));
      await page.locator('[data-testid="checkout-panel"]').waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`) });
      assertScreen(`${tag} ${name}`, await measure(page), { expectKeys: true, expectTips: true, expectDue: true, allLines: lines === SPEC_LINES });
      check(`${tag} ${name}: the ad is gone from the panel (not covered)`, (await page.locator('.d23-right .aps-adslide').count()) === 0);
      await ctx.close();
    }
    // 6) customer pays on the display (method + Pay button) — the tallest checkout panel
    {
      const { ctx, page } = await open(size, CHECKOUT_STATE(SPEC_LINES, { payButtonEnabled: true }));
      await page.locator('[data-testid="checkout-panel"]').waitFor();
      await page.screenshot({ path: join(SHOTS, `${tag}-7-checkout-pay.png`) });
      assertScreen(`${tag} customer-pays checkout`, await measure(page), { expectTips: true, expectDue: true, allLines: true });
      await ctx.close();
    }
    // 7) payment in flight, and the completed summary
    for (const [name, st] of [['8-processing', CHECKOUT_STATE(SPEC_LINES, { state: 'payment_processing' })], ['9-completed', CHECKOUT_STATE(SPEC_LINES, { state: 'payment_success', checkout: { ...CHECKOUT(SPEC_LINES), paymentStatus: 'paid', paidCents: 14240, balanceDueCents: 0, loyaltyPointsEarned: 120 } })]]) {
      const { ctx, page } = await open(size, st);
      await page.locator('[data-testid="checkout-panel"]').waitFor();
      await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`) });
      assertScreen(`${tag} ${name}`, await measure(page), { expectKeys: true });
      await ctx.close();
    }
  }
  // 8b) Dual-Screen mandate §119: Vietnamese (the longer words) fits at every size — check-in, a walk-in, the tallest checkout
  for (const size of SIZES) {
    const tag = `${size[0]}×${size[1]} vi`;
    const VI = { languages: ['vi', 'en'] };
    {
      const { ctx, page, errors } = await open(size, STATE(VI));
      await page.getByText('Đăng ký tại đây').waitFor({ timeout: 10000 });
      check(`${tag}: the guest's language switch is offered`, (await page.getByRole('button', { name: 'Tiếng Việt' }).count()) === 1 && (await page.getByRole('button', { name: 'English' }).count()) === 1);
      assertScreen(`${tag} idle + ad`, await measure(page), { expectKeys: true });
      for (const d of '8565550199') await page.getByRole('button', { name: d, exact: true }).first().click();
      await page.getByRole('button', { name: 'Tìm lịch hẹn của tôi' }).click();
      await page.getByText('Không tìm thấy lịch hẹn').waitFor();
      await page.getByPlaceholder('Tên').fill('Alex');
      await page.getByRole('button', { name: /Gel Manicure/ }).click();
      await page.getByRole('button', { name: /^Nail Art/ }).click();
      await page.getByRole('button', { name: 'Xem tất cả dịch vụ' }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(SHOTS, `${size[0]}×${size[1]}-vi-walk-in.png`) });
      assertScreen(`${tag} walk-in`, await measure(page), { expectKeys: true });
      check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page } = await open(size, CHECKOUT_STATE(SPEC_LINES, { payButtonEnabled: true, ...VI }));
      await page.locator('[data-testid="checkout-panel"]').waitFor();
      await page.getByText('Quý khách muốn thêm tip?').waitFor();
      await page.screenshot({ path: join(SHOTS, `${size[0]}×${size[1]}-vi-checkout-pay.png`) });
      assertScreen(`${tag} customer-pays checkout`, await measure(page), { expectTips: true, expectDue: true, allLines: true });
      await ctx.close();
    }
  }
  // 8) §7 full-screen idle ads (30 s without a touch), and a touch returns to check-in — once, at 1920×1080
  {
    const { ctx, page } = await open([1920, 1080], STATE(), { fullScreen: true });
    await page.locator('[data-testid="fullscreen-ads"]').waitFor({ timeout: 40000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(SHOTS, '1920×1080-10-fullscreen-idle.png') });
    const m = await measure(page);
    check('full-screen idle ads appear after 30 s untouched', true);
    check('full-screen idle ad keeps its aspect ratio', m.imgs.length > 0 && m.imgs.every((i) => i.fit === 'cover' || i.fit === 'contain'), m.imgs.map((i) => i.fit).join(','));
    await page.mouse.click(400, 500);
    await page.locator('[data-testid="fullscreen-ads"]').waitFor({ state: 'detached', timeout: 3000 });
    check('a touch returns to check-in — without pressing what was underneath', (await page.locator('.d23-phone .val.ph').count()) === 1);
    await ctx.close();
  }
} catch (e) {
  check('layout run completed', false, String(e?.message || e).split('\n')[0].slice(0, 300));
} finally {
  await browser.close(); srv.close();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} layout checks passed · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
