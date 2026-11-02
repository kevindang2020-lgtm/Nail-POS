# Reviews & Reputation — Complete Build Guide handoff (Oct 31 2026, migration 752)

Guide: *AI PowerSalon Reviews & Reputation Management — Complete Claude implementation guide* (Oct 30 2026). Route kept:
`/tenant/marketing/reviews`. Built in place on the ONE review store (`reviews`); no parallel review table and no second rating service.
Local commits only — nothing pushed, deployed, sent or published.

## P0 — the four reviews and one rating source (guide §10, §20)

| Question | Answer from the code / data |
|---|---|
| Four 5★ reviews, average 5.0, public 4, hidden 0, 5-star share 100%, 0 written comments | Reproduced from rows, never hardcoded: a fixture mirroring the photo (4 × 5★, star-only, Vishal verma, Sep 14 + Aug 31 ×3) gives exactly these numbers in the pgtest (REV-01/02) and on screen for the Aug 31 – Sep 14 window (E2E step 1). The production rows themselves need staging access (BLOCKED_EXTERNAL). |
| Three different rating definitions existed | Reviews dashboard counted **everything** (hidden + spam); Team Performance / Technicians / Team Members counted **1–5, not hidden, not spam**; the public technician profile denorm counted **public + not hidden** but **included spam**. |
| Now | `VERIFIED_REVIEW_SQL` (1–5, not hidden, not spam) is the rating for Reviews KPIs, the distribution and the overlay's technician stats — the same predicate Team Performance ranks by (REV-18 proves equal numbers). The public profile figure = verified AND public AND attributed (`reviews-public-denorm.ts`) — **spam no longer lifts it**. |
| Hidden reviews and KPI scope (guide §09) | Stated beside every number: the verified average excludes hidden + spam; At a Glance also shows the average **including hidden** reviews, so hiding cannot silently move the picture. |
| Hide had no history | `hidden_reason` was overwritten; no actor / time. Now an immutable `review_moderation_events` trail + audit row in the same transaction. Hidden reviews from before get one labelled `legacy_backfill` event (actor unknown — never guessed). |

## Files

- **Migration** `752_reviews_reputation_center.sql` (additive): `reviews.moderation_version`, `reviews.last_moderated_at`; append-only `review_moderation_events` (UPDATE/DELETE refused by trigger; unique request key); 2 indexes; labelled backfill. Rollback in the header. Applied twice to the local `aps` template (before: 0 reviews / 0 hidden there).
- **Backend** `modules/customers/src/reviews/`: `reviews-center.ts` (new), `reviews-center.controller.ts` (new, `pos/reviews-center/*`), `reviews-public-denorm.ts` (new), `reviews.kysely.repository.ts` (re-exports the denorm), `reviews.module.ts`; **retired** `reviews.controller.ts` (`GET pos/reviews/state`, `POST pos/reviews/:id/visibility` — no caller after the rebuild; `ReviewsService` stays for Marketing Report); `request-schemas.ts` (old body removed).
- **POS**: `POSReviewsScreen.tsx` rebuilt in place, `posReviewsCenterApi.ts` (new), old `posReviewsApi.ts` removed, `i18n/ns/reviews.{en,vi}.ts` (200 keys each), `ns/index.ts`, `styles.css`; `POSReviewsScreen.test.tsx` rewritten (the `.403` test merged in and deleted).
- **Tests**: `reviews-center.pgtest` (new), `reviews.postgres-race` (new), `reviews-denorm.pgtest` (re-pointed at the audited path), `request-schemas.round2` (moderate route replaces the retired one).
- **Gates / generated**: `kysely.types.ts`, ownership registry, openapi manifest, attack-surface docs, tenant-gate baseline (`reviews/reviews-public-denorm.ts`, reason recorded), list-queries allowlist (summary + insights are single card sets).
- **Harness**: `rv-extra.mjs`, `interact-rv.mjs`, `live-server.mjs` / `interact.mjs` wiring, screenshots `tooling/catalog-one-screen/results/rv-e2e/`.

