# The thirteen constitutions vs this repository — re-checked after Build Phases 1–6 (Oct 8 2026)

Kevin re-uploaded the thirteen Architecture Constitutions and asked whether the code is a 100% build of them. These are
the same thirteen that `FULL_BUILD_AUDIT_2026-10-06.md` checked two days ago (with the seven module specs — twenty
documents); the phased plan that finishes them is `BUILD_PLAN_2026-10-06.md`, of which Phases 1–6 have landed since
(`BUILD_PHASES_REPORT.md`). This file re-measures every constitution on today's tree (`ac1cbbc7`) so the status is current.

**Short answer: not 100%.** Seven of the thirteen are complete (or complete by a recorded decision); six are partial. Every
remaining code item is already scheduled in Phases 7–15 of the plan; nothing new was found that the plan does not carry.
What cannot be finished from the repository (hosting, accounts, product decisions) is listed at the end, as before.

## How this was re-checked today
- The four Definition-of-Done scripts were run again on this tree: `control-plane-dod-check.mjs` (C7),
  `audit-ai-dod.mjs` (C10), `observability-dod-check.mjs` (C11), `security-dod-check.mjs --run` (C12).
- `audit-realtime-contract.mjs` (C9), `permission-check.mjs` + `unguarded-route-check.mjs` + `check-api-contract.mjs`
  (C2 / C5), the architecture test baseline (C8 producers, C13 lockfiles/cycles), the `modules/ai` suite and the 24-file
  every-push security lane were run; the local Postgres (523 migrations, 685 tables) was queried.
- For C1, C2, C4, C6 the Oct 6 evidence files (`docs/audit-2026-10-06/constitution-0*.md`) were re-read and every bug
  that Phases 1–2 claimed to close was checked in the code (migration 517 for the 450 trigger; `pool.on('error')`; the
  `migrate.mjs` advisory lock; `/auth/refresh` re-deriving authorization; 31 schedulers under the lease coordinator; …).

