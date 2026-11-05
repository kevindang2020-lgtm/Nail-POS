# customer-web hardening — shared PublicTechCard type (preventive, not a bug fix)

Acted on the recommendation from the FindTechs / SalonTechs audits: the marketplace and salon-technician screens read their
tech rows as `any`, so a backend field rename would have silently blanked the UI rather than failing the build — the exact
class of defect behind this sweep's TicketDetail and HardwarePayment field bugs. Converted those runtime-only contracts into
compile-time-checked ones.

## What changed
- **New shared types in `customerApi.ts`**, mirroring the backend `publicCard` builder (tech-profile.service.ts 437–446):
  - `PublicTechCard` — `technicianId`, `publicSlug`, `displayName`, `title`, `avatarUrl`, `averageRating`, `reviewCount`,
    `specialties`, `yearsExperience`, `featuredPortfolioPhotos`, `isBookable`, `badges`, `isFeatured`,
    `nextAvailable: { date; startTime } | null`.
  - `NearbyTechCard extends PublicTechCard` — adds the location-relative fields `customerNearbyTechs` appends (`salonId`,
    `salonName`, `city`, `state`, `distanceMiles`, `bookingRoute`, `rankScore?`).
- **Client methods typed:** `techsNearby` → `{ radiusMiles; results: NearbyTechCard[] }`, `salonTechnicians` →
  `{ salonId; technicians: PublicTechCard[] }` (were `any[]`).
- **Screens de-`any`-ed:** `FindTechsScreen` (`data.results`, `sortResults`, `nextKey`, `fmtNext`) and `SalonTechsScreen`
  (`techs` state, the row `.map`, `fmtNext`) now use the shared types — no `any` left in either screen's tech-row reads.

The fact that `tsc` stays clean after the change is the proof the interfaces are a faithful superset of what both screens
read: every field they touch type-checks against the shared shape. Behavior is unchanged (all tests green); this is purely a
compile-time guard so a future backend rename breaks the build instead of the UI.

## Scope note
This covers the two **card-list** screens. The tech **profile** screen (`CustomerTechProfileScreen`) reads the larger detailed
profile view (portfolio / reviews / availableAt / ratingBreakdown sub-shapes), which deserves its own `PublicTechProfile`
type — left as a separate, clearly-bounded follow-up rather than bundled in here.

## Verification
customer-web `tsc` clean, **136 tests pass** (42 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 85,
tech-web 74, backend 603 / PASS — all unchanged; no API/runtime change, types only.)
