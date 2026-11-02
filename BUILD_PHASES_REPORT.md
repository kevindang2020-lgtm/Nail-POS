# Build phases — what each phase of `BUILD_PLAN_2026-10-06.md` changed, and how it was proved

The plan and the reasons for its order are in `BUILD_PLAN_2026-10-06.md`; the starting point (the 20-document audit) is
`FULL_BUILD_AUDIT_2026-10-06.md` with its evidence in `docs/audit-2026-10-06/`. Each phase below lists what it fixed, the
audit line it closes, the test that would have caught it, the mutation check (break the code → the test fails → restore),
and the lanes it was verified on. Nothing here is claimed that was not executed.

---

## Phase 1 — stop the bleeding: cross-cutting production bugs (Oct 6 2026)

### (a) Audit records that were silently dropped
**Found:** `AuditService.record(ctx, input)` takes two arguments. Seven services declared their own `{ record(input: any) }`
port, were wired with `audit as any`, and called `record({ tenantId, module, action, … })` with ONE object: `input` was
undefined, `buildAuditRow` threw, `record()` swallowed it. No audit row was ever written for booking-verification settings
changes, manual verification bypasses, the platform emergency disable, per-tenant verification overrides, customer phone
changes (start, staff change without SMS, manual confirm, settings) or sign-in phone changes. The scheduling optimizer's
sink called `AuditService.log`, a method that never existed. tsc could not see any of it because of the casts.
**Fix:** one typed one-object port, `AuditSink`, and one adapter, `auditSinkFor(auditService)` (`modules/audit/src/audit-sink.ts`):
a tenant entry becomes an `audit_events` row; a tenant-less entry (a Super Admin action) becomes an `audit_logs` row through
the new `AuditService.recordPlatform` (audit_events requires a tenant). All seven services take `AuditSink`; the three
module factories and the optimizer wire `auditSinkFor`; `pos-search`'s legacy sink and the checkout-upsell port are typed.
**Gate:** `tooling/ci/check-audit-wiring.mjs` ("audit wiring" in `run-gates.mjs`) fails on an audit handle cast to `any`, an
untyped one-object audit port, or a `.log(` call on an audit handle — it reports 14 places on the old tree, 0 now.
**Tests:** `modules/audit/src/audit-sink.vitest.spec.ts` (5); a real-database proof in
`booking-verification.pgtest.vitest.spec.ts` that a platform emergency disable is an `audit_logs` row with the actor and the
reason, and a per-tenant override is an `audit_events` row in that tenant.

### (b) `''` written into UUID `branch_id` columns
**Found:** the request context keeps `''` for "no branch". Booking verification sent — and paid for — the SMS, then failed
the session insert (`branch_id UUID NOT NULL`), leaving a billed code nobody could check; the customer-phone module sent
through the same path; the safety community and queue assignment wrote `''` into UUID columns (a 500, or a swallowed error
returned as a phantom row).
**Fix:** `branchOrNull()` in `@aipowersalon/tenant-context` (a UUID or null). Booking verification refuses to send before
anything is sent when there is no location (`code_send_failed`, "Choose the salon location for this booking first"); the
community context stores null; queue assignment answers 400 "Choose a location first" instead of a 500.
**Tests:** `booking-verification.service.vitest.spec.ts` "no branch → refused BEFORE the provider is called" (0 sends, 0
sessions); `packages/tenant-context` `branchOrNull` cases. Two existing specs used the non-UUID branch `'b1'` and now use a
real UUID.

### (c) Infrastructure bugs that take the whole API down
1. **Database restart crashed every instance.** The pool had no `'error'` listener: when Postgres closes an idle pooled
   connection pg emits `error` on the pool and Node exits. `keepPoolAlive()` logs and keeps the process up; the pool now has
   a connect timeout (10 s), idle timeout (30 s), `statement_timeout` (120 s) and `idle_in_transaction_session_timeout`
   (60 s), each overridable by env (0 turns one off), and an `application_name` per process role. The pools are closed on
   shutdown (`DatabaseShutdown`). **Proof on real Postgres** (`db-pool-resilience.postgres-race.vitest.spec.ts`): the
   database terminates the pool's idle connections and the next query reconnects; a `pg_sleep(3)` under a 400 ms statement
   timeout is cancelled. Mutation (listener removed) → "Unhandled Errors … 57P01", the lane fails.
2. **SIGTERM hung with live SSE clients.** The realtime drain ran in `onApplicationShutdown`, which Nest calls only after
   `httpServer.close()` resolves — and that waits for every open connection; an SSE stream never ends by itself. The drain now
   runs in `beforeApplicationShutdown` and waits briefly for the streams to finish, so their sockets are idle when the server
   closes; `/health/ready` answers 503 `shutting_down` from the moment shutdown starts. **Proof** (`graceful-shutdown.vitest.spec.ts`,
   a real Nest HTTP server with a live stream): `app.close()` completes in well under a second, the client received
   `reconnect_requested` first, readiness reports `shutting_down`. Mutations: drain back in the old hook → close hung;
   flush wait removed → close waited out the 5 s keep-alive.
3. **Provider calls had no timeout.** CardPointe, Clover, Twilio and SendGrid were called with a bare `fetch`: a provider
   that accepted the connection and never answered held the checkout or the send for ~5 minutes. Every provider call already
   goes through `instrumentedFetch`; it now adds a timeout when the caller passed no signal — payment gateways 60 s,
   Twilio/email 15 s, push 10 s, anything else 30 s — and the card terminal (which blocks while the customer taps) passes
   180 s. **Proof:** a real HTTP server that never answers → the call is abandoned at the timeout and recorded as a
   provider failure. Mutation (timeout removed) → 2 tests fail.
4. **Replicas raced the migrations.** `migrate.mjs` runs on every container start with no lock. It now takes a session
   advisory lock (the second runner logs "waiting" and finds the work done) and sets `lock_timeout` (30 s, `MIGRATE_LOCK_TIMEOUT_MS`)
   per file. **Proof** (`migrate-lock.postgres-race.vitest.spec.ts`): two real runners started together on a fresh database
   both exit 0, each migration is applied once, one runner reports it waited. Mutation (no lock) → the test fails.

### (d) The database
**Migration 517** — (1) the tenant-consistency trigger (450) looked the parent up with `id::text = $1`, which no index can
serve: every insert into tickets, payments, appointments, queue items, refunds, intents, customers, technicians, gift cards
and memberships read its parent table end to end. It now casts the value (`id = $1::uuid`), an index lookup. (2) The
customers row-level-security policy compared `tenant_id::text`; it now casts the setting, so the tenant index can be used
when `DB_TENANT_RLS` is turned on. Semantics unchanged. **Proof on real Postgres**
(`tenant-consistency-index.postgres-race.vitest.spec.ts`): with sequential scans priced out, five customer inserts use the
branches primary key and read no other branches index; a crossed salon is still refused. Mutation (the old function
reinstalled) → "the trigger read a whole branches index instead of looking the row up".

### (e) Permissions
1. **Self-escalation through staff roles.** A manager the owner had narrowed could assign themselves (or a colleague) the
   General Manager role, clear their own template back to the full manager defaults, or build a full-manager custom role —
   the ceiling was the base role, not what the actor held. Now nobody changes their own role, and a manager can only hand out
   (template, cleared defaults, or custom role) permissions they hold themselves; the controller passes the session's
   permissions. Tests: 4 new cases in `staff-roles.vitest.spec.ts`; two mutations (self check removed; ceiling removed)
   each fail tests; live: the manager's `PUT /pos/staff-roles/assignments/<self>` answers 403.
2. **The platform plane from a salon screen.** `POST /super-admin/platform/users/:id/role` accepted `SUPER_ADMIN` for any
   account — salon staff included — with no step-up, and could demote a salon's only owner. It now moves people between
   SALON roles only (platform accounts are made and changed in Platform Staff: `platform_roles.manage` + step-up + the grant
   ceiling), refuses to demote the last active owner, and validates before writing (the same-role check used to run after the
   update). The admin-web role picker no longer offers Super Admin. Harness: 5 new checks (13/13); two mutations each fail.
3. **"Edit price" was hidden from everyone.** `GET /pos/booking/permissions` compared roles in lowercase and looked for
   granular keys sessions never carry, so every flag was false for owners too. It now answers from the same `hasPermission`
   checks the server enforces. Test: `booking-permissions.vitest.spec.ts` (owner/manager true; front desk/reception/technician
   false); the old controller fails it.
4. **Demotions waited for the session to end.** `/auth/refresh` re-signed the expired token's claims unchanged (12 h, or 30
   days with "remember me"). Each refresh now asks `LoginService.currentAuthorization`: an account that is gone, not active,
   or moved to another role or salon ends the session (401 `SESSION_ENDED`, every refresh token revoked, a
   `SESSION_ENDED_ACCESS_CHANGED` sign-in-activity event); otherwise the permissions are recomputed exactly as at sign-in
   (role template, technician overrides, platform role). A database error answers 503 rather than re-signing blind.
   Tests: `refresh-authorization.vitest.spec.ts` (5). **Live** (`scripts/live-refresh-authorization.mjs`, real API + Postgres):
   a manager signs in; the owner narrows them to Accountant; the next refresh carries the narrowed set and a cash payment is
   refused 403; the account is suspended; the next refresh is 401 `SESSION_ENDED`, no refresh token survives, the event is
   logged — 10/10. Mutation (refresh keeps the old permissions) → 2 live checks fail (the payment went through to a 400).

### (f) Mobile
- tech-web and owner-web no longer fall back to `http://localhost:3000` inside the native shell (a base the native
  start-up check refuses — the fallback could only produce a misleading start-up error).
- customer-web and manager-pay resolve the API base on every request (`apiBase()`), not a constant captured at load, so a
  runtime `APS_API_BASE` reaches requests as well as the refresh wrapper.
- tech-web's upload sends the native bearer (native uploads answered 401).
- Every app build stamps `VITE_APP_VERSION` (`tooling/vite/app-version.mjs`): the store version (`android/app/build.gradle`
  versionName) for a Capacitor app, else the package version; an explicit env value wins. Before, every client error said
  version "unknown", and setting `MOBILE_PAY_MIN_APP_VERSION` would have refused every Tap-to-Pay device.
- The Tap-to-Pay app's Face ID button is removed until the Face ID redesign (Phase 13): the app ships no biometric plugin
  and no Face ID permission text, so it could only fail. Dead test mocks of removed modules deleted.
- Guard: `mobile-client-guard.vitest.spec.ts` (no localhost fallback, per-call base, bearer on uploads) — 3/3 fail on the
  old clients.

### Found on the way and fixed
- **The foundation packages' tests never ran in CI**, and one (`tenant-context`) had been failing since Constitution 7
  added `restriction` to the context. `run-tests.mjs packages` and a `packages` entry in the CI matrix; all 19 packages pass.
- **admin-web's own `npm run build` failed** at `tsc` (TS7016, the Vite plugin had no type declaration) while CI stayed
  green, because CI builds the apps with Vite (which does not type-check). Declarations added; new gate "app types"
  (`tooling/ci/check-app-types.mjs`) type-checks all seven apps.

### Mutation checks (Phase 1) — each broke the code, saw a test fail, restored, re-verified
| # | Mutation | Caught by |
|---|---|---|
| M1 | pool `'error'` listener removed | real-Postgres pool test (process-level "Unhandled Errors 57P01") |
| M2 | SSE drain back in `onApplicationShutdown` | graceful-shutdown test (close hung) |
| M3 | drain flush wait removed | graceful-shutdown test (close waited the keep-alive timeout) |
| M4 | provider timeout removed | hung-provider test |
| M5 | migration advisory lock removed | concurrent-runner test |
| M6 | migration 450's `id::text` lookup reinstalled | trigger index test |
| M7 | staff self-assignment check removed | staff-roles spec |
| M8 | staff role ceiling removed | staff-roles spec (2 tests) |
| M9 | `SUPER_ADMIN` accepted by `users/:id/role` | role-change harness |
| M10 | last-owner check disabled | role-change harness |
| M11 | booking permissions endpoint reverted | booking-permissions spec |
| M12 | refresh keeps the old permissions | live refresh proof (2 checks) |
| M13 | old mobile clients | mobile-client guard (3 tests) |
| M14 | readiness not flipped on shutdown | graceful-shutdown test |
| M15 | audit adapter back to the one-object call | audit-sink spec |
| — | `audit as any` wiring (old tree) | `check:audit-wiring` (14 places) |

### Verification (Oct 6–7 2026, this tree)
| Lane | Result |
|---|---|
| Gates | **38/38** — 29 gates + 9 audits (two new: audit wiring, app types). First run caught two of my own slips — `SESSION_ENDED` not yet in the error registry, admin-web's Vite config missing an import — both fixed, then all passed |
| API (6 shards) | **1,802 passed**, 0 failed |
| Modules (26 suites) | **6,821 passed**, 0 failed |
| Web apps (7 suites) | **2,615 passed**, 0 failed |
| Packages (19 suites, new CI lane) | **587 passed**, 0 failed |
| Harnesses | **124/124** suites |
| Real-Postgres race lane, fresh database (513 migrations) | **34 files, 115 tests**, 0 skipped (+3 files: pool resilience, concurrent migrations, trigger index) |
| Live proofs on the real API | terminal wire 17/17 · local day 13/13 · lifecycle 29/29 · devices 29/29 · journeys 43/43 · layout 255/255 · one payment 30/30 · check-in browser 39/39 · **refresh re-authorization 10/10 (new)** |
| Mutation checks | **15/15 caught** (table above) |

### Audit lines this phase closes
Cross-cutting findings 1, 2, 3 and the first item of 4 and of 5 in `FULL_BUILD_AUDIT_2026-10-06.md`; Constitution 4 bugs
E1–E4; Constitution 1 bug 1 and performance note 9; Constitution 2 bugs 1, 3 and 5 and the lowercase-role item of 6;
Constitution 6 bugs 4, 5, 6 (upload), 7, 12, 13 and the manager-pay half of 3; the audit-drop bugs in the booking
verification (bug 4), customer phone (E3) and scheduling optimizer (audit BROKEN) specs; the empty-branch bugs (booking
verification 11, customer phone E12, safety community 8, queue assignment 14).

## Phase 2 — shared foundations: schedulers, one job queue, the tenant messenger, one circuit breaker (Oct 7 2026)

### (a) Every background scheduler ran once PER PROCESS
Thirty-one schedulers ran an in-process `setInterval` in every process allowed to run their job class. With
`PROCESS_ROLE=all` and two API replicas — or the API plus a worker — reminders, billing cycles, exports and sweeps ran
twice. (Two used a transaction-scoped advisory lock: it stops two ticks overlapping, not two ticks seconds apart, and
held a connection idle-in-transaction for the whole tick.)
- Migration **518** `scheduler_runs`: one row per scheduler — lease owner/until, last start/finish/outcome/error, runs,
  failures, skipped, the declared interval.
- `packages/database/src/scheduler-runs.ts`: the claim is ONE statement (`INSERT … ON CONFLICT DO UPDATE … WHERE` the
  lease is free or lapsed **and** the last tick started at least 80% of the interval ago). The holder renews while it
  works and clears the lease at the end; no connection is held for the tick.
- `runTick()` (observability) replaces `runJob()` for every scheduled tick; the API installs the lease coordinator at
  start-up (`DatabaseOptions.onPrimary`). A skipped tick still counts as a heartbeat, so the health aggregator does not
  call a healthy fleet "stalled". All 31 schedulers converted (incl. first ticks); the outbox publisher stays
  multi-owner by design (it claims rows with SKIP LOCKED). A coverage test fails the build if a background scheduler
  ticks outside `runTick`.

### (b) One durable job queue
Migration **519** `jobs` + `packages/database/src/job-queue.ts` + `apps/api/src/jobs/`: six classes (the
`WORKER_JOB_CLASSES`), priority 0–3, the salon on every job, idempotency key (the same work is enqueued once),
`FOR UPDATE SKIP LOCKED` claims with a **per-salon cap** (one busy salon cannot take every worker), lease + renewal, a
reaper for workers that died (single-owner tick), retries with exponential backoff and ±50% jitter (5 s base, 30 min
cap), dead after `max_attempts` — or at once for `PermanentJobError` / a type nobody handles — and operator retry/cancel.
A payload never carries a secret-named key (refused at enqueue). The worker loop runs per class wherever the class may
run, and drains in-flight jobs on shutdown. Built-in handler `jobs.self_test` (no salon data) proves the workers are alive.

### (c) Super Admin → Jobs & Dead Letters (new screen)
`GET /super-admin/jobs/stats` (per class: due, running, dead, done in the last hour, oldest due wait),
`GET /super-admin/jobs` (payload **keys** only — never values; the list is cross-tenant), `POST …/:id/retry|cancel`
(reason ≥ 5 characters, audited via `recordPlatform`), `POST …/self-test`. The screen also lists the **event dead
letters** (Constitution 8 §150–155 had the API and no screen) with retry and discard. A failed request is shown as
failed, never as an empty, healthy queue. Native `prompt`/`confirm` replaced by the house inline components (gate
`check:dialogs`).

### (d) The tenant messenger — and a bug: customer activation codes were never texted
`TENANT_MESSENGER` (`packages/notifications/src/tenant-messenger.ts`), implemented by the communications module's
`NotificationsService.sendSms()` and injectable everywhere (`MessengerModule`, global): for a salon it uses the salon's own
Twilio account or registered number, honours opt-outs (except account/security texts), meters credits when asked,
writes the notification ledger and — in the same transaction — `communication.sms_sent` /
`communication.sms_delivery_failed` (a later carrier failure emits once per message, never on a repeated callback).
Neither the number nor the text is in an event. `communication.push_sent` is written with the push delivery log.
- **Bug found and fixed:** customer activation sent through `NotificationsService.send()` with
  `systemContext({ tenantId: '' })`, which `send()` refuses — **every activation request answered 503
  `sms_unavailable`; no code was ever texted.** (`send()` also reports a failed handoff as `{ sent: false }`, which the old
  code would have counted as delivered.) Now a platform text through `sendSms({ tenantId: null, purpose: 'account' })`.
