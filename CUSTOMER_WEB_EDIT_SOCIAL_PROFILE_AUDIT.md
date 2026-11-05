# customer-web hardening — CustomerEditSocialProfileScreen (verified clean)

Continued customer-web with the social-profile editor — a mutation-heavy screen (the kind that hid the TicketDetail bug):
edit the signed-in customer's NailShowcase profile (avatar, display name, bio, profile toggles) and visibility via an
embedded privacy control. It checks out.

## Verified clean
- **The re-hydrating mutation returns the right shape.** Both `save` and `changeVisibility` do
  `hydrate(await customerSocialApi.updateMyProfile(...))`, and the backend `updateMyProfile` returns the full profile view
  (`nail-showcase-social.service.ts` line 62: `return this.toMyView(fresh, rank)`), so `hydrate` re-populates correctly —
  no `undefined`-blanking. The avatar path doesn't rely on the upload's return at all; it re-fetches via `myProfile()`.
- **Field names match end-to-end.** The screen reads `publicDisplayName` / `bio` / `showRankOnProfile` /
  `showPostsOnProfile` / `allowFollowers` / `profileVisibility` / `avatarUrl` off the typed `MySocialProfile`, and the
  backend DTO mirrors those names. Save sends the toggles + trimmed name/bio; visibility sends just `{ profileVisibility }`.
- **Validation + safety.** The server validates display-name length and the visibility enum; the screen trims input, caps
  name/bio via `maxLength`, disables controls while saving/uploading, and guards against setting state after unmount
  (the `live` flag).

No bug. **6 tests** added: hydrate from the loaded profile; the Save payload; a toggled flag reflected in the payload; the
visibility change via the embedded privacy control; avatar upload → re-fetch; a load error.

## Verification
customer-web `tsc` clean, **101 tests pass** (36 files), `vite build` clean. (admin-web 151 / clean, owner-web 53 / clean,
pos-web 75 / clean, tech-web 58 / clean, backend 603 / PASS — all unchanged; typed/read screen, only new tests added.)

## Sweep status
Across the monorepo so far: 9 real bugs fixed (admin-web 6, pos-web 1, owner-web 2, tech-web 1) and the highest-value
surfaces of every front end locked with tests. customer-web's two audited mutation screens (RateTech, EditSocialProfile)
are both clean. Notable customer-web screens still untested: CustomerTechProfileScreen (212), FindTechsScreen (123),
NailShowcaseCreatePostScreen (130, posting/upload), VisitScreen (90), NailShowcasePostDetailScreen (109), SalonTechsScreen,
LoginScreen, and several small cards.
