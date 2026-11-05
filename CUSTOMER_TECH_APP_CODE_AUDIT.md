# CUSTOMER_TECH_APP_CODE_AUDIT.md

Audit of existing Customer App + Technician App code **before** any new build. Headline: **both apps already exist and
are substantially implemented to this spec** — the backend service files even reference the build-doc section numbers
(e.g. `customer-salons.service.ts` header: "nearby search (build doc §14–§18, §24)"). So this was a *verify/finish*
task, not a from-scratch build. No duplicate apps were created.

## Canonical apps (found)
- **Technician App (frontend):** `apps/tech-web/` — workspace `aipowersalon-tech-web` (React/Vite).
- **Customer App (frontend):** `apps/customer-web/` — workspace `aipowersalon-customer-web` (React/Vite).
- **Backend:** `apps/api/` (NestJS) — workspace `@aipowersalon/api`.
- **Shared types:** backend `apps/api/src/database/kysely.types.ts`; each web app has its own `src/api/*Api.ts` clients.

## Technician App
| Path | What it does | Layer | Real backend? | Mock? | Keep/Merge/Fix | Unfinished |
|---|---|---|---|---|---|---|
| `apps/tech-web/src/screens/` | Login, TechDashboard (Today Home), TechSchedule, TicketsList, TicketDetail, TechEarnings, Queue, Notifications, Settings, More, Profile, FollowUps | frontend | yes (`src/api/techApi.ts`) | no | **Keep** | minor §4 naming differences |
| `apps/api/src/tech/tech.controller.ts` | Tech HTTP surface: today/schedule/tickets, accept, start-service, service-done, **edit-options, service-lines (POST/PATCH/DELETE), change-requests (POST/GET)**, add-addon, notes, request-cancel, earnings, skills, status/breaks, queue, more | backend | yes | no | **Keep** | — |
| `apps/api/src/tech/tech.service.ts` | Tech logic; live-ticket edits enforce technician identity + `tech.ticket.edit_lines` + **ticket ownership** then delegate to the shared serving bridge (`techAddService`/`techChangeService`/`techRemoveLine`) which recalculates + emits realtime; audit-logged | backend | yes | no | **Keep** | — |
| `apps/api/src/serving/serving.controller.ts` | POS serving add-service + **change-request decision (manager approval)** — the same recalc the tech edit reuses | backend | yes | no | **Keep** | — |
| `apps/api/src/tech/*.vitest.spec.ts` | Dashboard/earnings core, permissions (platform-flag block), realtime isolation | backend test | n/a | no | **Keep** | no explicit add-line recalc test (see blockers) |

## Customer App
| Path | What it does | Layer | Real backend? | Mock? | Keep/Merge/Fix | Unfinished |
|---|---|---|---|---|---|---|
| `apps/customer-web/src/screens/` | Login, Register, Home, Appointments, CheckIn, Visit (service progress), Reschedule, Wallet (receipts/payment methods), Deals, Addresses, Profile/Privacy, NailShowcase (social), FollowUps | frontend | yes (`src/api/customerApi.ts`) | no | **Keep** | a dedicated map/list "Find Salons" screen is thin (see blockers) |
| `apps/api/src/customer-salons/customer-salons.service.ts` | **§14–18 partner directory + nearby search**: partners first, optional Google merge, distance, honest "not configured" message | backend | yes | no | **Keep** | — |
| `apps/api/src/customer-salons/google-places.provider.ts` | **§16/§23 server-side Google Places** — key from env, never in frontend | backend | yes (gated) | no | **Keep** | needs a live key (Kevin) |
| `apps/api/src/customer-salons/customer-salons.controller.ts` | `GET customer/salons/nearby`, `:salonId`, `:salonId/services`, `availability`, reschedule | backend | yes | no | **Keep** | — |
| `apps/api/src/customer-salons/customer-favorites.controller.ts` | favorite salons (POST/DELETE `:salonId`) | backend | yes | no | **Keep** | — |
| `apps/api/src/customer-booking/*` | customer booking (book/reschedule), availability | backend | yes | no | **Keep** | — |

## Rules followed
No duplicate apps created. Existing screens/routes/APIs preserved. Verified builds + tests rather than rewriting. The
two spec-critical features (tech live-ticket edit; customer nearby search) were found already implemented and verified.
