# EVENT_ARCHITECTURE_REPORT.md
### Constitution 8 — the §227 Required Final Report (Sep 18, 2026)

**Base tree, stated first:** built on the July 2026 snapshot in this session, not the canonical `Power-Salon-main`
merged tree. §211 forbids duplicating existing infrastructure — **diff against `Power-Salon-main` for any queue or
outbox scaffolding from the infrastructure constitution before merging this arc.**

---

## 1. Existing Event Discovery (Phase 1 — every line grep-verified)

| Asked for | Found |
| --- | --- |
| EventEmitter usage | **None** — `@nestjs/event-emitter` unused (0 files) |
| Queues | **None** — BullMQ not a dependency; "Queue" in the codebase is the salon customer queue |
| Workers | 10 env-gated tick schedulers (audit-engine, customer-reconciliation, customer-import, customer-data, sms-reconciliation, ai-marketing send-sweep, billing-cycle, billing-export, deposit-reconciliation) — **jobs**, not events |
| Cron jobs | the same 10 (setInterval + flag; no cron daemon) |
| Webhooks | 11 inbound receivers (payments → `payment_gateway_events`, messaging-inbound, voice-booking, customer-booking, ai-voice-transcription, call-intelligence, api-webhooks, deposit-reconciliation, super-admin billing/integrations/tenants); outbound via `tenant_webhooks` + `tenant_webhook_deliveries` |
| Realtime events | `src/realtime/` — 44 client event names, envelope, forbidden-key guard, Redis pub/sub bus, SSE gateway. A **client projection**, not a domain backbone (§112) |
| Cross-module calls | **61** direct `realtime.toTenant` pushes + direct push / loyalty / audit / ledger calls from checkout (9), serving (8), tech-profile (6), queue (4), customer-booking, payroll |

## 2. Problems Found

| Class | What was actually there |
| --- | --- |
| Tight coupling | queue → push, booking → realtime, checkout → commission ledger, payroll → push: every side effect an in-process call from the producing service |
| Lost-event risk | every side effect fires **after commit, outside any transaction**; a crash between commit and call loses it with no record. Three producers (booking no-technician path, queue assign, customer create) were **bare statements outside any transaction at all** |
| Duplicate side effects | none durable, so none retried — the opposite problem: fire-once-and-forget |
| Non-idempotent handlers | push/realtime calls had no idempotency at all; only domain ledgers (copilot actions, upsell, voice gateway) guarded their own business effects |
| Missing tenant context | not missing on the calls (ctx was always passed) — but with no envelope there was nothing to *verify* against |
| Missing retries / DLQ / versioning | **all absent** — no outbox, no processed_events, no dead letters, no event contract, no versions |

## 3. Event Architecture Diagram (as built)

```
Domain transaction (repository)            e.g. KyselyCheckoutRepository.recordSplitAtomic
      │  business rows + OutboxWriter.write(trx, event)  — one COMMIT, all or nothing (§18)
      ▼
PostgreSQL ── outbox_events (pending)      migration 433; indexes §212
      │
      ▼
OutboxPublisher (worker, EVENT_PUBLISHER_ENABLED)
      │  claim batch FOR UPDATE SKIP LOCKED (§21) → publish → mark published
      │  infra failure → backoff+jitter, 'failed' after 25; stale claims reaped after 5 min (§22 at-least-once)
      ▼
EventTransport (interface, §27) ── InProcessTransport today; Redis Streams / broker later, no Kafka yet (§219)
      │
      ▼
ConsumerRegistry (§89, one place) ──► ConsumerRunner per consumer, isolated (§30)
      │  validate → upcast/refuse version → tenant present → BEGIN → processed_events? → handle(trx) → mark → COMMIT (§24)
      ├─ success ............ processed_events (consumer_name, event_id)
      ├─ TRANSIENT .......... event_dead_letters status=retrying, backoff → DeadLetterRetryWorker re-runs when due (§50)
      ├─ PERMANENT / DATA_INTEGRITY ... status=open, for a human (§48)
      └─ SECURITY (tenant mismatch) ... status=open + security.tenant_mismatch written to the OUTBOX (§143)
      ▼
Consumers: realtime.projection (domain → 44 client names, ids only, §113) · notifications.push (§57/§105)
Super Admin: /super-admin/events/{health,search,dead-letters,retry,discard} (§150–155), permissioned
```

