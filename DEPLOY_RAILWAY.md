> **SUPERSEDED (Jul 30 2026).** Canonical doc: **DEPLOYMENT.md**. This file is preserved history — do not follow it for current commands.

# AIPowerSalon — First Deploy on Railway (Phase 0) — exact click-path

Everything code-side is ready: the API `Dockerfile`, the migration runner (`scripts/migrate.mjs`, runs on start),
the full env template (`.env.production.template`), the frontend build script (`scripts/build-frontends.sh`), and the
platform config (`railway.json`, health check at `/health`). This is the console walk-through for **Railway** — the
recommended platform for a solo founder (bundled Postgres + pooling + replicas, one project, one bill). Render/Fly work
the same way; see the note at the end. (An older AWS App Runner path is in `DEPLOY.md`.)

Time: ~30-45 min the first time. You'll need a card on file with the platform.

---

## Step 1 - Generate your secrets (locally or any terminal)
The env template flags 4 boot-required vars and ~20 secrets. Generate the critical ones now and paste them into a note:

```sh
echo "AUTH_SESSION_SECRET=$(openssl rand -hex 32)"
echo "MFA_ENC_KEY=$(openssl rand -hex 16)"
# Generate these too when you enable the features that use them:
echo "AI_PROVIDER_KEK=$(openssl rand -hex 32)"
echo "PROVIDER_VAULT_KEK=$(openssl rand -hex 32)"
echo "FUNDING_VAULT_KEK=$(openssl rand -hex 32)"
echo "WEBHOOK_SIGNING_KEK=$(openssl rand -hex 32)"
echo "TICKET_DELETION_ENC_KEY=$(openssl rand -hex 32)"
echo "JOBS_SECRET=$(openssl rand -hex 32)"
```
Keep these secret. Never commit them.

## Step 2 - Create the project + database  [you, in Railway]
1. New Project -> Deploy from GitHub repo -> pick the AIPowerSalon repo. Railway reads `railway.json` and builds the
   API from the `Dockerfile`.
2. Same project: New -> Database -> PostgreSQL. Railway provisions it and exposes a `DATABASE_URL`.
3. Open the Postgres service -> enable the pooled connection. That IS your Scaling Phase 1 (PgBouncer), for free, as a
   setting. Use the pooled connection string for the app.

## Step 3 - Set the API's environment variables  [you, in Railway]
On the API service -> Variables. Minimum set to boot + be correct in prod:

| Variable | Value |
|---|---|
| DATABASE_URL | reference the Postgres service's POOLED url |
| AUTH_SESSION_SECRET | from Step 1 |
| MFA_ENC_KEY | from Step 1 |
| NODE_ENV | production |
| REPO_DRIVER | postgres |
| WEB_CORS_ORIGINS | your app origin(s), comma-separated, e.g. https://pos.aipowersalon.com |
| APP_BASE_URL | your canonical app URL |
| PAYMENTS_SANDBOX | 1 for now (flip to 0 only when going live with real payments) |

Paste the rest from `.env.production.template` as you enable features (KEKs, Fiserv creds, Google keys). The template
marks each [REQUIRED] / [SECRET] / [SET-FOR-PROD].

## Step 4 - First deploy runs itself
Railway builds the image, runs the **pre-deploy command** from `railway.json` (`db-preflight.mjs` then `migrate.mjs`,
once per release, in its own container — Phase 11; a failure stops the release) and then starts the API
(`node dist/main.js`). Containers no longer migrate on start unless `MIGRATE_ON_START=1` (single-container hosts only). Watch the logs for `AIPowerSalon API listening on :3000` and a
passing `/health` check.

- Verify: open `https://<your-api>.up.railway.app/health` -> `{"status":"ok",...}`.

## Step 5 - Deploy the frontends  [you]
Pick one:

A) Same-origin (simplest, no CORS): serve the built frontends behind the API. Build with `npm run build:frontends`
   (leaves `VITE_API_BASE` unset -> same-origin), serve each `dist-frontends/<app>` from the API host or a static route.

B) Separate static sites / CDN: for each app add a Railway static site (or a CDN bucket) pointing at
   `dist-frontends/<app>`. Build with `VITE_API_BASE=https://<your-api-domain> npm run build:frontends`, and add each
   app's origin to `WEB_CORS_ORIGINS`. The build script drops a `_redirects` per app so client-side routes don't 404.

- Verify: load the POS app, log in, and confirm a booking/checkout round-trips against real Postgres.

## Step 6 - Domain  [you]
Add your custom domain(s) to the API and/or static services, point DNS as instructed, then update `WEB_CORS_ORIGINS`,
`APP_BASE_URL`, and `PUBLIC_APP_URL` to the final domains.

---

