# Dead-code & merge-correctness audit — `merge-github-main` @ ef7eb6bf (Oct 26 2026)

The audit (Parts A and B below) was taken at ef7eb6bf. The machine-readable plan is `docs/dead-code-plan.json`
(`[{path, kind, symbol?, line?, action, reason, loc, batch1?, batch2?}]`). Removal runs in batches; `batch1`/`batch2`
on a row records what that batch did with it.

## Batch 2 — DONE (Oct 26 2026, on 48417cef)
Run once every other build agent had finished. Each candidate was **re-verified against the current tree first**:
knip was re-run, every export was re-grepped across all tracked files, and every client method was re-traced for call
sites, aliasing and bracket dispatch. **Removed: 683 lines of code and config across 118 files** (+7 lines: 4 shortened
import/export lines, 1 baseline line, 2 JSON trailing-comma shifts). Nothing was moved; the 78 report-cited evidence
scripts are untouched. The regenerated `docs/security/attack-surface-routes.csv` changes only line numbers, because
removing `BOOKING_DRAFTS` shifted `booking-drafts.controller.ts`.

| Item | Result |
|---|---|
| Exports | **All 113** SAFE_DELETE exports were still dead at the current HEAD (no new code uses any). Each was removed with an AST tool that takes the declaration plus its own JSDoc, then reviewed. Four doc-only mentions (historical reports) were left as is. Five imports the deletions orphaned were removed too: `createHash`, `validateDomainEvent`, `Severity`, `randomUUID`, `newIdempotencyKey`. `allowed-origins.ts`'s `cached` variable went as well, since its only writer was a dead export and nothing read it. Lint on every touched file shows **zero new messages** versus HEAD. |
| Dead client methods | **89 removed.** 126 were removed at first: the 123 batch-1 leads still dead today, plus 3 that batch 1 had wrongly marked LIVE. (`authApi.branches`/`selectBranch` in customer-web and `selectBranch` in owner-web were "called" only by a same-named method in a **manager-pay** test.) **37 of the 126 were then restored.** Each was the only client of a backend route on a human surface, so deleting the client half made `check:unreached` report 37 newly dead routes. That doesn't remove dead code; it just moves the debt from one ratchet ledger to another, and growing the unreached ledger is not allowed. Each restored row in the plan names its route (they include `POST /pos/checkout/payments/:id/refund`/`void`, `/pos/booking/conflicts/check`, the AI customer-profile reads and `/tech/follow-ups/*`). **Deleting route + method together is a product/API decision for Kevin**, not cleanup. Never removed: `posWebhooksApi.disable` (reached by `posWebhooksApi[action](id)`) and `superAdminOverviewApi.aggregate` (its own file's hook calls it). customer-web's `BranchOption` type, orphaned by the removals, went too. |
| Dead-client baseline | **138 → 29 entries.** It keeps the 27 restored methods the gate still counts as uncalled, plus `superAdminOverviewApi.aggregate` and `ownerMoreApi.dismiss`. Those two are gate false positives behind bracket dispatch: the Dismiss button calls `ownerMoreApi[action]`, which the gate cannot see. Every other entry was dropped: the removed methods, the 12 live ones, the stale `posDevicesApi.deviceStatus` (method gone), `posWebhooksApi.disable`, and 10 restored methods the gate already resolves. Each entry was pruned one at a time against the gate, and every remaining entry was already on HEAD's baseline, so the ratchet only shrank. |
| i18n | The 11 manager-pay orphan keys were removed from EN **and** VI (22 lines). The only dynamic key family in the app is `pay.history.${r}`, which is unaffected. The i18n gate passes (9,530 keys). |
| Dependencies | **7 removed:** `apps/api` `exceljs`, `pdfkit` and `@simplewebauthn/server` (the modules that use them declare the same ranges, and `npm ls --omit=dev --workspace @aipowersalon/api` shows all three still in the image closure via finance, super-admin and identity); `manager-pay-web` `react-router-dom`; `modules/finance` `@aipowersalon/audit` + `@aipowersalon/money`, plus their two dead tsconfig path aliases; and the duplicate `@aipowersalon/customers` devDependency in `modules/identity` (it is also a real dependency). **7 reclassified KEEP:** `@aipowersalon/realtime-contracts`, `date-time` and `money` in the web apps are compiled from source through each app's Vite/tsconfig aliases because api-client, ui and mobile-sdk import them. They are transitive build inputs, not dead. Lockfile: 8 removal lines only (one trailing comma moved), and no package entry or version changed. |

**Verification after batch 2:**
- `npm run ci:gates`: **all 54 gates + 17 audits pass**, including `check:dead-client`, `check:unreached`, `check:attack-surface` and i18n.
- Package and module builds pass, and `tsc --noEmit` is **clean on all 55 workspaces**. All 7 web apps build (`tsc --noEmit && vite build`); pos/owner/tech-web were rebuilt again after the restore.
- Test lanes: `ci:test:apps`, `ci:test:packages` and `ci:test:modules` **pass**. Since the restore, pos-web 1,470, owner-web 357 and tech-web 199 tests pass again. The API core harnesses pass 124/124. Lint on every touched file shows zero new messages versus HEAD.
- `ci:test:api`: **3,041 passed, 1 failed, and the failure is not from batch 2** (it fails identically on a clean HEAD). `src/common/worker-role.vitest.spec.ts` asserts that only `job-worker.ts` and `telemetry-store.ts` consume `DATABASE_WORKER`. Commit 146a3f55 ("worker-pool pipeline") made `apps/api/src/events/events.module.ts` run the event pipeline (outbox publisher + consumers) on `DATABASE_WORKER` whenever one is configured. That role is least-privilege: its grants (`WORKER_USES`) cover only the jobs, telemetry and retention tables. **In a deployment with a separate worker role, event publishing and consuming could hit permission errors** (inferred from the grants; not reproduced against a live role). It needs a decision: either grant the event tables to the worker role in `WORKER_USES` and the provisioning script, or keep the pipeline on `DATABASE`. Left untouched as a security-provisioning change outside this pass.