## 4. Event Registry (generated from `event-contract.ts` — 68 types, 23 domains)

> **Superseded on Oct 10 2026** by the generated `docs/EVENT_CATALOG.md` (155 events, each with its producer and consumer
> files). This table is the Sep 2026 snapshot; three of its names were retired in BUILD_PLAN Phase 15 and are struck through.

| Domain | # | Events |
| --- | ---: | --- |
| `appointment` | 6 | `appointment.created` · `appointment.confirmed` · `appointment.rescheduled` · `appointment.canceled` · `appointment.completed` · `appointment.no_show` |
| `checkin` | 1 | `checkin.customer_checked_in` |
| `visit` | 2 | ~~`visit.started`~~ (retired) · `visit.completed` |
| `queue` | 4 | `queue.customer_joined` · `queue.customer_called` · `queue.customer_assigned` · `queue.customer_removed` |
| `service` | 4 | `service.started` · `service.paused` · `service.resumed` · `service.completed` |
| `checkout` | 2 | ~~`checkout.started`~~ (retired) · `checkout.completed` |
| `payment` | 5 | ~~`payment.authorized`~~ (retired) · `payment.captured` · `payment.failed` · `payment.refunded` · `payment.voided` |
| `technician` | 3 | `technician.assigned` · `technician.clocked_in` · `technician.clocked_out` |
| `payroll` | 1 | `payroll.period_paid` |
| `customer` | 4 | `customer.created` · `customer.updated` · `customer.merged` · `customer.phone_verified` |
| `deal` | 1 | `deal.redeemed` |
| `coupon` | 1 | `coupon.redeemed` |
| `loyalty` | 2 | `loyalty.points_earned` · `loyalty.points_redeemed` |
| `membership` | 2 | `membership.activated` · `membership.canceled` |
| `gift_card` | 2 | `gift_card.issued` · `gift_card.redeemed` |
| `inventory` | 2 | `inventory.adjusted` · `inventory.low_stock` |
| `communication` | 3 | `communication.sms_sent` · `communication.sms_delivery_failed` · `communication.push_sent` |
| `review` | 1 | `review.submitted` |
| `security` | 1 | `security.tenant_mismatch` |
| `platform` | 2 | `platform.tenant_suspended` · `platform.tenant_activated` |

**Produced today (31):** `appointment.created/confirmed/completed/canceled/no_show` (booking repo),
`payment.captured` (checkout), `queue.customer_assigned` (queue), `customer.created` (customers),
`service.started/completed` (serving — pause/resume are in-memory overlay with no durable write, so they
emit nothing until they persist, §3), `payment.failed` (checkout, declined records), `checkout.completed`
(checkout setStatus(paid)), `queue.customer_joined/called/removed` (queue create + setStatus),
`review.submitted` (a technician rating IS a review of that visit — one vocabulary, not two),
`technician.membership_approved` (tech-profile), `ticket.change_request_created/approved/rejected` (serving),
`customer.updated` (customers), `technician.profile_updated` + `technician.membership_rejected`
(tech-profile), `appointment.rescheduled` (booking),
`ticket.service_line_added/updated/removed` (serving),
`followup.tasks_generated` + `followup.task_sent` + `followup.task_status_changed` (end-of-day follow-ups), `security.tenant_mismatch`
(runner). The other 32 are **declared so producers cannot invent names**; they are
wired as their modules migrate (§220 Phase 13 continues per producer).

## 5. Consumers (§223)

| Consumer | Subscribed | Business effect | Idempotency | Retry | Dead-letter | External dep |
| --- | --- | --- | --- | --- | --- | --- |
| `realtime.projection` | appointment.*, queue.*, service.*, payment.*, checkout.completed, customer.*, ticket.service_line_*, ticket.change_request_*, review.submitted, technician.* | emits the matching client event(s), ids only, to the tenant room — and, for ticket-scoped events, to that ticket's own room (§113) | processed_events | standard (5) | per consumer | none (in-process / Redis pub-sub) |
| `loyalty.points_on_payment` | payment.captured | 1 point per whole dollar (the existing skip-line rule) credited to `customer_loyalty_profiles` | processed_events **+ `loyalty_point_earnings` UNIQUE(tenant, payment)** — the §25/§102 business guard; a replay cannot double points | CRITICAL (12) | per consumer | none |
| `ai.usage_ledger` | ai.usage_recorded, ai.job_failed | writes the job's tokens + integer-cent cost into the EXISTING `ai_usage_logs`, keyed by event id | processed_events; event id stored as request_id | CRITICAL (12) | per consumer | none |
| `analytics.daily_rollup` | appointment.*, service.completed, queue.customer_joined, customer.created, checkout.completed, payment.captured/failed, review.submitted | increments counters in the EXISTING `pos_kpi_daily_snapshots` (module `events`), bucketed by the day the event HAPPENED | processed_events, in the same transaction as the increment | standard (5) | per consumer | none |
| `notifications.push` | queue.customer_assigned | push to the technician's app account | processed_events + reference `queue_assignment:<eventId>` | provider failure = TRANSIENT, standard (5) | per consumer | push provider |

