# AIPowerSalon — Handoff to a New Claude Chat

Paste this file first in the new chat, then upload `aipowersalon-full-handoff-package.zip`. It tells the next Claude
everything it needs to continue without re-discovering the project.

---

## Project
**AIPowerSalon** — a multi-tenant POS platform for nail salons (South Jersey / Philadelphia).
Solo founder. The code in the zip is mature and verified, not a prototype.

## Current build status (verified 2026-06-16, on this exact tree)
- `npm run typecheck` → **clean**. `npm run lint` → **0 errors** (63 benign unused-var warnings).
- All apps **build** (tsc + vite). Tests: **API 451**, core-spec harness **234**, pos-web 64, admin-web 60,
  customer-web 89, owner-web 21, tech-web 33 (customer-display builds; no unit tests). No failures.
- Live run confirmed: fresh Postgres → **86 migrations apply** → **seeds create all 5 role accounts** → **API boots,
  `/health` 200**.
- **No known functional bugs.** Remaining items are infra/credentials + 3 product decisions (see end).

## Tech stack
- **Backend**: NestJS 10 + Kysely + **Postgres 16** (`apps/api`). Money as **integer cents**. Migrations are raw SQL
  (no Prisma). Auth = session-based; passwords hashed via `apps/api/src/auth/password.ts`.
- **Front-ends** (React + Vite + TypeScript): `pos-web`, `admin-web` (Super Admin), `customer-web`, `owner-web`,
  `tech-web`, `customer-display`. pos-web/admin-web use react-router; owner-web/tech-web use a state-machine nav.
- **Native apps** (Capacitor 8, **SPM** on iOS — no CocoaPods): customer, owner, tech, customer-display,
  go-check-in-kiosk → iOS + Android.
- **Payments**: Fiserv **CardPointe** (decimal-dollar amounts, PUT verbs, HTTP Basic) behind a gateway; sandbox
  processor for local (`PAYMENTS_SANDBOX=1`). **SMS** Twilio, **email** SendGrid, **push** FCM — each has a Mock
  fallback used only when keys are absent.

## Folder structure
```
aipowersalon-pos/
  apps/
    api/               NestJS backend (373 TS files, 75 controllers); db/migrations/ = 86 SQL files (001..085)
    pos-web/           Front-desk POS — Safari on a Mac            [WEB, port 5173]
    admin-web/         Super Admin — Safari on iPad Pro 13in       [WEB, port 5174]
    tech-web/          Technician app                              [iOS+Android, dev port 5175]
    customer-web/      Customer app                                [iOS+Android, dev port 5176]
    owner-web/         Owner app                                   [iOS+Android, dev port 5177]
    customer-display/  Check-in / customer display                [iOS+Android, dev port 5180]
    go-check-in-kiosk/ iPad check-in kiosk (static + Capacitor)    [iOS+Android]
    go-check-in-admin/ Kiosk config page (static)                  [WEB]
  scripts/             setup-local.sh, run-core-specs.sh, etc.
  package.json (npm workspaces), package-lock.json, tsconfig.json, eslint.config.mjs, Dockerfile, docker-compose.yml
  *.md                 reports + runbooks (audit, connection map, money-path, submission runbooks, this handoff)
```
Deployment posture: pos-web + admin-web are **static web apps in Safari** (no native shell). The other five are
**native iOS+Android**. `apps/api` is the single backend; everything talks to it.

## What is completed
All core modules are built, wired, and tested: Dashboard, Check-In, Booking, Tech Appointments, Live Technician
Schedule, Tech Queue, Queue, Serving, Service Done, Checkout (incl. skip-the-line pay-from-chair, cash-to-tech, card/
Apple Pay/Google Pay sandbox, loyalty-on-payment), Customers, Technicians, Services, Reports, Settings, the full
Super Admin platform (tenants, hardware packages, subscriptions, AI packages, payment gateways, usage limits, website
leads/applications, Go Check-In setup, audit logs), the Customer/Technician/Owner apps, Customer Display, Go Check-In,
and the public-website intake (form → Super Admin → Tenant Applications, with CORS + honeypot + rate limiting).
End-to-end money paths and two-tenant isolation are live-verified. The five native apps are converted (iOS + Android
projects present and synced). A critical hardware-financing **double-charge** bug was found and fixed (idempotent
reconcile + regression test).

