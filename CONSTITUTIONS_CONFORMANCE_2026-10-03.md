# The thirteen constitutions vs this repository — conformance check, Oct 3 2026

> **Superseded Oct 10 2026 (BUILD_PLAN Phase 15 doc check).** This was the Oct 3 answer and is kept as written. Its
> headline — "Constitutions 1–6 are NOT in this repository" — is **no longer true**: Constitution 3 was re-applied here
> Oct 3–4 (`AUTHENTICATION_AUDIT.md`), and Constitutions 2, 1, 4, 5 and 6 were completed in this repository by BUILD_PLAN
> Phases 9, 10, 11, 12 and 13 (`BUILD_PHASES_REPORT.md`). The current per-constitution verdict is
> `CONSTITUTIONS_STATUS_2026-10-08.md` (updated through Phase 14) and, after Phase 15, `docs/PROGRAMME_DOD_STATUS.md`.
> Spot checks of this file's "Absent" lists against the code on Oct 10 — all now present:
> `apps/api/scripts/db-preflight.mjs`, the actor-stamp plugin and its gate (`check:actor-stamp`), the retention executor
> (`RETENTION_EXECUTOR`, `apps/api/db/retention-policy.json`); the approvals engine
> (`modules/workforce/src/approvals/approvals.controller.ts`); refresh tokens and trusted devices (migrations 494, 496,
> 499), service tokens (`SERVICE_TOKEN_SECRET`); the Postgres job queue (`apps/api/src/jobs/job-worker.ts`), tracing +
> OTLP exporter, break-glass maintenance, `DISASTER_RECOVERY.md`, CI workflows (`.github/workflows/`); the error registry
> (`packages/api-contracts/src/errors.ts`), `api_idempotency` (502) + `@Idempotent()`, OpenAPI + `check:openapi`, the
> `/api/v1` alias with deprecation headers. Mobile: `packages/mobile-core` was NOT created — Phase 13 extended
> `packages/mobile-sdk` instead (`network/`, `push/`, `config/`, `query/`, `telemetry/`, `i18n/`), by decision.
> Other corrections: `EVENT_PUBLISHER_ENABLED` unset now means ON in production (Kevin's decision, Oct 3 —
> `packages/config/src/events-flags.ts`), so "confirm the flag" is closed; Observability and Security (§11, §12 here) are
> complete on the code side since Phase 14, with the rest in `docs/HOSTING_ACTIONS_FOR_KEVIN.md`. The Events / Realtime
> producer items (§8, §9) are BUILD_PLAN Phase 15 work — see `EVENT_ARCHITECTURE_AUDIT.md` / `REALTIME_ARCHITECTURE_AUDIT.md`
> for their final state. The "What this means, in order" list at the end is fully carried out.


Kevin re-uploaded all thirteen Architecture Constitutions and asked whether everything in them has been built and wired,
and what the gaps and bugs are. This is the answer for THIS repository (the tree in `AIPowerSalon-repo.bundle`, HEAD at
the commit that adds this file).

## How this was checked

- The uploads were matched to the texts each arc was built against by section count (112 / 154 / 181 / 202 / 232 /
  304 / 304 / 227 / 255 / 305 / 397 / 325 / 389 — all identical to the records).
- For each constitution: its key artifacts were looked for by file name AND by content (routes, env names, table names,
  headers), its Definition-of-Done script was run where one exists (`control-plane-dod-check.mjs`, `audit-ai-dod.mjs`,
  `observability-dod-check.mjs`, `security-dod-check.mjs --run`), and its live enforcement was run (the 25 gates,
  `architecture:test`, `audit-realtime-contract.mjs`, `audit-realtime-pushes.mjs`, the event producer count).
- The previous audits are the source for section-by-section detail: `CONTROL_PLANE_AUDIT.md`,
  `EVENT_ARCHITECTURE_REPORT.md`, `REALTIME_ARCHITECTURE_REPORT.md`, `AI_PLATFORM_AUDIT.md`, `OBSERVABILITY_AUDIT.md`,
  `SECURITY_AUDIT.md`, `REPOSITORY_ARCHITECTURE_AUDIT.md`. This file consolidates status and adds what is new since.

