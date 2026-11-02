// pos-vi-one-screen.test.mjs — the one-screen harness's own measurements, in a real Chromium on small fixtures (no API,
// no POS build): §79 overlaps compare what the user can SEE (a row scrolled out of its list is not on top of the section
// below), controls cut off sideways by a card are caught (a lane grid designed to scroll sideways is not), and §78 hit
// areas are classified full / neighbour / short with the layout unchanged.
// Run: CHROMIUM_PATH=/opt/pw-browsers/chromium node --test tooling/e2e/pos-vi-one-screen.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { measureOneScreen, measureHitAreas, judge } from './pos-vi-one-screen.mjs';

const { chromium } = createRequire(new URL('../../package.json', import.meta.url).pathname)('playwright');
let browser, page;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
});
after(async () => { await browser?.close(); });

// the POS's hit-area CSS (styles.css "§78 hit areas"), so a fixture can carry a hit area the way the app writes it
const HS_CSS = `:where(:root:not([data-hitslop="off"]) [data-hs-rel]) { position: relative; }
:root:not([data-hitslop="off"]) [data-hs="a"]::after { all: unset; content: ""; position: absolute; inset: var(--hs); }
body { margin: 0; font: 13px sans-serif } button { font: inherit; padding: 0 6px; border: 1px solid #999; background: #fff; }`;
const load = (body) => page.setContent(`<!doctype html><html><head><style>${HS_CSS}</style></head><body><div class="main" style="height:700px;overflow:hidden auto">${body}</div></body></html>`);

test('§79 overlaps: a row scrolled out of its list is not "on top of" the section below; a real overlap still counts', async () => {
  await load(`
    <div style="height:100px;overflow:auto"><div style="height:400px;position:relative">
      <button style="position:absolute;top:150px;left:10px;width:80px;height:24px">Open</button></div></div>
    <section style="position:relative;height:120px"><button style="position:absolute;top:40px;left:10px;width:120px;height:24px">Send alert</button></section>
    <div style="position:relative;height:40px"><button style="position:absolute;left:0;width:80px;height:24px">A</button><button style="position:absolute;left:40px;width:80px;height:24px">B</button></div>`);
  const m = await measureOneScreen(page);
  assert.equal(m.overlapCount, 1, JSON.stringify(m.overlaps));
  assert.deepEqual([m.overlaps[0].a, m.overlaps[0].b], ['A', 'B']);
});

test('§79 cut-off: a card that clips a status pill / row button sideways is caught; a lane grid built to scroll sideways is not', async () => {
  await load(`
    <section style="width:200px;overflow:hidden;border:1px solid"><table style="white-space:nowrap"><tr><td>Lý Thu Thảo 108335</td><td><span class="pill">Waiting</span></td><td><button>Notify</button></td></tr></table></section>
    <div style="width:300px;overflow-x:auto"><div style="display:flex;width:900px"><div data-technician-column style="width:300px"><button>View day</button></div><div data-technician-column style="width:300px"><button>View day</button></div><div data-technician-column style="width:300px"><button>View day</button></div></div></div>`);
  const m = await measureOneScreen(page);
  assert.ok(m.cutOff.some((c) => c.text === 'Notify'), JSON.stringify(m.cutOff));
  assert.ok(!m.cutOff.some((c) => c.text === 'View day'), 'the lanes scroll sideways by design');
  const [v] = judge([{ module: 'overview', label: 'OVERVIEW', lang: 'en', w: 1000, h: 700, ...m, hit: null, leftovers: [], pageErrors: [], font: { ...m.font, hanken: true } }]);
  assert.ok(v.reasons.some((r) => /cut off sideways/.test(r)), v.reasons.join('; '));
});

test('§78 hit areas: full when the 44 px box is the control\'s own; short without one; neighbour when two rows share the gap; layout unchanged', async () => {
  // 1) a lone 22 px button with an 11 px hit area above and below (22 + 2×11 = 44) and 4 px each side (36 + 8 = 44)
  //    (the insets count from the padding box: + the 1 px border)
  await load(`<div style="padding:100px"><button data-hs="a" data-hs-rel style="width:36px;height:22px;--hs:-12px -5px -12px -5px">i</button></div>`);
  let h = await measureHitAreas(page);
  assert.deepEqual([h.compact, h.full, h.short, h.layoutSame], [1, 1, 0, true], JSON.stringify(h));
  // 2) the same button without a hit area: short
  await load(`<div style="padding:100px"><button style="width:36px;height:22px">i</button></div>`);
  h = await measureHitAreas(page);
  assert.deepEqual([h.compact, h.short], [1, 1], JSON.stringify(h));
  assert.ok(h.shorts[0].hitH <= 23, JSON.stringify(h.shorts));   // its own box (± the sub-pixel the hit test rounds)
  // 3) two rows 28 px apart (6 px gap): each takes 3 px of the gap and 11 px on its free side → neighbour, not short
  await load(`<div style="padding:100px">
    <button data-hs="a" data-hs-rel style="display:block;width:80px;height:22px;margin-bottom:6px;--hs:-12px -1px -4px -1px">Assign</button>
    <button data-hs="a" data-hs-rel style="display:block;width:80px;height:22px;--hs:-4px -1px -12px -1px">Assign</button></div>`);
  h = await measureHitAreas(page);
  assert.deepEqual([h.compact, h.neighbour, h.short, h.layoutSame], [2, 2, 0, true], JSON.stringify(h));
  assert.ok(h.neighbours.every((n) => n.hitH >= 22 + 11 + 3 - 1), JSON.stringify(h.neighbours));
  const [v] = judge([{ module: 'overview', label: 'OVERVIEW', lang: 'en', w: 1000, h: 700, docScrollX: 0, docScrollY: 0, vScroll: 0, hScroll: 0, clippedCount: 0, clipped: [], cutOffCount: 0, cutOff: [], overlapCount: 0, overlaps: [], minButton: 22, font: { hanken: true, size: '13px' }, hit: { ...h, short: 1, shorts: [{ text: 'x', hitW: 30, hitH: 30 }] }, leftovers: [], pageErrors: [] }]);
  assert.ok(v.reasons.some((r) => /hit area short of 44 px/.test(r)), v.reasons.join('; '));
});
