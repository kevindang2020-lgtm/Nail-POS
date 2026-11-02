# Finish the Five — handoff (Oct 30 2026)

This builds the five features the owner approved in *AI PowerSalon — Finish the Five Unfinished Features* (30 Oct 2026). The work was done in development only:

- **Committed locally only, nothing pushed.** K-12 steps 1–5 still gate GitHub.
- **Nothing was deployed or migrated in production.**
- **No live payroll, payment, SMS or staff record was touched.**

Every test result below was actually run in this environment unless the row says otherwise.

## Phase 1 audit: what the repository already had

- **Commission ledger**
  - `ticket_compensation_snapshots` records the rate captured at checkout (type / value, `policy_id`, `rule_source`, commissionable base, earnings) and is immutable.
  - Corrections go to `compensation_adjustments`.
  - Rules live in `compensation_policies` + `compensation_policy_versions` (effective-dated, approved).
  - The money path's precedence is `pickLineCommission`: authored rule → service rate → tenant default.
  - A line is priced when it is created (`stampCommissionOnLine`), so the "service time" for F2 is `ticket_service_lines.created_at`.
- **Refunds**
  - Stored in `payment_refunds`; only status `refunded` is posted, and `event_id` / `processor_refund_id` identify replays.
  - The money path already reverses commission through `buildRefundReversal`: full refund, named lines, or pro-rata on the commissionable capture.
  - The salon's documented policy did not exist. There was only a `refundReversalReview` flag.
- **Audit**
  - `audit_events` is append-only by trigger.
  - `AuditService.record()` swallows errors on purpose, so it cannot fail closed.
- **The old exports** were built in the browser (`FitKit.downloadCsv`) and never audited.
- **Schedules**
  - `technician_schedules` is the weekly template.
  - `technician_shifts` holds time-clock punches. It is **not** a schedule exception.
  - `technician_time_off` and `technician_blocked_times` also exist.
  - Booking reads all of these through ONE reader (`KyselyBookingRepository.techSchedules` + `blockedTimes`).
  - There was no per-date shift model.
- **The "5%" issue** was the 0–5 rating printed with a "%". It was fixed in the Team rebuild (A44) and is unchanged here.

## Final status table

