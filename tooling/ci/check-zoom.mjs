#!/usr/bin/env node
// check-zoom.mjs — Oct 14 build plan §220 (WCAG 1.4.4 "Resize text"), rebuilt Oct 21 2026: a person-facing app never locks
// pinch-zoom. The customer, owner, technician and manager-pay apps shipped `maximum-scale=1.0, user-scalable=no`, which
// a low-vision guest or owner cannot override on iOS. The kiosk and the 23-inch customer display are fixed public
// screens and keep their lock on purpose (listed here, by name, with the reason).
import { readFileSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const PERSON_FACING = ['customer-web', 'owner-web', 'tech-web', 'manager-pay-web', 'pos-web', 'admin-web'];
const FIXED_SCREENS = { 'go-check-in-kiosk': 'a public kiosk: a locked zoom keeps the next guest from inheriting a zoomed screen', 'customer-display': 'the 23-inch display: no touch zoom on a fixed-layout screen' };
let bad = 0;
for (const app of PERSON_FACING) {
  const html = readFileSync(`${ROOT}apps/${app}/index.html`, 'utf8');
  const m = /<meta\s+name="viewport"\s+content="([^"]*)"/i.exec(html);
  const c = m?.[1] ?? '';
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/i.test(c)) { console.error(`❌ apps/${app}/index.html locks zoom: viewport "${c}"`); bad++; }
}
for (const [app, why] of Object.entries(FIXED_SCREENS)) console.log(`   (kept locked) apps/${app}: ${why}`);
if (bad) process.exit(1);
console.log(`✅ zoom — ${PERSON_FACING.length} person-facing apps let the person pinch-zoom (WCAG 1.4.4)`);
