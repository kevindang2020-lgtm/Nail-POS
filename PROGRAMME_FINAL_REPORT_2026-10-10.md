# AIPowerSalon — Build programme final report (Oct 10 2026)

The programme in `BUILD_PLAN_2026-10-06.md` — 15 phases to take every partial module spec and constitution found by the
Oct 6 audit (`docs/audit-2026-10-06/`) to complete — is **finished on the code side**. Per-phase detail:
`BUILD_PHASES_REPORT.md`; per-line DoD status: `docs/PROGRAMME_DOD_STATUS.md` (reproduce with
`node apps/api/scripts/programme-dod.mjs`); developer entry point: `START-HERE.md`; hosting steps: `docs/HOSTING_ACTIONS_FOR_KEVIN.md`.

## 1. The fifteen phases
| Phase | Closed | Commit |
|---|---|---|
| 1 | The 20-document audit, the plan, and the cross-cutting production bugs (audit calls dropped, empty-string branch ids, pool / shutdown / timeouts, role minting, token refresh re-derives role) | 2f29157d |
| 2 | Shared foundations: one Postgres job queue, single-owner schedulers, tenant messenger (SMS / email / push ledger + events), one circuit breaker | 9f82c518 |
| 3 | Customer phone-number management | 29deb261 |
| 4 | Booking phone verification — all three remote channels book verified | fd6ece86 |
| 5 | Deals engine — one domain, no oversell, deal-aware refunds | 9fa42a64 |
| 6 | AI queue assignment — one engine, assignments through the queue | ac1cbbc7 |
| 7 | AI scheduling optimizer — reviewed, customer-approved, applied | 0a2cca7e |
| 8 | Tenant safety community — drafted, approved, moderated, published, in a real browser | eee1bb6c |
| 9 | C2 Permissions & Authorization | dadb0c15 |
| 10 | C1 Database (code side) | 1558aff4 |
| 11 | C4 Infrastructure (code side) | a48bc1f1 |
| — | 23-inch dual-screen display spec re-verified complete | 9474d278 |
| 12 | C5 API | a025f5d9 |
| 13 | C6 Mobile (code side) | eeb5f3ac |
| 14 | C11 Observability + C12 Security (code side) | 62a1875d |
| 15 | Close-out: events / realtime producers, legacy removal, unique-index review, stale docs, every DoD line, three money-path bugs | (this commit) |

## 2. Where every constitution and spec stands
| # | Constitution / spec | Source of the lines | Lines | DONE | DECIDED | HOSTING | OPEN |
|---|---|---|---|---|---|---|---|
| C1 | Database (§111) | Phase 10 DoD table + Phase 15 unique-index review | 32 rows | 24 | 4 | 4 | 0 |
| C2 | Permissions (§153) | Phase 9 DoD table | 24 rows | 19 | 5 | 0 | 0 |
| C3 | Authentication (§181) | Authentication constitution (Oct 3–4) | complete | all | — | — | 0 |
| C4 | Infrastructure (§201) | Phase 11 DoD table | 16 rows | 15 | 0 | 1 (+ parts of 7 rows) | 0 |
| C5 | API (§231) | `API_DEFINITION_OF_DONE.md` | 57 | 55 | 1 | 1 | 0 |
| C6 | Mobile (§303) | Phase 13 DoD | grouped | all code lines | 3 | Kevin's mobile list | 0 |
| C7 | Super Admin & Control Plane (§303) | `control-plane-dod-check.mjs` | 73 | 71 | 2 | 0 | 0 |
| C8 | Events (§227) | `check:event-producers` gate (Phase 15) | 155 registry events | 155 produced | 3 retired | 0 | 0 |
| C9 | Realtime (§255) | `check:realtime-contract` gate | 102 events | 102 versioned + produced | 0 | 0 | 0 |
| C10 | AI Platform (§304) | `audit-ai-dod.mjs` | 72 | 71 | 0 | 1 | 0 |
| C11 | Observability (§396) | `observability-dod-check.mjs` | 76 | 70 | 0 | 6 | 0 |
| C12 | Security (§324) | `security-dod-check.mjs` | 82 | 71 | 0 | 11 | 0 |
| C13 | Repository & Monorepo (§388) | `REPOSITORY_ARCHITECTURE_AUDIT.md` §9 (Phase 15) | 7 open lines | 6 | 1 | 0 | 0 |
| S1 | Dual-screen display | `DUAL_SCREEN_FINAL_REPORT.md` | complete | all | — | — | 0 |
| S2 | AI queue assignment | Phase 6 completion list | 27 rows | 20 | 5 | 0 | 2 |
| S3 | AI scheduling optimizer | Phase 7 completion list | 17 rows | 13 | 2 | 0 (load → C5) | 2 |
| S4 | Tenant safety community | Phase 8 completion list | 11 rows | 7 | 3 | 1 | 0 |
| S5 | Booking phone verification | Phase 4 completion list | 35 rows | 27 | 8 | 0 | 0 |
| S6 | Customer phone management | Phase 3 DoD (spec lines 1708–1802) | 43 | 41 | 2 | 0 | 0 |
| S7 | Deals engine | Phase 5 completion list | 33 rows | 25 | 8 | 0 | 0 |