| Deliverable | Status | Files / API / DB | Tests actually run | Residual risk |
|---|---|---|---|---|
| Assign / Investigate / Resolve + review lifecycle | **Done** | **DB:** migration 719 adds `commission_discrepancy_reviews` (unique `(tenant_id, finding_fingerprint)`, version, checks; delete refused) and `commission_discrepancy_review_events` (append-only, FK `(tenant_id, review_id)`).<br>**API:** `GET/POST /pos/commission-discrepancies[/:id][/assign\|investigate\|notes\|resolve\|dismiss\|reopen]`, plus `GET /assignees`.<br>**Code:** `commission-review.repository.ts` / `.controller.ts`.<br>**UI:** `commissionReview.tsx` (list, status tabs, filters, slide-over, timeline). | pgtest `commission-review` **11/11**: persist + reload, 409 on a stale version, 403 with no mutation, 422 on an invalid transition, own-pay denial recorded, Dismiss → Reopen keeps the disposition, cross-tenant 404, append-only triggers, the ledger unchanged.<br>Harness E2E: Run Check → Assign → Investigate → Resolve → reload → history (**PASS**).<br>Vitest written, not run here. | Assignees are any active user of the salon. There is no per-user permission filter on the picker; the server still checks the actor. |
| Historical rate discrepancy rule | **Done** | `commission-checks.ts` `checkRateLine` (pure).<br>Scanner: `runCheck` (≤ 366 days, ≤ 5,000 lines, stable order, last-run row in `commission_discrepancy_scan_runs`).<br>Uses `resolveFromRules` / `pickLineCommission` / `lineCommissionCents`, the same functions as the money path. | Vitest standin `commission-checks` **13/13**: the guide's $100 / 40% / $30 example, an honoured override, history honoured, a rule authored later not counted, UNABLE_TO_VERIFY (legacy / tier / deleted config / service or tenant rate changed since), a multi-tech split, technician-funded discount, stable fingerprints.<br>pgtest: mismatch −$10.00 high, history and override give no alert, legacy line UNABLE. | **No rate history** exists for a service's own rate or the tenant default. When either changed after a service, the line is UNABLE_TO_VERIFY. It is never flagged, but it is not verified either.<br>Tier-plan lines are always UNABLE. |
| Refund reversal discrepancy rule | **Done** (policy key is new) | `checkRefundTicket` (pure) reuses `buildRefundReversal`.<br>New tenant setting `tenant_settings.compensation.refundReversalPolicy` = `PRO_RATA` \| `NO_REVERSAL`, set with `PUT /pos/commission-discrepancies/refund-policy` (payroll manager, audited).<br>Missing policy → POLICY_NOT_CONFIGURED (Review Required). | Vitest **13/13** (same file): guide example $50 of $100 → $20 expected; replay counted once; failed / pending ignored; multiple partials summing to full; named lines; duplicate; misattributed; already paid → special review.<br>pgtest: Policy Not Configured, then MISSING $20 after PRO_RATA; replayed webhook counted once; recorded reversal → no finding; ledger unchanged. | The checkout path still reverses on every refund whatever the new policy says. Setting `NO_REVERSAL` therefore makes those reversals show as EXCESSIVE findings, which is visible but not changed.<br>Matching is per ticket and technician, not per refund row, because existing adjustments store either the refund row id or the refund payment id. |
| Commission CSV export audit | **Done** | `report-export.ts`, `GET /pos/commission-screen/export` (`@AsyncExport`), `GET /pos/commission-screen/export-history`.<br>Rows go to `audit_events` (module `reports`, actions `report.export.requested\|succeeded\|failed\|denied`) with request id, tenant / branch, a safe filter summary (search → length only), row and byte counts, sha-256, duration. The rows are written through the new fail-closed writer `recordAuditStrict` (`modules/audit/src/audit-strict.ts`), so the export **fails closed** (503). The review transitions use the same writer inside their transaction. | pgtest `report-export` **6/6**: requested + succeeded, same columns and file name; failed with a safe code; denied with no CSV; audit outage (a trigger refusing inserts) → 503 and no CSV; only this salon's rows; no phone / name / amount in the audit rows; history scope.<br>E2E: download name `commission-YYYY-MM-DD-YYYY-MM-DD.csv`, history shows Requested + Succeeded. | In async mode (`Prefer: respond-async`) the worker runs the same handler, so the rows are written when the worker runs. This was not exercised here; the harness answers synchronously. |
| Team Performance CSV export audit | **Done** | `GET /pos/team-performance-screen/export`, same audit path. | pgtest **6/6** (shared file): Vietnamese headers when the screen is in Vietnamese; requested + succeeded. | Same as above. |
| Per-date shift editor | **Done** | **DB:** migration 719 adds `technician_shift_overrides` (one per tenant / branch / technician / date; CUSTOM_SHIFT \| DAY_OFF; `ends_next_day`; `breaks_json`; version) and `technician_shift_override_events` (append-only before / after).<br>**API:** `GET /pos/shift-overrides`, `POST /pos/shift-overrides/preview`, `PUT /pos/shift-overrides` (RESTORE_BASELINE removes the override).<br>**Booking:** `techSchedules(ctx, dow, date?)` lays the override over the template; all six callers pass the date. Pure overlay in `modules/booking/src/booking/shift-overrides.ts`.<br>**Boards:** the Live board (queue) and the Live Schedule KPIs read it.<br>**Event:** `technician.shift_override_changed` → `technician_schedule_updated` (branch room + technician room).<br>**UI:** `dateShiftEditor.tsx`. | pgtest `shift-override` **7/7**: only Friday 2026-11-06 changes, the next Friday and the weekly row stay identical; Mark Off with a booking → 409 conflict review, booking untouched; 13:00–13:30 lunch → 13:15 never offered; two managers → 409; 20:00–02:00 overnight owns the next morning, UTC conversion correct (DST night 00:00–04:00 = 300 real minutes); Restore; KPIs; permissions, past date, break outside the shift, cross-branch overlap, tenant 404.<br>Vitest standin: `shift-overrides` **5/5**, projection **1/1**.<br>E2E: calendar → Apply → 10:00–18:00 → conflicts → save; a stale second save is refused and the typed value is kept. | In the stand-in the outbox insert and Booking's weekly query (query builder) could not run. The save emits the event inside the transaction, captured in the pgtest, and the overlay function is the one `techSchedules` calls.<br>The Tech App and Tech Queue refresh on the existing `technician_schedule_updated` keys. Their own screens were not re-tested here. |
| Combined 0–100 composite performance score | **Partial** (model, API and UI done; one component has no evidence source) | `performance-score.ts` `COMPOSITE_MODEL_V1` (version `composite-v1`, 40 / 30 / 20 / 10, thresholds 5 / 10 / 10 / 20, 10-minute grace, status **comparison**).<br>**API:** `GET /pos/team-performance-screen/technicians/:id/composite`, `GET /composite/comparison`, `POST /composite/snapshots`.<br>**DB:** migration 719 adds `performance_score_snapshots` (append-only, model version + checksum).<br>**UI:** `compositeScore.tsx`. Top Performers is labelled "Ranked by verified rating (0–5)". | Vitest standin `performance-score` **4/4**: 4.5 / 5 → 90; an all-sufficient case = 87.8; any missing → null, never 0, never re-weighted.<br>pgtest `performance-composite` **4/4**: rating untouched; hidden / spam excluded; no-shows excluded; customer-late excluded; refund never a correction; snapshots append-only; tenant 404.<br>E2E: Insufficient Data shown, never 0. | **The composite is never available today.** The correction component is UNSUPPORTED because the system records no substantiated rework events. **Owner decision needed:** add a "substantiated rework" record (manager-reviewed), or approve a model version without that component.<br>The reliability definition (declined / expired offers count as failures) is a v1 assumption to validate in comparison mode. |

