# customer-web hardening — NailShowcaseCreatePostScreen (verified clean)

Audited the NailShowcase posting flow — the highest fresh-bug suspect in customer-web (image upload + new-record creation,
a two-step mutation). It checks out.

## Verified clean
- **The two-step flow uses the real returned id.** `submit` does `createPost(...)` → reads `post.id` → `uploadPhotos(post.id,
  files)` → `nav('/nail-showcase/' + post.id)`. Verified the id is real end-to-end: `createPost` is typed `NSPost` (whose
  first field is `id`), and the backend `createManualPost` returns `this.view(...)`, whose mapper emits `id: p.id`
  (`nail-showcase.service.ts` line 336). So uploads target the right post and the redirect is valid — no `undefined`.
- **Client-side validation is correct and matches the server's contract.** Each picked file is checked for type
  (JPG/PNG/WEBP), size (≤10MB), and count (≤10) before upload, with the backend re-validating. The create payload sends
  `{ caption?, tags, visibility, allowComments, isAnonymous }` and visibility defaults to `salon_only` per spec.
- **No resource leaks.** Preview object URLs are created once per file set via `useMemo` and revoked on change/unmount;
  errors reset `busy` so the button re-enables; the no-photo guard blocks an empty submit.

No bug. **6 tests** added: the no-photo guard; an unsupported file type; an over-size file; **create → upload → navigate using
the returned post.id**; tags/visibility/anonymous in the create payload; error recovery (message shown + button re-enabled +
no upload attempted).

## Verification
customer-web `tsc` clean, **107 tests pass** (37 files), `vite build` clean. (admin-web 151 / clean, owner-web 53 / clean,
pos-web 75 / clean, tech-web 58 / clean, backend 603 / PASS — all unchanged; typed/validated screen, only new tests added.)

## Note on yield
customer-web is a mature, already well-tested app (it started this sweep at 95 tests). Its three audited mutation screens —
RateTech, EditSocialProfile, CreatePost — are all clean; the real bugs this sweep found were concentrated in the
more-recently-built, less-tested surfaces (admin-web Super Admin, owner-web, tech-web TicketDetail). The remaining customer-web
work is largely "verified clean + lock with tests" on screens like CustomerTechProfileScreen, FindTechsScreen, VisitScreen,
NailShowcasePostDetailScreen, and assorted small cards.
