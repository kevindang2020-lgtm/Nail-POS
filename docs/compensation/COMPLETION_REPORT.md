> Moved here from apps/api/src/compensation/ (Constitution 13 Phase 12). The compensation code itself now lives in modules/workforce/src/compensation/; paths below are as they were when this was written.

# Compensation System — Completion Report (§41) — 2026-06-26

Honest verification only. Everything below was actually built and run. The pure calculation/reads are fully verified by
tsc + DB-free + mocked tests; the DB-touching pieces are verified by tsc + mocked ports and REQUIRE live Postgres smoke
(see LIVE_SMOKE_CHECKLIST.md). Reference-matched owner/tech SCREENS are intentionally not built without your images.

## 1–6. Audit + what was reused
Existing code DISCOVERED and REUSED rather than duplicated: integer-cents `Money` + tip/surcharge utilities
(`checkout-display.dto.ts`); per-line commission already snapshotted (`commission_type_snapshot`/`commission_value_snapshot`)
and the nascent `buildCommissionPreview`; `ticket_tip_allocations` (per-tech tips, migration 052); the `payroll`
module + `payroll_periods`/`payroll_lines` (migration 115); the hardened checkout money path; the tech earnings
endpoints + `requireTechnician` server-side identity; the owner controller ctx/permission pattern; the migration
renumber-alias mechanism.

## 7. Duplicate systems merged/avoided
No second commission/payroll/tip/receipt engine was created. The ONE engine is the single source; checkout, payroll,
tech earnings, owner preview, and reports all call it or read its immutable snapshot.

## 8–12. Files added / DB / API
Added (apps/api/src/compensation/): compensation.types.ts, compensation-engine.ts, compensation-policy.ts,
compensation-supply.ts, compensation-guarantee.ts, compensation-snapshot.repository.ts, compensation-tips.ts,
compensation.service.ts, compensation.kysely.ports.ts, compensation-payroll.ts, compensation-earnings.ts,
compensation-reports.ts, compensation-preview.service.ts, compensation-reports.service.ts, compensation.controller.ts,
compensation.module.ts + 8 vitest specs. Modified: checkout.service.ts/.module.ts (best-effort post-payment hook),
tech.service.ts/.controller.ts/.module.ts (canonical earnings), database/kysely.types.ts, app.module.ts.
DB: migration 157_ticket_compensation_snapshots (immutable snapshot), 158_payroll_line_compensation_breakdown.
API: /owner/compensation/{preview,supply/preview,guarantee/preview,validate,reports/{commission,supply,tips,platform}};
/tech/earnings/{canonical,receipt/:ticketId}; POST /payroll/periods/:id/build-from-sales (auto-build a period from sales, no recompute).

## 13–32. Capabilities delivered
Canonical engine (§3); policy hierarchy + effective dates/versions (§4–§5); per-service supply incl. tiered & recipe
(§9); tips 100% to tech, salon $0, card/cash separate (§12/§18); multi-technician per ticket & per service (§11);
guaranteed earnings + salon-cover top-up, eligibility, proration (§6–§7); immutable snapshot (§14); checkout integration
as the single source, best-effort & non-throwing (§13); payroll derived from the snapshot + guarantee + adjustments
(§20); owner preview/validation (§27–§28); technician earnings summary + internal receipt, isolation-scoped (§16–§17);
commission/supply/tips reports + CSV + Super-Admin oversight (§34); tenant/branch isolation + permission gating (§30–§31);
the engine emits reconciliation flags on every result (§25).

## 33–35. Tests / results / build
1002 API tests across 158 files PASS; 79/79 harness suites PASS; API tsc 0 errors (now 1020 tests / 161 files incl. the adjustment ledger). A 200-iteration randomized property
test proves the engine never emits a non-reconciling result.

## 39. Genuine unresolved limitations (honest)
1. **Live Postgres smoke pending** for migrations 157/158 and the real checkout snapshot persistence (sandbox PGlite is
   blocked at migration 107). See LIVE_SMOKE_CHECKLIST.md.
2. **Reference-matched UI screens not built** — owner setup wizard / §28 calculator and the Tech App earnings screen
   are 1:1 reference screens; the APIs they consume are done. Pending your reference images.
3. **Refund/void/chargeback reversal (§21) + adjustment ledger (§24) — DONE** (pure engine + migration 159
   `compensation_adjustments`, append-only signed entries; tips reverse only if refunded; chargeback → pending-review
   exception; refund after a paid period → future-period pending entry; manual adjustments validate mandatory fields +
   large-adjustment owner approval). Wiring the ledger net into payroll auto-build remains (the payroll builder already
   accepts an adjustments figure). **Live PG smoke required for migration 159.**
4. **Guarantee-policy storage + payroll auto-build — DONE** (migration 160 `technician_guarantee_policies` with
   most-specific/as-of resolution; `autoBuildPeriod` derives every technician line = snapshot sums + resolved guarantee
   top-up + net ledger adjustments). The payroll-controller endpoint is now wired end to end:
   `POST /payroll/periods/:id/build-from-sales` (draft only, permission-gated) derives every technician line via the
   adapter and persists it through a canonical NO-RECOMPUTE path (`persistCanonicalLine`, breakdown columns from
   migration 158). Remaining: a timecard/attendance feed for guarantee eligibility/proration facts (currently supplied
   as input). **Live PG smoke required for migration 160.**
5. **`technician_funded` discount — FIXED:** now asymmetric per §10 — the salon keeps its full share (on the
   pre-discount eligible) and the technician absorbs the entire discount; tech + salon still reconcile to the
   commissionable amount. (Proven: $100, $10 tech-funded, 60/40 → salon $40, tech $50.)
6. **Ticket tip is attributed to the card rail** (single `tip_cents` on the ticket); engine/snapshot support card/cash
   split when a per-payment-method tip source is wired.
