# SECURITY_TEST_REPORT.md — exact commands, environment and results (mandate §161–§169, §177)

**Code under test:** commit `2975758d` (branch `merge-github-main`; later commits change documentation and evidence files only).
**Environment:** cloud sandbox, Linux, Node 22.22.0, npm 10.9.4, PostgreSQL 16 (local), Chromium 1243 (Playwright), `TZ=UTC`
(CI runs UTC; date-sensitive tests are written for it). No production credentials, no provider accounts: every provider is a
loopback fake or the honest "not configured" path. Date: Oct 23 2026.

Result words: **PASS** (executed here, green), **FAIL**, **NOT_TESTED** (not executable in this environment — reason given),
**BLOCKED_EXTERNAL** (needs an account / service / environment that does not exist yet).

## 1. Suites

| Lane | Command | Result |
|---|---|---|
| Packages | `npm run ci:test:packages` | **PASS** — 123 test files, 1,158 tests, 0 failed |
| Modules | `npm run ci:test:modules` | **PASS** — 1,274 files, 10,581 tests, 0 failed (227 skipped: the real-Postgres race tests, run in the race lane) |
| Web apps | `npm run ci:test:apps` | **PASS** — 697 files, 3,611 tests, 0 failed |
| API | `npm run ci:test:api` | **PASS** — 360 files, 2,957 tests, 0 failed (134 skipped: race tests) |
| Real-PostgreSQL concurrency | `PG_RACE_URL=…/race_final npm run ci:test:race` (fresh database, all migrations) | **PASS** — 93 files, 317 tests, 0 skipped, across 15 packages |
| Repository gates | `npm run ci:gates` | **PASS** — all 54 gates + 17 audits |
| Typecheck | `npm run typecheck` (API) + `npx tsc --noEmit -p .` per web app | **PASS** |
| Pilot day (post-hardening) | `DATABASE_URL=…/pilot_sec node apps/api/scripts/live-pilot-day.mjs` (fresh DB, built API + apps, Chromium) | **PASS** — 117/117 checks incl. phase 11 (200 technicians). Evidence: docs/pilot-runs/2026-10-23-post-hardening/ |
| Backup → restore → verify | `DRILL_DATABASE_URL=…/pilot_sec node apps/api/scripts/drills/drill-restore.mjs` | **PASS** — 12/12 (ledger 626/626, row counts in 769 tables, payments + tickets checksums, encrypted columns open, worker hold) |

Failures found on the way and fixed before the final run (each is a commit): `security_events` CHECK missing
`MFA_REPLACE_REFUSED` (migration 686 — the event was being dropped); two register tests that still expected admin-set
passwords; a stale PGlite fixture (`technicians.user_id`); a stale Android channel list; tenant-builder gate (one new reviewed
statement); architecture test (a mirrored type, a per-connection interval, a UTC-day idiom). Pilot harness: owner first
sign-in via the account-holder delivery, gateway base URL on an allow-listed host, step-up window, Chromium path, race slot.

## 2. Security control evidence

