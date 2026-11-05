> Moved here from apps/api/src/compensation/ (Constitution 13 Phase 12). The compensation code itself now lives in modules/workforce/src/compensation/; paths below are as they were when this was written.

# Compensation System — Phase 0 Audit + Plan + Phase 1 Delivery (2026-06-26)

Per the spec's first rule, I audited the existing codebase before writing anything. Findings are grounded in the
actual code, not assumptions. Honest verification only.

## Phase 0 — Audit findings (what already exists vs. what's missing)

### Already exists — REUSE / EXTEND (do not rebuild)
- **Money = integer cents everywhere.** `Money` type + `tipForPercent`, `splitCardSurchargeCents`, `validateCustomTip`
  in `checkout/checkout-display.dto.ts`. The engine reuses this; no floating-point money (§25).
- **Per-line commission is already snapshotted at sale time.** `ticket_service_lines.commission_type_snapshot` +
  `commission_value_snapshot`, read by a nascent canonical calc (`buildCommissionPreview` / "commissionForLine" in
  `checkout.dto.ts`). This is a partial §14 snapshot — the engine will absorb/supersede this calc.
- **Per-technician tip allocation table exists:** `ticket_tip_allocations` (migration 052; tenant/branch/ticket/
  technician/tip_cents). Reuse for tip persistence (§12).
- **Payroll module + tables exist:** `payroll_periods` + `payroll_lines` (migration 115) with services_count,
  gross_sales_cents, commission_cents, tips_cents, adjustment_cents, payable_cents, and a status workflow. Extend, don't
  duplicate (§20).
- **Hardened checkout money path:** split tender, card surcharge, idempotent capture, rollback compensation — untouched.

### Genuine GAPS — must build
1. **Supply charges** — zero occurrences anywhere in the API. Entirely missing (§9). *(Phase 3)*
2. **Guaranteed Earnings / Salon Cover Top-Up** — no engine exists (grep hits were false positives). Missing headline
   feature (§6–§7). *(Phase 4)*
3. **One canonical engine** — commission math is **scattered** across checkout / payroll / tech / services / owner, and
   the existing calc ignores tax-exclusion-from-base, supply, discount-funding, multi-tech-on-one-service, guarantee,
   and reconciliation. The spec's #1 demand is consolidation. *(Phase 1 — DONE, below)*
4. **Full immutable compensation snapshot** (§14) — only commission type/value is snapshotted today, not the complete
   per-(line,tech) breakdown. *(Phase 1.5 — persistence)*
5. **Policy hierarchy with effective dates/versions** (§4) — services carry a commission value, but the
   ticket>tech+service>tech+category>tech>branch+service>branch>tenant resolution doesn't exist. *(Phase 2)*

## Phase 1 — DELIVERED this pass: the pure canonical engine
`apps/api/src/compensation/` — pure, deterministic, integer-cents, **no DB, no hardened-path edits**:
- `compensation.types.ts` — the single contract every surface calls (lines, tips, allocations, results, reconciliation).
- `compensation-engine.ts` — `computeTicketCompensation` (commissionable base with tax excluded, supply removed before
  commission, discount funding per §10, tech/salon split, multi-tech allocation via **largest-remainder** so cents
  reconcile exactly), `allocateTips` (100% to techs, salon 0, card/cash separate), `computeGuaranteeTopUp`,
  `prorateGuarantee`, `allocateByLargestRemainder`.
- `compensation-engine.vitest.spec.ts` — proves the spec's worked examples and invariants.

### Verified (actually run)
- Every spec worked example passes: §28 Ex1 ($90 base → tech $54 / salon $36 / supply $10 / tax $6 separate / tip $20,
  salon tip $0), §28 Ex2 discount ($80 → $48/$32), §10 salon-funded (commission on full $100), §11 two-tech ($60 →
  $48/$12), §12 tips (salon $0, card/cash separate, reconcile), §6 guarantee ($180−$140=$40; $1000−$870=$130; none when
  over), §7 proration ($200×6/8h=$150), §25 deterministic cents, and the supply>price guard.