## Deployed. Next is the scaling runbook - but only when symptoms appear.
See `SCALING_TURNON_RUNBOOK.md`. On Railway most of it is toggles:
- Phase 1 PgBouncer -> already done in Step 2 (pooled connection).
- Phase 2 read replica -> add a replica to the Postgres service, set `DATABASE_REPLICA_URL`.
- Phase 3 Redis -> add a Railway Redis, set `REDIS_URL` + `CACHE_STORE=redis` + `RATE_LIMIT_STORE=redis`.
- Phase 4 CDN -> front the static sites with a CDN.
- Phase 5 import worker -> set `CUSTOMER_IMPORT_WORKER_ENABLED=true`.
Don't do any until you see the trigger (connection errors; read-heavy load; rush-hour cache misses; multi-region users;
bulk import).

---

## Using Render or Fly instead
The repo is platform-agnostic (plain Dockerfile + env template + build script); only `railway.json` is Railway-specific.
- Render: create a Web Service from the repo (Docker) + a PostgreSQL instance + Static Sites for each frontend; same env
  vars. Ask me for a `render.yaml`.
- Fly.io: `fly launch` detects the Dockerfile; add Fly Postgres; `fly secrets set` for the vars. Ask me for a `fly.toml`.
The env vars, health check, and frontend build are identical across all three. Render/Fly have no Railway pre-deploy
hook in this repo: use their release command (`sh -c "node scripts/db-preflight.mjs && node scripts/migrate.mjs"`) or
set `MIGRATE_ON_START=1` on a single instance.

---

## Observability on Railway (Constitution 11)

### Turns on by itself — nothing to set
- **Release markers.** Railway injects `RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_DEPLOYMENT_ID` and `RAILWAY_ENVIRONMENT_NAME`.
  Every log line, `/health` and Super Admin → System Operations show the build as `1.0.0+<short commit>`.
- **Readiness-gated releases.** `railway.json` checks `/health/ready` (which verifies the database) before switching
  traffic, so a release that cannot reach Postgres never goes live — the previous deployment keeps serving.
- **Synthetic readiness probe.** With no `SYNTHETIC_BASE_URL` set, the probe uses `https://$RAILWAY_PUBLIC_DOMAIN` —
  the service's own public edge — once a minute. (If you add a custom domain, set `SYNTHETIC_BASE_URL` to it.)
- **Database write probe, health aggregator, alerts, SLOs, retention** — all start with the API.

### Alerts to your phone
- **Email** — works as soon as `SENDGRID_API_KEY` and `SENDGRID_FROM` are set (the POS already uses them): every active
  Super Admin gets SEV1 and SEV2 alerts. Add `ONCALL_EMAIL` for extra addresses (comma-separated).
- **Text messages for SEV1** — set `ONCALL_PHONE` to your mobile in +1 format (e.g. `+18565550142`). Uses the platform's
  existing Twilio settings.
- A SEV1 nobody acknowledges within 15 minutes gets one reminder; you get a "resolved" message when it clears.

### Needs you — once
**Backups** (`backups` shows "never reported" until this is done):
1. Railway → your Postgres service → **Backups**: enable scheduled backups (daily). Check your plan includes them.
2. Railway → the API service → Variables: add `BACKUP_REPORT_TOKEN` = a long random value.
3. Whatever runs or confirms the backup calls `apps/api/scripts/report-backup.mjs` with `BACKUP_REPORT_URL`
   (`https://<api>/internal/backups/report`) and the same token. Railway's built-in backups do not call out on their
   own, so until a job reports, the platform honestly cannot tell whether they ran.
4. Every 90 days, restore a backup into a scratch database, check it, and report
   `--kind restore_drill --integrity true --smoke true`.

### Deliberately off — needs a decision first
**Kiosk synthetic probe** (`SYNTHETIC_KIOSK_SLUG`) — decided against for now. It would need a test salon, and a test
salon would have to be excluded from 82 files that read tenants (counts, revenue, billing, the customer app's nearby
search). The readiness and database-write probes already cover the edge and the write path.


---

## Encryption keys (Constitution 12 — REQUIRED before the next deploy)

**The API now refuses to start in production without these seven variables.** Each is a 64-character hex string
(32 random bytes). Generate each one separately — never reuse a value:

    openssl rand -hex 32

| Variable | Protects |
|---|---|
| `MFA_ENC_KEY` | authenticator-app secrets |
| `PAYMENT_ENC_KEY` | payment-processor credentials (new — rows written before it still decrypt via `MFA_ENC_KEY`) |
| `PROVIDER_VAULT_KEK` | Twilio and email credentials |
| `FUNDING_VAULT_KEK` | merchant bank/funding details |
| `WEBHOOK_SIGNING_KEK` | outbound webhook signing secrets |
| `AI_PROVIDER_KEK` | AI provider API keys |
| `TICKET_DELETION_ENC_KEY` | ticket-removal codes |

