# Customer Segments — implementation handoff (Customer Segments Complete Build Guide, 30 Oct 2026)

Marketing & Growth → Customer Segments (`/tenant/marketing/segments`). Repaired in place; nothing deployed, nothing pushed, nothing sent.

Status words (guide §18): COMPLETED_AND_VERIFIED · IMPLEMENTED_NOT_VERIFIED · BLOCKED_EXTERNAL · FAILED · NOT_IMPLEMENTED.

## 1. Repository inventory

| Piece | Path |
|---|---|
| Screen (route unchanged) | `apps/pos-web/src/screens/POSSegmentsScreen.tsx` · route in `App.tsx` / `shell/tenant-nav.tsx` |
| API client | `apps/pos-web/src/api/posSegmentsApi.ts` |
| Strings (POS EN + VI) | `apps/pos-web/src/i18n/ns/segments.{en,vi}.ts`, error words in `ns/errors.{en,vi}.ts` |
| Server | `modules/customers/src/segments/segments.{repository,controller}.ts` (`/pos/marketing/segments/*`), registered in `customers.module.ts` |
| Shared visit facts | `modules/customers/src/retention/retention.repository.ts` (`base()` CTE — Segments and Retention use the same one) |
| Snapshots | `modules/customers/src/retention/retention-snapshots.ts` (existing nightly job, now also records VIP / tier) |
| Migration | `apps/api/db/migrations/735_customer_segments.sql` |
| Lifecycle | `SEGMENT_AUDIENCE_DRAFT` in `modules/customers/src/customer-lifecycles.ts` |
| Permissions | reads `pos.customers.view`; audience draft read `pos.marketing.view`; create / recheck / discard / link `pos.marketing.manage` |

## 2. Source data audit (answers to guide §02)

| Question | Answer from code |
|---|---|
| Does Returning count only qualifying visits? | Yes. A visit = a settled ticket (`closed` / `paid`), not removed; one ticket = one visit however many services. Cancelled / no-show bookings never become tickets. |
| Defect found | **`segment=new` was `visitCount <= 1`** — zero-visit profiles were shown as New. Fixed in both customer repositories (New = exactly 1, new `never` = 0). |
| Is "Regular" a separate loyalty tier? | Yes — `customer_loyalty_profiles.loyalty_tier`. It is not a marketing segment; Returning + Regular is consistent. |
| VIP rule | The authorized flag: `vip_since` set or a tier named VIP (set by staff with the loyalty permission). **No spend / visit threshold is configured; none was invented.** VIP overlaps New / Returning. |
| Historical membership stored? | Not before this work. Now: the existing durable daily snapshot rows (`customer_retention_daily_snapshots`) + VIP / tier from the nightly run onward. |
| Tenant-wide vs branch | Customers stay tenant-wide; the branch filter limits the visit activity counted (Retention CR-02 rules). |
| Lifetime Spend | Settled ticket totals (as recorded) minus completed refunds of those tickets, never < 0 — the same definition as Retention's Lapsed Value. |
| Last Visit | `coalesce(paid_at, created_at)` of the last settled visit (was `max(created_at)`), shown in salon time. |
| Reference customer (Vishaal kumar, 15 visits, Regular, $440.76) | Reproduced in the harness from 15 settled tickets totalling $440.76 → Returning, not VIP. |

## 3. Implementation

- **Segments (segments-v1):** Never Visited 0 · New exactly 1 · Returning 2+ · VIP authorized flag · Inactive = 1+ visit and ≥ the salon's Retention At Risk days. Ruleset version + Retention settings version in every answer.
- **List:** server SQL with search (name, phone digits / formatted, email, customer id, ticket / appointment id, service), date basis (created / first visit / last visit / visited during range) with salon-local whole days, visits / spend range, tier, service, SMS / email eligibility, branch activity, six stable sorts (default newest account first), page sizes 10 / 20 / 50, exact totals, page clamp.
- **Why This Segment?** per-customer facts, rule per segment (met / not met), thresholds, ruleset and settings version.
- **Overlay:** masked contact, visits, appointments, spending & refunds, loyalty, qualification, marketing history (retention outreach + audience drafts), contact preferences; Close; Open Booking (`/booking/new?customerId=…&from=segments`), full profile, communications. Every overlay read is audited (fail-closed).
- **Audience Builder:** page / selected / all matching (server-resolved, cap 5,000) → per-customer SMS or email verdicts (no consent, opted out, missing / invalid contact, recently messaged, shared destination dedup, never visited for win-back) → an **unsent** draft (24 h expiry, idempotent key, audited in the same transaction) → optional Campaign Center draft link. Re-check consent at any time; discard. **Nothing here sends**; Campaign Center's own activation (with its confirmed estimate) is the approval gate.
- **Snapshots:** "As of date" reads stored days only (available / missing / incomplete / not completed / failed); VIP shown as unrecorded for days before the nightly recording began.
- **Data health:** last evaluation, last settled visit, unknown-branch visits, walk-in visits without a customer, shared phone groups, last snapshot run, VIP rule.
- **Flags / rollback:** no new flag; additive migration (two nullable columns, two new tables). Rollback = revert the commit; the columns / tables can stay (unused).

