# SECURITY_INCIDENT_RUNBOOK.md — containment, revocation and recovery (mandate §159–§160)

This is the incident procedure required by the Oct 23 2026 Security Deep Scan mandate. It builds on — and does not replace —
[SECURITY_RUNBOOKS.md](../../SECURITY_RUNBOOKS.md) (13 scenario runbooks whose every route is checked by
`security-runbooks.vitest.spec.ts`) and [SECURITY_DR.md](../../SECURITY_DR.md) (backup and restore). Every route below exists in
`apps/api/openapi/manifest.txt` (checked when this file was written); every Railway / console step is marked **(Kevin)** because
nothing in code can do it.

Hosting reality: Railway (API service, worker service, Postgres, optional Redis), static app hosting, GitHub. There is **no AWS
account** in this stack — where the mandate says "AWS credential leak" read "Railway / object-storage / provider credential leak".

## The flow — every incident, in this order (§160)

| Step | What it means here | Tools |
|---|---|---|
| 1. DETECT | A security event, an alert, a report from a salon, a failed gate. | Security Center incident log `/super-admin/security/incidents`; security events (SECURITY_EVENT_TYPES — e.g. LOGIN_FAILED_BURST, CROSS_TENANT_ACCESS_ATTEMPT, WEBHOOK_SIGNATURE_FAILED, MFA_REPLACE_REFUSED, PRIVILEGE_ESCALATION_ATTEMPT, SESSIONS_REVOKED_ALL); auth events and refusal codes in the logs (AUTH_ATTEMPTS_LOCKED, REFRESH_REUSE_DETECTED, CSRF_REJECTED, STEP_UP_FAILED); Railway logs **(Kevin)**. Open an incident record first — status `detected`. |
| 2. CONTAIN | Stop the bleeding without destroying evidence. | Session revocation `/super-admin/security/sessions/revoke` (scope user / tenant); emergency lockdowns `/super-admin/security/lockdowns` (account / tenant / platform: propose → confirm → execute → lift — step-up required); kill switches `/super-admin/kill-switches/{key}` (e.g. `payments.cardpointe_disabled`, `payments.tap_to_pay_disabled`, `ai.auto_actions_disabled`); gateway pause `/super-admin/tenants/{id}/payment-gateway/pause`; IP block `/super-admin/security/ip-blocks`. |
| 3. REVOKE | Make every credential the attacker may hold useless. | Platform account: `/super-admin/platform-staff/{userId}/revoke-sessions`, `/super-admin/platform-staff/{userId}/reset-mfa`; salon API key `/pos/api-keys/{id}/rotate`; salon webhook secret `/pos/webhooks/{id}/rotate-secret`; payment webhook secret `/super-admin/tenants/{id}/payment-gateway/webhooks/rotate-secret`; integration credential `/super-admin/integrations/connections/{id}/credentials/rotate`. A refresh token reused after rotation already burns its whole session (C13 raises the alert). |
| 4. PRESERVE EVIDENCE | Before cleanup. | Audit log and security events are append-only. Export the incident window (audit feed, `login_attempts`, sessions, `payment_gateway_events`, security events). Snapshot the database **(Kevin — Railway backup now, kept outside the normal retention)**. Legal hold for disputed customer data (`customer-data-oversight/legal-holds`). Never edit or delete rows during an investigation. |
| 5. ERADICATE | Remove the cause. | Fix and deploy the code path (with a regression test); remove malicious code / dependency; close the network path. |
| 6. ROTATE | Every secret the incident could have touched — see the matrix below. | Railway variables **(Kevin)**; provider consoles **(Kevin)**. |
| 7. RECOVER | Restore service and data. | Lift lockdowns / kill switches in reverse order; restore data from the audit trail or a backup (SECURITY_DR.md, restore drill steps in docs/DR_DRILLS_2026-10-08.md). |
| 8. VERIFY | Prove the attacker is out and the fix holds. | No unexpected sessions / privileged grants; the regression test fails on the old code and passes on the new; `npm run ci:gates`; pilot smoke (`apps/api/scripts/live-pilot-day.mjs`) on staging. |
| 9. POSTMORTEM | Blameless, written, within a week. | Timeline, root cause, why each layer did or did not stop it, the new test / gate, notification decisions (counsel decides deadlines — this runbook never promises one). Incident record → `closed` with the reason. |

## Secret rotation matrix (step 6)

Names are environment-variable NAMES only — values never go into chat, tickets or docs.

