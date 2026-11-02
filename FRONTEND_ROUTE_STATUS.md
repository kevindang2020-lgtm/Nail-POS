# FRONTEND_ROUTE_STATUS.md — every app, every screen/route (mandate §245–§246 / 130-section §125), Oct 20 2026

## Oct 22 2026 update (measured on this tree with the same extractors)

| Measure | Value | Command |
|---|---|---|
| Frontend API call sites | **2,637**, all **2,637 wired** to a real backend route, **0 orphaned** | `node apps/api/scripts/audit-crosswire.js` |
| Backend routes | **3,085** | `node apps/api/scripts/audit-routes.js` |
| Unreached routes | **0 new**; 157 on the reviewed ledger; 339 super-admin / customer / native-only (listed with `--verbose`) | `node apps/api/scripts/audit-unreached-routes.js` |
| App typecheck | all 7 SPAs type-check | `node tooling/ci/check-app-types.mjs` |

Screens changed Oct 22 (each with tests; wiring proved live by the pilot day, phase 10):

| App · screen | Before | Now |
|---|---|---|
| POS · New Booking → Available Start Times | a fixed list 9:00 AM – 4:00 PM, whatever the services / technician / day | `GET /pos/booking/availability` for the selected services **and add-ons**, technician and day; nothing open → says so; the call failing → the standard list, labelled "not checked"; accepts `?time=HH:MM` (Best Matches) and `?serviceId=` hand-offs |
| POS · Booking board → Find an Opening / Best Matches | a fixed "Gel Manicure · 45 min" label; Best Matches = the first free 45-minute gap of any technician | a real service picker; Best Matches = the earliest open start from the availability API (only technicians who may do the service; never a time already past); Find an Opening opens New Booking with the service selected |
| POS · Booking board (day) | drew only the first 50 appointments | `loadAllBookings` follows the pages (100 each) to the end of the day |
| POS · Save Draft (B-22, earlier Oct 22) | booked a real appointment | a real draft (resume / discard strip) |
| Owner App · Finance (dashboard, report, list, export, vendor spend) | "All branches" sent no branch → the API used the branch picked at sign-in | sends `branchId=all`; salon-wide expenses included |
| POS / Owner App · Receipt upload | every upload answered 500 | accepted; quarantined honestly until object storage + scanner + Textract exist |

Open (frontend) — B-22 is closed; B-24 (i18n beyond POS / display / manager-pay / customer) and B-25 (a11y pass) remain; see `NEXT_STEPS.md`.


Measured from the tree at the final-run commit with the same extractors CI runs (`apps/api/scripts/audit-crosswire.js`, `audit-unreached-routes.js`, `frontend-calls.js`) plus a parse of each app's router / navigation shell. Browser proofs: lane `live-pilot-day` (screenshots in `final-run/pilot-shots/`) and lane `e2e-html` (TEST_REPORT.md).

## 1. Headline (this tree)

| Measure | Value |
|---|---|
| Frontend API call sites | **2,527** — **2,527 wired** to a real backend route, **0 orphaned** (`audit-crosswire`) |
| Backend routes | **2,991** (`audit-routes`): `/pos` 998 · `/super-admin` 1,126 · `/tenant` 183 · `/customer` 157 · `/tech` 136 · `/owner` 122 · `/mobile-checkout` 45 · `/auth` 42 · `/community` 42 · machine/public/webhook/health the rest |
| Routes with no frontend caller | 518: 24 machine surfaces (webhooks / jobs / public — expected), 337 super-admin / customer / native-only, **157 on the reviewed debt ledger — 0 newly dead** (`unreached-routes.baseline.json`, `check:unreached` gate) |
| Placeholder screens | **0** — `featureRoutes()` (POS nav items without a dedicated screen → gated `FeaturePage`) resolves to an empty list: all 196 tenant-nav items have a screen |
| Builds | all web apps build in lane `build-frontends` (rc in TEST_REPORT.md); typecheck lane `typecheck-api` covers apps |

## 2. Per app

