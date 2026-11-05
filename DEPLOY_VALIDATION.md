# Deploy Validation — results

Validated the automated parts of `DEPLOY_RUNBOOK.md` that don't need your AWS account/credentials. One real deploy-blocker
was found and fixed; everything else checks out.

## ✗→✓ FIXED: the Terraform did not parse (would have blocked `terraform apply`, runbook step 1)
Every multi-argument block in `deploy/terraform/*.tf` was written on a single line, e.g.
`variable "region" { type = string  default = "us-east-1" }` and
`resource "aws_vpc" "main" { cidr_block = "10.20.0.0/16"  enable_dns_hostnames = true  tags = {...} }`.
That is invalid HCL2 — a single-line block may contain only one argument — so `terraform init`/`validate`/`apply` failed
immediately with "Invalid single-argument block definition" across `variables.tf`, `outputs.tf`, and ~15 blocks in `main.tf`
(incl. the `aws_ami` filters, security-group ingress/egress, and the CloudFront `forwarded_values`/`restrictions`).

Fix: rewrote all three files into valid, canonical HCL (one argument per line) — **every resource, argument, and value
preserved exactly**; this is a pure syntax correction, no infrastructure change. The outputs (`api_elastic_ip`,
`rds_endpoint`, `pos_cloudfront_url`, `admin_cloudfront_url`) and required vars (`ssh_admin_cidr`, `key_name`, `db_password`)
are unchanged and still match the runbook.

Now passes (terraform 1.9.8):
- `terraform fmt -check -recursive` → clean (canonical formatting)
- `terraform init -backend=false` → succeeds (AWS provider ~> 5.0)
- `terraform validate` → **"Success! The configuration is valid."**

(Still requires your AWS account to `plan`/`apply`; this only proves the config is well-formed.)

## ✓ Preflight gate (runbook step 3) — works
`node apps/api/scripts/preflight.mjs` correctly gates a deploy:
- dev (NODE_ENV unset) → passes, reports vars as unset (no hard fail).
- production with no vars → **exit 1**, lists `DATABASE_URL` / `AUTH_SESSION_SECRET` / `MFA_ENC_KEY` / `REPO_DRIVER` as
  MISSING and prints "PREFLIGHT FAILED" — so a misconfigured container refuses to start.
- production with those set + `REPO_DRIVER=postgres` → passes, and reports each integration as LIVE vs MOCK/SANDBOX.

## ✓ Dockerfile + image deps
Multi-stage build of `@aipowersalon/api`; runtime sets `NODE_ENV=production PORT=3000 REPO_DRIVER=postgres`; `CMD` runs
`migrate.mjs` then `dist/main.js` (migrations-on-start, as the runbook states). Confirmed present: `.dockerignore` (excludes
node_modules/dist/.git/*.zip → lean context), `apps/api/scripts/migrate.mjs`, and `apps/api/db/migrations` (96 files).
(Image not built here — no Docker in the sandbox — but the build inputs are all in place.)

## ✓ Web build (runbook step 4)
`VITE_API_BASE=https://api.aipowersalon.com npm run build` in `apps/pos-web` succeeds (tsc --noEmit + vite build, dist ~460K)
and the API base URL is baked into the bundle.

## ✓ .env.production.example
Includes every variable preflight hard-requires (`DATABASE_URL`, `AUTH_SESSION_SECRET`, `MFA_ENC_KEY`, `REPO_DRIVER`), CORS
origins, the Fiserv/Twilio/SendGrid/FCM integration vars (commented, LIVE-on-set), and the Redis vars for multi-node.

### Minor, non-blocking notes
- The template defaults `REALTIME_BUS`/`LOGIN_THROTTLE_STORE` to `redis` (so it expects a Redis even for a single node). For
  a single-node launch you can set both to `inprocess`/`memory` and drop `REDIS_URL`; switch to `redis` when you scale to 2+.
- The template's header comment lists 3 hard-required vars but preflight enforces 4 (it also requires `MFA_ENC_KEY`, which the
  template does include) — just a doc wording nit.

## What still needs you (unchanged from the runbook)
AWS account + `terraform apply`, DNS records, ECR push + EC2 run, TLS (certbot), and live-integration credentials
(Fiserv MID, Twilio A2P, SendGrid, FCM), plus native app signing. Everything the repo automates is now validated.
