# ENGINEERING_RULES.md
### AI PowerSalon — non-negotiable invariants for anyone touching this codebase
These are the rules the existing 6,000+ tests and 13 CI gates ENFORCE. They are not aspirations; break one and a
gate goes red. Preserved verbatim from the project's working rules (developer-handoff spec §46).

1. **Reuse existing code before creating new architecture.** Audit first. This repo has ~380 dated reports at
   root proving what already exists — grep before you build. Duplicating an engine is a defect.
2. **Money uses integer cents.** Everywhere, always. Dollars exist only inside input fields; `parseDollarsToCents`
   is the one converter. The `check:money` gate hunts float money. Provider cost uses integer micros (10,000 = 1¢).
3. **The server derives trusted tenant/branch context.** `tenantId`/`branchId` come from the session, never from
   the client. A request body carrying a tenant id is a bug.
4. **Tenant isolation is mandatory.** Every tenant-scoped query filters by `tenant_id`. The `check:tenant` gate
   scans for violations; the only exceptions are the REVIEWED super-admin aggregations in its baseline, each with
   a written justification.
5. **Database migrations live in `apps/api/db/migrations/` only** — numbered `NNN_name.sql`, applied in order by
   `apps/api/scripts/migrate.mjs`, verified against real Postgres semantics by `verify-migrations-pglite.mjs`.
   Grep the migrations before adding a table: it may already exist.
6. **Critical live operations use targeted realtime updates.** Events carry the minimum: ids + the changed slice.
7. **Do not globally refresh the POS.** No full-screen reload as a data strategy; invalidate the touched query.
8. **Do not globally broadcast tenant events.** Channels are tenant- (and where relevant branch-) scoped.
9. **Human approval for reconciliation.** Nightly jobs FILE findings with evidence; they never auto-correct
   counters or invoices (see the SMS reconciliation: the corrupted counter stays corrupted until a human acts).
10. **Never fake external-provider connectivity.** No mock "delivered", no fabricated readiness. Unconfigured
    providers say so (`NotConfiguredPushProvider`, `providerComparison: 'unavailable'`, "Provider Cost Not
    Available"). Honesty is a feature.
11. **Never commit secrets.** `.gitignore` is verified by a real `git add` dry run; the security CI scans every
    push; even fake-looking keys in docs turn the pipeline red (this happened — see PUSH_TO_GITHUB.md).
12. **Every business-critical change requires tests.** New behavior = new pins. Never delete a failing test to go
    green — rewrite it to pin the NEW truth, in the same commit as the behavior change.
13. **Do not duplicate modules/services/repositories.** One engine per concern; thin delegates elsewhere.

House additions the codebase also enforces:
14. **No native dialogs** (`alert`/`confirm`/`prompt`) — inline components only (`check:dialogs`).
15. **Definition of Done** (spec §47): UI → frontend logic → API client → controller → service → repository →
    database → auth → permissions → tenant isolation → audit → realtime → tests. A screen that renders is not a
    feature; the `check:dead-client` and `check:crosswire` gates exist because of this.
16. **Verify, then claim.** If you did not run it: NOT RUN. If you could not test it: NOT VERIFIED. Uncertainty
    never becomes "working" (spec §55).
17. **No printing of schedules, queues, or service tickets** — owner decision (Jul 30 2026). Those POS controls
    were removed; `check:no-print` (a gate, also in the CI security lane) fails the build if they come
    back, including any `window.print()` in a frontend. Checkout receipts — including the `print` receipt
    channel — are unaffected and must keep working. Context: PRINT_FEATURES_REMOVED.md.
