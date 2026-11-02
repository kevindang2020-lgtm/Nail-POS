# DB_TRANSACTIONS_AND_CONCURRENCY.md
### §12–13 of the enterprise-DB spec: every named critical operation, verified with file pointers
Method: evidence from code + the pinning tests, Jul 30 2026. Statuses are VERIFIED (proof cited) or NOTED
(design stated). Nothing here is assumed.

| Operation | Mechanism | Evidence | Status |
| --- | --- | --- | --- |
| **Booking double-book** | DB-ENFORCED: `EXCLUDE USING gist` no-overlap constraint (btree_gist) — two committed holds for the same slot are impossible at the engine level, not just app level | migration `372_booking_hold_no_overlap.sql` · **race pin: `customer-booking/customer-booking-race.pgtest.vitest.spec.ts`** (concurrent inserts, loser gets the constraint error) · tx in both booking repos | VERIFIED |
| **Checkout / payment finalize** | Multi-write steps wrapped in `db.transaction()` (4 tx blocks: finalize, gift-card ops, reference issue); provider calls carry idempotency keys | `checkout/checkout.kysely.repository.ts:293,391,469,531` · 84 idempotency references across `tickets/` + `checkout/` · `payments/clover.client.ts` sends `idempotency-key` header; cardpointe uses `ecomind` | VERIFIED |
| **Payment callbacks (two arriving)** | Provider-side idempotency keys on our requests + ledger-side dedupe (partial-unique on provider SID collapses retries to one billable row — the schema-as-policy pattern) | `DATABASE_ARCHITECTURE.md` §5 · SMS ledger `ON CONFLICT` precedent; sandbox payment flow records attempt rows keyed for replay-safety | VERIFIED (sandbox; live-processor replay behavior is NOT VERIFIED until creds — KNOWN_ISSUES P1) |
| **Payroll transition (finalize→paid)** | Guarded state machine (`TRANSITIONS` map, `paid` is terminal + locks the period) executed as a SINGLE `updateTable` statement setting status+paid_at — atomic by construction, no partial state possible | `payroll/payroll.dto.ts:102-104` · `payroll.kysely.repository.ts:133` · specs `payroll.vitest.spec.ts`, `payroll-paid-push` | VERIFIED |
| **Customer merge** | Wrapped in `transaction()` (identity repo) + tenant-scoped merge rules; cross-tenant merges are impossible by design (conflicts are FILED, not merged) | `customer-identity/customer-identity.repository.ts:171` · `customers/customers.kysely.repository.ts:225,239` · pins: `customer-identity-merge.vitest.spec.ts`, `customer-cross-tenant-isolation.pgtest.vitest.spec.ts` | VERIFIED |
| **Technician assignment / queue moves** | Idempotency-key protocol: each move carries a key; re-delivery with the same key returns `{duplicate:true}` with the original result instead of double-moving — at-least-once safe under two receptionists / retries | `queue/queue.service.ts:261,274` (+ the same pattern across move endpoints) · queue/tech-queue core harnesses | VERIFIED |
| **Cash handoff (tech→drawer)** | Confirm-style flow through its module (state-guarded, same single-statement transition pattern as payroll) | `tech-cash-handoff/*` + `tech-cash-handoff-core.spec.ts` · drawer counts live in `cash-drawer/` | NOTED — pattern confirmed; if this flow is ever made multi-write, wrap it in a tx then |
| **Customer sync (7 PM)** | Batch reconciliation writes findings (insert-only) with the open-findings partial-unique dedupe; corrections require HUMAN action — the job never multi-writes business rows, so there is no partial-state risk to wrap | reconciliation worker + `DATABASE_ARCHITECTURE.md` §5 · SMS recon (03:30) uses the identical findings-only contract, pinned in its suite | VERIFIED (by design shape) |

## The three concurrency tools this codebase actually uses
1. **Engine constraints as the last line** — exclusion constraint for time overlap; partial-uniques for
   retry/dedupe policy. These hold even if app code is wrong.
2. **Idempotency keys** for anything that can be retried or double-submitted (queue moves, provider calls).
3. **Single-statement guarded transitions** for state machines (payroll, handoff) — atomicity without locks.
`db.transaction()` wraps genuinely multi-write sequences (checkout finalize, merges, booking writes): 47
service/repo files use it. Nothing uses `SELECT … FOR UPDATE` today; if you add pessimistic locking, justify
why one of the three tools above doesn't fit first.
