# Security controls map — baselines and rollback (Security Deep Scan §2, §176)

Two tables the mandate asks for. Every row names the code, gate or test that IS the control — nothing here is a claim
without a file behind it. Section numbers (§) are the Security Deep Scan mandate's
(`docs/mandates/2026-10-23_SECURITY_DEEP_SCAN_MANDATE.txt`); the status of each is in
`docs/mandates/status/SECURITY_DEEP_SCAN_STATUS.md`.

## 1. Baseline cross-reference (§2)

### OWASP ASVS 5.0 (chapter level)

| ASVS 5.0 chapter | Controls in this tree (gate / test) | § |
|---|---|---|
| V1 Encoding and Sanitization | parameterized SQL (`check:raw-sql-inputs`, `check:sql-identifiers`, `escapeLike`); `check:html` escaping rule; React text nodes; `contentDisposition()`; §163 dynamic pass (`scripts/live-injection-pass.mjs`) | §83, §87–§88, §96, §99, §163 |
| V2 Validation and Business Logic | `ValidatedBody` on every body route (`check:validated-bodies`), strict unknown-field refusal on 1,245 / 1,268 body routes (`strict-bodies.vitest.spec.ts` + the type-aware `check:strict-bodies-types`, S-A14; 23 reviewed exceptions), `check:mass-assignment`, idempotency + unknown-state payment rules (`*.postgres-race`) | §40, §69, §120–§124 |
| V3 Web Frontend Security | generated CSPs (`apps/*/public/_headers`, `app-headers.vitest.spec.ts`: hashes for scripts and `<style>` elements), `frame-ancestors 'none'`, `safeHref`, CSRF origin verdict | §46–§47, §89–§90 |
| V4 API and Web Service | manifest + OpenAPI (`check:openapi`), attack surface (`check:attack-surface`), route authz declared (`authz-declared.vitest`), list caps (`check:list-queries`), body limits | §3, §38–§42 |
| V5 File Handling | ONE upload policy (`check:uploads`, `upload-policy.vitest`), sniffed type, private store, scan + quarantine (`upload-scan-required.test`) | §97, §102–§106 |
| V6 Authentication | scrypt (`password.test`), attempt budgets (`attempt-budget.pgtest`), MFA mandatory for platform (`require-totp.test`), reset never mints a session (`password-reset-complete`), trusted device for platform sign-in (`platform-device-trust.pgtest`, S-A13) | §50–§51, §58, §65, §29/§136 |
| V7 Session Management | refresh families + reuse detection (`refresh-session`, `refresh-reuse-alert`), revocation fail-closed (`session-fail-closed`), device revoke / block, SSE re-check (`sse-session-guard`) | §52–§57, §63 |
| V8 Authorization | `RolePermissionGuard` + `check:api-contract`, `role-matrix.vitest` snapshot, decision engine scopes incl. ASSIGNED (`decision.test`), cross-tenant + cross-branch suites, IDOR table with branch rows (`idor-route-coverage`, `live-phase14-idor.mjs`), step-up (`check:critical-step-up`) | §37, §59, §67–§75 |
| V9 Self-contained Tokens | 15-minute access JWT signed with `AUTH_SESSION_SECRET`, `sid` bound to a server row (`auth-session-token.vitest`) | §52 |
| V10 OAuth and OIDC | registered redirect URIs, PKCE, rotating refresh (`apps/api/src/oauth/*`) | §64, §98 |
| V11 Cryptography | AES-GCM sealed secrets per purpose (`packages/security/src/aes-gcm.ts`, `key-ring.ts`), `data-classification.pgtest` (no plaintext secret column) | §20, §149 |
| V12 Secure Communication | HSTS, `Secure` cookies, DB TLS posture (`network-posture-db.vitest`), safe-outbound https-only | §30–§31, §86, §92 |
| V13 Configuration | `production-config.ts`, secrets inventory (`secrets-inventory.pgtest`), lockfile hygiene + outbound hosts gates (`supply-chain-gates.vitest`), pre-commit hook (`pre-commit-hook.vitest`) | §12–§13, §19, §21, §144 |
| V14 Data Protection | redaction (`redaction.test`), log-capture scan (`log-capture-scan.pgtest`), field minimisation, lower-environment anonymiser (`anonymize-dump.pgtest`) | §22, §115, §118, §128, §157 |
| V15 Secure Coding and Architecture | `check:supply-chain-injection`, hidden-code audit, architecture tests, SBOM | §9–§10, §14 |
| V16 Security Logging and Error Handling | structured logger + error envelope (`error-envelope.test`), security events catalogue = DB CHECK, security signals → alerts (`security-signals-153.pgtest`) | §45, §137, §153 |

### OWASP API Security Top 10 (2023)

| API risk | Controls | § |
|---|---|---|
| API1 Broken Object Level Authorization | server-derived tenant (`tenant-context.middleware`), `check:tenant`, `check:tenant-builder`, IDOR table + live run (tenant AND branch rows), cross-tenant / cross-branch suites | §71–§75 |
| API2 Broken Authentication | see V6 / V7 | §50–§58 |
| API3 Broken Object Property Level Authorization | `x-forbidden` + `DANGEROUS_UNKNOWN` fields refused, strict bodies, `FieldMinimizationInterceptor`, `check:response-exposure` | §40, §69, §115 |
| API4 Unrestricted Resource Consumption | body limits, list caps, per-client / per-location limits, per-IP `@AnonRateLimit`, AI / OCR / export quotas | §41–§44 |
| API5 Broken Function Level Authorization | realm guard, `PlatformDomainGuard`, role matrix, `check:perms` | §49, §67, §70 |
| API6 Unrestricted Access to Sensitive Business Flows | step-up on money / authority changes, dual approval for platform-admin actions (`platform-admin-approvals.pgtest`), refund approval | §59, §133–§134 |
| API7 Server Side Request Forgery | `safe-outbound.ts` (connect-time DNS check, no redirects), `PROCESSOR_URL_POLICIES` | §91–§93 |
| API8 Security Misconfiguration | generated headers / CSP, CORS explicit list, `NODE_ENV` posture checks | §46–§48 |
| API9 Improper Inventory Management | manifest, attack surface (3,100+ routes), route-types ratchet, outbound-host inventory gate | §1, §3, §12 |
| API10 Unsafe Consumption of APIs | webhook signatures over raw bytes, tenant-bound Twilio verification, webhook ledger value-masked | §107–§110 |

