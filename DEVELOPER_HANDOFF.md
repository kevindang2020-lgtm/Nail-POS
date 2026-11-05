# AI POWERSALON — DEVELOPER HANDOFF

> **Oct 10 2026:** the current developer entry point is `START-HERE.md` (build, run, test, deploy, doc map, Kevin's actions). Figures in this file (controller / route / migration counts) are from Jul 30 2026; current counts: `API_INVENTORY.md` (generated) and `apps/api/db/migrations`.

**Audience:** the developer taking over this codebase. **Read this file first, top to bottom.**
(Prior revisions of this document live in git history; their content is now distributed across the canonical
docs listed in HANDOFF_MANIFEST.md.)

## Status block
| Field | Value |
| --- | --- |
| Project status | **Feature-complete against every written spec; credential-/hosting-gated items remain** (see REMAINING_WORK.md) |
| Last verified | **Jul 30, 2026** (battery re-run after migration 432) |
| Branch | `master` |
| Commits | `master` — last CODE commits: **`bccdd08`** (print-features removal + `check:no-print` gate) and **`eed0de6`** (migration 432); full battery re-stamped same day post-432* |
| Build status | **PASS** — API + all 8 frontend workspaces typecheck clean; all Vite production builds OK |
| Test status | **API 6,091 passed + 4 skipped, 0 failed** (8 shards) · **15/15 static gates** · **432/432 migrations** (PGlite/PG16) · frontends: pos 729 · admin 769+ · owner 262 · tech 117 · customer 267 · manager-pay 53 · display 43 · ui 23 · live harnesses: auth-matrix 13/13, e2e:html 13/13 |
| Known blockers | **All external/owner-side**: CommerceHub creds · Twilio · SendGrid · APNs/Firebase · hosting env · Mac for iOS · physical devices · SMS pricing + Schedule-A decisions (KNOWN_ISSUES.md P1, REMAINING_WORK.md E) |
| Production readiness | Code + tests ready; **not yet hosted, no live provider has ever been exercised, no salon has run a real day** — Phase 3–5 of DEVELOPER_TASKS.md is the path |

\* exact hashes: `git log --oneline -20` shows the sequence — bug sweep (`f4cb8af`), its battery stamp
(`01eaad6`), the handoff-doc series, the DB-architecture arc (incl. `eed0de6`, migration 432 — full 8-shard
battery re-run after it: identical 6,091+4/0), and the print-features removal (`bccdd08` — pos-web only;
pos-web suite 729/0 + build re-verified, API untouched). TEST_REPORT.md carries each stamp with its date.

## Application inventory (§7 — every app, honest status)
| Application | Purpose | Location | Status | Build | Dev command | Entry point |
| --- | --- | --- | --- | --- | --- | --- |
| API | The one backend (265 controllers / 2,281 routes) | `apps/api` | WORKING — battery-verified | `npm run build` | `npm run dev:api` | `src/main.ts` |
| POS | Tenant POS, 27" touchscreen | `apps/pos-web` | WORKING | `npx vite build` | `npm run dev:pos` | `src/main.tsx` |
| Super Admin | Platform console | `apps/admin-web` | WORKING | `npx vite build` | `npm run dev:admin` | `src/main.tsx` |
| Owner App | Multi-salon owner portal | `apps/owner-web` | WORKING (web); native build NOT RUN — Mac required | `npx vite build` | `npm run dev:owner` | `src/main.tsx` |
| Technician App | Tech queue/schedule/earnings | `apps/tech-web` | WORKING (web); native NOT RUN | `npx vite build` | `npm run dev:tech` | `src/main.tsx` |
| Customer App | Booking, wallet, loyalty | `apps/customer-web` | WORKING (web); native NOT RUN | `npx vite build` | `npm run dev:customer` | `src/main.tsx` |
| Tap to Pay | Manager mobile checkout | `apps/manager-pay-web` | WORKING except final capture — BLOCKED: CommerceHub creds | `npx vite build` | `npm run dev:managerpay` | `src/main.tsx` |
| Customer Display | Chairside tip/signature screen | `apps/customer-display` | WORKING | `npx vite build` | `npm run dev:display` | `src/main.tsx` |
| Go Check-In Kiosk | Walk-in self check-in | `apps/go-check-in-kiosk` | WORKING (single-file HTML; gate + e2e covered) | — (single file) | open `www/index.html` (`?api=`) | `www/index.html` |
| Go Check-In Admin | Kiosk device manager | `apps/admin-web` → Check-In Devices (`/check-in-devices`) | WORKING — the single-file `apps/go-check-in-admin` page was removed Oct 10 2026 (Constitution 13 §388) | admin-web | admin-web | `CheckInDevicesScreen.tsx` |
| Online booking page | Self-booking with a customer account | `apps/customer-web` → Book | WORKING — the single-file `apps/booking-html` page was removed Oct 10 2026 (Constitution 13 §388); the no-login page is `apps/booking-public` | customer-web | customer-web | `BookScreen.tsx` |
| Guest booking page | NO-LOGIN booking from a signed link | `apps/booking-public` | WORKING — browser-verified; live signed-token run NOT RUN (needs AI_BOOKING_LINK_SECRET) | — (single file) | open `index.html` (`?t=&s=`) | `index.html` |
| Marketing site | aipowersalon.com (WordPress) | `marketing/` | Package ready — deploys separately to GoDaddy | — | — | see its README |

`npm run dev` = everything at once (api + all seven Vite apps via concurrently).

## START HERE — your first two days
1. **Run it** (LOCAL_DEVELOPMENT.md): install → DB up → 432 migrations → seed → API :3000 → POS + Super Admin.
   Log in with the seed accounts, check a customer in, serve, check out.
2. **Prove the green yourself** (don't take this document's word): the 8-shard battery, the 14 gates,
   `security:fast`, `auth-matrix-e2e`, `e2e:html`. Expected numbers are in the table above and TEST_REPORT.md.
3. **Read, in this order:** PROJECT_STATUS.md → REMAINING_WORK.md → DEVELOPER_TASKS.md → ARCHITECTURE.md →
   DATABASE_ARCHITECTURE.md → AUTH_AND_SECURITY.md → ENGINEERING_RULES.md → KNOWN_ISSUES.md →
   FRONTEND_BACKEND_GAPS.md → PAYMENTS_INTEGRATION.md.
4. **Then open DEVELOPER_TASKS.md and start at APS-001.** Do not rebuild anything that exists. Reuse first.

## The rules your work is accepted against
ENGINEERING_RULES.md — 16 invariants the gates enforce (integer cents, server-derived tenant ctx, migrations
discipline, targeted realtime, no fake connectivity, tests-with-every-change, …). Green before AND after every
change; a failing test is rewritten to pin new truth, never deleted.

## New-developer walkthrough (§51) — every question, answered with its doc
| Question | Answer lives in |
| --- | --- |
| What is this project? | README.md §What it is · ARCHITECTURE.md §1 |
| How is it structured? | ARCHITECTURE.md (diagram) · README.md §Applications |
| How do I install/configure it? | LOCAL_DEVELOPMENT.md §1–2 (env: `.env.example`, SECRETS_REQUIRED.md) |
| How do I create the database? | LOCAL_DEVELOPMENT.md §2 · DATABASE_ARCHITECTURE.md §4 |
| How do I start it? | LOCAL_DEVELOPMENT.md §3–4 |
| How do I log in for development? | LOCAL_DEVELOPMENT.md §5 (seed logins) |
| How do I run tests? | LOCAL_DEVELOPMENT.md §6 · TEST_REPORT.md |
| Which features work / don't? | PROJECT_STATUS.md · KNOWN_ISSUES.md (P1 table = looks-broken-but-gated) |
| What should I fix first? | DEVELOPER_TASKS.md APS-001… (nothing is broken; first work = verify, then creds) |
| Where are the APIs? | API_INVENTORY.md (generated; 2,281 routes) |
| Where are migrations? | `apps/api/db/migrations/` (432) — DATABASE_ARCHITECTURE.md §4 |
| How does tenant isolation work? | AUTH_AND_SECURITY.md §5 · DATABASE_ARCHITECTURE.md §1 |
| What does the schema actually look like? | DB_ERD_AND_DOMAINS.md (generated ERD + 618-table inventory) |
| Is it built to scale? What's verified? | DB_ENTERPRISE_VERIFICATION_REPORT.md · DB_PARTITIONING_READINESS.md |
| How does realtime work? | ARCHITECTURE.md §2 (`realtime-core.ts`) |
| How do payments work? | PAYMENTS_INTEGRATION.md |
| How are mobile apps connected? | README.md §Applications · MOBILE_ECOSYSTEM_MATRIX.md · MOBILE_CONVERSION_HANDOFF.md |
| How is production deployed? | DEPLOYMENT.md (nothing is hosted yet — honestly stated there) |
| What credentials do I need? | SECRETS_REQUIRED.md (names only; owner provides values) |
| Why is there no print button? | PRINT_FEATURES_REMOVED.md — owner decision, gate-enforced; do not re-add |
| What did previous work decide and why? | CHANGELOG_HANDOFF.md + the ~380 dated reports at root (preserved history — see HANDOFF_MANIFEST.md) |

## What Kevin (owner) provides — and the ground rules
Credentials per SECRETS_REQUIRED.md, hardware, store accounts, and the decisions in REMAINING_WORK.md §E.
Accounts stay owner-held; the developer gets limited roles; keys rotate on offboarding; **a GitHub push is not
a deployment** (PUSH_TO_GITHUB.md).
