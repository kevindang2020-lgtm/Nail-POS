# SECURITY_REVIEW.md — AI PowerSalon

## Oct 27 2026 — internal remainder of the Security Deep Scan

**Section-by-section status:** `docs/mandates/status/SECURITY_DEEP_SCAN_STATUS.md` (192 sections: **155 DONE / 20 PARTIAL /
0 NOT DONE / 17 BLOCKED_EXTERNAL**; "DONE (app)" rows count as DONE, their hosting half is listed under EXTERNAL). Findings:
`docs/security/SECURITY_FIX_REGISTER.md` SD-9 … SD-22. Baseline map (ASVS 5.0 / API Top 10 / Top 10 2025) and the
**rollback / flag table for every high-risk security change**: `docs/security/SECURITY_CONTROLS_MAP.md` §1 / §2. Exact
paths per security commit: `docs/security/SECURITY_CHANGED_PATHS.md` (generated, `node tooling/security/changed-paths.mjs`).

| Area | Change | Commit · evidence |
|---|---|---|
| Trusted device for platform sign-in (S-A13, §29 / §136) | A Super Admin signing in from an unapproved device gets 403 `DEVICE_APPROVAL_REQUIRED`; approval by an emailed one-time link or from an approved device with step-up. `SUPER_ADMIN_DEVICE_POLICY` (enforce in production). Existing devices backfilled by migration 698. | `d598d8d3` · `platform-device-trust.pgtest` |
| Supply chain (§12 / §13) | Lockfile hygiene gate and outbound-host gate in `ci:gates` | `54107bd4` · `supply-chain-gates.vitest` |
| Logs (§128) | Log-capture scan over login / refresh / payment / refund / webhook flows; platform token shapes masked; webhook ledger value-masked | `6e1647fa` · `log-capture-scan.pgtest` |
| Pre-commit (§144) | Opt-in hook `npm run hooks:install` | `87ca7624` |
| Lower environments (§157) | `docs/security/DATA_HANDLING.md` + `apps/api/scripts/anonymize-dump.mjs` | `6c64dbbf` · `anonymize-dump.pgtest` |
| CSP (§89) | `<style>` elements by sha256; six apps on hashes only; admin-web / customer-web / pos-web keep `'unsafe-inline'` for computed `<style>` blocks | `d5269ecf` |
| Context / scopes (§36 / §68) | `realm` + `deviceId` on the trusted context; ASSIGNED and PLATFORM scopes | `67eec1dc` |
| Strict bodies (S-A14, §40) | Unknown fields refused on 906 of 1,268 body routes; gate keeps every new body route strict and lets the 362 only shrink | `327d2ddb` · `strict-bodies.vitest` |
| Dual approval (§134) | Platform-admin invitation and role change are approvable actions (policy default off) | `7cd0548e` · `platform-admin-approvals.pgtest` |
| Uploads (§104 / §106) | Unscanned images refused in production once a scanner is deployed (`UNSCANNED_IMAGES=allow` opt-out) | `251b24d2` |
| Branch isolation (§75) | Branch rows in the IDOR table + a live location attack; 3 routes fixed; 1 open (SD-21) | `c1f9fea2` |
| Injection (§163) | Local dynamic pass against the built API; database error text never reaches a client and class-22 data errors answer 400 | `SECURITY_TEST_REPORT.md` §163 |

**Still open (internal):** see the status report's INTERNAL list — 362 non-strict bodies, three apps' computed `<style>`,
per-route `@ResourceScope` (§38), process-wide egress allowlist (§93), webhook payload schemas (§110), the §163 module
findings, SD-21, the per-process limiters, the mobile transitive SBOM (§14). **Before the first production deploy:**
NEXT_STEPS S-A16 (trusted-device policy is `enforce` in production; SendGrid must be configured for approval emails).

## Oct 26 2026 — security build, malware scan, open items

