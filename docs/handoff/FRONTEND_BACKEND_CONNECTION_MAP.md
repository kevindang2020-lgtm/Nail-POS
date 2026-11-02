# FRONTEND_BACKEND_CONNECTION_MAP.md

How the React/Vite frontends talk to the NestJS API in this merged monorepo. This is **one full-stack repo** — there is no separate "frontend repo" and "backend repo." Each frontend app ships a set of typed API-client modules under `apps/<app>/src/api/` that call the NestJS controllers under `apps/api/src/<domain>/`.

## Transport & contract conventions (verified in source)
- **Base client:** each app has `src/api/http-core.ts` + `client.ts`. Requests carry the session credential; the API derives tenant/branch **server-side** — the browser never supplies a trusted tenant id.
- **Route shape:** POS controllers are mounted at `pos/<domain>` (e.g. `@Controller('pos/queue')`). Super-Admin/owner/customer surfaces have their own prefixes (`super-admin/*`, `owner/*`, `customer/*`).
- **AuthZ:** every handler is annotated `@RequirePermission('<scope>.<area>.<action>')` (e.g. `pos.checkout.view`, `pos.queue.create`). Hiding a button is never the security boundary; the API re-checks.
- **Context:** handlers resolve identity with `ctxFrom(r)` (session → tenant + branch + user + role) and filters with `filtersFrom(q)`. Queries are tenant/branch-scoped via Kysely `scoped()`.
- **Money:** integer cents end-to-end.
- **Counts:** the API exposes **103 controllers**; pos-web ships **40** api-client modules, admin-web **13**. This document maps the core salon workflow in full and summarizes the rest by domain.

## Core salon workflow (Booking/Walk-In → … → Payment → Reports)
Each row: frontend client → HTTP → controller route → permission.

| Step | Frontend client (pos-web) | Representative call | Controller route | Permission |
|---|---|---|---|---|
| Check-In | `posCheckInApi.ts` | `GET state / kpis / recent`, `GET appointments-ready`, `GET customers/search`, `GET wait-estimate` | `pos/check-in` | `pos.check_in.view` (search uses `pos.customers.view`) |
| Customer Queue | `posQueueApi.ts` | `GET state/kpis/items`, `POST items` (enqueue), `GET items/:id`, `PATCH items/:id` | `pos/queue` | `pos.queue.view` / `pos.queue.create` / `pos.queue.edit` |
| Tech Queue / Assignment | `posTechQueueApi.ts`, `posTeamApi.ts` | assign technician, DnD reorder, requested-technician | `pos/tech-queue`, `pos/pos-team` | `pos.tech_queue.*` |
| Serving | `posServingApi.ts` | `GET state/kpis/tickets/services/technicians`, `GET change-requests/pending`, `POST change-requests/:id/decision` | `pos/serving` | `pos.serving.view` / `pos.serving.edit_services` |
| Service Done | `posServiceDoneApi.ts` | `GET state/kpis/tickets`, `GET tickets/:id`, `POST tickets/:id/quality-check`, `POST tickets/:id/update-notes` | `pos/service-done` | `pos.service_done.view` / `.quality_check` / `.update_notes` |
| Checkout | `posCheckoutApi.ts` | `GET state/kpis/settings/tickets`, `GET tickets/:id`, `POST tickets/:id/review`, `POST tickets/:id/rating` | `pos/checkout` | `pos.checkout.view` |
| Payment | `posCheckoutApi.ts` → gateway | tender/capture via the POS payment gateway controller | `checkout/pos-payment-gateway` | checkout permissions; idempotent capture |
| Receipt / Loyalty | `posCheckoutApi.ts`, follow-ups | post-payment receipt + loyalty (only after successful capture) | `checkout/*`, `end-of-day-followups/*` | scoped per area |
| Reports / Overview | `posReportsApi.ts`, `posOverviewApi.ts`, `posDashboardApi.ts` | KPIs and rollups (read-only) | `pos/overview`, `dashboard`, reports | `pos.overview.view` etc. |

**Payment safety (verified intent):** payments are **Fiserv CardPointe/Bolt + Clover only**. Capture is idempotent (claim-first), tips validated on all pay paths, surcharge stored as canonical `surcharge_cents`, refunds guarded against over-refund with an advisory-lock pattern. Webhook signatures validated; webhooks idempotent. No fake "success" responses.