## Decisions

- **Moderation rules**: Hide needs a reason code (spam / abusive language / personal information / wrong salon or customer / duplicate / test review / other + text ≥5). A **1–2★ review cannot be hidden for "other"** — a low rating is never the reason. Nothing is ever hidden automatically. Version-checked (`moderation_version`) and idempotent (request key; the replay check runs after the row lock so a retried tap answers "already done").
- **External reviews** (Google / Facebook / Yelp): Hide only hides inside AI PowerSalon; the screen says so. Replies publish only through the existing approval-gated `pos/ai-review-reputation/*` workflow and a Google Business Profile connection; Facebook / Yelp replies are not supported (`publishable` = `needs_connection` / `not_supported`).
- **No review gating**: review requests already take no rating (`evaluateRequestEligibility`) and are one per visit by idempotency key (REV-22).
- **Assistant**: facts only — written comments, the customers' own tags and the stored review analysis, each theme with its review ids. Fewer than 3 written comments → "Insufficient written feedback". Reply drafts stay in the AI Review Assistant (manager approval before publishing).
- **Search**: customer name / phone / email / id match only through a real tenant link; anonymous reviews never match. The search text never goes into the URL; the other filters, page and size do.
- **Permission fix**: the POS hides Hide/Unhide by `marketing.manage` (the real role grant; `useCan` matches literally) — the first E2E run caught owners seeing no Hide button.

## Verification matrix (guide §17)