## What is still unfinished / known limitations
- **Split-payment surcharge**: when a card surcharge is enabled, a `split` tender doesn't surcharge the card portion
  (documented limitation; the correct fix is a coordinated checkout + customer-display change).
- A few **customer-profile UI sections** are "coming soon" placeholders with no backend (intentional).
- **No functional bugs** beyond the above. The big remaining work is operational, below.

## Known bugs
None open at the code level as of 2026-06-16. (The double-charge bug is fixed + tested.)

## Important business rules
- **Multi-tenant**: each salon is a tenant with its own customers, technicians, services, appointments, tickets,
  payments, reports, settings, and payment gateway. **Tenant data must never mix.**
- **Never trust the frontend for `tenant_id`.** The backend derives tenant + branch **server-side** from the
  authenticated session (`TenantContextMiddleware`), which **sanitizes out** any client-supplied tenantId/branchId.
  48 repositories filter every query by `tenant_id` across 72 tenant-scoped tables. (This is application-level
  isolation — **not** Postgres RLS; there are no CREATE POLICY statements.)
- **Super Admin is separate** from tenant POS — its own login, own dark/gold surface. It controls tenants, hardware
  packages, subscriptions, AI packages, payment gateways, usage limits, website leads/applications, Go Check-In setup,
  and audit logs. Super Admin users have `tenant_id = NULL`.

## Payment rules
- Money is **integer cents** everywhere. Tax + card surcharge resolve from settings (branch override → tenant → safe
  default) via one shared resolver, so POS and customer-display never diverge.
- Live charges use the tenant's Fiserv/CardPointe gateway; `PAYMENTS_SANDBOX=1` simulates without a live MID.
- A paid ticket/invoice can't be re-charged (idempotency enforced — see the hardware-payment service).
- Card tokenization is a marked integration point: the customer app sends a **token**, never a raw PAN (wire
  CardConnect CardSecure hosted fields for production).

## Module workflows (short)
- **POS (front desk, pos-web)**: Check-In → Booking/Queue → Serving → Service Done → Checkout (cash/card/wallet, tip,
  tax/surcharge, receipt) → ticket closed; cash-to-tech and skip-the-line app payments surface in a drawer.
- **Customer app (customer-web)**: discover salon, book, see queue/serving status, **pay from the chair**
  (review bill → method → card or "pay cash to tech" → success), loyalty points, profile.
- **Technician app (tech-web)**: appointments, live schedule, queue, "confirm cash received / customer didn't pay",
  end-of-day cash hand-off + reconciliation.
- **Owner app (owner-web)**: dashboard, branches, booking overview, staff performance, finance & reports, expenses,
  alerts, audit.
- **Customer Display**: token-scoped public screen showing now-serving / queue.
- **Go Check-In**: kiosk self-check-in (kiosk app) + a small admin config page.
- **Public website**: marketing site; the "apply for the free package" form posts to
  `POST /public/website/applications` → Super Admin → Tenant Applications.

## How to install / run / test / build / deploy
See **LOCAL_RUN_GUIDE.md** (exact commands, browser URLs, test accounts) and **BUILD_AND_TEST_REPORT.md**. Quick:
```
npm install
npm run setup:local        # builds API, migrates, seeds LUXE tenant + all 5 test accounts (USE_DOCKER_DB=1 for docker PG)
npm run dev:all            # API + all 6 front-ends
npm run typecheck && npm run lint && npm test
npm run build              # API build; per-app: cd apps/<app> && npm run build
```
**Deploy**: API → AWS EC2/ECS + **Elastic IP** (the static IP CardPointe allowlists), `api.aipowersalon.com` → that IP,
HTTPS via ACM/ALB or nginx; DB → RDS Postgres 16; static hosting (S3+CloudFront/nginx) for pos/admin; native apps built
on your machines via the iOS/Android submission runbooks. Set `VITE_API_BASE` (kiosk: `window.APS_API_BASE`) and the API
`WEB_CORS_ORIGINS` per environment. Full detail in REMAINING_WORK_FOR_NEW_CHAT.md.

## What to ask the next Claude to do
The code is complete; pick from REMAINING_WORK_FOR_NEW_CHAT.md — e.g. write the AWS deploy scripts, wire a live
integration (CardPointe/Twilio/SendGrid/FCM), implement one of the 3 product decisions, or build/sign the native apps.
