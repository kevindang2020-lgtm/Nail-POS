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
| Search / calendars / pages over forecast history; health checker | Not built | See decisions. |

## What was built

- `BookingCalendarAppointmentSource`: appointments from the booking calendar (`pos_tech_appointments`, the table no-show risk and busy
  periods already read), one point per **salon-local** day from the first booked day to **yesterday**, quiet / closed days = 0,
  cancelled excluded, tenant + branch scoped. Seasonal trends and anomaly detection read the same series.
- `ZeroFilledRevenueSource`: revenue stays on the canonical sales report (one revenue definition), with the gaps filled as 0 days.
- `GET /pos/ai-analytics/forecast/readiness`: per forecast, the history days, the minimum, days short, first / last day, zero days —
  the same series the forecast is refused on. Revenue says "your role cannot see revenue" rather than showing a zero.
- POS: a "History behind the forecasts" panel above the tabs (EN/VI `fcx.*`).

## Tests

- `forecast-history.pgtest.vitest.spec.ts` 3/3 (zero-fill, cancelled / today / other branch excluded; readiness = refusal). Forecasting
  suite 72 passed (3 skipped, as before). POS forecasting tests 4/4.

## Decisions for Kevin

- Forecast history list with search (customer / technician / service), month calendars and pages, and a dedicated forecasting health
  checker — build them next, or is the readiness panel enough for now?