- api `tsc` **0 errors** · api tests **937 / 146 files** (engine added 9; no regression) · harness **79/79**.

## Roadmap (the spec's phases; each is its own verified unit)
- **P1.5 — DONE (schema + repo):** migration **157_ticket_compensation_snapshots** (immutable, one row per
  (ticket,line,technician), idempotent UNIQUE, integer cents) + `kysely.types` registration + `compensation-snapshot.
  repository.ts` (PURE `snapshotRowsFromResult` mapper that reconciles Σ rows to the engine total; idempotent
  `persistSnapshot` ON CONFLICT DO NOTHING; `getByTicket` / `sumByTechnicianPeriod` reads). 5 vitest tests (mapper
  reconciliation + fake-db persist). *Checkout still writes it in P6 — that wiring needs live PG smoke.*
  **Live PG smoke required for migration 157** (`npm run db:up && npm run db:setup`).
- **P2 — DONE:** `compensation-policy.ts` resolves the §4 ladder (ticket > tech+service > tech+category > tech > branch+
  service > branch > tenant), AS-OF the service date for historical preservation (§5), ticket overrides gated on approval
  (§24), ties → latest start then highest version, plus §27 validation. 7 vitest tests. Feeds the engine's per-line
  `commission`/`supply` inputs. (Still pure — DB-backed rule storage is wired in P6 alongside checkout.)
- **P3 — DONE:** `compensation-supply.ts` resolves fixed / percent / tiered-by-price / recipe (product-usage) configs to
  salon-retained cents that feed the engine's `supply` (removed before commission, never from tips), with §27 validation.
  6 vitest tests incl. the §9 tiered example (≤$50→$5 / $50.01–$100→$10 / >$100→$15) and a recipe sum.
- **P4 — DONE:** `compensation-guarantee.ts` computes the Salon Cover Top-Up for shift/day/week/pay-period/month, with
  §7 eligibility (clocked-in, min hours, probation, effective window, manager exception), proration (none/by-hours/
  by-scheduled/by-eligible-days/manual), configurable inclusions, tips & supply ALWAYS excluded, nonrecoverable default.
  9 vitest tests incl. §6 daily ($180→$40, total $240) and weekly ($1000→$130, total $1325) and §7 proration ($200×6/8=$150).
- **P5 — DONE (pure):** `compensation-tips.ts` — `tipAllocationRowsFromResult` maps the engine result to the legacy
  `ticket_tip_allocations` rows (per-tech total, salon $0) so existing tech/owner reads stay consistent, and
  `buildTipReport` produces the §18 card/cash report (gross card, cash, total, average, by technician/branch/day) from
  the canonical snapshot; snapshot repo gains a `tipReport` read. 3 vitest tests. *(Allocation rows are persisted at
  checkout in P6.)*
- **P6 — DONE (wired; needs live smoke):** `compensation.service.ts` (orchestrator: maps `ticket_service_lines` →
  engine → snapshot + tip allocations; ticket discount allocated proportionally; retail kept separate) + `compensation.
  kysely.ports.ts` (production reads/writes, all defensive). Checkout calls it **best-effort AFTER each paid-flip**
  (cash/card/gift/split) via an optional, NON-THROWING hook — capture/split/surcharge/idempotency code untouched; a
  snapshot failure can never void a captured payment. DI wires it only when a real DB is present. 8 vitest tests
  (orchestrator reconciliation + safety + the checkout hook fires post-payment, a throwing hook doesn't fail payment,
  backward-compatible with no hook). **Receipts (§15–§16) read `computeForTicket` — built next.**
- **P7 — DONE (builder + schema):** `compensation-payroll.ts` — pure `buildPayrollLine` (service + retail + guarantee
  top-up + tips + adjustments = payable, reconciles) and `payrollLineFromSnapshot` orchestrator that reads the canonical
  snapshot (no recomputation from tickets, §20) and applies the guarantee top-up. Migration **158** persists the
  breakdown (retail/card/cash/guarantee_topup) on `payroll_lines`. 4 vitest tests incl. the §6 daily ($240) and weekly
  ($1325) lines. Existing manual payroll workflow (draft→finalized→paid) is preserved; wiring the derive-path into the
  payroll service + the guarantee-policy store is the next step. **Live PG smoke required for migration 158.**