## 4. Integrations

| Module | Contract |
|---|---|
| Customer Retention | Same CTE and thresholds; Inactive = At Risk; Never Visited never Inactive. Retention suites re-run green. |
| Booking | Open Booking passes only `customerId` (no PII in the URL); the booking screen loads the customer itself. |
| Campaign Center | Draft row created through its own create API; Segments only links the id. Sending / approval stays in Campaign Center. |
| Loyalty | Reads tier / VIP flag only; no balance or ledger writes. Global Rewards untouched. |
| SMS / email | Consent: `marketing_sms_opt_in` / `marketing_email_opt_in` + `notification_opt_outs`. No provider is called. |

## 5. Testing (executed 31 Oct 2026, ~01:10 UTC, local workspace, PostgreSQL 16 + unit stand-in, Chromium)

| Evidence | Command | Result | Status |
|---|---|---|---|
| Segments pgtest (13: 0/1/2/15 visits, cancelled / voided / removed, multi-service, refunds, mixed branch, search beyond page 1, DST boundary, paging, filters, snapshot idempotency + Sept→Oct + no invented history, audience consent / dedup / never-visited / no send / idempotent / recheck / discard / expiry / campaign link, cross-tenant, branch 403, masked overlay) | `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/customers/src/segments/segments.pgtest.vitest.spec.ts` | 13/13 | COMPLETED_AND_VERIFIED |
| Customer list classification (New = 1, Never = 0, Returning 2+, no overlap) | same runner, `modules/customers/src/customers/customers-core.spec.ts` | 62/62 | COMPLETED_AND_VERIFIED |
| Retention regression (snapshot change, shared CTE) | same runner, `retention{,-guide,-round2}.pgtest.vitest.spec.ts` | 10/10 · 12/12 · 14/14 | COMPLETED_AND_VERIFIED |
| POS E2E (11 steps, screenshots) | `node tooling/catalog-one-screen/interact.mjs seg-e2e seg` | 11/11 — `tooling/catalog-one-screen/results/seg-e2e/` | COMPLETED_AND_VERIFIED (browser simulator) |
| Gates | `npm run -s check:*` (14) + sql-prepare, actor-stamp, types drift, db-ownership, unique review, error catalog sync | all rc 0 | COMPLETED_AND_VERIFIED |
| POS unit tests (`POSSegmentsScreen.test.tsx`, rewritten) | vitest + Testing Library | not run here (no React test packages in this workspace) | IMPLEMENTED_NOT_VERIFIED |
| POS / API type-check | `tsc --noEmit` | not run here (no type packages) | IMPLEMENTED_NOT_VERIFIED |
| Physical ASUS 27″ at 100 % zoom | — | only Chromium viewports 1920×945, 1366×768, 1280×720, 1024×768 | BLOCKED_EXTERNAL (hardware) |
| Real SMS / email send | — | never attempted (draft only by design) | NOT_IMPLEMENTED here — Campaign Center |

Harness note: the E2E's Open Booking step checks the handoff URL; the booking screen's own APIs are not served by this harness (the run reports that as a page error after navigation).

## 6. Release readiness

| Item | State |
|---|---|
| Code | CODE_READY (gates + executed tests above) |
| Staging | not deployed (owner approval needed for migration 735 and deploy) |
| Hardware | not tested on the physical ASUS screen |
| Open decisions | (1) whether the salon wants an automatic VIP rule (spend / visits) — today VIP is the authorized flag only; (2) the audience draft expiry (24 h chosen) |

## 7. Continuity

See `CONTINUE_HERE.md` → "Customer Segments". Next: CI (unit tests + type-check) after K-12 steps 1–5; owner approval for 735 on staging; a staging run of the nightly snapshot job to confirm VIP recording.
