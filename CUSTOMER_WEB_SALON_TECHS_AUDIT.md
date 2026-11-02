# customer-web hardening — SalonTechsScreen (verified clean)

Audited "All Technicians" for one partner salon (public cards with View Profile + Book). Tech rows are typed `any`, so the
~13 per-card reads are unenforced; checked them against the backend `publicCard` shape (the same family as TechProfile /
FindTechs). They hold.

## Why the any-typed rows are correct
`customerApi.salonTechnicians(salonId)` ↔ `GET /customer/salons/:salonId/technicians` →
`customerSalonTechnicians`, which returns `{ salonId, technicians: cards }` where each card is `publicCard(...)`
(tech-profile.service.ts 462–464). Every field the card reads is present in `publicCard` (438–445): `publicSlug`,
`technicianId`, `displayName`, `title`, `avatarUrl`, `averageRating`, `reviewCount`, `specialties`, `featuredPortfolioPhotos`,
`badges`, `isFeatured`, `isBookable`, `nextAvailable {date,startTime}`. (This screen reads only base-card fields — it doesn't
touch the salonName/distanceMiles the nearby endpoint adds — so nothing is missing.) The array reads are additionally guarded
with `Array.isArray`, and the book gate enforces the single-salon-session rule: "Book" only when the signed-in salon matches,
an honest "sign in with this salon" note otherwise.

No bug. **6 tests** added: card render + rating + the own-salon Book button; View Profile navigation; booking at your own salon
(`/book?techId=…`); the sign-in note at a different salon; the empty state; and the error path.

## Recommendation (low priority)
Third sighting of the same pattern (TechProfile, FindTechs, now this): a shared `PublicTechCard` type mirroring `publicCard`
would make all three screens' reads compiler-guarded in one move. Worth doing once; not urgent.

## Verification
customer-web `tsc` clean, **136 tests pass** (42 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 85,
tech-web 74, backend 603 / PASS — all unchanged; read-only screen, only new tests added.)
