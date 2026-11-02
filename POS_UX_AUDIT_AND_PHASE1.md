# POS UX & performance — audit, ranked plan, and Phase 1

Per the spec's "audit first, then implement highest-value vertical slices," this is the honest first pass: real
findings from reading the actual high-frequency POS workflow code, a ranked plan, and the first slice already built and
verified. It is deliberately scoped — the highest-frequency workflow first — not a claim to have re-audited the whole
system.

## What I audited (real code, not assumptions)

The core operational loop in `pos-web`: `POSCheckInScreen` → `QueueItemInner` (the queue-item actions), plus the sibling
workflow components `QuickCheckInPanel`, `CheckoutTicketInner`, `AssignTechSheet`, and the queue backend
(`queue.service.ts`, status enum, transition endpoints).

## Findings (ranked by frequency × impact)

1. **Queue transitions weren't optimistic, and paid two round-trips.** `QueueItemInner.doAction` did
   `await run(); onChanged(); await load()` — the mutation *and* a full re-fetch, with the button stuck on "…" the whole
   time and the status badge unchanged until the second request resolved. This is the single most-tapped POS flow
   (Call Next / Start Service / Move to Serving on every guest). **Fixed in Phase 1 — see below.**
2. **Same fetch-after-mutate pattern in the sibling components.** `QuickCheckInPanel` reloads the screen on success;
   `CheckoutTicketInner` re-fetches via `detail()`. Same optimistic-update opportunity, next in line.
3. **Action buttons are filtered by permission only, not by status.** `QueueItemInner` shows every permitted action
   regardless of the item's current state, so an already-serving guest still shows "Start Service" (the server rejects
   it, but it's a dead-end tap). A status-aware action set would remove the invalid taps.

Not yet audited (so not claimed): database indexes/query plans, N+1s, bundle size, route-level code-splitting,
accessibility, and the observability/metrics surface. Those are later phases and I won't assert results I haven't
measured.

## Phase 1 (built + verified) — optimistic queue transitions

`QueueItemInner.doAction` is now optimistic with rollback:

- On tap, the status badge flips **immediately** to the transition's target (`Call Next → Called`,
  `Start Service / Move to Serving → In Service`) — sourced from the real queue service semantics, not a guess.
- The mutation fires once; the truth is reconciled in the **background** (no full-screen loader, so the open card never
  blanks), and the existing realtime `queue` subscription still resyncs on server events.
- If the action fails, the badge **rolls back** to its previous state and the specific reason is shown — no dead frozen
  button, no lost context.

Effect: the button's busy window drops from **two sequential round-trips to one**, and the visible response is now
instant (optimistic) instead of gated on the network.

### Before / after

| Workflow | Before | After |
|---|---|---|
| Queue transition (Call Next / Start Service / Move to Serving) | tap → spinner for `mutation + full re-fetch` → badge updates | tap → badge updates instantly (optimistic) → 1 round-trip → background reconcile; rollback + reason on failure |

## Verified (in-sandbox)

pos-web `tsc` 0 + `vite build` clean; `QueueItemInner` tests 6 (was 4 — added: optimistic badge flip before the server
responds, and rollback + reason on failure); the workflow component suite (QueueItemInner + QuickCheckInPanel +
CheckoutTicketInner) passes 16.

## Next phases (proposed, highest-value first)

1. Apply the same optimistic + background-reconcile pattern to `QuickCheckInPanel` and `CheckoutTicketInner`.
2. Make `QueueItemInner`'s action set status-aware (hide invalid transitions).
3. Measure a real performance baseline (route/API latency, render counts) before touching DB/bundle — then optimize
   with evidence, per the spec's "don't claim improvement without measuring."