- **P8 — DONE (API):** owner-facing `/owner/compensation/*` — `preview` (full §28 engine breakdown), `supply/preview`,
  `guarantee/preview`, `validate` (§27), owner/permission-gated (§30), pure-compute (no tenant data). 6 vitest tests.
  Registered in app.module. *The owner-web setup-wizard + §28 calculator SCREENS consume these — they're 1:1 reference
  screens and should follow with your reference images (UI not built speculatively).*
- **P9 — DONE (API):** `compensation-earnings.ts` pure builders — `technicianEarningsSummary` (§17 categories;
  payroll-only fields honestly null, status 'estimated') and `ticketEarningsReceipt` (§16 per-line breakdown, salon tip
  $0). Wired into the EXISTING tech module: `GET /tech/earnings/canonical` + `/tech/earnings/receipt/:ticketId`, scoped
  server-side via `requireTechnician` (a tech sees only their own — proven by isolation tests). Snapshot read added
  (`getByTicketForTechnician`). Returns null when no snapshot source (honest). 5 vitest tests. *Tech App SCREEN is
  reference-matched and follows your references.*
- **P10 — DONE:** `compensation-reports.ts` pure builders — commission report (by technician/branch/service/day,
  before/after supply & discount, salon vs tech share, reconciles) + supply report + CSV export; tips report from P5.
  `CompensationReportsService` + owner endpoints `/owner/compensation/reports/{commission,supply,tips}` and a read-only
  Super-Admin `/reports/platform` oversight aggregate (gated to SUPER_ADMIN, §30/§34). Snapshot reads `reportRows` +
  `platformOversight` added. 6 vitest tests (reconciliation, grouping, CSV, gating).
- **P11 — DONE:** `compensation-security.vitest.spec.ts` — tenant scoping on every read, server-resolved technician
  identity (forged client id ignored), snapshot write-once, permission gating (owner/Super-Admin), and a 200-iteration
  randomized property test proving the engine never emits a non-reconciling result. 6 tests. **§41 COMPLETION_REPORT.md
  delivered.**
- **P12 — DONE (refunds/adjustments):** `compensation-adjustments.ts` (refund/void/chargeback reversal + manual
  adjustments, pure) + migration **159 compensation_adjustments** (append-only signed ledger) + repository (append,
  net-for-period, pending-review queue). 10 vitest tests. **Live PG smoke required for migration 159.**
- **P13 — DONE (guarantee storage + payroll auto-build):** migration **160 technician_guarantee_policies** +
  `compensation-guarantee.repository.ts` (most-specific/as-of resolution) + `compensation-payroll-autobuild.ts`
  (`autoBuildPeriod` = snapshot + resolved guarantee top-up + net ledger adjustments per technician). 8 vitest tests.
  **Live PG smoke required for migration 160.**
- **P14 — DONE (payroll endpoint):** `PayrollAutoBuildAdapter` + `PayrollService.buildFromSales` + `persistCanonicalLine`
  (no-recompute, writes breakdown columns) + `POST /payroll/periods/:id/build-from-sales` (draft-only, gated) +
  snapshot `sumAllTechniciansPeriod` (gross + per-tech grouping). 3 vitest tests. Reuses the existing payroll
  period/line/rollup machinery — no second payroll system.

## Honest limitations of Phase 1 (engine only)
- The engine is the calculation core; it is **not yet wired** into checkout/payroll/screens (that's P6/P7, and edits the
  hardened money path — will need live PG smoke).
- `technician_funded` discounts currently reduce the base like proportional (the asymmetric tech-only reduction is a
  flagged P2 refinement); `proportional`, `salon_funded`, `noncommissionable` are exact.
- No persistence/snapshot table yet (P1.5).
