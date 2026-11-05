# The 20 documents vs this repository — is the build 100% complete? (Oct 6 2026)

Kevin re-uploaded the thirteen Architecture Constitutions and seven module specifications and asked whether the code is a
100% completed build of them — and, if not, for a phased plan that finishes it. This is the answer for the tree at
`7301539f` (branch `work/dual-screen-display`, which contains everything on `master` plus the display Units 1–13).

**Short answer: no.** Six of the twenty are complete (or complete except for decisions / hosting). Fourteen are partial —
several with bugs that stop the feature working in production at all. The plan that finishes them is
`BUILD_PLAN_2026-10-06.md`; it is being executed phase by phase, each phase verified, documented and committed.

## How this was checked
- The four Definition-of-Done scripts were run on this tree today (`control-plane-dod-check.mjs`, `audit-ai-dod.mjs`,
  `observability-dod-check.mjs`, `security-dod-check.mjs --run`); their outputs are kept in `docs/audit-2026-10-06/dod-*.txt`.
- The realtime contract gate (`audit-realtime-contract.mjs`), `check-api-contract.mjs`, `permission-check.mjs` and
  `unguarded-route-check.mjs` were run read-only; the local Postgres 16 (all 512 migration files applied, ledger matching)
  was queried for the database measurements.
- Each of the remaining ten documents (Constitutions 1, 2, 4, 6 and the six module specs) was read in full and every
  requirement traced to code by content search — file and line evidence is in `docs/audit-2026-10-06/*.md`.
- `CONSTITUTIONS_CONFORMANCE_2026-10-03.md` is the previous consolidated check; this file supersedes it. What changed since
  Oct 3: Constitution 3 (Authentication) and Constitution 5 (API) were re-applied onto this tree (Oct 3–5), the real-Postgres
  race lane joined CI, the 23-inch display spec was delivered (Units 1–13, Oct 5–6).

## Verdict per document
| # | Document | Verdict | Measure | Detail |
|---|---|---|---|---|
| C1 | Database (112 §) | **PARTIAL ~60%** | §111: 15 done · 23 partial · 4 missing · 2 Kevin | `docs/audit-2026-10-06/constitution-01-database.md` |
| C2 | Permissions (154 §) | **PARTIAL ~55–60%** | §153: 16 done · 30 partial · 5 missing | `…/constitution-02-permissions.md` |
| C3 | Authentication (181 §) | **COMPLETE** (re-applied Oct 3–4) | §163 build order Steps 1–10d all landed (`AUTHENTICATION_AUDIT.md`, commits 263e7278…2908d88a) | — |
| C4 | Infrastructure (202 §) | **PARTIAL ~60% DoD / ~25% core** | §201: 19 done · 4 not re-run · 40 partial · 9 missing | `…/constitution-04-infrastructure.md` |
| C5 | API (232 §) | **PARTIAL** | §231: 41 done · 2 prior · 8 partial · 5 not done · 1 by ruling of 57 (`API_DEFINITION_OF_DONE.md`); unkeyed staff routes now 324 (was 363) | `API_DEFINITION_OF_DONE.md` |
| C6 | Mobile (304 §) | **PARTIAL ~40%** | §303: 18 done · 15 present-unverified · 27 partial · 14 missing · 2 Kevin | `…/constitution-06-mobile.md` |
| C7 | Super Admin & Control Plane (304 §) | **COMPLETE by decision** | §303: 71 done · 2 partial (D1 `/platform` alias; one app) · 0 not done | `dod-constitution-07-control-plane.txt` |
| C8 | Events (227 §) | **COMPLETE except 6 producers** | 83 of 89 events produced; 3 should be retired (`visit.started`, `checkout.started`, `payment.authorized`), 3 need an SMS/push send facade (`communication.*`) | `CONSTITUTIONS_CONFORMANCE_2026-10-03.md` §8 |
| C9 | Realtime (255 §) | **COMPLETE except 1 producer** | 86 events, all versioned/routed; `settings_updated` has no producer | contract gate today |
| C10 | AI Platform (305 §) | **COMPLETE** | §304: 71 done · 1 partial (provider load test) · 0 not done | `dod-constitution-10-ai-platform.txt` |
| C11 | Observability (397 §) | **PARTIAL** | §396: 50 done · 16 partial · 10 not done of 76 (two predicates stale: lint IS a gate; a load harness now exists) | `dod-constitution-11-observability.txt` |
| C12 | Security (325 §) | **PARTIAL, mostly hosting** | §324: 58 done · 20 partial · 4 not done of 82 (code: worker DB role, container/IaC scan; lint predicate stale) | `dod-constitution-12-security.txt` |
| C13 | Repository & Monorepo (389 §) | **COMPLETE through Phase 12 start** | Phases 1–11 done, Phase 12 (legacy removal) begun then paused; architecture tests green in the gate runner | `REPOSITORY_ARCHITECTURE_AUDIT.md` |
| S1 | 23-inch dual-screen display (131 §) | **COMPLETE** | Units 1–13; `DUAL_SCREEN_FINAL_REPORT.md`, `DUAL_SCREEN_DISPLAY_AUDIT.md` | — |
| S2 | `ai_queue_assignment` | **PARTIAL ~35%** — several features broken in production | requested technician never seen; appointment protection never fires; stuck detection dead; four parallel recommenders | `…/spec-ai-queue-assignment.md` |
| S3 | `ai_scheduling_optimizer` | **PARTIAL ~15–20%** — review path broken | every accept/reject/return answers 409; audit sink calls a method that does not exist; settings PUT is a no-op | `…/spec-ai-scheduling-optimizer.md` |
| S4 | `tenant_safety_community` | **PARTIAL ~30%** — API unusable in production | role map expects lowercase → every tenant user is a "technician" (403); moderator identity undefined; no UI anywhere | `…/spec-tenant-safety-community.md` |
| S5 | `customer_booking_phone_verification` | **PARTIAL ~40%** — 0 of 3 remote channels complete | Verify SID can never be saved; customer app loops on 428; config audits silently dropped | `…/spec-booking-phone-verification.md` |
| S6 | `customer_phone_number_management` | **PARTIAL ~45%** — activation broken | SMS-verified activation always fails (`newPhoneId`); audits dropped; mask written into `phone_display`; login phone can move to an unverified number | `…/spec-customer-phone-management.md` |
| S7 | `deals_engine` | **PARTIAL ~15–20%** — live money bugs | oversell past the cap; receptionists cannot apply deals; stacking order-dependent; five parallel discount stores | `…/spec-deals-engine.md` |