**Section-by-section status:** `docs/mandates/status/SECURITY_DEEP_SCAN_STATUS.md` (192 sections: **140 DONE / 34 PARTIAL /
1 NOT DONE / 17 BLOCKED_EXTERNAL** after this build). Findings and fixes: `docs/security/SECURITY_FIX_REGISTER.md` (SD-1 … SD-8
for this build). Gates on HEAD `47c4044b`: **54 gates + 17 audits passed**. That includes `check:critical-step-up`,
`check:attack-surface`, `check:validated-bodies`, `check:html` and hidden code rule 5.

### What the Oct 26 build added (`2881125c`, `d571dbab`, Secure Tap `b52e05d4` / `f8e3c0d3` / `33807ecf` / `97d68d74`)

| Area | Change | Evidence |
|---|---|---|
| Platform network policy (§136 / §29) | IP blocks and the allowlist (`ip_block_rules` ∪ `SUPER_ADMIN_IP_ALLOWLIST`) are **enforced** on `/super-admin/*`, on platform login, and on every request of a SUPER_ADMIN session. Every refusal is a `NETWORK_POLICY_DENIED` event (migration 692) plus an audit row. A DB failure keeps the last loaded rules. A lockout guard is in place, and `SUPER_ADMIN_NETWORK_POLICY=report\|off` is the break-glass. | `docs/security/SUPER_ADMIN_NETWORK_POLICY.md`; `network-policy.vitest.spec.ts`, `platform-network-policy.vitest.spec.ts` |
| Step-up (§59) | `@RequireStepUp` on staff-role create / archive, access invitations, override revoke and technician app-access. These are in the `CRITICAL` gate list. | `check-critical-step-up.mjs` |
| Anonymous rate limit (§28 / §43 / §44, S-A10) | `@AnonRateLimit` applies a per-IP limit to every public route that had none. It uses Redis when configured, runs in-process otherwise, and fails open. The attack-surface rate column is derived from the decorators, and no public row is left without a limit. | `anon-rate-limit.test.ts`, `SECURITY_ATTACK_SURFACE.md` |
| Cross-branch isolation (§75 / §187) | `cross-branch-suite.pgtest` with `expectBranchDenied` / `expectBranchIsolated` | apps/api test-support |
| Security signals (§153) | Platform-admin change, merchant-config change, repeated unknown-state payment retry, upload malware, and scan unavailable | `security-signals.ts` |
| Request bodies (§40) | Strict mode (unknown field → 400) on the auth, merchant-config and platform-security bodies. Shape schemas on the 4 webhook routes; the allowlist is empty. | `check:validated-bodies` |
| Sorting / HTML (§84 / §87) | Own-key sort lookups. An HTML-escaping gate for the single-file apps, with 3 fixes. CSP hashes were regenerated. | `sort-own-keys.pgtest`, `audit-html-apps.js` |
| Payment devices (Secure Tap §5 / §12 / §51 / §53 / §10) | Device counters and HIGH security events for revoked / mismatched / replayed requests. Server attestation intake (`TTP_ATTESTATION_POLICY`, default off). Three biometric failures force a full sign-in. Return to Staff needs the password when Face ID is unavailable. The store switch checks the target location's merchant and fails closed. | `SECURE_TAP_STATUS.md`; pilot S10–S14 133/133 |
| Clock PIN (M4-1, Kevin's decision) | A lower scrypt cost for the 4-digit PIN (N=2048). The keyed lookup digest, lockouts and the per-kiosk window are unchanged. A row was added to `SECURITY_THREAT_MODEL.md`. | `clock-pin-hash.vitest` |

### Malware / backdoor / supply-chain scan (`eb691b77`, `docs/security/MALWARE_SCAN_REPORT.md`)

**Verdict: no malware, backdoor or malicious dependency** in the working tree, in any version of any file in the git history
(793 commits, 22,111 blobs), or in the installed dependencies. The infected developer uploads of Sep 29 / Oct 6 were never
committed here.

Two low-severity items were fixed:
- Raw bidi / zero-width characters in 7 files are now `\uXXXX` escapes, and the hidden-code gate gained **rule 5**.
- 24 dev lockfile entries now carry `resolved` + `sha512` integrity.

Residual risks:
- gitleaks could not run in the sandbox (CI runs it).
- `node_modules` was checked by path / version, not re-hashed.
- The Docker base image is tag-pinned, not digest-pinned.
- Known upstream CVEs are on the dated npm-audit allowlist.
- Secrets held in environments are outside a repository scan, so the K-12 rotation still stands.

### Open security items

**Internal** (`SECURITY_DEEP_SCAN_STATUS.md` → INTERNAL, also NEXT_STEPS I-8 / I-9 / S-A*):
- Quarantine unscanned images (§104 / §106).
- Strict bodies route by route (§40, S-A14).
- Lockfile hygiene gate (§13).
- Outbound-host gate and egress allowlist (§12 / §93).
- Drop `style-src 'unsafe-inline'` (§89).
- Log-capture scan (§128).
- Pre-commit hook (§144).
- Local injection pass (§163).
- Platform-admin dual approval (§134).
- `realm` / `deviceId` in `Ctx` + resource-scope metadata (§36 / §38 / §68).
- **§157 lower-environment data policy (NOT DONE).**
- Rollback table (§176).
- Trusted device for platform sign-in (S-A13).
- Nest 11 / kysely upgrades (S-A2), dev tooling majors (S-A3), the settings any-of permission (S-A4), query-string display tokens (S-A5), the plugin pin (S-A8), and the admin step-up cancel (S-A11).

**External, owned by Kevin's developer — K-12 in order:**
1. Rebuild the machine.
2. Rotate every credential.
3. Revoke the Firebase key.
4. Create new Play upload keys.
5. Change the DB password and close 5432.
6. Push the rewritten history.
7. Then drop `continue-on-error` on the gitleaks full-history step.

**External (Kevin):**
- Edge / WAF.
- Railway variables (`DEVELOPER_HANDOFF.md` → Pre-deploy checklist).
- DB roles + private networking.
- `_headers` served.
- ClamAV + bucket.
- Encrypted backups + a real restore.
- GitHub protections.
- Digest pins.
- The processor webhook signing spec.
- A penetration test on staging.

**Before the first deploy:** check the Super Admin DB allowlist (S-A15). Any `whitelisted` allowlist row now restricts
platform access to those addresses.

## Oct 23 2026 — Security Deep Scan, Anti-Hack Hardening & Zero-Trust: final security report (mandate "Required Claude Final Security Report", A–L)

Companion documents (all under `docs/security/`): SECURITY_FIX_REGISTER.md (every finding, fix, commit, test, status) ·
SECURITY_TEST_REPORT.md (commands + acceptance matrix) · SECURITY_ATTACK_SURFACE.md (generated, 3,096 routes) ·
SECURITY_INCIDENT_RUNBOOK.md · DEPENDENCY_SECURITY_REPORT.md + sbom/ · SECURITY_THREAT_MODEL.md (root, Oct 23 section) ·
NEXT_STEPS.md (security section) · DEVELOPER_HANDOFF.md (top). Nothing here claims zero risk.

**A. Existing security architecture found.** Deny-by-default session middleware with a reviewed public list (`check:public`);
realm separation (customer / staff / platform cookies + signed audience); RolePermissionGuard (default-deny), PlatformDomainGuard
(every /super-admin route keyed), StepUpGuard (server-side freshness on the session row); 15-minute access tokens + rotating
refresh with reuse burning the session; scrypt passwords; mandatory Super Admin MFA; Support Mode with reason + expiry; tenant /
branch from the session only (client ids stripped), `scoped()` predicates, same-tenant triggers, optional RLS; ValidatedBody
schemas; security headers + generated app CSPs; payment idempotency with unknown ≠ declined; signed webhooks; SSE revocation
checks; append-only audit + security events; 50+ CI gates (tenant, tenant-builder, supply-chain, hidden-code, secrets …).
**No WAF / edge layer exists** (Railway, no cloud account).

**B. Findings.** 58 register rows from five scan letters: 1 P0, 11 P1, 16 P2, 30 P3. P0 + every P1 code finding fixed; the two
P1 items left are Kevin's (A1 pushed-history rewrite, B2 Android keystores). P2: all 16 fixed in code (several also need a
Railway / console step). P3: 23 fixed, 3 accepted / mitigated with dates (B10 kysely unreachable advisories, B13 dev-only
tooling majors, B16 plugin pin), 1 Kevin (B14 base-image digests), 3 open internal (C15, E11, sort-key robustness). Each row:
root cause, precondition, impact, fix, commit, test — SECURITY_FIX_REGISTER.md.