## The headline

**Seven of the thirteen are built into this repository (Constitutions 7–13). Six are not (Constitutions 1–6).**

Constitutions 1–6 (Database, Permissions, Authentication, Infrastructure, API, Mobile) were built in September 2026 in
their own sessions, on a different copy of the code, and delivered as patch bundles. The developer's tree uploaded on
Sep 28 — from which this repository descends — did not carry them, and the bundles were never applied here. Content
checks confirm their defining pieces are absent (see each section). Some of their IDEAS were rebuilt independently by
later arcs (version columns and row-level security from the Security/Repository arcs, role templates from Functional
Decision 12, step-up decorators from the Security arc, the shared `mobile-sdk` from the Repository arc), so the table
below says exactly what exists.

| # | Constitution | In this repo | Status | Verified today |
|---|---|---|---|---|
| 1 | Database | **partly** — ideas rebuilt later; the arc's own pieces absent | see §1 | migrations 493 apply fresh; schema matches the code |
| 2 | Permissions | **partly** — base roles + Decision-12 role templates; the arc's approvals/registry absent | see §2 | permission gates pass |
| 3 | Authentication | **no** — realms, refresh rotation, recovery codes, trusted devices, step-up service, service tokens, API keys, OAuth, risk: absent | see §3 | — |
| 4 | Infrastructure | **no** — jobs queue, Redis degrade, circuit-breaker module, maintenance switches, secrets loader, tracing, Terraform, CI workflow: absent | see §4 | — |
| 5 | API | **no** — error registry, global envelope, request context, idempotency store, ETag, cursors, OpenAPI, /api/v1: absent | see §5 | — |
| 6 | Mobile | **partly** — `packages/mobile-sdk` exists (Constitution 13); `packages/mobile-core` and phases 8–20 absent | see §6 | — |
| 7 | Control plane | yes | 71 done · 2 partial · 0 not done of 73 | DoD script, Oct 3 |
| 8 | Events | yes | built through the build order; 9 events without a producer; 8 direct pushes | producer count + push audit, Oct 3 |
| 9 | Realtime | yes | built; 1 event without a producer | contract gate, Oct 3 |
| 10 | AI platform | yes | 71 done · 1 partial · 0 not done of 72 | DoD script, Oct 3 |
| 11 | Observability | yes, paused | 50 done · 16 partial · 10 not done of 76 | DoD script, Oct 3 |
| 12 | Security | yes, paused | 58 done · 20 partial · 4 not done of 82 (after one stale predicate was fixed) | DoD script, Oct 3 |
| 13 | Repository | yes, paused at Phase 12 | architecture tests green after today's fixes | `architecture:test`, Oct 3 |

## Bugs found and fixed during this check (commits `cdfde12` and the one adding this file)

1. **The architecture tests were not in the gate runner.** `tooling/ci/run-gates.mjs` ran 25 gates + 3 audits but never
   `architecture:test`, so three days of Functional-Decisions work slipped past Constitution 13's rules: six POS types
   re-declared API types (gift-card report ×3, loyalty rewards ×2, and a name collision on `DraftKind`), and one new
   database test located migrations by a relative path that resolves nowhere from a module (the file was silently
   skipped). All fixed — the types live in `@aipowersalon/api-contracts` and are imported by server and POS; the test
   uses `MIGRATIONS_DIR`; the runner now runs the architecture tests as its 4th audit.
2. **A stale Security DoD predicate** reported "CORS restricted: evidence missing" though CORS is restricted through the
   shared allow-list from Constitution 9 (`isOriginAllowed`). Predicate updated; the check reports DONE.