| Secret | Effect of rotating | How |
|---|---|---|
| `AUTH_SESSION_SECRET` | signs **everyone** out (all access tokens invalid) | Railway variable on API + worker **(Kevin)**, redeploy. `CLOCK_PIN_LOOKUP_KEY` derives from it when unset — set it explicitly first or PIN lookup keys change. |
| `SERVICE_TOKEN_SECRET` | scheduler / internal callers re-mint tokens | Railway variable on API + worker **(Kevin)**. |
| `DATABASE_URL` password | API and worker reconnect | Change the role password in Postgres, then the variables **(Kevin)**. Use least-privilege roles aps_api / aps_worker (`apps/api/scripts/db-provision-roles.mjs`). |
| Provider master keys (`MFA_SECRETS` / provider-secret sealing keys) | sealed columns must be re-encrypted | Follow SECURITY_SECRETS.md (key versions; never drop the old key before re-encryption completes). |
| Twilio account token / API key | SMS and voice stop until updated | Twilio console **(Kevin)** → `TWILIO_*` variables; per-salon self-configured credentials: `/super-admin/tenants/{tenantId}/messaging-credentials`. |
| SendGrid key | email stops until updated | SendGrid console **(Kevin)**. |
| CardPointe / Fiserv / Clover merchant credentials | that salon cannot take cards until updated | Processor portal **(Kevin + the salon)** → Super Admin payment gateway config (step-up). |
| Firebase / FCM service account, APNs key | push stops until updated | Google Cloud / Apple **(Kevin)** → `FCM_SERVICE_ACCOUNT_JSON`, APNs variables. |
| AI provider keys | AI features stop until updated | Provider console **(Kevin)**. |
| GitHub tokens, Railway tokens, npm tokens | CI / deploy stop until updated | GitHub / Railway / npm settings **(Kevin)**. |
| Android upload keystore / iOS signing | store updates blocked until reset | Play App Signing upload-key reset; Apple certificates **(Kevin)**. |

## Scenarios the mandate requires

### S1. Stolen Super Admin account (SEV1)
1. DETECT — unexpected platform actions in the audit feed; an AUTH_ATTEMPTS_LOCKED refusal on a platform account; an MFA_REPLACE_REFUSED security event; a new platform invitation nobody sent.
2. CONTAIN — from a second Super Admin: `/super-admin/platform-staff/{userId}/revoke-sessions`; if the compromised account is unknown, a *platform* lockdown (Super Admins keep access).
3. REVOKE — `/super-admin/platform-staff/{userId}/reset-mfa` (recovery is a single-use token + password); disable the account; revoke privileged-access grants; review pending invitations and cancel unknown ones.
4. PRESERVE — audit feed for the whole session lifetime (support sessions, exports, merchant / gateway changes, role changes).
5–6. ERADICATE / ROTATE — if any access token could have been copied, rotate `AUTH_SESSION_SECRET` **(Kevin)**; rotate any provider credential viewed or changed in the window.
7–9. RECOVER / VERIFY / POSTMORTEM — revert changes from the audit trail; confirm no unexpected platform sessions, grants or accounts.
Layers that should have stopped it: mandatory TOTP (no SMS fallback when a factor exists — C8), step-up on every critical action (C7), attempt budget (C4), credentials never returned to an admin (C2), platform accounts only by invitation with rank checks (C3).