## Verdict per constitution (today)
| # | Constitution | Oct 6 | **Oct 8** | What changed · what is left · where it is scheduled |
|---|---|---|---|---|
| C1 | Database (112 §) | PARTIAL ~60% | **COMPLETE on the code side (Phase 10, Oct 8 2026)** | §111: every line DONE, decided or Kevin's (`BUILD_PHASES_REPORT.md` Phase 10). All 705 tables classified + gate; runner hardened (pre-flight, no-transaction files, deferral ledger, resumable backfills); 0 tenant tables without a tenant-leading index; core FKs, scoped uniques, 64 status CHECKs; 0 NOT VALID constraints; actor stamps; one loyalty ledger; summaries written; duplicate stores merged; retention executor + policy; per-role pools; RLS on 10 core tables proved live (off by default); Super Admin Database page; EXPLAIN pass; the checkout board bounded. Kevin's: RLS switch-on, PgBouncer, worker login, PITR / backups / restore drill, load on target infrastructure, phone encryption, identity root. |
| C2 | Permissions (154 §) | PARTIAL ~55–60% | **COMPLETE (Phase 9, Oct 8 2026)** | §153: every line DONE or decided (`BUILD_PHASES_REPORT.md` Phase 9). Unkeyed staff routes **0** with default deny ON; one decision object with reason codes; authorization versions checked per request (a demotion stops the next request on the same session — proved live); template scope + salon-side branch access; ALLOW / DENY / temporary overrides; last-owner protection + ownership transfer; one salon approvals engine; access review, high-risk, dormant, denial metrics, worker principals, export snapshots; registry + generated docs; role-name checks 218 → 151, each allowlisted (gate blocks new ones); committed per-role matrix (2,672 routes × 17 principals). Decided: one template per person, field rules per domain, entitlements stay separate (Phase 12). |
| C3 | Authentication (181 §) | COMPLETE | **COMPLETE** | unchanged (re-applied Oct 3–4; refresh re-authorization strengthened in Phase 1) |
| C4 | Infrastructure (202 §) | PARTIAL ~60% / ~25% core | **COMPLETE on the code side (Phase 11, Oct 8 2026)** | §201: every line DONE or HOSTING with the exact action (`docs/HOSTING_ACTIONS_FOR_KEVIN.md`). Tracing + OTLP, `/metrics`, stranded-payment sweep, break-glass, schema version, tenant limiter on, Redis required for multi-instance, non-root image + CI scan + CD (off by default), media bucket/region fix + lifecycle, Terraform legacy + fixed, DR / audit / inventory / diagrams / deployment docs, four drills run (restore, worker loss, Redis loss, DB failover), flag rollouts, quotas, load + cost views, webhook counters, tenant-partitioned schedulers. |
| C5 | API (232 §) | PARTIAL (41/57) | **COMPLETE (Phase 12, Oct 9 2026) — 55/57 + 1 ruling** | §231: only #53 (load at scale on the target infrastructure) is Kevin's. Domain per route, one entitlement guard (observe mode until Kevin enforces), 1,124/1,128 body routes validated, one list syntax on 524/532 list endpoints, 199 state machines (465/471 writes), async contract with 37/37 exports, upload policy 16/16, response-exposure gate, every app on `/api/v1`. |
| C6 | Mobile (304 §) | PARTIAL ~40% | **COMPLETE on the code side (Phase 13, Oct 9 2026)** | §303: every line DONE, decided or Kevin's (iOS / Android builds and signing, Firebase / APNs, real-device checks, Android re-keying). Native realtime via stream tickets, one transport, version + `/app-config` + update gate, TanStack Query + offline cache + exactly-once journal, push in 4/4 apps with no customer names, deep links, Face ID on an OS-protected credential, release security config, telemetry, EN / VI, mobile CI. Honest gaps: 11 of ~146 screens on the query layer, ~5% of strings translated. |
| C7 | Super Admin & Control Plane (304 §) | COMPLETE by decision | **COMPLETE by decision** | script today: §303 **71 DONE · 2 PARTIAL · 0 NOT DONE** (D1 `/platform` alias; one app not split into packages) |
| C8 | Events (227 §) | COMPLETE except 6 producers | **COMPLETE (Phase 15, Oct 10 2026)** | new gate `check:event-producers`: 155 registry events, 155 produced through the outbox, 3 retired by the plan default (`visit.started`, `checkout.started`, `payment.authorized`); `customer.merged` from the duplicate merge, `visit.completed` when a ticket becomes paid; `docs/EVENT_CATALOG.md` generated. |
| C9 | Realtime (255 §) | COMPLETE except 1 producer | **COMPLETE (Phase 15, Oct 10 2026)** | `settings_updated` had producers the gate could not see (a `packages/` helper) — the gate now reads them and NO PRODUCER is a failure; 102 events all produced; the catalog generator fails on any unclassified event (`check:realtime-catalog`). |
| C10 | AI Platform (305 §) | COMPLETE | **COMPLETE** | script today: 71 DONE · 1 HOSTING (provider concurrency load test on staging, HOSTING_ACTIONS E1); the "Tests pass" predicate reads vitest's JSON report (Phase 15). |
| C11 | Observability (397 §) | PARTIAL (50/76) | **COMPLETE on the code side (Phase 14, Oct 9 2026)** | script today: §396 **70 DONE · 6 HOSTING · 0 PARTIAL · 0 NOT DONE**. Log + trace store with request / correlation search and trace↔log linking, telemetry permission split, process / queue / storage metrics, 7 dashboards, branch health, on-call escalation with signed ack links, SLO validation, synthetic probes, backup staleness, security signals → incidents. HOSTING = OTLP backend, synthetic salon + sandbox credentials, on-call contacts, SLO data accrues in production, backup cron, staging load test. |
| C12 | Security (325 §) | PARTIAL, mostly hosting | **COMPLETE on the code side (Phase 14, Oct 9 2026)** | script today: §324 **71 DONE · 11 HOSTING · 0 PARTIAL · 0 NOT DONE** (`--run` green). Least-privilege API / worker logins (script + proof), per-caller code-guessing limit, webhook dedupe per provider (4 real double-processing bugs fixed), support-session expiry guard, AI retrieval caller + prompt-injection evals, ClamAV adapter, IDOR suite 158 routes / 0 leaks. HOSTING = provisioning the logins, clamd, TLS / WAF / private DB + Redis / PITR / restore of a real backup / backup access, independent pen test, real devices. |
| C13 | Repository & Monorepo (389 §) | COMPLETE through Phase 12 start | **COMPLETE (Phase 15, Oct 10 2026)** | §388: 6 DONE · 1 DECIDED (`packageManager` unpinned). Removed under the zero-importer rule: `go-check-in-admin`, `booking-html`, `booking-schedule-html` (each with its wired replacement), `_MERGE_ARTIFACTS/`, `HANDOFF/`, the nested lockfiles; architecture tests fail if any returns. |