## Cross-cutting checks (run)

- **Full gate run** (`node tooling/ci/run-gates.mjs`): only the **12 known environment failures** remain. These are check:sql, types-drift, sql-identifiers, lint, api-contract, strict-bodies-types, db-ownership, actor-stamp, unique-tenant-review, architecture tests, frontend builds and app types; each needs node_modules, PGlite or vite, which are missing here.
- **Gates that pass include:**
  - tenant-isolation, list-queries, as-any, role-checks, validated-bodies, async-exports, audit-writers
  - one-payroll-calculation (the expected-earnings formula lives in `compensation/commission-expected.ts`), silent-catch
  - pos-i18n, vi-glossary, inert-controls, dead-client-methods, unreached-routes
  - event-producers (catalog regenerated), openapi manifest and attack-surface (regenerated)
- **Harness E2E** `interact.mjs five team`: **24/24**. That is the 19 earlier Team steps plus 5 new ones, including the overlays fitting 1920×945, 1536×729, 1440×765 and 1366×633 (inside the viewport, no sideways scroll, 44px actions).
- **Measure** (`measure.mjs five commission,team-performance,live-schedule`): **36/36 PASS**. That covers EN, VI and an empty tenant at the four windows, with no page-level sideways scroll, no target under 44px and no data font under 13px.
- **Other pgtests re-run:** technicians 6/6, tech appointments 5/5, live schedule 5/5 (after the override-aware KPI), tech queue 5/5, commission 5/5, team performance 4/4, booking window enforcement 13/13. `queue-merge-bk` and `local-day` fail the same way without these changes, because the stand-in has no query builder.
- **Migration 719** was applied twice to the dev template (idempotent), with no errors.
- **Not runnable here:** vitest for pos-web, a full TypeScript build, and `db-ownership --write` (needs PGlite). CI must run them; regenerating `apps/api/db/ownership/registry.generated.json` adds the six new tables.

## Found while auditing (not changed)

- **Super Admin security dashboard:** `security.kysely.repository.ts` counts `sessions.status = 'suspicious'`, but the `sessions` CHECK constraint does not allow that value, so the count is always 0.
- **`impossible-predicate` gate:** it cannot read CHECKs widened through `schema_apply_check()` (migrations 538 / 549 / 556). A fix was drafted and reverted because it surfaced the sessions bug above as a gate failure. Both need an owner.

## Recovery and production checklist (needs separate approval)

1. **Rollback is forward-fix only.** All 719 objects are new. Rolling back the code leaves them unread. Dropping them would destroy review decisions and shift history, so do not.
2. **Before production:**
   - take a backup and schema snapshot
   - run 719 twice on staging data
   - regenerate the ownership registry
   - run CI vitest and the type build
   - pilot behind a tenant flag
   - choose each tenant's refund-reversal policy
   - decide the F5 correction evidence source
3. **Not authorised and not done:**
   - production migration or deployment
   - any payroll deduction, transfer or live financial edit
   - any employment action

## Vietnamese review

There are 251 new strings, in section **A45** of `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`. The calculation sentence the server writes into a finding's evidence is English only for now.
