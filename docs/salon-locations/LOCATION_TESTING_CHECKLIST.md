# Location Testing Checklist

## Automated (passing)
- `location-core.spec.ts` — 25/25 (coords, publish gating, verification transitions, duplicate
  detection exact/probable/cross-tenant, public projection strips internals, summary, drag accuracy).
- `salon-directory-core.vitest.spec.ts` — 6/6 (no regression after the discovery query change).
- API typecheck — 0 errors. pos-web typecheck — 0 errors, vite build OK.

## Manual (maps to spec §26)
1. Management → Locations loads existing branches + summary KPIs.
2. Add Location → edit; address search centers map; marker appears.
3. Drag marker / click map → lat-long update, reverse-geocoded address, far-from-address warning.
4. Confirm pin → accuracy=exact, status manager_confirmed.
5. Publish blocked until valid confirmed pin + address + contact; succeeds after.
6. Super Admin list/search → verify/reject/suspend; map-pin correction logged to history.
7. Customer nearby (existing FindSalons) sorted by distance; ZIP search works without GPS.
8. Unpublished / suspended / soft-deleted branches do NOT appear to customers.
9. Tenant A cannot read/edit Tenant B (every query filters `tenant_id` from the session).
10. Server key never present in any frontend response/bundle.
11. Audit rows written for create/update/address/pin/confirm/publish/unpublish/verify/reject/suspend.