### OWASP Top 10 (2025)

| Category | Controls |
|---|---|
| A01 Broken Access Control | V8 / API1 / API5 rows |
| A02 Security Misconfiguration | API8 row, V13 row |
| A03 Software Supply Chain Failures | npm audit gate, lockfile hygiene gate, SHA-pinned Actions, SBOM, Dependabot, pre-commit hook |
| A04 Cryptographic Failures | V11 row |
| A05 Injection | V1 row, §163 dynamic pass |
| A06 Insecure Design | threat model (`SECURITY_THREAT_MODEL.md`), dual approval, unknown ≠ declined payments |
| A07 Authentication Failures | V6 row |
| A08 Software or Data Integrity Failures | webhook signatures, idempotency, append-only audit (`audit-append-only.pgtest`) |
| A09 Security Logging and Alerting Failures | V16 row, §128 log-capture scan |
| A10 Mishandling of Exceptional Conditions | error envelope (no stack / SQL leaves), fail-closed session checks, §163 pass (no 5xx on hostile input) |

(Category names as published for the 2025 edition; the mapping is by control, so a renamed category moves no control.)

**Supply-chain practice baselines (SSDF / PCI):** SSDF PO.3 / PS.1–PS.3 → SHA-pinned CI, protected `production-image`
environment, SBOM, provenance (`build-image.yml`); PW.4 / PW.7 → gates above; RV.1–RV.2 → `SECURITY_FIX_REGISTER.md`.
PCI DSS practice → no PAN / CVV stored or logged (`card-data.pgtest`, `log-capture-scan.pgtest`), tokenizer only.

## 2. Rollback and feature flags for high-risk security changes (§176)

Every security change ships either behind a flag (left column) or as a plain redeploy (expand / contract migrations,
`check:migration-safety`, keep the schema forward-compatible so the previous build still runs).

| Change | Flag / switch | Rollback step | Notes |
|---|---|---|---|
| Super Admin network policy (§136) | `SUPER_ADMIN_NETWORK_POLICY=enforce\|report\|off` | set `report` (or `off`), restart | `docs/security/SUPER_ADMIN_NETWORK_POLICY.md` break-glass |
| Trusted device for platform sign-in (S-A13) | `SUPER_ADMIN_DEVICE_POLICY=enforce\|report\|off` | set `report`, restart; or approve the device in SQL (doc) | migration 698 is additive (columns + table) |
| Per-IP anonymous limiter (§28) | `ANON_RATE_LIMIT=off` | set `off`, restart | in-process store when no Redis |
| Tenant / client rate limits (§43) | `TENANT_RATE_LIMIT=off` (or `TENANT_RATE_LIMIT_GUARD_DISABLED=true`) | set, restart | |
| Strict request bodies (§40, S-A14) | none (per route) | revert the route's `{ strict: true }` (one line) and redeploy; a client sending an extra field gets 400 `is not an allowed field` | `strict-bodies.vitest.spec.ts` lists every strict route's callers |
| Unscanned documents refused (E5) | `UNSCANNED_DOCUMENTS=allow` | set, restart | ClamAV outage path |
| Row-level security (§73) | `DB_TENANT_RLS` | unset, restart | |
| MFA real-TOTP requirement (C16) | `MFA_REQUIRE_TOTP` (+ `NODE_ENV`) | — never relax in production; dev only | |
| Maintenance / break-glass (§138) | `MAINTENANCE_BREAK_GLASS` | as documented in `SECURITY_INCIDENT_RUNBOOK.md` | |
| Processor URL policy (D2) | `PROCESSOR_URL_POLICIES` (code) | redeploy previous build; a new processor host is added to the policy, never bypassed | |
| Body size limits (C9) | `MAX_BODY_SIZE` (credentialed, 25 MB) · `PUBLIC_BODY_LIMIT` (anonymous, 256 KB) | raise, restart | |
| CSRF origin verdict (C5) | `WEB_CORS_ORIGINS` | add the app origin, restart | a 403 `CSRF_REJECTED` names the cause |
| App CSP `<style>` hashes (§89) | generated `_headers` | `node apps/api/scripts/generate-app-headers.mjs`, redeploy the static app | a CSP violation in the browser console names the blocked `<style>`; regenerate after changing an inline `<style>` |
| Webhook ledger value masking (§128) | none | redeploy previous build | masking only removes secret shapes from `payload_json_safe` |
| Dual approval for platform-admin actions (§134) | `platform_settings approvals.platform.*.required` | Super Admin → Approvals → policies → off | default off |
| Payment / AI kill switches (§138) | payment-integration and AI platform kill switches (`payment-integration-kill-switch.pgtest`, `ai-platform-kill-switch.pgtest`) | Super Admin → System | |
| Lockfile hygiene / outbound hosts / pre-commit gates | CI gates (no runtime effect) | review + record the exception (`tooling/security/lockfile-review.json`, `outbound-hosts.allowlist.json`) | never `--no-verify` without a review |