## 6. Event documentation (§222) — the contract every event carries
Name (registry) · Version (`EVENT_VERSIONS`, currently 1 everywhere) · Producer (the repository transaction) ·
Tenant scope (`tenantId` mandatory except `platform.*` and `security.tenant_mismatch`, §13/§168) · Payload
(ids + minimal facts; forbidden keys rejected: PII list from realtime-core + otp/code/secret/tokens/card+bank;
32 KB cap) · Criticality (consumer-side, `critical` flag → 12 attempts) · Ordering (`aggregateVersion` optional,
§40; publisher delivers by `occurredAt`) · Replay (see §8 below) · PII (§95: never name/phone/email in payloads —
asserted by tests by value) · Retention (see §8).

## 7. Runbooks (§224)
| Situation | Where to look | What to do |
| --- | --- | --- |
| Outbox backlog | `GET /super-admin/events/health` → `outbox.pending`, `oldestPendingAgeSec` | Is `EVENT_PUBLISHER_ENABLED` set on at least one instance? Check `failed` + `last_error_code`; more publisher instances are safe (SKIP LOCKED) |
| Publisher failure | rows stuck `claimed` older than 5 min | the reaper returns them to `pending` automatically; if `claimed_by` never changes, that instance is dead |
| Consumer failure | `deadLetters.byConsumer` | `retrying` = transient, leave it; `open` = look at `last_error_code`; retry from the endpoint after a fix |
| Dead-letter spike | `health.deadLetters.open` rising for one consumer | one consumer, not the bus — other consumers keep going (§30); fix, then retry the rows |
| Transport outage | `outbox.failed` climbing, `last_error_code` like `err_econnrefused` | nothing is lost; rows back off and drain when it returns (§204 test) |
| Duplicate events | consumer ran twice? | it cannot for one `(consumer, event)` — check `processed_events`; if a *business* effect doubled, the consumer lacks a business-uniqueness constraint (§25) |
| Tenant mismatch | `security.tenant_mismatch` events in search | a handler loaded another tenant's resource — a bug in that consumer, never retried (§51) |
| Replay | **not built** — see §8 | |

## 7b. Retention (§97–99, §162) — built after the report's first cut
`EventRetentionWorker` (6-hourly, batched 5,000, env-gated with the publisher). Classes by event-type prefix:
**FINANCIAL** (payment / settlement / deposit / gift_card / payroll / checkout) and **SECURITY** (security /
platform) kept 400 days; **STANDARD** 30 days. Only `published` outbox rows are ever deleted — pending, claimed and
failed rows are work, not history, and are never touched. `processed_events` trimmed at 45 days (≥ any retry
horizon; §162 — which is also why financial uniqueness must live in domain tables permanently). Dead letters:
only `resolved` / `discarded` older than 90 days; open and retrying never. Idempotent: a second pass is a no-op.
Tested on real Postgres for what it deletes AND for what it must never delete.

## 7c. Replay (§43–47) — built after the report's first cut
Replay is a property of the **consumer**, not the event (§44). Every consumer declares `REPLAY_SAFE`,
`REPLAY_SAFE_WITH_IDEMPOTENCY` or `NOT_REPLAYABLE`, and **a consumer that declares nothing is treated as
NOT_REPLAYABLE** — the safe default, because §43's prohibition (never re-capture a payment, re-send an SMS,
re-spend a gift card) must hold for anything nobody has thought about yet. Today: `realtime.projection` is
REPLAY_SAFE; `loyalty.points_on_payment` is REPLAY_SAFE_WITH_IDEMPOTENCY *only because*
`loyalty_point_earnings UNIQUE(tenant, payment)` refuses the second award — remove that constraint and it
becomes NOT_REPLAYABLE; `notifications.push` is NOT_REPLAYABLE.

