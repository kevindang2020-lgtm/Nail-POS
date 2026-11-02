# AIPowerSalon — Final Handoff

Date: 2026-06-16. A multi-tenant nail-salon POS platform: NestJS + Kysely + Postgres 16 backend, six React/Vite
front-ends, and five native iOS+Android apps. This document is the entry point; deeper runbooks are referenced inline.

## What this pass did
- Ran the full build + test + typecheck + lint across the whole monorepo. **All builds pass; all tests pass; typecheck
  clean.** (API 451 + core-spec harness 234 + 267 frontend tests.)
- Cleaned lint from **8 errors to 0** (all cosmetic, zero behavior change — see BUG_FIX_REPORT.md). 63 benign
  unused-var warnings remain.
- Confirmed, with a real scan, that there is **no mock/demo data in production paths** and **no hardcoded dev URLs**
  (the API origin is env-driven). Provider Mocks are fallbacks only; the in-memory seed isn't used in production.
- Added a root `tsconfig.json`.
- (Earlier this session) fixed a **critical hardware-financing double-charge** bug + added a regression test; wired the
  marketing site's application form into Super Admin → Tenant Applications (CORS + intake-note capture, tested); and
  finalized the platform split: pos-web + admin-web are **web (Safari)**, the five apps are **native iOS+Android**.

## Architecture / what runs where
- **apps/api** (NestJS) — the single backend. Deploy to AWS (EC2/ECS) on a dedicated/Elastic IP.
- **pos-web** — front-desk POS, opened in **Safari on a Mac**. Static web build.
- **admin-web** — Super Admin, **Safari on an iPad Pro 13in**. Static web build (sized for that device).
- **customer-web / owner-web / tech-web / customer-display / go-check-in-kiosk** — native **iOS + Android** (Capacitor 8,
  SPM on iOS). Built/signed on your machines (App Store + Play Store / ABM + managed Google Play).
- **go-check-in-admin** — small static kiosk-config web page.
- Money is integer cents; tenant scope is derived server-side from the session (never client-supplied).

## Install
```
npm install        # Node 22, npm workspaces
cp .env.example .env   # then fill in DB + provider creds (see .env.example)
```

## Database migrations
```
npm run db:up          # start local Postgres (docker-compose) if needed
npm run db:migrate     # apply all 86 migrations (001..085), tracked via schema_migrations
npm run db:seed        # optional local seed
```
In production, point `DATABASE_URL` at AWS RDS (Postgres 16) and run `npm run db:migrate` against it.

## Run the backend
```
npm run dev:api        # dev (watch)
npm run start:api      # prod (node apps/api/dist/main.js after `npm run build:api`)
```
Required env (see `.env.example`): `DATABASE_URL`, `REPO_DRIVER=postgres`, `AUTH_SESSION_SECRET`, and for live use the
CardPointe / Twilio / SendGrid / FCM keys. `PAYMENTS_SANDBOX=1` exercises payments without a live MID.

## Run a front-end (dev)
```
npm run dev:pos        # POS         (also: dev:admin, dev:customer, dev:tech, dev:owner, dev:display)
```
Set `VITE_API_BASE` (kiosk: `window.APS_API_BASE`) to the API origin. For production builds: `npm run build`
(or per-workspace) → serve each `dist/` statically.

## Run tests / checks
```
npm run typecheck      # clean
npm run lint           # 0 errors
npm test               # API + frontends (or run vitest per workspace)
bash scripts/run-core-specs.sh   # backend *-core.spec.ts harness
```

## Deploy (summary — full detail in DEPLOY.md / INTEGRATION_RUNBOOK.md)
- API → EC2/ECS + **Elastic IP** (= dedicated IP); `api.aipowersalon.com` → that IP; HTTPS via ACM/ALB or nginx.
  The static IP is what CardPointe allowlists.
- DB → RDS Postgres 16; Redis → ElastiCache (if used); secrets → Secrets Manager/SSM.
- Static web apps → S3+CloudFront (or nginx) on `pos.` / `admin.` subdomains; set `VITE_API_BASE` and the API's
  `WEB_CORS_ORIGINS` accordingly.
- Native apps → build/sign on your machines: see `apple-readiness/IOS_SUBMISSION_RUNBOOK.md` and
  `ANDROID_SUBMISSION_RUNBOOK.md`.

## Known remaining blockers
All operational/credential — see **REMAINING_BLOCKERS.md**: AWS deploy + Elastic IP, live Fiserv/CardPointe MID,
Twilio + A2P 10DLC, SendGrid, FCM, Apple Developer + Google Play enrollment, domain/Redis. Plus three product decisions
(billing recalculate-month semantics, split-payment surcharge, tax/surcharge configurability).

## Report index
FULL_CODEBASE_AUDIT.md · BUG_FIX_REPORT.md · BUILD_AND_TEST_REPORT.md · UNFINISHED_FEATURES_REPORT.md ·
FRONTEND_BACKEND_CONNECTION_MAP.md · REMAINING_BLOCKERS.md (+ feature-specific reports already in the tree).
