# GOOGLE_NEARBY_SEARCH_INTEGRATION_REPORT.md

§16/§23: Google nearby search runs **server-side only** — the key is never in the mobile app.

## Implementation
- `apps/api/src/customer-salons/google-places.provider.ts` — backend Google Places provider. The key is read from the
  environment (`GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY`), never returned to the client.
- `apps/api/src/customer-salons/customer-salons.service.ts` `nearby()` calls the provider **only when enabled**, merges
  Google results after the partner salons, normalizes fields, and attaches `source:"google"` + `google_place_id`.
- Config (env): `ENABLE_GOOGLE_NEARBY_SALON_SEARCH` (default off), `DEFAULT_NEARBY_RADIUS_MILES`,
  `MAX_NEARBY_RADIUS_MILES`. When disabled/unconfigured, only partner salons are returned plus the honest message
  "Nearby Google salon search is not configured yet."

## Security (§19) — verified
The built customer bundle (`apps/customer-web/dist`) was scanned for an `AIza…` key and the Google env var names:
**none present** — PASS. The mobile app calls the backend proxy (`/customer/salons/nearby`) and never holds a key.

## Remaining
A live Google round-trip is blocked on a real `GOOGLE_PLACES_API_KEY` (Kevin) — the integration and the
enabled/disabled behavior are in place and the disabled path is verified live.