**C. Backdoor / malware review.** FOUND (historical): the outside developer's Sep / Oct 2026 upload — obfuscated root `api.js`,
a 12,892-character hidden line in `eslint.config.mjs`, root `build` / `dev` running `node api.js`, plus keystores and a
database login. It was an ancestor of HEAD through a merge's second parent; that is removed from this clone's history (A1) and
no `api.js` blob is reachable. NOT FOUND in the current tree: hidden whitespace payloads, obfuscation, install hooks, eval /
new Function / vm in runtime code, child_process in runtime code, reverse shells, miners, unknown egress, git hooks, editor
auto-run tasks (evidence: SECURITY_TEST_REPORT §2). Limitations: static review only (nothing from the upload was executed); the
remote repository still carries the old history until Kevin's rewrite; the developer's machine is assumed compromised.

**D. Security architecture after the changes.** Internet → [edge WAF: REQUIRES KEVIN] → Railway TLS proxy → Express (exact
proxy hops, headers, credentialed CORS for app origins only, CSRF origin verdict on cookie-authenticated writes, 256 KB anonymous /
25 MB signed-in bodies, form bodies only on provider callbacks) → TenantContextMiddleware (signed + unrevoked session, fail
closed on platform + money routes, authz version) → guards (Realm, RolePermission, PlatformDomain, StepUp with a gated critical
list, Suspended, MfaEnrollment, rate limit) → ValidatedBody → domain services (scoped tenant + branch, state machines,
idempotency) → PostgreSQL (tenant_id everywhere, triggers, optional RLS, least-privilege roles — switch REQUIRES KEVIN, boot
posture check warns). Outbound to any person-typed URL: `packages/security` safe-outbound (connect-time address check, no
redirects); processor hosts allow-listed.

