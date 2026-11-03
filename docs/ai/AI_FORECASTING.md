# AI Analytics & Forecasting — Nov 2 2026 pass

Guide: *AI Analytics & Forecasting* (Kevin, Nov 1 2026). Route: `/tenant/ai/analytics` (unchanged; Appointments / Revenue / No-Show
Risk kept).

## Audit findings

| Area | Status | Finding |
|---|---|---|
| Engine | Verified | Model selection with backtesting, 80 % prediction intervals, accuracy recorded per run and evaluated when forecasts mature, no-show risk with reason codes and non-punitive actions, the 14-day minimum (no forecast below it). |
| Appointment history | **Broken** | The "appointments" series came from the **sales report**: paid tickets on days that had a sale. It measured completed sales, not appointments, and **days without a sale were missing** — so "have 9" counted sales days, and the model saw a series with the quiet and closed days cut out. Dates were UTC, and "today" (not over) was included. |
| Revenue history | **Bug** | Same gaps: days without revenue were missing instead of 0. |
| Readiness | Missing | The screen showed only the refusal text; there was no view of how much history each forecast had. |
| Search / calendars / pages over forecast history; health checker | Built Nov 2 2026 | Every forecast was already kept (`forecast_points`, migration 340) but nobody could see it. See "Forecast history and the system check". |

## What was built

- `BookingCalendarAppointmentSource`: appointments from the booking calendar (`pos_tech_appointments`, the table no-show risk and busy
  periods already read), one point per **salon-local** day from the first booked day to **yesterday**, quiet / closed days = 0,
  cancelled excluded, tenant + branch scoped. Seasonal trends and anomaly detection read the same series.
- `ZeroFilledRevenueSource`: revenue stays on the canonical sales report (one revenue definition), with the gaps filled as 0 days.
- `GET /pos/ai-analytics/forecast/readiness`: per forecast, the history days, the minimum, days short, first / last day, zero days —
  the same series the forecast is refused on. Revenue says "your role cannot see revenue" rather than showing a zero.
- POS: a "History behind the forecasts" panel above the tabs (EN/VI `fcx.*`).

## Forecast history and the system check (Nov 2 2026, migration 776)

`/pos/ai-analytics/center/*` (`forecast-center.ts`, `forecast-center.controller.ts`), read-only over the existing record, same
AI package gate and `pos.ai_analytics.view`; per forecast type the same rule as the forecast itself (appointments `reports.view`,
revenue `pos.reports.financial_view`, product demand `inventory.view` or `reports.view`). A branch user sees their branch only.

- `GET summary` — forecasts kept, last 30 days, days waiting for an actual, days compared with actual, last forecast per type.
- `GET runs` — one row per run: made (date, branch), type (product name for product demand), model + version, forecast days,
  status (not yet due · waiting for actuals · partly compared · fully compared), realized WAPE and share inside the 80% range
  (`—`, never 0, when no day has an actual). Search: run ID (full or prefix), model, version, branch, product. Type and status
  filters, presets + From/To month calendar on the made date in salon time, newest / oldest first, numbered pages of 10/25/50/100.
- `GET run?runId=` — each day: forecast, 80% range, actual, error, inside or not; a passed day without its actual says so.
  Backtest WAPE at the time, or "Backtest not available".
- `POST check` — **Check AI Analytics & Forecasting System**. Each check names the part it is about, what it found (cause and fix
  in the text) and when it last passed (from `forecasting_health_runs`). Checks: appointment history vs the 14-day minimum
  (through the forecast service's own series); bookings arriving (7 days); revenue history (or "cannot see revenue");
  data quality over 180 days — duplicate appointments (same Thợ, day, time, customer), impossible times / over 12 hours, past
  appointments with no outcome (FAILED over 1 in 5); no-show outcomes to learn from; forecasts kept in 7 days; ranges valid;
  passed days without an actual after 3 days; 80% range coverage (no verdict under 10 days, WARNING under 60%); backtest on the
  latest forecast; the subscription gate (blocked requests in 7 days, FAILED only when enforced); tenant isolation; no side effects.
  Reuses a run from the last 30 seconds; writes only its own evidence row.
- Not a check: "missing statuses" — `pos_tech_appointments.status` is NOT NULL with a CHECK list (migration 488), so it cannot be
  missing; "missing dates" — the series is zero-filled, a quiet day is a 0, which the readiness panel already shows.
- POS: a **Check AI Analytics & Forecasting System** button beside the tabs and a **Forecast history** section under the
  forecast, with a forecast-vs-actual dialog (EN/VI `fch.*`, namespace `forecastcenter`).

## Tests

- `forecast-history.pgtest.vitest.spec.ts` 3/3 (zero-fill, cancelled / today / other branch excluded; readiness = refusal). Forecasting
  suite 72 passed (3 skipped, as before). POS forecasting tests 4/4.
- `forecast-center.pgtest.vitest.spec.ts` 14/14 on the real schema (who sees which type, scope, search, status, dates, pages,
  forecast vs actual, every check incl. reuse, last success, read-only). POS `ForecastHistory.test.tsx` 7/7.

## Decisions for Kevin

- Built (Nov 2 2026). Search is by run ID, model, version, branch and product: a forecast is a salon / branch total, so it has no
  customer, Thợ or service to search by. Say if you want a per-service forecast; that is new modelling, not a list.
- A matured day gets its actual only when someone opens the forecast's tab (the accuracy panel fills it in). The check flags days
  left waiting over 3 days. Want a nightly job to fill them instead?