`POST /super-admin/events/replay/preview` changes nothing and returns a confirmation token bound to the exact
request *and* the row count it saw; `POST /super-admin/events/replay` refuses without that token, so a range
that grew between preview and confirm is rejected rather than silently replaying more than was approved. One
consumer, one tenant, one range, 5,000 events max (§46) — never platform-wide. Every run is audited.
§47: the **original** eventId is preserved, so `processed_events` makes an already-handled event a no-op —
a replay rebuilds what is missing and re-does nothing that is already done. Both properties are tested.

## 7d. Fair scheduling (§129) — built after the report's first cut
The publisher's claim used plain FIFO (`ORDER BY occurred_at`), which is exactly the starvation §129 warns
about: the constitution's own example is tenant A generating 100k analytics events while tenant B's critical
event waits. The claim now ranks each tenant's due events independently
(`row_number() OVER (PARTITION BY tenant_id ORDER BY occurred_at)`) and takes rank 1 from every tenant before
rank 2 from anyone — a round-robin interleave. Platform events (`tenant_id` NULL) rank as their own group, so
they are never starved either. **Fairness between tenants never reorders events within one tenant** (§38) —
asserted.

A hard per-tenant cap was tried first and **rejected**: it under-filled the batch when only one tenant was due
(100 → 26), trading throughput for a fairness the ranking already provides. Both properties are now tested: the
quiet tenant's event goes out *first* rather than 201st, and a tenant alone in the outbox still gets full
batches. Load: 500 events × 3 consumers, ~279 deliveries/s on PGlite — unchanged.

## 7e. AI operational events (§83) — built after the report's first cut
Registry gains the five §83 names (`ai.job_requested / job_completed / job_failed / usage_recorded /
safety_event_detected`). `ai.usage_ledger` writes into the **existing** `ai_usage_logs` (§211) — tokens,
integer-cent cost, status, and the event id as `request_id`, so a usage row traces back to its event.

§83 says not to publish raw prompt or response content. That is enforced **twice**: the envelope validator
rejects forbidden keys before an event is written, and the consumer independently refuses any payload carrying
`prompt`, `completion`, `response`, `messages`, `transcript`, `inputText` or `outputText` — a PERMANENT
failure, never a retry. A future producer that ignores the rule fails loudly instead of persisting a
customer's words into the billing ledger. Both refusals are tested.

Recording usage as an event also closes a real gap: done inline, a crash between "the model answered" and
"we wrote the bill" loses billable usage silently. A failed job still records its cost.

## 8. What is NOT done (stated, not hidden)
- **Redis Streams transport** — the interface exists; only the in-process implementation does.
- **34 realtime pushes retired, 4 ungated lines remain** (`npm run check:realtime-pushes` — trust the script).
  The four, each needing a domain producer rather than a gate:
  - `end-of-day-followups.emitCustomerReceived()` — fires on *rebook*, to that customer's room. The projection
    has a customer scope now, but no event marks "rebooked from a follow-up" and the rebook status vocabulary
    was not clear enough to invent one.
  - `booking.service.announce()` — one caller left (`update()`); a general field edit has no past-tense fact,
    and `appointment.updated` would be the vague catch-all §5 warns against.
  - `tech.service.publish()` and `tech-profile`'s branch fan-out helper — partially migrated modules.

  **Projection delivery scopes (§113):** tenant (default), ticket, technician, customer — each added because a
  service was pushing to that target by hand. Everything retired sits behind a truthful `emitsDomainEvents()`
  flag, so in-memory and DB-less modes keep the legacy in-process path unchanged.
- **Merge onto `Power-Salon-main`** — this is the July snapshot, and the merge is the largest remaining risk
  in the whole arc. It is now *checkable* rather than hoped-for: `EVENT_MERGE_GUIDE.md` plus
  `npm run check:event-infra-duplicates`, which reports, per concept, what event infrastructure the target
  tree already has and what to do about each. Run in this tree it finds five — exactly the five this arc
  introduced; anything it finds in `Power-Salon-main` is pre-existing and must be reconciled, not duplicated.
