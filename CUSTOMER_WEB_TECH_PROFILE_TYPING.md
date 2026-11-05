# customer-web hardening — PublicTechProfile type (preventive)

Completed the typing follow-up: the tech profile screen read its profile object as `any` (its single largest untyped surface,
~30 reads across portfolio / reviews / availableAt / ratingBreakdown sub-shapes). Converted it to a compile-time-checked
contract, the same way as the card-list screens.

## What changed
- **New types in `customerApi.ts`** mirroring the `/customer/techs/:slug` view + its sub-objects:
  `TechProfilePhoto`, `TechProfileReview`, `TechRatingBucket`, `TechProfileSalonService`,
  `TechProfileSalon` (`{ salonId, technicianId, salonName, address, bookingRoute, nextAvailableAt, services[] }`), and the
  top-level `PublicTechProfile` (slug/name/title/avatar, bio, `specialties`/`languages`, `profileLinks`, `averageRating`/
  `reviewCount`/`ratingBreakdown`, `isBookable`, `badges`, `portfolio[]`, `reviews[]`, `availableAt[]`).
- **`techProfile` typed** `=> PublicTechProfile` (was `any`).
- **`CustomerTechProfileScreen` de-`any`-ed:** `p` state → `PublicTechProfile`, `lightbox` → `TechProfilePhoto`, `fmtNext`
  param → `NSNextAvailable | null`, and every data map callback (`portfolio`, `ratingBreakdown`, `reviews`, `availableAt`,
  per-salon `services`) lost its `(x: any)` annotation so the element reads now type-check. Only the error catch's `(e: any)`
  remains.

`tsc` staying clean proves the interfaces are a faithful superset of all ~30 reads — including the nested portfolio/reviews/
availableAt fields. Behavior unchanged (tests green); a future backend rename of any of these fields now breaks the build
instead of silently blanking the profile.

## Net effect across the three tech surfaces
All three previously-`any` tech read screens are now typed end to end: `FindTechsScreen` + `SalonTechsScreen`
(`PublicTechCard` / `NearbyTechCard`) and `CustomerTechProfileScreen` (`PublicTechProfile`). The category of defect this sweep
hit twice (silent field drift on `any`-typed data — TicketDetail, HardwarePayment) is now compiler-guarded on the
customer-web tech screens.

## Verification
customer-web `tsc` clean, **136 tests pass** (42 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 85,
tech-web 74, backend 603 / PASS — all unchanged; types only, no API/runtime change.)
