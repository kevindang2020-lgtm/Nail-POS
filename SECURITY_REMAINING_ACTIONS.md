# SECURITY_REMAINING_ACTIONS.md — incident rotation, networking and approval tasks still open (FullSystemTest.pdf Part 7, §83, Appendix D)

Date 2026-10-28 · code `07e599ea` (`merge-github-main`) · sources: `NEXT_STEPS.md` §2, `docs/mandates/status/SECURITY_DEEP_SCAN_STATUS.md`,
`docs/security/*`, `docs/HOSTING_ACTIONS_FOR_KEVIN.md`, and this run's checks (`SECURITY_AUDIT.md` "Full system test").
Owners: **K** = Kevin (account owner), **KD** = Kevin's developer / operator, **D** = any developer in this repository.
Claude did not rotate, revoke, re-issue or push anything (mandate §3: those need explicit approval).

## A. Incident sequence (K-12) — P0, do in this order

| Step | Action | Owner | Done when | Status |
|---|---|---|---|---|
| 1 | Rebuild the developer machine that held the exposed material (no restore of the old home directory) | KD | new machine, fresh OS | NOT_TESTED / OWNER_ACTION |
| 2 | Rotate **every** credential named in `SECRETS_REQUIRED.md` and every provider key (CardPointe, CommerceHub, Twilio, SendGrid, AI, Google, AWS) — new values only in the host's secret store | KD | each old value refused by its provider | OWNER_ACTION |
| 3 | Revoke the exposed Firebase service-account key; create a new one (`FCM_SERVICE_ACCOUNT_JSON` / `_B64`) | KD | old key shows "deleted" in Google Cloud IAM | OWNER_ACTION |
| 4 | New Google Play upload key (Play Console → App integrity → upload key reset) | K | Play accepts a build signed with the new key | OWNER_ACTION |
| 5 | New database password; close port 5432 to the internet (private networking only) | KD | external scan: 5432 closed; old password refused | OWNER_ACTION |
| 6 | Push the rewritten history (`docs/COMMIT_MAP_K12_REWRITE.md`) — only after 1–5: `git push https://github.com/kevindang2020-lgtm/Nail-POS merge-github-main:main` | KD (approval: K) | remote history has no secret (gitleaks full-history clean) | NOT DONE — Claude did not push |
| 7 | Remove `continue-on-error` from the gitleaks CI job | D (after 6) | a commit with a test secret fails CI | NOT DONE |

## B. Network, hosting and platform settings — before production

