# tech-web hardening — TechProfileScreen (verified clean)

Audited the largest remaining tech-web screen: `TechProfileScreen` (236 lines) — the technician's portable public profile
(avatar + portfolio uploads, bio/title/specialties/languages, validated links, public/marketplace/bookable toggles,
completion meter, ratings summary, and "Connect to New Salon"). It is mutation-heavy (a dozen endpoints), so it was a prime
suspect for the kind of `any`-cast field mismatch that broke the TicketDetail edit modal — but here it checks out.

## Verified clean
- **The `any`-cast read is safe this time.** `(p.servicesHere as any[])` reads `serviceId`/`name`/`isPrimary`, and the
  `TechProfile` type actually declares `servicesHere: { serviceId, name, isPrimary }[]` — so the fields are real (the cast is
  just redundant). The other typed reads — `TechProfile`, `TechPhoto`, `TechRatings`, and `memberships` — all match what the
  screen renders.
- **Mutation wiring is correct.** Every mutation maps to a real `/tech/profile…` route, and the two calls that re-hydrate
  from their response do return the right shape: `updateProfile` and `uploadAvatar` both return `TechProfile` (so
  `hydrate(await …)` is valid), and `requestMembership` returns `{ message }` (read for the success toast). `reorderPhotos`
  sends `{ photoIds }`, `updatePhoto`/`deletePhoto` key off `photoId`.
- **Save transformation is correct.** Comma-separated specialties/languages are split → trimmed → filtered to arrays, and
  `yearsExperience` is `'' ? null : Number(years)` over a digit-filtered input (so no `NaN`). Each visibility toggle PATCHes
  a single flag (`updateProfile({ [key]: v })`).
- Defensive: `servicesHere || []` guards a missing list; load errors and per-action errors surface to an alert; toggles and
  buttons disable while busy.

No bug. **6 tests** added: hero + ratings render; **Save sends the transformed payload (lists → arrays, years → number)**;
a single visibility flag toggles; feature a portfolio photo; the connect-to-new-salon request (+ returned message); load error.

## Verification
tech-web `tsc` clean, **58 tests pass** (11 files), `vite build` clean. (admin-web 151 / clean, owner-web 53 / clean,
pos-web 75 / clean, backend 603 / PASS — all unchanged; read/typed screen, only new tests added.)

## Remaining in tech-web (untested)
LoginScreen, MoreScreen, NotificationsScreen, SettingsScreen, TechFollowUpsScreen, TechScheduleScreen,
TechDeleteAccountScreen, and the static Privacy/Terms screens.