| ID | Evidence | Status |
|---|---|---|
| REV-01 | pgtest REV-01/02 (fixture) · E2E step 1 vs independent SQL | COMPLETED_AND_VERIFIED (fixture); production rows BLOCKED_EXTERNAL |
| REV-02 | pgtest · E2E step 1 | COMPLETED_AND_VERIFIED |
| REV-03 | pgtest REV-03/04 · E2E search + overlay (Open Booking disabled) | COMPLETED_AND_VERIFIED |
| REV-04 | pgtest · E2E search (name / phone / email) | COMPLETED_AND_VERIFIED |
| REV-05 | pgtest · E2E (vishal → equals DB count) | COMPLETED_AND_VERIFIED |
| REV-06 | pgtest (page 4 needle) · E2E | COMPLETED_AND_VERIFIED |
| REV-07 | pgtest · E2E | COMPLETED_AND_VERIFIED |
| REV-08 | pgtest (salon day, To-day inclusive, invalid range refused) · E2E calendar opens | COMPLETED_AND_VERIFIED |
| REV-09 | pgtest (submitted vs service vs moderation) · E2E basis line | COMPLETED_AND_VERIFIED |
| REV-10 | pgtest · E2E (10 / 50, page 2, newest first) | COMPLETED_AND_VERIFIED |
| REV-11 | pgtest (new review lands first) · 60 s refresh in the screen | COMPLETED_AND_VERIFIED (server) / live push NOT_IMPLEMENTED (polling) |
| REV-12 | E2E (Close; keyboard Enter on rows; overlay scroll area) | COMPLETED_AND_VERIFIED |
| REV-13 | E2E (enabled for linked, disabled for anonymous) · unit test (prefilled URL) | COMPLETED_AND_VERIFIED |
| REV-14 | pgtest · race (8 managers → 1 hide) · E2E (Front Desk refused) | COMPLETED_AND_VERIFIED |
| REV-15 | pgtest (actor / reason / time, text kept, trail append-only) · E2E | COMPLETED_AND_VERIFIED |
| REV-16 | pgtest + E2E ("Other" not offered for 1★; nothing auto-hidden) | COMPLETED_AND_VERIFIED |
| REV-17 | pgtest + E2E (scope text, publish capability) | COMPLETED_AND_VERIFIED (no real provider call) |
| REV-18 | pgtest (Team Performance repository = Reviews technician stats; public denorm without spam) · Check "cross-module" | COMPLETED_AND_VERIFIED |
| REV-19 | pgtest · E2E assistant | COMPLETED_AND_VERIFIED |
| REV-20 | existing approval state machine (`ai-review-reputation-drafting` suite 5/5); nothing in this build publishes | IMPLEMENTED_NOT_VERIFIED end-to-end (no provider) |
| REV-21 | pgtest (unique index) · race (8 double-submits → 1 row) | COMPLETED_AND_VERIFIED |
| REV-22 | pgtest (opted out refused; key unique) · race (8 replays → 1 request) | COMPLETED_AND_VERIFIED |
| REV-23 | statuses come only from `review_publications` / provider rows; no real provider here | BLOCKED_EXTERNAL |
| REV-24 | pgtest (another salon's review: not listed, not openable, not moderatable) · E2E Front Desk 403 | COMPLETED_AND_VERIFIED |
| REV-25 | E2E at 1920×945, 1536×864, 1366×768, 1280×720, 1024×768 — no sideways scroll | IMPLEMENTED_NOT_VERIFIED on the physical ASUS 27″ (BLOCKED_EXTERNAL) |

## Tests (Oct 31 2026)

| Suite | Result |
|---|---|
| `reviews-center.pgtest` | 18/18 |
| `reviews.postgres-race` (real PostgreSQL 16, 4 sessions) | 4/4 — with the row lock removed 2/4 |
| `reviews-denorm.pgtest` (through the audited path) | 2/2 |
| reviews.vitest · team-performance pgtest · technicians-screen pgtest · marketing-growth pgtest · marketing-report · AI review reputation (10 files) | 5/5 · 4/4 · 6/6 · 20/20 · 4/4 · all pass |
| Browser `rv` (EN/VI, Front Desk 403, 5 screen sizes) | 11/11, no page errors |
| Combined run `seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq,rmd,em,wb,bd,rf,rv` | 202/202 (the 4 page errors are the known harness "not in the harness" after Open Booking) |
| `comms` section | 12/12 |
| `request-schemas.round2` | 0/3 here — identical 0/3 on the unchanged HEAD (stand-in limit) → needs CI |

**Gates**: 52 `check:*` pass through npm + 6 through the stand-in loader (sql, types-drift, sql-identifiers, db-ownership, unique-tenant-review, actor-stamp). Can't run here: lint, boot, api-contract, strict-bodies-types (IMPLEMENTED_NOT_VERIFIED, need CI). The first run failed tenant, unreached, as-any and list-queries — fixed in code (one tenant baseline for the cross-salon public profile figure, two list-queries allowlist entries for single card sets, each with a reason).

## Not verified / blocked

- **IMPLEMENTED_NOT_VERIFIED (needs CI)**: POS + API type-check, `POSReviewsScreen.test.tsx`, `request-schemas.round2`, the 4 gates above.
- **BLOCKED_EXTERNAL**: the real four reviews in staging/production; Google Business Profile reply publication and sync; the physical ASUS 27″ at 100% zoom; migration 752 on staging/production (owner approval).
- **NOT_IMPLEMENTED**: WebSocket/SSE push for new reviews (the screen refetches every 60 s, never interrupting an open overlay); alert escalation by SMS/email (the existing `review_escalations` / owner alerts stay in-app); an assignment workflow for negative-review alerts beyond the existing escalation routes.

## Open owner decisions

1. Should hidden reviews also leave the **Team Performance** rating? Today they do (shared verified definition), which means a manager hide changes a technician's internal score — the trail records it, and At a Glance shows the "including hidden" average.
2. Should Front Desk get read-only Reviews access? Today it has no marketing access (403 notice).
3. Is 3 written comments the right minimum before the assistant names themes?
4. Retire `ReviewsService.setVisibility` (now unused by any route) — keep for one release or remove?