| Control (mandate matrix) | Evidence | Result |
|---|---|---|
| Malware / backdoor scan | `python3 -I tooling/security/check-hidden-code.py`; `node apps/api/scripts/check-supply-chain-injection.mjs` (in ci:gates); whole-tree sweep + `git log --all -G` for the payload marker; `git cat-file -e 5158b038` → not found; no `api.js` blob reachable | **PASS** in this clone (pushed history: Kevin's rewrite) |
| Secret scan | `security:fast` working-tree scan; `tooling/security/check-db-credentials.py`; history scan done in the deep scan (values never printed) | **PASS** for the tree; **FAIL → REQUIRES KEVIN** for old history in the remote (f48ef5f3 DB login, keystores) until rotation + rewrite |
| Dependency scan | `node tooling/security/check-npm-audit.mjs` → prod: 0 critical, 1 high (allowlisted, unreachable kysely) | **PASS** |
| SBOM | `npm sbom … > docs/security/sbom/aipowersalon-production.cdx.json` (504 components) + mobile native SBOM | **PARTIAL** (re-audit Oct 28: the mobile transitive SBOM and an executed container SBOM are missing — §14) |
| Edge WAF / DDoS / bot | none in front of Railway | **BLOCKED_EXTERNAL** (Kevin: Cloudflare or equal) |
| Application security gateway | request-guards.vitest.spec (CORS split, CSRF origin verdict, body limits), security headers tests | **PASS** |
| Authentication | auth suites incl. attempt-budget.pgtest / postgres-race, mfa-bypass-regression, password-reset-complete, system-reset-hardening | **PASS** |
| Super Admin MFA | require-totp.test (C16), mfa-replace.pgtest (C1), attempt-budget (C8 TOTP preferred), pilot phase 1 (TOTP enrol + step-up) | **PASS** |
| Session rotation / refresh reuse | refresh-session specs, refresh-reuse-alert.vitest.spec (C13), session-fail-closed / session-revocation-status (C10); pilot: Tech App refresh + logout kills the old cookie ×5 | **PASS** |
| Authorization | authz-declared, role matrix, critical-step-up-gate (74 critical routes: 70 step-up, 4 reviewed exempt, 0 pending), credential-actions.pgtest | **PASS** |
| Tenant isolation | cross-tenant-suite.pgtest, check:tenant, check:tenant-builder (caught one new statement this batch), tenant-number-isolation / twilio-tenant-binding (E1/E2) | **PASS** |
| Branch isolation | ai-ocr-receipt-preview-key (E8), manager branch scope in system-reset-hardening | **PARTIAL** (re-audit Oct 28: three branch leaks were found outside this evidence — receipts, paychecks incl. legacy period reads, Tap to Pay attempts — fixed, pgtests added; re-run the cross-branch suite under V-28) |
| IDOR tests | generated IDOR table (idor-route-coverage.vitest.spec) + pilot permission attacks (tech #100 → #101 pay / commission / owner payroll: 403) | **PASS** |
| SQL injection | `check:raw-sql-inputs` (102 reviewed non-literal call sites, none new); escape-like.test; branch-timezone.test; **§163 local dynamic pass** (`live-injection-pass.mjs`, 22,250 requests, §4 below) | **PASS** (static + unit + local dynamic: no SQL error text, no injected behaviour); a staging run stays **BLOCKED_EXTERNAL** (no staging); 13 routes still answer 5xx to malformed input (robustness findings, §4) |
| XSS | skill-evidence-links.vitest.spec (D4), safeHref tests, generated CSP headers | **PASS** in code; CSP delivery on Railway static hosting **REQUIRES KEVIN** to confirm |
| CSRF | request-guards.vitest.spec (CSRF_REJECTED on cross-site cookie POST) | **PASS** |
| CORS | cors-native-origins.vitest.spec (incl. C14: no `http://localhost` in production), gateway-security | **PASS** |
| SSRF | safe-outbound.test (blocked ranges, connect-time lookup, no redirects), processor-url-allowlist.pgtest | **PASS** |
| Command injection | no child_process in runtime source (scan) | **PASS** (static) |
| File upload security | upload-policy tests, upload-scan-required.test (E5), check:uploads 16/16 | **PASS** in code; ClamAV deployment **REQUIRES KEVIN** |
| Webhook security | payment-webhook-dedupe.pgtest incl. E7 (processor binding, cross-path replay, id-less replay), signature specs, twilio-tenant-binding | **PASS**; processor timestamp window **BLOCKED_EXTERNAL** (signing spec) |
| Realtime security | still-valid.vitest.spec (C11), sse-session-guard specs | **PASS** |
| Payment security | checkout idempotency / unknown-state suites, race lane (317 tests), pilot phases 4–6 and 10 (decline, busy, unknown → verify, dropped connection: one approved payment) | **PASS** |
| Super Admin hardening | credential-actions.pgtest, invite-*-core specs, admin-web UsersRoles / Tenants tests, verify-super-admin-platform (75 passed) | **PASS after the Oct 28 fixes, verify V-28** (re-audit found a Support Mode unmask without step-up or salon approval and four sensitive routes without step-up — fixed) |
| Audit logging | check:audit-writers, audit wiring gate, system-reset-hardening (real audit writer) | **PASS** |
| Security alerting | security-events.pgtest (catalog = database CHECK, after migration 686) | **PASS**; delivery to a pager **REQUIRES KEVIN** |
| Database network security | network-posture-db.vitest.spec (role posture + TLS for every *DATABASE_URL) | **PASS** in code; private DB + least-privilege roles **REQUIRES KEVIN** |
| Backup encryption | Railway-managed | **REQUIRES KEVIN** to confirm |
| Restore test | drill-restore 12/12 (above) | **PASS** (local); a production-scale restore with production keys **REQUIRES KEVIN** |
| CI/CD security | SHA-pinned actions, least-privilege tokens, gated publish | **PASS** (config); branch protection **REQUIRES KEVIN** |
| SAST | CodeQL workflow added | **NOT_TESTED** — runs on GitHub after the push (nothing is pushed before the K-12 rewrite) |
| SCA | `security:deps` (every push / PR) + dependency-review | **PASS** locally; dependency-review **NOT_TESTED** until pushed |
| Secret scanning (history) | gitleaks job added | **NOT_TESTED** here (no Docker); runs on GitHub |
| Container scanning | Trivy in build-image.yml | **NOT_TESTED** here (no Docker); unchanged, runs in CI |
| Penetration test | — | **BLOCKED_EXTERNAL** (needs staging + an outside tester) |

## 3. What was NOT tested and why
- Anything that needs the GitHub runners (CodeQL, gitleaks, dependency-review, Trivy, the Android build): nothing is pushed before Kevin's K-12 sequence.
- Real providers (CardPointe UAT, Clover, Twilio, SendGrid, FCM / APNs, Fiserv CommerceHub): fakes / not-configured paths only.
- Staging-level injection / SSRF / XSS testing and a penetration test: no staging environment exists (the local dynamic pass in §4 ran against the built API).
- iOS builds: no macOS in this environment.

## 4. §163 local dynamic injection pass (Oct 27 2026)

**Command** (local only — it creates a proof salon `live-inj-*` and removes it afterwards; never point it at production):

```
npm run build   # API + modules + packages
cd apps/api && TZ=UTC DATABASE_URL=postgres://postgres:postgres@localhost:5432/<scratch db> \
  INJ_JSON=inj.json INJ_STDERR=inj-stderr.log node scripts/live-injection-pass.mjs
```

**Scope:** the manifest's routes (the same collector as the OpenAPI gate) that a test salon can reach — salon staff as the
OWNER, public routes without a session, the platform realm as a Super Admin of the local DB: 2,422 routes (1,234 with a body,
604 with query parameters, 1,380 with path parameters). Payload families: SQLi (`' OR '1'='1`, `1;DROP TABLE users--`,
`' UNION SELECT NULL--`, trailing `\`, `%' --`), XSS (`<script>`, `"><img onerror>`), traversal (`../../../../etc/passwd`,
encoded), header (CR/LF + `X-Injected`), template (`{{7*7}}`, `${7*7}`, `#{7*7}`, `<%= 7*7 %>`) — into every body field (all
fields, then string fields only with the rest type-correct), every query parameter and every path parameter. A response
fails on: 5xx, database error text in the body, raw markup reflected as `text/html`, an injected header, `/etc/passwd`
content, or `49zq` (template evaluation).

| Run | Requests | Failing responses | SQL error text | HTML reflection / header / traversal / template | Unique route × location |
|---|---|---|---|---|---|
| 1 (before the fix) | 22,250 | 196 | 70 (14 routes) | 0 / 0 / 0 / 0 | 37 on 34 routes |
| 2 (after the fix) | 22,250 | 84 (all 5xx) | **0** | **0 / 0 / 0 / 0** | 16 on 13 routes |
| 3 (after the 13-route fixes, eca99938 — run on 2fa57469, fresh database migrated through 702) | 22,250 | **0** | **0** | **0 / 0 / 0 / 0** | **0** |

Per family, run 2: sqli 610 × 2xx / 3,820 × 4xx / 20 fail · xss 582 / 3,854 / 14 · traversal 583 / 3,853 / 14 · header
582 / 3,853 / 15 · template 611 / 3,818 / 21. No payload changed a query's meaning anywhere (no 2xx returned other rows, no
injected header, no evaluation); every failure is an unhandled validation case.

**Fix made in this pass** (`packages/observability/src/request-telemetry.ts`, `request-telemetry.test.ts`): the platform
exception filter maps every PostgreSQL class-22 data exception (invalid uuid / date / integer text, out of range …) to
**400 `INVALID_INPUT`** "A value in this request is not valid.", also when a handler wrapped it in an `HttpException` 5xx,
and scrubs database error text from any `HttpException` body before it reaches the client. That removed all 70
SQL-error-text responses and 21 routes' 5xx (e.g. the receptionist `…/:id` routes, `/tech/manager-messages/:id/resolve`).

**Run 3 (Oct 27 2026, final pass) — 0 failing responses.** Per family: sqli 608 × 2xx / 3,842 × 4xx · xss 580 / 3,870 ·
traversal 581 / 3,869 · header 580 / 3,870 · template 609 / 3,841 — no 5xx, no database text, no reflection, no injected
header, no traversal content, no template evaluation. The 13 routes below were fixed in eca99938, each with a test naming the
hostile value the pass sent (modules/ai/src/malformed-input-4xx.vitest.spec.ts, packages/database state-machine.test.ts
`canMoveToSql`, upsell-feedback-400, reminders-400, membership-set-409, expense.pgtest "unknown vendor",
modules/super-admin/src/malformed-input-4xx.vitest.spec.ts, connect-google-400, category-status-400).

**Findings of run 2, all FIXED in eca99938** (each was a 5xx on malformed input — no injection, no data leak; the client saw the
generic `INTERNAL_ERROR` envelope):

| Route | Root cause (server log) | Owner | Expected |
|---|---|---|---|
| `PATCH /tenant/ai/control-modes/:assistantKey` | `Error('unknown_assistant')` in `AiGovernanceService.setMode` | modules/ai | 404 / 400 |
| `POST /pos/ai-money-protection/investigations` | CHECK constraint violation (`money_protection_investigations`) — an enum not validated before insert | modules/ai | 400 (schema enum) |
| `POST /pos/ai-review-reputation/sync` | 502 `SERVICE_UNAVAILABLE` (provider not configured locally) | modules/ai | acceptable locally; confirm the hostile body never reaches the provider call |
| `POST /pos/ai-review-reputation/:id/recovery` | `HttpException` 500 from the controller's `run` wrapper | modules/ai | 404 / 400 |
| `POST /tenant/ai/call-intelligence/events` | `canMoveToSql(call_intelligence_event)`: an unknown state string reached the state machine | modules/ai | 400 (schema enum) |
| `PATCH /pos/services/categories/:categoryId` | `canMoveToSql(service_category)`: unknown state string | modules/catalog (services) | 400 (schema enum) |
| `POST /pos/ai-checkout-upsell/checkout/:checkoutId/feedback` | `HttpException('INTERNAL_ERROR')` from the controller wrapper | modules/checkout | 404 / 400 |
| `PATCH /pos/reminders` | `ValidationError('ladder must have 1–5 rungs')` not mapped to 400 | modules/communications | 400 |
| `PATCH /pos/customers/:customerId/membership` | plain `Error` ("Membership is enrolled through the memberships module…") | modules/customers | 409 / 400 |
| `POST /owner/finance/expense-rules` | foreign-key violation (`expense_category_rules` vendor) — the referenced id is not checked first | modules/finance | 400 / 404 |
| `GET /super-admin/ai-reports/runs/:runId/narrative` | `HttpException('Report run not found')` thrown with status 500 | modules/super-admin | 404 |
| `GET /super-admin/tenants/:id/payment-gateway` | `ProcessorError` wrapping an invalid-uuid read in `payment-gateway.resolver` | modules/payments | 400 / 404 |
| `POST /pos/settings/online-google-ai-booking/connect-google` | plain `Error('Google Reserve link must be a valid URL')` | modules/tenants | 400 |

The pass is not yet a CI gate (it needs the built API, a database and ~10 minutes on 2 cores); it is the §163 evidence and the
regression command for the table above.
