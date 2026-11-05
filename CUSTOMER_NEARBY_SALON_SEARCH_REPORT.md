# CUSTOMER_NEARBY_SALON_SEARCH_REPORT.md

§14–§18: customers find nail salons inside the app — **implemented and verified live**.

## Backend (`apps/api/src/customer-salons/`)
- `GET /customer/salons/nearby` (`customer-salons.controller.ts` → `customer-salons.service.ts` `nearby()`):
  accepts `lat,lng,radiusMiles,city,state,zip,searchText` (and honors open-now/service/sort params), requires either
  coordinates or a city/ZIP/text, **lists AIPowerSalon partner salons first**, then optionally merges Google results.
- Response is normalized to the §16 shape: `salon_id, source, name, address, city, state, zip, phone, latitude,
  longitude, distance_miles, rating, review_count, photos, is_aipowersalon_partner, is_bookable_in_app, open_now,
  hours, services_preview, price_level, booking_url_or_route, google_place_id`.
- `source` is `aipowersalon` (full in-app booking) or `google` (Call / Directions / View Info only). Non-partner
  Google salons are **not** bookable in-app (`is_bookable_in_app:false`).

## Live verification (against `aps_fresh`)
`GET /customer/salons/nearby?lat=39.9445&lng=-75.0469&radiusMiles=25` (Merchantville NJ) → 200, returned the LUXE
partner: `source:"aipowersalon"`, `is_aipowersalon_partner:true`, `is_bookable_in_app:true`, `distance_miles:0.2`,
`services_preview:[…]`, `booking_url_or_route:"/book/<id>"`, and `googleEnabled:false` with the message
**"Nearby Google salon search is not configured yet."**

## Frontend
`apps/customer-web/` consumes this via its API client. The list/card data is present; a dedicated polished map+list
"Find Salons" screen is thin and is noted in REMAINING_BLOCKERS.md.