### S2. Database credential leak (SEV1)
1. DETECT — a credential found in a commit, a log, a laptop; unexpected connections in Postgres (`pg_stat_activity`) **(Kevin)**.
2. CONTAIN — confirm the database is not reachable from the internet (Railway private networking; the old external host's port 5432 closed) **(Kevin)**.
3. REVOKE / ROTATE — change the role password; update `DATABASE_URL`, `PG_WORKER_DATABASE_URL`, `MIGRATE_DATABASE_URL`; move the API to aps_api and the worker to aps_worker (the boot posture check logs a superuser / BYPASSRLS login as a security error — D9).
4. PRESERVE — Postgres logs and a snapshot before anything else **(Kevin)**.
5. ERADICATE — remove the credential from wherever it leaked; if it is in git history, it stays compromised until the history rewrite (K-12 order).
8. VERIFY — `tooling/security/check-db-credentials.py` clean; gitleaks history scan clean after the rewrite.
Known instance: the outside developer's commit f48ef5f3 carries an external database login — rotation and port closure are step 5 of the K-12 sequence.

### S3. Cloud / object-storage / provider credential leak ("AWS" in the mandate)
Same flow as S2 with the rotation matrix row for that provider. For object storage: rotate the S3 / R2 key, confirm it is bucket-scoped (Put / Get / Delete on the media bucket only) **(Kevin)**, review bucket access logs. Signed URLs already issued expire within 1 hour (presigned PUT 10 minutes).

### S4. Twilio credential leak or SMS pumping
1. DETECT — SMS volume / cost spike, unknown destinations, WEBHOOK_SIGNATURE_FAILED on `/webhooks/twilio/*`.
2. CONTAIN — Twilio geo permissions / disable messaging **(Kevin)**; per-salon messaging credentials `/super-admin/tenants/{tenantId}/messaging-credentials`.
3. REVOKE — rotate the account token / API key **(Kevin)**.
Layers: inbound webhooks verify with the token of the tenant that owns the number (E2); a tenant cannot claim another tenant's number (E1, DB trigger migration 684).

### S5. Merchant / payment credential leak (SEV1)
1. CONTAIN — `/super-admin/tenants/{id}/payment-gateway/pause` for the affected salon(s); kill switch `payments.cardpointe_disabled` / `payments.clover_disabled` if platform-wide.
2. REVOKE — rotate the merchant credentials at the processor **(Kevin + salon)**; rotate the payment webhook secret `/super-admin/tenants/{id}/payment-gateway/webhooks/rotate-secret`.
3. VERIFY — processor base URLs only on the allowlisted hosts (`PROCESSOR_URL_POLICIES` — D2); no card data in our database (`card-data.pgtest`, raw-PAN refusal).
No raw card data is stored by design, so a credential leak is not a cardholder-data breach by itself — counsel decides notification.

### S6. Malicious dependency (supply chain)
1. DETECT — `npm run security:deps` or the dependency-review job fails; an advisory; `check:supply-chain-injection` / hidden-code gate fails; unexpected outbound traffic.
2. CONTAIN — stop deploys (do not merge); if already deployed, roll Railway back to the previous image **(Kevin)**.
3. ERADICATE — pin / override to a safe version or remove the package; regenerate the lockfile; every lock entry must resolve from registry.npmjs.org with integrity.
4. ROTATE — every secret the compromised build could read (API + worker variables) **(Kevin)**.
5. VERIFY — gates green; SBOM regenerated (`npm sbom --sbom-format cyclonedx --omit dev --package-lock-only`); Trivy image scan clean.

### S7. Developer machine malware (has happened: Sep / Oct 2026 upload)
1. DETECT — hidden-code gate, obfuscated files, root scripts that run `node api.js`, keystores or service-account files in a zip.
2. CONTAIN — never run, build or open the upload in an editor with auto-run tooling; scan statically only; developer work arrives as pull requests through the gates, never as a zip.
3. REVOKE / ROTATE — everything the machine held (GitHub, npm, Railway, Postgres, Twilio, SendGrid, Fiserv / CardPointe, Firebase, Apple / Google) **(Kevin)**, from a clean device, after the machine is rebuilt.
4. ERADICATE — keep the rejected tree out of git ancestry (done locally: A1); history rewrite before any push.
The K-12 order is fixed: rebuild the machine → rotate credentials → revoke the Firebase key → new Play upload keys → change the DB password and close 5432 → only then push the rewritten history.

### S8. Ransomware / destroyed data
CONTAIN — revoke deploy credentials, freeze Railway access to known people **(Kevin)**. RECOVER — restore the newest clean backup to a NEW database, verify, then switch `DATABASE_URL` (SECURITY_DR.md; the restore drill is in docs/DR_DRILLS_2026-10-08.md). VERIFY — row counts / integrity checks against the audit trail; payments reconciled with the processor before reopening checkout.

### S9. Cross-tenant exposure (SEV1)
1. DETECT — CROSS_TENANT_ACCESS_ATTEMPT, cross-tenant signal incidents, a salon reporting another salon's data.
2. CONTAIN — kill switch for the feature, or tenant lockdowns for the salons involved.
3. PRESERVE — the request ids, the query path, every tenant touched.
4. ERADICATE — fix the query (`scoped()` tenant + branch predicates), add a cross-tenant regression to `cross-tenant-suite.pgtest` / the generated IDOR table, extend `check:tenant` (raw SQL) or `check:tenant-builder` (Kysely builder statements) if the pattern escaped them.
5. VERIFY — the new regression fails on the old code.

### S10. Payment incident (double charge, unknown result, refund abuse)
1. DETECT — two approved payments for one ticket intent; PAYMENT_STATUS_UNKNOWN answers; refunds outside normal hours; chargeback alerts.
2. CONTAIN — an unknown result is **never** treated as declined and the card is **never** re-run blind: resolve with `/pos/checkout/tickets/{ticketId}/pay/card/verify` (inquire by order id), then decide. For refund abuse: revoke the staff member's sessions; refunds / voids already need a fresh step-up (C7).
3. PRESERVE — `payment_attempts`, `payments`, `payment_gateway_events`, the processor's own record.
4. RECOVER — refund / void the duplicate through the normal, idempotent path (stable keys `refund:*`); settlement reconciliation in Deposit Reconciliation.
5. VERIFY — processor and database agree for the window; the webhook ledger shows one processed event per processor event (E7).

## Contacts and authority
Kevin decides every external action and notification. Counsel decides whether, whom and how fast to notify. This runbook never
promises a notification deadline.