- **Redis Streams transport** — deliberately NOT built. §219 says do not migrate prematurely; the
  `EventTransport` interface is the seam, in-process delivery measures ~279 deliveries/s, and nothing in the
  current load justifies a broker. If `Power-Salon-main` already runs a job queue, the merge guide's step 1
  says to adapt the transport to it rather than add one.

## 9. Definition of Done (§226) — honest pass/fail
Existing architecture inspected ✅ · cross-module calls audited ✅ · events vs commands vs jobs vs realtime
separated ✅ · naming standard ✅ · envelope ✅ · event/correlation/causation ids ✅ · tenant + branch context ✅
· registry ✅ · schema validation ✅ · versioning + upcasters ✅ · outbox ✅ · publisher ✅ · at-least-once
documented ✅ · consumers idempotent ✅ · processed-event tracking ✅ · business uniqueness where required ✅
(`loyalty_point_earnings` UNIQUE(tenant, payment); payment idempotency keys existed before) · retries + backoff ✅ · dead letters ✅
· consumer isolation ✅ · ordering only where needed ✅ · aggregate versions supported ✅ · replay policies defined
✅ / replay tooling ❌ · critical priorities ✅ (attempt counts) · tenant-aware worker processing ✅ ·
noisy-neighbour protection ✅ (§129 fair scheduling in the publisher's claim) · realtime projection separated ✅
· notification consumers ✅ · analytics consumers ✅ · AI consumers ✅ · appointment/booking/queue/customer/payment
events wired ✅ · deals/loyalty/inventory/communication events declared, not produced ⚠️ · security events ✅ ·
platform events declared ⚠️ · SA monitoring ✅ · outbox/lag/DLQ monitoring ✅ · tenant-mismatch alerts ✅ ·
duplicate / out-of-order / publisher-crash / consumer-crash / transport-failure / tenant-isolation / load tests ✅
· Redis failure test ✅ (as transport) · replay tests ❌ · build ✅ · typecheck ✅ · lint ✅.

## 10. Verified — full sweep, Sep 19 2026

| Check | Result |
| --- | --- |
| API battery, all 8 shards | **6,242 passed, 0 failed** (867 · 751 · 764 · 745 · 756 · 811 · 834 · 714) |
| pos-web | 733 passed, 225 files |
| admin-web | 781 passed, 132 files |
| Events module | 111 tests, 14 files, every one against real Postgres |
| Migrations | ✅ verified on real Postgres (PGlite/PG16) |
| Gates | **13/13** |
| `check:sql-identifiers` | 0 unknown columns |
| `check:types-drift` | kysely.types matches the migrated schema |
| `check:realtime-pushes` | 37 gated / 4 ungated |
| `check:silent-sql` | 54 of 100 modules covered |
| `check:event-infra-duplicates` | 5 concepts present — exactly the 5 this arc introduced |
| Typecheck | api, pos-web, admin-web: 0 errors |
| `e2e:html` | 5 apps, 38 API calls, real Chromium — green 3/3 after a de-flake |
| Real AppModule boot | `DI_GRAPH_OK` |
| Load | 500 events × 3 consumers = 1,500 exactly-once deliveries, ~279/s on PGlite |

**Two numbers that are not progress and should not read as such.** `check:silent-sql` is unchanged at 54/100 —
that work stopped when this arc began, and the 46 uncovered modules are still uncovered; `SILENT-SQL-RISK.md`
ranks which matter most. And the 4 ungated realtime pushes each need a product decision or a vocabulary that
would have to be invented, which is why they are named rather than guessed at.

**One flaky test was found and fixed during this sweep**, not by a code change: the admin disable journey in
`e2e:html` failed roughly one run in three because its wait watched the whole document (which already contained
the word "Disable") and swallowed its own timeout. Same silent-catch shape this session chased through raw SQL,
in different clothes. Now scoped to the table body with the timeout surfaced: three consecutive green runs.

Two test-harness defects were also found and fixed earlier in this arc, and they matter beyond it: the shared
PGlite driver had **no-op transactions** (so no pgtest could ever prove a rollback) and **no affected-row
counts** (so every UPDATE looked like it touched nothing). Both are fixed in `test-support/pgtest-schema.mjs`.
If `Power-Salon-main` has its own copy of that harness, it very likely still has both.