"rows" = a phase table row, which often groups several spec lines that share one piece of evidence. A row marked
"DONE / Kevin" in a phase table is counted HOSTING when Kevin's remaining step is a hosting action and DECIDED when it is a
product / data decision with a default in force; "DONE / decided" is counted DECIDED; "DONE / partial" is classified below
on its own merits. For C8 the DECIDED column counts the three events retired by decision.

**Scripted total (C7 + C10 + C11 + C12): 303 lines — 283 DONE · 2 DECIDED · 18 HOSTING · 0 PARTIAL · 0 NOT DONE.**

DONE = built and proven by a test or a live proof. DECIDED = a recorded decision with its default in force (Kevin can
overrule). HOSTING = only Kevin's infrastructure / accounts can close it (exact step in HOSTING_ACTIONS). OPEN = listed in §4.

## 3. How it is proven
- **45 CI gates + 12 audits** run on every change (`node tooling/ci/run-gates.mjs`): permissions on every route, tenant
  scoping, validated bodies, list queries, state machines, the route manifest and API contract, event and realtime producers,
  the realtime catalog, unique-index review, DB ownership, actor stamps, architecture rules, lint ratchet, app types, builds.
- **Final lane run (Oct 10):** API 2,784 passed / 0 failed; 26 module suites, 8 web-app suites, 19 package suites all passed;
  124 Nest-free harnesses; the real-Postgres race lane 244 / 0 on a freshly migrated database (560 migrations); every live proof
  on a booted API (telemetry, cross-salon IDOR, native realtime, app version, offline, async exports, `/api/v1`, deals incl. 120
  registers at once, the dual-screen display set in a real browser, OpenTelemetry tracing, Redis-loss / worker-loss / restore
  drills, database, RLS trial, permissions, refresh authorization, queue, scheduling, community).
- **Mutation checks** in every phase: a deliberate break of each fix must turn a test red (logs in the phase reports).

## 4. Open in code (none is a DoD line; none blocks a pilot salon)
1. Queue assignment: serving-time routing of several technicians for a multi-service / group visit; what-if simulation; a
   browser run of the queue-assignment and scheduling-optimizer screens against the live API.
2. Voice receptionist / Reception Copilot do not place booking holds (a hold is a write — needs a permission decision first).
3. Two simultaneous "first available" bookings may pick the same technician; the second guest gets an honest "taken" and picks again.
4. Ticket statuses are cached per API process: with two replicas, one POS board can show a terminal-paid ticket's old
   status until it reloads (money, events and the paid check are correct).
5. Webhook dispatcher for outgoing partner webhooks has no scheduler (`processDue` is triggered by `POST …/process`).
6. The original spec texts for five module specs were not in the workspace; those phases were checked against the Oct 6
   audits. Send the spec texts and they will be checked line by line.

## 5. What only Kevin can do
### Before the first paying salon

#### Security (do these first — no code change can close them)
1. **E2** Rotate the external database password and close port 5432 to the internet (the old login is in git history).
2. **E3** Re-key the three committed Android upload keystores via Play App Signing (new upload keys made outside the
   repo), then delete the six files (`*.jks` + `key.properties`) and purge them from history — one history rewrite together with E2.
3. **A13** GitHub secret scanning + push protection ON; rotate any credential ever committed or pasted in a chat.
4. **B4** Postgres private: `DATABASE_URL` on the `*.railway.internal` host, public TCP proxy OFF (also C12 "Database private").
5. **D1** Least-privilege database logins: run `apps/api/scripts/db-provision-roles.mjs` (dry run, then real) as the owner;
   set `MIGRATE_DATABASE_URL` (owner), `DATABASE_URL` (`aps_api`), `PG_WORKER_DATABASE_URL` (`aps_worker`).
6. **A7** TLS: custom domains HTTPS-only (Cloudflare "Full (strict)" if proxied). **A8** WAF: Cloudflare proxy + managed rules.
7. **D2** ClamAV service (`CLAMAV_HOST`, later `CLAMAV_REQUIRED=1`); **A11** GuardDuty malware protection on the evidence bucket.
8. **D7** Independent human penetration test of staging (web, API, four apps).
9. Confirm the Clover signature-return behaviour on a real device (open since Oct 6).

#### Data safety
10. **A1** Railway scheduled backups; **A2** PITR on the plan (or accept RPO 24 h in writing); **A3** restore a REAL backup into
    a scratch DB with `restore-verify` (quarterly after that); **A4** copy every encryption key out of Railway into a sealed
    offline record; **A5** weekly off-site encrypted dump; **D6** schedule `deploy/backup/backup-and-report.sh` then
    `BACKUP_REPORTS_REQUIRED=1`; **D9** confirm backup encryption at rest, Railway members = named people with 2FA.
11. On the production database after the first deploy of this tree: run once `db-backfill-summaries.mjs`,
    `db-backfill-customer-identity.mjs`, and `seal-bank-webhook-secrets.mjs` if migration 542 deferred (Phase 10).

