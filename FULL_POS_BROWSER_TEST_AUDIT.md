# Full POS Browser-Test Audit — AIPowerSalon

Scope: the whole `aipowersalon-pos` monorepo, assessed for local browser testing. This reflects a live build + run
(API + Vite dev + real-browser login), not assumptions. Headline: **no duplicate apps, no broken wiring, everything
builds, and the dev stack logs in and serves authenticated data in a real browser.**

## Apps

| Folder | What it does | Layer | Works now | Mock data? | Connected to backend | Action |
|---|---|---|---|---|---|---|
| `apps/api` | NestJS + Kysely + Postgres backend — 59 controllers, 75 migrations, RLS multi-tenancy, CardPointe payments, SSE realtime | backend | ✅ builds, boots on `:3000`, 326 tests pass | No (real DB) | — | keep |
| `apps/pos-web` | iPad/desktop POS Front Desk (React + Vite, react-router) — 22 screens | frontend | ✅ builds; real-browser login + authed data verified | No (seeded DB) | Yes (proxy → `:3000`) | keep |
| `apps/admin-web` | Super Admin console — 20 screens | frontend | ✅ builds | No | Yes | keep |
| `apps/customer-web` | Customer app | frontend | ✅ builds | No | Yes | keep |
| `apps/tech-web` | Technician app (state-machine nav) | frontend | ✅ builds | No | Yes | keep |
| `apps/owner-web` | Owner app (state-machine nav) | frontend | ✅ builds | No | Yes | keep |
| `apps/customer-display` | Customer-facing checkout display | frontend | ✅ builds | No | Yes | keep |

Config: npm workspaces, shared `tsconfig`, `eslint.config.mjs`, `Dockerfile`, `docker-compose.yml`. Each app has its
own `vite.config.ts` (dev port + API proxy) and `package.json`. No missing config files.

## POS modules (pos-web) — every sidebar item

| Module | Screen | Route opens | Data loads | Backend | Status |
|---|---|---|---|---|---|
| Overview | `POSOverviewScreen` | ✅ | ✅ live KPIs | `/pos/overview/state?shape=summary` | connected (fixed this session) |
| Dashboard | `POSDashboardScreen` | ✅ | ✅ | `/pos/dashboard/state` | connected |
| Check-In | `POSCheckInScreen` | ✅ | ✅ | `/pos/check-in/*` | connected |
| Booking | `POSBookingScreen` | ✅ | ✅ | `/pos/booking/*` | connected |
| Tech Appointments | `POSTechAppointmentsScreen` | ✅ | ✅ | `/pos/tech-appointments/*` | connected |
| Live Technician Schedule | `POSLiveTechnicianScheduleScreen` | ✅ | ✅ | `/pos/live-technician-schedule/*` | connected |
| Tech Queue | `POSTechQueueScreen` | ✅ | ✅ | `/pos/tech-queue/*` | connected |
| Queue | `POSQueueScreen` | ✅ | ✅ | `/pos/queue/*` | connected |
| Serving | `POSServingScreen` | ✅ | ✅ | `/pos/serving/*` | connected |
| Service Done | `POSServiceDoneScreen` | ✅ | ✅ | `/pos/service-done/*` | connected |
| Checkout | `POSCheckoutScreen` | ✅ | ✅ | `/pos/checkout/*` | connected (split surcharge added this session) |
| Customers | `POSCustomersScreen` | ✅ | ✅ | `/pos/customers/*` | connected |
| Technicians | `POSTechniciansScreen` | ✅ | ✅ | `/pos/technicians/*` | connected |
| Services | `POSServicesScreen` | ✅ | ✅ | `/pos/services/*` | connected |
| Reports | `POSReportsScreen` | ✅ | ✅ | `/pos/reports/*` | connected |
| Settings | `POSSettingsScreen` | ✅ | ✅ | `/pos/settings/*` | connected |
| (+ Follow-ups, Skill Requests, NailShowcase Moderation) | — | ✅ | ✅ | `/pos/*` | connected |

## Database

PostgreSQL 16, 75 idempotent migrations (`001`→`074_*`), tracked via `schema_migrations`, RLS with 112 tenant-isolation
policies (behaviour-verified fail-closed). Seed path: `seed.ts` (super-admin + tenant + owner) → `seed-demo.ts` (services,
technicians, customers, appointments, queue, tickets) → `seed-local-accounts.ts` (front-desk / technician / customer
logins, linked). All run by `npm run setup:local`.

## Findings this pass

- **Overview screen contract bug** — `/pos/overview/state` returned the raw aggregate; the screen needs the flat
  `?shape=summary` projection. Fixed; the real-browser click-through now passes with 0 JS errors.
- **Port collision** — owner-web and customer-web both claimed `:5176`; owner-web moved to `:5177`.
- **API/proxy port** — API defaults to `:3001` but the Vite proxies target `:3000`; the dev stack pins the API to
  `:3000` so the proxy resolves.
- **Test accounts** — added the front-desk login (none existed) plus the documented technician/customer logins, with
  technician↔record and customer↔record links so tech-web / customer-web resolve them.
- **owner-web login bug** — the Owner login form collected only email + password (no salon code), so login failed with `TENANT_NOT_FOUND`. Fixed: added a salon-code field + tenant-portal login. Owner now signs in and the dashboard loads (verified in-browser, 0 JS errors).
- No duplicate apps, no orphaned frontend calls, no dead routes found.

## Verdict

Healthy and browser-testable. Run `npm run setup:local` then `npm run dev:all`, open the URLs in
LOCAL_BROWSER_TESTING_GUIDE.md, and sign in with the seeded accounts.