**If any of these were already set, keep the SAME value** — changing one makes existing encrypted rows unreadable.
If one was never set, the rows encrypted under the old fallback are readable only by the old fallback: set the new
key, then re-save those credentials (Twilio, email, AI keys, payment config) from their screens so they are
re-encrypted. **To rotate a key later:** copy the old value into `<VARIABLE>_PREVIOUS`, put the new value in the
variable, deploy, re-save the credentials, then remove `_PREVIOUS`.


## Security headers on the web apps (Constitution 12 §251)

The API sets its own headers automatically. Each web app is a static site, so ITS headers must be set where its files
are served. Every app now ships a generated `public/_headers` (copied into `dist/`), the format Netlify, Cloudflare
Pages and Render honour. **Whether Railway static sites honour `_headers` is not verified here** — if they do not, copy
the lines from `apps/<app>/public/_headers` into the service's header settings by hand. The Content-Security-Policy
in each file is derived from what that app actually loads (Google Fonts; one page loads a QR library from cdnjs) and
allows connections to `api.aipowersalon.com` and `*.up.railway.app`. **If the API lives on a different domain, add it
to `connect-src` in `apps/api/scripts/generate-app-headers.mjs` and regenerate** — otherwise the apps cannot reach the API.


## Network (Constitution 12 Phase 9)

- **Use Railway's PRIVATE database and Redis URLs** (`${{Postgres.DATABASE_URL}}` resolves to `*.railway.internal`).
  At boot the API logs a `[security] network posture` error if `DATABASE_URL` points at a public host without
  `sslmode=require`, or a Redis URL at a public host over plain `redis://`.
- **`TRUST_PROXY_HOPS`** defaults to `1` in production — Railway's edge proxy. Leave it. If you ever put another proxy
  or CDN (e.g. Cloudflare) in front of Railway, set it to `2`, or every client will appear to come from that proxy and
  per-IP limits will lump all users together. Never set it higher than the real number of proxies: each extra hop
  lets a client choose its own apparent IP.
- TLS, DDoS absorption and the private network are Railway's; there is no infrastructure code in this repository to harden.


## AI phone line — caller ID (Constitution 12 M12)

The AI receptionist now verifies a caller only when the number they give matches the number the call **comes from**.
- **Retell:** nothing to configure — `call.from_number` is read from Retell's call object automatically.
- **Any other voice platform using the JSON gateway (`/api/ai-receptionist/v1/…`):** configure the platform's tool
  calls to send the header `X-Voice-Caller-Number` filled from the call's own metadata (e.g. `{{call.from_number}}`),
  set server-side in the tool configuration — never a value the AI writes. Without it, every caller is handed to the
  front desk for anything touching an existing appointment.


## Uploaded photos — set this or they disappear (found in Constitution 12 Phase 16)

Technician avatars, portfolios and showcase photos default to the container's own disk, and **Railway replaces that
disk on every deploy — every uploaded photo is lost**. Pick one:
- **S3 or compatible storage (recommended):** `MEDIA_STORE=s3`, `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, and optionally
  `MEDIA_S3_ENDPOINT` (for R2 / Spaces / MinIO) and `MEDIA_CDN_BASE_URL`.
- **A Railway volume:** mount one on the API service and set `MEDIA_ROOT` to its path. Since Phase 11 the image runs as
  the unprivileged `node` user and Railway mounts volumes root-owned: also set `RAILWAY_RUN_UID=0`, or prefer S3.
Phase 11: with `MEDIA_STORE=s3` in production the API **refuses to boot** without `MEDIA_S3_BUCKET` and a region
(`MEDIA_S3_REGION`, else `AWS_REGION` — there is no built-in default region or bucket any more). New uploads go under
`<MEDIA_S3_PREFIX>/<MEDIA_ENV or NODE_ENV>/…`; old rows keep resolving. If old avatars live in a bucket the API no longer
names, set `MEDIA_LIVE_IMAGE_BASE` to that bucket's `…/uploads/images/` URL. Apply `deploy/storage-lifecycle.json` to the
bucket (deploy/terraform/README.md).
Until one is set, the API logs `[security] network posture: MEDIA_STORE: …` at every boot.


## Real-PostgreSQL concurrency tests (Constitution 12 L6/H8) — optional, for a developer machine or the nightly runner

The everyday tests use PGlite, which is one session and cannot race two connections. To run the real-concurrency tests:
```
mkdir -p ~/realpg && cd ~/realpg && npm init -y && npm i embedded-postgres @embedded-postgres/linux-x64 pg
cd <repo>/apps/api && REALPG_MODULES=~/realpg/node_modules npx vitest run src/checkout/refund-race.realpg.vitest.spec.ts
```
(On macOS install `@embedded-postgres/darwin-arm64` or `darwin-x64` instead.) Without `REALPG_MODULES` the file skips
and prints that it skipped — it never claims to have run.
