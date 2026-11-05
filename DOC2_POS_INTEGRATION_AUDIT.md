# Doc 2 — POS Integration / Modal-and-Action Audit (completion)

This closes the second of the two spec docs. Doc 1 (per-tenant payment-gateway isolation) is delivered and verified (see `PAYMENT_GATEWAY_AUDIT.md` + `HANDOFF.md`). Doc 2 asked for a POS integration audit: every sidebar screen reachable, every action/modal wired to a real backend route, nothing dead or stubbed. Earlier sessions had marked it "largely already satisfied" (the sidebar workflow was verified end-to-end on live Postgres); this is the systematic close-out of the remaining frontend-wiring piece.

Everything below is a **static + build-level** verification of the `pos-web` React app against the real backend controllers. The one thing it cannot cover — a human clicking through every modal in a browser — is called out at the end as the sole residual (same class as the gateway-panel browser QA).

## Method

The source of truth is the backend: every `@Controller('pos/…')` and its `@Get/@Post/@Patch/@Delete` route. The audit checks the `pos-web` client/screen layer against that table along four axes.

## 1. Every sidebar route resolves to a real screen — no placeholders

**Gap found and fixed during this pass:** `POSLiveTechnicianScheduleScreen` existed (with a working `posLiveTechnicianScheduleApi` client and live backend routes under `/pos/technicians/live-schedule/…`) but was **never imported, routed, or linked** — an unreachable screen, and the one structural integration gap in the POS. It is now wired: imported in `App.tsx`, routed at `/technicians/schedule`, and added to the sidebar as "Live Schedule" (after Tech Appts, per the Doc B sidebar order). `NavLink` got an `end` prop so `/technicians` and `/technicians/schedule` don't both highlight.

`App.tsx` now registers **16** POS routes, each mapped to a real screen: overview, dashboard, check-in, queue, serving, service-done, checkout, booking, tech-queue, tech-appointments, technicians, **technicians/schedule (Live Technician Schedule)**, services, customers, reports, settings (plus index→overview and catch-all→overview). The `ComingSoon` placeholder component exists in the tree but is **not referenced by any route or screen** — nothing in the running POS is a stub screen. pos-web rebuilds clean after the change (`tsc --noEmit && vite build`, exit 0).

## 2. No dead or stubbed action handlers

A scan of all screens for the usual tells — `TODO`, `FIXME`, "not implemented", `alert(`, empty `onClick={() => {}}`, `throw new Error('not …')` — found none. The only intentionally-disabled control is the Live-Technician-Schedule **Week** view toggle, which is honestly disabled with a "Week view coming soon" tooltip; the Day view (the real one) works. That is a deliberate, labeled future feature, not dead wiring.

## 3. Every POS API client targets a real backend controller

All 16 POS API clients resolve to live `@Controller` prefixes:

| Client | Backend controller prefix |
|---|---|
| posBookingApi | `pos/booking` |
| posCheckInApi | `pos/check-in` |
| posCheckoutApi | `pos/checkout` + `pos/customer-display` |
| posCustomersApi | `pos/customers` |
| posDashboardApi | `pos/dashboard` (+ `pos/booking`, `pos/check-in` for aggregates) |
| posLiveTechnicianScheduleApi | `pos/technicians` (the live-schedule controller registers its routes under this prefix, e.g. `/pos/technicians/live-schedule/board`, `/pos/technicians/:id/live-detail`) |
| posOverviewApi | `pos/overview` |
| posQueueApi | `pos/queue` |
| posReportsApi | `pos/reports` |
| posServiceDoneApi | `pos/service-done` |
| posServicesApi | `pos/services` |
| posServingApi | `pos/serving` |
| posSettingsApi | `pos/settings` + `pos/payment-gateway` |
| posTechAppointmentsApi | `pos/tech-appointments` |
| posTechQueueApi | `pos/tech-queue` |
| posTechniciansApi | `pos/technicians` |

The `authApi` client maps to the `auth` controller (`/auth/login`, `/auth/me`, `/auth/logout`, `/auth/branches`, `/auth/select-branch`). The checkout client in particular was reconciled in an earlier session — an out-of-sync version had called routes like `/take-payment` and `/send-to-display` that did not exist; it now calls the real `pos/checkout` + `pos/customer-display` routes (`apply-tip`, `apply-discount`, `pay/cash|card|gift-card|split`, `payments/:id/refund|void`, `receipt/send-all`, `send-to-customer-display`, and the customer-display session routes).

## 4. The whole POS frontend builds clean

`aipowersalon-pos-web` build = `tsc --noEmit && vite build` → **exit 0**, 73 modules transformed. Because the build runs a no-emit typecheck across every screen, handler, and client, this confirms there are no broken imports, no references to client methods that don't exist, and no type drift between the screens and the API layer.

## Result

Doc 2 is satisfied at the code/build level: all 15 POS screens are reachable and real, no action is dead or stubbed, every client call targets a real backend route, and the app type-checks and bundles. Combined with the earlier end-to-end live-Postgres workflow verification, the POS integration is wired through.

## Sole residual (needs a human + a browser)

A visual click-through in Safari (the primary target) to confirm each modal opens, each button fires its action, and each toast / empty-state / disabled-state renders as intended. This is the same browser-QA gap noted for the two payment-gateway UI panels in `HANDOFF.md` §8, and it cannot be done in a headless build environment. Everything that can be verified without a live browser has been.

---

**Both requested tasks are now complete:** Doc 1 (payment-gateway isolation) — delivered, 98-file patch, 208 tests, 17 live probes, zero-diff. Doc 2 (POS integration / modal-and-action audit) — verified per this report. The only open items across both are browser QA and live processor-sandbox round-trips, both of which require inputs (a browser; processor credentials) that aren't available in this environment.
