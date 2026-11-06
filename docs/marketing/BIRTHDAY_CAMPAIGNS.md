# Birthday Campaigns — build handoff (guide 17 of 20, Oct 31 2026)

Route kept: `/tenant/marketing/birthdays` (Marketing & Growth → Birthday Campaigns). Backend: `/pos/birthdays/*`.
Migration: `750_birthday_campaigns.sql` (additive; applied twice to the local `aps` test template only — staging / production need
owner approval). Nothing here sends a message, issues an offer, charges anything or deploys.

## P0 — why October showed 0 customers (guide §05, B02)

Read-only code audit (the production database was not available, so the real October count is **BLOCKED_EXTERNAL**):

| Finding | Effect | Fixed |
|---|---|---|
| The month match itself was right: `customers.birthday` is a DATE and node-postgres hands it back as a local-midnight `Date`, so `getMonth()` gave the stored month. | Not a timezone bug in production. | — (now one shared rule: `birthday-core.ts`) |
| **Staff could not record or correct a birthday from the POS.** `PATCH /pos/customers/:id` silently ignored `birthday`; a birthday came only from "create customer", the CSV import (fill-if-empty) or the customer's own Customer App edit. | Most likely cause of an empty month: the data was never recorded. | The profile editor now saves it (validated, sourced, versioned); the Birthday page has a role-gated, audited **Update birthday**. |
| The POS row's `birthday` was `String(Date).slice(0, 10)` → `"Thu Oct 01"`. | The Customer profile's birthday line could not show a real date. | Read from calendar parts (`storedDateString`). |
| CSV import: `02/30/1990` passed the day check and failed the insert; `Date.parse` turned `Feb 30 1990` into **March 2**; month/day-only rows used the sentinel year **1900** (so `02/29` was rejected and ages of 126 appeared). | Lost or invented birthdays. | A real calendar check; no roll-over; month/day-only → `--MM-DD` → stored year-unknown on 2000; 750 marks the old 1900 rows year-unknown (dates kept). |
| Customer App: `toISOString()` on a local-midnight `Date` shifted the date a day back on a server east of UTC; `2026-02-30` reached the database as a 500. | Wrong / failed profile birthday. | Calendar parts; a real-date check; an unchanged `--MM-DD` sent back by the profile form is "no change". |
| Drivers disagree on DATE (node-postgres: local midnight; PGlite: UTC midnight). | The tests caught a one-day shift in a non-UTC process. | `parts()` reads UTC midnight as UTC and anything else as local; new queries select `to_char(birthday, 'YYYY-MM-DD')`. |

## What was built