**E. Super Admin protection.** MFA mandatory, TOTP preferred over SMS when enrolled (C8); a password reset never mints a session
and an authenticator cannot be replaced without its current code (C1); Postgres attempt budget on MFA / step-up /
change-password (C4); step-up on every critical platform action, gated (C7); credentials never returned to an admin — sent to
the account holder (C2); platform accounts only by invitation with rank checks (C3); admin reset route under the guards with a
real audit (A2); sessions fail closed (C10); device / session visibility and revoke; Support Mode with reason + expiry.
Network allow-list / identity-aware proxy for /super-admin: REQUIRES KEVIN.

**F. Tenant / branch isolation (executed).** cross-tenant-suite.pgtest + the generated IDOR table + `check:tenant` +
`check:tenant-builder` (caught a new statement this batch) — PASS; two cross-tenant write paths fixed (E1 Twilio number
takeover, E2 webhook token chosen by the attacker) with two-tenant regressions; branch: E8 receipt preview bound to its
document, manager branch scope on admin resets; pilot: technician #100 refused #101's pay, commission and the owner's payroll.

**G. Payment security.** Stable idempotency keys on every money mutation; an unknown processor answer is never a decline and
never re-charged blind (pilot phase 10: decline, busy, unknown → verify, dropped connection → exactly one approved payment);
refunds / voids need a fresh step-up; processor base URLs allow-listed at write and at call (D2); payment webhooks bound to the
merchant's configured processor, deduped across paths, id-less events keyed by their signed bytes (E7); race lane 317 tests PASS.

**H. Supply chain.** Production audit 0 critical / 1 high (allowlisted, unreachable, dated); SBOM (504 components) + mobile
native SBOM; SCA gate on every push / PR, dependency review, Dependabot; SAST (CodeQL) and history secret scanning (gitleaks)
configured — first runs happen on GitHub (NOT_TESTED here); actions SHA-pinned; Gradle wrapper verified official and pinned;
Trivy container scan unchanged.

