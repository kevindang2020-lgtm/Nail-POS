# customer-web hardening — FindTechsScreen (verified clean)

Audited marketplace discovery — nearby techs across all listed salons, with location consent, client-side sort, and
radius/rating filters. Its result rows are typed `any`, so (like the tech profile) the ~14 per-card field reads are
unenforced; checked them against the backend by hand. They hold.

## Why the any-typed results are still correct
`customerApi.techsNearby({lat,lng,...})` ↔ `GET /customer/techs/nearby` → `customerNearbyTechs`, which returns
`{ radiusMiles, results }` (results pre-sorted by `rankScore`). Each result row is `publicCard(...)` augmented with the
location-relative fields, and every field the card reads is present:
- From `publicCard` (tech-profile.service.ts 438–445): `publicSlug`, `displayName`, `title`, `avatarUrl`, `averageRating`,
  `reviewCount`, `specialties`, `featuredPortfolioPhotos`, `badges`, `isFeatured`, `nextAvailable {date,startTime}`.
- Added in `customerNearbyTechs` (495–497): `salonName` and `distanceMiles` — the two fields not on the base card, and exactly
  what the row's "{salonName} · {distanceMiles} mi" line and the "nearest" sort depend on.

The client sort is safe by construction: "best" preserves server `rankScore` order; "nearest" guards missing distance with
`?? 1e9`; "soonest" guards a missing `nextAvailable` with a `'9999'` sentinel; "featured" coerces with `Number(!!…)`. The
`fmtNext` "Today/weekday" label parses with `T00:00:00` (local midnight, no off-by-one). Location follows the explicit-consent
pattern (tap → geolocation; denial and missing-geolocation both land on an honest fallback), and a failed search yields an empty
result set with a message rather than a crash.

No bug. **6 tests** added: allow-location → results render (+ the nearby query args); the denied path; the empty state; the
client rating re-sort reordering the cards; the radius filter re-querying; and tapping a result navigating to that tech.

## Recommendation (low priority)
Same note as the tech profile: the row is one rename from silently blanking. A shared `NearbyTechCard` type mirroring
`publicCard` + the augmentation would make these reads compiler-guarded. Not urgent.

## Verification
customer-web `tsc` clean, **119 tests pass** (39 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 69,
tech-web 74, backend 603 / PASS — all unchanged; read-only screen, only new tests added.)
