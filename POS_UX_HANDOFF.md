# POS UX & performance pass — consolidated handoff

One place that ties together the whole pass (Phases 1–4 + the backend/DB audit). It consolidates work already delivered
in the per-phase bundles; it does not restate code. Named to avoid colliding with the existing `CHANGELOG_HANDOFF.md`
(a separate, earlier Face ID note).

## Approach held throughout
Audit the real code first, work in vertical slices on the highest-frequency workflows, reuse existing
routes/services/components, verify green in-sandbox (tsc + tests + build), and — per your explicit rule — never
fabricate a performance number. Where a real measurement wasn't possible from here, I shipped the tool to capture it
rather than inventing a figure.

## USER_FLOW_MATRIX

| Workflow | Before | After | Files | Status |
|---|---|---|---|---|
| Queue transition (Call Next / Start Service / Move to Serving) | tap → spinner for `mutation + full re-fetch` → badge updates | badge flips instantly (optimistic); 1 round-trip; background reconcile; rollback + reason on failure | `QueueItemInner.tsx` | ✅ Phase 1 |
| Serving → Service Done (`send-to-service-done`) | tap → `await mutation; await refetch` → row leaves list | row leaves list instantly; background reconcile; rollback on failure | `POSServingScreen.tsx` | ✅ Phase 2 |
| Service Done → Checkout (`send-to-checkout`) | tap → `await mutation; await refetch` → row leaves list | row leaves list instantly; background reconcile; rollback on failure | `POSServiceDoneScreen.tsx` | ✅ Phase 2 |
| Queue action affordances | all permitted actions shown regardless of status (dead-end taps) | status-aware: only valid transitions show; muted note when none apply | `QueueItemInner.tsx` | ✅ Phase 3 |
| API latency visibility (whole guest journey) | none | real per-endpoint p50/p95/max/avg via `__apsApiPerf.summary()` | `apiPerf.ts`, `client.ts`, all `pos*Api` clients | ✅ Phase 4 |

The `Before`/`After` columns describe **behaviour**, not timings. Step-count and latency numbers are intentionally left
to your environment — see "measurement-blocked" below.

## §25 completion report (honest)
1. **UX problems found & fixed:** transitions were non-optimistic and paid a second blocking re-fetch (Phases 1–2);
   queue actions weren't status-aware, producing dead-end taps (Phase 3).
2. **Optimistic updates added:** queue transitions, serving/service-done stage exits — all with rollback + a surfaced
   reason on failure.
3. **Where the pattern was deliberately NOT applied** (would be worse): create-forms (`QuickCheckInPanel` — duplicate
   risk), read-only views (`CheckoutTicketInner`), and consequential slide-overs (`AssignTechSheet` — closing before
   confirmation hides failures).
4. **Measurement:** real client-side latency capture across every POS module client; console-readable summary.
5. **Backend/DB static audit:** hot paths already avoid N+1 (batch loading) and the hot filter/sort columns are indexed
   (`idx_pos_queue_items_tenant`, `idx_payments_tenant_branch_created_method`, …). No blind index/query changes made.
6. **Verification (fresh, in-sandbox):** pos-web `tsc` 0; `vite build` clean; the POS-UX suites pass green
   (QueueItemInner 7, serving+service-done 18, apiPerf 3, plus the wider workflow sweep at 47). api `tsc` 0 + DI + SQL +
   tenant-isolation gates for the overview metric-sourcing done earlier.

## Measurement-blocked (not oversights — the spec forbids guessing)
- Old-vs-new **step counts** and **latency** per workflow: capture with `__apsApiPerf.reset()` → run workflow →
  `__apsApiPerf.summary()`.
- Any DB tuning beyond the audit: needs `EXPLAIN ANALYZE` on the specific slow query an endpoint runs.
- Bundle size, route-change timing, render-count work: needs a real profile.

Send a `summary()` dump or an `EXPLAIN ANALYZE`, and the next phase becomes evidence-driven optimization of whatever is
actually slow.

## Not started (available, but their value depends on your deployment/priorities)
Keyboard shortcuts & focus management (§15), accessibility pass (§19), unified search UX (§14), smart-defaults to cut
repeated data entry (§9) — these need no runtime data but matter more or less depending on whether the salons run
iPad-first or desktop/iMac/Windows. Name one and I'll take it as the next slice.