**I. Infrastructure actions.** IMPLEMENTED in code / CI: everything above. REQUIRES KEVIN: K-12 sequence (rebuild the developer
machine → rotate credentials → revoke the Firebase key → new Play upload keys → change the DB password and close 5432 → only then
push the rewritten history); Cloudflare-class edge (WAF, bot, DDoS); Railway variables (NODE_ENV, RATE_LIMIT_STORE=redis,
WEB_CORS_ORIGINS without marketing, CLOCK_PIN_LOOKUP_KEY, TWILIO_ACCOUNT_SID, PAYMENTS_WEBHOOK_RAW_BODY); aps_api / aps_worker
roles; ClamAV; GitHub settings (branch protection, code scanning, secret-scanning push protection, dependency graph, image
reviewers); confirm `_headers` are served; store rebuilds on Capacitor 8.5.3; base-image digests; bucket ownership.
BLOCKED_EXTERNAL: processor webhook timestamp spec, staging injection tests, penetration test, real-device Tap to Pay.

**J. Files and migrations.** Commits c70f87c5, 33022b28, b036d51c, aae1e752, 0c016f1d, a87269f6, 1b115fb8, 61f8e241, 1be74ac3,
5a784efd, 990aff06 (+ docs / pilot evidence after). Migrations: 684 (tenant messaging number owner lock trigger), 685 (kiosk
sessions index for salon-wide caps), 686 (security_events CHECK gains MFA_REPLACE_REFUSED). New code: packages/security
safe-outbound + content-disposition; identity auth-attempt-budget; super-admin admin-credential-delivery +
platform-user-hierarchy; apps/api common/allowed-origins + request-body-limits; gates check-raw-sql-inputs,
check-critical-step-up, attack-surface, tooling/security check-npm-audit + check-gradle-wrapper; .github codeql.yml,
dependabot.yml. Full per-file list: DEVELOPER_HANDOFF.md (top) and `git show --stat <commit>`.

**K. Test evidence.** On commit 2975758d: packages 1,158 / modules 10,581 / web apps 3,611 / API 2,957 tests, 0 failed; race lane
317 tests on real PostgreSQL, 0 skipped; ci:gates 54 gates + 17 audits PASS; pilot 117/117 incl. 200 technicians; restore drill
12/12. Acceptance matrix with PASS / NOT_TESTED / BLOCKED_EXTERNAL per control: SECURITY_TEST_REPORT.md §2.

**L. Residual risk (honest).** (1) No edge WAF / DDoS / bot layer until Kevin adds one — the app's own limits are the only
throttle. (2) Old credentials remain valid in the remote git history until rotation + rewrite. (3) Production configuration is
unverified from here (NODE_ENV, Redis-backed limits, CORS variable, DB roles, ClamAV, `_headers`) — the code warns or fails
closed where it can, but a misconfigured Railway variable weakens a layer. (4) SAST / history secret scanning / container scan
have not had a first run. (5) Dev-tooling majors (vitest, vite) and Nest 11 / kysely 0.28 are pending (dated allowlist).
(6) Large-salon watch items: 100 simultaneous clock-ins p95 4.1 s; queue state with 100 clocked in 1.8 s. (7) No penetration
test yet. (8) A Super Admin with password + authenticator can still take destructive platform actions — audit and alerting,
not prevention, is the control there.

---

## Oct 20 2026 review (mandate §243 / 130-section mandate §98–§101)

Tree: `work/dual-screen-display` from `6ffc9c78` (Oct 14) plus the nine commits of Oct 20 2026 (`faef6aed` … `79df7020`).
Evidence for every number: `final-run/summary.txt` (the one logged run — see TEST_REPORT.md). Nothing below is claimed from an earlier run.

## 1. Malware — what was found, where, and what is in THIS tree

