# Final mop-up — last two `any` read surfaces typed

Cleared the last two consumed `api.get<any>` returns, so every read surface that a screen actually consumes is now typed.

## What changed
- **tech-web** `publicPreview` → `TechPublicPreview` (`portfolio: TechPreviewPhoto[]`, `reviewCount`, `isLivePublicly`),
  mirroring `myPublicPreview` (buildPublicProfilePayload + the live flag). TechProfileScreen reads it via an inline `const pv =
  await …`, so typing the client method alone propagates — no screen edit.
- **customer-web** `myTechRating` → `MyTechRating`, a discriminated union (`{ exists: false }` | `{ exists: true; ratingId;
  rating; reviewText; tags; isPublic; editable; editableUntil }`) matching `customerMyTechRating`. RateTechScreen's `existing`
  state is now typed to the `exists:true` variant via `Extract<MyTechRating, { exists: true }>`; the `if (r.exists)` check
  narrows cleanly. One behavior-preserving coercion: a `disabled={… || (existing && !existing.editable)}` clause became
  `(!!existing && …)` so it yields `boolean` not `boolean | null` (null and false disable identically).

## Verification
tech-web `tsc` clean, **74 tests** pass, build clean. customer-web `tsc` clean, **136 tests** pass, build clean.
(admin-web 151, pos-web 75, owner-web 85, backend 603 / PASS — unchanged.)

## Result
Across all six apps, the only remaining `api.get<any>` is `hwGlobalSettings` (admin), an unused method with no read surface.
Every consumed API read surface in the monorepo is now compiler-checked.