#### Environments, storage, providers
12. **A9** staging environment (separate data, separate provider keys). **A10** media + evidence buckets private,
    encrypted, versioned; `MEDIA_STORE=s3`, `EVIDENCE_S3_BUCKET` set (the safety-community evidence upload answers 503
    until then). **A12** apply `deploy/storage-lifecycle.json`.
13. Provider values on Railway: `TWILIO_*`, `SENDGRID_API_KEY`, the encryption keys; re-save each salon's provider
    credentials through the app after keys are set.
14. First real Twilio Verify check at the pilot salon (phone change + booking verification were proved against a loopback
    Verify only — Phases 3–4).

#### Running it
15. **A6** external uptime monitor on `/health/ready` + alert variables; **D5** on-call contacts in Super Admin, plus
    `PUBLIC_API_BASE_URL` and `ALERT_ACK_SECRET`.
16. **A14** cost alerts (Railway, AWS, Twilio, AI providers); enter AI / SMS unit prices in Super Admin (cost views).

#### Mobile (only if the apps ship at launch)
17. iOS: Apple Developer account + a Mac — App IDs with Push + Associated Domains, APNs `.p8` (`APNS_*`), `APPLE_TEAM_ID`,
    entitlements, Tap to Pay plugin. Android: Play Console, new upload keys (E3), `google-services.json` ×4 on the build
    machine, `FCM_SERVICE_ACCOUNT_JSON`, `ANDROID_CERT_SHA256_*`, `APP_LINK_WEB_*`. One run of `.github/workflows/mobile.yml`.
18. **D8** real-device checks (sign-in, Face ID then `FACE_ID_ENABLED=1`, offline queue, push, links, camera, Tap to Pay);
    store URLs + minimum versions in Super Admin.

### Later (scale, observability, decisions that already have a default)

#### Scale / hosting
19. **B1** Redis (`REDIS_URL`, `CACHE_STORE=redis`); **B2** replicas ≥ 2 with `API_REPLICAS`; **B3** the worker service
    (`railway.worker.json`, runbook `worker-split`); **B5** shared variables, least privilege per service; PgBouncer.
20. **C1** CD environment gate (off by default) + pin actions; **C2** Railway config is the IaC of record (decision — no action).
21. **C3** `/metrics` scraper with `METRICS_TOKEN`; **C4** OTLP backend (`OTEL_EXPORTER_OTLP_ENDPOINT` / `_HEADERS`) — optional,
    in-platform trace search already works.
22. **C5** staging load test at 50 clients on the production plan (closes C4 / C5 #53 / C10 / C11 load lines); **E1** AI
    provider concurrency test on staging with real keys and spend caps.
23. **D3** designate a synthetic test salon; **D4** CardPointe UAT + Twilio test credentials for the sandbox probes.
24. **C6** the SPOF table in `DISASTER_RECOVERY.md` §5 is closed by A2/A4/A5/A6/B1/B2.
25. SLO validation needs nothing but production traffic (28 days / 1,000 requests by default).

#### Switches to flip after a trial
26. `DB_TENANT_RLS=1` — staging trial first, then production (RLS on 10 core tables proven live, off by default).
27. `FEATURE_ENTITLEMENT_ENFORCEMENT=enforce` — after reviewing `apps/api/scripts/feature-gate-preview.mjs` on production data.
28. Drop the frozen legacy deal tables one release after production shows no writer (Phase 5).

#### Product / data decisions (a default is in force; act only if you disagree)
29. Phone-column encryption (default: not encrypted); which customer identity root wins (default: linked by phone, not
    merged); cross-salon staff; purging soft-deleted customers (default: not purged).
30. Permissions (Phase 9 defaults): staff confined by branch as built; one role template per person; per-salon approval
    thresholds = today's env values; payment-device approval owner-only; managers keep `inventory.cost.view`.
31. Events (Phase 15 default taken): `visit.started`, `checkout.started`, `payment.authorized` retired; `settings_updated`
    originates from the tenant settings save.
32. Deals: a two-person approval rule for salon deals (default: none — `marketing.manage` holders create and approve);
    BOGO / buy-X-get-Y / bundles-as-deals / gift-with-purchase not built.
33. Queue assignment: late arrival is alerted but does not change ranking; preference levels / language / accessibility
    matching not built (no data for them).
34. Mobile: feature-folder restructure (not done), crash vendor (none), one bundle-id prefix, whether Manager Pay stays a
    fourth app.
35. Control plane: `/platform/*` stays an alias of `/super-admin/*` (D1); the admin app stays one app (D8).
36. Partitioning: decide from real row counts once production has them.
37. The original spec checklists for booking verification (50 items), deals (71), queue assignment (~60), scheduling
    optimizer (~70) and safety community (34) are not in the workspace — the phases checked against the Oct 6 audits instead.
    If you have the spec texts, send them and they will be checked line by line.
38. Repository: `packageManager` stays unpinned in the root `package.json` (default; pin only if a host needs it).