## Batch 1 — DONE (Oct 26 2026)
Scope was limited to paths no other agent was editing. **Exports, dead client methods and the manager-pay i18n keys
wait for batch 2** (modules/checkout, workforce, booking, identity, super-admin, events, inventory, apps/api/src/common
and the pos/owner/manager-pay screens were being edited by other agents).

**Removed: 69 files, 27,195 LOC** = 61 uncited scripts (7,255 LOC) + 8 other files (19,940 LOC, of which the stale
`api-routes.json` dump is 19,065). Code/script LOC excluding that dump: **8,130**. Two runner-less specs were ported
rather than deleted, and two `|| true` sites were fixed with tests.

| Item | What was done |
|---|---|
| A.1 #1 AI scripts | `measure-ai-capacity.mjs` (8 imports) and `run-ai-evals.mjs` (1) now import `../../../modules/ai/src/ai/*.ts`. Both `npm run measure:ai-capacity` and `npm run eval:ai` run end to end. |
| A.1 #2 broken e2e lane | Deleted `e2e-body.mjs`, `e2e-search.mjs`, `e2e-smoke.mjs` and their only caller `run-e2e.sh`. The Jul-6 `FULL_WIRING_VERIFICATION_2026-07-06.md` still names them (a historical report, left as is). |
| A.1 #3 `update_tech_login.patch` | **Deleted, not adopted.** It arrived with the Sep 28 developer upload and was never applied. It would auto-fire Face ID on launch and keep the salon code in `localStorage`. **Ask Kevin if he wants that behaviour**; git history keeps the patch. |
| Unrouted screen | Deleted `apps/admin-web/src/screens/MembershipsOverviewScreen.tsx` (455) + its test (83). `/memberships` has redirected to `/membership-programs` since Oct 14. Git history keeps it if the overview route comes back. |
| A.1 #4 runner-less tests | `ai-plans-billing.pgtest.ts` (self-described throwaway) **deleted**. `dashboard-metrics.spec.ts` passed 12/12 by hand, so it was **ported** to `dashboard-metrics.vitest.spec.ts` with unchanged assertions. `pos-search-isolation.spec.ts` **failed** (`forbidden_pos_search`): its fixtures predated the Phase-9 permission catalog (OWNER with no permissions, `pos.access`). It is the only service-level test of tenant/branch scope derivation, so it was **ported** to `pos-search-isolation.vitest.spec.ts` with current catalog grants. The 7 scenarios are unchanged, 7/7 pass, and it is mutation-checked: dropping the `owner.branches.view` gate fails it. |
| A.1 #6 `tech-queue.service.ts` accept | `!settings.technicianMustAcceptTicket \|\| true` → `true`, a behaviour-preserving change. Nothing in code, tests or docs states which label an acceptance should get. Both `accepted` and `ready_to_start` pass the start gate, and splitting them by the setting would shift live dashboard KPIs. So the shipped behaviour (always `ready_to_start`) is documented in place and pinned by `tech-queue-accept-status.vitest.spec.ts`, which is mutation-checked. **Product question for Kevin**, not a cleanup. |
| A.1 #6 `platform-announcements.repository.ts` | The in-memory `listForOversight` had a cancelled-filter that `\|\| true` disabled. The production Kysely query has no status filter, and the oversight directory filters by status itself, so "include cancelled" is the intended behaviour. The dead filter (and its `norm` helper) is removed, and a new case in `platform-announcements.service.vitest.spec.ts` pins it (mutation-checked). |
| A.5 deps | `apps/admin-web`: `autoprefixer` + `postcss` removed. Admin-web builds with `autoprefixer` absent from `node_modules`; `postcss` stays installed because Vite uses it. `modules/safety`: `@aws-sdk/s3-request-presigner` **and** `@aws-sdk/client-s3` (both lazily `require`d by `evidence-blob-store.ts`, both undeclared) are now optional `peerDependencies`. That mirrors `packages/media`'s pattern, with the same ranges as `apps/api`, whose declarations stay. Lockfile: `npm install --package-lock-only` pruned `autoprefixer`, `fraction.js` and `postcss-value-parser`, and recorded the safety peers. **No version changed**, and `npm ci --dry-run` passes. |
| Root junk | Deleted `test-bill.ts`, `test-svc.ts`, `revenue-split-demo.html` and `api-routes.json`. The `audit-crosswire.js`/`CI_GUARDS.md` mentions refer to a different, old scratch path. |
| 61 uncited scripts | Deleted. Each was re-checked at the batch HEAD: no reference in any package.json, CI workflow, tooling, other script, baseline/allowlist or doc. **The 78 report-cited evidence scripts are untouched.** |

No ratchet baseline or allowlist named any deleted path, so none needed shrinking.

