# Rebooking Opportunities (POS) — Nov 2 2026

Guide: *Rebooking Opportunities* (Kevin, Nov 1 2026). Route: `/tenant/ai/customer-profile/rebooking` (unchanged).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Screen | Partial | A look-up box, then ONE customer's yes/no. The blank results area in the screenshot was simply "nothing searched yet" — there was no queue, cards, filters, dates, pages, review workflow or health check. |
| Rule | Verified (per customer only) | `rebookingOpportunity`: suppressed by any future appointment; Insufficient History below the cadence minimum; "approaching" (rebooking_soon) and "past the window" (due / inactive / long-term inactive) are eligible. It ran one customer at a time. |
| Customer Intelligence | Verified | The shared scan (guide 4) already ran this rule for every customer and counted it on the Rebooking card — but stored no window and no "opportunity created" date. |
| Booking handoff | Missing | The screen said "continue in the AI Booking Assistant" but had no button. The Booking Assistant (POS → Booking) had no way to be prefilled. |
| Service / technician | Missing | No last service, current price, or technician preference was shown. |
| Health check | Missing | — |
| Messaging | Verified (none) | No send path existed, and none was added. |

## What was built

- **One evaluation, no second engine.** The Customer Intelligence scan (Refresh on any of the three screens) now also stores, per customer:
  - `rebooking_since` — the first scan that saw the current opportunity, kept across rescans ("opportunity created");
  - the return window: `rebooking_due_on` = last completed visit + typical interval × `dueMultiplier`, `rebooking_window_end` = × `inactiveMultiplier` (the same multipliers the rule uses).
  - Rule version is now `ci-2026-11-02c`; older evaluations show as out of date until Refresh.
- **States** (persisted rule output, not renamed):

  | Rule output | State |
  |---|---|
  | eligible + past the window | Due for Review |
  | eligible + approaching (rebooking_soon) | Coming Due |
  | a future appointment — read **live** from the Booking Calendar | Already Booked |
  | below the cadence minimum, with a visit | Insufficient History |
  | no evaluation, or a failed one | Data Unavailable (never "zero opportunities") |

  A booking made after the last evaluation is shown as Already Booked immediately ("Booked since the last evaluation"), so a stale snapshot can never offer a second booking.
- **Cards:** Opportunities, Due for review, Already booked, Reviewed. Opportunities equals Customer Intelligence's Rebooking card (the health check proves it).
- **Queue:**
  - tabs: Due for Review, Coming Due, Reviewed, Already Booked, Insufficient History, All, History;
  - search: the shared customer search (name with or without accents, phone in any format, email, customer id, appointment id, technician, service);
  - service filter (active catalog) and technician filter (the server-paged picker): customers whose completed visits include them;
  - date dimension: opportunity created, last visit, suggested return, next booking, customer created, reviewed, evaluated — with presets and the From/To month calendar;
  - sort: newest opportunity first (default, stable id tie-break), most overdue, last visit, name; pages of 10/25/50/100; filter changes reset to page 1.
  - Each row: customer + masked phone, last service + visit, suggested service with **current** price and duration (or "Not active in the catalog"), due date, last technician, booking state, review state.
- **360° overlay** (audited fail-closed): identity; recommendation with evidence, window, interval, rule version; suggested service; technician (preferred only when they did more than half of at least `minVisitsForTechPref` visits); last 10 completed visits with services and technicians; last 12 bookings; Hội viên status counts; caveats (inactive service, inactive preferred technician, no cadence, booked since evaluation…); review state and activity.
- **Review workflow (internal only):** Mark reviewed, Review later (optional date), Reopen, Note — `rebooking_reviews` + append-only `rebooking_review_events`. A review is pinned to the opportunity it reviewed; a **new** opportunity returns to Due for Review, and so does a passed deferral. Version-checked.
- **Open AI Booking Assistant** (`POST /pos/rebooking/customers/:id/handoff`, needs `pos.booking.create`):
  - the server re-checks the opportunity and the **live** calendar (refuses with `REBOOKING_ALREADY_BOOKED` + the date), and that the service and technician are active;
  - it returns only the prefill (name, phone only with contact access, service, technician, a day that is never in the past) and records one `booking_started` event — **never an appointment**;
  - POS stores it for one use (10 minutes) and opens POS → Booking on that day; the Booking Assistant shows "Prefilled from Rebooking…". Staff still pick a time and confirm; availability, conflicts, idempotency and the salon's phone verification are the Booking Assistant's, unchanged.
- **Check Rebooking System** (read-only, one run per salon per 30 s): assistant enabled · evaluation freshness · agreement with Customer Intelligence · opportunity dates · completed-service history · visits record services · Booking Calendar · bookings since the evaluation · services catalog · active technicians · reviews on live customers · deferrals due · tenant isolation · no booking/message side effects · indexes. Each state's text is localized on the POS.
- **No autonomous action:** no booking, rescheduling, cancellation, message, campaign, loyalty or payment path. HO-01 proves a handoff creates no appointment; RV-01 proves a review changes no customer or appointment row.

## Routes (`pos.ai_customer_profile.view`)

`GET summary` · `GET customers` · `GET customers/:id` · `POST customers/:id/review` · `POST customers/:id/handoff` (+ `pos.booking.create`) · `GET history` · `POST check`. Full phone/email need `pos.customers.export`. The old per-customer route `GET /pos/ai-customer-profile/customers/:id/rebooking` is kept (the AI Customer Profile panel uses it).

## Database (migration 765, additive)

- Snapshot columns: `rebooking_since`, `rebooking_due_on`, `rebooking_window_end` + a partial index.
- Tables: `rebooking_reviews`, `rebooking_review_events` (append-only trigger), `rebooking_health_runs`.
- Rollback: drop the three tables and the three columns. No customer, booking or ticket row is rewritten.

## Proof

- **pgtest 14/14** (`rebooking-center.pgtest.vitest.spec.ts`): Data Unavailable with no evaluation; exact state per fixture and cards equal to the Intelligence count; opportunity date kept across rescans; overlay evidence (current price, preferred / inactive technician, inactive service caveat, masked phone); review changes nothing else and events are append-only; a new opportunity and a passed deferral reopen; refusals; handoff writes no appointment and one event; a booking made since the evaluation blocks the handoff and shows as Already Booked; inactive service / technician / other salon refused; search, service and technician filters, dates, newest-first; cross-tenant; audit; history; health check changes nothing.
- **Deliberate breaks caught:** skipping the live-calendar check and ignoring which opportunity a review belongs to fail 3 tests.
- **AI Customer Profile suite:** 84 passed (Intelligence 9/9 and Churn Watch 10/10 unchanged).
- **POS:** screen 7/7, handoff storage 3/3, Booking screen tests unchanged.

## Not done / for Kevin

- **Unrelated upcoming bookings still suppress** (the existing rule: any future appointment). The guide says an unrelated booked service should not automatically suppress; changing it changes the Intelligence and Churn numbers too, so it is listed as a decision.
- Service branch availability is not checked (services carry a branch; the Booking Assistant checks it when booking).
- The phone verification step and multi-technician booking are the Booking Assistant's existing behaviour; nothing was changed there.
- No 100k-customer load fixture was run for this screen.
