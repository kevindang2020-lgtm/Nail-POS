# EVENT_ARCHITECTURE_AUDIT.md
### Constitution 8 — Phases 1–3: Discovery, Inventory, Taxonomy (Sep 18, 2026)

> **Status — BUILD_PLAN Phase 15 (Oct 10 2026): Constitution 8 producers COMPLETE.** The registry
> (`packages/events/src/event-contract.ts`) has **155 events, every one recorded through the outbox**; the generated
> catalog with each event's producer and consumer files is `docs/EVENT_CATALOG.md`.
> - **Gate:** `check:event-producers` (`apps/api/scripts/audit-event-producers.mjs`, in `tooling/ci/run-gates.mjs`) fails on
>   an event with no outbox producer (unless reserved with a reason in `apps/api/scripts/event-producers.reserved.json` —
>   empty), a consumer subscribed to an off-registry name, a retired name referenced anywhere in code, or a stale catalog.
> - **Retired (zero importers, plan default):** `visit.started` → use `checkin.customer_checked_in` / `service.started`;
>   `checkout.started` → `ticket.ready_for_checkout`; `payment.authorized` → `payment.captured`.
> - **Produced:** `customer.merged` — the salon's duplicate merge (`KyselyCustomersRepository.merge`, Functional Decision 29),
>   one per merge in the merge transaction, ids only. `visit.completed` — the ticket's transition INTO paid (the platform's
>   definition of a visit, `VISIT_TICKET_STATUSES`), built once by `visitCompletedEvent` (`@aipowersalon/checkout`) and written
>   by both paid writers that record `checkout.completed` (POS `setStatus('paid')`, skip-line payment).
> - ~~Known gap: the Clover terminal capture on the customer display marks a ticket paid with no outbox write at all.~~
>   **CLOSED (Phase 15 round 2, Oct 10 2026).** `TerminalCaptureService.recordApproval`
>   (`apps/api/src/customer-display/terminal-capture.service.ts`) records an approved terminal charge through the canonical
>   POS paid path in ONE transaction: the ticket row locked, the session's idempotency key checked, then
>   `KyselyCheckoutRepository.recordPayment` (row + `payment.captured`) and `setStatus('paid')` (paid_at + `checkout.completed`
>   + `visit.completed`, channel `pos`). A second delivery of the same approval records nothing (`duplicate`); a failure
>   rolls all of it back, is logged, and leaves the Decision-22 `processing` row the POS's "Verify with processor" settles.
>   `setStatus` now PROPAGATES a failure inside a caller's transaction (it used to swallow it — an aborted transaction's
>   COMMIT silently rolls back). The display's ticket lock is per attempt, so two racing Pay taps send one charge.
>   Tests: `terminal-capture-paid.pgtest.vitest.spec.ts` (7), `terminal-capture-paid.postgres-race.vitest.spec.ts` (3, PG_RACE_URL).
> - ~~Remaining gap after round 2: the POS's post-payment work (`afterPaid`) never ran for a terminal-paid ticket~~ (a gift
>   card sold on it stayed `pending_payment`, the deal / coupon was never redeemed, no technician compensation snapshot, no
>   membership commission, no review request). **CLOSED (Phase 15 round 3, Oct 10 2026).** After a NEW approval commits,
>   `TerminalCaptureService` calls `CheckoutService.runPostPaymentWork` — the POS's own `afterPaid`, not a copy — once, under
>   the ticket's lock, only for a ticket the store shows paid (a duplicate approval runs nothing). Every step is idempotent
>   (membership commission now appends under a per-ticket lock, one row per line — it had no concurrency guard), and a
>   failing step is now LOGGED with the ticket (`afterPaid` swallowed failures without a trace, POS too).
>   Same round: a live POS card approval (`completeApprovedCard`) wrote the approved payment and the paid ticket in two
>   separately-swallowed writes (a failed paid write left a charged, open ticket nothing repaired) and produced NO
>   `payment.captured` (no loyalty points / analytics for live POS cards). `KyselyCheckoutRepository.completeCardPayment`
>   now commits processing → approved + `payment.captured` + paid (`checkout.completed`, `visit.completed`) in ONE
>   transaction; a failure leaves the Decision-22 `processing` row Verify / the stranded sweep settle, and is logged.
>   Tests: `terminal-capture-post-payment.pgtest.vitest.spec.ts` (7), `terminal-capture-post-payment.postgres-race.vitest.spec.ts`
>   (2, PG_RACE_URL), `modules/checkout/.../checkout-card-paid-atomic.pgtest.vitest.spec.ts` (2).