**Verification after batch 1** (working tree, which also holds other agents' uncommitted edits):
- `npm run ci:gates`: **all 54 gates + 17 audits passed**.
- `tsc --noEmit`: **54 of 55 workspaces clean**. The one failure is `apps/api` (2 errors in `src/observability/security-signals.ts`). That file and `packages/media/src/upload-policy.ts` are another agent's uncommitted work: the api imports a new `onUploadRefused` that `packages/media/dist` has not been rebuilt with. It is unrelated to batch 1.
- `apps/admin-web` build (`tsc --noEmit && vite build`) passes.
- New and ported specs pass: pos-search isolation 7/7, dashboard metrics 5/5, tech-queue 43/43 including the new pin, announcements 5/5. The tech-queue core harness passes 88/88.
- `npm ci --dry-run` passes, so the lockfile is in sync.

## Part A — merge correctness

### A.0 Baseline: the tree is green
| Check | Result |
|---|---|
| `npm run ci:gates` | **all 54 gates + 17 audits passed** (exit 0) — includes architecture/boundary, i18n (10 EN/VI dictionaries, 9,506 keys), stale mocks, inert controls, dead-client, unreached routes, nav, openapi |
| `npx tsc --noEmit -p <ws>` on every workspace with a tsconfig (55: 10 apps incl. harness configs, 21 packages, 27 modules) | **0 errors in all 55** |
| `apps/api/scripts/openapi.mjs --check` | 3,099 routes match `apps/api/openapi/manifest.txt`; spec valid; no diff |
| Conflict markers `^(<<<<<<<|=======|>>>>>>>)` | **none** in code; none in md/txt either |
| `*.orig / *.rej / *.bak / *.old / *.tmp / ~ / copy / (1)` | none; one stray `update_tech_login.patch` (see A.2) |
| Tracked build output (`dist/`, `build/`, `node_modules/`) | none tracked (`.gitignore` covers `dist/`, `dist-frontends/`) |
| Untracked files | only `docs/mandates/2026-10-26_PLATFORM_ANNOUNCEMENT_MANDATE.txt` (Kevin's new mandate, not from this audit) |

### A.1 Real breakage found (fix in pass 2)
| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | **Two npm scripts import a path that moved** — `apps/api/scripts/measure-ai-capacity.mjs` (8 imports) and `apps/api/scripts/run-ai-evals.mjs` (1) import `../src/ai/*.ts`; the AI platform lives in `modules/ai/src/ai/` since Constitution 13. `apps/api/package.json` `measure:ai-capacity` and `eval:ai` therefore crash on first import; `audit-ai-dod.mjs` line 110 still counts the file's existence as "Load tests pass". | knip `unresolved` (9) + manual relative-import resolver | Repoint to `../../../modules/ai/src/ai/<file>.ts` (tsx loader already handles .ts). |
| 2 | **Three e2e scripts import a deleted dist path** — `apps/api/scripts/e2e-body.mjs`, `e2e-search.mjs`, `e2e-smoke.mjs` import `../dist/auth/auth-session-token.js`; the file compiles to `modules/identity/dist/auth/auth-session-token.js` now. Only caller is `apps/api/scripts/run-e2e.sh`, itself referenced by no package.json/CI (one Jul-2026 doc). | relative-import resolver | Delete the four (plan: SAFE_DELETE) or repoint if the lane is wanted. |
| 3 | **Unapplied patch tracked in git** — `update_tech_login.patch` (67 lines, Face-ID auto-prompt + remembered salon code for tech-web LoginScreen). Its hunks (`tech_saved_salon`, `autoPrompted`) are **not** in `apps/tech-web/src/screens/LoginScreen.tsx`. Either the feature was dropped on purpose or it was lost in the merge — Kevin decides; the file itself is dead. | grep | Decide; then delete the patch. |
| 4 | **Three test files no runner ever picks up** — `modules/super-admin/src/super-admin-ai/ai-plans-billing.pgtest.ts` (self-described THROWAWAY, header still says `apps/api/src/super-admin-ai/`), `apps/api/src/pos/pos-search-isolation.spec.ts`, `modules/analytics/src/dashboard/dashboard-metrics.spec.ts`. Runners: vitest `*.vitest.spec.ts` / `*.test.ts(x)`, harness `*-core.spec.ts` / `*-service.spec.ts`. | pattern diff | Rename to `*.vitest.spec.ts` if valuable, else delete. |
| 5 | **Workspace glob matches a folder with no package.json** — `apps/booking-public/` (static `index.html` + `_headers`, served by the API, audited by `audit-html-apps.js`). npm silently skips it; harmless, but knip/depcheck need an explicit entry. | `ls apps/*/package.json` | Leave; documented in the knip config used here. |
| 6 | **Two always-true sub-expressions** (not dead code, but dead logic worth a look): `modules/communications/src/campaigns/platform-announcements.repository.ts:62` `norm(r.status) !== 'cancelled' \|\| true` (filter is a no-op — cancelled announcements reach oversight); `modules/queue/src/tech-queue/tech-queue.service.ts:99` `!settings.technicianMustAcceptTicket \|\| true` (the must-accept setting is ignored on accept). | grep `\|\| true` | Confirm intent; if intentional, remove the dead left-hand side. |

No other breakage: every module exported from `modules/*/src/index.ts` is imported (all 27 modules; 4 modules not imported by `apps/api` directly — `BookingConversionModule`, `TechnicianClockPinModule`, `WorkforceStatusModule`, `TechnicianEligibilityModule` — are imported by other modules, which is correct layering). No duplicate Nest module registration in `app.module.ts`.

### A.2 Stray / stale files at the repo root
`update_tech_login.patch` (above), `test-bill.ts`, `test-svc.ts` (one-off DB probes with hard-coded tenant/customer UUIDs), `revenue-split-demo.html`, `api-routes.json` (19,065-line Jul-29 route dump; `audit-crosswire.js` lines 8–16 document why it stopped reading it), `project-handoff.json` (Jun-2026 manifest citing files that are now dead), `brand/make_brand_assets.DEPRECATED.py`. All in the plan.

**Root markdown sprawl**: 499 `*.md` files at the repo root (60,181 lines); 57 are read by gates/scripts (e.g. `audit-ai-dod.mjs` greps `AI_PLATFORM_REPORT.md`), 442 are referenced only by other docs. Not "code" and not in the plan — recommend a separate `docs/history/` move, keeping the 57 that scripts read in place.

### A.3 Duplicate / parallel copies
- `modules/analytics/src/{overview,dashboard}` vs `modules/super-admin/src/super-admin-{overview,dashboard}` share 14 basenames but **differ substantially** (tenant-scoped vs platform-scoped; 15–432 diff lines each) and are both wired — not duplicates.
- Per-app copies (`LoginScreen.tsx` ×6, `AuthContext.tsx` ×5, `authApi.ts` ×6, `queryLayer.tsx` ×4, `mobile.ts` ×4, `nav.tsx` ×3, `setup.ts` ×8) are intentional per-app shells (Constitution 6 keeps app code in the app, shared code in `packages/mobile-sdk`) — flagged for awareness only; consolidating them is a refactor, not dead-code removal.
- No `*V2*`, `*-old*`, `*.legacy.*`, `backup/`, `archive/`, `_old/`, `merge/` source folders. (`deploy/backup/` is the backup *runbook*, `*backup-reports*` is the observability feature.)

### A.4 Migrations (never delete — observations only)
- 631 files, `001`…`691`, numbering unique except the intentional `017_checkout_payments.sql` + `017a_pos_settings_integrations.sql` pair; `migrate.mjs` applies by string sort and warns on out-of-order, so `017a` sorts after `017` correctly.
- 14 numbering gaps (e.g. 373→375, 647→660) — deleted/renumbered during the Oct-12 merge; harmless.
- 4 tables created twice, all `IF NOT EXISTS` (idempotent): `merchant_risk_reviews` (187, 276), `webauthn_credentials` + `webauthn_challenges` (020, 356), `technician_services` (003, 006). 8 columns added twice, all `ADD COLUMN IF NOT EXISTS`. `check:migration-safety` passes. Nothing to do.

### A.5 Dependencies (package.json vs. usage)
knip + grep. Real items: `apps/admin-web` `autoprefixer` + `postcss` (no postcss config; tailwind v4 via `@tailwindcss/vite`) → SAFE_DELETE. 14 DEPRECATE (declared, never imported): `apps/api` `@simplewebauthn/server`, `exceljs`, `pdfkit` (each used by exactly one module that declares it), `modules/finance` `@aipowersalon/audit` + `@aipowersalon/money`, `@aipowersalon/realtime-contracts` in admin/pos/owner/customer-web, `@aipowersalon/date-time` in owner/manager-pay-web, `react-router-dom` in manager-pay-web, `@aipowersalon/money` in customer-display, `@aipowersalon/customers` devDep in identity.
Hygiene the other way (**undeclared**): `modules/safety/.../evidence-blob-store.ts` `require('@aws-sdk/s3-request-presigner')` is declared only in `apps/api` (that is what installs it in the image — keep the api declaration until safety declares it). `vitest` / `@testing-library/react` / `pg` are used in 1,600+ spec files across workspaces but declared in only some package.jsons (hoisting works today; declare at root devDependencies to make it explicit).
knip false positives kept: every Capacitor platform/plugin dep in the 6 shells (cap sync reads the app package.json), `@tanstack/react-query` (consumed via `packages/mobile-sdk`), `ioredis`/`pino` (lazy requires), `esbuild` (harness), `axe-core` (a11y helper), `tailwindcss` (`@import "tailwindcss"` in CSS).

## Part B — dead code

### B.0 Method
1. **knip 6.43** at the root with a generated config (`/tmp/...scratchpad/knip.json`, not committed): 59 workspaces, `paths` mapping all 60 `@aipowersalon/*` entry points to **src** (modules/packages publish `dist/`, so without this every cross-workspace export reads as unused), entries = Nest `main.ts`/`worker.ts`, every `index.html`, `src/main.tsx`, `scripts/**`, `tooling/**`, `db/**/*.mjs`, every spec/test pattern, capacitor/vite/vitest configs.
   Raw knip output: 18 unused files, 967 unused exports, 819 unused exported types, 38+11 unused deps, 9 unresolved imports, 1,880 "unlisted" (all hoisting noise: vitest/testing-library/pg), 101 "binaries" (tsc/vitest — noise).
2. **Every knip export was re-checked by whole-repo grep** (all 9,114 tracked files incl. docs, JSON baselines, scripts): a symbol counts as *dead* only when its name occurs **nowhere** else in the repo and at most once (its definition) in its own file. Exported-but-locally-used symbols are a separate "un-export" bucket (0 LOC).
3. **Dead client methods**: the existing `check:dead-client` gate carries a 138-entry baseline. Each entry was re-verified by searching `obj.method` call sites: 126 have none; 96 of those have the method name nowhere else in the app (SAFE_DELETE), 30 have a bare-name hit (DEPRECATE — open before deleting); 12 are live (used in tests or screens) and should be removed from the baseline, not the code.
4. **Scripts**: 339 scripts under `apps/api/scripts`, `scripts/`, `tooling/`, `browser-tests/`, `deploy/` checked for references in package.json scripts, CI workflows, other scripts, JSON baselines, docs. 136 have no code/CI/JSON reference; 61 of those are cited by no doc either.
5. **Screens**: every `src/screens/**/*.tsx` checked for an importer in its app.
6. **Assets**: all 137 files under `apps/*/{public,assets}` are referenced (by basename) — nothing to remove.
7. **i18n**: gate passes (no EN/VI drift); orphan-key scan found 11 keys in `apps/manager-pay-web/src/i18n/catalog.ts` never used by any `tr()`; POS catalog's 57 unreferenced keys are all dynamic-prefix (`t(\`pos.${x}\`)`) — kept.
8. **Comments/flags**: 0 `TODO/FIXME/XXX/HACK` in src (2 case-insensitive hits); 0 commented-out code blocks > 20 lines; no code-level always-on/off feature flags (feature flags are DB-driven `APP_FLAG_DEFAULTS` + 19 env toggles, all read at runtime) — see A.1 #6 for the two `|| true` expressions.

### B.1 Totals
| Action | Items | LOC |
|---|---|---|
| **SAFE_DELETE** | 301 | **28,001** (of which `api-routes.json` = 19,066; **8,935 LOC of code/scripts**) |
| DEPRECATE | 1,252 | 10,889 (78 evidence scripts cited only by docs = 10,582; 1,157 "drop the `export` keyword" = 0 LOC each) |
| KEEP (false positive, explained) | 601 | — |

SAFE_DELETE by kind: 18 files (20,245 LOC), 61 scripts (7,259), 220 exports (495), 2 dependencies, 11 i18n keys (in the export rows).

### B.2 Files (SAFE_DELETE / DEPRECATE)
| Path | Symbol | Action | LOC | Reason |
|---|---|---|---|---|
| `update_tech_login.patch` |  | SAFE_DELETE | 68 | Unapplied patch file tracked in git (its hunk, tech_saved_salon / autoPrompted, is not in apps/tech-web/src/screens/LoginScreen.tsx); referenced by nothing. |
| `test-bill.ts` |  | SAFE_DELETE | 21 | Root-level one-off DB probe with hard-coded tenant/customer UUIDs; referenced by nothing (no script, doc, CI). |
| `test-svc.ts` |  | SAFE_DELETE | 23 | Root-level one-off DB probe; referenced by nothing. |
| `revenue-split-demo.html` |  | SAFE_DELETE | 120 | Standalone demo HTML at repo root; referenced by nothing. |
| `api-routes.json` |  | SAFE_DELETE | 19066 | 19k-line route dump from Jul 29 2026. audit-crosswire.js explicitly stopped reading it (comment lines 8-16); only CI_GUARDS.md mentions it historically. Regener |
| `project-handoff.json` |  | DEPRECATE | 143 | Jun-2026 handoff manifest; referenced only by NEW_CHAT_HANDOFF.md / CHANGELOG_CODEBASE_REPAIR.md and cites paths that no longer exist (apps/api/src/common/pos-w |
| `apps/api/src/common/pos-workflow-core.ts` |  | SAFE_DELETE | 70 | No import anywhere; WORKFLOW/isTerminal/WorkflowAction symbols unused (the isTerminal hit is a different function in realtime/authz-revalidation). Only project- |
| `apps/api/src/common/tenant-scope.kysely.ts` |  | SAFE_DELETE | 16 | scoped() helper has zero imports; every module defines its own local scoped(). docs/audit-2026-10-06/constitution-01-database.md still cites it (update the doc  |
| `apps/api/src/pos/pos-search.dto.ts` |  | SAFE_DELETE | 12 | No import anywhere (pos-search.service uses pos-search-core). Listed in as-any/silent-catch baselines -> shrink those baselines in the same commit. |
| `modules/safety/src/tenant-safety-community/community-evidence-blob.adapter.ts` |  | SAFE_DELETE | 48 | Zero references in code, docs, tests. |
| `modules/queue/src/check-in/public-check-in.dto.ts` |  | SAFE_DELETE | 69 | Not imported; go-check-in.dto.ts only mentions the name in a comment. |
| `modules/super-admin/src/super-admin-ai/ai-plans-billing.pgtest.ts` |  | SAFE_DELETE | 110 | Self-described THROWAWAY end-to-end test; matches no vitest include (*.vitest.spec.ts / *.test.ts) and no harness pattern (*-core.spec.ts); its header still poi |
| `modules/gift-cards/src/gift-cards/gift-card-token.kysely.repository.ts` |  | SAFE_DELETE | 34 | No import (gift-card-token.service.ts uses gift-card-token-core); only listed in as-any/silent-catch baselines -> shrink baselines. |
| `apps/admin-web/src/api/superAdminCampaignsApi.ts` |  | SAFE_DELETE | 10 | No importer; both methods are on the dead-client-methods baseline (shrink baseline). |
| `apps/pos-web/src/api/customerAppApi.ts` |  | SAFE_DELETE | 11 | No importer; all methods are on the dead-client-methods baseline (shrink baseline). |
| `apps/pos-web/src/screens/ComingSoon.tsx` |  | SAFE_DELETE | 15 | Screen not referenced by App.tsx/router; only its own test imports it. Delete together with ComingSoon.test.tsx. |
| `apps/pos-web/src/screens/ComingSoon.test.tsx` |  | SAFE_DELETE | 12 | Test of the unrouted ComingSoon screen. |
| `apps/admin-web/src/screens/MembershipsOverviewScreen.tsx` |  | SAFE_DELETE | 456 | Not routed: App.tsx routes /memberships -> Navigate to /membership-programs (MembershipProgramsScreen). Only its own test imports it. Delete with the test; supe |
| `apps/admin-web/src/screens/MembershipsOverviewScreen.test.tsx` |  | SAFE_DELETE | 84 | Test of the unrouted screen. |
| `apps/api/src/pos/pos-search-isolation.spec.ts` |  | DEPRECATE | 82 | Matches no runner pattern (not *-core.spec.ts, not *.vitest.spec.ts, not *.test.ts) -> never runs. Rename to *.vitest.spec.ts if still valuable, else delete. |
| `modules/analytics/src/dashboard/dashboard-metrics.spec.ts` |  | DEPRECATE | 27 | Matches no runner pattern -> never runs. Rename or delete. |
knip "unused files" that are **false positives** (KEEP): 5 vitest `src/test/setup.ts` (setupFiles), `tooling/vite/*.d.mts` (ambient types for the vite plugins), `apps/pos-web/src/i18n/server-labels.ts` (read via `fs` by `tooling/i18n/pos-codemod.mjs`), `modules/super-admin/src/request-schemas.ts` (documented hub; confirm the field builders live in `request-schemas-fields.ts` before touching).

### B.3 Scripts — SAFE_DELETE (no package.json / CI / script / baseline / doc reference)
| Path | Symbol | Action | LOC | Reason |
|---|---|---|---|---|
| `apps/api/scripts/e2e-body.mjs` |  | SAFE_DELETE | 18 | Imports ../dist/auth/auth-session-token.js which no longer exists (moved to modules/identity). Only run-e2e.sh (itself unreferenced) and a Jul-2026 verification |
| `apps/api/scripts/e2e-search.mjs` |  | SAFE_DELETE | 33 | Imports ../dist/auth/auth-session-token.js which no longer exists (moved to modules/identity). Only run-e2e.sh (itself unreferenced) and a Jul-2026 verification |
| `apps/api/scripts/e2e-smoke.mjs` |  | SAFE_DELETE | 26 | Imports ../dist/auth/auth-session-token.js which no longer exists (moved to modules/identity). Only run-e2e.sh (itself unreferenced) and a Jul-2026 verification |
| `apps/api/scripts/run-e2e.sh` |  | SAFE_DELETE | 25 | Only caller of the three broken e2e-*.mjs scripts; referenced by no package.json/CI. |
| `apps/api/scripts/audit-logs-smoke.ts` |  | SAFE_DELETE | 292 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/booking-checkin-recorder-smoke.ts` |  | SAFE_DELETE | 66 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/booking-checkin-smoke.ts` |  | SAFE_DELETE | 331 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/capture-booking-html.mjs` |  | SAFE_DELETE | 180 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/communications-overview-smoke.ts` |  | SAFE_DELETE | 260 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/db-money-integration.ts` |  | SAFE_DELETE | 91 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/e2e-customer-journey.mjs` |  | SAFE_DELETE | 122 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/e2e-customer-payments.ts` |  | SAFE_DELETE | 90 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/e2e-owner-journey.mjs` |  | SAFE_DELETE | 149 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/failsoft-audit.mjs` |  | SAFE_DELETE | 89 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/live-phase10-database.mjs` |  | **RESTORED Oct 26 2026 (M7)** — wrongly classified: `tooling/ci/live-proofs.sh` runs it (the scan missed shell-array references); was SAFE_DELETE | 324 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/live-phase2-foundations.mjs` |  | **RESTORED Oct 26 2026 (M7)** — wrongly classified: `tooling/ci/live-proofs.sh` runs it (the scan missed shell-array references); was SAFE_DELETE | 165 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/merchant-accounts-smoke.ts` |  | SAFE_DELETE | 300 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/pos-guest-journey-e2e.mjs` |  | SAFE_DELETE | 164 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/pos-vi-shots.mjs` |  | SAFE_DELETE | 38 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/search-full-check.mjs` |  | SAFE_DELETE | 49 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/smart-reminders-smoke.ts` |  | SAFE_DELETE | 310 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/smoke-google-places.mjs` |  | SAFE_DELETE | 38 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/terminal_isolation_check.ts` |  | SAFE_DELETE | 75 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/users-roles-smoke.ts` |  | SAFE_DELETE | 332 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-auth-profile.ts` |  | SAFE_DELETE | 71 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-checkin.ts` |  | SAFE_DELETE | 67 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-customer-display-pay.ts` |  | SAFE_DELETE | 82 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-customer-display.ts` |  | SAFE_DELETE | 92 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-customer-salons.ts` |  | SAFE_DELETE | 158 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-daily-followups.ts` |  | SAFE_DELETE | 340 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-device-mode.ts` |  | SAFE_DELETE | 78 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-display-integration.ts` |  | SAFE_DELETE | 76 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-display-realtime.ts` |  | SAFE_DELETE | 53 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-frontdesk-completion.ts` |  | SAFE_DELETE | 93 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-nail-showcase-upload.mjs` |  | SAFE_DELETE | 89 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-owner-alerts.ts` |  | SAFE_DELETE | 87 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-owner-audit.ts` |  | SAFE_DELETE | 71 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-owner-bookings.ts` |  | SAFE_DELETE | 88 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-owner-branches.ts` |  | SAFE_DELETE | 85 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-owner-dashboard.ts` |  | SAFE_DELETE | 109 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-owner-finance.ts` |  | SAFE_DELETE | 102 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-owner-staff.ts` |  | SAFE_DELETE | 101 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-reschedule-rewards.ts` |  | SAFE_DELETE | 84 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-super-admin-platform.ts` |  | SAFE_DELETE | 257 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-tech-profile-http.ts` |  | SAFE_DELETE | 218 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-tech-profile.ts` |  | SAFE_DELETE | 390 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-tech-rbac-audit.ts` |  | SAFE_DELETE | 97 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-tech-skill-requests.ts` |  | SAFE_DELETE | 99 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-tech-skills.ts` |  | SAFE_DELETE | 84 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-tech.ts` |  | SAFE_DELETE | 134 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-tenant-checkout-settings.ts` |  | SAFE_DELETE | 89 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/verify-ticket-numbers.ts` |  | SAFE_DELETE | 79 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `apps/api/scripts/webhook_isolation_check.ts` |  | SAFE_DELETE | 130 | Script referenced by no package.json script, CI workflow, other script, baseline or doc. |
| `scripts/check-columns.mjs` |  | SAFE_DELETE | 18 | Root scripts/ one-off DB probe (hard-coded queries), referenced by nothing. |
| `scripts/check-latest-tenants.mjs` |  | SAFE_DELETE | 30 | Root scripts/ one-off DB probe (hard-coded queries), referenced by nothing. |
| `scripts/check-queue-constraint.mjs` |  | SAFE_DELETE | 17 | Root scripts/ one-off DB probe (hard-coded queries), referenced by nothing. |
| `scripts/check-tech-queue-constraint.mjs` |  | SAFE_DELETE | 17 | Root scripts/ one-off DB probe (hard-coded queries), referenced by nothing. |
| `scripts/list-tables.mjs` |  | SAFE_DELETE | 18 | Root scripts/ one-off DB probe (hard-coded queries), referenced by nothing. |
| `scripts/test-code-one-time-use.mjs` |  | SAFE_DELETE | 41 | Root scripts/ one-off DB probe (hard-coded queries), referenced by nothing. |
| `scripts/test-create-tenant-with-commission.mjs` |  | SAFE_DELETE | 21 | Root scripts/ one-off DB probe (hard-coded queries), referenced by nothing. |
| `scripts/test-oversight-query.mjs` |  | SAFE_DELETE | 27 | Root scripts/ one-off DB probe (hard-coded queries), referenced by nothing. |
78 more scripts are DEPRECATE: referenced only by reports/runbooks (`live-phase*-*.mjs`, `live-display-*`, `drills/*`, `*_check.ts`, `verify-owner-*`…). They are the evidence scripts behind Kevin's verification reports; deleting them orphans the doc citations. Suggested: move to `apps/api/scripts/evidence/` (or delete with the report) in a later pass — listed in the plan with the citing-doc count.

### B.4 Dead client methods (gate baseline, call-site verified)
127 methods on `apps/api/scripts/dead-client-methods.baseline.json` are in the plan (96 SAFE_DELETE, 31 DEPRECATE; ~130 LOC). 12 baseline entries are actually **live** (e.g. `pos-web posCheckInApi.createCustomer` used by `POSNewBookingScreen.tsx`, `owner-web ownerMoreApi.acknowledge/dismiss/resolve` used by tests) — remove those from the baseline, keep the code. Each deletion must shrink the baseline in the same commit (ratchet gate).

### B.5 Exports — SAFE_DELETE with ≥ 3 LOC (full list of 220 in the plan)
| Path:line | Symbol | Action | LOC | Reason |
|---|---|---|---|---|
| `apps/admin-web/src/api/superAdminApi.ts:348` | superAdminApi.deviceMgmtDevices | SAFE_DELETE | 4 | On the dead-client-methods gate baseline; no `obj.method` call anywhere and the method name appears nowhere else in the app. Remove and shrink apps/api/scripts/ |
| `modules/checkout/src/checkout/checkout-display.dto.ts:21` | ReadyTicket | SAFE_DELETE | 4 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/api/src/session/auto-logout.dto.ts:19` | AutoLogoutStatusResponse | SAFE_DELETE | 17 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/api/src/session/auto-logout.dto.ts:38` | UpdateStoreHoursAutoLogoutRequest | SAFE_DELETE | 7 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/payments/src/invoices/invoices.dto.ts:25` | computeLineTotal | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.kysely.ts:286` | NotConnectedExpensePost | SAFE_DELETE | 3 | Only references are docs/baselines/allowlists (AI_MODULE_DEEPTRACE_REMAINING.md); unused inside its own file. Delete and shrink the baseline/allowlist line. |
| `modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.kysely.ts:289` | NotConnectedInventoryReceive | SAFE_DELETE | 3 | Only references are docs/baselines/allowlists (AI_MODULE_DEEPTRACE_REMAINING.md); unused inside its own file. Delete and shrink the baseline/allowlist line. |
| `modules/safety/src/tenant-safety-community/community-permissions.ts:28` | defaultCapabilities | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/safety/src/tenant-safety-community/community-evidence.ts:76` | NotConnectedEvidenceBlob | SAFE_DELETE | 6 | Only references are docs/baselines/allowlists (SAFETY_COMMUNITY_PHASE1.md); unused inside its own file. Delete and shrink the baseline/allowlist line. |
| `modules/safety/src/tenant-safety-community/community-notify.ts:124` | InMemoryCommunityNotifier | SAFE_DELETE | 9 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/queue/src/check-in/check-in.dto.ts:112` | WalkInCheckInRequest | SAFE_DELETE | 10 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/queue/src/serving/serving.dto.ts:183` | deriveServingStatus | SAFE_DELETE | 10 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/queue/src/serving/serving.dto.ts:140` | POSServingState | SAFE_DELETE | 8 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/queue/src/serving/serving.dto.ts:159` | CustomerServiceProgress | SAFE_DELETE | 17 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/checkout/src/checkout/checkout.dto.ts:63` | isReadyForCheckout | SAFE_DELETE | 5 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/checkout/src/checkout/checkout.dto.ts:45` | POSCheckoutState | SAFE_DELETE | 11 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/super-admin/src/super-admin-ai-insights/ai-insights-core.ts:7` | InsightStatus | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/super-admin/src/super-admin-alerts/alerts-core.ts:42` | severityBadge | SAFE_DELETE | 8 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/super-admin/src/super-admin-alerts/alerts-core.ts:61` | mapOverviewSeverity | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/super-admin/src/super-admin-overview/overview-core.ts:129` | severityOrder | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/super-admin/src/super-admin-staff/global-tech-admin-core.ts:123` | ANONYMIZED_PROFILE_FIELDS | SAFE_DELETE | 4 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/super-admin/src/super-admin-tenants/super-admin-tenants.repository.ts:42` | SupportSessionSeed | SAFE_DELETE | 8 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/workforce/src/tech-profile/media-access-core.ts:83` | ownsNamespacedKey | SAFE_DELETE | 4 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/ai/src/ai/ai-task-registry.ts:213` | CRITICAL_ACTIONS | SAFE_DELETE | 4 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/ai/src/ai/ai-safety-policy.ts:174` | AiDecisionTrace | SAFE_DELETE | 9 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/booking/src/customer-booking/booking-verification-provider.ts:141` | maskAccountSid | SAFE_DELETE | 4 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/booking/src/customer-booking/booking-verification-provider.ts:148` | credentialFingerprint | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/platform/src/super-admin-plans/ai-features.ts:19` | AI_FEATURE_LABELS | SAFE_DELETE | 4 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/customer-display/src/adPlaylist.ts:36` | forgetPlaylist | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/customer-web/src/auth/guest.ts:80` | requiresAccount | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/owner-web/src/api/ownerApi.ts:67` | ownerExpensesApi | SAFE_DELETE | 7 | Only references are docs/baselines/allowlists (apps/api/scripts/dead-client-methods.baseline.json); unused inside its own file. Delete and shrink the baseline/a |
| `modules/identity/src/auth/reset-authz.ts:68` | ROLE_DEFAULT_RESET_PERMS | SAFE_DELETE | 9 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/safety/src/ai-ocr-receipt/ai-ocr-receipt-events.ts:40` | InMemoryReceiptEvents | SAFE_DELETE | 8 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/checkout/src/checkout/checkout-discount-engine.ts:29` | applyDiscountSequence | SAFE_DELETE | 68 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `modules/ai/src/ai-customer-profile/ai-customer-profile.dto.ts:37` | AI_CUSTOMER_PROFILE_ERRORS | SAFE_DELETE | 7 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/admin-web/src/api/superAdminAppointmentOversightApi.ts:80` | fetchAppointmentHistory | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/admin-web/src/api/superAdminAppointmentOversightApi.ts:86` | fetchDataIntegrity | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/admin-web/src/api/superAdminAppointmentOversightApi.ts:92` | fetchCorrectionPreview | SAFE_DELETE | 3 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/admin-web/src/api/superAdminQueueApi.ts:45` | LQKpis | SAFE_DELETE | 5 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/admin-web/src/api/superAdminQueueApi.ts:70` | LQTodaySummary | SAFE_DELETE | 4 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
| `apps/admin-web/src/api/superAdminBillingApi.ts:8` | BillingKpis | SAFE_DELETE | 5 | Exported symbol: zero occurrences of the name anywhere else in the repo (code, docs, tests, scripts, JSON) and unused inside its own file. |
1,157 exports are DEPRECATE = "drop the `export` keyword" (used inside their own file only, or only by a test); 540 are KEEP because the same name appears in another non-doc file (same-named type re-declared in `packages/api-contracts`, DI token, string registry) and need a human look before any change. Note that `packages/api-contracts` itself shows **no** unused exports — it is the public contract and stays untouched.

### B.6 Dependencies
| Path | Package | Action | LOC | Reason |
|---|---|---|---|---|
| `apps/api/package.json` | @simplewebauthn/server | DEPRECATE | 1 | Used only by modules/identity (which declares it). Redundant in apps/api. |
| `apps/api/package.json` | exceljs | DEPRECATE | 1 | Used only by modules/finance (declares it). Redundant in apps/api. |
| `apps/api/package.json` | pdfkit | DEPRECATE | 1 | Used only by modules/super-admin (declares it). Redundant in apps/api. |
| `modules/finance/package.json` | @aipowersalon/audit | DEPRECATE | 1 | Declared, never imported in modules/finance/src. |
| `modules/finance/package.json` | @aipowersalon/money | DEPRECATE | 1 | Declared, never imported in modules/finance/src. |
| `apps/admin-web/package.json` | @aipowersalon/realtime-contracts | DEPRECATE | 1 | Declared, not imported by admin-web src (verify via build after removal). |
| `apps/admin-web/package.json` | autoprefixer | SAFE_DELETE | 1 | No postcss config in apps/admin-web; tailwind v4 via @tailwindcss/vite needs neither. |
| `apps/admin-web/package.json` | postcss | SAFE_DELETE | 1 | No postcss config in apps/admin-web. |
| `apps/pos-web/package.json` | @aipowersalon/realtime-contracts | DEPRECATE | 1 | Declared, not imported by pos-web src. |
| `apps/owner-web/package.json` | @aipowersalon/realtime-contracts | DEPRECATE | 1 | Declared, not imported. |
| `apps/owner-web/package.json` | @aipowersalon/date-time | DEPRECATE | 1 | Declared, not imported. |
| `apps/manager-pay-web/package.json` | @aipowersalon/date-time | DEPRECATE | 1 | Declared, not imported. |
| `apps/manager-pay-web/package.json` | react-router-dom | DEPRECATE | 1 | Declared, not imported by manager-pay-web src (app uses its own shell/nav). |
| `apps/customer-web/package.json` | @aipowersalon/realtime-contracts | DEPRECATE | 1 | Declared, not imported. |
| `apps/customer-display/package.json` | @aipowersalon/money | DEPRECATE | 1 | Declared, not imported. |
| `modules/identity/package.json` | @aipowersalon/customers | DEPRECATE | 1 | devDependency never imported. |
## Top risks of removal (read before pass 2)
1. **Ratchet gates reference dead code by name.** `dead-client-methods.baseline.json`, `as-any.baseline.json`, `silent-catch.baseline.json`, `audit-writers.allowlist.json` list several files/methods in the plan. Each must shrink in the same commit or `check:dead-client` / `check:as-any` / `check:silent-catch` fail ("baseline only shrinks" is enforced, so removing lines is allowed; leaving a line for a deleted file is not).
2. **Evidence scripts vs. Kevin's verification reports.** 78 DEPRECATE scripts are what the reports cite as proof; 61 SAFE_DELETE scripts are the same genre with no citation. Deleting them does not break the product, but it does break "re-run the evidence" for those reports. Recommend deleting the 61, moving the 78.
3. **`audit-ai-dod.mjs` counts `measure-ai-capacity.mjs` as a DoD proof** — fix its imports (A.1 #1); do not delete it.
4. **Same-name collisions in the KEEP bucket.** 540 knip-flagged exports were kept only because the identifier appears elsewhere; some are genuinely dead (e.g. `apps/owner-web/src/api/ownerApi.ts` re-exports 39 contract types that no owner-web file imports). A second, import-graph-based pass (not name-based) would recover these; they are low value (mostly 1-line type re-exports).
5. **`update_tech_login.patch`** may represent intended behaviour (Face-ID auto-prompt on tech login) that never landed. Confirm with Kevin before deleting.
6. **`MembershipsOverviewScreen` (456 LOC + 83-LOC test)** is unrouted since `/memberships` became a redirect; deleting it also lets ~16 `superAdminMembershipsApi` exports go. Check Kevin does not plan to restore the overview route.
7. **Other agents are editing the tree.** Every line number in the plan is as of ef7eb6bf; re-run `node <scratch>/verify-exports.mjs` style grep before deleting an export, and run `npm run ci:gates` + all-workspace `tsc --noEmit` after each deletion batch.
