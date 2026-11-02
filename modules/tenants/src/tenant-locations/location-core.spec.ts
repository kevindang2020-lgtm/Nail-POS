// location-core.spec.ts — Nest-free assertions for the location-management core (publish gating,
// verification transitions, duplicate detection, coordinate validation, public projection).
import {
  validCoords, publishReadiness, canTransition, detectDuplicate, toPublicLocation, summarize, accuracyAfterDrag,
  type LocationRow,
} from './location-core';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error('  ✗', m); } }

// ---- coords ----
ok(validCoords(39.95, -75.05), 'valid NJ coords');
ok(!validCoords(0, 0), 'null island rejected');
ok(!validCoords(91, 10), 'out-of-range lat rejected');
ok(!validCoords('x' as any, 1 as any), 'non-number rejected');

// ---- publish readiness ----
const base: any = { latitude: 39.95, longitude: -75.05, map_pin_confirmed_at: '2026-01-01', address: '123 Main', phone: '+18565550100', verification_status: 'manager_confirmed' };
ok(publishReadiness(base).ok, 'ready when pin confirmed + address + phone');
ok(!publishReadiness({ ...base, map_pin_confirmed_at: null }).ok, 'not ready without confirmed pin');
ok(!publishReadiness({ ...base, latitude: 0, longitude: 0 }).ok, 'not ready without valid coords');
ok(!publishReadiness({ ...base, phone: null, public_email: null }).ok, 'not ready without contact');
ok(!publishReadiness({ ...base, verification_status: 'suspended' }).ok, 'suspended cannot publish');

// ---- transitions ----
ok(canTransition('draft', 'manager_confirmed'), 'draft→manager_confirmed');
ok(canTransition('pending_review', 'verified'), 'pending_review→verified');
ok(!canTransition('draft', 'verified'), 'draft↛verified (must review)');
ok(canTransition('verified', 'suspended'), 'verified→suspended');

// ---- duplicate detection ----
const existing = [
  { id: 'a', tenant_id: 't1', google_place_id: 'PID1', phone: '8565550100', salon_code: 'DT', name: 'Luxe', city: 'Merchantville', state: 'NJ', latitude: 39.95, longitude: -75.05 },
];
ok(detectDuplicate({ tenant_id: 't1', google_place_id: 'PID1' }, existing).verdict === 'exact_block', 'same place same tenant blocks');
ok(detectDuplicate({ tenant_id: 't2', google_place_id: 'PID1' }, existing).verdict === 'cross_tenant_review', 'same place other tenant → review');
ok(detectDuplicate({ tenant_id: 't1', salon_code: 'dt' }, existing).verdict === 'exact_block', 'dup salon code blocks');
ok(detectDuplicate({ tenant_id: 't1', phone: '(856) 555-0100' }, existing).verdict === 'probable_warn', 'dup phone warns (same tenant)');
ok(detectDuplicate({ tenant_id: 't1', latitude: 39.95001, longitude: -75.05001 }, existing).verdict === 'probable_warn', 'near-identical coords warns');
ok(detectDuplicate({ tenant_id: 't1', name: 'Brand New', city: 'Cherry Hill', state: 'NJ' }, existing).verdict === 'none', 'distinct branch ok');
ok(detectDuplicate({ tenant_id: 't1', google_place_id: 'PID1' }, existing, 'a').verdict === 'none', 'self-match ignored');

// ---- public projection strips internals ----
const row: LocationRow = { ...(base as any), id: 'L1', tenant_id: 't1', name: 'Downtown Branch', public_display_name: null, city: 'Merchantville', state: 'NJ', zip: '08109', show_phone_publicly: true, manager_name: 'Jane', internal_notes: 'gate code 4321' } as any;
const pub = toPublicLocation(row, 'Luxe Nails & Spa');
ok(pub.publicDisplayName === 'Luxe Nails & Spa — Downtown Branch', 'public display name composed');
ok(!('manager_name' in (pub as any)) && !('internal_notes' in (pub as any)), 'internal fields not in public shape');
ok(toPublicLocation({ ...row, show_phone_publicly: false } as any, 'Luxe').phone === null, 'phone hidden when show_phone_publicly false');

// ---- summary ----
const sm = summarize([
  { ...row, verification_status: 'verified', is_public: true } as any,
  { ...row, id: 'L2', latitude: null, longitude: null, verification_status: 'draft', is_public: false } as any,
]);
ok(sm.total === 2 && sm.published === 1 && sm.missingPins === 1 && sm.unverified === 1, 'summary counts');

// ---- accuracy after drag ----
const a = accuracyAfterDrag(39.95, -75.05, 39.99, -75.09);
ok(a.accuracy === 'manually_adjusted' && a.farFromAddress === true, 'drag far from address flagged');

console.log(`location-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
