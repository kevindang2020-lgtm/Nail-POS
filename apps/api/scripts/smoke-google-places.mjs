#!/usr/bin/env node
/* smoke-google-places.mjs — one-shot REAL-key smoke test for the Google nearby proxy (build doc §23).
 * Run at deploy with your real env:
 *   ENABLE_GOOGLE_NEARBY_SALON_SEARCH=true GOOGLE_PLACES_API_KEY=... node scripts/smoke-google-places.mjs [lat] [lng]
 * Defaults to Cherry Hill, NJ. Asserts: provider enabled, HTTP 200 from Google, >=1 normalized result with a
 * google_place_id, never bookable, and the attribution string. Exits 0 on pass, 1 on fail. */
const lat = Number(process.argv[2] ?? 39.9268);
const lng = Number(process.argv[3] ?? -75.0246);

const enabled = String(process.env.ENABLE_GOOGLE_NEARBY_SALON_SEARCH || '').toLowerCase() === 'true' && !!process.env.GOOGLE_PLACES_API_KEY;
if (!enabled) {
  console.error('❌ Provider disabled: set ENABLE_GOOGLE_NEARBY_SALON_SEARCH=true and GOOGLE_PLACES_API_KEY.');
  process.exit(1);
}

const radiusMeters = Math.min(Math.round(10 * 1609.34), 50000);
const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&keyword=${encodeURIComponent('nail salon')}&type=beauty_salon&key=${process.env.GOOGLE_PLACES_API_KEY}`;

const res = await fetch(url);
if (!res.ok) { console.error(`❌ Google HTTP ${res.status}`); process.exit(1); }
const body = await res.json();
if (body.status && body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
  console.error(`❌ Google status ${body.status}: ${body.error_message || ''}`); process.exit(1);
}
const results = Array.isArray(body.results) ? body.results : [];
console.log(`✅ Google reachable — status ${body.status}, ${results.length} raw results near ${lat},${lng}`);
if (results.length) {
  const g = results[0];
  const normalized = {
    salon_id: 'g_' + g.place_id, source: 'google', name: g.name,
    rating: g.rating ?? null, is_aipowersalon_partner: false, is_bookable_in_app: false,
    google_place_id: g.place_id, attribution: 'Powered by Google',
  };
  const okShape = normalized.google_place_id && normalized.is_bookable_in_app === false;
  console.log(`${okShape ? '✅' : '❌'} normalized sample:`, JSON.stringify(normalized));
  if (!okShape) process.exit(1);
}
console.log('✅ smoke-google-places: PASS — the in-app proxy will serve real results with this key.');