| Where | Finding | Status |
|---|---|---|
| **Developer's tree `Power-Salon-main_New.zip`** (uploaded Oct 20; every file stamped Oct 6 2026 08:50 — the same Oct 6 export the Oct 13 hand-off describes) | `api.js` at the repo root: 29,057 bytes, a tab-padded, `javascript-obfuscator` program (`_0x…` identifiers, `global['!']` marker). `eslint.config.mjs` line 35: 14,876 characters — the clean config followed by ~14,000 spaces/tabs and a second copy of the payload, plus a `createRequire` shim only the payload uses. Root `package.json` `"build": "node api.js && …"` and `"dev": "node api.js && …"`. Also committed: `apps/api/firebase-admin.json` (a real Firebase service-account private key), `apps/{customer,owner,tech}-web/android/*.jks` + `key.properties` (upload keystores with their passwords), and 16 stray root scripts (`fix-*.js`, `test-*.js`, `scratch.*`, `run_436.mjs`, …). | **Not in this tree.** The zip was scanned statically only (nothing from it was executed); its content was already ported on Oct 12 (`7c56e49e`) — every migration 432–438 of the zip exists here as 472–478, `owner_notifications` deliberately not reproduced (one authority: the in-app notification consumer). Nothing new to merge. |
| **This tree** | Scanned the same way: 0 hidden-whitespace payloads, 0 obfuscator identifiers, 0 `global['!']`, 0 install hooks (`preinstall/install/postinstall/prepare`) in 57 `package.json` files, 0 root scripts run by `package.json`, 0 editor auto-run tasks, 0 `eval`/`new Function` in production code except two documented lazy `require('@aws-sdk/…')` loads and one regex read from our own source in a build script. Outbound hosts referenced in source: the declared providers only (CardConnect/Fiserv UAT + prod, Clover sandbox, Twilio, SendGrid, FCM/APNs, Retell, S3) and test fixtures. | `check:supply-chain-injection` **OK** (8,724 tracked files); `check:secrets` **OK**. |
| **Gate** | `apps/api/scripts/check-supply-chain-injection.mjs` R1–R6 (hidden code, obfuscation, marker, root-script runner / install hook, stray root script, editor auto-run) + **R7 (Oct 20)**: any tracked `.jks/.keystore/.p8/.p12/.pfx`, `key.properties`, `firebase-admin*.json`, `service-account*.json`, `google-services.json`, `GoogleService-Info.plist`, a real `.env`, or a `.pem` holding a private key fails the build; native trees are scanned for this rule. Negative-tested (re-adding a keystore, `key.properties` and `firebase-admin.json` → rc=1). Pointed at the developer's zip it reports **26 findings**. | runs in `ci:gates` and the security CI lane |

**Still Kevin's (unchanged from the hand-off, nothing in code can do these):** rebuild the developer's machine; from a clean device rotate every credential it held (GitHub, npm, Railway, Postgres, Twilio, SendGrid, Fiserv/CardPointe, Firebase, Apple/Google); revoke the committed Firebase key and create a new one into `FCM_SERVICE_ACCOUNT_JSON`; new Play App Signing upload keys; change the external database password and close port 5432; then the one git-history rewrite (the keystores and the old DB login are in history until then — nothing is pushed to GitHub before it). Developer work comes in as pull requests only (the gate runs on them), never as a zip.

