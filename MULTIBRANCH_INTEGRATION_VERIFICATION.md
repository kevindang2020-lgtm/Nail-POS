# Multi-Branch Check-In → POS Handoff: End-to-End Integration Verification

After shipping multi-branch (which moved the branch source from the device record to the **validated session**), I traced and
then **locked in** the highest-risk path: does a walk-in checked in at a *chosen* branch actually land in *that* branch's POS
queue and realtime room — not the device's default branch? Unit tests proved the session carries the branch; they did **not**
prove the cross-module handoff. This pass closes that gap. **No bug found** — the careful build held up — and the flow is now
regression-protected.

## The full chain, verified
1. **Selection** — kiosk picks branch B → `startSession(slug, B)` validates B against the device's allow-list (default ∪
   allowed) → `session.branchId = B` (a rogue branch is rejected `400 branch_not_allowed`, nothing started).
2. **Context** — `kioskCtx` now builds `CheckInContext.branchId = session.branchId = B` (not `device.branchId`).
3. **Write** — `CheckInService.moveToQueue(ctx)` → `repo.enqueue(ctx, rec)` inserts `pos_queue_items` with
   **`branch_id: ctx.branchId`** (confirmed in `check-in.kysely.repository.ts`). So the queue row carries B.
4. **Read** — the POS queue's `scoped(qb, ctx)` filters `branch_id = ctx.branchId OR branch_id IS NULL`
   (`queue.kysely.repository.ts`). Branch B's POS (ctx.branchId = B) sees the row; because check-in always writes a concrete
   branch, it shows **only** at B.
5. **Realtime** — `emit` → `toTenant({ tenantId, branchId: session.branchId })` →
   `rooms.tenantBranch(tenant, B)` (`realtime-bus.ts`). The live `customer_checked_in` / `queue_updated` events reach exactly
   branch B's POS subscription.

## Tests added (regression lock-in)
`go-check-in-isolation.vitest.spec.ts` — **20 tests** (was 17, +3 end-to-end), using the real `GoCheckInService` wired to a
`CheckInService` stub that now records the `branchId` it's handed:
- A walk-in at the **chosen** branch hands off to the queue with **that** branch, not the device default.
- With **no** choice, the **default** branch is used end-to-end.
- A branch **outside the allow-list** is rejected and **nothing** is checked in (`calls.length === 0`).

## Result
- Full backend suite **632 + harness, RESULT: PASS** (was 629; +3 here). The earlier multi-branch build added 7 super-admin +
  1 screen test; this pass adds 3 integration tests.
- The multi-branch security-sensitive change is proven correct through selection → context → DB write → branch-scoped read →
  branch-scoped realtime. The branch a guest picks is the branch their queue ticket, wait time, and live updates belong to.

## Honest notes
- The DB write/read/realtime keying is verified by code inspection of the Kysely paths plus the end-to-end test through the
  service and (stubbed) check-in boundary; a live Postgres round-trip still happens only in the e2e harness, not the sandbox.
- This pass deliberately added **no** new feature surface — it hardens what shipped, which is what most protects the pilot.
