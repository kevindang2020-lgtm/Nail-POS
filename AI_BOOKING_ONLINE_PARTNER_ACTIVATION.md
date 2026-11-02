# AI Booking — Online/Partner Channel: Activate & Test

The online/partner signed-link channel is built and tested but dormant until you switch it on. This is the exact
procedure to activate it and verify it end to end. Nothing here is new code — it's how to run what exists.

## 1. Environment (owner action)

Required to sign/verify links:
- `AI_BOOKING_LINK_SECRET` — a long random secret (≥32 chars). Without it, minting and public booking refuse cleanly.

Optional:
- `PUBLIC_BOOKING_BASE_URL` — if set, minted links come back with a ready `bookingUrl` (`{base}/book?t=…`).

For public-endpoint abuse protection (recommended before real traffic):
- `RATE_LIMIT_STORE=redis` + `RATE_LIMIT_REDIS_URL` (or `REDIS_URL`) — enables the limiter backend.
- The abuse protection on the public endpoints is always active once the limiter backend is on (it's separate from the
  authenticated-tenant Super Admin toggle). Bucketed per-tenant-per-source.

## 2. Mint a link (Super Admin)

`POST /super-admin/tenants/{tenantId}/ai-booking/link`  (SuperAdminGuard)

Body:
```json
{ "source": "PARTNER_BOOKING_LINK", "branchId": "<branch-uuid>", "partnerId": "groupon",
  "allowedServiceIds": ["<svc-uuid>"], "ttlDays": 30 }
```
- `source`: `ONLINE_BOOKING` or `PARTNER_BOOKING_LINK` (partner requires `partnerId`).
- `allowedServiceIds` (optional): partner link can only book these services.
Returns: `{ token, expiresAt, bookingUrl, source }`. The tenant is taken from the path — never from the caller.

## 3. Search availability with the token (public, no auth)

`POST /api/ai-booking/v1/public/availability/search`
```json
{ "token": "<minted-token>", "date": "2026-07-11", "serviceIds": ["<svc-uuid>"] }
```
Returns bounded options (≤8 technicians × ≤12 slots), source-stamped. Tenant/branch come from inside the signed token.

## 4. Book with the token (public, no auth)

`POST /api/ai-booking/v1/public/appointments`
```json
{ "token": "<minted-token>", "customerName": "Jane Doe", "customerPhone": "+18565551234",
  "serviceIds": ["<svc-uuid>"], "date": "2026-07-11", "startTime": "11:00",
  "confirm": true, "idempotencyKey": "book-jane-2026-07-11-1100" }
```
- `confirm: true` is required — without it you get `HUMAN_CONFIRMATION_REQUIRED` and nothing is written.
- Re-sending the same `idempotencyKey` returns the original result (no double-booking).

## 5. Expected rejections (all correct behaviour)

- `INVALID_PARTNER_LINK` (401) — forged, tampered, or expired token.
- `SERVICE_NOT_BOOKABLE` (400) — a service not in the partner link's allow-list.
- `HUMAN_CONFIRMATION_REQUIRED` — `confirm` omitted/false.
- `TEMPORARY_CAPACITY_PROTECTION` (429) — over the per-tenant public budget (only when the limiter is enabled).
- `APPOINTMENT_CONFLICT` — the slot was taken between search and book (the engine's final word).

## 6. Verify it landed

- The appointment appears in POS (Booking screen) with an **Online** / **Partner** source badge.
- Super Admin → AI Booking Analytics (or `GET /super-admin/tenants/{id}/ai-booking/metrics`) shows the source's
  searches/attempts/bookings and conversion rate.

## 7. Rollback / kill

- Unset `AI_BOOKING_LINK_SECRET` → all signed links stop working immediately (mint + verify refuse).
- Links also expire on their own after `ttlDays`.
- Revoke ONE link (targeted): `POST /super-admin/tenants/{tenantId}/ai-booking/link/revoke` with `{ "jti": "<jti-from-mint>", "reason": "partner offboarded" }`. The mint response includes the `jti`; the public endpoints reject that link immediately after (within a ~15s cache window), without affecting any other link.
- Rotate `AI_BOOKING_LINK_SECRET` to invalidate ALL outstanding links at once. Links also expire on their own after `ttlDays`.