3. Earlier the same day (Constitution 12's logging rule): customer sign-in wrote the whole identity record — including
   its password hash — to the server log on every sign-in; and a second debug line on the Super Admin path. Removed.

## Section by section

### 1 — Database (112 sections) — partly
- **Built here (by later arcs or the developer):** version columns on 52 tables with `expectedVersion` writes (API arc's
  ETag was to sit on them); Postgres row-level security on customers behind `DB_TENANT_RLS` (Repository arc); the
  appointment no-overlap exclusion constraint (migrations 426/482); the event outbox tables (Constitution 8);
  loyalty earn ledger (`loyalty_point_earnings`, Constitution 8).
- **Absent (the arc's own deliverables):** `db-preflight.mjs` + `backfill-identity.mjs` (the two-identity-root bridge),
  the actor-stamp plugin and its gate, the retention executor, the webhook replay claim table, `normalizeClockTime` +
  the start_time CHECK, the Twilio SID dedup, the 74 tenant-leading indexes (migration "460" of that arc).
- **Still open from that arc, on Kevin's side:** column-level phone encryption decision; whether non-technician staff
  work across unrelated salons; running pre-flights/backfills against production data; off-primary backups and a
  production restore test; partitioning needs production row counts.
- **Note:** this repository has TWO customer identity roots (`customer_identities`, mig 366 = login; `global_customers`,
  mig 421 = identity). Sign-in uses the first; registration links to the second. The bridge that arc built is absent.

### 2 — Permissions (154 sections) — partly
- **Built here:** the 7 base roles and permission catalog (`packages/permissions`); per-route `@RequirePermission`
  with the global guards; Functional Decision 12's role TEMPLATES (10 decided roles, owner custom roles narrowing a base
  role, scopes on `user_branch_access`, "Roles & Permissions" screen); branch-scoped guards; the DIRECT_GRANT_ONLY
  pattern for critical keys.
- **Absent:** the arc's approvals engine and screen (`approvals.controller.ts`, policy thresholds, `approvals.*` keys),
  the 646-key generated registry and its generator, the per-route declaration ratchet ("894/909 routes declared").
- **Open decisions from that arc:** who approves payment devices (platform vs tenant owner); whether MANAGER defaults
  get `inventory.cost.view`.

### 3 — Authentication (181 sections) — not in this repository
- **Absent:** realm/aud/iss claims and one cookie per realm; refresh-token rotation with reuse detection; MFA recovery
  codes service (the developer tree has its own `469_mfa_recovery_tokens`); trusted devices (`auth_devices`); step-up
  SERVICE and `auth_events` (a `RequireStepUp` decorator does exist from the Security arc — it is not this one);
  service principals / `SERVICE_TOKEN_SECRET`; tenant API keys with rotation overlap and usage ledger; OAuth server;
  risk scoring; security notifications ("this wasn't me"); tenant auth policy (`mfaForOwner` enforcement); the
  booking-session token; the customer Devices card.
- **What exists instead:** one session cookie across realms, 12-hour access tokens, scrypt passwords, TOTP, WebAuthn,
  session rows with revocation, Decision 35's server-side idle lock, the platform-token audience cut-over of Oct 2.
- **Consequence:** sign-in security here is the pre-constitution model. This is the most consequential of the six
  missing arcs and should be the first re-applied.

### 4 — Infrastructure (202 sections) — not in this repository
- **Absent:** the Postgres jobs queue + `JobWorker` classes (`WORKER_CLASSES`), `redisSafe` degradation, the shared
  `circuit-breaker.ts` + `withDeadline`, per-module maintenance (`MAINTENANCE_MODE`, kill switches), `secrets-loader.ts`,
  distributed tracing (`traceparent`), `/metrics` as built there, the Terraform topology/alarms/WAF/Redis HA, the CI
  workflow, the drills and `DISASTER_RECOVERY.md`.
- **What exists instead:** the outbox publisher and 21 env-gated schedulers (Constitutions 8/11), circuit breakers
  inside the AI platform (Constitution 10), `railway.json`, the Observability arc's probes and System Health screen,
  the Security arc's `SECURITY_DR.md`.

### 5 — API (232 sections) — not in this repository
- **Absent:** `error-registry.ts` + the global exception filter and §28 envelope, `request-context.ts` (a different
  `request-context.ts` exists in `packages/observability` — correlation, not the API arc's), the `api_idempotency`
  store + `@Idempotent()`, ETag/If-Match, keyset cursors, OpenAPI generation + `check:openapi`, the `/api/v1` alias with
  deprecation headers, `packages/api-contract/errors.ts`, the contract/realm tests.
- **What exists instead:** per-controller error shapes (`{ok:false,…}` in many, Nest defaults elsewhere), offset
  pagination with a clamp, body-level idempotency keys for payment attempts only, `packages/api-contracts` (types only,
  from Constitution 13).

### 6 — Mobile (304 sections) — partly
- **Built here:** `packages/mobile-sdk` (Constitution 13's consolidation: biometrics, secure store, native auth,
  injected API client) consumed by the Capacitor apps; realtime client package in 5 of 6 apps (Constitution 9).
- **Absent:** `packages/mobile-core` (networking policy, realtime backoff policy, app version, push sign-out revoke,
  single-flight auth refresh — the auth refresh has nothing to refresh here); phases 8, 10, 12–18, 20 (server-state
  layer, offline, device services, feature flags, per-app modules, observability, CI/CD, testing) were never built in
  either tree. Decision 33's offline work (read cache, drafts, offline open) is the POS, not the Capacitor apps.

### 7 — Super Admin & Control Plane (304 sections) — built here
- DoD today: **71 done · 2 partial · 0 not done** of 73. Partial: the platform API is served as an alias of
  `/super-admin/*`, not a separate mount (decision D1); the Super Admin app is one app of 148 screens, not split.
- Everything else verified by its DoD script, including the 289-scale load harness.

### 8 — Events (227 sections) — built here
- Present and wired: contract + 89-event registry, outbox (433), publisher with fair scheduling, consumer runner,
  dead letters + retry worker, upcasters, replay with preview tokens, retention, Super Admin ops, consumers
  (realtime projection, push, loyalty, analytics, AI usage, live ops).
- **Producers:** 83 of 89 registered events have a producer (`coupon.redeemed`, `inventory.adjusted` and
  `inventory.low_stock` were wired on Oct 3, each with a real-Postgres test). **Three have no distinct fact in this
  system and should be retired from the registry rather than given producers:** `visit.started` (duplicates
  `service.started`), `checkout.started` (tickets are created by the queue and technician flows, which emit their own
  events, and `ticket.ready_for_checkout` exists), `payment.authorized` (payments capture immediately; there is no
  separate authorization step). **Three need a tenant-aware send facade first:** `communication.sms_sent`,
  `communication.sms_delivery_failed`, `communication.push_sent` — every SMS goes straight to the `SmsSender` port from
  receipts, reminders, follow-ups and verification, and only verification sends reach a per-tenant ledger, so a producer
  there would mislead consumers.
- **Direct realtime pushes:** 51 retired behind the event path, **8 remain** (booking update announce; checkout
  payment-processing-started / total-recalculated / receipt paths; end-of-day rebook; tenant status; tech-profile
  fan-out) — each a deliberate Constitution-9 producer or a case with no past-tense fact to emit.
- **Operational dependency:** the publisher ticks only when `EVENT_PUBLISHER_ENABLED` is set. If it is unset in the
  deployment, every event-driven path (push on queue assignment, loyalty earn, analytics rollup, AI usage ledger, the
  realtime projection) is silent while the direct pushes that were retired no longer fire. **Confirm the flag.**

### 9 — Realtime (255 sections) — built here
- Present: one gateway factory for all 7 SSE endpoints, per-room sequence numbers + resync, authz revalidation,
  slow-client gate, origin check, connect limiter, presence, health, shared client package in 5 of 6 Capacitor apps,
  support-mode scoping, graceful drain, 77-event contract with versions and screen routing.
- Contract gate today: no duplicates, every event versioned and routed, client copy identical, no off-registry emission.
  **One event still has no producer: `settings_updated`** (needs a decision on where the fact occurs).
- Deliberately not built: WebSocket (SSE preserved by decision), per-event payload versioning (additive frames).

### 10 — AI platform (305 sections) — built here
- DoD today: **71 done · 1 partial · 0 not done** of 72. Partial: no concurrency load test against a real provider.
- Present and wired: one entry point, task/model/prompt/tool registries, router with failover, output schemas with
  one repair, context builder with redaction, safety engine, budgets + fair scheduler, evaluations, knowledge (Postgres
  full-text, no vector DB), pricing versions, tenant settings persistence, control-plane and tenant dashboard APIs,
  `check:ai-platform` + `check:ai-infra-duplicates` gates. Every former raw provider caller migrated.
- Known risks (unchanged): 10 synthetic golden cases prove the harness, not model quality; `voice.transcribe` allows one
  provider; free-text redaction is pattern-based.

### 11 — Observability (397 sections) — built here, paused
- DoD today: **50 done · 16 partial · 10 not done** of 76. Not done: request/correlation search and trace/log linking
  (no log or trace store — logs go to stdout); storage metrics and dashboard; mobile and deployment dashboards; branch
  health snapshots; a load harness. Partial: tracing has ids and propagation but no exporter; alert routing reaches
  Super Admins by email only (SMS needs `ONCALL_PHONE`); SLOs proposed, none validated by production data.
- Note: the DoD's "Lint passes — no lint script wired" is stale: `check:lint` has been a gate since Constitution 7.

### 12 — Security (325 sections) — built here, paused
- DoD today: **58 done · 20 partial · 4 not done** of 82. Not done: one database role for API and workers; container
  and infrastructure scanning; lint (stale, as above). Partial items are largely Railway-side (TLS at the edge, private
  network, secrets as Railway variables, WAF at the edge, backups/PITR, a real restore drill) plus the human penetration
  test and real-device mobile testing.
- Left on Kevin's list from the arc: set the seven encryption keys and keep a copy outside Railway, `MEDIA_STORE=s3`,
  deploy, re-save salon credentials, staff reset of old temp passwords, enable PITR, run a restore drill.

### 13 — Repository & monorepo (389 sections) — built here, paused at Phase 12
- Present: 25 modules + 10 foundation packages, workspace builds (packages → modules → API), architecture tests with a
  frozen baseline (cycle 53 → 5, back-edges 15 → 1, identical file groups 14 → 0, mirrored API types 346 → 0),
  workers behind a `PROCESS_ROLE` switch, RLS behind `DB_TENANT_RLS`, write-through-replica fixes.
- **Today:** the architecture tests were not in the gate runner (fixed; see bugs above).
- Waiting on Kevin: staging trial of `DB_TENANT_RLS=1`; the `EVENT_PUBLISHER_ENABLED` decision; optional Railway worker
  split; a read replica is now safe to add. Phase 12 legacy removal was paused.

## What this means, in order

1. **Constitution 3 (Authentication) should be re-applied first.** It is the largest security gap: sign-in here still
   uses one cookie across realms, no refresh rotation, no recovery codes, no trusted devices, no service tokens.
2. **Constitution 5 (API) and 4 (Infrastructure) next** — the global error envelope and the jobs queue are the two
   pieces the most other work would have built on.
3. **Constitutions 1, 2 and 6** fill in behind: their ideas were partly rebuilt by later arcs, so re-applying them is
   a reconciliation, not a fresh build.
4. Re-applying means porting September's bundles onto a tree that has moved on (modules/, packages/, 493 migrations,
   Oct 1–3 work) — each constitution as its own arc with its own audit first, exactly as the standing rule says.
5. Independent of 1–4: set `EVENT_PUBLISHER_ENABLED` in deployment (or decide against it knowingly), the three
   Security-arc Railway actions, and the product decision the Realtime arc is waiting on (`settings_updated` → where
   the fact occurs; `technician_earnings_updated` has a producer now).
