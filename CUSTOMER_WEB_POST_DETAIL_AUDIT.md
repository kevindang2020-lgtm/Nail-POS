# customer-web hardening — NailShowcasePostDetailScreen (verified clean)

Audited the NailShowcase post detail — photo gallery, like/dislike, comments (add / delete-own / report), Book Similar, and
report/delete. A mutation-heavy screen; it checks out.

## Verified clean
- **NSPost matches the backend view field-for-field.** `customerNailShowcaseApi.post(postId)` returns `NSPost`, and the backend
  `viewMany` emits exactly that shape (nail-showcase.service.ts 16–23): `isVerifiedService`, `allowComments`, `displayName`,
  `salonName`/`technicianName`/`serviceName`, `likeCount`/`dislikeCount`/`commentCount`, `myReaction`, `isMine`, `photos`
  (`{id,imageUrl,caption,…}`), `serviceId`/`technicianId`, `createdAt`. `NSComment` likewise (`id`, `displayName`,
  `commentText`, `isMine`, `createdAt`). Both typed — reads are compiler-guarded.
- **Mutations don't depend on response shapes.** `react`, `addComment`, `deleteComment`, `reportComment`, `reportPost` each
  fire-and-refetch (`loadPost`/`loadComments`), so the UI is driven by re-read server truth rather than a mutation's return —
  the robust pattern. `comments()` defensively accepts either an array or `{ comments }`. `fmt` guards an unparseable date; the
  Post button is gated on a non-empty draft; the author always sees their own post and gets Delete (others get Report); the
  comment box hides when `allowComments` is false.

No bug. **6 tests** added: render (caption/author/salon/photo/comments + Delete-vs-Report per comment); the like reaction call;
posting a comment and clearing the draft; deleting an own comment; the comments-off state; and Book Similar carrying the
service + tech ids into the booking URL.

## Verification
customer-web `tsc` clean, **130 tests pass** (41 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 85,
tech-web 74, backend 603 / PASS — all unchanged; typed screen, only new tests added.)

## Sweep status
**10 fixes** to date (admin-web 6, owner-web 3, pos-web 1, tech-web 1). customer-web coverage now includes the tech profile,
find-techs discovery, the visit display, and the full NailShowcase create→detail flow. Remaining customer-web: SalonTechsScreen,
Login, and assorted small cards.