## Cross-cutting findings (the same defect in several places)
1. **Audit calls silently dropped.** `AuditService.record(ctx, input)` takes two arguments; booking verification (settings,
   override, oversight), the customer-phone module and the community module call it with one object (and the scheduling
   optimizer calls a non-existent `.log`). `buildAuditRow` throws, the error is swallowed, `audit as any` hides it from tsc.
   Every configuration change, override and moderation action in those modules leaves no audit trail.
2. **`''` written into UUID columns.** Sessions without a branch produce `branchId ''` that reaches `branch_id UUID` columns
   in booking verification, customer phone, community and queue assignment — the insert fails after the SMS was already
   billed, or returns a phantom row.
3. **Infrastructure bugs that take the whole API down:** no `pool.on('error')` (a DB restart crashes every instance); the SSE
   drain runs in the wrong shutdown hook (SIGTERM hangs); raw `fetch` to CardPointe / Clover / Twilio / SendGrid with no
   timeout (a hung provider holds checkout); `migrate.mjs` has no lock (replicas race); 29 schedulers would run twice with
   two replicas.
4. **Database:** the tenant-consistency trigger (migration 450) full-scans the parent table on every insert
   (`id::text = $1` defeats the index); the Super Admin overview reads `tenant_daily_*` tables nothing writes; loyalty has
   three competing balances and a route that bypasses the ledger; `users` has no unique email.
5. **Permissions:** a narrowed manager can give themselves GENERAL_MANAGER (no actor ≠ target check, ceiling = base role);
   template scopes are stored but never enforced; a token refresh re-signs stale claims so demotions take effect only when the
   session ends; `users/:id/role` can set SUPER_ADMIN on salon staff.
6. **Mobile:** native realtime cannot connect (relative stream paths + cookie-only EventSource); Face ID enrolls the
   15-minute access token (invalidated by Constitution 3 Step 2b); native base defaults to `http://localhost:3000` which the
   https assert rejects; `VITE_APP_VERSION` is never set.
7. **Parallel systems the specs forbid:** 4 technician recommenders, 2 queue detection engines, 3 auto-assign switches, 5
   discount stores + 4 discount formulas, 2 phone-verification code systems, 3 phone normalizers, 2 customer identity roots,
   3 loyalty balances, 3 circuit breakers, ~12 job tables, 3 Redis rate limiters, 7 role models, ~12 approval flows.

## What needs Kevin (cannot be done in the repository)
Hosting: pick the host of record (Railway vs the legacy AWS Terraform); Postgres backups + PITR + a restore drill; Redis HA;
WAF/CDN; staging; replicas ≥ 2 + the worker service; CD gating; uptime monitor + `ONCALL_EMAIL`/`ONCALL_PHONE`; keys copy
outside Railway; `MEDIA_STORE=s3`; load test on real infrastructure; the seven encryption keys; re-save salon credentials.
Mobile: Apple Developer account + Mac, Firebase/FCM/APNs credentials, AASA/assetlinks hosting, Play Console; bundle-id prefix
decision (`com.powersalon` vs `com.aipowersalon`); crash vendor; whether manager-pay stays a fourth app.
Data decisions: phone-column encryption; cross-salon non-technician staff; which customer identity root wins; `DB_TENANT_RLS`
staging trial; pre-flights/backfills on production data; partitioning row counts.
Product decisions: staff confined to the home branch + owner-managed branch access; one template per person or several roles;
per-salon refund/approval thresholds; where `settings_updated` originates; retire the 3 producer-less events.
Security clean-up still open from earlier: rotate the external DB password and close port 5432 (the login is in git history);
Clover signature-return confirmation; `TWILIO_*` / `SENDGRID_API_KEY`; the "Hanken Grotesque" misspelling decision; remove
the old display access path once every display runs the new build.