## Domain summary (remaining surfaces)
- **Auth / session:** `authApi.ts` → `auth/*` (`auth`, `account`, `mfa`, `password-reset`, `system-reset`). Login, logout, session restore, MFA, reset.
- **Customers:** `posCustomersApi.ts` → `customers/*`, `customer/*` (incl. realtime). Owner/customer apps add `customer-salons`, `customer-favorites`, `customer-booking`, `customer-registration`, `customer-payments`.
- **Team / payroll / inventory:** `posTeamApi.ts`/`posTechniciansApi.ts`/`posPayrollApi.ts`/`inventoryApi.ts` → `pos-team`, `payroll`, `inventory`, `technician-inventory`, `live-technician-schedule`.
- **Communications / notifications / push:** `posCommunicationsApi.ts`/`posNotificationsApi.ts` → `communications`, `notifications`, `push` (Twilio/SendGrid/FCM integrations, signatures validated server-side).
- **AI Center:** `posAiApi.ts` → `ai/*` (assistant + subscription billing). All AI access is **backend-gateway only** — no provider secret in the browser; tenant/usage enforced server-side.
- **Booking / check-in kiosk:** `posBookingApi.ts` → `booking`, `customer-booking`; kiosk → `go-check-in/*` (public + admin).
- **Cash / drawer / handoff:** `posCashDrawerApi.ts`/`posCashHandoffApi.ts` → `cash-drawer`.
- **Customer display:** `customer-display/*` (admin + device).
- **Super Admin (admin-web):** `superAdminApi.ts` + `superAdminDashboardApi.ts`/`superAdminOverviewApi.ts`/`superAdminAiApi.ts`/`superAdminCommunicationsApi.ts`/`superAdminCampaignsApi.ts`/`superAdminNailShowcaseApi.ts`/`superAdminHardwarePackagesApi.ts`/`superAdminWebsiteLeadsApi.ts`/`checkInDevicesApi.ts` → `super-admin-platform` module + `dashboard`, `overview`, `hardware-payment` (super-admin), `nail-showcase` (super-admin). All oversight aggregates are **read-only platform-wide**; mutations are session-gated and audited.

## Validation note
Matching route names alone do **not** prove a connection. For each surface, the request body, response shape, permission, tenant/branch scope, error path, and DB effect must agree. In this merge the contract was held constant per side (path-ownership union), and the union compiles clean (`tsc` 0 across API + 7 apps) with 1,189 vitest + 57 harness suites green — see `MERGE_TEST_REPORT.md`. The one thing typecheck/mocks cannot prove is live transactional behavior against Postgres; that smoke remains (see `KNOWN_ISSUES.md`).

---

## Devices & Integrations (added 2026-06-26)

| Frontend (pos-web) | Action | API client | Backend route | Service | Auth / Permission | Tenant scope |
|---|---|---|---|---|---|---|
| POSDevicesScreen | load overview | posDevicesApi.overview | GET /pos/devices/overview | DevicesService.getOverview | TenantAuthGuard + settings.view | server-derived tenant+branch |
| POSDevicesScreen | test/revoke device | posDevicesApi.testDevice/revokeDevice | pos/settings/customer-display-devices/* | SettingsService (assertEdit) | settings edit | server-derived |
| POSDevicesScreen | pair/test/unpair terminal | posDevicesApi.*Terminal | pos/settings/payments-checkout/terminals/* | SettingsService (assertEdit) | settings edit | server-derived |
| TenantApiWebhooksScreen | list/create/rotate/revoke key | posApiKeysApi.* | /pos/api-keys, :id/rotate, :id/revoke | ApiWebhooksService | api_keys.view/manage; OWNER to mint | server-derived |
| TenantApiWebhooksScreen | list/create/pause/resume/disable/rotate-secret/test webhook | posWebhooksApi.* | /pos/webhooks/* | ApiWebhooksService | webhooks.view/manage | server-derived |
| (dispatcher) | list deliveries / process due | posWebhooksApi.deliveries/process | GET /pos/webhooks/:id/deliveries, POST /pos/webhooks/process | WebhookDispatchService | webhooks.view/manage | server-derived |
| Deployment control (in POSDevicesScreen) | state / advance | posDeploymentsApi.* | GET/POST /pos/deployments* | DeploymentsService | settings | server-derived |
| TenantLogsScreen | list logs | posLogsApi.list | GET /pos/logs | LogsService.query | logs.view | server-derived tenant+branch |

Producer wiring (server→server, no HTTP): webhook deliveries + key/webhook lifecycle emit integration
logs; deployment terminal transitions emit device logs AND dispatch webhook events into the delivery ledger.
