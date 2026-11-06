# F1 Customer Directory — §45–§89 status (Nov 6 2026)

Guide: `e626fa9a-Customer.pdf` (Customer Directory — Master Redesign, Functional Repair & Developer Handoff, 90 sections).
§1–§44 and §53/§55/§58/§60/§61/§62 were built Nov 4–5 (see `docs/GUIDE_QUEUE_2026-11-03.md`, F1 section). This file is the
evidence for §45–§89. Statuses: DONE (built + test named), PARTIAL (what is missing is said), NOT_TESTED (needs hardware or
a browser this environment does not have), BLOCKED (external).

| § | Topic | Status | Evidence / what was done |
|---|---|---|---|
| 45 | Customer Profiles | DONE | One profile implementation (`modules/customers` repository + POS profile drawer / Customer Profile screen). Customer App profile is an explicit column list — no notes, safety notes or staff fields (`apps/api/src/customer/customer.kysely.repository.ts` `profile()`). **Fixed Nov 6:** the Customer Profile showed a birthday one day early west of UTC (`new Date('YYYY-MM-DD')`); calendar dates now use `fmtYmd`, timestamps the location's clock (`ymd-birthday.test.ts`). |
| 46 | Appointment History | DONE | Canonical `pos_tech_appointments` + `tickets` (no second history). **Fixed Nov 6:** Appointment History rendered in the device's time zone; now the location's (`fmtInZone`). |
| 47 | Loyalty & Rewards | DONE | Ledger is the truth (`loyalty-ledger.service`); G1 removed direct point edits (owner-approved bonus only, `loyalty-bonus.pgtest` 10). Merge moves points as a balanced pair of `merge` ledger entries — **`customer-directory-f1-finance.pgtest` (new, 3):** total points and ledger net identical before / after; repeated merge refused, no second pair. |
| 48 | Gift Cards | DONE | Concurrent redemption guarded by the gift-card redemption hold / row lock (`modules/gift-cards` race specs). Merge reassigns the card's owner, never copies it — the new test proves the salon's gift-card balance total is unchanged. |
| 49 | Customer Notes | DONE | Notes live on the staff-side profile only; the Customer App profile never selects them; the live IDOR sweep (customer realm, 43 routes) shows no cross-customer read. |
| 50 | Saved Cards | DONE | Only provider token + brand / last4 / expiry stored; a raw PAN is refused (`looksLikeRawPan`); **new assertion:** neither the add answer nor the list carries the token (`customer-payments.vitest`). Merge moves the REFERENCE only (no provider call — `mergeCustomersTx` is SQL only). |
| 51 | Retention module | DONE | Directory KPIs and the Retention screen share definitions (F1 §11/§37, F2 audit); View Report links go to real reports (§32). |
| 52 | NailShowcase and media | DONE | Customer write routes check the author in the service — **new `nail-showcase-ownership.vitest` (6):** another customer cannot edit / delete a post or comment, nothing is written, reaction removal names only the caller; the IDOR exemption now cites it. Photo consent: `nail-photo-consent` specs. |
| 53 | Add Customer | DONE | Nov 5 (idempotent submission, duplicate check before save). |
| 54 | Edit / archive / restore | DONE | Archive is a status (never deletes visits / payments); data deletion is the separate privacy-request flow (`customer_deletion_requests`). Audited + `customer.updated` (Nov 5). |
| 55 | Export controls | DONE | `pos.customers.export` permission, money columns omitted without financial access, CSV formula guard incl. tab / CR, export audited, async above 20,000 rows (`@AsyncExport`) — `customers-core.spec`. |
| 56 | Global identity vs tenant profile | DONE | Merge and directory are tenant-scoped; the new finance test proves another salon's same-phone customer is untouched and cannot be merged in. |
| 57 | Customer API audit | DONE | Routes, permissions, resource scope per route in `apps/api/openapi/manifest.txt` (§38 labels Nov 5); strict bodies; live IDOR sweep 17/17 (reads, writes, customer realm). |
| 58 | Search performance | DONE | Nov 5 SQL directory; 100,000 customers 1.78 s on PGlite. |
| 59 | Metrics authority | DONE | One SQL statement for page / counts / KPIs (`customer-directory-sql.ts`), equal to the reference path in 27 cases; spend net of refunds. |
| 60 | Realtime | DONE | create / update / archive / restore / merge emit one domain event each with ids only (`customer-merged-producer.pgtest`, `customer-directory-f1.pgtest`). |
| 61 | Scale datasets | DONE | 15 (fixtures) / 1,000 / 10,000 / 100,000 (`customer-directory-scale.pgtest`, `CUSTOMER_SCALE=1`). |
| 62 | No unbounded fetching | DONE | One page per request, payload < 200 KB asserted at every size. |
| 63 | Touchscreen | NOT_TESTED | No touchscreen here; tap targets follow the FitKit sizes. |
| 64 | Scroll / focus | DONE (logic) | Overlay restores focus to the opener (Nov 5); physical scroll NOT_TESTED. |
| 65 | Screen sizes | NOT_TESTED | No browser at 1920×1080 / 2560×1440 / 1600×900 / 1366×768 in this environment. |
| 66 | Typography / contrast | NOT_TESTED | Visual check needs the browser. |
| 67 | EN / VI | DONE | POS i18n gates green (Nov 6); Customer App / Owner / Super Admin English only (catalog tests). |
| 68 | Smoke test | PARTIAL | Component tests of the directory screen pass (POSCustomers*); a live browser smoke needs the browser. |
| 69 | Create / edit test | DONE | Idempotent create, edit persists, audit (`customers-core.spec`, `customer-directory-f1.pgtest`). |
| 70 | Search / filter / page | DONE | 27 filter combinations equal the reference (`customer-directory-sql.pgtest`), Vietnamese and accent-free search. |
| 71 | Duplicate candidates | DONE | `duplicate-review-center.pgtest` DT-00..03 (blank phone is not a match, name alone is "Possible", across tenants never). |
| 72 | Approved merge | DONE | MG-01..04 + two-reviewer race (`duplicate-review.postgres-race`, real Postgres, passes). |
| 73 | Finance safety | DONE | `customer-directory-f1-finance.pgtest` (new). |
| 74 | Export / authorization | DONE | See §55; the export has no id parameter — the tenant comes from the session. |
| 75 | Realtime test | PARTIAL | Event production and tenant room isolation are tested (`realtime-isolation`); a two-terminal live run needs two browsers. |
| 76 | Analytics validation | DONE | SQL path equals the reference on a known dataset; retention trend reports missing snapshot months as "—", never a number. |
| 77 | Accessibility / touch | PARTIAL | Labels / focus restore tested; physical touchscreen NOT_TESTED. |
| 78 | Security negatives | DONE | Live IDOR sweep (cross-tenant reads, writes incl. merge / notes / export routes, customer realm) 17/17; saved-card token never returned; showcase ownership test. |
| 79 | Busy-state / load | DONE (measured) | 100,000 customers, 200 technicians, 3 locations (`customer-directory-scale.pgtest` "busy salon"; `BUSY_PG_URL` runs it on a real PostgreSQL 16). See §79 below. |
| 80 | Cross-app | PARTIAL | Canonical customer id across POS / check-in / checkout / loyalty (shared tables); Customer App stays English (catalog test). A live cross-app walk needs the apps running in browsers. |
| 81–83 | Definition of Done / statuses | — | This file. |
| 84 | Before / after screenshots | BLOCKED | No browser at the 27-inch target here. |
| 85–87 | Code map / changed files / build matrix | DONE | Commits listed in GUIDE_QUEUE F1 section; files named per row above. |
| 88 | External blockers | — | Screenshots, physical touchscreen, multi-terminal live realtime run. |
| 89 | Handoff | DONE | This file + GUIDE_QUEUE F1 section. |