Complete: all thirteen — C1, C4, C6, C11, C12 on the code side (hosting steps are Kevin's); C2, C3, C5, C7, C8, C9, C10, C13. Partial: none. Programme total: `PROGRAMME_FINAL_REPORT_2026-10-10.md`, `docs/PROGRAMME_DOD_STATUS.md`.

## The seven module specs (for completeness — the other seven of the twenty)
S1 display COMPLETE · S6 phone management **DONE Phase 3** · S5 booking verification **DONE Phase 4** · S7 deals
**DONE Phase 5** · S2 queue assignment **DONE Phase 6** · S3 scheduling optimizer **DONE Phase 7** · S4 safety community **DONE Phase 8**.

## The plan from here (unchanged in scope; the order stands)
| Phase | Closes | Size (est.) |
|---|---|---|
| **7** | `ai_scheduling_optimizer` spec (S3) | large — like Phase 6 |
| **8** | `tenant_safety_community` spec (S4) | large |
| **9** | C2 Permissions — **DONE Oct 8 2026** | large (324 routes + 66 checks are the long tail) |
| **10** | C1 Database — **DONE Oct 8 2026** | medium–large (migrations with pre-flights) |
| **11** | C4 Infrastructure (code side) — **DONE Oct 8 2026** | medium |
| **12** | C5 API — **DONE Oct 9 2026** | medium |
| **13** | C6 Mobile (code side) — **DONE Oct 9 2026** | large |
| **14** | C11 Observability + C12 Security (code side) — **DONE Oct 9 2026** | medium |
| **15** | Close-out: C8 / C9 producers, C13 legacy removal, stale predicates + docs, final report — **DONE Oct 10 2026** | small–medium |

Each phase runs as before (failing test first, mutation checks, every lane, live proof, docs, commit, bundle) with the
Phase 6 lessons applied: a tighter agent contract with the exact shapes between parts, the live proof before the full
lane run, one full lane run at the end, at most three agents on this 2-core workspace.

## What only Kevin can do (unchanged from Oct 6)
Hosting: host of record; Postgres backups + PITR + a restore drill; Redis HA; WAF/CDN; staging; replicas ≥ 2 + the
worker service; CD gating; uptime monitor + on-call contacts; keys outside Railway; `MEDIA_STORE=s3`; load test on real
infrastructure; the encryption keys; re-save salon credentials. Mobile: Apple Developer account + Mac, FCM/APNs,
AASA/assetlinks hosting, Play Console, bundle-id prefix, crash vendor, whether manager-pay stays a fourth app.
Data / product decisions: phone-column encryption; cross-salon staff; which customer identity root wins; RLS staging
trial; production pre-flights/backfills; partition row counts; staff confined to the home branch; one template or several
roles; per-salon refund / approval thresholds; where `settings_updated` originates; retire the 3 producer-less events.
Security: rotate the external database password and close port 5432 (the login is in git history — nothing is pushed
until then); Clover signature-return confirmation; the `TWILIO_*` / `SENDGRID_API_KEY` values.