## 2. Tenant isolation
- `tenant_id` on every tenant table (`check:db-ownership`); request context from the verified session only (`contextFromSession`); gates `tenant`, `tenant-builder`; route sweep "must be refused" probes and cross-salon IDOR proof (numbers in TEST_REPORT.md from this run); RLS on 10 core tables (`DB_TENANT_RLS=1` — Kevin switch #26 after a staging trial); DB-level same-tenant triggers on 33 (table, column) pairs — the remaining ~69 tenant FK columns (incl. `ticket_service_lines.technician_id`, `ticket_compensation_snapshots.technician_id`) are **P2, open** (bug register #B-12).
- Branch: `branch_id` on appointments, queue items, terminals, merchant accounts, schedules, displays, ads; branch confinement through `user_branch_access`.

## 3. Authentication, sessions, permissions
Realms by token audience (platform / tenant / customer / service; public booking = unauthenticated + verification/hold tokens); password, OTP, WebAuthn, TOTP + recovery codes, trusted devices, biometric device credential (server holds only a rotated SHA-256; reuse = theft → revoke); refresh rotation with family burn; server session records read on every request; POS auto-lock server-enforced. RBAC + scope + policies, deny by default (0 unkeyed staff routes); field-level minimization; feature entitlement separate from permission. Step-up on money / role mutations (incl. the new manual refund settle, `POST tickets/:id/refunds/:refundId/settle`).

## 4. Secrets
No plaintext secrets in the tree (`check:secrets`); provider secrets AES-GCM-sealed in the database under env-held purpose keys with rotation (Kevin's §150 choice — recommended: keep until hosting offers a KMS). **Removed Oct 20**: the three tracked Android upload keystores + `key.properties` (`faef6aed`). **Open until Kevin acts**: history rewrite; Firebase key revoke; DB password; keystore rotation (above).

## 5. Payments (what changed Oct 20 and why it was a security matter)
- **Gift cards (P0 §142, `be06283e`)**: `POST /pos/checkout/gift-cards/:code/reload` created stored value with no payment, no step-up, no idempotency and a ledger row written outside the transaction with its error swallowed — removed; the one reload path is payment-first. `voidGiftCard` writes balance + ledger in one transaction. The swallowed `.catch` had been hiding `invalid input syntax for type uuid: ""` — balance changes with **no ledger row** (the drift wave 4 saw); gift-card ledger writes coerce a non-uuid actor to NULL. Real-Postgres: ten concurrent activations of one paid reload credit once.
- **Refunds (P0 §228/§223, `c2a344f9`)**: a lost processor answer (timeout / `B`) released the reservation and the route's key → a retry refunded twice. Now held in `processing`, every further refund on that payment refused, settled only from the processor's own record (sweep or manager with step-up + note). Only an explicit decline frees money. `refund-race.postgres-race` (never run before) 7/7 incl. ten retries → zero extra processor calls, ten concurrent sweepers → one settle.
- **Declines (P1 §232, `cef689c8`)**: a processor problem was recorded as a card decline (CardPointe `B`, Clover `pending`). Adapters now state the outcome; retry → claim freed, `CARD_PROCESSOR_UNAVAILABLE`, other tenders; unknown → held and verified.
- Unchanged and verified again: claim-first card charges with idempotency keys, raw-PAN refusal, CardSecure hosted tokenization, merchant isolation (UNIQUE tenant+branch + cross-tenant trigger), webhook HMAC with the tenant's secret and merchant→tenant from our own config, claim-before-effect dedupe.

## 6. Twilio / messaging
No Twilio SDK; provider calls only through the telephony adapter (architecture gate; `providerDirs` 27 → 26 — the copilot call transfer that carried its own Twilio request is now a caller of `TelephonyProvisioningPort.transferCall`, B-14 part 1, `51c3f827`). Per-salon credentials, Messaging Service, number uniqueness (the SMS-number takeover P0 was fixed in wave 3), `X-Twilio-Signature` with the owning account's token, tenant from the `To` number / AccountSid never from the body, OTP never logged (redaction keys), STOP/START/HELP honoured, marketing vs transactional consent separate. Mock senders refused in production.

## 7. Webhooks, inputs, uploads
Payment webhooks: raw-body HMAC, dedupe inbox (`payment_gateway_events`), idempotent state machines. Inputs: `validated-bodies` (every mutating body schema-validated; 4 signature-verified provider routes allowlisted), `mass-assignment`, `sql` gates; SSRF guard on outbound partner webhooks; CSRF/sameSite. Uploads: MIME + magic bytes + dimensions + size + ownership (`upload-policy.ts`, `image-info.ts`), ClamAV scanner (service = HOSTING D2). **Production now refuses to start without object storage (`ef303be2`)** — uploads were silently on the container disk.

## 8. Mobile / AI / files
Capacitor apps: release ATS / cleartext off, backup off, no signing file in any app tree (`check-native-config`, `LEGACY_SIGNING_FILES` now empty and must stay empty); the developer's unauthenticated `/public/push/register` was refused in October; biometrics as above. AI: never a domain authority (copilot `HUMAN_CONFIRMATION_REQUIRED`; scheduling only via BookingService; Fair Turn hard eligibility first); structured outputs; the receptionist acts under its own principal and permissions; kill switches. Files: private object storage adapter; owner avatars / export bytes still in Postgres (P3, #B-18).

## 9. Operations
`MAINTENANCE_BREAK_GLASS` (env, works with the DB down) and, new, **`POST_RESTORE_HOLD`** (`79df7020`): after a restore no job is claimed, no outbox event dispatched, no scheduler ticks until the DR §3.1 reconciliation is done — the restore drill proves it on the restored copy. Health reports the hold.

## 10. Open items (security-relevant), by priority
See `BUG_REGISTER.md` (§255). Closed in the evening session of Oct 20: every tenant→tenant FK column now has its same-tenant trigger (B-12, migration 666 — 144 triggers; the Tenant Safety Community excluded by design); end employment for non-technician staff (B-13: sessions, refresh tokens, grants, roles and overrides revoked in one transaction, step-up, last-owner rule); the copilot's second Twilio client (B-14 part 1); `check:migration-safety` (B-15). Later the same night: B-14 closed (direct emitters 0, hand-built system actors 0 — the reconciliation sweep no longer stamps a fake all-zeros user as a case's creator — back-edges 0) and B-16 built (platform-managed Twilio subaccounts; the subaccount token sealed, never returned or audited; provisioning needs integrations.manage + step-up + a reason). No P2 remains open. External/HOSTING: TLS, WAF, encrypted backups + KMS, ClamAV service, real restore on Railway, penetration test.

## 11. Oct 22 2026 — the deep-scan / pilot hand-back (what changed that touches security or money integrity)

| Change | Security / integrity effect | Reviewed |
|---|---|---|
| No tender while a card attempt is unsettled (`assertNoUnsettledCard`, `47d13d8d`) | closes a double charge: a second card, cash, gift card or split was taken while the first card's answer was unknown, and Verify then completed it too | refusal is 409 PAYMENT_STATUS_UNKNOWN; staff settle with Verify (permission `pos.checkout.take_payment`); no new route |
| Lost / unknown processor answers (`05ec3522`) | no raw 500 leaks a stack-shaped error; skip-the-line and wallet top-up no longer tell a customer "declined" when the card may have been charged | messages are client-safe registry sentences |
| Pay periods may not overlap (`ae5bb3d4`) | one sale can be paid only once; per-salon advisory lock serializes creates (race-proven) | 409 PAYROLL_PERIOD_OVERLAP names the other period's dates only |
| Paycheck approve requires a submitted week (`6b128aa5`) | keeps the manager-submits / owner-approves separation even for an empty week | step-up + separation of duties unchanged |
| Exact-service eligibility in queue + Fair Turn (`0a67b2af`) | a technician not approved (skills / certification / employment / branch) is no longer recommended or assigned; the existing audited manager override is unchanged | uses THE eligibility authority booking already uses — no second rule |
| Finance read scope (`9f65ce62`) | **access widened deliberately and narrowly**: a non-restricted caller (an owner) now also reads salon-wide expense rows (branch NULL) she was already allowed to WRITE; `ALL_BRANCHES` ('all') is a read filter resolved through the same branch-scope port. A branch-restricted manager is unchanged (still only her branch — test). | real-schema test covers owner, granted owner and restricted manager |
| Receipt upload bytes (`e0e28816`) | input now validated (whole numbers 0–255) before the upload policy; junk is 400, not a 500 | the malware / type / size policy runs unchanged after conversion |
| SMS sender route (migration 678, `f5d9001d`) | records the From number / Messaging Service id and the path — addresses, never a credential | — |
| `apps/api/scripts/lib/twilio-loopback.mjs` | a PROOF-ONLY preload: inert unless `TWILIO_LOOPBACK_LOG` is set, loaded only by `live-pilot-day.mjs` through `NODE_OPTIONS`; it never writes the Basic-auth secret. Never set either in production. | — |
| `ENV_INVENTORY.md` (generated by `tooling/ci/gen-env-inventory.mjs`) | names only — the generator never reads a value | grep for values: none |

Secrets: no password, key or token was written into any file of this hand-back; the K-12 sequence (machine rebuild → credential
rotation → Firebase key revoke → new Play upload keys → DB password + port 5432 → only then the history push) is Kevin's
and still open (`NEXT_STEPS.md` P0-1).
