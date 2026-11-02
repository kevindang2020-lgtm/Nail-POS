> **SUPERSEDED (Jul 30 2026).** Canonical doc: **DEPLOYMENT.md**. This file is preserved history — do not follow it for current commands.

# AIPowerSalon — Deployment (AWS App Runner + RDS PostgreSQL + S3/CloudFront)

This is the pilot deployment path. The backend (NestJS API) runs as a container on **App Runner**, backed by **RDS
PostgreSQL**; the five static PWA frontends (`pos-web`, `admin-web`, `tech-web`, `customer-web`, and any marketing surface)
are built with Vite and served from **S3 + CloudFront**.

> Verified locally: the migration runner applies all 33 migrations to a fresh database and is idempotent on re-run; the
> image's build command (`npm run build --workspace @aipowersalon/api`) and start command (`node dist/main.js`, binding
> `0.0.0.0`) both succeed. The **Docker image build itself was not smoke-tested** in this environment (no Docker daemon
> available) — build it once in CI/locally before the first push.

## 1. Provision RDS PostgreSQL
- Engine PostgreSQL 16, a private subnet, security group allowing the App Runner VPC connector on 5432.
- Create the database `aps`.
- Connection string (note `sslmode`):
  `postgres://USER:PASSWORD@HOST:5432/aps?sslmode=require`
  If the RDS CA chain causes verification errors from the container, use `?sslmode=no-verify` within the trusted VPC, or
  mount the RDS CA bundle. The API pool and the migration runner both read `DATABASE_URL`, so the same string applies.

## 2. Build & push the API image to ECR
```bash
aws ecr create-repository --repository-name aipowersalon-api    # once
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
docker build -t aipowersalon-api .                              # uses the root Dockerfile
docker tag aipowersalon-api:latest <acct>.dkr.ecr.<region>.amazonaws.com/aipowersalon-api:latest
docker push <acct>.dkr.ecr.<region>.amazonaws.com/aipowersalon-api:latest
```

## 3. Create the App Runner service (image-based)
- Source: the ECR image above; **port 3000**.
- **VPC connector** so the service can reach RDS in the private subnet.
- **Environment / secrets**: set every value from `.env.example` (use AWS Secrets Manager for the secret ones —
  `DATABASE_URL`, `AUTH_SESSION_SECRET`, `MFA_ENC_KEY`, `FISERV_*`). **Leave `PAYMENTS_SANDBOX` unset** in production.
- **Health check**: HTTP `GET /health` (recommended) — a public, unauthenticated liveness probe that returns
  `200 {"status":"ok","uptimeSeconds":N,"timestamp":...}`. It is the only public route: it's excluded from the
  tenant-context session middleware for `GET` only (POST/other verbs still return 401), and every other route remains behind
  auth. Configure App Runner's health check as HTTP, path `/health`. (TCP on the service port also works as a fallback.)
- On each deploy the container runs `node scripts/migrate.mjs` (applies pending migrations, idempotent + ledgered via a
  `schema_migrations` table) and then starts the API. Migrations are safe to run on every boot.

## 4. Bootstrap the first super-admin + tenant (one-off)
The production image is pruned to runtime dependencies and does not include `tsx`, so run the seed once from a machine that
has the repo and network access to RDS (or as a short-lived ECS/CodeBuild task using the build image):
```bash
DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/aps?sslmode=require" \
SEED_SUPER_ADMIN_EMAIL=admin@yoursalon.com SEED_SUPER_ADMIN_PASSWORD='...' \
SEED_TENANT_CODE=PALACE SEED_TENANT_NAME="Palace Nails" \
SEED_OWNER_EMAIL=owner@yoursalon.com SEED_OWNER_PASSWORD='...' \
npx tsx apps/api/scripts/seed.ts
```
The seed is idempotent (it upserts the super-admin by email and the tenant by `tenant_code`). The owner signs in with the
tenant code as the salon code.

## 5. Frontends (S3 + CloudFront)
Each web workspace is a static build:
```bash
npm ci
npm run build --workspace @aipowersalon/<pos-web|admin-web|tech-web|customer-web>
# upload the produced dist/ to its S3 bucket, then invalidate CloudFront
```
Point each frontend's API base at the App Runner service URL (behind your domain). Serve them on the appropriate
hostnames/paths and keep the Super Admin surface on its own host.

## 6. Production checklist
- [ ] `AUTH_SESSION_SECRET` and `MFA_ENC_KEY` are long, random, and **stable** (never regenerated between deploys —
      rotating `MFA_ENC_KEY` invalidates stored MFA secrets; rotating the session secret logs everyone out).
- [ ] `PAYMENTS_SANDBOX` is unset (card/split correctly return "not configured" until a real Fiserv MID is wired).
- [ ] `DATABASE_URL` points at RDS with `sslmode` set; the App Runner VPC connector can reach it.
- [ ] First-run seed completed; the owner can sign in with the tenant code.
- [ ] App Runner health check is HTTP `GET /health` (or TCP on the service port); autoscaling configured for the pilot's expected load.

## What is NOT yet wired (honest)
- A real Fiserv/CardPointe client — card processing is sandbox-only today (`sbx_` test transactions).
- Gift-card balances (no gift-card schema yet).
- Twilio/Postmark live credentials for SMS/email (env hooks exist; provider wiring is separate).

## Continuous integration
`.github/workflows/ci.yml` runs on every push/PR: the core harness, a Postgres-service-backed run of all six `e2e-*.mjs` flows (migrate + seed + boot + flows), and a `docker build` of the production image. Use it as the merge gate; the image build runs on the GitHub runner.

## Live card processing (Fiserv/CardPointe)
Set `CARDPOINTE_MERCHID`, `CARDPOINTE_USERNAME`, `CARDPOINTE_PASSWORD`, and either `CARDPOINTE_SITE` or `CARDPOINTE_BASE_URL` (see `.env.example`). When present, `fiservStatus` becomes `connected` and card sales/refunds/voids route through the CardPointe Gateway REST API; the front-end sends a hosted-tokenizer token as `cardToken`. Leave these unset to keep the honest not-configured behavior (or set `PAYMENTS_SANDBOX=1` for simulated `sbx_` test transactions). CI exercises the client against a local CardPointe-shaped mock; the live Fiserv host requires a real MID.
