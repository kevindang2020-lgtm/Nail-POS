# Tech-Assignment + Serving-Pause Merge — Report (2026-06-26)

Merged the nine uploaded packages into the canonical monorepo and brought the whole repo back to green.
Honest verification only: everything below was actually run; new SQL still needs live Postgres smoke (flagged).

## What was merged
- **G1–G5 (POS↔Tech gap-closures)** from the COMBINED patch (`aipowersalon-tech-assignment-G1-G5.patch`):
  G1 app-side decline, G2 acceptance timeout + sweep scheduler, G3 optimistic concurrency (version guard, HTTP 409),
  G4 pause/resume, G5 push-token-on-login. 24 files, applied cleanly (pre-image matched the handoff).
- **Phase A — durable serving pause** (`phaseA-serving-pause-durable.patch`): serving_paused_at + accumulated_paused_ms
  on tickets, written by serving + tech pause/resume. Applied cleanly on top of G1–G5.
- The **SERVING durability finding** + its `140_..PROPOSED.sql` were superseded by Phase A’s final 140 (kept Phase A; the
  PROPOSED draft was discarded — it is the earlier shorter version of the same migration).
- The two **built PWAs** (`tech-app-build`, `customer-app-build`) are PRE-GATE deploy bundles (their JS hash differs from a
  fresh build). They were NOT merged into source; the freshly built `apps/tech-web/dist` now supersedes `tech-app-build`.

## Migration renumbering (collision fix)
The tech branch numbered its migrations 137–140, colliding with the already-merged 137 (webhook_deliveries),
138–141 (user-prefs) and 140 (tenant_backup_requests). Renumbered to append after 152, and added reconciliation
aliases in `apps/api/scripts/migrate.mjs` (same mechanism used for the earlier merges):
  137_tech_queue_paused_status      → 153
  138_tech_queue_acceptance_deadline → 154
  139_tech_queue_version            → 155
  140_serving_pause_durable         → 156

## Fixes I had to make for the merge to actually compile + pass (the patch authors only ran tech-web tsc + a DB-free subset)
1. `kysely.types.ts` PosTechQueueTicketsTable: added `acceptance_deadline: TsNull` and `version: Generated<number>`
   (the migrations add these columns; the type was never updated → 4 API tsc errors).
2. `tech-queue.dto.ts` TQTicketStatus: added `"paused"` and `"expired"` (new CHECK values; 1 tsc error).
3. `tech-queue.kysely.repository.ts` expiry sweep: `.where(sql\`acceptance_deadline <= now()\`)` →
   `.where("acceptance_deadline", "<=", sql<Date>\`now()\`)` (raw-builder not a valid typed where; 1 tsc error).
4. `tech-permissions.vitest.spec.ts` + `tech-realtime.vitest.spec.ts`: their inline fake repo `accept()` returned void;
   under G3 the service now treats a falsy return as a lost race and throws 409. Made both fakes `return true`
   (matches the real port + the patch’s own updated tech.service spec). Fixed 5 regressed tests.

## Verification (all actually run)
- API `tsc`: **0 errors**
- API tests: **928 passed / 145 files** (the gates added 16 tests); harness suites **79/79**
- tech-web: `vite build` clean — **72 modules** (matches the patch’s own verification); tsc clean via build
- pos-web (AI Center, untouched here): tsc **0**, build clean
- No patch rejects/orig files; G2 acceptance scheduler wired into TechQueueModule; all migrations 001–156 uniquely numbered

## REQUIRED before relying on it — live Postgres (unchanged from the package notes)
New migrations 153–156 are verified by tsc + DB-free harness + mocked frontend ONLY. Run:
    npm run db:up && npm run db:setup      # applies 153,154,155,156
Then smoke: start→pause→resume→done; assign→let-deadline-pass→expired (scheduler); two concurrent accepts (one wins, loser 409);
serving pause persists across restart.

## Deliberately deferred (from the package reports — need live-DB + a checkout regression)
- Serving read-path derivation that surfaces a "paused" status from serving_paused_at/accumulated_paused_ms (money-path-adjacent).
- Extending the expectedVersion guard to serving-side ticket/line edits.
