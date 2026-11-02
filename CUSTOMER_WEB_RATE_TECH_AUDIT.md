# customer-web hardening — RateTechScreen (verified clean)

Pivoted to customer-web (the largest app — already substantially tested at 95 tests) and started with a reputation-critical
mutation: `RateTechScreen` — the after-service 1–5 star rating with whitelist tags, optional text, and a 7-day edit window.
Like other screens it holds the prior rating in an `any` (`existing`), so the concern was whether `existing.ratingId`
(which drives the **update** call) and `existing.editable` (which gates the button) actually match the backend — the exact
shape of bug that broke the TicketDetail edit flow. Here it matches.

## Verified clean
- **The fields the screen reads off the prior rating are real.** `customerMyTechRating` returns
  `{ exists, ratingId: row.id, rating, reviewText, tags, editable, editableUntil }` (tech-profile.service.ts ~line 638) —
  so `existing.ratingId` is the real rating id and `updateTechRating(ticketId, existing.ratingId, …)` targets the right
  row (no `undefined`), and `existing.editable` correctly reflects the server's 7-day window.
- **Wiring + payloads are correct.** `myTechRating`/`submitTechRating`/`updateTechRating` all map to real
  `/customer/tickets/:ticketId/technician-ratings…` routes; a fresh submit sends
  `{ technicianId, rating, reviewText?, tags, isPublic }`, an edit sends `{ rating, reviewText?, tags }`, and both return
  `{ message }` (read for the thank-you copy). The favorite action posts `{ technicianId }`.
- **The edit window is enforced on both sides.** The button is disabled when `stars < 1` or when an existing rating is past
  its window (`existing && !existing.editable`), and the server independently verifies against the paid ticket and window.

No bug. **6 tests** added: fresh submit (stars + tags + text payload); **update an existing rating via its `ratingId`**;
read-only past the 7-day window (Update disabled); Submit stays disabled until a star is chosen; submission error; favorite
from the thank-you screen.

## Verification
customer-web `tsc` clean, **95 tests pass** (35 files), `vite build` clean. (admin-web 151 / clean, owner-web 53 / clean,
pos-web 75 / clean, tech-web 58 / clean, backend 603 / PASS — all unchanged; typed/read screen, only new tests added.)

## Notable untested customer-web screens remaining
CustomerTechProfileScreen (212 — the customer view of a tech's public profile), FindTechsScreen (123, discovery),
NailShowcaseCreatePostScreen (130, posting/upload), CustomerEditSocialProfileScreen (109, edits), VisitScreen (90),
NailShowcasePostDetailScreen (109), SalonTechsScreen (85), LoginScreen (91), plus several small cards/components.
