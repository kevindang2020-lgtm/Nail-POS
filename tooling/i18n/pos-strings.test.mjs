// pos-strings.test.mjs — WP-K (Vietnamese POS mandate §24 / §99 / §123): the tier-4 scanner catches each shape that slipped
// past tiers 1–3, and leaves the translated forms alone. Run: node --test tooling/i18n/pos-strings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { scanTier4File, scanFile, TIER4_KINDS } from './pos-strings.mjs';

const fx = (n) => fileURLToPath(new URL(`./__fixtures__/${n}`, import.meta.url));
const caught = scanTier4File(fx('tier4-caught.tsx'));
const has = (kind, text) => caught.some((s) => s.kind === kind && (text == null || s.text === text));

test('the Overview Quick Actions tuple is caught (tuple)', () => {
  assert.ok(has('tuple', 'Take Payment'));
  assert.ok(has('tuple', 'New Booking'));
  assert.ok(!has('tuple', '/checkout'), 'a route is a value, not text');
});
test('the Checkout status label map is caught (map)', () => {
  assert.ok(has('map', 'Ready for checkout'));
  assert.ok(has('map', 'Paid'));
  assert.ok(has('map', 'Voided'));
});
test("a rendered helper's first argument is caught: line('Tax', …) (helper)", () => assert.ok(has('helper', 'Tax')));
test("an enum printed with .replace(/_/g, ' ') is caught (enum)", () => assert.ok(has('enum')));
test('a raw status code rendered into JSX is caught (status)', () => assert.ok(has('status', 's.status')));
test("a display word beside a translated branch is caught: on ? 'Enabled' : t('…') (branch)", () => assert.ok(has('branch', 'Enabled')));
test("English glued with + is caught: n + ' days ago' (concat)", () => assert.ok(has('concat', 'days ago')));
test('an import-time t() is caught (module)', () => assert.ok(has('module', "t('pos.overview')")));
test('every tier-4 kind is exercised by the fixture', () => { for (const k of TIER4_KINDS) assert.ok(has(k), k); });
test('the translated forms are clean', () => {
  const clean = scanTier4File(fx('tier4-clean.tsx'));
  assert.deepEqual(clean.map((s) => `${s.line} ${s.kind} ${s.text}`), []);
});
test('tiers 1–3 are unchanged by tier 4 (the fixture has no JSX text)', () => {
  assert.deepEqual(scanFile(fx('tier4-clean.tsx')).map((s) => s.text), []);
});