- Now through the messenger: customer activation codes, SMS receipts (were the platform's own number with no ledger;
  a provider failure was a 500 — now `blocked`/`failed` reported as such), the customer app's phone verification and
  gift-card claim links (the salon's text), password resets (salon and platform), the Super Admin OTP, and the
  old-number warning on a phone change. Reminders and end-of-day follow-ups already used `NotificationsService`.

### (e) One circuit breaker, and it blocks
Three implementations (AI providers; integration connections, durable; provider telemetry in front of
Twilio/SendGrid/FCM/APNs/CardPointe/Clover/Fiserv). The third only RECORDED "open": a dead SMS provider still took 15 s
per text and a dead gateway 60 s per card. Now `packages/observability/src/circuit-breaker.ts` is the one state machine
(closed → open after 5 provider failures → one half-open probe; 4xx/our own credentials never count):
- `instrumentedFetch` refuses an open circuit **without touching the network** (`CircuitOpenError`). The circuit is per
  provider **and host**, so a salon whose gateway site name is wrong opens only its own host's circuit, never the
  provider's for every salon. The card terminal transport opts out (`breaker: false`): a customer who walks away from
  the reader is not a provider outage.
- The AI router's breaker keeps its health view but takes its decisions from the same core.
- The integration connections' durable breaker uses the same decisions, and its half-open probe is now claimed
  **atomically** (before, every process that saw an expired circuit probed the provider); a probe whose process died is
  reclaimable after the cooldown.

### Found on the way and fixed
- **By the first full verification run (my own slips, both fixed and re-run from scratch):** (1) the live devices proof
  caught that through the messenger a failed text RETURNS `{ delivery: 'failed' }` instead of throwing, and the customer
  display's mapping called everything not simulated "sent" — a customer would have read "Receipt texted" for a text that
  never left. Mapping fixed (only `sent` is sent), unit test added (M21). (2) The scheduler coverage guard flagged the job
  worker (its lease heartbeat interval; per-job telemetry labelled with the job's own type). The heartbeat moved into the
  queue library (`startLeaseHeartbeat`); the guard gained an explicit, documented rule for the queue runner — and still
  fails if the queue's reaper ticks outside `runTick` (M20).
- The architecture baseline was stale (11 "unproduced" events when 5 remain, cycle/edge counts far above today's);
  refreshed — every ratchet now at the current, tighter state.
- `scheduler_runs.every_ms` added so operators (and the live proof) can see each scheduler's declared interval.

### Mutation checks (Phase 2) — each broke the code, saw a test fail, restored, re-verified
| # | Mutation | Caught by |
|---|---|---|
| M1 | a scheduler reverted to `runJob` | scheduler coverage guard (names the file) |
| M2 | min-gap clause removed from the tick claim | real-Postgres lease test (same-interval second tick ran) |
| M3 | lease renewal removed | real-Postgres lease test (long tick lost its lease) |
| M4 | job claim without row locks | real-Postgres queue test (a job ran twice) |
| M5 | reaper never reaps | real-Postgres queue test |
| M6 | `PermanentJobError` retried | real-Postgres queue test |
| M7 | activation back to `send()` with an empty tenant | activation-through-messenger test (real NotificationsService) |
| M8 | SMS ledger row without its event | messenger events pgtest (2 tests) |
| M9 | repeated carrier callback emits again | messenger events pgtest |
| M10 | `push_sent` for a failed push | messenger events pgtest |
| M11 | breaker records but never refuses (pre-Phase-2) | provider breaker test (5 tests) |
| M12 | circuit keyed by provider only | provider breaker test (2 tests) |
| M13 | half-open admits every call | provider breaker test |
| M14 | integration probe claimed without the atomic condition | real-Postgres breaker test — **first attempt MISSED** (the end-to-end race window was too narrow to be discriminating); a direct six-way atomic-claim test was added, then CAUGHT |
| M15 | SMS receipt bypasses the messenger | receipt messenger test (3 tests) |
| M16 | customer texts bypass the messenger | customer messenger test |
| M17 | AI breaker: open circuit stays routable | AI suite (2 tests) |
| M18 | job retry/cancel without a reason (screen) | screen test |
| M19 | dead-letter discard without confirmation | screen test |
| M20 | the queue's reaper ticks through `runJob` (multi-owner) | scheduler coverage guard |
| M21 | display maps a failed messenger send to "sent" | receipt messenger test (the live-proof finding) |
| — | reaper scheduler not gated on its job class | architecture test (caught during the build, fixed) |

### Verification (Oct 7 2026, this tree)
| Lane | Result |
|---|---|
| Gates | **38/38** — 29 gates + 9 audits (first run caught `check:tenant` on the queue — reviewed and baselined as a platform table —, native dialogs in the new screen, and the reaper not gated on its job class; all fixed) |
| API (6 shards) | **1,805 passed**, 0 failed |
| Modules (26 suites) | **6,831 passed**, 0 failed |
| Web apps (7 suites) | **2,622 passed**, 0 failed |
| Packages (19 suites) | **593 passed**, 0 failed |
| Harnesses | **124/124** suites |
| Real-Postgres race lane, fresh database (515 migrations) | **37 files, 132 tests**, 0 skipped (+3 files: scheduler leases, job queue, integration breaker) |
| Live proofs on the real API | terminal wire 17/17 · local day 13/13 · lifecycle 29/29 · devices 29/29 · journeys 43/43 · layout 255/255 · one payment 30/30 · check-in browser 39/39 · refresh re-authorization 10/10 · **Phase 2, two API processes 22/22 (new):** schedulers single-owner (each scheduler ran once per interval, the other process skipped — runs = skips for every scheduler that ticked in both), 20 self-test jobs each run exactly once (attempts = 1) by both processes' workers, Super Admin jobs API (payload keys only, reason required, salon owner refused), SMS receipt → ledger + `communication.sms_sent` (no number, no text), activation code sent (was 503) |
| Full run | run twice from a fresh build: run 1 found the two slips above (devices live proof 28/29, scheduler guard 3 failures); both fixed, everything re-run: all green |
| Mutation checks | **21/21 caught** (M14 after strengthening its test — table above) |

### What Phase 2 does NOT do (honest scope)
- **Email** is not behind the messenger: no email domain event is declared, and the email senders keep their existing
  ports (still timed and breaker-guarded at `instrumentedFetch`). Platform operations texts — technician invitations,
  application confirmations, tenant warnings, the on-call alert notifier — also keep their direct senders (same guard).
- The ~12 per-feature job tables are **not** migrated onto the queue yet; each moves when its module's phase rebuilds it.
  Today the queue's only handler is the self-test.
- Constitution 8 producers: 3 closed here (`communication.sms_sent`, `sms_delivery_failed`, `push_sent`). The
  architecture graph now reports 5 declared events with no producer (`checkout.started`, `customer.merged`,
  `payment.authorized`, `visit.completed`, `visit.started`) — Phase 15 retires or produces them.
- The checkout "SMS configured" readiness flag still reflects the platform's env sender, not a salon's own Twilio account.

### Audit lines this phase closes
Constitution 4 §28–36 (generic queue, classes, priorities, retries with jitter, dead letters, operator retry) and §117
(breakers that block) and the three-breakers duplication; §25/§167 single-owner schedulers (the 29+ unwrapped
schedulers); Constitution 8's three communication producers; the events dead-letter screen gap; the customer-activation
send bug (new finding).

---

## Phase 3 — customer phone number management, completed (Oct 7 2026)

The most complete of the six "half-built" features (audit: 45%), now finished against its spec
(`docs/audit-2026-10-06` · customer_phone_number_management) — one canonical service for every path that changes or
proves a customer's number: the POS, the customer app, the customer display, and the old "verify my phone" route.

### (a) The audit's E-lines
- **E1 — no SMS-verified change ever activated.** The session never remembered WHICH pending row it proposed;
  `newPhoneId ?? ''` reached `id <> ''`, Postgres refused it, a swallowed error became a false VERSION_CONFLICT, and every
  verified change stopped at `phone_verified`. Migration **520** adds `new_phone_id` (plus `expires_at`, approval and
  display columns); a DB-backed start → send → verify → activate test drives it as the controllers do.
- **E2/E11 — sessions never ended.** A deadline on every change, an expiry job on the Phase 2 queue at that deadline (and
  a sweep as the safety net), one open change per customer (starting again resumes the same proposal or replaces a
  different one), idempotent replay (same key → same change, not a 500), and canceled/expired pending numbers retired.
- **E4/E7 — what the customer row said afterwards.** `phone_display` received the MASK (the POS list showed "••••0199";
  the AI receptionist's caller-ID matched nothing): it is now the readable number, and migration 520 repaired existing
  masked rows. `phone_verified_at` is derived from the proof (an SMS sets it; a change without SMS clears it). The OLD
  number's booking verification is **revoked** (whoever gets that number next would have booked as this customer
  without a code). Caller-ID matches the current `normalized_phone`.
- **E5 — the sign-in number could move without proof.** It now needs the password, a number this customer proved by SMS
  in the app within 30 minutes, a warning to the old number BEFORE the change (refused in production if the warning
  cannot really be sent), and every session ends (refresh tokens die with them — migration 499's trigger).
- **E6** a duplicate number only a manager may resolve: `POST /pos/customers/:id/phone/resolve` (reason ≥ 12 chars,
  audited; the shared-family assertion alone no longer passes several matches). **E10** branch policies:
  `GET/PATCH/DELETE /pos/settings/customer-phone/branches/:branchId`. **E13** oversight counted from states nothing
  reaches — rewritten (duplicate conflicts from the recorded outcome, manual confirmations vs changes without SMS,
  salons on the default policy, dead synchronisations from the job queue). **E14** a number staff typed WITHOUT an SMS is
  not an account-claim key. **E15** a session belongs to one customer: another customer's id cannot drive it.
- **E8** future appointments (branch-time "future"), today's open queue entries and the reminders use the current number;
  history keeps the number it was served on.

### (b) What was added around it
- Tenant settings now read: `require_manager_approval` (a receptionist's change waits; no text goes out before
  approval; managers alerted), `require_reauthentication` (customer app: the password), `notify_old_number`. New coarse
  permission `customers.phone_manage` (OWNER, MANAGER) behind the granular approve / resolve / manual-confirm / settings /
  retry-sync routes. Rate limits per customer and per actor.
- Events `customer.phone_update_requested | verification_failed | verified | activated | sync_failed | sync_completed`
  on the outbox in the same transaction (no full number, no code); the realtime projection refreshes the customer
  profile. Notifications: the old number (masked new number, the salon's sender, account purpose — an opt-out does not
  stop it), owner alerts for approvals and numbers set without SMS. Failed synchronisations are jobs on the queue
  (backoff, alert after 8 attempts, dead-lettered) — `customer.phone.sync`; expiry is `customer.phone.session_expiry`.
- Routes: `GET …/phone/status` (POS and customer app — the customer sees the masked number only), `…/:id/approve`,
  `…/:id/retry-sync`, `…/:id/to-display`, `POST /customer-display/device/phone-code`, Super Admin
  `GET /super-admin/customer-phone/oversight[/tenants]`, `POST /super-admin/customer-phone/sweep` (reason, audited).
- **POS:** the profile shows the number's real proof ("Verified by SMS" / "Not verified" / "Manually confirmed — OTP not
  completed"); the editor has a country selector (E.164, trunk 0 dropped), resumes a change in flight, approval and
  manager-resolve steps, manual confirmation (manager, reason), resend countdown, "Enter the code on the customer
  display", "Open Twilio Settings" when the salon has no Twilio, synchronisation status + retry; the settings screen
  has the two new toggles and a branch selector. With SMS not required the change is simply done (E9: it used to call
  send and show an error).
- **Customer app:** password first, resend countdown, every send failure shown (they were swallowed), the number's proof
  and a change waiting for its code, and after the change "Also use this number to sign in…".
- **Customer display:** a full-screen code pad when staff ask for it — the masked number only; the code goes from the
  customer's fingers to the server, checked for THAT display's current customer; it disappears after 15 minutes.
- **Super Admin → Customer Phone Oversight** (new screen): counts only (never a number), per-salon table, sweep with a
  reason. Shared wire types in `packages/api-contracts` (`CustomerPhoneStatus`, `CustomerPhoneOversight…`).
- The legacy `/customer/verify/phone` now delegates to the canonical service (its own code table and hashing removed).

### Found by the live proof and fixed (the reason it exists)
The service and PGlite tests were green; the running API was not:
1. **Every customer-app change answered 500** (and so did a POS change from a session with no branch selected). The real
   request context carries `branchId: ''` for "no branch"; it reached a uuid column. Fixed at the controllers
   (`'' → null`) and in the store.
2. **A customer's own change could never send its code** ("choose the salon location"): the app session has no branch.
   The change now happens at the customer's home branch (session row and the verification call).
3. **The salon's phone settings were silently ignored** whenever the branch was empty (`''::uuid` errored, was caught,
   and fell back to the defaults); branch policies were ignored whenever the request had no branch. Both fixed (the
   customer's home branch decides).
4. **The old number was never told when the two numbers end in the same four digits** — the guard compared MASKS.
   It now compares the numbers.
5. The status of a number on file from before the phone table showed no mask and the raw E.164 — now derived.
6. **The customer display could never submit a code**: `POST /customer-display/device/phone-code` was not in the
   paired-device exclusions, so the display (which has no staff session) would have been refused — caught by the
   route-authorization guard in the first full verification run; now excluded like its sibling device routes and
   proved through the device credential on the running API (section 1b of the live proof; mutation M34).
Each has a test that fails without its fix (mutations M14, M18–M22, M34).

Also found while checking the Definition of Done: open queue entries kept the old number (M23); a customer who had texted
STOP was not opted out on the new number (M24 — the opt-out is carried forward; nothing is ever opted in by a change);
no real-Postgres concurrency test existed (added: three terminals start at once → one open change; the same code three
times at once → activated once; a profile edit during verification is never overwritten — M33).

### The live proof needs a Twilio Verify it can talk to
`TWILIO_VERIFY_BASE_URL` lets the provider talk to a local fake Verify service — honoured **only outside production and
only for a loopback address** (a stray env var must never send a salon's Twilio credentials elsewhere; test + mutation
M25). The fake issues and checks codes exactly as Twilio does; nothing in the API accepts a code on its own.

### Mutation checks (Phase 3) — each broke the code, saw a test fail, restored
| # | Mutation | Caught by |
|---|---|---|
| M1 | session forgets its pending row (E1) | flow pgtest |
| M2 | `phone_display` gets the mask (E4) | flow pgtest |
| M3 | old booking verification not revoked (E7) | flow pgtest |
| M4 | expiry sweep never closes (E2) | flow pgtest |
| M5 | session ownership check removed (E15) | flow pgtest |
| M6 | sign-in change without a recent own proof (E5) | identity test |
| M7 | shared-phone assertion passes several matches (E6) | policy test |
| M8 | code sent while waiting for approval | policy test |
| M9 | self-service change without reauthentication | policy test |
| M10 | unproven staff number is a claim key (E14) | flow pgtest |
| M11 | caller-ID on the display text (E4) | caller-ID test — **first run MISSED** (the negative case is guarded twice); a positive masked-display test added, then CAUGHT |
| M12 | reminders read the appointment's stale copy (E8) | flow pgtest |
| M13 | no `customer.phone_*` events | flow pgtest |
| M14 | old number skipped when the last four match (live finding) | flow pgtest |
| M15 | oversight duplicate count (E13) | flow pgtest |
| M16 | display prompt not scoped to the customer | flow pgtest |
| M17 | display pad never expires | flow pgtest |
| M18–M22 | the live-proof findings 1–3 and 5 | flow pgtests |
| M23 | open queue entries keep the old number | flow pgtest |
| M24 | STOP not carried to the new number | flow pgtest |
| M25 | loopback Verify seam honoured in production | provider test |
| M26 | legacy "verify my number" not delegated | flow pgtest |
| M27 | POS: SMS not required → still calls send (E9) | POS editor test |
| M28 | POS: no resend countdown | POS editor test |
| M29 | display app: no pad | display App test |
| M30 | display service: code accepted with no customer | display service test |
| M31 | customer app: password not sent | customer app test |
| M32 | Super Admin sweep without a reason (UI) | screen test |
| M33 | `record_version` guard removed | **real-Postgres race test** (2 tests) |
| M34 | the display's phone-code route not excluded as a device route | route-authorization guard (`authz-declared`) |

### Verification (Oct 7 2026, this tree)
| Lane | Result |
|---|---|
| Gates | **38/38** — 29 gates + 9 audits. Run 2 caught `check:openapi`: the manifest recording the display's code route moving from session to device auth (the M34 fix) — regenerated, re-run green |
| API (6 shards) | **1,813 passed**, 0 failed. Run 1 caught three things: an H9 guard pinned the local code generator Phase 3 removed (now asserts there is none, and that the route delegates); the route-authorization guard caught the display route (finding 6); the schema guard read a SQL string literal ("adopted from the customer record") as a table name — reworded |
| Modules (26 suites) | **6,898 passed**, 0 failed. Run 2 caught the activation pgtest's hand-built schema missing `customer_phones` (the E14 sub-query errored and the repository degraded to "no match") — table added, plus a real-SQL E14 test; lane re-run green |
| Web apps (7 suites) | **2,654 passed**, 0 failed |
| Packages (19 suites) | **594 passed**, 0 failed |
| Harnesses | **124/124** suites |
| Real-Postgres race lane, fresh database (every migration) | **38 files, 135 tests**, 0 skipped (+1 file: the phone concurrency test) |
| Live proofs on the real API | terminal wire 17/17 · local day 13/13 · lifecycle 29/29 · devices 29/29 · journeys 43/43 · layout 255/255 · one payment 30/30 · check-in browser 39/39 (re-run with `PROOF_TZ=Europe/London`: the scripted run started after 7 pm in its Asia/Tokyo branch and refused, by design) · refresh re-authorization 10/10 ×3 (in the run 9/10: the proof read a fire-and-forget event before it was written — the proof now waits up to 3 s) · Phase 2 two processes 22/22 on re-run (in the run 21/22: its "both workers took jobs" check is timing-dependent — one worker drained all 20; noted, not changed) · **Phase 3 phone 48/48 (new):** receptionist change through the salon's Verify (wrong code refused, readable display, old row retired, appointment moved, old booking verification revoked, events without numbers, old number told), the code typed on a paired customer display (device credential, masked number only, wrong code refused, pad gone after), customer self-change (password required, home branch), sign-in number (wrong password and an unproven number refused; identity moved; old number warned; every session ended; no refresh token left), Super Admin oversight and sweep, cleanup |
| Full run | run 1 and run 2 from fresh builds (findings above, each fixed with a test); the lanes touched after run 2 began (gates, modules, the refresh proof) re-run green |
| Mutation checks | **34/34 caught** (M11 after adding its positive test — table above) |

### Definition of Done (spec lines 1708–1802) — every line
| Spec line | Status | Evidence |
|---|---|---|
| Existing customer code inspected | DONE | customers module, `apps/api/src/customer`, POS profile/list, customer app screens (audit + this phase) |
| Existing central directory code inspected | DONE | `customer_identities` / `customer_identity_links`, `CustomerIdentityService.applyVerifiedPhone`, nightly reconciliation |
| Existing phone verification code inspected | DONE | booking verification (Twilio Verify / internal OTP), the legacy customer-app verify route |
| Duplicate implementations merged | DONE | `/customer/verify/phone` delegates to the canonical service (its own code table use and hashing removed); one OTP path (booking verification); one wire type for status/oversight (`api-contracts`) |
| Receptionist phone update works | DONE | live proof §1 (receptionist session, salon Twilio Verify, wrong code refused, right code activates) |
| Manager approval works where configured | DONE | policy tests (no text before approval, approve → code), POS editor tests (manager approves; reception sees the wait), branch policy test |
| Customer app self-service works | DONE | live proof §2 (password required, home-branch location, verify) + app tests |
| New number validation works | DONE | E.164 normalisation (country selector, trunk 0), `invalid_phone` tests |
| Duplicate detection works | DONE | duplicate classification tests; oversight counts the recorded outcome (M15) |
| Shared family phone handling works | DONE | E6 tests (one match: staff assertion; several: manager resolve with reason, M7) |
| Twilio verification works | DONE (decided) | the salon's own Verify credentials, proved against a loopback Verify service (§ above); the real Twilio is unreachable from this environment — first real check at the pilot salon |
| Six-digit verification works | DONE | 6-digit entry on POS, app and display (digits only), provider decides |
| Old verification is invalidated | DONE | old number's booking verification revoked (live proof, M3); old pending/expired sessions closed (M4) |
| New number activation works | DONE | E1 (M1), live proof §1, §1b, §2 |
| Tenant customer record updates | DONE | `customers.normalized_phone/phone_display/phone_verified_at/record_version` (live, M2) |
| Central customer identity updates | DONE (decided) | verified changes propagate via `applyVerifiedPhone`; the SIGN-IN credential moves only through the customer's own reauthenticated step (live §3) — never from a receptionist (takeover risk) |
| Branch customer records update | DONE | future appointments (branch-time) and today's open queue entries (M23); history keeps its number |
| Customer app profile updates | DONE | the customer's `users` row (sync), status endpoint (masked) |
| Booking profile updates | DONE | the customer row is the booking profile; the new number counts as booking-verified (live) |
| Booking phone verification uses the new number | DONE | new number verified, old revoked (live) |
| AI receptionist lookup updates | DONE | lookups read `normalized_phone` |
| Caller-ID lookup updates | DONE | M11 |
| Appointment reminders use the new number | DONE | M12 |
| Loyalty and membership links remain correct | DONE | keyed by `customer_id`; no phone column on those tables; the change never touches them |
| SMS consent is preserved correctly | DONE | marketing flags untouched; a STOP carries to the new number, nothing is opted in (M24) |
| Communication history remains intact | DONE | the notification ledger is never rewritten; old numbers retired, not deleted |
| Real-time synchronization works | DONE | `customer.phone_*` → `customer_profile_updated` projection test |
| Concurrency protection works | DONE | real-Postgres race test: one open change, one activation, a newer edit never overwritten (M33) |
| Background retry works | DONE | sync and expiry jobs on the queue (tests); alert at 8 attempts; dead-lettered |
| Tenant settings work | DONE | all switches read; branch overrides (E10); '' branch / customer-home-branch fixes (M20, M21) |
| Super Admin oversight works | DONE | live §4 + screen tests |
| Permissions work | DONE | `customers.phone_manage`; receptionist refused manager actions and platform oversight (live) |
| Audit logging works | DONE | every step audited (service); sweep via `recordPlatform` |
| Notifications work | DONE | old number told (live, M14), sign-in warning (live), owner alerts (tests) |
| Loading states work | DONE | busy states on every action (POS, app, display, Super Admin) |
| Error states work | DONE | send failures shown, Twilio not connected → "Open Twilio Settings", failed loads say so (tests) |
| Retry states work | DONE | resend countdown, sync retry, a change in flight resumed (tests) |
| Existing tests pass · New tests pass · Build · Type checking · Lint | DONE | verification table above |
| No dead links remain | DONE | `check:unreached` / `check:dead-client` (every new route has a caller; the ledger shrank by one) |
| No mock phone data remains | DONE | only input placeholders remain (searched) |
| No production verification bypass remains | DONE | no master code anywhere; the loopback Verify seam is ignored in production (M25); a simulated sign-in warning is refused in production |
| No plaintext OTP is stored | DONE | Twilio Verify holds the code; the legacy local code path is gone |
| No cross-tenant customer data is exposed | DONE | every query tenant-scoped; a session belongs to one customer (M5); oversight is counts only |

### What Phase 3 does NOT do (honest scope)
- Not proved against the **real** Twilio Verify (this environment cannot reach it; the loopback fake stands in). First
  real-device check belongs to the pilot salon.
- The **central identity** (`customer_identities.normalized_phone`, the sign-in credential) changes only through the
  customer's own sign-in-number step — never from a receptionist's change (deliberate: account-takeover risk). The global
  directory is reconciled by the existing nightly job.
- Revocation of the customer's sessions takes effect on other API processes within the session store's 15-second cache
  (the same bound as a password reset).
- Historical copies of the number (call logs, follow-up snapshots, gift-card recipients, finished queue entries, past
  appointments) are history and keep the number they were made with.

### Audit lines this phase closes
customer_phone_number_management E1, E2, E4, E5, E6, E7, E8, E9, E10, E11, E13, E14, E15 and the spec's Definition of Done
(table above); the duplicate legacy phone-verification path.

---

## Phase 4 — booking phone verification, completed: all three remote channels (Oct 7 2026)

The audit's verdict was "roughly 40% of the surface — and **0 of 3 remote channels can complete a verified booking end
to end**" (`docs/audit-2026-10-06/spec-booking-phone-verification.md`). Now the customer app, the signed public booking
link and the AI receptionist each complete a verified booking on the running API — and the public booking PAGE does it in
a real browser under its own Content-Security-Policy.

### (a) The one flow every remote channel goes through
`VerifiedBookingFlow` (CB `booking-verification-flow.ts`): **admit** → the slot is not held by another booking session →
the policy (one resolver) → a PROOF for this booking session and this number is **claimed atomically** (one verified
session = one appointment; `consumed_at` / `consumed_appointment_id`) — or the slot is **held** (`hold_seconds`) and a
pending verification opened, and the caller is told "verify first" with a sealed booking session, the masked number and
the hold's end → after the appointment exists, **complete** labels it (`pos_tech_appointments.phone_verification`:
`verified` / `recently_verified` / `staff_override`), ties the proof to it and converts the hold; if creating it failed,
**abandon** gives the proof back. Migration 521.
- Customer app: `customerAppAdmission` — the customer's OWN number (resolved from `customers.user_id`; audit bugs 1–2),
  the slot in the branch's own zone, the session sealed for this user. "Verify every booking" now works (bug 5).
- Public link and AI receptionist book through the staff engine: `RemoteBookingAdmission` (slot from the branch zone +
  the services' length; session sealed for `link:<jti>` / `voice:<tenant>:<branch>`).
- Trust scopes (`trustScopeFor`): customer app = the account's per-phone trust; public link = only proofs from the same
  device; kiosk and AI receptionist = never (caller ID is spoofable).

### (b) Configuration (audit bug 3)
Verify Service SID + API key (SID + write-only secret) in the tenant credentials API and the POS Messaging setup screen;
a real **"Test Verify"** (fetches the Verify Service with the salon's credentials; sets `last_validated_at` /
`last_validation_error`); **disconnect**; **branch credentials** (the 311 unique replaced; branch rows inherit the salon
default; routes `credentials/branches/:branchId…`). Locale passed to Verify (from the customer's language).

### (c) Sessions, abuse controls, CAPTCHA
States `pending → sent → verified | locked | expired | failed`; the session exists BEFORE the provider is called (bug 11);
five attempts then LOCK (hold released); the expiry sweep runs in the 20-second reconciliation (hold released,
`booking.phone_verification_expired`); hard caps per IP (10/h) and per device (5/h) across every salon; fraud counters
fixed (failed checks counted per address, novel destination country); the internal hashed-code fallback is live (texted
from the salon's own number, only the hash kept). CAPTCHA: `GET …/verification/captcha` (provider + public site key) and
a widget in the customer app, booking-html and booking-public (Turnstile / hCaptcha / reCAPTCHA; with none configured
the page says to call the salon — fails closed).

### (d) The channels
- **Public link** (`api/ai-booking/v1/public`): `verification/send`, `verification/check`, `verification/captcha`,
  `services` — all scoped by the signed link; the booking retry carries the sealed session. booking-public has the code
  step (masked number, hold note, resend countdown, paste/autofill, CAPTCHA, change number).
- **AI receptionist**: the refusal is `collect_verification_code` (DTMF) with the code ALREADY texted, the sealed session
  and keypad URLs; the keypad callback / TwiML carry their own AES-GCM-sealed credential (`vc`: salon, branch, session and
  the number the code went to) — Twilio's `<Gather>` cannot present the voice key; `verification/send` (resend, behind
  the key). Typed outcomes: `PHONE_VERIFICATION_UNAVAILABLE` (handoff) is never reported as a taken slot (bug 6).
- **Staff copilot**: not verified (a staff-created booking; it was checked as "online" — bug 12).

### (e) The manager override (bug 7)
`pos.booking.verification_pending` / `pos.booking.override_verification` → `booking.override` (owner/manager; RECEPTION's
`booking.manage` no longer passes the guard). The manager approves ONE waiting verification (reason ≥ 12 chars, how the
customer was confirmed); explicit override columns (never `failure_reason`); its own platform switch `bypass_blocked`;
`booking.phone_verification_overridden` event; the owner is alerted; the customer's retry books, labelled
`staff_override`; no phone trust is written. POS: "Waiting for a code" list + "Approve without code".

### (f) Webhook, events, notifications, reports, oversight
- Twilio status callback: signature with the tenant's own token → `booking_verification.webhook` on the job queue, once
  per `(SID, status)`; delivered stamps `delivered_at`; a failure fails only a WAITING session and frees its slot (bug 9).
- Events on the outbox, masked numbers only: `booking.phone_verification_requested / _sent / _failed / _expired /
  _overridden`, `booking.phone_verified`.
- Owner alerts: every override; ≥3 locks in an hour; ≥3 send failures in 30 minutes (once per kind per window).
- POS usage panel (`GET /pos/settings/booking-phone-verification/usage`): counts, verify rate, per channel, recent
  problems — masked numbers.
- **Super Admin → Booking Verification Oversight** (new screen): module switch (`POST …/module`, step-up + reason) and
  emergency stop; counts; every salon's state (the "refusing bookings — provider not ready" row flagged) with
  require / block / forbid-override switches (reason).
- Settings refuse "enable" while the platform has the module off (bug 13).
- The duplicate `/customer/verify/phone` route family removed; the app uses
  `/customer/profile/phone/verify-current/{request,confirm}`.

### Found by the live proof (and the race lane) and fixed — none was visible to the unit tests
| # | Defect | Fix + test |
|---|---|---|
| L1 | **The whole AI receptionist gateway was unreachable over HTTP**: `api/ai-receptionist/v1/*` was not excluded from the session middleware, so every voice-platform call got 401 "No session" before the voice-key guard ran | excluded (it authenticates itself); `sessionless-routes` + `auth-boundary` entries; live §3 |
| L2 | **The customer app never received the session it had to verify**: the sealed token `bs.eyJ….<sig>` matched the error envelope's JWT-leak filter and was dropped from every 428 (since the Oct 3 sealing) | `~` separators (old tokens still open); envelope regression test (M4) |
| L3 | Branch credentials addressed by `?branchId=` — the session middleware strips `branchId` from every tenant request, so each branch operation silently hit the salon default | path routes `credentials/branches/:branchId…`; POS screen moved |
| L4 | The customer app's code request had no branch (a customer session carries none) → "choose the salon location first" | the branch the 428 opened the session at (M15) |
| L5 | A branch's own "verify every booking" / re-verify window was ignored (the resolver read only the salon row) | branch rules merged in the resolver (policy tests, M5) |
| L6 | Held slots were merged into the customer's availability with the customer session's (empty) branch | the technician's branch, as booking does |
| L7 | **No public booking page could load a service**: it used public discovery with the link's TENANT id where a branch id is expected, behind the salon's public-listing flag, reading `s.id` where the API sends `serviceId` | `POST …/public/services` from the signed link (engine catalog, partner allow-list) |
| L8 | **Every single-file HTML page was dead under its own CSP**: the generated `script-src 'self'` blocked the inline script of booking-public, booking-html, the kiosk, the check-in admin, the schedule page and tech-web | each inline script allowed by its sha256 (never `'unsafe-inline'`); captcha origins only for apps that load one; proved in Chromium (M11) |
| R1 | **Unlimited code guessing**: N simultaneous wrong codes each read "0 attempts used" — the 5-attempt limit did not hold under concurrency | the attempt is reserved atomically before the compare (real-Postgres race test counts compares ≤ 5; M1) |
| R2 | Two sessions holding the same slot at once: the loser got the raw exclusion-constraint error (a 500) | mapped to the same "held for another booking" refusal (race test, M3) |
| R3 | "Verify first" refusals were remembered under the idempotency key (public ledger and the voice gateway) — the verified retry replayed the refusal | refusal not committed (M6, M7; live §2/§3) |
| — | Unmapped failures in the public/partner booking facade were swallowed as INTERNAL_ERROR with nothing logged | logged (`ai_booking.mutation_failed`) |

### Mutation checks (Phase 4) — each broke the code, saw a test fail, restored
| # | Broke | Caught by |
|---|---|---|
| M1 | attempt reserved without the budget bound (`attempt_count < max`) | real-Postgres race: 9 simultaneous wrong codes → ≤ 5 compared (first pass MISSED — the test only checked the end state; strengthened to count compares) |
| M2 | the outer `consumed_at IS NULL` guard alone | **equivalent** — redundant behind `FOR UPDATE SKIP LOCKED`; replaced by M2b |
| M2b | proof claim without the row lock AND the guard | new deterministic race test: a claim inside an open transaction + a second claim meanwhile → exactly one |
| M3 | the exclusion violation not mapped | race: two sessions, one slot → clean refusal, no raw DB error |
| M4 | the token back to `.` separators | envelope regression: the 428 keeps the token |
| M5 | branch "verify every booking" not merged | policy test |
| M6 | the public refusal recorded under the idempotency key | mutation-facade test (the verified retry books) |
| M7 | the voice refusal committed under the Idempotency-Key | gateway test (same key then books) |
| M8 | the keypad number taken from `To` | voice test (the salon's line never verifies) |
| M9 | bypass switch read from `blocked_for_tenant` | override pgtest |
| M10 | a failure callback allowed to fail a proven session | webhook pgtest |
| M11 | the inline-script hash dropped from the CSP | app-headers test |
| M12 | the kiosk switch accepted | settings test |
| M13 | the override permission collapsed to `booking.manage` | permissions test (RECEPTION refused) |
| M14 | a public session opened for any link | public verification test |
| M15 | the customer's code sent without the booking's branch | session test |
| M16 | the per-device cap raised | caps pgtest |
| M17 | a partner link's services not narrowed | public services test |
| M18 | voice sessions bound to the salon, not the line | voice tests |
| M19 | the reconciliation's verification expiry removed | real-Postgres reconciliation test |
| M20 | "enable" accepted with the module off | settings test |
| M21 | override of a session that is no longer waiting | override pgtest (first pass MISSED — strengthened: an EXPIRED session cannot be approved) |
| M22 | the send-failure owner alert removed | owner-alert pgtest |

**23 mutants: 22 caught, 1 equivalent (M2, documented).** Two were missed on the first pass and the tests strengthened
(M1, M21) — the mutation checks found two gaps of their own.

### Verification (Oct 7 2026, this tree)
| Lane | Result |
|---|---|
| Gates | **38/38** — 29 gates + 9 audits. Run 1 caught `check:openapi` (the new branch-credential and public `services` routes — manifest regenerated) |
| API (6 shards) | **1,832 passed**, 0 failed. Run 1 caught three guards: the Twilio API key secret missing from the restore-verification list of encrypted columns (a restore could not have proved it decrypts), `api_key_sid` flagged as a plaintext secret column (reviewed: an identifier, like the account SID), `CAPTCHA_SITE_KEY` missing from the secrets inventory (reviewed: a public site key) — each fixed, run 2 green |
| Modules (26 suites) | **6,956 passed**, 0 failed |
| Web apps (7 suites) | **2,673 passed**, 0 failed. Run 1 caught the new Super Admin screen without a nav permission (mapped to `super_admin.operations.view`), run 2 green |
| Packages (19 suites) | **596 passed**, 0 failed |
| Harnesses | **124/124** suites |
| Real-Postgres race lane, fresh database (517 migrations) | **39 files, 141 tests**, 0 skipped (+6: booking-verification concurrency ×5, reconciliation expiry) |
| Live proofs on the real API | refresh re-authorization 10/10 · Phase 2 two processes 22/22 · Phase 3 phone 48/48 · **Phase 4 booking verification 54/54 (new)**: the owner's Test Verify and enable (refused before the test), the customer app 428 → hold → code (salon's Verify, customer's language) → booked "verified", the spent proof, five wrong codes lock and free the slot; the public link (refused, a session from another link refused, send/check, the same idempotency key books, one proof one booking); **the booking-public page in Chromium under its own CSP** (code step, masked number, hold note, wrong code, booked); the AI receptionist (reachable with the key, code already texted, keypad TwiML, forged callback refused, the same Idempotency-Key books, sourced AI); the manager override (reason required, booked "staff_override", no trust, owner alerted); the signed status callback queued once and applied by the worker; the usage panel and Super Admin oversight counts; cleanup |
| Full run | run 1 from a fresh build (findings above); run 2 re-ran gates, the API and the web apps from a fresh build after the fixes — green; modules, packages, harnesses, race and live were green in run 1 and untouched by the run-2 fixes (guard registries, a nav map, the manifest, one POS screen) |
| Mutation checks | **22/23 caught, 1 equivalent** (table above) |

### Completion list — every line DONE or decided
The original spec's 50-item completion list is **not in this workspace** (only the audit's evidence file is); the lines
below are the audit's status table and its 13 bugs, which cover the spec's surface. Kevin: if you have the spec text,
I will check it line by line.

| Audit line | Status | Evidence |
|---|---|---|
| Schema: holds + no-overlap | DONE | migrations 367/372/484; race test: one hold, clean refusal |
| Schema: verification sessions — hold id, versions, correlation never written | DONE / decided | hold id, `policy_version` and the tenant/branch/provider config versions written (pgtest); `correlation_id` decided unused — every lifecycle step is an outbox event carrying the request's correlation |
| Schema: verified phones — `last_booking_at`, `expires_at` | DONE / decided | `last_booking_at` stamped by a proven booking (pgtest); `expires_at` decided not stored — the trust window is a live policy value (a stored expiry would freeze it) |
| Schema: Verify SID, branch scope, validation time; 311 unique | DONE | migration 521 drops it; Test Verify writes them (live §0) |
| Schema: settings, platform policy, usage rollup | DONE | + `bypass_blocked` |
| Schema: attempts / events / rate-limit / fraud-alert / webhook-event tables | decided | no new tables: attempts on the session row (atomic reservation), events on the outbox, rate/fraud counters from the sessions table, fraud blocks to the audit log + owner alerts, webhook dedupe on the job queue |
| Policy resolver; one gate for every channel | DONE | `VerifiedBookingFlow` (+ branch rules, L5) |
| Twilio Verify provider (locale) | DONE | locale passed (live §1 `es`) |
| Credential resolver; internal fallback | DONE | fallback live (salon's own number, hash only; pgtest) |
| Send / check | DONE | + states, atomic attempts, caps |
| Hold service used | DONE | acquire/convert/release (live §1, pgtest) |
| Verified-booking completion | DONE | proof claimed once, labelled, tied (live §1–§4) |
| Settings: countries, language, cooldown, max sends/attempts, lockout, recipients, high-risk inputs | decided | cooldown 60 s, 5 attempts, 10-min codes, per-IP/device caps and lockout are a platform security floor, not tenant-tunable; language = the customer's own (Verify locale); destination country scored by the fraud engine; alert recipients = the salon's owners (owner alerts). The group / deposit / high-value re-verify switches are **hidden** in the POS: no remote booking path has a party size, a deposit step or a high-value threshold to feed them (they could only promise something that never happened); the resolver keeps the capability for a flow that has those inputs, and "verify every booking" covers the strict case |
| Fraud engine | DONE | per-address failed checks, novel country (pgtests) |
| CAPTCHA widget | DONE | customer app, booking-html, booking-public |
| Webhook | DONE | queue + dedupe (live §5, pgtest, M10) |
| Retention / usage jobs | DONE / decided | expiry on the 20 s reconciliation (on by default); the privacy purge stays opt-in (`BOOKING_VERIFICATION_RETENTION_CRON_ENABLED`) — when on, the usage panel's window never exceeds what it can count |
| Manual override | DONE | (e) above; live §4 |
| Super Admin oversight + `module_enabled` setter | DONE | screen + routes; step-up (live §6) |
| Transcript redaction | DONE | unchanged |
| DTMF entry | DONE | sealed callback (live §3; M8) |
| Events / notifications | DONE | (f) above |
| Customer routes policy/send/check | DONE | + session branch (L4) |
| Missing routes: change phone / status / cancel / complete; usage / alerts; webhook retry; public send/check; AI send; Twilio disconnect | DONE / decided | public send/check/captcha/services, voice send, disconnect, usage, override pending/approve added; "complete" is the booking retry itself (claims the proof); "change phone" / "status" are the customer-phone routes (Phase 3); webhook retry = the job queue's retry (Super Admin → Jobs & Dead Letters); alerts = owner alerts |
| Settings routes (+ branches); branch ownership | DONE | branch credential routes check the branch is the salon's |
| Twilio connect / test / status | DONE | Verify SID + API key, Test Verify, status lines |
| Permissions: override | DONE | `booking.override` (M13) |
| UI: customer-web | DONE | 428 loop fixed, hold note, CAPTCHA, change number |
| UI: booking-html / booking-public | DONE | code step on both; booking-public proved in Chromium |
| UI: POS settings / Twilio / override | DONE | dead in-salon switches removed; waiting list + override; usage panel |
| UI: owner-web | decided | the owner manages verification in the POS settings screen (the POS is the owner's back office); owner-web unchanged |
| UI: admin-web oversight | DONE | new screen |
| UI: kiosk | decided | the kiosk makes no bookings (check-in and walk-in only — the guest is in the salon); its switch, like front desk / walk-in, is removed and refused. A future kiosk "book a time" flow must admit through `RemoteBookingAdmission` (channel `kiosk`, no carried trust) |
| Security: session binding | DONE | proof bound to the booking session AND the number; public trust device-bound; sealed sessions per principal |
| Bugs 1–13 | DONE | 1–2, 5 (customer app), 3 (config), 4 (audit sink — real `audit_events` row asserted), 6 (voice), 7 (override), 8 (holds), 9 (webhook), 10 (health counts), 11 (session before send), 12 (copilot), 13 (dead toggles, `module_enabled`) |

### What Phase 4 does NOT do (honest scope)
- Not proved against the **real** Twilio Verify (unreachable here; the loopback fake answers exactly as Twilio does).
- No booking path computes group / deposit / high-value risk flags; their switches are hidden (completion list).
- A booking through the public link or the AI receptionist **without a technician** ("first available") fails in the
  staff engine (`technician_id` NOT NULL) — pre-existing, outside this phase; now logged instead of swallowed. The page
  and the voice gateway pass the technician their availability search returned.
- The CAPTCHA providers' own scripts were not loaded in this environment (no network); the widget path is unit-tested,
  and the no-provider path (fails closed, "call the salon") was seen live in the browser.

### Audit lines this phase closes
customer_booking_phone_verification: the status table and bugs 1–13 above (the "decided" lines carry their reasons);
the audit's "0 of 3 remote channels" verdict.

## Phase 5 — the deals engine, completed: one domain, no oversell, deal-aware refunds (Oct 7 2026)

The audit's verdict was "PARTIAL, roughly 15–20%" with **five parallel discount stores** and live money bugs — oversell,
receptionists unable to apply deals, order-dependent stacking, a cross-tenant branch write, client-supplied prices
(`docs/audit-2026-10-06/spec-deals-engine.md`). Now there is ONE deals domain behind every surface, a capped deal cannot
be oversold on real Postgres under concurrency (proved at the booking door and at the register), and a refund gives the
deal back — proved on the running API.

### (a) The money bugs (1–12) — failing test first, then the fix
| Bug | Was | Now | Proof |
|---|---|---|---|
| 1 oversell | capacity counted only `held` holds; a booked (`consumed`) or used place stopped counting | **capacity ledger**: every use holds one place; taken = held-unexpired + consumed + redeemed, counted under the deal's advisory lock (`dealhold:<id>`) in the same transaction as the insert | race lane: 12 customers / cap 3 → 3; walk-in cap 2 / 10 registers → 2; deterministic interleaving; **live**: 12 customer-app bookings at once → 3, 6 registers at once → 2, 120 registers / cap 40 → 40 (M1, M2) |
| 2 receptionists 403 | apply-deal / apply-promotion required `pos.checkout.apply_discount` (→ `checkout.manage_overrides`, owners/managers) and the POS swallowed the 403 | `deals.apply` capability (front desk, reception, managers, owners); a MANUAL discount stays manager-tier; the POS shows refusals | permissions test (M9); live: the receptionist applies, the same receptionist's manual discount is 403 |
| 3 order-dependent stacking | the last call decided (re-marked stackable, exclusive did not block later offers) | ONE pricing engine (`engine/pricing.ts`): fixed calculation order bundle → membership → deal → coupon → manual → loyalty, the salon's stacking policy (`best_single` / `stack_all` / `stack_groups` / `exclusive`), best-deal over subsets, price floor and max total discount, per-line allocation | `checkout-stacking-order` (every policy, every order); pricing spec (M7) |
| 4 redemption too early, never reversed | counted when picked, the analytics event before the idempotency check | **application ledger** (`deal_redemptions`): `applied` on the ticket → `redeemed` when PAID (one `deal.redeemed`, the count moves then) → `released` (removed / void before capture) / `reversed` (full refund) / `partially_reversed` (refund of the lines it covered) | engine pgtest (M5, M6); **live**: paid → redeemed, full refund → reversed, place released, count back to 0 |
| 5 eligibility not enforced | member/new-only, per-customer, min spend, day/time, lead, technician lock, service scope stored, never checked | `engine/eligibility.ts`: every flag + a nested AND/OR rule builder (13 rule types) judged from real facts, **every** reason returned | eligibility spec (M8); live "why not": sold_out, members_only, wrong_channel |
| 6 date window ignored | reserve and nearby ignored `starts_at`; nothing expired a deal | eligibility + feeds respect the window; the lifecycle job activates scheduled deals and expires ended ones | lifecycle pgtest |
| 7 cross-tenant branch | body `branch_id` written unchecked | branch and services must be this salon's | money-bugs pgtest (M10 — strengthened, see below) |
| 8 client prices | `originalPriceCents` from the request drove the advertised price and the technician minimum | catalog price only (`catalogFor`); the technician app picks from the technician's own services | live: 1¢ sent → $50 catalog, $40 final; tech pgtest (M16) |
| 9 AI upsell TypeError | the adapter passed an object where a function was expected | applies through `applyOffer({ dealId, source: 'ai_checkout_upsell' })` with the front-desk key | adapter spec |
| 10 coupon count race | no cap guard, incremented on every apply, never decremented | hashed codes with a conditional use-count update (single-use exactly once); a release gives the use back | race: 8 registers, one single-use code → 1; shared code cap 3 / 12 → 3 (M3); live |
| 11 booking deal errors → 500 | | DealConflict/Validation/Forbidden → 409/400 with the deal's reason; the phone proof is given back | booking spec (M11) |
| 12 cancel / no-show kept the place | | `deals.release_on_cancel` consumer on `appointment.canceled` / `appointment.no_show` + a lifecycle safety net | consumer pgtest; **live** (after L3 below): cancel in the app → the place is back → a customer told "sold out" books it (M12) |

### (b) One deals domain (expand, then contract)
- Migration **522**: `deals` gains `kind` (deal / coupon / automatic / announcement), rules, priority, stack group, max
  discount, budget (+ reserved, CHECK `deals_budget_within`), channels, `requires_code`, legacy source/id, suspension,
  published/expired stamps; `fixed_price` discounts; `deal_settings` gains the stacking policy, price floor, max total
  discount, the salon's on/off and the platform's switch + live-deal limit; holds gain `redeemed`, ticket and reason;
  `deal_redemptions` becomes the application ledger (status, kind, hold, coupon code, per-line allocations, terms snapshot,
  who/when, reversal, budget, idempotency); new `deal_coupon_batches`, `deal_coupon_codes` (sha256(tenant:CODE) + last-4
  hint), `deal_code_lookup_failures`, `deal_versions`, `deal_daily_stats`. Backfill: `salon_promotions` → coupons (hashed
  codes), `tenant_promotions` → automatic promotions, `customer_deals` → announcements.
- Migration **523** (contract, half 1): triggers refuse writes to `salon_promotions`, `tenant_promotions`,
  `tenant_promotion_redemptions`, `customer_deals`. The DROP is deliberately one release later (decided).
- The old services keep their routes behind adapters over the one domain (POS promotions screens, the tenant promotions
  API, Super Admin promotions management and oversight). Nothing writes a legacy table.

### (c) Coupons, rules, stacking, budgets, snapshots, refunds, receipts
- Codes: generated in batches (up to the batch limit), shown ONCE, stored hashed with the last four; single-use / max-uses
  / per-customer / expiry; revoke with a reason; lookups rate-limited (8 misses per register user, 200 per salon, per
  15 minutes → 429 `DEAL_CODE_LOOKUP_LIMITED`); the customer's wallet carries a QR (`APS-CPN:<couponId>`, never a code).
- Simulator / preview: a draft deal judged and priced against sample services, customer facts, time and other offers.
- Budgets: reserved atomically with the application (conditional update + CHECK); given back on release / reversal.
- Pricing snapshot v2 on the ticket: every offer with deal id, version, per-line allocation; the LOCKED terms of each
  application (a later edit makes a new version; tickets keep theirs).
- Refunds: the preview shows what each service was actually **paid** (its price, minus every discount allocated to it,
  plus the tax on that); refunding services refunds exactly that and reverses only the offers on those lines; a full
  refund / void reverses everything; an amount-only partial refund keeps the deals (the visit happened).
- Receipts and the ticket itemize: "Deal: …", "Coupon: …", "Manual discount" each with its amount and lines — no lump
  "DISCOUNT" chip (bug 14); the SMS carries "You saved $X".

### (d) Audit, events, jobs, gating
- Checkout's audit is persisted to `audit_logs` (bug 13; it was a process-memory array); deal lifecycle changes write
  audit rows in the same transaction as the change.
- The 16 missing events: `deal.created / updated / submitted / approved / rejected / published / paused / resumed /
  expired / sold_out / suspended / reserved / reservation_released / applied / redemption_reversed`,
  `coupon.codes_generated` (plus the existing `deal.redeemed`, `coupon.redeemed`).
- Jobs (`DealsLifecycleScheduler`, single owner, on the job registry): activation, expiry, sold-out, stale holds, the
  cancelled-appointment safety net, reconciling paid tickets, releasing applications left on abandoned tickets; the daily
  aggregation into `deal_daily_stats` — by each **salon's own day** (its branch's zone), not the UTC day.
- Gating: platform kill switch; per-salon platform switch (Super Admin, step-up + reason) and live-deal limit; plan
  feature `deals.engine` and plan limit `active_deals` (+ tenant overrides) — the tightest limit wins; the salon's own
  on/off.

### (e) UI
- **POS**: checkout deals panel (itemized discounts with remove, eligible offers with their value on THIS ticket, "why
  not" with reasons, "Apply best deal", coupon / QR field, refusals said plainly); the refund panel refunds services at
  what they were paid; Deals screen with tabs Dashboard (net discounts, reversals, unpaid on tickets, conversion, CSV
  export) / Deals (kinds, lifecycle, approval queue, version history, codes) / New (5-step wizard: catalog services,
  rule builder, limits & budget, simulator) / Settings (stacking policy, floors, technician policy, the plan's limit).
- **Customer app**: My salon / Nearby (server filters) / Saved / My coupons (QR); a deal page with terms, save, and a
  discounted estimate from catalog prices; guests can browse (bug 20).
- **Technician app**: deals built from the technician's own services at the menu price; whole-number percentages; a
  switched-off salon (salon, plan or platform) reads as "off".
- **Owner app**: Marketing & Growth → Deals & Coupons — net given away, refunds, unpaid on tickets, top deals (pause),
  the approval queue (approve / reject with a reason the technician sees), and why deals are not running when they are not.
- **Super Admin → Deals Oversight** (new): marketplace totals, every deal with filters, suspend with a reason (≥12
  characters; booked places and unpaid tickets given back; audited; the salon sees why), per-salon switch and limit.

### (f) Integrations
| Integration | Status |
|---|---|
| Loyalty | DONE — points are earned on what was paid (the existing payment consumer, after discounts); the salon's "stack with loyalty" switch is enforced by the engine |
| Membership | DONE — `member` / `not_member` rules and members-only deals judged from the customer's membership; "stack with membership" enforced |
| Gift bonus | decided — deals never discount a gift-card sale (the engine prices service lines only), and paying with a gift card does not change what a deal is worth; a gift-card bonus stays the gift-card module's own offer |
| Wallet | DONE — the coupon wallet with a QR the register scans |
| Wallet credit | decided — a deal never pays out as credit; a refund returns what was paid |
| Marketing | DONE / decided — codes generated for a campaign (`purpose: marketing`, `campaignId`); linking a code batch from the campaign editor is not built |
| AI receptionist | DONE — the customer app's assistant reads the one domain; the phone agent has a `get_deals` tool (phone-channel deals; never suspended or full) |
| Scheduling | DONE — day-of-week, time window, lead time judged in the branch's zone at the booked time |
| Forecasting | decided — not fed; `deal_daily_stats` is the feed when forecasting consumes promotions |
| Queue | decided — no deal badge on the queue; the register shows the booked deal ("★ Booked") at checkout |
| QR | DONE — wallet QR applied at the register |
| Abuse | DONE — code-lookup limits; guest routes budgeted per address (60/min; a view counted once per visitor per 30 min) |
| Reports / exports | DONE — dashboard, owner summary, Super Admin totals, CSV of every use (formula-injection safe) |

### Found by the live proof, the lanes and the gates — and fixed
| # | Defect | Fix + test |
|---|---|---|
| L1 | **The phone agent could never call a tool**: `/voice/tool` and `/voice/calls/:id/outcome` (the voice provider's webhook) were not excluded from the session middleware — every call was 401 "No session" before the voice-key guard (the same class as Phase 4's L1, on the other voice controller) | excluded; `sessionless-routes` + `auth-boundary` entries; public-route justification; live §10 |
| L2 | The deals service was never injected into the voice controller (an optional parameter typed `DealsService \| null` emits `Object` as its design type, so Nest injected nothing and the agent said "no specials") | a plain class type; live §10 (M21 covers the channel) |
| L3 | **A customer cancelling in the app emitted no `appointment.canceled`** — nothing downstream heard it; a booked deal's place stayed taken until the safety net | the status change, its change-log row and the event commit together; consumer pgtest end to end (M12); live §4 |
| L4 | **A refund of a service kept the customer's tax** (it refunded the discounted price, not what was paid) | per-line paid = net + tax on it, capped at what can still be returned; preview, POS panel and tests (M23); live §8 |
| L5 | Feeds, the salon list and the phone agent still advertised a deal with every place taken or its budget spent | not advertised (SQL in the nearby feed and the customer list; ledger check for the salon / phone list); pgtest (M15); live |
| L6 | Anonymous traffic could inflate a deal's view count (each view is a row) and hammer the nearby query | `DealsPublicLimiter` on the guest routes (60/min per address; a view once per address per 30 min); limiter spec (M13, M14); live load |
| G1 | The dashboard's days were UTC days (an evening redemption in Los Angeles landed on tomorrow) — flagged by the architecture test's UTC-day idiom check | aggregation by each deal's salon-local day; pgtest (M18) |
| G2 | The permissions checker resolved `pos.deals.apply` by the generic rule and reported it as denying everyone | the checker now reads the guard's explicit exceptions from the same source |
| G3 | The receipt crashed for a ticket without lines (modules lane) | guarded |
| G4 | Unregistered error codes / mirrored frontend types / a float money parse / an unwired client method / an unkeyed tech route | `DEAL_REFUSED` + `DEAL_CODE_LOOKUP_LIMITED` registered (reason codes are the engine's own vocabulary); offer + oversight types moved to `@aipowersalon/api-contracts`; `parseDollarsToCents`; version history wired in the POS; `services.view` on the new tech route |

### Mutation checks (Phase 5) — each broke the code, saw a test fail, restored
| # | Broke | Caught by |
|---|---|---|
| M1 | capacity counts only `held` (bug 1) | real-Postgres race (12 customers / cap 3 …) |
| M2 | the register's cap check off by one | race (walk-in cap 2 / 10 registers; shared code) |
| M3 | single-use code guards removed (bug 10) | race (one code / 8 registers) |
| M4 | budget reserved without its bound | race — **first pass MISSED**: the CHECK constraint still capped the budget, the losers got a raw DB error and the test swallowed every error; it now requires each refusal to be a `DealRefusedError` |
| M5 | redeemed at payment without moving the count | engine pgtest |
| M6 | a full refund leaves the use `redeemed` | engine pgtest |
| M7 | the calculation order changed | pricing spec |
| M8 | members-only not enforced | eligibility spec |
| M9 | `pos.deals.apply` collapsed back to the generic rule | permissions test |
| M10 | a foreign branch accepted (bug 7) | money-bugs pgtest — **first pass MISSED**: the test named an own-branch service, so the service-location check refused it instead; it now also tries a foreign branch with no services |
| M11 | booking deal refusals not mapped (bug 11) | booking spec |
| M12 | the customer app's cancel without its event | consumer pgtest (end to end) |
| M13 | every page load counted as a view | limiter spec |
| M14 | the guest budget removed | limiter spec |
| M15 | a full deal advertised | deals pgtest |
| M16 | a technician discounting someone else's service | deals pgtest |
| M17 | a switched-off salon read as "on" in the tech app | deals pgtest |
| M18 | the day as the UTC day | engine pgtest (10:30 pm in New York) |
| M19 | the CSV's formula guard removed | engine pgtest |
| M20 | the phone hearing customer-app-only deals | engine pgtest |
| M21 | the voice tool asking for the app channel | voice controller spec |
| M22 | the owner summary's approval queue | deals pgtest |
| M23 | a service refund without its tax | checkout spec |

**23 mutants, 23 caught** (two only after the tests were strengthened — M4, M10).

### Verification (Oct 7 2026, this tree)
| Lane | Result |
|---|---|
| Gates | **38/38** — 29 gates + 9 audits. Before run 1 they caught: the permissions checker reading `pos.deals.apply` as deny-all (G2), three new guest routes unreviewed, `kysely.types` drift (5 tables, 4 tables' columns), an unwired client method, an unreached route, a float money parse, lint growth, unregistered error codes, an unkeyed tech route, mirrored API types and the UTC-day idiom (G1, G4) — all fixed |
| API (6 shards) | **1,844 passed**, 0 failed. Run 1 caught five: the plan-catalog read not on the tenant-isolation allowlist (justified: `plan_features` is the platform's catalog), a `Math.random()` in an idempotency key (now `randomUUID`), the OpenAPI generator labelling self-authenticating voice routes "public" (now `api_key`, which also corrects Phase 4's gateway rows), the old `deal.redeemed` producer test on the removed method (rewritten on the ledger: applied → paid → one event), job types built from a constant (literals) — run 2 green |
| Modules (26 suites) | **7,080 passed**, 0 failed (run 1); deals 199 / checkout 552 / ai 1,430 re-run green after the run-1 fixes |
| Web apps (7 suites) | **2,713 passed**, 0 failed |
| Packages (19 suites) | **598 passed**, 0 failed |
| Harnesses | **124/124** suites |
| Real-Postgres race lane, fresh database (519 migrations) | **40 files, 148 tests**, 0 skipped (+7 deals: 12 customers / cap 3; deterministic interleaving; 10 registers / cap 2; one single-use code / 8 registers; shared code cap 3 / 12; budget $25 / six $10 offers; one per customer / 5 tabs) — run 1 and run 2 |
| Live proof on the real API — **Phase 5 deals 39/39 (new)** | the owner builds deals from the catalog (a 1¢ client price ignored; 12.5% refused with a 400); hashed single-use codes shown once; a guest browses, opens a deal (one view, however many refreshes) and gets an estimate; **12 customers book a deal capped at 3 at once → 3**; a customer cancels in the app → the place comes back → a "sold out" customer books it; the receptionist's panel (value here, why not, best deal), applies a deal (manual discount still 403), itemized discounts; **6 registers / cap 2 at once → 2**; a single-use code works once; the code-guessing limit; paid → redeemed; **full refund → reversed, place released, count back**; a service refund returns what it was paid incl. its tax and reverses only its share; Super Admin suspension (reason required, booked places given back, audited, the salon sees why); the phone agent's `get_deals`; the owner summary; the CSV; the persisted audit; **load: 120 registers / cap 40 → 40, no 5xx; 300 guests at once all answered; one address past 60/min → 429**; cleanup (append-only audit rows are kept). Run 1 and run 2 |
| Full run | run 1 from a fresh build (findings above); run 2 re-ran the build, gates, all six API shards, the deals / checkout / ai suites, the race lane on a new fresh database and the live proof — green |
| Mutation checks | **23/23 caught** (table above) |

### Completion list — every line DONE or decided
**The 71-item completion checklist is not in this workspace** (only the audit's evidence file is). The lines below are
the audit's status table and its 21 bugs, which cover the spec's surface. Kevin: if you have the spec's checklist, I will
check it line by line.

| Audit line | Status | Evidence / decision |
|---|---|---|
| Schema: the subset that existed | DONE | 387–389, extended by 522 |
| Schema: versions, coupons/codes/batches, daily analytics, channels, budgets, branch settings | DONE | 522 (`deal_versions`, `deal_coupon_*`, `deal_daily_stats`, `channels`, `budget_*`, settings columns) |
| Schema: rules / rule_groups / actions / targets / segments / schedules / stacking_rules / redemption_items / campaign links / usage events / abuse alerts as separate tables | decided | rules are one validated JSON tree on the deal (versioned with it); targets = `deal_services` + branch + channels; schedules = window + day/time rules; stacking = the deal's group/priority + the salon's policy; redemption items = per-line allocations on the application; campaign link = the code batch's `campaign_id`; usage = `deal_redemptions` + `deal_analytics_events`; abuse = `deal_code_lookup_failures` + 429s |
| Schema: eligibility columns enforced | DONE | bug 5 |
| Schema: pricing snapshot per line with deal id/version | DONE | snapshot v2 |
| Services: lifecycle (update / archive / cancel / expire) | DONE | edit → new version (edits after use only when the salon allows it); cancel, archive; expiry job |
| Services: clone | decided | not built — "Edit" + versions cover reuse |
| Services: eligibility / rules / explanation / preview | DONE | eligibility engine + simulator |
| Services: pricing / stacking / best deal / floors | DONE | one engine |
| Services: coupons (one model) | DONE | hashed codes; both old coupon services are adapters |
| Services: reservations | DONE | capacity ledger (bug 1) |
| Services: budgets | DONE | atomic |
| Services: threshold approvals; self-approval | decided | not built: a salon deal is created and approved by holders of `marketing.manage` (owners/managers); technician deals keep the approval queue; a two-person rule for salon deals is a product decision for Kevin |
| Services: conflict detection | decided | the simulator prices a draft against the other offers under the salon's policy and shows what wins and why |
| Services: AI deal builder | decided | not built (not in BUILD_PLAN row 5) |
| Services: analytics aggregation, jobs | DONE | (d) |
| Services: tenant-scoped cache | decided | none added: every read is an indexed, tenant-scoped query; the nearby feed is bounding-box filtered in SQL (bug 16) and budgeted per address |
| Deal types (~45 in the spec) | DONE / decided | kinds deal / coupon / automatic / announcement × percent / fixed / fixed price × 13 rule types; **buy-X-get-Y, bundles-as-deals, platform-sponsored and gift-with-purchase are not built** (the `bundle` category stays the catalog's bundle pricing in the engine's order) |
| Tax / tip / deposit | DONE / decided | discounts are pre-tax and never touch tips; a refunded service returns its tax (L4); deposit eligibility not built (no booking path takes a deposit) |
| Routes: update, preview, archive, eligible (offers), apply/remove, validate coupon, generate codes, redemption status, stacking settings | DONE | `pos/deals` (PATCH, preview, versions, cancel, archive, coupons, export, dashboard), `pos/checkout/tickets/:id/offers` (+ best, remove), settings |
| Routes: `/tech/deals`, `/customer/deals` | DONE | + services; public, saved, wallet, estimate |
| Routes: `/super-admin/deals` + admin client | DONE | overview, list, tenants, suspend, per-salon switch/limit + screen |
| Routes: checkout apply / booking with deal | DONE | bugs 2, 11 |
| Permissions: administration (`marketing.*`), apply (`deals.apply`), technicians off by default | DONE | |
| UI: POS management, coupons, checkout | DONE | (e) |
| UI: Owner app | DONE | (e) |
| UI: Tech app | DONE | (e) |
| UI: Customer app (detail, saved, coupons, filters, terms, discounted estimate) | DONE | (e) |
| UI: Super Admin oversight | DONE | (e) |
| Realtime | DONE | checkout total refresh on every offer change (unchanged path); technician notified on approve/reject |
| Events (18) | DONE | 16 added + 2 existing |
| Tests: isolation, concurrency, load | DONE | race lane (7 deals tests), cross-tenant suite, live load (120 registers; 300 guests) |
| Bugs 13–21 | DONE | 13 persisted audit · 14 itemized discounts · 15 detail page + views (deduplicated) · 16 bounding-box feed · 17 suspension (reason, audit, release) · 18 `on_auto` goes live · 19 settings enforced + UI · 20 guest routes · 21 validation (400s) |

### What Phase 5 does NOT do (honest scope)
- The legacy tables are frozen, not dropped (one release later, after production shows no writer).
- Not built: BOGO / buy-X-get-Y and the other spec deal types beyond (f) and the table above; threshold approvals;
  clone; the AI deal builder; a campaign editor link to code batches; a queue badge; forecasting input.
- The guest limiter is per API instance (with N instances a single address gets N × 60/min); a global limit belongs at
  the edge.
- The load figures were taken on this 2-core workspace with the test lanes sharing it — they show correctness under load
  (no oversell, no 5xx), not production latency.

---

## Phase 6 — `ai_queue_assignment`, completed: one engine, assignments through the queue, no overwrite (Oct 7 2026)

The audit's verdict was "PARTIAL, about 35%" (`docs/audit-2026-10-06/spec-ai-queue-assignment.md`): the requested
technician, appointment protection and stuck detection looked finished but never worked; four technician recommenders,
two detection engines and three auto-assign switches ran side by side; a decision recorded but never assigned; the
auto-run could overwrite a guest staff had just assigned. Now there is ONE engine behind every board, decisions and the
auto-run act only through the queue's own assign (version + expected technician + idempotency key + status history), and
the overwrite race is closed — proved on real Postgres and on the running API with real queue entries.

Built by five agents in parallel against one written contract (`queue domain` / `AI service + engine` / `ops: detection,
alerts, jobs, notifications, analytics, Super Admin API` / `POS web` / `Super Admin, owner, tech, customer, kiosk`), then
integrated, gated and proved here.

### (a) The audit's 16 bugs
| Bug | Was | Now | Proof |
|---|---|---|---|
| 1 requested / previous technician | `detail()` never returned them → always null; every technician given the caller's branch | `assignmentInputs` carries both (previous stamped at check-in by migration 525, computed fallback); technicians carry their REAL branch | `queue-assignment-inputs`, `queue-phase6.pgtest`, `-engine-inputs` "bug 1" |
| 2 appointment protection | `Date.parse('HH:MM')` → NaN; the server's UTC day | the appointments domain resolves `appt_date` + 'HH:MM' in the BRANCH zone (`startAt`); its default day is the branch's | `tech-appointments-branch-zone.pgtest`, `-appointment`, `-adapters` |
| 3 stuck detection dead | `updatedAt` = now; statuses that don't exist | real `updated_at` (525 trigger, every writer); real status vocabulary; stuck window from settings | `queue-phase6.pgtest`, `-detection`, `-ops.queue-integration` (real QueueService) |
| 4 20-row page | scan / auto-run / workload saw 20 entries; `loadAll` read the whole history | `activeEntries()` unpaged; boards read active + today | pgtest (25 guests); **live: the auto-run considered 25 waiting guests** |
| 5 auto-run overwrites | no `expectedTechnicianId`; `assigned` was assignable | AI sources may assign only waiting / called / ready-for-tech, must send the expected technician; compare-and-set on status + technician + version | `queue-phase6.postgres-race` (4), `-auto.postgres-race` (6 rounds, both orders); **live concurrency** |
| 6 requested-technician conflict; `ai.auto_actions` ignored | | a different pick than the guest asked for is staff review, never auto; every switch (platform, salon kill, location) in `effective().autoAllowed` | `-auto` (19), `auto-config-queries.pgtest` |
| 7 POS screen crashed on load | `GET rotation-policy` answered a bare string | `{ policy, fixedOrder }` from the one settings source; each POS card loads on its own | `-rotation`, `POSAIQueueAssignmentScreen.test` |
| 8 decision realtime dropped | names not in the emitter map | `queue.assignment_decided` (+ settings / locked / unlocked) mapped | `-service` "bug 8" |
| 9 resolved alerts listed with "Resolve" | | unresolved by default, `?status=all` on demand; closed alerts have no actions | `-alerts`, POS alerts tests |
| 10 drag-drop / Send Break | no expected technician; Send Break a placeholder | every POS assign path sends `expectedTechnicianId` (+ version); 409 in plain words; Send Break uses the live-schedule break API | POS Queue / Tech Queue tests, `queueConflict.test` |
| 11 Auto Balance preview wrong | load never filled; requested forced null | the preview IS the engine's capacity-aware `balance()`, apply carries expected technician + version | `queue-auto-balance` |
| 12 Super Admin overview | "tenantsEnabled" counted branch rows; a status AiPlatform never writes | distinct salons on the effective switch; real AI-call statuses | `-superadmin` |
| 13 auto counted as accepted | | decision `auto_assigned` (applied) + `QUEUE_AUTO_ASSIGNED`; rates over staff decisions only | `-auto`, `-ops`; live analytics `autoAssigned` |
| 14 empty branch | `''` into a UUID column; every technician `wrong_branch` | 400 "choose a location" (AI layer); the queue uses the guest's own branch or refuses; non-UUID ids refused before SQL | `-service` "bug 14", queue tests |
| 15 queue audit in memory | | `pos_queue_audit` written in the same transaction as the change | `queue-phase6.pgtest`, `queue-transitions` |
| 16 stale reconciliation doc | | decided — the guard and catalog paths named in the audit are the live ones; the stale doc is superseded by this section |

### (b) One of each (the parallel implementations)
- **One recommender.** The queue board's "Best Match", the Tech Queue best match and Auto Balance all come from the
  engine through a global `QUEUE_RECOMMENDER` (resolved lazily — no module cycle); the queue's own scorers are deleted.
  Only the engine judges breaks, appointments, capacity, locks and the requested technician.
- **One detection core.** `ai-queue-assignment-detection.ts` (wait ladder, congestion scaled per technician, stuck
  window, late appointment, long service, overloaded technician) — the Super Admin live-queue monitor delegates to it
  (exported as `QueueDetection`) and "agrees minute for minute" (its test); its own thresholds are gone.
- **One switch, one rotation config.** `queue_assignment_settings` / `queue_assignment_tenant_settings` (salon → location
  layering, null = inherits, versioned in `queue_assignment_settings_versions`, audited, a stale save is 409). The retired
  `queueWorkflow.autoAssign` / `assignBy` and the queue DTO's `autoAssignTechnicianEnabled` are removed (old saved values
  are dropped on read and on write).

### (c) Schema (524–527)
524: `pos_queue_items.version / position / group_id / late_minutes / previous_technician_id`, `pos_queue_status_history`,
`queue_assignment_locks`, `queue_groups`, `queue_service_assignments`, `queue_assignment_tenant_settings`,
`queue_assignment_settings_versions`, decision `auto_assigned` + reviewer, more alert types. 525: triggers — every writer
bumps the version, stamps a real `updated_at` and writes a history row; idempotency keys unique per salon. 526:
`config_version` text. 527: location columns nullable (inherit), `notified_severity`, indexes.

### (d) Decisions, auto-assign, locks, events, jobs, notifications, roles
- Accept / reject (reason required) / override (needs `ai_queue_assignment.override`) / keep unassigned; the decision
  row and its event commit together; a retried key replays the first answer (no second assignment, no second row).
- Auto-assign: off by default; exclusions (VIP, appointments, groups, services, technicians, guests who asked for
  someone), delay, per-run cap, confidence floor; the location kill switch, the salon kill switch (owner re-arms), the
  Super Admin's salon kill (step-up + reason, audited) and the platform `ai.auto_actions` switch. A tie between equal
  technicians is never auto-assigned (staff review).
- Locks pin a guest to a technician (or to "nobody yet"); only a manager override moves a locked guest, never the
  auto-run. Reorder (versioned, all or nothing), parties, per-service technicians (recorded and shown).
- Domain events: decided, auto-assigned, auto-assignment disabled, locked / unlocked, reordered, alert raised / resolved,
  settings changed, group created — all through the outbox in the same transaction; the realtime projection delivers
  them (salon-wide changes to the owner's room).
- Per-location background jobs on the job queue (scan + auto-resolve, auto-run; the salon must be active and entitled,
  switches re-checked each run; `AI_QUEUE_OPS_JOBS=off` disables). High / critical alerts notify the owner's alert feed and
  push the location's managers, once per severity, with no guest name or phone.
- Role matrix: front desk / reception view, recommend, assign, resolve alerts; managers add override, rules, automation,
  export.

### (e) UI
- **POS**: the AI screen rebuilt — guest picked from the live queue (no raw ID box), per-customer panel (candidates,
  suggestion, accept / reject with reason and feedback code / override / keep unassigned / lock), overview tiles,
  decision history, alerts with repair, settings (salon + location, inherit vs override, versions, kill switches),
  rotation + fixed order, auto (why it is off, run), analytics + usage + CSV. Queue and Tech Queue on the engine, drag
  reorder, lock badge, parties, per-service technicians, history, availability; Send Break real; retired toggles removed
  from Settings.
- **Super Admin → AI Queue Assignment** (new): platform overview, salons, salon detail, salon kill switch (step-up).
- **Owner app**: branch comparison card + CSV. **Tech app**: "Suggested by AI / Auto-assigned / Locked to you / Guest
  chose you". **Customer app** and **kiosk**: when the requested technician is busy, "See X" or "Keep waiting"; accepting
  another technician is recorded (source customer / kiosk); 409 when that technician was just taken.

### Found by the live proof, the lanes and the gates — and fixed
| # | Defect | Fix + test |
|---|---|---|
| L1 | **No decision, auto-assign or settings event was ever written in the running API**: the core module injected `OutboxWriter` `{ optional: true }` without importing `EventsCoreModule` (not global) — every unit test hands the writer in, so all passed | the module imports it and injects it required (ops module too, instead of `new OutboxWriter()`); new guard `outbox-wiring.guard` — no optional writer anywhere, every module injecting it imports its provider (3 mutants caught); live: the decision event is in the outbox |
| L2 | The ops layer (alerts, settings, Super Admin kill) had a SECOND direct realtime emission site (§343) | it delegates to the AI layer's one emitter for a location; salon-wide changes go through the domain event + projection to the owner room; `ops.emitter` + `queue-assignment-projection` specs (6 mutants caught) |
| G1 | A hand-built system context; two UTC-day idioms (architecture test) | `systemContext()`; days via `businessDate` / `utcDate` |
| G2 | An alias collision in the jobs' SQL (`check:sql:select`); `export * as` not parsed by the module-entry audit | alias renamed; `import * as … ; export { QueueDetection }` |
| G3 | Two new race files used the same tenant code (`RACEB`) → the booking race file failed on a fresh DB | unique codes |
| G4 | `is distinct from from_technician` read as a table by the schema guard; two literals named the retired package code (`'ai_queue_assignment'`) | rewritten; owner-alert category `queue_alert`, system actor `ai_queue_auto_assign` |
| G5 | The kiosk's test never ran in CI (no vitest config); its `_headers` hash was stale after the HTML changed | config added (the apps lane now runs it); headers regenerated |
| L3 | The auto-run-vs-receptionist race test asserted "both orders happened" but staggered the writers with a 60 ms timer — the auto-run reads for longer than that under load, so the receptionist could win every round (failed in run 2) | the order is now MADE: the gate holds the guest's row, the first writer is started and the test waits until Postgres shows it queued behind the gate before starting the second (row-lock waiters are served in order); it also asserts the first in line wins; 4/4 repeated runs green; the bug-5 mutant is still caught |

### Mutation checks (Phase 6)
**263 mutants across the five lanes and the integration: 254 caught.** Every real survivor was closed by strengthening
the test and re-running (A: compare-and-set removed; concurrent same key — the race spec had been skipped; tech assign
source; alternates offered when free · B: the PG fake treated an omitted expectation as "nobody" · C: a mutation that
added dead code instead of removing · D: lock to "nobody" defaulted the same as the mutant). Two documented survivors are
equivalent / by design (the adapter always sends "nobody yet"; removing only the advisory lock still leaves the unique
index backstop — removing both is caught). One not run: mutating migration 525 would have rebuilt the shared test
schema under four running agents; its behaviour is pinned by `queue-phase6.pgtest`. Logs: `scratchpad/p6/mutations-*.txt`.

### Verification (Oct 7 2026, this tree)
| Lane | Result |
|---|---|
| Gates | **38/38** — 29 gates + 9 audits. Before run 1 they caught G1, G2 (above), a second direct-emission site (L2) and the tenant-isolation allowlist reason for the alert repository (re-reviewed: every statement names the tenant AND the branch) |
| API (6 shards) | **1,853 passed**, 0 failed. Run 1 caught three: the retired-package guard (G4), the kiosk `_headers` (G5), the schema guard (G4) |
| Modules (26 suites) | **7,293 passed**, 0 failed |
| Web apps (8 suites — the kiosk now included) | **2,814 passed**, 0 failed |
| Packages (19 suites) | **598 passed**, 0 failed |
| Harnesses | **124/124** suites |
| Real-Postgres race lane, fresh database (523 migrations) | **43 files, 161 tests**, 0 skipped (+3 Phase 6 files: one guest assigned at once by staff / AI / older boards / a stale version / the same idempotency key; the auto-run vs a receptionist, both orders; concurrent alert scans and scan jobs). Run 1 caught G3; run 2 caught a **flaky** race test (L3) |
| Live proof on the real API — **Phase 6 queue 33/33 (new)** | `scripts/live-phase6-queue.mjs`, real queue entries: suggestion → accept assigns through the queue (version 2, one history row, the decision event in the outbox) and a retry replays; reject needs a reason; override needs the right; a stale board 409; a manager's lock refuses another technician; reorder; a party; settings versioned (stale save 409); front desk 403 on rules / automation / export; the auto-run considers all 25 waiting guests and stops at the cap; location kill, the Super Admin's salon kill (403 until step-up), release audited; **the auto-run and three receptionists on one guest at once → one assignment, one history row, version 2, every loser 409 / `changed_meanwhile`**; a 150-minute wait raises critical alerts, notifies the owner once, auto-resolves on assignment and on service start; the customer accepts another technician from the app (another customer cannot); overview, analytics, owner summary, CSV; everything removed, the salon's settings row restored exactly. It found L1 |
| Full run | run 1 (findings above) → fixes → run 2 from a fresh build: gates, six API shards, modules, apps, packages, harnesses, race lane on a fresh database, live proof — green except L3, fixed, then the race lane re-run on another fresh database (161/161) and the gates (38/38) |
| Mutation checks | **254 of 263 caught** (above) |

### Completion list — every line DONE or decided
**The ~60-item Definition of Done is not in this workspace** (only the audit's evidence file is). The lines below are the
audit's status table, its three parallel implementations and its 16 bugs (above). Kevin: if you have the DoD list, I will
check it line by line.

| Audit line | Status | Evidence / decision |
|---|---|---|
| Schema: recommendations, candidates, decisions | DONE | unchanged + reviewer, `auto_assigned` |
| Schema: rotation state (`last_served_tech` never read) | DONE | fixed-order rotation reads the queue's last served, then rotation state |
| Schema: alerts + settings per-branch, 4 types, unversioned | DONE | 524 / 527, salon → location layering, versions |
| Schema: queue version, status history, groups, locks | DONE | 524 / 525 |
| Schema: technician status / skills / availability, congestion / stuck tables, rule versions, usage tables | decided | signals are computed from the existing schedules, clock-ins, breaks, blocks and appointments (no copies to drift); rule + reco + config + queue versions recorded on every recommendation; usage from `ai_usage_logs` |
| Schema: per-technician overlap constraint | decided | not added — a guest may wait assigned to a busy technician; capacity is the engine's hard rule |
| Services: hard-rule gate | DONE | branch, clocked in, skill, capacity, break, blocked, appointment, station, lock |
| Services: ranking, alternates, confidence, versions | DONE | model / prompt version not recorded (decided: the engine is deterministic; the model only phrases the explanation) |
| Services: preference levels, language, accessibility | NOT BUILT (decided) | no data for them exists in the schema; a product decision |
| Services: late arrival / grace | PARTIAL | `lateMinutes` computed in the branch zone and alerted (late appointment); it does not change ranking |
| Services: rotation (5 policies), workload | DONE | |
| Services: multi-service / groups / simulation | PARTIAL / decided | per-service technicians recorded and shown, parties created and listed (excluded from auto-assign); the engine still needs one technician for every category; no what-if simulation |
| Services: wait / unassigned / congestion / stuck detection, auto-resolve | DONE | live: raised, notified once, auto-resolved |
| Services: repair workflow | DONE | changes the queue through its own methods (expected technician + version), logged + audited; only unassign / reassign record source `repair` |
| Services: auto-assignment | DONE | (d) |
| Services: decisions act + idempotent | DONE | live |
| Services: explanations ("is the best match" forbidden) | DONE | "Suggested: X" |
| Services: analytics / branch comparison / exports | DONE | exports are not audit-logged; CSV inline, capped at 20,000 rows |
| Services: notifications, background jobs, config audit, domain events | DONE | (d) |
| Routes: overview, queue views, reorder, lock / unlock, availability, branch comparison, usage, exports | DONE | job retry is the job queue's own (Phase 2) |
| Permissions: role matrix | DONE | |
| UI: POS AI screen, Queue / Tech Queue | DONE | (e); the Queue screen's history is an inline list, not a drawer |
| UI: Owner / Tech / Customer / kiosk | DONE | (e) |
| UI: Super Admin screen | DONE | (e) |
| Realtime | DONE | registry names, one emitter, projection for salon-wide |
| AI package: platform kill switch / feature flag / usage | DONE / decided | `ai.auto_actions` read; the platform feature key `ai_queue_assignment` (MIG 471) is still not read — the gate stays the package entitlement |
| Tests: adapter integration, API, realtime isolation, concurrency, load, E2E | DONE / partial | adapter integration against real `QueueService` (PGlite), controller / API specs, realtime projection + emitter specs, real-Postgres races (queue, auto-run, alert scan), live proof with concurrency; **no browser E2E of the new screens** (jsdom against mocked fetch) |

### What Phase 6 does NOT do (honest scope)
- No browser run of the new POS / Super Admin / owner / tech / customer / kiosk screens against the live API — they are
  tested in jsdom against mocked responses; the live proof drives the same API the screens call.
- Preference levels, language / accessibility matching, multi-technician routing at serving time, parties assigned side
  by side, what-if simulation: not built.
- Several response types are still declared in the apps (owner / Super Admin / POS ops reads) rather than in
  `@aipowersalon/api-contracts`; the mirrored-types gate passes, but they are copies.
- The live proof stamps the Super Admin session as stepped-up in the database (the password + TOTP step-up itself is
  proved by its own tests).

## Phase 7 — `ai_scheduling_optimizer`, completed: reviewed, customer-approved, applied through the booking service (Oct 8 2026)

The audit's verdict was "PARTIAL, roughly 15–20%" (`docs/audit-2026-10-06/spec-ai-scheduling-optimizer.md`): a well-tested
library of pure functions behind a broken skeleton — every accept / reject answered 409 (rows were stored in a state the
workflow could not leave), `generate` never ran the hard-constraint gate yet stored `hardConstraintsChecked: true`, the
"simulation" returned metrics the client sent, `PUT settings` ignored its body, technicians could generate and apply, and
nine of fourteen tables were never written. Now a recommendation is **generated** on the server (real gate, real
simulation), **reviewed** by staff, **approved by the customer** in the customer app and **applied** through the booking
service with the appointment's version — proved on the running API with real appointments (`scripts/live-phase7-scheduling.mjs`, 31/31).

Process (Kevin's speed-up asks, applied): the lead wrote the shared pieces first — migration 528, the Kysely types, every
wire type in `@aipowersalon/api-contracts`, the permission keys, event and realtime names and a ports file between the
engine and the operations half — so the three agents (A engine + tenant API, B operations, C every UI) built against
fixed shapes and **no second agent round was needed**; the live proof ran before the full lane run; one full lane run.

### (a) The audit's bugs
| Bug | Was | Now | Proof |
|---|---|---|---|
| Review workflow broken | rows stored `generated`; accept / reject / return need `review_*` → always 409 | a recommendation is stored `review_required`; a decision from it records `start_review` then the decision (both rows in `schedule_recommendation_decisions` with before / after) | `.service` spec; **live: generate → accept → customer → apply** |
| `generate` skipped the gate | `hardConstraintsChecked: true` without a check | the server loads the appointment, picks or validates the target, runs `checkHardConstraints` on the real context; a violation is 422 with the violations and nothing is stored | `-day`, `.service`; live: 06:00 → 422 `OUTSIDE_HOURS`, 0 rows |
| Simulation was the client's | `simulateProposed` returned `proposed.afterMetrics` | the day is re-measured with the appointment moved (`ai-scheduling-day.ts`, pure); client metrics are ignored | `-day` (17) |
| "Touches confirmed" from the client | `!!proposed.touchesConfirmedAppointment` | derived on the server: the appointment has a customer and its time changes, or the technician the customer chose changes | `.service`; live: customer appointment → needs approval, walk-in → does not |
| Apply on a client target | apply took `startTime` / `technicianId` from the body | apply uses the STORED `proposed_state` and the stored snapshot (start, technician, version); a moved appointment is 409 `STALE_SCHEDULE` and never overwritten; booking `reschedule` gets `expectedVersion` | `-application`, `.service`; **live: hand-moved → 409, the hand move stands** |
| Unconditional status writes | `UPDATE … SET status` | compare-and-set on `version` + `status`; a stale `expectedVersion` is 409 `VERSION_CONFLICT` | `.pgtest`; race spec (two accepts → one wins); live 409 |
| Retry key fixed | `…:1` forever | `${tenant}:${rec}:apply:${applyAttempt}`; retry increments the attempt; a repeat call replays the recorded result | race spec (two concurrent applies → one booking reschedule); live: repeat apply → one applied row |
| `PUT settings` ignored the body; config version always 1 | | writes the layer conditionally on `expectedVersion` (0 = insert), version + 1, a `scheduling_rule_versions` row, audit, `schedule.settings_changed` (+ `automation_disabled` on a kill switch); the recommendation records the real config version | `-settings`, `.pgtest`; live: v1, stale save 409, disable → generation 403, v3 |
| Audit lost | sink called `AuditService.log` | `auditSinkFor().record()`; the resource type follows the action; a job / Super Admin context no longer puts a non-uuid into `actor_user_id` (which failed the write) | `-audit` spec; live: audit_events rows |
| Permissions borrowed from booking | `pos.ai_scheduling_optimizer.*` → `booking.view/manage`; every technician (holds `booking.manage`) could generate / accept / apply; `ai.scheduling.approve` granted to nobody | own keys `ai_scheduling.view / view_own / generate / review / approve / apply / configure / export`; owner all, manager all but configure, front desk view + generate, technician view_own; the AI Center approval filter uses `ai_scheduling.approve` | `-permissions`, `ai-feedback`, `permission-reachability`; live: front desk 403 on accept / apply / settings / export |
| Branch users saw null-branch recommendations | `branch_id = X or branch_id is null` | the session's branch only; a technician sees only recommendations that touch them (`GET recommendations/own`, `tech/ai-schedule/changes`) | `.pgtest` |
| Data feed | `techShifts:[branchHours]`, `breaks:[]`, `timeOff:[]`, gap / utilization signals 0, services summed into one block, "the session branch" as the technician's branches, `in_progress` as a lock status (not a status) | per-technician shifts (weekly row, date shift overrides, store hours fallback), lunch + `breaks` jsonb, blocked times, approved time off (new `technician_time_off`), booking buffer + per-service setup / cleanup (`service_scheduling_profiles`), one block per service in order with the duration hierarchy (approved learned duration for technician → for service → catalog), group size, locks = arrived / checked_in / waiting / in_service / completed, a paid deposit, or a manual lock (`appointment_schedule_locks`); real technician branch membership; real gap-leftover and utilization signals | `-day`, `.service`, `.pgtest` |
| Four utilization formulas | | the optimizer's duplicate is deleted; `ai-scheduling-day.ts` uses the canonical rule (booked ÷ (scheduled − breaks), as `workforce/tech-utilization`) | `-day` |
| Options were `{ id, score }`, no holds | | full option (technician, name, start / end, per-service blocks, score breakdown, reasons, fallback flag), lead time / horizon / interval from settings, live holds excluded, `hold` creates a `booking_holds` row through the booking module | `.service`; live: hold created and released |
| Option finders bypassing the optimizer | Reception Copilot and the AI receptionist had their own | both go through `findOptions` (a global bridge token — no module cycle; booking's path stays as the fallback when the optimizer is off); customer self-booking stays on `booking.service.availability` (booking cannot depend on ai — decided) | copilot / voice specs |
| LLM explanation never invoked; "Optimize schedule" LLM button | | `schedule.explain_suggestion` through `AiPlatform` with only computed facts (no customer data), template fallback, usage metered; the booking screen's LLM panel is removed (link to the optimizer) | `-explanation`; POS booking test |
| Ad-hoc Super Admin support gate; "auto actions" counted manual applies | | one salon's detail needs an active canonical `support_access_sessions` row; writes need step-up and are audited; applied split manual vs automated from `automated` | super-admin specs; live |
| Two nav entries; dead client methods; `{query}` filter | | one entry (the old route redirects); every client method used; filters sent as `status` / `type` | pos-web nav + api tests |

### (b) Built (the audit's MISSING rows)
- **Schema (528)**: status CHECKs on every workflow table, FKs between the optimizer's tables (NOT VALID — new rows),
  the columns the workflow needs, `technician_time_off`, `appointment_schedule_locks`, `service_scheduling_profiles`, one
  live proposal per recommendation, one rule version per scope. Old `generated` rows moved to `review_required`.
- **Customer proposals**: accepting a change that needs the customer opens a proposal (the original appointment untouched),
  notifies the customer through the salon's messenger with a customer-app link, and keeps the recommendation alive for the
  proposal's window; the customer approves / declines in the customer app (`/appointments/proposals`); staff may record a
  phone decision; the manager is notified of the answer; another customer can neither see nor answer it.
- **Runs**: branch-day / technician-day runs (idempotent key) write runs, gaps (lunch is not a gap), conflicts and
  understaffing, metrics, and one recommendation per beneficial move; calendar indicators read them.
- **Insights**: nightly duration statistics → learned-duration recommendations (≥ 10 samples, ≥ max(5 min, 15 %)),
  staffing coverage, open / close availability — each approved or rejected (`ai_scheduling.approve`); an approved duration
  is what the engine uses (the catalog is not changed).
- **Rollback / retry**: rollback reschedules back through the booking service with the current version; retry is a new
  attempt with a new idempotency key.
- **Events + realtime**: 13 `schedule.*` domain events through the outbox; the projection consumer maps them to
  `schedule_recommendation_updated / run_completed / settings_changed / proposal_updated` (owner room when salon-wide).
- **Jobs** (Phase 2 queue, per tenant / branch, `systemContext()`, `AI_SCHEDULING_JOBS=off` disables): daily branch scan for
  today and tomorrow, expiry sweep, nightly duration statistics + insights.
- **Automation runner**: off by default; only allow-listed internal actions with no appointment or customer (open / close
  availability, duration, staffing, gap rule) above the confidence threshold; location / salon / platform kill switches stop
  it; everything touching an appointment or customer stays manual.
- **Usage**: `ai_usage_logs` (runs billed, the rest recorded at 0; LLM cost from the platform's own row). **Export**: CSV of
  recommendations / runs / insights (formula-leading cells escaped). **Owner** branch comparison; **tech app** changes that
  touch me; **Super Admin** overview, salons, detail (support session), retry / rollback / disable / platform switch.
- **UI**: POS optimizer screen rebuilt (Overview, Recommendations + detail, Find a time, Gaps & conflicts, Customer
  approvals, Insights, Time off & locks, Settings, Usage & export, History) with buttons by permission and realtime refetch;
  booking calendar overlay (gap strips, conflict badge, "AI" badge, lock icon); owner card; tech badges; customer proposals
  screen + banner; Super Admin AI Scheduling oversight screen.

### Found by the live proof and the integration — and fixed
| # | Defect | Fix |
|---|---|---|
| I1 | Audit rows from a job / automation / Super Admin context carried `userId = 'system:…'` into the uuid `actor_user_id` (the write failed, the row was lost); every audit row said `scheduling_recommendation` even for settings / runs / holds | `schedAuditUserId` (the ref goes to metadata) + `schedAuditResourceType`; `-audit` spec |
| I2 | The permission-reachability pin still named the retired key | pinned to `ai_scheduling.view` |
| I3 | The CSV export's raw `fetch` is invisible to the unreached-routes audit | recorded in the baseline (the call exists: `posAiSchedulingOptimizerApi.exportCsv`) — an audit blind spot, not a dead route |
| G1 | Seven inline `toISOString().slice(0,10)` days (architecture test) and one SQL alias collision | `utcDate` / `businessDate`; alias renamed (agents) |
| G2 | The four operations controllers were registered by spreading a constant into `controllers: [...]`, which the no-orphaned-controllers guard cannot read (the routes did load — the live proof called them) | listed by name in `AiSchedulingModule`; guard green |

### Mutation checks (Phase 7)
**104 mutants: 103 caught, 1 equivalent.** A 31/31 (the apply double-guard is caught only with both guards removed — the
race spec), B 29/29 after strengthening four weak tests (Kysely CAS version predicate, two tenant scopes, the automation
applier's SQL guard; 25 caught first pass), C 43/44 (two misses closed by new tests; one equivalent: an effect corrects the
initial tab). One real bug found by a test before any mutation: the platform switch's cache never worked when the first
read happened at clock 0. Logs: `scratchpad/p7/mut-{A,B,C}.md`.

### Verification (Oct 8 2026, this tree)
| Lane | Result |
|---|---|
| Gates | **38/38** — 29 gates + 9 audits (before the run they caught the UTC-day idioms and an SQL alias collision — G1) |
| API (6 shards) | **1,860 passed**, 0 failed. Run 1 caught one: the no-orphaned-controllers guard (G2) — fixed, shard re-run 287/287 |
| Modules (26 suites) | **7,450 passed**, 0 failed |
| Web apps (8 suites) | **2,880 passed**, 0 failed |
| Packages (19 suites) | **598 passed**, 0 failed |
| Harnesses | **124/124** suites |
| Real-Postgres race lane, fresh database (524 migrations) | **45 files, 164 tests**, 0 skipped (+2 Phase 7 files: two concurrent applies of one recommendation → one booking reschedule; two accepts with the same version → one wins, one 409; two concurrent customer approvals → one decision) |
| Live proof on the real API — **Phase 7 scheduling 31/31 (new)** | `scripts/live-phase7-scheduling.mjs`, real appointments booked through the booking API: settings versioned (front desk 403, stale save 409); an infeasible target → 422 with violations, nothing stored; **the receptionist generates (server gate + simulation, touches the customer's appointment) → the front desk cannot accept (403), a stale version 409 → the owner accepts → a proposal; apply before the customer answers 409, the appointment untouched → the customer sees it in the customer app (another customer cannot see or answer it) and approves → the front desk cannot apply → the owner applies: the appointment moves 14:00 → 11:30 through the booking service (version 1 → 2)**; a repeat apply does not apply twice; the proposal is marked applied; a walk-in's move needs no customer; a hand-moved appointment → 409 STALE_SCHEDULE, the hand move stands; rollback back to 14:00; every step's `schedule.*` event in the outbox; options + a booking hold (released); a branch-day run with gaps and an idempotent key; calendar, owner summary, usage, CSV (front desk 403); disabling the location stops generation; Super Admin overview, detail only with a support session, platform switch only with step-up — then generation refused; audit rows; everything removed, the platform switch row and salon settings exactly as before. Run 3 times while integrating (target inside the 5-minute buffer and a preserve-schedule rec were proof-design errors, not product bugs); final run after the last change 31/31 |
| Full run | one run: gates, six API shards, modules, apps, packages, harnesses, race lane on a fresh database, live proof — green except G2; fixed, then the affected shard, the optimizer suites, the gates and the live proof re-run green |
| Mutation checks | **103 of 104 caught**, 1 equivalent (above) |

### Completion list — every line DONE or decided
**The ~70-item exit checklist is not in this workspace** (only the audit's evidence file is). Checked against the audit's
status table and build order. Kevin: if you have the checklist, I will check it line by line.

| Audit line | Status | Evidence / decision |
|---|---|---|
| Schema: 14 tables used, FKs, CHECKs, version | DONE | 528; every table written (impacts, decisions, proposals, applications, runs, gaps, conflicts, insight tables, rule versions) |
| Schema: shifts, breaks, time off, holds, locks, stations, equipment | DONE / decided | time off + locks + service profiles new; **stations / equipment dormant** — `pos_stations` are checkout terminals, not service chairs; no equipment data exists |
| Services: gate, soft objectives, fallback, scopes | DONE | technician-day + branch-day runs; single-appointment generate; branch-week / multi-branch scopes not exposed (decided: runs are per day per location) |
| Services: gap / conflict / understaffing detection | DONE | runs + daily job |
| Services: busy-hour forecast | DONE / decided | read with the caller's own permissions — front desk lacks `reports.view`, so it gets "forecast unavailable" + lower confidence rather than a silent permission boost; no no-show risk model |
| Services: staffing / availability / duration learning + hierarchy | DONE | insights + approval; insight capacity uses weekly schedules minus lunch (not time off) |
| Services: multi-service + group | DONE | per-service blocks in order; group size vs service profiles |
| Services: buffers / locks / simulation / review / customer approval / apply / rollback | DONE | live |
| Services: settings, kill switches (location, salon, module, platform), allowlist | DONE | live: location disable, platform switch (step-up) |
| Services: controlled automation | DONE | internal actions only (decided); nothing customer-facing is automatic |
| Services: LLM explanation + metering | DONE | the live run used the template (no AI words configured in this database) |
| Services: holds, AI receptionist + Reception Copilot on options | DONE / partial | services use `findOptions` + holds; **the voice / copilot controllers do not yet pass `hold`** (the capability is in the services) |
| Services: audit, events, realtime, jobs, notifications, exports, usage | DONE | |
| Permissions | DONE | role matrix above |
| UI: POS tabs, settings, generate / apply / proposals, calendar indicators, LLM button removed, one nav entry | DONE | |
| UI: Owner / Tech / Customer / Super Admin | DONE | the Super Admin detail lists failed applications; rollback from Super Admin is reachable only for a recommendation listed there (applied ones are not listed — decided: rollback is the salon's action; Super Admin retry covers failures) |
| Tests: service, API, isolation, concurrency, e2e, load | DONE / partial | unit + PGlite (two tenants) + real-Postgres races + the live proof; **no browser E2E of the new screens and no load test** |

### What Phase 7 does NOT do (honest scope)
- No browser run of the new screens against the live API (jsdom against mocked responses); the live proof drives the same
  routes the screens call.
- No load test; branch-week / multi-branch optimisation scopes; station / equipment constraints (no data); no-show risk.
- The voice-receptionist and copilot HTTP controllers do not pass `hold` yet.
- The Super Admin action responses (retry / rollback / disable / platform switch) are `{ ok, … }` shapes declared in the
  module, not in `@aipowersalon/api-contracts`.
- The live proof stamps the Super Admin session as stepped-up in the database (the step-up itself is proved by its tests).

## Phase 8 — `tenant_safety_community`, completed: drafted, approved, moderated, published to other salons — in a real browser (Oct 8 2026)

The audit's verdict was "PARTIAL, about 30%" (`docs/audit-2026-10-06/spec-tenant-safety-community.md`): a solid pure safety
core and schema, ~25 routes, no UI at all — and three bugs that stopped the API working in production (every tenant user
mapped to "technician" → 403 on every write and an empty feed; the moderator's identity undefined; moderation cases
fabricated as `case-<id>`). Now the whole loop runs: a **receptionist drafts** an advisory in the POS (the phone number in
it redacted), a **manager approves** it, it is **held for Super Admin moderation** (its category requires it), a
**moderator publishes** it from the new Moderation Center under a real case, and **another salon sees it in its feed**,
opens the deep link and comments — proved in headless Chromium against the real API and Postgres
(`scripts/live-phase8-community-browser.mjs`, 25/25).

Process: Kevin asked for five agents. The lead wrote the shared pieces first (migration 529, Kysely types, every wire type in
`@aipowersalon/api-contracts` — tenant `community.ts`, platform `community-moderation.ts` — permission keys, event and realtime
names, a ports file between the three backend halves, the module wiring with named stub controllers), then five agents
built in parallel: **A** core backend, **B** moderation backend, **C** interactions backend, **D** POS + owner UI, **E**
Super Admin Moderation Center + the browser proof. No second agent round; one full lane run.

### (a) The audit's 13 bugs
| Bug | Was | Now | Proof |
|---|---|---|---|
| 1 role mapping (critical) | lowercase switch; real roles uppercase → everyone "technician" | `communityRole`: OWNER→owner, ADMIN→tenant_admin, MANAGER→branch_manager, FRONT_DESK / RECEPTION→receptionist, TECHNICIAN→technician (needs the salon's `view_community` grant), SUPER_ADMIN→moderator only on the moderation routes | `community-bugs` (failed 9/9 on the old tree), HTTP spec with the five real roles; **browser: receptionist drafts, manager approves** |
| 2 moderator identity (critical) | `req.user` (never set) → actions not written, appeals broken | moderator = `req.ctx.userId` (a real uuid) on every action row | B's HTTP + pgtest; **browser: the publish row carries the real Super Admin** |
| 3 fabricated cases | `case-${id}` | every moderator write runs under a real `community_moderation_cases` row (given, or opened / reused per post + kind — unique index) | B pgtest; browser: case `post_review` resolved |
| 4 status bypass | `moderate()` hard-coded `moderation_review` as the start; every publish set `evidence_reviewed` | transitions from the REAL status; the published state follows the chosen label (`publishedStateFor`) | workflow (18), B pgtest |
| 5 sensitive dead end | no edit / re-scan; not in any queue | author edits + re-submits (re-scan); the moderator's Sensitive queue can redact and publish | A + B specs |
| 6 evidence unusable | bytes never uploaded, scanner never called, missing storage = 500 | presigned PUT upload (≤ 15 MB, allowlisted types, sha256) → complete (object checked, scanner called, fail closed) → access by short-lived URL with a reason, logged; moderators under a case; no storage = 503 `evidence_storage_not_configured` | C specs (fake storage — no bucket here) |
| 7 phantom rows | repository swallowed write errors, returned id '' | failed writes throw; reads degrade only where safe | `community-bugs` |
| 8 empty branch | `''` into uuid columns | `branchOrNull` everywhere | `community-bugs` |
| 9 raw identifiers | feed / post / comments carried other salons' tenant / branch / user ids and scan flags | one safe shape (`CommunityPostView` / `CommentView`): an author LABEL the posting salon chose (its name, display name, or "A salon in <region>"); own-salon views add workflow detail | A pgtest (two salons); **browser: none of salon A's tenant / branch / user ids anywhere in salon B's feed, post or comments** |
| 10 disputes / rate limits | disputes labelled at once, no limit; search limit never fired | disputes label the post and wait for a moderator decision (upheld / corrected / overturned); rate limits on posts, comments, reports, disputes, appeals, evidence; searches counted | A + B specs |
| 11 settings ignored | `managerApprovalRequired`, `notify_categories` unused | approval need follows the salon's settings and role; notify categories drive the fan-out | A + C specs |
| 12 remove too narrow | only from two states | from every visible state; restore | B pgtest |
| 13 stale docs | | superseded by this section (the module lives in `modules/safety/src/tenant-safety-community/`; moderator routes are under `/super-admin/community-moderation`) | — |

### (b) Built (the audit's MISSING rows)
- **Schema (529)**: settings (display name, how the salon appears, anonymous allowed, branch visibility, retention, region
  preferences, the risk-matching toggle, push / email, version), rules acknowledgments, the full advisory (incident date,
  method, channels, recommendation, tags, processor, amount range, official reference, author display + frozen label,
  counters, resolution, comment lock, full-text `search_document` + title trigram), post updates, threaded + versioned
  comments, comment reports, post follows, follow preferences, similar experiences, related / duplicate / merged links,
  case kind / priority / assignee / target, action targets, restrictions, redactions, evidence upload fields + access log,
  FKs (NOT VALID).
- **Core (A)**: tenant settings (versioned, 409 on a stale save), rules acknowledgment (required before drafting /
  commenting), the full workflow (my lists, update draft + re-scan, receptionist submit → approval, withdraw, approve /
  return with a note, edit a published advisory with versions — payment data hides it again, add update, resolve, reports,
  disputes, appeals, private incidents + explicit sanitized promotion), feed with full-text search, filters, sort and
  paging, DTO validation (400 `invalid_input` + field), name / DOB detection in the privacy scan, events, audit.
- **Moderation (B)**: overview, ten queues, post detail (versions, reports, disputes, evidence, redactions, AI signals
  marked advisory), 14 post actions + 3 comment actions + 5 salon actions + report / dispute / appeal / evidence decisions +
  incident access under a case, cases (open / assign / close), restrictions (posting / commenting / suspend / lift),
  audit trail, analytics, platform settings; every write needs step-up and a reason; compare-and-set on the post version.
- **Interactions (C)**: threaded comments (edit / delete own / report, locked → 409, restricted → 403), similar experiences,
  post + category follows, evidence, active alerts, tenant analytics; the fan-out (a published advisory → one
  `community.alert_delivered` per recipient salon — tenantId = the recipient — + in-app alert, push, email, SMS only for
  critical with opt-in; matching by follows / notify categories / region; critical → every enabled salon), related /
  duplicate detection, the realtime projection (a new `salon` scope reaches the owner room, the no-branch room and every
  branch room), hourly per-salon jobs (retention purge, auto-archive, related detection, evidence rescan; `COMMUNITY_JOBS=off`),
  the risk-fingerprint store behind the platform flag (off; also needs a policy reference and a salt).
- **UI (D, E)**: POS — "Safety Community" nav entry, feed, post detail (the deep link `/community/posts/:id`), new / edit
  advisory, my advisories, approvals, private incidents, settings + follows + analytics, the rules modal, the emergency
  banner on every screen; owner app — an alerts + approvals card and settings; Super Admin — the Safety Community
  Moderation center (18 tabs).

### Found by the real-browser proof and the integration — and fixed
| # | Defect | Fix + test |
|---|---|---|
| L1 | **The emergency banner broke every POS screen while an alert was up**: `.main` is a 2-row grid (header · screen) and the banner took the screen's row, pushing the screen into an implicit row (a 300 px band of banner, the page squashed) | `.main` is header · alert slot · screen, the slot always rendered; `posLayoutGrid.test` pins both |
| L2 | **The comment box never appeared for a user who had not yet accepted the rules** (the API's `canComment` waited for the rules; the POS asks for them when you post) | `canComment` no longer waits — posting still requires the rules (403 server-side), the POS shows the modal; test |
| L3 | **The privacy scan redacted ordinary words after "login" / "pin"** ("read back the login code sent to the owner" → "login: [REDACTED_CREDENTIAL] sent") | a credential needs a separator (`password:`) or a digit in the token; test (5 cases) |
| L4 | Salon-wide community events reached only the owner and no-branch rooms (a front-desk session sits in a branch room) | the events port adds the salon's branch ids to every event it writes; `community-events` spec |
| L5 | The risk-fingerprint store was never called | the core hands the RAW draft text to it (a no-op unless flag + policy + salt); failure never blocks a draft; test |
| G1 | The schema guard treats `from <ident>` as a table, so `from jsonb_array_elements_text(…)` (two community repositories) failed it | added to its not-a-table list beside `unnest` / `generate_series` |
| L6 | `/community` is both a POS page path and an API prefix — the POS dev proxy did not forward it, the owner app's not at all | dev proxies forward `/community` API calls; page loads (`Accept: text/html`) go to the app, the same rule as `/tenant` and `/pos` |

### Mutation checks (Phase 8)
**131 mutants: 130 caught, 1 equivalent.** A 25/25, B 24/24, C 26/26, D 32/32 (each agent closed its first-pass survivors —
A 3, B 3, C 1 — with stronger tests), E 24/25 (the survivor is equivalent: the shared `buildUrl` already drops empty
values). Logs: `scratchpad/p8/mut-{A..E}.md`.

### Verification (Oct 8 2026, this tree)
| Lane | Result |
|---|---|
| Gates | **38/38** — 29 gates + 9 audits (before the run they caught: a declared event nobody recorded, an unregistered error code, SQL alias collisions — fixed by the agents) |
| API (6 shards) | **1,867 passed**, 0 failed. Run 1 caught one: the schema guard read `from jsonb_array_elements_text(…)` as a table (G1) — fixed, shard re-run 345/345 |
| Modules (26 suites) | **7,622 passed**, 0 failed |
| Web apps (8 suites) | **3,028 passed**, 0 failed |
| Packages (19 suites) | **598 passed**, 0 failed |
| Harnesses | **124/124** suites |
| Real-Postgres race lane, fresh database (525 migrations) | **48 files, 167 tests**, 0 skipped (+3 Phase 8 files: two approvers on one post → one transition, one event; two moderators on one post → one wins, one 409, one case, one action; two "we saw this too" from one salon → one row, count 1) |
| **Real-browser proof — Phase 8 community 25/25 (new)** | `scripts/live-phase8-community-browser.mjs`, headless Chromium, the built pos-web + admin-web behind a same-origin proxy, the compiled API, real Postgres: salon A = PILOT01 (a proof branch, a receptionist, a manager), salon B = a new proof salon, a Super Admin. The receptionist opens the Safety Community from the nav, accepts the rules (stored per user), writes a high `account_takeover_attempt` advisory with a phone number in it and submits → `manager_approval`, the number redacted + flagged, salon B cannot find it or open it by id (404) → the manager approves in the POS → held in `moderation_review`, still invisible → the Super Admin signs in to admin-web (password + MFA), finds it in the Review queue with its salon named, publishes with a reason → `published_unverified`, a real case, the action row with the real Super Admin → salon B sees it in the feed (and the emergency banner), opens the deep link `/community/posts/:id`, accepts the rules, comments → stored for salon B; by API salon B sees feed, detail and comments with **none of salon A's tenant / branch / user ids**, no phone number; one `community.alert_delivered` for salon B and none for A; the domain events; no page errors in four sessions; everything removed, PILOT01's settings exactly as before. Five integration runs found L1–L3 (above); final run 25/25 |
| Full run | one run: gates, six API shards, modules, apps, packages, harnesses, race lane on a fresh database, the browser proof — green except G1, fixed, the shard re-run |
| Mutation checks | **130 of 131 caught**, 1 equivalent (above) |

### Completion list — every line DONE or decided
**The 34-item completion list is not in this workspace** (only the audit's evidence file is). Checked against the audit's
status table, its 13 bugs and its build order. Kevin: if you have the list, I will check it line by line.

| Audit line | Status | Evidence / decision |
|---|---|---|
| Schema: the missing tables / fields / threading / FTS / FKs / settings columns | DONE | 529; categories and tags stay a code list + a jsonb column (decided: 27 fixed categories in the contract; free tags) |
| Services: private incident, draft / promote / submit / approve, comments, scan, evidence, moderation, disputes / appeals, notifications, search, abuse, audit | DONE | (b) |
| Services: AI assist | decided | stays an honest 503 `ai_not_configured` — it needs a community task + prompt registered in the AI platform; advisory only when wired |
| Services: risk matching behind a flag | DONE | off; needs the platform flag, a policy reference and a salt |
| Services: related / similar / duplicate, settings writes, analytics, retention jobs | DONE | |
| Routes: every missing tenant + moderator route, validation, pagination, safe serialization | DONE | |
| Permissions: separate keys for settings / report / dispute / appeal / follow; technician incidents | DONE / decided | new keys; technicians still never create incidents (the core's safety floor) and see the community only when the salon grants it |
| UI: pos-web, owner-web, admin-web moderation center, rules acknowledgment, emergency banner | DONE | tech app: none (technicians have no community access by default — decided) |
| Realtime | DONE | four wire events; cross-salon via one event per recipient salon |
| Privacy: name detection, image redaction, access reason, anonymous shape | DONE / partial | names / DOB redacted in text; access reason required + logged; anonymous label; **image redaction is a moderator review step (clean / redacted / reject) — no automatic face / plate blurring** |
| Tests: HTTP with real roles, duplicate / similar, file redaction, e2e, perf, load | DONE / partial | real-role HTTP specs, pgtests with two salons, three real-Postgres races, the real-browser e2e; **no load test; the S3 upload path is tested against a fake store (no bucket here)** |

### What Phase 8 does NOT do (honest scope)
- No automatic image redaction (faces / plates) — a moderator decides; no load test; the evidence upload has never hit a
  real S3 bucket (`EVIDENCE_S3_BUCKET` is not set here — the routes answer 503 until it is).
- AI writing help stays 503 until a community task + prompt is registered.
- No tech-app screen; private incidents cannot be edited; the comment form of an appeal has no UI.
- The tenant's "in-app" notice of a moderator's message is the post's `returnReason` + realtime + email; there is no tenant
  inbox for it.
- The proof stamps the Super Admin session as stepped-up in the database (the step-up itself is proved by its tests).

## Phase 9 — Constitution 2 (Permissions & Authorization), completed: every route keyed, one decision, changes reach live sessions (Oct 8 2026)

The Oct 6 audit's verdict was "PARTIAL, about 55–60%" (`docs/audit-2026-10-06/constitution-02-permissions.md`; §153: 16
done, 30 partial, 5 missing of 51). Phase 1 had already closed the confirmed escalations. What was left: 324 staff routes
with no permission key (authorised — or not — inside their services), ~218 role-NAME comparisons in backend code, template
scopes that were stored but never read, no authorization version (a demotion reached a live session only at its next
refresh), no explicit DENY, no per-user or temporary grants on the salon side, no last-owner protection, a dozen separate
approval flows with platform-wide thresholds, no access review / high-risk report / dormant alert, and no per-role matrix.
Now: **unkeyed staff routes 0** (and an unkeyed staff handler is refused — default deny is ON), one decision object with
reason codes, authorization versions checked on every request, template scope enforced, overrides (ALLOW / DENY /
temporary), last-owner protection + ownership transfer, ONE salon approvals engine, the governance reports, a committed
per-role ALLOW / DENY matrix (2,672 routes × 17 principals) — proved live (`scripts/live-phase9-permissions.mjs`, 28/28).

Process: five agents in parallel (A authorization core · B registry, role-check purge, governance, matrix · C keying every
unkeyed route + the catalog · D the approvals engine + its screens · E Roles & Permissions UI + permission-driven nav + the
live proof) against a lead-written contract (migrations 530–531, the wire types `tenant/authorization.ts`, the new keys,
events, Kevin's open decisions as defaults). No second agent round.

### (a) What changed, by the audit's build order
| # | Audit item | Now | Proof |
|---|---|---|---|
| 1 | self-escalation (Phase 1) + a dedicated key + step-up | role changes use `roles.manage` (not `technicians.edit`) + step-up + a reason; the ONE role-change route is `PUT /pos/access/members/:id/role` (the old staff-roles assignment route was retired); custom roles and ALLOW overrides are capped by what the actor holds; never on yourself | escalation tests (B), live: self GM / custom role above / ALLOW on self / ALLOW above ceiling / `super_admin.*` override all refused |
| 2 | authorization version | `users.authorization_version` / `tenants.authorization_version` bumped BY TRIGGERS (role, status, home branch, platform role, template, branch access, overrides; custom roles per salon); sessions carry `av` / `tv`; every request compares (cache ≤ 30 s, reloaded when the session is newer); a stale session is re-authorized from the CURRENT grants for that request + `x-authorization-changed: 1`; deactivation / loss of `pos.login` revokes every session; `/auth/refresh` mints the current version; the stream hash includes template + overrides + versions | A's pgtests; **live: the owner demotes the manager → the manager's NEXT request on the SAME session is refused**, restore restores |
| 3 | template scope + branch access | BRANCH / SELECTED_BRANCHES templates may enter only their granted branches, else their home branch (default (1)); a per-branch role row can only NARROW (it used to REPLACE the session role); salon-side branch-access endpoint (owner, step-up); FKs + CHECKs on `user_branch_access` | live: a Receptionist cannot select another branch |
| 4 | registry + generator + `check:perms` on service keys | `PERMISSION_REGISTRY` (every key: domain, label, description, sensitivity, scopes, step-up; 175 `pos.*` route keys folded in as aliases) → `docs/PERMISSIONS.md` (gate `check:permission-docs`); `check:perms` now scans service-level keys (found a dead platform key) | `permission-registry.test` |
| 5 | decision object, policy handlers, user overrides | `decide()` → `{ allowed, reason, scope }` (inactive / realm / explicit DENY / role-template / ALLOW / temporary / scope / policies); `hasPermission` is its boolean façade; typed policies `same-branch`, `own-record`, `requester-not-approver`, `amount-within-limit`; 403s carry `reason`; denials recorded (`authorization_denials`); overrides ALLOW / DENY / temporary with expiry sweep | `decision.test` (every reason), live: DENY beats the role (denied_by_override, recorded), temporary ALLOW expires on its own |
| 6 | one tenant approvals engine | `tenant_approval_requests` + per-salon versioned policies (defaults = today's env thresholds); maker / checker; approver key + limit; executors per kind (refund, deal publish, purchase order) run once; expiry job; events + realtime; POS Approvals screen + owner Approval Center; refunds over the limit, deal approvals and PO approvals moved onto it | D's pgtests + race; **live: a front-desk refund request → the manager approves → exactly one refund row** |
| 7 | last owner + ownership transfer; Super Admin role path | a salon keeps ≥ 1 active owner (409 `LAST_OWNER`, salon side and Super Admin side); `ownership.transfer` (step-up) moves the owner; Super Admin role changes need step-up and disable revokes sessions | race (two owners demote each other → one 409), live transfer |
| 8 | 324 unkeyed routes + role-name checks + OWNER shortcuts + dead keys | **324 → 0** (C; each key reproduces who could call it; tightenings listed below); role-name comparisons 218 → 151, every remaining one allowlisted WITH a reason (gate `check:role-checks` fails on any new one); OWNER shortcuts removed (compensation, cash drawer, owner service, POS nav); four dead keys registered (`pos.pricing.override` no longer referenced); bug 7 (AI tool gate) fixed | `route-keys-phase9` (62), `role-checks-gate`, matrix |
| 9 | temporary grants, access review, high-risk, dormant, worker principals, export snapshots, denial metrics, matrix + escalation tests | all built (owner screens under Security); background jobs act as named `worker:<job>` principals with only their keys; every export (37 routes) writes an append-only snapshot (who, key, filters, rows, checksum) or refuses; the matrix snapshot is committed and regenerated with `scripts/role-matrix.mjs --write` (`--diff` shows who gained / lost) | live: access-review revoke ends the sessions; high-risk lists a new override; denials counted |

**Who lost or gained access (deliberate)**: technicians lost the AI Center copilot POSTs, the receptionist agent reads, salon
billing / backup / Twilio credential reads, reminder settings and skip-line routes they could reach only because those
routes were unkeyed; front desk / reception lost billing, backup and Twilio credential reads and skill-document upload;
managers lost `POST /pos/me/backup/run` (owner `settings.edit`); API-key / OAuth integrations no longer reach previously
unkeyed staff routes; a front desk / reception person without explicit grants is confined to their home branch after their
next sign-in (default (1)); technicians gained POS search (they hold `global_search.use`). The per-role matrix records it.

### Found by the live proofs and the integration — and fixed
| # | Defect | Fix + test |
|---|---|---|
| L1 | **Switching branches mid-session always landed on the FIRST branch**: the tenant-context middleware strips client-named `branchId` from every body — including `POST /auth/select-branch`, where the branch IS the request (pre-existing; hidden because most staff have one branch) | that one path keeps `branchId` (the branch-access service validates it); `select-branch-body` spec; live: a Receptionist's request for another branch is refused, their own works |
| L2 | **A narrowed manager kept paying for up to 30 s after a refresh**: the per-request cache still held the OLD grants and the fresh session was "re-authorized" from them (found by the Phase 1 refresh proof) | a session newer than the cached state reloads it; cache spec |
| L3 | The owner's denial report dropped TODAY: `to=2026-10-08` meant midnight | a date-only `to` covers the whole day; core spec |
| L4 | Accountant / Inventory / Marketing / Support templates and existing custom roles lost their own profile + Help Center (the routes got self-service keys) | the self-service keys are in every template's basics and unioned into stored custom roles; tests |
| L5 | A per-user override's branch could never arrive: a body `branchId` is stripped by the middleware | the field is `scopeBranchId` (contract, API, UI); client spec |
| L6 | Two retired routes (`GET /pos/staff-roles`, `PUT …/assignments/:id`) duplicated the new role path | removed; the Phase 1 proof uses the new route |

### Mutation checks (Phase 9)
**125 mutants, 125 caught.** A 24/24, B 25/25, C 19/19, D 33/33, E 24/24 (first-pass survivors — A 1, B 1, E 1 — closed with
stronger tests). Logs: `scratchpad/p9/mut-{A..E}.md`.

### Verification (Oct 8 2026, this tree)
| Lane | Result |
|---|---|
| gates | **31 gates + 9 audits passed** (new: `check:permission-docs`, `check:role-checks`) |
| API (6 shards) | **1,977 passed, 0 failed** (80 skipped — the env-gated live suites) |
| modules (26) | **7,741 passed, 0 failed** |
| web apps (8) | **3,091 passed, 0 failed** |
| packages (19) | **642 passed, 0 failed** |
| harnesses | **124 / 0** |
| race lane (fresh DB, every migration) | **171 passed** across 51 files (Phase 8: 167) |
| live proofs | **Phase 9 28/28** · Phase 1 refresh 10/10 · Phase 6 33/33 · Phase 7 31/31 · Phase 8 browser 25/25 (default deny ON broke none of them) |
| role matrix | 2,672 routes × 17 principals, **0 changes** against the committed snapshot |
| unkeyed staff routes | **0** (baseline file empty) |

**The first full lane run failed four suites — all fixed, then the affected lanes re-run green:**
- `tenant-isolation.pgtest`: its fixture inserted branch access level `'full'` (never a valid level; 530's CHECK refuses it)
  and a `.catch(() => undefined)` swallowed the error, so both owner portfolios came back empty. Fixture → `'owner'`, the
  catch removed (a swallowed fixture error is how this hid).
- `fraud-owner-alert.pgtest`: the owner-only alert audience now follows the owner-level grant (`owner.branches.compare`),
  not the role name; the test's contexts carried `permissions: ['*']`, which was never a wildcard. Contexts now carry each
  role's real permissions — OWNER sees the fraud alert, MANAGER (who does not hold the key) still does not.
- `job-telemetry-coverage`: the three new schedulers (dormant accounts, approval expiry, override expiry) ticked bare.
  Each now runs through `runTick` (fleet-wide lease + job telemetry): `access.dormant_accounts`, `approvals.expiry`,
  `permissions.override_expiry`.
- `booking-verification-proof.pgtest` (modules/booking) and the staff-roles fail-safe spec (modules/identity): the
  verification override is now decided by `pos.booking.override_verification` / `…verification_pending`, so the proof's
  contexts carry real permissions; the fail-safe resolver now keeps the self-service keys (still drops the tampered ones).

### §153 Definition of Done — every line DONE or decided
| §153 line | Status | Evidence / decision |
|---|---|---|
| roles identified; tenant vs platform; customer plane; OWN; TENANT; PLATFORM; tenant access enforced; AI authorization; Support Mode; support audited; revocation mechanism; cross-tenant tests; build / typecheck / lint; no cross-tenant hole (16, Oct 6) | DONE | unchanged + AI tool gate bug 7 fixed |
| inspected | DONE | the 324-route sweep + the matrix |
| registry | DONE | `PERMISSION_REGISTRY` + docs + gates |
| service principals / worker authorization | DONE | `worker:<job>` principals with per-job grants |
| scopes / ASSIGNED / BRANCH / SELECTED_BRANCHES | DONE / decided | template scope read at sign-in, branch selection and per request; ASSIGNED stays a per-domain rule (no shared building block) — decided, the domains (technician queue, own tickets) enforce it with `own-record` |
| explicit deny | DONE | DENY overrides beat every grant |
| default deny | DONE | unkeyed baseline 0 + `TENANT_DEFAULT_DENY` on |
| policy conditions | DONE | typed policy handlers |
| step-up | DONE | role / branch / override / ownership / approval-policy / access-review decisions / Super Admin role changes |
| approvals; separation of duties | DONE | one engine, `requester-not-approver` per policy |
| self-escalation; ceilings | DONE | Phase 1 + overrides capped by the actor |
| field-level | decided | tenant field rules stay per domain (customers export, inventory cost via `ai_inventory.view_cost`); no new generic layer |
| branch access | DONE | salon-side endpoint (owner) |
| frontend / backend / mobile controls | DONE / partial | POS nav by permission, no OWNER bypass; the mobile apps read the same session permissions (no new mobile work this phase) |
| realtime | DONE | stream hash includes template, overrides, versions; `authorization_changed` event |
| exports | DONE | export snapshots |
| entitlements | decided | stay separate (`feature-registry`, AI entitlement guard); a general plan guard is Constitution 5 — Phase 12 |
| temporary grants; expiry | DONE | |
| cache safe; versioning; cache invalidation | DONE | versions + per-request check + in-process invalidation + newer-session reload |
| access audit | DONE | `authorization_audit_events` (append-only) |
| escalation tests; role-matrix tests | DONE | |
| legacy role checks audited; no unsafe legacy role checks | DONE | 151 remaining, each allowlisted with a reason; the gate blocks new ones |
| last-owner | DONE | |
| Kevin's open decisions | defaults recorded | (1) branch confinement as above; (2) one template per person; (3) per-salon thresholds default to today's env values; (4) payment-device approval stays owner-only; (5) managers keep `inventory.cost.view` |

### What Phase 9 does NOT do (honest scope)
- Several roles per person (decision (2) keeps one template); field-level rules stay per domain.
- 151 role-name comparisons remain, all allowlisted with a reason (94 inside the authorization core itself, 31 in the
  Safety Community's own role model — now derived from permissions — and plane / realm routing).
- Approval flows NOT moved onto the engine: privileged grants, access requests, technician reports, OCR, residuals,
  payroll, community advisories (they keep their own reviewed flows).
- A change made directly in the database without a session refresh reaches a cached request within 30 s (the trigger bumps
  the version; the cache is per process).

## Phase 10 — Constitution 1 (Database), completed on the code side: every table owned, every constraint validated, the board bounded (Oct 8 2026)

The Oct 6 audit's verdict was "PARTIAL, about 60%" (`docs/audit-2026-10-06/constitution-01-database.md`; §111: 15 done, 23
partial, 4 missing, 2 Kevin's). Phase 1 had already fixed the 450 trigger full scan and the RLS text cast and put an
advisory lock on the migration runner. What was left: no ownership classification, 81 tenant tables with no tenant-leading
index, none of the core foreign keys, no unique email / phone on `users`, no unique loyalty profile, no unique webhook event
ids, 102 free-text `status` columns, loyalty balances overwritten outside the ledger, Super Admin figures read from tables
nothing wrote, three support-session tables and three idempotency stores, a plaintext webhook token beside its hash, no
`updated_by` / `deleted_by` and no actor stamping, a retention policy that only dry-ran, one database role and one pool,
RLS on one table, no Database page, and no EXPLAIN or load numbers on a real-sized schema.

Process: five agents in parallel against a lead-written contract (the deferral ledger + runner rules first: migration 534,
`migration-sql.mjs`, `-- migrate: no-transaction`): A ownership registry + runner + pre-flight + backfill helper · B indexes,
constraints, versions, consistency triggers, id types, settlement link · C duplicates merged, loyalty ledger, summaries,
audit fields, the 451 cleanup · D actor stamps, retention executor, per-role pools, RLS · E Super Admin Database page,
EXPLAIN pass, load, live proof. No second agent round; the lead integrated.

### (a) What changed, by the audit's build order
| # | Audit item | Now | Proof |
|---|---|---|---|
| 1 | ownership registry + gate; DB docs | `apps/api/db/ownership/registry.generated.json`: all 705 tables — ownership class (§3: platform-global 132, tenant 440, tenant + branch 74, identity ↔ tenant 39, cross-tenant 20), domain, sensitivity, retention, append-only; gate `check:db-ownership` fails on an unclassified / new / changed table; `DB_ERD_AND_DOMAINS.md` regenerated from it; `docs/DB_SCHEMA_MEASUREMENTS_2026-10-08.md` measured | `db-ownership.vitest.spec` |
| 2 | migration runner | advisory lock (Phase 1) + per-file `lock_timeout` + optional statement timeout + checksums and durations in the ledger + `-- migrate: no-transaction` files for `CREATE INDEX CONCURRENTLY` (an INVALID index left by an interrupted build is dropped and rebuilt) + `db-preflight.mjs` before every start (server version, extensions, ledger integrity, pending files, row counts and locks on the tables they touch) + `runBackfill` (batched, resumable, each batch with its progress row in one transaction) + a deferral ledger: a constraint existing data does not satisfy is recorded with its retry statement instead of failing the deploy. **The Dockerfile would have crashed on start** (the runner's new import was not copied into the image) — found and fixed by A, now covered by a test that follows the start scripts' imports | `migrate-hardening`, `migrate-preflight`, `backfill` race tests; `migrate-runtime.vitest.spec` |
| 3 | 450 trigger | done in Phase 1 (517) | — |
| 4 | tenant-leading indexes | 77 built `CONCURRENTLY` (537) + 4 from the summary uniques → **0 tenant tables without one** | `tenant-indexes.pgtest` (EXPLAIN uses each) |
| 5 | constraints after pre-flight | 5 core FKs (payments → tickets, refunds → payments, tickets → customers, lines → tickets, customers → tenants); `users` unique (tenant, lower(email)) and (tenant, phone); loyalty profile (tenant, customer); webhook event unique (processed rows); SMS provider sid; booking-hold / appointment time CHECKs (HH:MM, end > start); stock ≥ 0; **64 status vocabularies** (text status columns without a CHECK 102 → 37, each skipped one listed with its reason); 5 more tenant-consistency triggers; 14 text → uuid id columns; **every constraint Phases 7–9 had left NOT VALID (54) now validated (547)** — 0 NOT VALID on a fresh database and on the local one | `core-constraints.pgtest` (32), `validate-not-valid-547.pgtest` |
| 6 | versions + actor stamps | `version` on stock and technician schedules, 409 on a stale `expectedVersion`; `updated_by` on 246 tables, `deleted_by` beside every `deleted_at`, `created_by` on queue + appointments; a Kysely plugin stamps the signed-in person (never a device / worker / non-uuid; never throws); gate `check:actor-stamp` | `stock-version` race, `actor-stamp.pgtest`, live |
| 7 | duplicates merged | loyalty: ONE ledger service for every balance change (earn, redeem, reversal, adjust with a required reason, merge) under a per-customer lock, `balance_after` chain, opening-balance rows, daily `loyalty.reconcile` repairs + alerts; support sessions 3 → 1; idempotency stores 3 → 1; three unused POS audit tables dropped; Super Admin daily summaries now WRITTEN (`summaries.daily`, hourly) + a history backfill; `audit_events` carries before / after / reason / request / correlation / session ids; gate `check:audit-writers` (125 legacy raw writers allowlisted, may only shrink); the plaintext webhook token dropped (signing secret dropped once every value has an encrypted twin) | `loyalty-ledger.pgtest` + race, `phase10-c-migrations.pgtest`, `audit-fields.pgtest`, live |
| 8 | retention + soft delete | `docs/DATA_RETENTION_AND_DELETION_POLICY.md` + `retention-policy.json` (97 tables); a central executor (`retention.execute`, daily): 15 tables, batches of 1,000, legal holds respected, financial and audit classes refused whatever the file says, a run row per table; dry run writes nothing | `retention-executor.pgtest` (15) |
| 9 | pools + RLS | per-role timeouts (API 30 s / 30 s, worker 600 s / 120 s), a separate worker pool (optional own login `PG_WORKER_DATABASE_URL`); the tenant is reset when a connection is released; `tenantTransaction` (per-transaction setting — works behind PgBouncer); RLS policies on 10 core tables with a uuid comparison (index-friendly) and a strict mode that refuses rows with no tenant — **still OFF by default** (`DB_TENANT_RLS`) | `rls-core-tables.pgtest`, `db-worker-pool` race, **live RLS trial 20/20** (non-superuser role, two salons, Super Admin, a worker; cross-salon reads and writes refused) |
| 10 | Super Admin Database page | overview (version, size, ledger + pending + integrity, replica lag), tables, indexes (unused / INVALID / duplicate), slow queries (pg_stat_statements when present, else the app's samples, kept 30 days), activity (literals stripped), schema health (deferred constraints with "retry", backfills), retention runs, growth (size snapshots); actions cancel a backend / VACUUM ANALYZE / retry — step-up + reason + audit | `super-admin-database` specs (28), admin-web screen test, live |
| 11 | EXPLAIN pass | 31 query shapes on a 10-salon seeded schema: 0 seq scans on salon-scoped reads; two shapes read and discarded thousands of rows → two indexes (546) → 0 discarded | `docs/DB_EXPLAIN_PASS_2026-10-08.md` |
| 12 | load | **the first run found the checkout board loading every ticket a branch ever had** (below) — fixed; sandbox numbers in the EXPLAIN doc | `checkout-state-bounded.pgtest` |

### Found by the integration and the load run — and fixed
| # | Defect | Fix + test |
|---|---|---|
| L1 | **The checkout board (`GET /pos/checkout/state`) loaded and hydrated every ticket the branch ever had, plus every payment**: 41.7 s for one request at ~6,700 tickets; at 50 clients p50 47 s / p95 128 s, 23 errors | the board reads only open tickets plus those created or paid since the branch's midnight, and today's payments; one request ≈ 0.4 s, 0 errors at 50 clients (the 50-client latency is the 2-vCPU sandbox queueing); `checkout-state-bounded.pgtest` (red first; 2 mutants caught) |
| L2 | 54 constraints from Phases 7–9 were never validated | migration 547 validates each or defers it with its retry statement; `validate-not-valid-547.pgtest` |
| L3 | Storing a retention rule answered 200 and saved nothing (its audit insert aborted the transaction) — found by E | audit row in a savepoint to `audit_logs`; `retention-rules.pgtest` |
| L4 | The production image would not start (runner import not copied) — found by A | Dockerfile copies it; `migrate-runtime.vitest.spec` |
| L5 | 15 test files replayed migrations with errors swallowed — the new CONCURRENTLY file silently skipped | CONCURRENTLY stripped for PGlite, the same rule as `pgliteCompatible` |
| L6 | Two new schedulers outside the job-telemetry wrapper's recognised shape; one process-local flush flagged as a background job; one UTC-day query | inline `runTick`; the flush named process-local with its reason; the shared `utcDate()` helper |

### Mutation checks (Phase 10)
**90 mutants, 90 caught.** A 15/15, B 16/16, C 10/10, D 34/34, E 12/12, lead 3/3 (first-pass survivors — A 1, B 2, D 1, E 1 — closed
with stronger tests). Logs: `scratchpad/p10/mut-{A..E,lead}.md`.

### Verification (Oct 8 2026, this tree)
| Lane | Result |
|---|---|
| gates | **34 gates + 9 audits passed** (new: `check:db-ownership`, `check:actor-stamp`, `check:audit-writers`) |
| API (6 shards) | **2,053 passed, 0 failed** |
| modules (26) | **7,801 passed, 0 failed** |
| web apps (8) | **3,101 passed, 0 failed** |
| packages (19) | **676 passed, 0 failed** |
| harnesses | **124 / 0** (after one fix below) |
| race lane (fresh DB, all 541 migrations) | **188 passed** across 57 files (after the fixture fix below) |
| live proofs | **Phase 10 31/31** · RLS trial 20/20 · Phase 9 28/28 · Phase 1 refresh 10/10 · Phase 6 33/33 · Phase 7 31/31 · Phase 8 browser 25/25 |
| schema | fresh DB: 0 NOT VALID constraints, 0 open deferrals; local DB the same after 547 |

**The first full run failed two suites — both fixed, then re-run green:** the race lane (two fixtures used non-UUID ids in
columns 539 converted to uuid — `payment_terminal_leases.tenant_id`, `pos_tech_appointments.overbook_by_user_id`; the
real values are UUIDs) and the customers harness (it set a loyalty balance without a reason, which is now refused — the
harness now asserts that refusal and passes a reason).

### §111 Definition of Done — every line DONE, decided or Kevin's
| §111 line | Status | Evidence / decision |
|---|---|---|
| existing schema inspected | DONE | measurements doc (re-taken at the end of the phase) |
| every table classified by ownership | DONE | registry + `check:db-ownership` |
| tenant isolation enforced | DONE (code) | tenant-aware repositories + gates (unchanged) + RLS on 10 core tables proven live; switching `DB_TENANT_RLS=1` on in staging then production is **Kevin's** |
| branch isolation enforced | DONE | Phase 9 template scope + branch access; `scoped()` repositories |
| domain boundaries documented | DONE | `DB_ERD_AND_DOMAINS.md` (generated) |
| duplicate models identified / merged safely | DONE / decided | support sessions, idempotency, loyalty, unused audit tables merged; `audit_logs` (tenant / platform log) and `audit_events` both stay, both append-only (decided); the two customer roots are LINKED by phone — which root wins is **Kevin's** |
| core foreign keys | DONE | 538 + 547 |
| composite tenant integrity | DONE | 23 consistency triggers + composite FKs |
| unique constraints correctly scoped | DONE / open | the audit's named ones added (users, loyalty profile, webhook event, SMS sid); 92 non-PK unique indexes on tenant tables still omit tenant_id — not reviewed one by one in this phase (many are global tokens / provider ids, where a global unique is correct); listed for Phase 15 |
| money fields safe | DONE | unchanged (`check:money`) |
| timestamps timezone-safe | DONE / decided | timestamptz everywhere; appointment `HH:MM` text now CHECKed; moving appointments to timestamptz is not done (wide change, decided against in this phase) |
| optimistic locking where required | DONE | queue (Phase 6), stock, schedules |
| idempotency where required | DONE | one store |
| critical operations use transactions | DONE | unchanged + loyalty ledger + schedule replace |
| outbox / event dedup | DONE | Constitution 8 |
| audit architecture works | DONE | request / session ids, before / after, actor stamps, writers gate |
| sensitive fields protected | DONE / Kevin | the webhook plaintext dropped; phone encryption is **Kevin's** decision |
| secrets not stored insecurely | DONE | 451 cleanup shipped |
| indexes match real queries; high-volume queries measured | DONE | EXPLAIN pass |
| backup works / PITR / restore tested | **Kevin's** | hosting (Railway backups, PITR, a restore drill); `restore-verify` exists |
| migrations version controlled; large migrations safe | DONE | runner + pre-flight + deferral ledger + backfill helper |
| connection pooling configured | DONE / Kevin | per-role pools in code; PgBouncer is **Kevin's** |
| database monitoring; slow queries observable | DONE | Database page |
| retention architecture; soft-delete policy documented | DONE / Kevin | executor + policy; purging soft-deleted customers is **Kevin's** decision |
| partitioning strategy; sharding path | DONE | docs (unchanged) |
| Super Admin uses platform APIs | DONE | Database page through `super-admin/database/*` |
| repositories cannot query globally | DONE | gates + RLS strict mode (off until Kevin's trial) |
| cross-tenant tests; concurrency tests | DONE | lanes below |
| load tests pass | DONE (sandbox) / Kevin | sandbox run, 0 errors; target-infrastructure load is **Kevin's** |
| build / types / lint | DONE | lanes below |
| no dangerous migration unresolved | DONE | 0 NOT VALID, 0 open deferrals on a fresh DB and on the local DB |
| no known cross-tenant leak | DONE | none known |

### What Phase 10 does NOT do (honest scope)
- `DB_TENANT_RLS` stays off; PgBouncer, a least-privilege worker login, PITR, off-primary backups, the restore drill and
  load on target infrastructure are hosting steps for Kevin.
- 37 text `status` columns keep no CHECK (their vocabulary is written by callers or could not be proven — listed by B);
  most text id columns stay text where a value is not a UUID by design.
- Appointment times stay `date` + `HH:MM` text (now CHECKed), not timestamptz.
- 125 legacy raw audit writers are allowlisted, not migrated; raw-SQL writers set actor columns themselves (the plugin sees
  query-builder statements only).
- Customer identity roots are linked, not merged.
- On existing databases, three one-off scripts should be run once: `db-backfill-summaries.mjs`,
  `db-backfill-customer-identity.mjs`, and `seal-bank-webhook-secrets.mjs` if 542 deferred.

## Phase 11 — Constitution 4 (Infrastructure), completed on the code side: traced, metered, drilled, and every hosting step written down for Kevin (Oct 8 2026)

The Oct 6 audit's verdict was "PARTIAL, about 60% on §201" (`docs/audit-2026-10-06/constitution-04-infrastructure.md`;
19 done, 4 claimed, 40 partial, 9 missing of 72). Phases 1, 2 and 10 had closed bugs E1–E5 (pool error handler + timeouts,
SSE drain + readiness 503, provider timeouts, migration lock, single-owner schedulers), built the durable jobs queue and
the per-role database pools. What was left in code: no `traceparent` / spans / exporter, `/metrics` never served, no
stranded-payment sweep, no schema version in System Ops, no break-glass that works with the database down, the tenant
limiter off, Redis not required for multiple instances, the container running as root with `.env*` in the build
context, no image scan or CD, a hard-coded live media bucket and two default regions, no storage lifecycle, no DR
document / dependency inventory / diagrams / drills, the stale Terraform, flags without rollout, no quotas, cost or
webhook counters, and schedulers that loop every salon in one process.

Process: five agents in parallel against a lead-written contract (reserved env names and migration numbers, the shared
guards): A tracing + `/metrics` · B runtime safety switches · C container, CI/CD, media storage, Terraform · D documents +
drills · E flags rollout, quotas, noisy neighbour, cost, webhook counters, tenant-partitioned scheduling. No second round;
the lead integrated and fixed what the drills found.

### (a) What changed, by the audit's build order
| # | Audit item | Now | Proof |
|---|---|---|---|
| 8 | tracing + metrics | W3C `traceparent` adopted or minted per request; server / DB (statement shape only) / outgoing-fetch / job / event-consumer spans in ONE trace (a job carries the `traceparent` that enqueued it — `jobs.traceparent`, `outbox_events.traceparent`, 548); hand-written OTLP/HTTP JSON exporter (bounded queue, batches, never throws, no new dependency), parent-based sampling, `traceparent` on every response; `GET /metrics` (Prometheus text) behind `METRICS_TOKEN` (404 in production without a token) | `tracing.test` (17), `trace-continuity.pgtest`, `metrics.vitest.spec` (15), **live-tracing 16/16** (a local collector received server + DB spans with the caller's trace id) |
| 9 | stranded payment attempts | job `payments.stranded_attempts` (5 min, critical, single owner): a card attempt in `processing` for > 15 min is settled from the PROCESSOR's own answer (verify / inquire through the existing adapters) under the ticket's checkout lock, else `needs_review` + one owner alert + one Super Admin alert; **never charges, voids or refunds on a guess** (549 also fixed a Phase 10 status CHECK that would have refused every mobile Tap-to-Pay transition) | `payment-attempt-sweep` (13) + race (ten sweepers → one transition) |
| 9 | break-glass maintenance | `MAINTENANCE_BREAK_GLASS=read_only\|full` read from the environment on every request, BEFORE Nest and without the database; **proved with Postgres unreachable** (POS 503 `MAINTENANCE_FULL` + `Retry-After`, `/health/live` 200) | `maintenance-break-glass.vitest.spec` |
| 9 | schema version | latest migration, count, pending files, ledger rows with no file, checksum mismatches — in System Ops and `/health.schemaVersion` | `schema-version.vitest.spec` |
| 9 | tenant limiter on; Redis required | the per-salon limiter is ON by default (in-memory store without Redis); its ceiling re-derived from the platform's own refresh timings (a busy location ≈ 1,215 req/min → 3,000/min per location, was 600); production refuses to boot without `REDIS_URL` when `API_REPLICAS > 1`, `MULTI_INSTANCE=1` or the process role is split | `tenant-rate-limit.vitest.spec` (load model inside), `production-config.vitest.spec` |
| 10 | container + CI/CD | runtime `USER node` (code read-only, only the media dirs writable), `HEALTHCHECK`, `.env*` / keys / tests out of the image, migrations moved to Railway's `preDeployCommand` (containers no longer migrate on every start; `MIGRATE_ON_START=1` keeps the old path); `build-image.yml`: image build + boot check, Trivy image scan (fail on CRITICAL with a fix) + IaC scan, SBOM, and a CD job OFF by default (manual dispatch + protected environment, immutable `sha` tag to GHCR). **The real image was built and booted three times here**; the first scan found Capacitor, `proxy-addr` and esbuild's Go binary shipped in the API image — removed | `container-image.vitest.spec` (27), `migrate-runtime` |
| 10 | media storage (E7) + lifecycle | one region source, no hard-coded bucket (production with `MEDIA_STORE=s3` and no bucket refuses to boot), keys `<prefix>/<env>/…` with `tenantMediaKey()`, legacy URLs still resolve; `media.lifecycle` job (abandoned uploads > 24 h, objects of rows soft-deleted 7–10 days ago, legal holds respected); `deploy/storage-lifecycle.json` for the bucket | `media-storage-p11` (24), `media-lifecycle.pgtest` |
| 10 | Terraform (E6) | marked LEGACY (Railway is the host of record) and fixed anyway: OAC bucket policies, final snapshot + deletion protection + Multi-AZ, SSH closed (SSM), a private versioned media bucket; `terraform validate` + Trivy IaC 0 CRITICAL | `deploy/terraform/README.md` |
| 11 | documents | `DISASTER_RECOVERY.md` (RPO/RTO per data class, eight scenarios, SPOF table), `INFRASTRUCTURE_AUDIT.md`, `docs/DEPENDENCY_INVENTORY.md`, `docs/ARCHITECTURE_DIAGRAMS.md` (5 Mermaid), `DEPLOYMENT.md` rewritten for Railway (295 env names, none secret-like missing from the inventory), `docs/HOSTING_ACTIONS_FOR_KEVIN.md` (every hosting line → the exact action + check), five new runbooks | `runbook-links` spec |
| 12 | drills | `apps/api/scripts/drills/`: restore (pg_dump → restore → ledger, row counts, payment checksum, an encryption round trip), worker loss (SIGKILL mid-run → leases expire → every job finished exactly once), Redis loss, DB failover (restart AND connection kill) — each run here, each shown to FAIL when its property is broken | `docs/DR_DRILLS_2026-10-08.md` |
| — | flags, quotas, noisy neighbour, cost, webhooks, partitioned scheduling | percentage rollout + allow / deny lists + per-flag kill (551); `tenant_quotas` (plan defaults + overrides, six kinds, `429 QUOTA_EXCEEDED`; SMS / AI limits read from the stores that already exist); top-10 salons by database time + an alert when one salon holds > 50% of load (`tenant.load.watch`); per-salon / per-provider daily cost estimates from the real ledgers (unit prices editable, 0 = UNKNOWN, never invented); webhook received / verified / rejected / duplicate / processed per provider; the three heaviest fleet-wide schedulers now enqueue one job per salon (tenant health, usage alerts, AI customer-profile scan — which used to stop at the first 200 salons) | `flag-rollout.pgtest`, `tenant-quotas` race, `capacity-ops` race, `webhook-counters` tests, `tenant-partitioned-scheduling` race |

### Found by the drills and the integration — and fixed
| # | Defect | Fix + test |
|---|---|---|
| L1 | **Sign-in answered 500 for the whole of a Redis outage** (`LOGIN_THROTTLE_STORE=redis`): the throttle let every Redis error through (drill-redis-loss, first run FAIL 11/13) | the throttle fails OPEN (no history, writes dropped, one warning a minute); `login-throttle-redis` spec |
| L2 | **A cache miss took > 10 s while Redis was down**: ioredis queued and retried every command for 2–6 s | request/response commands time out after 500 ms (`REDIS_COMMAND_TIMEOUT_MS`), blocking / pub-sub commands exempt; `redis-command-timeout.test`; **drill re-run PASS 13/13**, slowest request 2.0 s |
| L3 | **A worker booted while Redis was unreachable crashed at start** (found checking agent C's SIGTERM note): `void emitter.init()` left the bus subscribe's rejection unhandled — the comment beside it claimed it fell back to local delivery | `init()` never rejects (local delivery, retried on the next fan-out); `realtime-bus` spec; the worker now boots with a dead Redis and stops in 2 s on SIGTERM |
| L4 | Phase 10's status CHECK on `payment_attempts` would have refused every mobile Tap-to-Pay transition past `created` (found by B) | 549 widens the vocabulary; `phase11-b-migrations.pgtest` |
| L5 | Three gate guards flagged the new code (`/metrics` public route, `Math.random` for the sampling decision, the exporter's fetch of an operator-configured URL) | each reviewed and registered with its reason in the guard's list |

### Mutation checks (Phase 11)
**106 mutants, 106 caught.** A 19/19, B 30/30, C 30/30, D 4/4 (one per drill), E 24/24, lead 3/3. Logs: `scratchpad/p11/mut-{A..E,lead}.md`.

### Verification (Oct 8 2026, this tree)
| Lane | Result |
|---|---|
| gates | **34 gates + 9 audits passed** |
| API (6 shards) | **2,152 passed, 0 failed** |
| modules (26) | **7,819 passed, 0 failed** |
| web apps (8) | **3,110 passed, 0 failed** |
| packages (19) | **720 passed, 0 failed** |
| harnesses | **124 / 0** |
| race lane (fresh DB, all 546 migrations) | **207 passed** across 62 files |
| live proofs + drills | **live tracing 16/16** · drill redis-loss 13/13 · drill worker-loss 13/13 · drill restore 11/11 (db-failover 10/10 + 9/9, run by D) · Phase 10 31/31 · RLS trial 20/20 · Phase 9 28/28 · Phase 1 10/10 · Phase 6 33/33 · Phase 7 31/31 · Phase 8 browser 25/25 |
| container | the real image built and booted three times (C): pre-deploy migrate 546/546, `/health/ready` 200, user `node` |

The full run passed on the first attempt.

### §201 Definition of Done — every line DONE, decided or HOSTING (the action is in `docs/HOSTING_ACTIONS_FOR_KEVIN.md`)
| §201 line | Status |
|---|---|
| infrastructure inspected; architecture diagram; DR documented; runbooks; dependency inventory | DONE (`INFRASTRUCTURE_AUDIT.md`, `docs/ARCHITECTURE_DIAGRAMS.md`, `DISASTER_RECOVERY.md`, `RUNBOOKS.md`, `docs/DEPENDENCY_INVENTORY.md`) |
| dev / staging / production isolated; TLS; WAF; load balancer; multiple instances; Redis HA; automatic backups; PITR; storage private; malware scanning; cost alerts; external uptime monitor | **HOSTING** — each row of `HOSTING_ACTIONS_FOR_KEVIN.md` names the Railway / Cloudflare / AWS / GitHub action and its check; the code side (stateless API, `API_REPLICAS` + `REDIS_URL` guard, private buckets + signed URLs, tenant/env key prefixes) is DONE |
| API stateless; health checks; graceful shutdown; realtime scalable / authorized / reconnect | DONE (Phases 1–2, Constitution 9) + the worker boots and stops cleanly without Redis (L3) |
| worker pools (critical / standard / AI / report); scheduler safe; no duplicate cron; queue durable / priorities / retries / dead letters / idempotency / tenant context | DONE (Phase 2) + tenant-partitioned scheduling for the heaviest three; running the worker as its own service is HOSTING |
| outbox; event dedup | DONE (Constitution 8) |
| Postgres hardened; pooling | DONE (Phase 10) / PgBouncer HOSTING |
| restore tested; DR test; failure testing; load testing | DONE here (four drills + the Phase 10 load run); a drill on a REAL backup and load on target infrastructure are HOSTING |
| Redis key rules; Redis degrades safely | DONE (drill-redis-loss 13/13 after L1–L3) |
| signed URLs; upload validation; storage lifecycle | DONE (lifecycle job + `storage-lifecycle.json` for the bucket — applying it is HOSTING) |
| secrets centralized; tenant secrets isolated; rotation documented; no plaintext production secrets | DONE (unchanged; `secrets-inventory` covers the new vars) · least-privilege variables per service is HOSTING |
| IaC; CI; CD; safe rolling deployment | DONE — IaC marked legacy and fixed, Railway is the IaC of record; CI builds + scans the image; CD exists and is off by default (enabling it + pinning actions is HOSTING); pre-deploy migrations + expand/contract written in `DEPLOYMENT.md` §5 |
| feature flags; kill switches | DONE (rollout %, allow / deny lists, per-flag kill) |
| structured logging; metrics; tracing; correlation IDs; alerts | DONE in code — scraping `/metrics` and an OTLP backend are HOSTING; alerts reach Super Admins by email / SMS from the process (an external uptime monitor is HOSTING) |
| System Operations; provider health; cost monitoring; quotas; noisy-neighbour | DONE (unit prices to be entered by Kevin) |
| build; typecheck; lint; tests | DONE (lanes below) |
| no critical SPOF without a documented recovery strategy | DONE (`DISASTER_RECOVERY.md` §5) |

### What Phase 11 does NOT do (honest scope)
- Everything hosting: see `docs/HOSTING_ACTIONS_FOR_KEVIN.md` (25 rows). Nothing was deployed, pushed or published.
- No in-app action to resolve a `needs_review` payment attempt (manual, runbook `stranded-payment-attempts`).
- Spans for Redis calls and SSE pushes; a tracing view inside System Ops (the exporter counters are on `/metrics`).
- Avatars still use flat media keys; `packages/ui` keeps a legacy bucket fallback for old avatar URLs.
- Five low-stakes providers (Retell, Google Places / Geocoding, CAPTCHA, Twilio Voice Intelligence, review publisher)
  still have no explicit timeout (listed in the dependency inventory).
- Storage usage is not recounted from the object store.
- The Mermaid diagrams were not rendered here.

## Phase 12 — Constitution 5 (API), completed: validated, filtered, async, versioned, and every status change explicit (Oct 9 2026)

On Oct 4 the API Definition of Done stood at 41 of 57; Phase 9 closed the unkeyed routes. Open at the start of this
phase: no business domain per route, no plan-feature guard, a global validation pipe that validated nothing (0 of ~2,859
arguments typed), no response-exposure audit, filters / sorts / date ranges per repository, transition tables in 57 files
with nothing enforcing them, no 202 contract, 42 synchronous exports, uploads not re-audited, and every app still calling
the legacy paths.

Process: **two rounds of five agents.** Round 1 (against a lead-written contract) built each mechanism and adopted it on the
priority paths: A async operations + exports · B filtering / sorting / date ranges · C entitlement guard + validation · D
response exposure, uploads, state machines · E domain field + every app on `/api/v1`. Round 1 left validation at 118 of 1,130
body routes and 13 of ~205 lifecycles on a machine, so a second round of five agents, each owning whole modules (no file
conflicts), adopted both everywhere: R2-A Super Admin validation (323 routes) · R2-B Super Admin / platform / tenants
machines · R2-C AI, safety, support, marketing, analytics · R2-D queue, booking, appointments, catalog, inventory, deals,
memberships, checkout, payments, customers, identity, loyalty, gift cards · R2-E workforce, communications and the API's own
areas. The lead integrated the shared lifecycles the agents could not own alone (alerts, webhooks, the idempotency store,
the account and deal moves Super Admin still needs).

### (a) What changed — `API_DEFINITION_OF_DONE.md` now 55 / 57 done, 1 by ruling, only #53 (load at scale) open
| # | Item | Now | Proof |
|---|---|---|---|
| 2 | domain per route | `domain=` on every manifest line, `x-domain` in OpenAPI, gate | `route-domains.vitest.spec` |
| 13 | entitlements | one decision + one `@RequireFeature` guard; AI and SMS checks are sources of it; 45 plan-gated routes; **enforcement defaults to observe** (no salon loses access it has today — Kevin flips `FEATURE_ENTITLEMENT_ENFORCEMENT=enforce` after `feature-gate-preview.mjs`) | `feature-entitlement.pgtest` (every catalog plan keeps today's access) |
| 17 | input validation | **1,124 of 1,128 body routes validated** — schemas written from each handler AND every app's call; unknown fields stripped, dangerous ones refused; the 4 left are provider webhooks signed over the raw body | gate `check:validated-bodies`; route-by-route specs in every module |
| 19 | response exposure | 18 sensitive whole-row reads → 0 open (an owner card-on-file route echoed the gateway token — fixed); gate + ratchet | `response-exposure.pgtest` |
| 21–23 | filter / sort / date range | one wire syntax + one parser; **524 of 532 list handlers**; unknown filter / sort → 400; every range capped | gate `check:list-queries`; 11 endpoint pgtests |
| 27 | state transitions | **199 machines; 465 of 471 status writes through them** (the 6 left: onboarding sub-statuses no production code changes); ~40 dangerous moves now refused (below) | gate `check:state-transitions`; machine pgtests + race tests |
| 32–33 | async contract + exports | 202 + status + download in 5 realms; the worker re-runs the SAME handler re-authorized from CURRENT grants; **37 of 37 file-building exports**; every app's export button | live `live-phase12-async.mjs` |
| 34 | uploads | one policy on **16 of 16 upload routes** (bytes-sniffed type, metadata stripped, tenant keys, quota) | gate `check:uploads` |
| 57 | legacy endpoints | every app calls `/api/v1`; legacy paths answer with `Deprecation` / `Sunset` / `Link` and a counter | live `live-phase12-v1.mjs` |

### Dangerous moves the machines now refuse (each with a test; selection)
- **Front desk**: cancelling or no-showing a COMPLETED appointment (the cascade also cancelled its paid ticket); a cancelled
  guest called back; a technician completing a cancelled ticket; a stale queue cancel silently overwriting (now 409).
- **Money**: a late "settled" callback overwriting a refunded / voided payment; a paid or void invoice set back to draft;
  a billing webhook marking a void / refunded invoice paid; two concurrent revenue-adjustment approvals each posting a
  ledger entry (12 concurrent → 1, real Postgres); a paid payroll period reopened by a racing "mark paid"; a referral
  rewarded twice; a customer-app payment charged again.
- **Gift cards**: two reloads at once losing one; a void or replaced card revived with a balance; two replacements both
  minting a full-balance card.
- **Stock**: a count reconciled twice applying the correction twice; two managers approving one bottle report.
- **Other**: an approved worker transfer moving the worker's branch twice; overlapping CSV imports creating two customers per
  row; a replayed voice-transcript webhook reviving a deleted transcript; a redacted evidence file re-exposed; a delivered SMS
  moved back to "sent" by a late callback; a cancelled pay-rule version re-activated; a Super-Admin-paused technician
  membership bypassed by a re-request; a renewal reviving a cancelled membership.

### Found by the integration — and fixed
| # | Defect | Fix + test |
|---|---|---|
| L1 | **A dispute outcome recorded twice added the recovered funds twice** (a decided chargeback may be decided again, so a double click or a retried request counted the money twice) — found by R2-B | the outcome route is `@Idempotent()` and the Super Admin screen sends one key per submission; `dispute-outcome-idempotent` + `disputeOutcomeIdempotency.test` |
| L2 | The async export worker silently dropped every controller- and method-level guard (Nest's context creator finds a handler's module by searching providers; controllers are not providers) — found by A's mutation check | the service builds its own creator per controller module; pgtest "the worker runs the route's OWN guards" |
| L3 | The tech app's `complete()` wrote `service_done`, which the queue ticket CHECK refused, and four writers set `serving` on queue items (refused, error swallowed) — found by D's vocabulary rule | migration 556 + `in_service`; tests |
| L4 | POS screens and the owner app of salons outside the Safety Community asked for its alerts (every minute on the POS) and got a 403 each time — the last 2 of the `/api/v1` browser check's 19 | the POS banner and the owner card read the salon's community settings first (200 with `enabled`, same permission) and never ask while it is off; a pushed community event re-checks; `CommunityEmergencyBannerOff.test` (5), `OwnerCommunityCard.test`; the browser check is **19/19** |
| L5 | Shared lifecycles no single agent could own: `alerts` and `tenant_webhooks` (Super Admin + API), `api_idempotency.state` (AI voice + checkout), Super Admin's password reset (→ `invited`) and draft-promotion decisions | one machine each (`ALERT`, `TENANT_WEBHOOK` in super-admin; `API_IDEMPOTENCY` in the database package; `USER_ACCOUNT` and `DEAL` extended with today's moves); `idempotency-lifecycle.test` |
| L6 | A boot-order bug in round 2 (a schema import below the class whose decorator used it) crashed the compiled API | import moved; every live proof boots the built API |
| L7 | **A date time bomb in a Phase 9 test**: the approvals expiry test fixed its clock at Oct 8 12:00 UTC but set the row's expiry from the database's REAL clock — it passed until Oct 9 13:00 UTC, then failed for ever | the expiry is set on the service's clock; 15/15 |
| L8 | Two guard tests had not caught up with deliberate changes: ad images now stored under the salon (`tenants/<id>/display-ads/…`), and three private-store settings named "PRIVATE…" flagged as secrets; plus two stale counts (Super Admin machines 62 → 64, the account machine's decided reset edge) | the guards check the same properties on the new layout (mutation-checked); the private-store settings reviewed as not-secrets |

### Behaviour changes to know about
- Refused moves now answer **409 `INVALID_STATE_TRANSITION`** (several were silent no-ops or 400s); an archived salon coupon can
  no longer be un-archived; re-saving a feature's current registry status is 409.
- An unknown `?sort=` / `filter[…]` is a 400 (it was ignored or, on onboarding, a 500).
- Legacy (non-`/api/v1`) paths still work and announce a 90-day sunset.

### Mutation checks (Phase 12)
**Round 1:** A 17, B 22, C 20, D 26, E 19 · **Round 2:** R2-A 15, R2-B 7, R2-C 19, R2-D 27, R2-E 59 · **lead** 6 —
**237 mutants, 235 caught, 2 equivalent** (a redundant check in a test helper; one of two redundant path-traversal guards).
Logs: `scratchpad/p12/mut-*.md`.

### Verification (Oct 9 2026, this tree)
| Lane | Result |
|---|---|
| gates | **41 gates + 9 audits passed** (new: `check:async-exports`, `check:list-queries`, `check:validated-bodies`, `check:response-exposure`, `check:uploads`, `check:state-transitions`, `check:v1-clients`) |
| API (6 shards) | **2,429 passed, 0 failed** |
| modules (26) | **9,059 passed, 0 failed** (three stale tests fixed — L7, L8 — and their three suites re-run in full) |
| web apps (8) | **3,149 passed, 0 failed** |
| packages (19) | **810 passed, 0 failed** |
| harnesses | **124 / 0** |
| race lane (fresh DB, all 549 migrations) | **223 passed** across 69 files |
| live proofs | **Phase 12 async 21/21 · `/api/v1` browser 19/19** · deals 39/39 · the whole 23-inch dual-screen set (lifecycle 30/30, ads 42/42, journeys, devices, check-in, 23-inch 37/37, ads page 14/14, layout 255/255 at three sizes) · tracing 16/16 · drills redis-loss 13/13, worker-loss 13/13, restore 11/11 · Phase 10 31/31 · RLS 20/20 · Phase 9 28/28 · Phase 1 10/10 · Phase 6 33/33 · Phase 7 31/31 · Phase 8 25/25 |
| role matrix | 2,710 routes × 17 principals, 0 changes |

The work ran overnight in two agent rounds; the final lane run was cut short when the session went idle (Oct 9, 02:20),
and was re-run in full the next morning on the same tree after the fixes above.

### What Phase 12 does NOT do (honest scope)
- **#53 load at scale** — on the target infrastructure (Kevin's); sandbox runs are recorded (Phase 10).
- Plan-feature **enforcement** is off until Kevin reviews `feature-gate-preview.mjs` on production data.
- Wire types: 80 of 2,834 routes have an `api-contracts` request / response type (a shrinking baseline); response DTOs are
  explicit where data is sensitive, not everywhere.
- 560 whole-row reads of NON-sensitive tables remain under a ratchet.
- Presigned PUT for large media uploads (bounded by the upload policy instead); no malware scanner exists on the platform.
- The onboarding sub-status columns and the 4 signed provider webhooks stay outside the machines / schemas, with reasons.
- Legacy paths are deprecated, not removed (they serve installed kiosks).

## Phase 13 — Constitution 6 (Mobile), completed on the code side: one transport, live on native, versioned, offline-safe, push and Face ID done right (Oct 9 2026)

The Oct 6 audit's verdict was "PARTIAL, about 40%" (`docs/audit-2026-10-06/constitution-06-mobile.md`; §303: 18 of 76 done,
14 missing, 14 bugs). Phase 1 had closed bugs 3–7. What was left: native realtime dead (relative stream paths, cookie-only
SSE — native apps fell back to a 15-second poll), Face ID enrolling the 15-minute access token, four drifted HTTP clients
with no timeouts / client headers / idempotency, no app version or update gate, no server-state layer or offline story, push
in one app only with customer names in payloads, ATS off / cleartext on / backups on, bundle ids drifting from the native
projects, a fake language selector, ~65 local money / date formatters, and the mobile packages' tests never running in CI.

Process: five agents in parallel against a lead-written contract with the open decisions taken as defaults (bundle ids =
the native projects; TanStack Query; no crash vendor; manager-pay stays; EN / VI): A transport + native realtime · B app
version, `/app-config`, update gate, remote config · C server-state layer, offline cache, idempotency journal · D push, deep
links, Face ID, native security config · E observability, i18n, money / date adoption, CI, the audit document. No second
round; the lead integrated.

### (a) What changed
| Area | Now | Proof |
|---|---|---|
| **Native realtime (bug 1)** | a single-use, 60-second **stream ticket** (`POST /realtime/stream-ticket`, migration 557) bound to the session, realm and device — never a bearer in a URL; a fresh ticket on every reconnect; logout disconnects; the ticket redemption runs the full session checks (revocation, lockdown, authz) | **live 17/17** (`live-phase13-native-realtime.mjs`: a technician signed in the native way, no cookie, receives events; a reused ticket is refused; logout ends the stream) |
| One transport (§11–16) | `packages/mobile-sdk/src/network/`: one `apiBase()` per call, `/api/v1`, bearer on every native method incl. uploads, `X-Client-Type / Version / Platform`, `X-Device-ID`, `X-Request-ID` (adopted as the correlation id), timeout classes 8 / 20 / 60 / 120 s, caller abort, GET-only jittered retry, `Idempotency-Key`, `NetworkState`; the four clients and three `authApi.http()` are thin wrappers; gate `check:mobile-transport` (0 raw `fetch` / `EventSource` in 246 app files) | transport tests per app |
| App version + update gate (§52–57, §150) | `package.json` is each app's one version source, synced into iOS / Android (`tooling/mobile/sync-versions.mjs --check`); `GET /app-config` (public, rate-limited) returns the version policy, client flags (through the Phase 11 rollout), kill-switch / maintenance / break-glass notices; **426 `UPDATE_REQUIRED`** for a NATIVE build below the minimum only — web, display, kiosk and header-less requests are never refused, sign-in / refresh / health / app-config always pass, no row = nothing refused; Super Admin → Mobile App Versions (policies + installed versions seen, device ids hashed); the Tap-to-Pay minimum moved onto it (latent bug 7 path gone) | **live 17/17** (`live-phase13-app-version.mjs`) |
| Server state + offline (§17–27) | TanStack Query 5.103.2 in the four apps, keys `[realm, tenant, branch, …]`, realtime → invalidation, an IndexedDB read cache (opt-in per query; tokens, card and payment fields stripped; wiped on logout and tenant / branch switch); "you're offline — last updated …" banners; adopted on the main screens (tech 4, owner 3, customer 3, manager-pay 1) | |
| Idempotency + journal (§14–15, §254–257) | `Idempotency-Key` on booking create, tech start / complete, approvals decide (server `@Idempotent()` added); a pending-mutation journal replays exactly once with the same key — only tech start / complete are queued offline; bookings and approvals are online-only (a stale slot or a refund must never confirm offline); payments are refused by construction | **live 13/13** (`live-phase13-offline.mjs`, real Chromium: offline start-service shows PENDING with 0 requests sent, the network returns → exactly ONE server-side start, one idempotency row, realtime resumes) |
| Push (bug 9, §58–63) | one module in `mobile-sdk` in all four apps (permission asked after a first meaningful action, typed categories, per-app targeting, tap routing re-authorized); the server sends only to the apps a category targets and drops personal-data keys; **every push producer (13 sites) carries no customer name** | inventory test over every producer |
| Deep links (§64–65) | `@capacitor/app`, a route table per app, `/.well-known/apple-app-site-association` + `/assetlinks.json` + web fallback served from env (404 until Kevin sets them) | |
| **Face ID (bug 2)** | a long-lived device credential (migration 559) stored in a Keychain / Keystore item the OS guards with biometrics on every read (before: no access control — only a JS check); enrolment needs a recent password sign-in or step-up; each Face ID sign-in re-checks the account like a refresh and rotates the secret, a reused secret revokes it; cleared on logout, 401, account switch, device revoke and password change (all three password-change paths now stamp `password_changed_at`, which they did not); manager-pay gets real Face ID; bug 14's dead flag removed | 16 DB tests + 13 client tests |
| Native security (bugs 8, 10, §130, §245–246) | `capacitor.config.ts` ids aligned to Xcode / Gradle (gate); release builds: no arbitrary loads, TLS-only, `allowBackup=false`; cleartext only in debug for localhost; privacy screen (tech, owner, manager-pay), auto-lock (owner 5 min, manager-pay 3 min), `FLAG_SECURE` on owner / manager-pay; dev / staging / prod env examples; mobile section in `SECURITY_THREAT_MODEL.md` | `check-native-config` gate (11 rules, each proven to fire) |
| Observability (§116–119) | error reports carry app / version / platform / screen; sanitized analytics (closed allowlist, on device AND server); perf marks (launch → first screen, API latency by class, realtime reconnect); a Super Admin count view | 21 privacy tests |
| i18n + money / date (bug 11, §97–100) | `t()` with EN (default) + VI catalogues, the user's language stored server-side (`users.preferred_language`, migration 560), the owner language selector real; 82 local money / date formatters now call the shared packages, byte-identical, branch time zone | catalogue tests (a missing VI key fails) |
| CI (bug 13, §213) | `mobile.yml` (Android `cap sync` drift check + `assembleDebug` ×4, iOS `cap sync` ×4 — GitHub runners), `stale mocks` gate (bug 12) | |
| Audit (§301 phases 1–2) | `MOBILE_ARCHITECTURE_AUDIT.md`: discovery, KEEP / MERGE / REFACTOR / REMOVE inventory, the decisions, all 14 bugs, Kevin's list | |

### Found by the agents and the integration — and fixed
| # | Defect | Fix + test |
|---|---|---|
| L1 | **A signed-out or revoked session's open live stream never ended — on the web too**: the realtime module's session-store injection was always undefined in the running API | resolved through the module reference; unit + mutation check; the native-realtime live check failed on it, then passes |
| L2 | **The Face ID Keychain item had no OS access control** — only a JavaScript check stood between an unlocked phone and the stored credential | biometric access control on the item itself |
| L3 | Push payloads named customers in queue assignment, reassignment and showcase follows; the comment push carried the comment text | stripped at every producer + a server filter; inventory test |
| L4 | Three password-change paths never stamped `password_changed_at`, so nothing keyed on it (sessions, Face ID) noticed a change | stamped; tests |
| L5 | Five public-by-design routes (the universal / app-link files, the web fallback, Face ID status and sign-in) were missing from the sign-in-boundary list | listed with reasons (status reveals only the feature switch — checked) |
| L6 | **The status-vocabulary snapshot was stale, which hid a real gap**: Face ID credential revocation (7 writes) wrote `status` outside any state machine | `BIOMETRIC_CREDENTIAL` machine (active → revoked only; never re-activated — re-enrolling inserts a new row); every revoke guarded by it; snapshot regenerated; the gate now 200 machines, 472 of 478 writes, 0 findings; mutation-checked |
| L7 | The "every app signs out on a 401" guard read each app's own client file — after the move to the shared transport it no longer saw the signal | the guard checks the shared transport (and that no app switches it off); mutation-checked |

### Security finding for Kevin (pre-existing, NOT fixed by code)
**Three Android upload keystores and their password files are committed** (`apps/{customer,owner,tech}-web/android/*.jks` +
`key.properties`, from the Sep 28 developer upload, `eba3e0cf`). Treat them as compromised: create new upload keys outside
the repository, reset the upload key through Play App Signing, then delete the files and purge them from git history
(the same history rewrite the old database login needs). Until then a gate allowlists those six files only.

### Mutation checks (Phase 13)
**137 mutants: 132 caught, 5 equivalent** (each noted with its reason). A 31 (1 equivalent), B 35 (3 equivalent), C 29 (1 equivalent), D 23,
E 17, lead 2 — first-pass survivors (B 6, C 3, D 1, E 1) closed with stronger tests. Logs: `scratchpad/p13/mut-{A..E,lead}.md`.

### Verification (Oct 9 2026, this tree)
| Lane | Result |
|---|---|
| gates | **42 gates + 12 audits passed** (new: `check:mobile-transport`, `stale mocks`, `mobile versions`, native config) |
| API (6 shards) | **2,498 passed, 0 failed** (shard 5 re-run on the final code after L6 / L7) |
| modules (26) | **9,095 passed, 0 failed** |
| web apps (8) | **3,192 passed, 0 failed** |
| packages (19) | **991 passed, 0 failed** |
| harnesses | **124 / 0** |
| race lane (fresh DB, all 553 migrations) | **223 passed** across 69 files |
| live proofs | **Phase 13: native realtime 17/17 · app version 17/17 · offline 13/13** · Phase 12 async 21/21 · `/api/v1` browser 19/19 · deals 39/39 · the whole 23-inch dual-screen set (lifecycle 30/30, ads 42/42, journeys, devices, check-in, 23-inch 37/37, ads page 14/14, layout 255/255) · tracing 16/16 · drills redis-loss 13/13, worker-loss 13/13, restore 11/11 · Phase 10 31/31 · RLS 20/20 · Phase 9 28/28 · Phase 1 10/10 · Phase 6 33/33 · Phase 7 31/31 · Phase 8 25/25 |
| apps | `tsc` + `vite build` clean in all four mobile apps and admin-web; no native build (no Mac / Android SDK here) |

### §303 Definition of Done — every line DONE, decided or Kevin's
DONE in code: inspected / documented / duplicates (audit doc); shared core (`mobile-sdk` network / config / query / push /
links / security / telemetry / i18n); contracts; realm clients; networking, timeouts, retry, idempotency; request metadata;
network state; offline read cache + mutation policy + conflict outcomes; financial actions never offline; server state;
realtime client, reconnect, authorization (native included), REST recovery; secure storage; logout wipes (cache, journal,
realtime, Face ID); Face ID; device revocation; tenant switching; permissions; flags; kill switches; maintenance;
version enforcement; push architecture + secure deep links; localization (mechanism + EN / VI catalogues); crash reporting;
performance; analytics sanitized; CI; security config; no provider secret in the apps (except the committed keystores —
Kevin, above); tests (offline, realtime, push, upgrade, security).
Decided: feature-folder restructure not done (Kevin's call, unchanged); no crash vendor; attestation / jailbreak detection
and certificate pinning not built (optional in the constitution).
**Kevin's** (exact steps in `docs/mobile/MOBILE_RELEASE_SETUP.md` and `MOBILE_ARCHITECTURE_AUDIT.md` §7): iOS build + signing on
a Mac (App IDs with Push + Associated Domains, APNs .p8 key and the `APNS_*` variables, `APPLE_TEAM_ID`, entitlements, the Tap
to Pay plugin); Android build + signing (NEW upload keys — above; Firebase `google-services.json` ×4 on the build machine,
`FCM_SERVICE_ACCOUNT_JSON`, the `ANDROID_CERT_SHA256_*` fingerprints, `APP_LINK_WEB_*`); one run of `mobile.yml` on GitHub;
real-device checks of push, links, Face ID (then `FACE_ID_ENABLED=1`); store URLs and minimum versions in Super Admin.

### What Phase 13 does NOT do (honest scope)
- Screens on the query layer: 11 of ~146 (the main read screens); the rest still use local state.
- i18n: 71 keys — the sign-in screens, tab bars and a few labels (~5% of visible strings); the rest show English in VI mode;
  no language selector in the customer, tech or manager-pay apps.
- 63 inline number / date sites not yet on the shared formatters (26 dates use the device zone).
- Offline cold launch still needs `/auth/me`; no server-side sync-record table (`expectedVersion` travels in the journal, the
  tech start route does not check it).
- No native crash / ANR / memory metrics; the mobile dashboard is Phase 14.
- App Attest / Play Integrity, root / jailbreak detection, certificate pinning (optional).
- Nothing was verified on a real phone; no iOS or Android build ran here (no Mac, no Android SDK).

## Phase 14 — Constitutions 11 (Observability) and 12 (Security), completed on the code side (Oct 9 2026)

Before this phase the two DoD scripts read §396 **50 DONE · 16 PARTIAL · 10 NOT DONE** (C11) and §324 **58 DONE · 19
PARTIAL · 5 NOT DONE** (C12), and many of those lines were stale predicates (lint IS a gate; the exporter, `/metrics`,
the Database page and the load harness existed). What was really missing in code: a place to search a request's logs and
trace, the storage / mobile / deployment / Redis / payments / communications / incident dashboards, branch health, an
alert chain that reaches a human, SLO validation, synthetic probes, backup staleness, security signals into incidents,
least-privilege database logins, a per-caller limit on guessing gift-card / coupon codes, webhook dedupe proven per
provider, a support-session expiry guard, a real caller for tenant-filtered AI retrieval, a malware-scanner adapter, and
an IDOR suite for the routes added in Phases 9–13.

Process: five agents (A log + trace store and telemetry permissions · B metrics, dashboards, branch health · C alert
escalation, SLOs, synthetic probes, backup and security monitoring · D security code items · E DoD predicates, IDOR suite,
documents, Kevin's list) against a lead-written contract. The workspace container restarted mid-run (16:58); every
agent's work was on disk and each was resumed on its own section. The lead integrated.

### (a) What changed
| Area | Now | Proof |
|---|---|---|
| **Log + trace store (C11 §291–292, D7)** | migration 561 `telemetry_log_events` + `telemetry_spans` (plain tables + a time index + the retention executor, 14 days — no partition job to babysit); a batched, bounded, **fail-open** sink in `packages/observability` (every WARN+, INFO sampled at `TELEMETRY_LOG_SAMPLE` 0.1, always kept for an errored request or a sampled trace; every exported span also stored locally; redacted before write — no bodies, tokens, phones, emails); search API `super-admin/observability/{requests, requests/:id, correlations/:id, traces/:id, logs}`; admin-web **Request search** (trace waterfall + linked logs) | **live 22/22** (`live-phase14-telemetry.mjs`: a request found by request id and by correlation id incl. the worker's job; its trace with the server span, 17 DB spans and the job span, logs attached; a 400 found at warn; a seeded email and secret never stored) · 30/30 mutations |
| Telemetry permissions (§181) | `super_admin.telemetry.view` (aggregates) vs `super_admin.telemetry.sensitive.view` (tenant ids, routes with ids, error text); a caller without the second key gets redacted rows and a 403 on the tenant filter | permission spec 19/19 + live |
| **Jobs join their request's correlation chain** (found by the live proof) | `enqueueJob` kept the trace but not the correlation id — a request's job could not be found by correlation id. `setJobCorrelationSource` wired at boot; an explicit id still wins | test written first (3) |
| Metrics (§§143–155) | process RSS / heap / CPU / handles; queue depth by class + priority, oldest due age, running, dead letters; outbox pending / oldest / dead; storage bytes / ops / errors / latency by store (media + private store instrumented); per-process heartbeats (migration 562) | 43 mutations (40 caught, 3 equivalent) |
| **Dashboards** | one System Operations "Operations Dashboards" screen with 7 tabs — Storage, Mobile, Deployment (boot history, schema version, pending migrations, uptime, release notes), Redis, Payments (approval / decline / stranded, provider latency + breaker, webhooks), Communications, Incidents; an unmeasured value shows "—", never 0 | screen tests + pgtests per source |
| **Branch health (§345)** | `branch_health_snapshots` every 15 min per branch (open tickets, queue + longest wait, techs on shift, payments last hour, devices online, last realtime event, SMS failures) → HEALTHY / DEGRADED / UNKNOWN (a failed fact query is UNKNOWN, never healthy); Super Admin **Branch Health** (worst first) + an owner-app card (own salon only) | pgtests incl. a cross-salon leak mutation |
| **Alert escalation (§262–265)** | migration 563 `oncall_contacts` + `alert_escalations`: an unacknowledged alert moves to the next contact after N minutes per severity through email / SMS / push; acknowledge from the screen or a **signed, single-use** email link (GET only shows, POST acknowledges — mail scanners can't ack); Super Admin **On-call & Monitoring** screen (edits need step-up + reason) | pgtests + 32/32 mutations |
| SLO validation (§80) | each of the five proposed SLOs is marked validated / breached from persisted metrics once `SLO_VALIDATION_MIN_DAYS` (28) and `SLO_VALIDATION_MIN_REQUESTS` (1000) exist; shown on System Ops; multi-window burn-rate alerts (Phase 11) unchanged | pgtest |
| Synthetic probes (§94–95) | kiosk probe against a designated test salon, sandbox-payment probe (CardPointe UAT only), SMS probe (Twilio test credentials) — each reports **not configured** until Kevin sets it up, never a fake pass | pgtest |
| Backup monitoring | no successful backup report within 26 h → alert (`BACKUP_REPORTS_REQUIRED=1`); `deploy/backup/` script (pg_dump → `pg_restore --list` check → upload → report) + Railway cron note + a GitHub workflow template kept OUTSIDE `.github/workflows` | script spec |
| Security observability (D8) | 401 / 403 spikes, 429 storms, webhook-signature failures and break-glass toggles → `security_incidents` with de-duplication, using the platform's listed incident categories | pgtest 14/14 |
| **Least-privilege DB logins (C12)** | `apps/api/db/roles/` + `db-provision-roles.mjs` (`--dry-run / --write / --check`, idempotent): `aps_api` (rows only — no DDL, TRUNCATE, REFERENCES, TRIGGER) and `aps_worker` (only the 30 tables the worker touches, some column-level); `MIGRATE_DATABASE_URL` for migrations | real-Postgres test: the worker's claim / lease / complete / retry / bury / reap, telemetry writes and retention run as `aps_worker`; 18 forbidden statements refused (42501) |
| **Code-guessing limit** | `@CodeLookupLimited` on every gift-card / coupon / reward-code / gift-claim lookup: per caller (12), per IP (30), per salon (60) in 15 min; a hit costs 0.1, a miss 1; 429 + `Retry-After`; Postgres store with advisory locks (migration 564) so concurrent guesses can't all pass | race test (40 concurrent guesses → ≤ 12 admitted) |
| **Webhook dedupe, per provider** | a test per provider (Fiserv, CardPointe, Clover, bank, Twilio inbound + status, booking verification, integrations, billing, AI billing, transcription, voice outcome); forged signatures refused with nothing written | **4 real double-processing bugs fixed** (below) + migration 565 |
| Support-session expiry | the tenant-context middleware verifies a support-session grant (live, not ended, owned by that admin) on every request, and a support session's realtime stream ends at expiry | 3 mutations caught |
| AI retrieval caller | tenant-filtered, visibility-filtered knowledge retrieval wired into Reception Copilot's explain path; 60 prompt-injection eval cases run in CI | cross-tenant pgtest (Tenant B's documents never reach Tenant A) |
| Malware scanning | ClamAV adapter (`clamd` over TCP, `CLAMAV_HOST`) used by the upload policy when configured; detection → quarantine | EICAR against a fake clamd |
| **IDOR suite (§286)** | `idor-routes.mjs` from the manifest: 175 tenant GET-by-id routes, 158 tried cross-salon, 17 exempt with a reason | **live 8/8**: 135 refused, 23 answered 2xx with none of salon A's data, **0 leaks, 0 server errors**; 4 routes that crashed with a 500 on another salon's id fixed (mobile-checkout ticket, AI-booking appointment, terminal test / unpair, OCR preview without a key) |
| DoD predicates | every line of the three scripts points at an export, route, migration or test (never a comment); `dod-predicates.vitest.spec.ts` copies the evidence tree and proves each line flips to NOT DONE when its evidence is removed; `npm run lint` is now the ratchet (a new warning fails) | 6/6 + 2 mutations |

### (b) Defects found and fixed during the phase
1. **Card-processor webhooks (Fiserv / CardPointe / Clover):** a re-delivery racing the original wrote 3 refund rows and 2 settlement batches. Now the processed-ledger row is claimed before any effect, the duplicate check is scoped by salon and processor, and migration 565 adds the uniques.
2. **Integrations inbound:** three drains at once ran the handler 6 times for 2 events → conditional claim.
3. **Super Admin billing ingest:** 7 of 8 concurrent deliveries failed with a duplicate key (a 400 to the provider) → claim first.
4. **Call transcription:** a re-delivered call was **charged its minutes again on every delivery** → one usage row per call (565).
5. **Four routes answered 500** to another salon's id (above) → 404 / 403.
6. **Jobs lost their request's correlation id** (above).
7. **Integration (lead):** the new code-guessing limit was also on "apply a listed deal by id" and "split payment with no gift-card leg" — requests that carry no code. The Phase 5 load proof caught it: 120 registers applying one capped deal got **3** through instead of 40. The limiter now engages only when the request names a code (`when:` predicate; test written first, 3 cases) → **39/39**.
8. **Integration (lead):** the security signals wrote incident categories (`credential_attack`, `abuse`, `webhook_forgery`, `break_glass`) outside the platform's incident vocabulary — the incident screens' category filter would never show them. Mapped to `authentication`, `privilege`, `network`, `fraud`, typed against the vocabulary, and the vocabulary guard extended (2 mutations caught).
9. Integration: the on-call push now carries a typed category (`BUSINESS_ALERT`) and is on the reviewed push-producer list; the public ack routes are on the reviewed public list; an `is distinct from excluded` clause rewritten so the schema guard reads it; dashboard / telemetry / branch-health handlers typed with api-contracts; two platform-wide count queries reviewed and baselined in the tenant check.

### (c) Verification (the full lane run, TZ=UTC, then the affected suites re-run after the integration fixes)
| Lane | Result |
|---|---|
| CI gates | **42 gates + 12 audits passed** (re-run after the fixes) |
| API (6 shards) | 2,833 tests: 2,705 passed + 5 failed (the four integration guards above) → fixed; `src/common` + `src/observability` re-run **1,897 passed / 0 failed** |
| Modules | 26 suites, **all passed** (~9,190 tests); checkout re-run after the limiter fix 650/0 |
| Web apps | 8 suites, **all passed** (3,229) |
| Packages | 19 suites, **all passed**; security re-run 16/16 |
| Harnesses | 124 / 0 |
| Race lane (fresh DB, 558 migrations) | **235 tests, 72 files, 0 failed** |
| Live proofs | Phase 14 telemetry **22/22**, IDOR **8/8**; Phase 13 17/17, 17/17, 13/13; Phase 12 21/21, 19/19; deals **39/39** (after fix 7); display set 30/30, 42/42, journeys, devices, check-in, 37/37, 14/14, layout 255/255; tracing 16/16; drills Redis-loss 13/13, worker-loss 13/13, restore 11/11; p10 31/31, RLS 20/20, p9 28/28, p1 10/10, p6 33/33, p7 31/31, p8 25/25 |
| DoD scripts | **§396: 70 DONE · 6 HOSTING · 0 PARTIAL · 0 NOT DONE of 76** · **§324: 71 DONE · 11 HOSTING · 0 PARTIAL · 0 NOT DONE of 82** (both `--run` green) · control-plane §303: 71 DONE · 2 PARTIAL (recorded decisions) |
| Mutation checks | ~145 run, ~141 caught, 4 equivalent (logs `scratchpad/p14/mut-{A..E}.md`) |

### (d) Honest gaps
- The IDOR live suite covers GET-by-id routes; write routes stay covered by the existing cross-tenant pgtests. 27 routes have a weak positive control (the generic seeder can't build their jsonb shapes).
- The emailed acknowledge link is proven by pgtests and controller tests, not by a live boot sending a real email.
- Every HOSTING line needs Kevin (below); in particular the least-privilege logins, ClamAV and on-call contacts are built but **off** until configured.
- Two Super Admin Database-page actions (VACUUM ANALYZE, "retry deferred constraint") need the owner login once the API runs as `aps_api`; the page shows the refusal.

### (e) Kevin's list (Phase 14 — full rows in `docs/HOSTING_ACTIONS_FOR_KEVIN.md` §D)
1. **D1 database logins:** `PROVISION_DATABASE_URL=<owner URL> APS_API_PASSWORD=… APS_WORKER_PASSWORD=… node apps/api/scripts/db-provision-roles.mjs --dry-run`, then for real; on both Railway services set `MIGRATE_DATABASE_URL` = owner URL, `DATABASE_URL` = `aps_api` on the `*.railway.internal` host, `PG_WORKER_DATABASE_URL` = `aps_worker`. Re-run after a deploy that changes `03_worker_grants.generated.sql`.
2. **D2 ClamAV:** run a clamd service, set `CLAMAV_HOST`, later `CLAMAV_REQUIRED=1`.
3. **D3 / D4 synthetic probes:** designate a test salon (Super Admin → On-call & Monitoring); CardPointe UAT (`SYNTHETIC_PAYMENT_SANDBOX_*`) and Twilio test credentials.
4. **D5 on-call:** enter contacts; set `PUBLIC_API_BASE_URL` and `ALERT_ACK_SECRET` (32+ chars).
5. **D6 backups:** schedule `deploy/backup/backup-and-report.sh` (Railway cron or copy the workflow template into `.github/workflows`), then `BACKUP_REPORTS_REQUIRED=1`.
6. **C4 OTLP** (optional — in-platform search already works): `OTEL_EXPORTER_OTLP_ENDPOINT` (+ `_HEADERS`).
7. **D7–D9:** an independent penetration test; real-device mobile testing; confirm backup encryption + restrict Railway project access. TLS / WAF / PITR / restore drill / private Postgres + Redis / staging load test: existing rows A2, A3, A7, A8, B1, B4, C5.

## Phase 15 — Close-out: events and realtime producers, legacy removal, unique-index review, stale documents, every DoD line, and three money-path bugs (Oct 10 2026)

Process: five agents against a lead-written contract (A events + realtime · B legacy removal · C the unique indexes without
`tenant_id` · D stale documents · E the DoD sweep and Kevin's list), then two short rounds for real bugs the first round
surfaced but left alone (F terminal capture · G "first available" booking + realtime catalog · H the post-payment work and
POS card atomicity). The lead integrated.

### (a) What changed
| Area | Now | Proof |
|---|---|---|
| **Events (C8)** | a new gate `check:event-producers` (every registry event has an outbox producer, every subscription names a registry event, no retired name referenced anywhere) + generated `docs/EVENT_CATALOG.md`; `visit.started`, `checkout.started`, `payment.authorized` **retired** (plan default); `customer.merged` produced by the salon's duplicate merge in the same transaction (ids only); `visit.completed` produced once, when a ticket moves into `paid` (the platform's own definition of a visit), by both paid writers | 155 events, 155 produced, 3 retired · gate spec 12 · merge pgtests 4 + real-PG · visit pgtests 9 + real-PG |
| **Realtime (C9)** | `settings_updated` already had seven producers through a `packages/` helper the gate never read — the gate now reads helpers and **NO PRODUCER is a failure**; the realtime catalog generator classifies every event and **fails on UNCLASSIFIED or a stale catalog** (`check:realtime-catalog`, new gate) | 102 events, all produced, 0 unclassified |
| **Repository (C13)** | removed under the zero-importer rule: `apps/go-check-in-admin` (→ admin-web Check-In Devices), `apps/booking-html` (→ customer-web Book), `apps/booking-schedule-html` (→ pos-web `/tenant/booking`), `_MERGE_ARTIFACTS/`, `HANDOFF/`, the two nested lockfiles; `booking-public` kept (the live signed-link page); architecture tests now fail if any retired path or any nested lockfile returns; `check:v1-clients` fails on an app it does not scan | §388: 6 DONE · 1 DECIDED (`packageManager` unpinned) · 3 planted mutants caught; `e2e:html` repaired (failing since Phase 12) |
| **Unique indexes (C1, deferred from Phase 10)** | 96 non-PK unique indexes on tenant tables without `tenant_id` reviewed with code evidence in `docs/UNIQUE_INDEX_TENANT_REVIEW.md`; new gate `check:unique-tenant-review` fails on an unreviewed one | 95 reviewed (45 tenant-owned parent id · 16 platform reference · 13 secret hash · 9 composed · 4 provider id · 8 dead) |
| **Documents** | `START-HERE.md` rewritten as the developer entry point; `DEPLOYMENT.md` matches the Dockerfile, `MIGRATE_DATABASE_URL`, the worker and 317 env names; `API_INVENTORY.md` regenerated (2,878 routes — the generator had been missing every `modules/*` controller); `API_DEFINITION_OF_DONE`, `PERMISSION_AUDIT`, `AI_QUEUE_ASSIGNMENT_RECONCILIATION`, `COMPLETE_MODULE_WIRING_MATRIX`, `SAFETY_COMMUNITY_PHASE1`, `STATUS_CHECK`, `CONSTITUTIONS_CONFORMANCE` corrected or marked superseded (history kept); 13 more root docs annotated | `scratchpad/p15/doc-sweep.md` |
| **Every DoD line** | C10's "Tests pass" predicate reads vitest's JSON report (the only skips are race files the race lane runs); C7 gains a DECIDED status (each needs its decision record); `docs/PROGRAMME_DOD_STATUS.md` + `apps/api/scripts/programme-dod.mjs` | scripted total **303 lines: 283 DONE · 18 HOSTING · 2 DECIDED · 0 PARTIAL · 0 NOT DONE** |

### (b) Defects found and fixed
1. **Processor webhook events from two salons collided** (`payment_gateway_events` claim index was platform-wide): salon B's settlement or refund event with the same processor event id as salon A's was answered "duplicate" and never recorded. Migrations 567 (pre-flight) + 568 (CONCURRENTLY `(tenant_id, processor_type, event_id)`); a processed event must carry a salon. The runner now skips a CONCURRENTLY unique build that has an open deferral instead of failing the deploy.
2. **Card-testing fraud incidents were dropped for the second salon** the same day (same incident reference when no branch) — the owner was never told. The reference now carries the salon id in that case.
3. **Customer-display terminal payments recorded no events** — the ticket was marked paid outside any transaction with errors swallowed, and no `payment.captured` / `checkout.completed` / `visit.completed` was written, so loyalty and analytics never saw them. Now one transaction under a ticket lock, once per display session; a recording failure becomes the Decision-22 "processing" state the POS verifies. Found while testing: **two racing Pay taps could charge the card twice** — fixed (per-attempt lock).
4. **Terminal-paid tickets skipped all post-payment work** — a gift card sold on the ticket was never activated, deals not redeemed, the technician compensation snapshot not written. They now run the POS's own `afterPaid` (reused, not copied), idempotently; every failing step is now logged (it was silent on the POS too). Membership commission gained the concurrency guard it lacked.
5. **POS live card payments could leave a charged-but-open ticket** (payment and paid status in two transactions, each swallowing errors), and **wrote no `payment.captured` at all** — live POS card payments earned no loyalty points. Now one transaction (`completeCardPayment`).
6. **"First available" bookings failed** on every real-database channel (public link, AI receptionist, the POS "First Available" chip): the engine wrote a null technician into a NOT NULL column. It now assigns the first free, skilled technician by the customer app's rule; an old test that encoded the bug was rewritten.
7. Integration: the booking harness case that relied on an unassigned booking now writes the unassigned row directly (the guard is still covered — mutation caught).

### (c) Verification (full lane run, TZ=UTC)
| Lane | Result |
|---|---|
| CI gates | **45 gates + 12 audits passed** (3 new: event-producers, realtime-catalog, unique-tenant-review) |
| API (6 shards) | **2,784 passed, 0 failed** (133 skipped) |
| Modules | 26 suites, **all passed** |
| Web apps | 8 suites, **all passed** |
| Packages | 19 suites, **all passed** |
| Harnesses | 123 + booking-core re-run **87/87** after the integration fix |
| Race lane (fresh DB, 560 migrations) | **244 tests, 75 files, 0 failed** |
| Live proofs | every one passed: telemetry 22/22, IDOR 8/8, native realtime 17/17, app version 17/17, offline 13/13, async 21/21, `/api/v1` 19/19, deals 39/39 (incl. 120 registers at once), display lifecycle 30/30, ads 42/42, journeys, devices, check-in, 23-inch 37/37, ads page 14/14, layout 255/255, tracing 16/16, drills Redis-loss 13/13 · worker-loss 13/13 · restore 11/11, p10 31/31, RLS 20/20, p9 28/28, p1 10/10, p6 33/33, p7 31/31, p8 25/25, `e2e:html` (kiosk + public booking link in a real browser, 24 API calls) |
| DoD | §396 70 DONE · 6 HOSTING · §324 71 DONE · 11 HOSTING · C10 71 DONE · 1 HOSTING · C7 71 DONE · 2 DECIDED — `programme-dod.mjs`: MET |
| Mutation checks | about 65 across A–H and the lead, all caught after strengthening (C1 / V1 survive only under PGlite's single session — the real-Postgres tests catch them) |

### (d) Honest gaps (none is a DoD line; none blocks a pilot salon)
- Queue assignment: serving-time routing of several technicians for a multi-service or group visit, and what-if simulation, are not built; no Playwright run of the queue-assignment / scheduling-optimizer screens against the live API.
- The voice receptionist and Reception Copilot don't place booking holds (a hold is a write behind a read key — needs a permission decision).
- Two simultaneous "first available" bookings can pick the same technician; the second gets an honest 409, not an automatic retry.
- `KyselyCheckoutRepository` caches ticket statuses per process: after a terminal payment, a second API replica's POS board can show the old status until it reloads (money, events and the paid check are correct). Matters once there are two replicas.
- `setStatus('paid')` called on its own (sandbox / in-memory fallbacks) is still best-effort.

## Oct 12–13 2026 — Merge of three lineages + the four mandates (Fair Turn, Technician Profile, Payroll, Dual-Screen) + Kevin's Oct 12 items

Full account for the developer: `DEVELOPER_HANDOFF_2026-10-13.md`. Inputs: the developer's tree as of Oct 6 (Power-Salon-main.zip),
the other Claude chat's Oct 12 package (330 files: Technician Profile phases 1–3, booking concurrency, Tech App, owner / Super Admin
features), and four mandates. Method: a merge contract; five port agents (developer delta · technician profile · payroll · booking ·
auth / Tech App API), each classifying every hunk ALREADY / PORT / CONFLICT and porting into the module layout (our structure wins,
their behaviour and fixes carried over); then five agents for the mandates' remaining work (Fair Turn Engine · payroll gaps ·
dual-screen line-by-line · the merged screens · a deep scan of Super Admin and the whole repo); then integration fixes.

Security: the developer's Oct 6 tree still contains the hidden `eslint.config.mjs` payload (Sep 29 finding) and a NEW obfuscated
`api.js` that its `package.json` build / dev scripts execute, plus a committed Firebase private key — none brought over; the developer's
machine and accounts must be treated as compromised. Refused from his tree: an unauthenticated push-token registration route,
client-supplied tenant / role ids, cleartext in customer-web.

Built (migrations 569–631): multi-technician routing; booking holds for the AI receptionist and copilot; replica-safe ticket status;
server-enforced POS auto-lock (on, 60 min, full sign-in after 8 h); Technician Profile (workforce state, breaks, time off, exact-service
eligibility, certifications, revocation chain, Tech App self-service, owner Live Team, Super Admin masking + support mode, favourites
first, Book This Look); Payroll (service sessions, commission provenance, review / approve / finalize / paid with step-up + hash,
payouts, audited export, locked-period refunds, exceptions + recovery, pay plans, inquiries); Fair Turn Engine (modes, versioned
policy, turn units, turn state + append-only events, skips that keep position, protection buffer, break policy, tie-breakers,
starvation boost, overrides with reason, daily reset, fairness dashboard, simulation); Dual-Screen (display state model, offline
check-in, standard codes, telemetry, EN / VI, display settings, Windows setup). Deep scan: 17 fixes (3 HIGH).

Found and fixed: existing salons' technicians would all have been refused on accept / start after deploy (migration 631 back-compat);
processor and payroll date bugs (periods split at UTC and lost their last day; a retail reversal dropped by a unique index); a race
when two helpers accept one line; first clock-in never entered the rotation; the display's phone-code screen could cover a payment;
go-check-in settings saved with a view permission; POS New Booking booked "tomorrow" after 8 pm on the east coast; gift-card
redemption could debit with no ledger row; commission-oversight history always empty (SQL type error); time-of-day and time-zone
dependent tests (time clock, unique-index review). POS safety refresh briefly 45 s, restored to 15 s on Kevin's Oct 13 instruction.

Verified: 45 gates + 13 audits · API 2,829/0 · 27 module suites · 8 web-app suites · 20 package suites · harnesses 124/0 · race lane
275/0 on a fresh DB · every live proof incl. Fair Turn 22/22, payroll 23/23, multi-technician 21/21, auto-lock 25/25 · programme DoD MET.


## Oct 13 2026 — Wave 3: Tap to Pay payment app, Payments / Clover / Fiserv / Twilio, Smooth Refresh, Technician Profile, Fair Turn → payroll chain

Kevin's four Oct 13 attachments audited section by section (ledgers: 224 + 191 + 123 + 183 sections, 0 NOT DONE) and every gap built
on the existing systems (one checkout, one payment domain, one payroll, one realtime). Tap to Pay on iPhone finished on
`apps/manager-pay-web` + `mobile-checkout` (claims, versions, device trust, unknown-state recovery, customer handoff, split / partial,
receipts, history / reports, branch switch, kill switches; Apple / Fiserv access BLOCKED_EXTERNAL); branch merchant accounts, terminal
registry with a real connection test, Twilio Messaging Service per salon, segment accounting, campaign cost preview; booking
create AND move blocked by the database on every path (15 s POS sync / 20 s reconciliation kept); technician employment history,
public-profile approval, transfer, portfolio → Nail Showcase, CSV import; 8 duplicate commission formulas merged onto the one
compensation authority. P0s fixed: customer web Pay screen sent the typed card number as a token (purge script for production);
any salon could take over another salon's SMS number. Migrations 638–641, 646–647, 660–661. Live money chain 24/24.
Verified: 45 gates + 13 audits · API 2,843/0 · 27 module suites · all web-app suites · race lane 294/0 · every live proof · DoD MET.
Details: `DEVELOPER_HANDOFF_2026-10-13.md` §2a.

## Oct 13 2026 — One payroll calculation (Kevin: "make into one only")

Commission, tip shares, technician earnings and payroll amounts are now calculated ONLY in `modules/workforce/src/compensation`
+ `modules/workforce/src/payroll` (integer helpers `percentOfCents` / `splitByPercent` in `packages/money`). 14 more places that did
their own math moved onto it (22 in all): Tech App estimate fallback, POS roster estimated commission / payroll snapshot (today's
sales × current rate, tips 0), three formulas inside the engine, commission report fallback, hard-coded 15 % on Service Done /
Serving, whole ticket tip to the primary technician (Tech Queue, owner dashboard, tip notifications), queue's own rate rules, the
membership split, a POS screen computing the technician share. New gate `check:one-payroll-calculation` (8 rules, frontends
included, 10 sabotage cases caught). Also: membership renewal dates were computed / printed in the server's time zone (UTC now).
Verified: 46 gates + 13 audits · API 2,844/0 · all module + app suites · race lane 294/0 · money chain 25/25 · payroll 23/23 · Fair Turn 22/22.

## Oct 13–14 2026 — Wave 4: deep scan of every module, pilot day, every gap fixed, malware clean-up kit

Route sweep (2,913 routes, PostgreSQL-log check for swallowed failures), event wiring proof and a full pilot day (74/74, onboarding
to payroll lock, real API + DB + apps in Chromium). ≈ 50 defects fixed with failing tests first — AI settings refused everyone,
AI booking link never booked, Customer App stream refused customers, POS commission never reached payroll, category/membership
rules never applied, surcharge not recorded, owner finance $0, POS Reports invented numbers, commission report $0 after 8 pm in
the US, audit and settings-audit rows lost, membership renewals never scheduled, mock SMS could run in production, owners can now
invite staff (managers with step-up). Developer malware: `tooling/security/clean-developer-tree.sh` + `docs/security/
DEVELOPER_MALWARE_CLEANUP.md`; gate `check:supply-chain-injection`; ten stray root scripts and three committed test exports removed.
Migrations 662–663. Verified: 47 gates + 13 audits · API 2,852/0 · all suites · race 294/0 · pilot 74/74 · sweep 14/14 · wiring 17/17 · DoD MET.