## §79 measured (Nov 6 2026)

Ten front-desk queries × 3 rounds over 100,000 customers, 200 technicians, 3 locations, with 50 writes landing during the reads.
Every answer was correct at every step (page sizes, tab counts that add up, accent-free search finds accented names).

| Run | p50 | p95 | Slowest | Search queries |
|---|---|---|---|---|
| PGlite, before the fixes | — | — | 85 s | 65–85 s |
| PGlite, search folded once per row | 2.2 s | 13.9 s | 14.1 s | ~13.5 s |
| Real PostgreSQL 16, same code | 3.6 s | 9.7 s | 9.7 s | ~9.5 s |
| **Real PostgreSQL 16, JIT off + stored search key (822)** | **1.23 s** | **1.33 s** | **1.44 s** | **~1.3 s** |

What was wrong, and the fixes:
1. **Search folded per column and per tab count** (65–85 s). Folded once per row instead.
2. **PostgreSQL JIT compiled the query on every request**: 2.6 s of the 3.5 s first page. Our queries run once per
   request, so compiling them never pays back. `poolOptions()` now turns JIT off (`PG_JIT=on` turns it back on).
3. **vi_fold() on every row on every search** (~6 s at 100k; it is a long translate + regexp). Migration 822 keeps
   the folded key on the row (`customers.search_fold` / `search_digits`, maintained by a trigger, backfilled — 15.7 s
   for 100k rows). A test proves the stored key equals the query-time fold, and that it follows every update.

What is left: the ~1.2 s that remains is the directory computing tab counts and duplicate flags over the whole
customer base on every request, by design; it grows with the number of customers (not measured on real PostgreSQL
below 100,000 in this pass). A salon with 100,000 customers would want those counts cached — not built.
Also measured on the same data: the Customer Search center's name match (three per-row vi_fold() calls) takes 1.8 s at
100,000 customers. Recorded, not changed: switching it to the stored key would widen what it matches (email and phone).