| App (`apps/`) | Shell / navigation | Routes or screens | Wired | Static by design | Status |
|---|---|---|---|---|---|
| `pos-web` (POS, Owner desktop, Manager) | React Router, `App.tsx` + data-driven `shell/tenant-nav.tsx` (196 nav items, `EXISTING_ROUTES` = 199) | **219** distinct route paths (57 `/ai/*`, 16 `/payments/*`, 14 `/marketing/*`, 14 `/management/*`, 13 `/reports/*`, 10 `/team/*`, 10 `/devices/*`, 9 `/customers/*`, 9 `/communications/*`, 9 `/account/*`, 6 `/integrations/*`, 25 top-level) + 21 `<Navigate>` redirects for old settings URLs | all screens call `src/api/*` clients (47 modules) | Help Center, legal pages | PASS — pilot day drives check-in → queue → serving → checkout → refund (incl. the new "being verified" section) → reports |
| `admin-web` (Super Admin) | React Router, `App.tsx` | **153** route paths (107 top-level sections; tenant detail `/:tenantId/*`) | 18 API-client modules, 100 % resolve | — | PASS |
| `customer-web` (Customer app, Capacitor) | React Router, `App.tsx` | **53** route paths (`/profile` 9, `/social` 6, `/nail-showcase` 5, `/appointments` 4, `/gift-cards`, `/deals`, `/follow-ups`, `/wallet`, `/visit`, `/transactions`, `/legal`) | `src/api/*` | legal | PASS; booking now refuses an unskilled technician (B-05) |
| `owner-web` (Owner mobile, Capacitor) | in-memory nav `shell/nav.tsx`: 7 tabs (`home live approvals branches reports staff more`) + **27 pushed screens** (bookings, techDetail, alerts, audit, expenses, payroll, payments, paymentDevices, hardwarePayment, cashDrawer, cashHandoff, cashSummary, customers, giftCards, inventory, marketing, memberships, notifications, aiCenter, aiPackages, communitySettings, tickets, settings, profile, privacy, terms, deleteAccount) | 54 screen files | `src/api/*` | privacy, terms | PASS; screen names tracked as route templates for analytics / crash reports |
| `tech-web` (Technician mobile, Capacitor) | in-memory nav: 5 tabs (`home schedule tickets earnings more`) + **24 pushed screens** (queue, ticket, timeClock, timeOff, tips, payroll, cashHandoff, cashPending, performance, serviceHistory, myClients, myDeals, followups, messages, certifications, workplaces, reportProduct, notifications, settings, profile, help, privacy, terms, deleteAccount) | 30 screen files | `src/api/*` | help, privacy, terms | PASS |
| `manager-pay-web` (Owner & Manager Payment / Tap to Pay, Capacitor) | in-memory nav: 4 tabs (`checkout history reports account`) + Login, Ticket, TapToPay, Success, Handoff, ReturnToStaff | 10 screens | `/mobile-checkout/*` (45 routes) | — | PASS on the loopback processor; real Tap to Pay = BLOCKED_EXTERNAL (K-13) |
| `customer-display` (23" second screen + Go Check-In kiosk mode, Windows/Android) | mode switch `App.tsx`: device pairing, `Display23` (checkout ticket, tip, signature, ads), `CheckIn23`, `GoCheckIn`, ADVERTISEMENT / MAINTENANCE / OFFLINE | 5 modes | `/customer-display/*` (22), `/go-check-in/*` (18) | — | PASS (dual-screen final report); real 23" hardware test = Kevin |
| `go-check-in-kiosk` | Capacitor wrapper around the display's kiosk build (`www/`) | — | same | — | PASS (wrapper only) |
| `booking-public` | static `index.html` + `public/` (the public booking link is served by the API's `/public/book/*` + customer-web) | 1 | — | — | PASS |

## 3. Every screen's state model (§246)

Each routed screen in the five React apps renders the four states through the shared `@aipowersalon/ui` primitives: loading skeleton, empty state, error with retry (`ApiError` → registry message, `RETRY` codes get the retry button — e.g. the new `CARD_PROCESSOR_UNAVAILABLE`), and refused (`403` → `AccessDenied`, with step-up prompts via `useStepUp()` for money / role mutations). Realtime: screens subscribe through `useRealtime(screens)` and refetch their own snapshot on a frame (REALTIME_INVENTORY.md §2) — no second read path.

## 4. Open (frontend)

| ID | Item |
|---|---|
| B-22 | POS booking "Save Draft" books a real appointment (Kevin decision) |
| B-24 | i18n catalogs: POS / Super Admin English-only; Vietnamese only in display, manager-pay, part of customer app |
| B-25 | zoom lock in 6 `index.html`; no automated a11y pass |
| K-13 | iOS build machine; Play upload keys; real display hardware |