| ID | Action | Owner | Verification |
|---|---|---|---|
| S-B2 | Edge WAF / bot / rate rules on `/auth/*`, DDoS protection | K | blocked test request shows the WAF page |
| S-B3 | Railway variables: `NODE_ENV`, `RATE_LIMIT_STORE` + `REDIS_URL`, `LOGIN_THROTTLE_STORE=redis` (any multi-replica deploy — Kevin decided Oct 28 the API will not refuse to boot without it), `WEB_CORS_ORIGINS`, `CLOCK_PIN_LOOKUP_KEY`, `PG_WORKER_POOL_MAX`, `SUPER_ADMIN_NETWORK_POLICY` / `SUPER_ADMIN_IP_ALLOWLIST`, `MOBILE_PAY_DEVICE_KEYS`, `TTP_ATTESTATION_POLICY`, `TWILIO_ACCOUNT_SID`, `PAYMENTS_WEBHOOK_RAW_BODY` | KD | `/health` security posture: no warning |
| S-B4 | DB roles via `apps/api/scripts/db-provision-roles.mjs`; private networking; at-rest encryption | KD | no `DB_ROLE_POSTURE` error |
| **S-RLS (new, this run)** | `DB_TENANT_RLS=1` **and** `DB_TENANT_RLS_STRICT=1` — RLS is inert without the first and permissive for tenant-less sessions without the second (tested: `DATABASE_AUDIT.md` §3) | KD | on staging, a request with no tenant reads 0 rows of `customers` |
| S-B6 | GitHub: branch protection + required checks, secret-scanning push protection, code scanning, `production-image` environment reviewers | K | an unchecked PR cannot merge |
| S-B7 | Static hosting serves `apps/*/public/_headers` (CSP) | KD | `curl -I` shows the CSP |
| S-B8 / S-B9 | Store rebuilds on Capacitor 8.5.3; base-image digest pins in the Dockerfile | K / KD | TestFlight / Play internal builds; digests in `Dockerfile` |
| S-B10 | Answer who owns the S3 bucket `power-salon-bucket` | K | answer recorded in `BUG_REGISTER.md` |
| S-A15 | Before the first deploy with the Super Admin network policy, the DB allowlist holds the operators' addresses (or is empty) | KD | `DEVELOPER_HANDOFF.md` pre-deploy checklist |
| S-A16 | Before the first production deploy with migration 698: trusted-device policy `enforce`; **SendGrid must work** for a new admin device's link (break-glass `SUPER_ADMIN_DEVICE_POLICY=report`) | KD | a new admin device needs the e-mailed link |
| S-B12 | Independent penetration test on staging after S-B2 … S-B7; retest | K | dated report, no open high |
| S-B12b | Restore a production backup into an isolated instance; PITR to a timestamp there (same checks as `tooling/full-system-test/backup-drill.sh`) | K (approval) + KD | RPO / RTO recorded; other tenants untouched |

## C. Internal security work still open (developer)

| ID | Item | Where | Done when |
|---|---|---|---|
| S-A2 | Nest 10 → 11.1.18+, kysely ≥ 0.28.17 (empties `tooling/security/npm-audit-allowlist.json` before 2027-01-31) | root / workspaces | `npm run security:deps` with an empty allowlist; suites + pilot green |
| S-A3 | Dev tooling majors: vitest 4+, vite 6.4.4+ | root | `npm audit` incl. dev: 0 critical / 0 high |
| S-A4 | Settings PATCH routes declare `settings.view`; add an any-of permission to `RolePermissionGuard` | `packages/permissions` | a view-only role gets 403 from the guard |
| S-A5 | Display / kiosk tokens still accepted in the query string (legacy builds) | display / kiosk auth | query forms refused after the displays update |
| S-A7 | Webhook timestamp tolerance once the processor's signing header is known | `modules/payments` webhooks | an old, correctly signed delivery is refused |
| S-A8 | Exact pin of `capacitor-secure-storage-plugin` | mobile shells | exact pin + update procedure |
| S-A11 | admin-web: cancelling the step-up prompt still shows the original error | `apps/admin-web` | cancel → no error toast |
| I-8 | computed `<style>` → CSS variables so `'unsafe-inline'` leaves `style-src-elem` (§89); `@ResourceScope` in the manifest (§38); process-wide egress allowlist (§93); mobile transitive SBOM (§14); per-processor webhook schemas (§110); per-realm credentialed-origin lists | see `docs/mandates/status/SECURITY_DEEP_SCAN_STATUS.md` → INTERNAL | each row DONE with its test |
| IDOR-2 | extend `apps/api/scripts/idor-routes.mjs` to write routes and the customer realm | `apps/api/scripts` | the scan covers POST / PUT / PATCH / DELETE and `realm=customer` |
| V-28-S | Re-run on this commit: `npm run security:fast`, the injection run (`docs/pilot-runs/2026-10-27-final/injection-pass-run3.txt` was 22,250 requests, 0 failing), cross-tenant suites | API | each green on `42f77325`+ |

## D. Fixed in this run (for the record)

| Change | Commit |
|---|---|
| Super Admin "Generate" owner PIN used `Math.random()` (a login credential) → `crypto.getRandomValues` with rejection sampling | `2ca43279` |
| WebAuthn: a ceremony counts as verified only when the library answers exactly `true` (registration and authentication) | `07e599ea` |
