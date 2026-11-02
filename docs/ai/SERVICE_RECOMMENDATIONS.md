# Service Recommendations (POS) — Nov 2 2026

Guide: *Service Recommendations* (Kevin, Nov 1 2026). Route: `/tenant/ai/customer-profile/recommendations` (unchanged).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Screen | Partial | A look-up box, then ONE customer's suggestions. The blank area in the screenshot was "nothing searched yet". No queue, cards, filters, dates, pages, review, health check or booking handoff. |
| Rule | Partial | `recommendServices` (most-completed service; services completed ≥ 2 times but not in 8 weeks). It matched services by **name**, so a renamed service broke the match; it called a single completion a "usual" service (low confidence). The UI listed a `complementary` category the rule never produces. |
| Catalog | Partial | Only "active" was checked (by name). No current price, duration, add-ons or qualifications were shown. |
| Booking | Missing | No check of upcoming appointments at all; no handoff. |
| Storage / review / outcomes | Missing | Nothing was stored, so nothing could be reviewed, counted or put on page 1. |
| Messaging / checkout | Verified (none) | No send or ticket path existed, and none was added. |
| Complementary / new-relevant services | Blocked by data | The catalog has no service-to-service relationship, so there is no verified basis to suggest them. Not generated (rather than invented). |

## What was built

- **One evaluation, the same rule.** `POST /pos/service-recommendations/scan` (Refresh; a run inside 60 s is reused; one per salon at a time) runs the assistant's `recommendServices` for every live customer over completed, non-add-on catalog service lines, **keyed by service id**, with the salon's active services. Rule version `sr-2026-11-02`.
  - Types: **Repeat service** (the most-completed service, at least twice) and **Previously preferred** (completed ≥ 2 times, last ≥ 8 weeks ago).
  - A single completion is shown as **Insufficient Service History**, not a weak suggestion.
  - Each suggestion is stored once per customer + service + type. `generated_at` is when it first appeared (kept while it lasts); one that disappears is **superseded** (kept for history); one that returns is new (page 1 again).
- **Live, not snapshotted:** price, duration, category, description, branch, approved add-ons (`service_add_ons`), qualified technicians (`technician_services`), upcoming bookings. A price change shows immediately (SR-03).
- **Service-level booking:** a suggestion whose **exact service** is in an upcoming appointment is *Already Booked*. An appointment for a different service does not satisfy it (shown as "Other booking").
- **States:** Needs Review · Reviewed / Review later / Not applicable (staff, pinned to the suggestion; a passed deferral returns) · Already Booked · Service inactive (deactivated since the evaluation) · No longer suggested.
- **Cards:** Recommendations, Customers evaluated, Needs review, Reviewed (30 days), Associated bookings (an appointment for the suggested service made after the suggestion — an associated outcome, not proof of cause), Insufficient history.
- **Queue:** tabs Needs Review / Reviewed / Already Booked / All current / No longer suggested / History / Evaluation history; search (the shared customer search + service name); type, service and technician filters; date dimension (created, updated, last completed service, review, customer created, appointment date) with presets and the From/To month calendar; six sorts (newest first by default, stable id); pages of 10/25/50/100.
- **360° overlay** (audited fail-closed): identity; type, confidence, localized reason; today's price, duration, add-ons, category, description; qualified technicians and the usual technician (only when they did more than half of at least `minVisitsForTechPref` completions); service frequency; last 10 visits; last 12 bookings with "this service" marked; Hội viên status counts; other current suggestions; caveats (inactive service, missing price/duration, already booked, no qualified technician, usual technician inactive or not qualified, availability not checked here); review and activity.
- **Open AI Booking Assistant** (`POST …/recommendations/:id/handoff`, needs `pos.booking.create`): re-checks the suggestion is current, the service is active, the technician is active **and qualified**, and the live calendar for this service (`SR_ALREADY_BOOKED` + date). Returns only the prefill and records one `booking_started` event — **never an appointment**. POS → Booking opens prefilled ("Prefilled from Service Recommendations…"); staff pick a time and confirm; availability, conflicts, idempotency and phone verification stay the Booking Assistant's.
- **Check Service Recommendations System** (read-only, one run per salon per 30 s): assistant enabled · evaluation freshness · suggestions match the last evaluation · completed-service history · catalog (price/duration present) · only active services suggested · qualified technicians · already-booked suggestions · live customers · deferrals due · tenant isolation (customers, services, events) · no side effects · indexes. All text localized on the POS.

## Routes (`pos.ai_customer_profile.view`)

`GET summary` · `GET recommendations` · `GET recommendations/:id` · `POST recommendations/:id/review` · `POST recommendations/:id/handoff` (+ `pos.booking.create`) · `GET history` · `GET scans` · `POST scan` · `POST check`. Full phone/email need `pos.customers.export`. The old per-customer route `GET /pos/ai-customer-profile/customers/:id/recommendations` is kept for the AI Customer Profile panel.

## Database (migration 766, additive)

`service_recommendation_scans`, `service_recommendations`, `service_recommendation_reviews`, `service_recommendation_events` (append-only trigger), `service_recommendation_health_runs`. Rollback: drop the five tables. No catalog, booking, ticket or customer row is written.

## Proof

- **pgtest 13/13** (`service-recommendations-center.pgtest.vitest.spec.ts`): Data Unavailable before the first evaluation; exact suggestions per fixture (usual / previously preferred / single completion / inactive-only / never served) and the cards; reuse inside 60 s; date kept across rescans; a deactivated service shows at once, is superseded, and returns as new; live price change; add-ons and qualifications; same-service vs different-service booking; review / not applicable / deferral / reopen; append-only; no appointment, customer or price change; handoff refusals (not qualified, already booked, inactive, superseded, other salon); search, filters, dates, newest-first; audit; health check.
- **Deliberate breaks caught:** booking matched at customer level instead of service level, and keeping single-completion suggestions — 8 tests fail.
- **AI Customer Profile suite:** 97 passed. **POS:** screen 7/7; Rebooking screen and handoff storage unchanged.

## Not done / for Kevin

- Complementary and "new relevant" services need a service-relationship source the catalog does not have.
- Loyalty tier / points are not shown (no single read API for them was found to reuse here); Hội viên status is.
- Live slot availability is the Booking Assistant's job; the overlay says so instead of showing a technician as "available".
- Branch-specific price overrides: services are per branch in this schema, so the suggested service's own branch price is the one shown.
- The evaluation runs on Refresh; there is no background schedule for it yet.