- **Data model (750):** `birthday_year_known`, `birthday_source` (staff / customer_app / import / created; NULL = before tracking, shown as such, never guessed), `birthday_updated_at/_by`; `tenant_birthday_settings.feb29_policy` (feb28 default | mar1, versioned); `campaigns.occasion`; `birthday_message_claims` (unique salon + customer + occasion year + channel).
- **One birthday rule** — `modules/customers/src/birthdays/birthday-core.ts`: input parsing, Feb 29 policy, occurrence / next occurrence (Dec 31 → Jan 1), occasion year (the occurrence closest to the send date), ranges crossing years. A birthday is a calendar date and is never run through a timezone.
- **Center** — `modules/reports/src/birthdays/` (next to Marketing & Growth, which already reuses customers + Campaign Center without an import cycle):
  - `summary` KPI strip: birthdays in range · next 7 days · eligible SMS / email (consent + a `+country` number + no opt-out) · birthday messages sent this year · birthday offers redeemed (the campaign's deal, by a messaged customer, after the message) · completed visits within 30 days after a message — **labelled an association, never attributed revenue** · completeness.
  - `customers` table: scope (selected period / all with birthdays / missing), range presets (Today, Next 7 Days, This Month, Next Month, This Year, Custom ≤ 366 days, may cross years), date basis (occurrence / customer created), search (name, phone digits, e-mail, customer ID, "10/15"), eligibility, tier, sorts (upcoming — soonest next birthday first —, newest, name A–Z / Z–A), pages of 10 / 20 / 50 with exact totals; a search hit outside the period answers `no_match_in_period` instead of vanishing. Month/day only — never a birth year or an age.
  - `missing`: the **Missing Birthdays Center** — total / recorded / missing / invalid (future or 1900) / year-unknown / completeness / who recorded them; import rejections are **Unknown** (the import keeps no rejected-row log). Read-only.
  - `customers/:id`: the overlay = Customer Segments' authorized overlay (masked contact, consent, loyalty, visits, appointments, refunds, marketing history) + the birthday block, birthday messages and birthday offers; a true empty state. Audited (`birthdays.customer.viewed`).
  - `PUT customers/:id/birthday`: `customers.edit`; YYYY-MM-DD or MM-DD; future / impossible / ≤ 1900 refused; `expectedVersion` (409 on a stale copy); audited without the date itself.
  - `settings`: the Feb 29 policy (`marketing.manage`, versioned, audited).
  - `history`: birthday message claims, newest first.
  - **Smart Birthday Campaign Assistant** (`assistant/plan`, `assistant/save`, `marketing.manage`): objective (Greeting / Service Promotion / Loyalty Reward), range, channel, an existing approved template (published, Birthday / Promotions / General, matching channel), an existing offer (active or scheduled, not ending before the range). Selected / eligible / excluded **with reasons** (Segments' consent verdicts, plus "already sent a birthday message this year"). A message suggestion is labelled a suggestion. **Save = an UNSENT Segments audience (purpose `birthday`) + a DRAFT campaign in Campaign Center (occasion `birthday`)** — approval, launch and sending stay in Campaign Center. A retried save returns the same campaign.
- **Send-time rule (guide §13–§14):** the existing campaign send worker gained an occasion guard (`KyselyOccasionGuard`). For a birthday campaign it claims `birthday_message_claims` **before** the provider call: one birthday message per customer per occasion year per channel, across all birthday campaigns. Sent → `sent`; refused by the send path → `released` (a later campaign may try); a provider exception keeps the claim (never risk a second text); a second claim while one is in flight (a second worker or a run that died) is skipped `birthday_send_in_progress`. A customer whose birthday was cleared after approval is skipped `birthday_not_recorded`. Consent, opt-out, quiet hours, limits and the send ledger are unchanged and still run first.
- **POS screen** rebuilt in place (`POSBirthdaysScreen.tsx`): the original title, subtitle, Month dropdown (this month by default), count and list kept; KPI strip, presets + a real month calendar (`RangeCalendar`), scopes, search, filters, numbered pages, the overlay with Update birthday / Book Appointment (`/booking/new?customerId=…`, the same handoff as Segments) / Open Customer / Close, Missing Birthdays Center, history, Feb 29 setting, assistant. EN + VI (`ns/bdays.{en,vi}.ts`, 159 keys each; 11 error codes with EN + VI text).

## Guide §16–§17 test matrix (executed Oct 31 2026, stand-in runner + real PostgreSQL 16 + Chromium)

| ID | Evidence | Status |
|---|---|---|
| B01 | browser `bd` step 1 (Month dropdown = this month, route, shell) | COMPLETED_AND_VERIFIED |
| B02 | pgtest "the KPI, the list and a direct count agree (30)"; browser step 1 (KPI = list = independent SQL); P0 audit above | COMPLETED_AND_VERIFIED (code); the production October count is BLOCKED_EXTERNAL |
| B03 | pgtest birthday edit (MM-DD → year unknown, staff, version); browser step 7 (Nora 07-04 saved, missing count drops) | COMPLETED_AND_VERIFIED |
| B04 | pgtest Missing Center (missing 2, invalid 1, year-unknown 1; writes nothing); `birthday-core` refusals; import tests (02/30, 04/31, Feb 30 → refused) | COMPLETED_AND_VERIFIED |
| B05 | `birthday-core` recurrence; pgtest October across birth years 1975–2001 | COMPLETED_AND_VERIFIED |
| B06 | `birthday-core` Feb 29; pgtest Feb 28 / Mar 1 / leap 2028 + stored date unchanged; browser step 2 (setting saved, survives reload) | COMPLETED_AND_VERIFIED |
| B07 | pgtest name / phone digits / e-mail / id / "10/15" / page 3 found by search | COMPLETED_AND_VERIFIED |
| B08 | pgtest + browser step 5 (period hint → All finds → Missing scope) | COMPLETED_AND_VERIFIED |
| B09 | `birthday-core` ranges; pgtest Dec 25 → Jan 5 + refusals; browser step 4 (the real calendar, next-month navigation, cross-year) | COMPLETED_AND_VERIFIED |
| B10 | pgtest 3 × 10 = 30 unique, 50, fallback 20; browser step 6 (10 / page 2 / sort → page 1 / 50) | COMPLETED_AND_VERIFIED |
| B11 | pgtest upcoming order (days until never decreases); "newest" sort is the default of the missing scope | COMPLETED_AND_VERIFIED |
| B12 | browser step 10: 1920×945, 1536×864, 1366×768, 1280×720, 1024×768 — no page-wide sideways scroll | COMPLETED_AND_VERIFIED in Chromium; the physical ASUS 27″ is BLOCKED_EXTERNAL |
| B13 | pgtest Missing Center + edit; browser steps 5 + 7 | COMPLETED_AND_VERIFIED |
| B14 | pgtest overlay (month/day, true empty history); browser step 7 (Close, Book Appointment → `/booking/new?customerId=…`) | COMPLETED_AND_VERIFIED (the Booking screen itself is not served by the harness) |
| B15 | pgtest plan (selected = eligible + excluded, reasons); browser step 8 | COMPLETED_AND_VERIFIED |
| B16 | pgtest save (draft, occasion, 0 notifications, 0 claims, retried = same campaign); browser step 8 | COMPLETED_AND_VERIFIED |
| B17 | Segments verdicts (opt-out, no consent, no `+country` number, duplicate destination) in pgtest + race; executor unit case | COMPLETED_AND_VERIFIED |
| B18 | unchanged: Campaign Center + Email / Notifications keep provider-accepted vs delivered apart (guides 5, 8, 15); the birthday KPI counts `sent` claims and says so | IMPLEMENTED_NOT_VERIFIED here (no real provider) |
| B19 | real-Postgres race 3/3 (24 concurrent claims → 1; release → 1; two campaigns × 19 customers → 19); in-flight claim refused; **mutation: guard weakened → 0/3** | COMPLETED_AND_VERIFIED |
| B20 | the assistant only links an existing deal; redemption stays Checkout's ledger (guides 2–4); the KPI reads `deal_redemptions` | IMPLEMENTED_NOT_VERIFIED (no birthday redemption executed end-to-end here) |
| B21 | KPI "Visits after a message" labelled an association; no attributed revenue is claimed | COMPLETED_AND_VERIFIED (pgtest + screen text) |
| B22 | pgtest other salon (list, overlay, edit → not found); browser step 9 (Front Desk → notice + API 403); `check:tenant` | COMPLETED_AND_VERIFIED |
| B23 | gates below; POS / API type-checks and `POSBirthdaysScreen.test.tsx` need CI | IMPLEMENTED_NOT_VERIFIED (CI) |
| B24 | staging, migration 750 on staging / production, physical ASUS | BLOCKED_EXTERNAL |

Commands: `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD <spec>` for
`modules/customers/src/birthdays/birthday-core.vitest.spec.ts` (12/12), `modules/reports/src/birthdays/birthday-center.pgtest.vitest.spec.ts` (17/17),
`modules/customers/src/customers/customers-import.vitest.spec.ts` (23/23), `modules/ai/src/ai-marketing/ai-marketing-send.vitest.spec.ts` (13/13),
`apps/api/src/customer/customer.service.vitest.spec.ts` (9/9); with `PG_RACE_URL=postgres://postgres@127.0.0.1:55432/<db>`:
`modules/ai/src/ai-marketing/birthday-claims.postgres-race.vitest.spec.ts` (3/3; the CI race lane runs it too). Browser:
`node tooling/catalog-one-screen/interact.mjs bd-e2e bd` (10/10, screenshots `results/bd-e2e/`).

## Decisions / conflicts with the guide

- **Per-customer variables** (`{customer_name}`, `{birthday_date}`, `{booking_link}`): **NOT_IMPLEMENTED.** Campaign Center sends one approved text per campaign and fills only `{salon_name}` / `{offer}`; no booking-link generator exists. The assistant refuses a template or message with any other token rather than send it literally.
- **Scheduler:** no automatic birthday run exists or was added — a birthday campaign is created by a person, approved and launched in Campaign Center (guide: "no automatically generated campaign sends until enabled and approved"). The existing send worker's restart / retry safety applies; the claim adds once-per-year.
- **Offer issuance:** the assistant links an existing offer; it never issues one. Redemption, voids and refunds stay Checkout's / the deals ledger's.
- **A provider exception keeps the claim** (the text may have been accepted) — a manual review is needed before that customer can get a birthday text that year from another campaign. Owner may prefer releasing instead (open decision 3).

## Not verified / blocked

- IMPLEMENTED_NOT_VERIFIED (needs CI): POS / API type-checks; `POSBirthdaysScreen.test.tsx` (rewritten, 8 cases); lint, boot, api-contract, strict-bodies-types gates.
- BLOCKED_EXTERNAL: the real October count on production data; real SMS / email delivery; migration 750 on staging / production; the physical ASUS 27″ screen.

## Open owner decisions

1. Feb 29 birthdays in non-leap years: keep **Feb 28** as the default, or Mar 1?
2. Should Front Desk get read-only Birthday Campaigns (today: no marketing access → a notice)? Front Desk can already record a birthday from the customer profile (`customers.edit`).
3. A send that ends in a provider exception keeps the year's birthday claim (no risk of a second text). Release it instead?
4. Should a nightly job create birthday campaign *drafts* automatically (still approval-gated), or stay manual?

## Built Nov 6 2026 (A20 — Kevin: "continue finish all")

- **More date bases.** Last settled visit, birthday message sent, birthday changed (`birthday_updated_at`), alongside the existing
  occurrence and created.
- **New filters:**
  - Activity: visited in the last 60 days (`BD_ACTIVE_DAYS`), no visit in 60 days, or never visited.
  - Birthday source (`birthday_source`; none recorded = "unknown").
  - The tier filter already existed server-side.
- **Offer column.** Shows the offer from this occasion's sent birthday campaign: Redeemed (a `deal_redemptions` row that is
  redeemed and not reversed), Not used, or No offer.
- **History dialog.** Search covers name, campaign, channel and status. New From–To range on when the message was claimed (salon
  days), and page size 10 / 20 / 50.
- **Birthday timeline (overlay).** Up to six years. For each year: the message status, the offer status, and the closest settled
  visit within 14 days of the birthday. A customer with no birthday has no timeline.
- **Tests:**
  - `birthday-center.pgtest` (21)
  - `POSBirthdaysScreen.test` (9)
