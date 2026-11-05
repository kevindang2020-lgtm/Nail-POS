# EVENT_MERGE_GUIDE.md
### Merging the Constitution 8 event architecture onto `Power-Salon-main`

This arc was built on the **July snapshot** in a sandbox, not on the canonical tree. The infrastructure
constitution (#4) was built separately on `Power-Salon-main` and **may already contain** an outbox, a job
queue, a consumer registry or a dead-letter table. §211 forbids adding a second implementation alongside one
that exists. This guide makes that rule checkable instead of a hope.

---

## Step 1 — Run the duplicate audit IN the target tree (five minutes, read-only)

```bash
cd Power-Salon-main/apps/api
node scripts/audit-event-infra-duplicates.mjs        # or --json for a merge script
```

The script ships in patch 14. It reports, per concept, whether `Power-Salon-main` already has it and where:
transactional outbox · processed-event/dedup table · dead-letter table · generic event store · publisher ·
consumer registry · event bus · job queue (BullMQ/Bee/Agenda) · Redis Streams.

**Read the output as the decision input, not a formality.** For reference, run in *this* tree it reports five
present — exactly the five this arc introduced. Anything it reports in `Power-Salon-main` is **pre-existing**
and must be reconciled.

| Audit says in `Power-Salon-main` | What to do |
| --- | --- |
| **All absent** | Merge patch 14 as-is. Nothing to reconcile. |
| **Outbox table present** | Do NOT apply migration 433's `outbox_events`. Point `OutboxWriter` at the existing table (it touches one INSERT) and keep whichever column set is richer. Two outboxes means two publishers racing the same facts. |
| **Processed-event table present** | Same: repoint `ConsumerRunner`'s dedup read/write. The guarantee is `(consumer, event)` uniqueness — whatever table provides it is fine. |
| **Dead-letter table present** | Repoint `ConsumerRunner.fail()` and `EventOpsService`. Keep the existing status vocabulary rather than imposing this one. |
| **Job queue (BullMQ etc.) present** | **Decide deliberately.** A queue is a transport, not an outbox — it does not replace §18's same-transaction write. The likely right answer is: keep the outbox, and make `EventTransport` an adapter over the existing queue instead of `InProcessTransport`. That is the seam the interface was built for (§27). |
| **Event bus / emitter present** | Check whether it is a *domain* bus or a realtime projection. This arc treats realtime as a projection (§112); if the existing bus is the same thing under another name, keep it and delete nothing until the projection consumer is wired to it. |

## Step 2 — Migrations
Migrations here are numbered **433, 434, 435**. `Power-Salon-main` has moved on since July, so these numbers
are almost certainly taken. Renumber to the end of that tree's sequence before applying — and re-run
`npm run check:types-drift`, which will fail loudly if `kysely.types.ts` and the schema disagree.

## Step 3 — What must pass after the merge
```
npm run check:types-drift      # kysely.types matches the migrated schema
npm run check:sql-identifiers  # every raw-SQL table/column exists
npm run check:tenant           # the 3 event files here are baselined WITH their reasoning — re-review, don't copy
npm run check:realtime-pushes  # 34 gated / 6 ungated in this tree; the number should not go UP
npm run check:boot             # the DI graph resolves (this arc's Nest wiring is factory-based for a reason)
npx vitest run src/events/     # 109 tests, all against real Postgres
```

## Step 4 — Things that will surprise whoever merges this
- **Two test-harness defects were fixed here** in `test-support/pgtest-schema.mjs`: transactions were no-ops
  (so no pgtest could ever prove a rollback) and affected-row counts were missing (so every UPDATE looked like
  it touched nothing). If `Power-Salon-main` has its own copy of that harness, it likely has both bugs.
- **`emitsDomainEvents()`** is an optional method on five repository ports. It is how a service knows to stop
  pushing realtime by hand. If a merge drops it, the services fall back to the legacy path — correct, but you
  get double delivery only if the flag says true while the service still pushes, so keep flag and gate together.
- **The publisher's claim query does fair scheduling** (§129). It is not a plain FIFO and must not be
  "simplified" back into one.
- **Nothing here is enabled by default.** The publisher, retry worker and retention worker all require
  `EVENT_PUBLISHER_ENABLED`. Merging is inert until that flag is set — which is the safe way to land it.
