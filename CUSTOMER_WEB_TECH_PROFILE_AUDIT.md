# customer-web hardening — CustomerTechProfileScreen (verified clean)

Audited the public tech profile (P4) — at 212 lines the largest untested screen in the whole monorepo, and the highest-risk
shape on paper: its profile object is typed `any`, so the compiler enforces none of its ~30 field reads. This is exactly the
pattern that produced the earlier TicketDetail and HardwarePayment bugs. Checked every read against the backend view by hand —
it holds.

## Why an any-typed screen is still correct here
`customerApi.techProfile(slug)` ↔ `GET /customer/techs/:publicSlug`, served by `tech-profile.service.ts`. Every field the
screen touches is present in that view with a matching name and shape:
- Scalars/objects: `displayName`, `title`, `avatarUrl`, `bio`, `yearsExperience`, `averageRating`, `reviewCount`, `isBookable`,
  `profileLinks` (object), `badges` (array) — all emitted (service lines 572–577).
- `portfolio[]` → `{ photoId, imageUrl, thumbnailUrl, caption, tags }` (line 578) — matches the gallery's `ph.photoId/tags/
  thumbnailUrl/imageUrl/caption`.
- `reviews[]` → `{ rating, reviewText, reviewer, serviceName, createdAt, tags }` (line 579) — matches the review rows exactly.
- `ratingBreakdown[]` → `{ star, pct }` (lines 532–534) — matches the bar rows.
- `availableAt[]` → `{ salonId, technicianId, salonName, address, nextAvailableAt{date,startTime}, services[]{serviceId, name,
  durationMinutes, priceCents, isPrimary} }` (lines 557–564) — matches the available-at list, the `fmtNext` formatter, and the
  book sheet's `technicianId` deep-link.

**No crash risk from the unguarded array reads.** The screen reads `p.portfolio.length`, `p.specialties.length`,
`p.languages.length`, `p.availableAt.length`, `p.ratingBreakdown.map`, and `p.reviews.map` without optional chaining — and the
backend guarantees every one of those is always an array (`this.j(..., [])` defaults, `.map(...)` results, the static 5-row
breakdown). So the missing types don't translate into a missing-field crash. Favorites and external links are independently
guarded (`p.profileLinks || {}`, best-effort heart), and the book sheet correctly enforces the single-salon-session rule:
"Book Appointment" only for the salon the customer is signed in with, a call-to-book note otherwise.

No bug. **6 tests** added: full render (hero/rating/bio/review/portfolio/available-at); the error state; add-to-favorites;
booking at the customer's own salon (deep-links with `technicianId`); the call-to-book note for a different salon; and the
portfolio style-tag filter narrowing the gallery.

## Recommendation (low priority)
The screen is correct, but it's one schema rename away from silently blanking. Worth giving the profile object a shared
`PublicTechProfile` type (mirroring the service return) so the compiler guards these reads going forward — the same hardening
that would have caught the TicketDetail/HardwarePayment field bugs at build time. Not urgent; noting for later.

## Verification
customer-web `tsc` clean, **113 tests pass** (38 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 63,
tech-web 58, backend 603 / PASS — all unchanged; read-only screen, only new tests added.)