**Base tree caveat, stated first:** this audit and the build that follows are against the July snapshot
available in this session, not the canonical `Power-Salon-main` merged tree. The infrastructure constitution
(#4) was built on the merged tree elsewhere and may already contain queue or outbox scaffolding. Before merging
this arc, **diff against `Power-Salon-main` for duplicate infrastructure** — §211 forbids creating equivalents
of what exists.

---

## Phase 1 — Discovery (every finding verified by grep against the code)

| What the constitution asks about | What actually exists |
| --- | --- |
| `EventEmitter` usage | **None.** `@nestjs/event-emitter` is not used anywhere (0 files). |
| BullMQ / Redis job queues | **None.** BullMQ is not a dependency. (The 52 files matching `Queue(` are the *salon customer queue* — guests waiting for a technician — not job queues.) |
| Redis | `ioredis` is used for: login-throttle store, HTTP cache, tenant cache, tenant rate-limit, **realtime-bus pub/sub**, one metrics file. All optional-by-flag. Not a job transport. |
| Transactional outbox | **None.** No `outbox` anywhere in `src/` or `db/migrations/`. **This is the primary gap.** |
| Processed-event tracking | **None generic.** Domain-specific idempotency ledgers exist and must be *reused* not duplicated: `reception_copilot_action_ledger` (CopilotActionLedger), `ai_checkout_upsell_idempotency`, `voice_gateway_idempotency`, queue-move idempotency keys, the SMS SID partial-unique, the open-findings partial-unique. |
| Dead letters | **None.** |
| Cron / schedulers | **10 env-gated tick schedulers** (each a `setInterval` armed by a `*_WORKER_ENABLED` / `*_SWEEP_ENABLED` flag): security audit-engine (1 AM, advisory-locked) · customer-reconciliation (7 PM) · customer-import · customer-data jobs · sms-reconciliation (03:30) · ai-marketing send-sweep · billing-cycle · billing-export · deposit-reconciliation sweep. These are **JOBS** in §4's taxonomy, not events. |
| Webhooks (inbound) | **11 receiving modules**: payments (gateway events, stored in `payment_gateway_events`), messaging-inbound, voice-booking, customer-booking, ai-voice-transcription, call-intelligence, api-webhooks, deposit-reconciliation, super-admin-billing, super-admin-integrations, super-admin-tenants. Outbound: `tenant_webhooks` + `tenant_webhook_deliveries`. |
| Realtime events | A complete **client-projection** layer in `src/realtime/`: `realtime-core.ts` (44 client event names, `makeEnvelope`, `payloadViolations` forbidding pan/cvv/password keys, `screensToRefetch`), `realtime-bus.ts` (Redis pub/sub for multi-instance SSE), SSE gateway with session guard, tenant-isolation tests. **§112: these are realtime events, not domain events.** They are the *output* of Phase 14, not the backbone. |
| Direct cross-module calls | **61 sites** where a domain service pushes to the realtime bus directly; plus direct calls to push (`this.push.dispatchToUser`), loyalty (`this.loyalty.state`), audit, and the commission/earnings ledgers from checkout and payroll. |

### The one-line diagnosis
Every side effect in the system today is a **synchronous in-process call made after (or during) the business
transaction**. If the process dies between the commit and the call, the effect is lost with no record — the
lost-event risk §1 describes. Nothing is durable, nothing is retried, nothing is dead-lettered, and duplicate
protection exists only where a domain already built its own ledger.

---

## Phase 2 — Event Inventory (what fires today, and how)

### Realtime client events (44 — `realtime-core.ts`, verbatim)
appointment_created · appointment_updated · appointment_cancelled · customer_checked_in · queue_updated ·
ticket_assigned · service_started · service_done · ticket_ready_checkout · service_paused · service_resumed ·
checkout_total_recalculated · customer_display_tip_selected · customer_display_payment_requested ·
customer_display_method_selected · customer_display_signature_captured · payment_processing_started ·
payment_approved · payment_failed · ticket_paid · receipt_sent · reports_updated ·
technician_earnings_updated · settings_updated · tenant_status_updated · time_clock_updated ·
customer_profile_updated · owner_alert_created · owner_alert_updated · owner_payroll_updated ·
ticket_service_line_added · ticket_service_line_updated · ticket_service_line_removed ·
ticket_total_recalculated · ticket_change_request_created · ticket_change_request_approved ·
ticket_change_request_rejected · technician_profile_updated · tech_salon_membership_requested ·
tech_salon_membership_approved · tech_salon_membership_rejected · technician_rating_submitted ·
daily_follow_up_tasks_created · follow_up_task_updated · customer_follow_up_received ·
technician_help_requested · technician_help_accepted · technician_help_declined ·
ticket_line_technician_assigned.

**Ruling:** these names stay exactly as they are — they are the *client* vocabulary (screens refetch on them).
Domain events get the constitution's `domain.entity.action` names; a Phase-14 projection consumer maps domain
→ client. Renaming the 44 would break every frontend for no gain.

### Direct side-effect emitters (top producers, from the §221 sweep)
| Producer | Calls today | Should become |
| --- | --- | --- |
| `checkout.service.ts` | 9× realtime, commission/earnings ledger writes | `ticket.paid`, `payment.captured`, `checkout.completed` domain events → projection + earnings consumers |
| `serving.service.ts` | 8× realtime, 2× technician push | `service.started` / `service.paused` / `service.completed` |
| `queue.service.ts` | 4× realtime, 2× push (assignment) | `queue.customer_assigned`, `queue.customer_called` |
| `customer-booking.service.ts` | 2× push, realtime | `appointment.created` / `appointment.rescheduled` / `appointment.canceled` |
| `tech-profile.service.ts` | 6× realtime | `technician.profile_updated`, `technician.membership_*` |
| `payroll.service.ts` | push on paid | `payroll.period_paid` |
| `ai-checkout-upsell` | direct loyalty read | **KEEP SYNCHRONOUS** — it is a read for a price decision (§225: no events for checkout price calculation) |

---

## Phase 3 — Taxonomy (§4 classification of everything found)

| Kind | Definition (§4) | What falls in it here |
| --- | --- | --- |
| **DOMAIN EVENT** | A fact that happened, past tense, other modules may react | appointment/booking/check-in/queue/serving/checkout/payment/payroll/customer/technician facts — **none exist as durable events yet**; all are implied by direct calls |
| **COMMAND** | An instruction to do something, may be rejected | `assignTechnician`, `callNext`, `book`, `finalizeCheckout` — these are and stay service methods; §5 says never name them as events |
| **JOB** | Scheduled or long-running work | the 10 tick schedulers; import/export/sweeps — stay as jobs, may *consume* events later |
| **REALTIME EVENT** | Client notification for screen refresh | the 44 names above — a projection, produced by a consumer in Phase 14 |
| **WEBHOOK** | Inbound fact from an external system | the 11 receivers — each becomes a *producer* of a domain event after signature verification (e.g. gateway callback → `payment.captured`) |

### §221 classification of direct calls
| Pattern | Ruling | Why |
| --- | --- | --- |
| service → `realtime.toTenant(...)` (61 sites) | **REPLACE WITH EVENT** (via the Phase-14 projection consumer) | Fire-and-forget after commit = lost on crash; belongs downstream of the outbox |
| queue / booking / payroll → `push.dispatchToUser` | **REPLACE WITH EVENT** | Push is a notification consumer (§57); idempotency per §105 |
| checkout → commission / earnings ledger | **REPLACE WITH EVENT, financial consumer pattern (§102)** — but keep the *write* inside the checkout transaction where it already is transactional | Money must never double-apply on replay; needs business uniqueness, not just processed_events |
| ai-checkout-upsell → `loyalty.state` | **KEEP SYNCHRONOUS** | A read feeding a price decision (§225 prohibits event-based price calculation) |
| any service → `audit.push` | **KEEP** — §169: audit is not an event and events do not replace audit | The audit sink stays transactional and separate |
| permission checks | **KEEP SYNCHRONOUS** (§225) | Never event-based |
| webhook → domain write | **KEEP** the write; **ADD** an outbox event in the same transaction | The webhook is the producer; downstream reacts via events |

---

## What Phase 4–6 will build (next), and what they will NOT
Build: `packages/events` (envelope type, `DOMAIN_EVENTS` registry, schema validation, version), migration
for `outbox_events` / `processed_events` / `event_dead_letters` with §212–214 indexes, and an `OutboxWriter`
that inserts inside the caller's transaction. Reuse `makeEnvelope`'s discipline and `payloadViolations`'s
forbidden-key list from realtime-core rather than inventing a second one.
Not built: Kafka, BullMQ, or any new infrastructure service (§preamble, §219). Transport starts as PostgreSQL
polling by the publisher, with the transport interface abstracted (§27) so Redis Streams or a broker can slot
in later *if measured need appears*.
