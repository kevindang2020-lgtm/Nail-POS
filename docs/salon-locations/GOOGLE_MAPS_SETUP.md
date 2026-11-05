# Google Maps Setup

Four separate, restricted credentials. **Server key is never sent to any frontend.**

| Variable | Where | Restriction |
|---|---|---|
| `GOOGLE_MAPS_SERVER_API_KEY` | backend only | Geocoding API; restrict by server IP/service. Used by `MapsGeocodingProvider`. |
| `VITE_GOOGLE_MAPS_BROWSER_API_KEY` | pos-web build | Maps JavaScript API; restrict by HTTP referrer (your domains). |
| `VITE_GOOGLE_MAPS_MAP_ID` | pos-web build | optional vector Map ID. |
| `GOOGLE_MAPS_IOS_API_KEY` / `GOOGLE_MAPS_ANDROID_API_KEY` | mobile apps | restrict by bundle id / SHA-1. |
| `GOOGLE_PLACES_API_KEY` + `ENABLE_GOOGLE_NEARBY_SALON_SEARCH` | backend (existing) | optional Google nearby fill-in for customer discovery. |

**Fallback:** if `GOOGLE_MAPS_SERVER_API_KEY` is unset, address search returns `configured:false` and the
manager places the pin manually (drag / click / lat-long). If `VITE_GOOGLE_MAPS_BROWSER_API_KEY` is unset,
the editor shows a fallback panel and manual coordinate entry. Drafts always save; **publish requires valid,
confirmed coordinates.** Geocode results are cached 24h server-side to limit billing.

No real keys are committed. Copy `.env.example` → `.env` and fill values.
