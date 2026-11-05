# Backend test coverage — tip math + cash-drawer service

Two coverage gaps filled in money-handling backend code, both as Nest-free `*-core.spec.ts` harnesses (esbuild + node), run by
`scripts/run-core-specs.sh` alongside the vitest suites.

## 1. Kiosk tip math (checkout-display.dto) — +6 assertions
Of the pure money helpers in `checkout-display.dto.ts`, `computeTotals`, `validateCustomTip`, and `splitCardSurchargeCents`
were already tested — but `tipForPercent` and `tipOptions` (the functions that build the tip buttons the customer-display kiosk
renders) were not. Added assertions to the existing `checkout-core.spec.ts`:
- `tipForPercent`: 20% of $100 = $20, rounds to the nearest cent (`9999 * 15%` → 1500), zero subtotal → 0.
- `tipOptions`: yields one option per percent plus a trailing "No Tip"; marks the option whose amount equals the selected tip
  as `selected`; "No Tip" is selected only when the selected tip is 0.

`checkout-core` harness: 77 → **83 assertions**.

## 2. cash-drawer service — new harness, 19 assertions
The `cash-drawer` module had **no tests** despite handling register cash. Added `cash-drawer-core.spec.ts` with a fake repo +
fake realtime bus (the guards fire before any repo call, so the fakes stay minimal), covering:
- **Permission gating** — `openDrawer` / `addMovement` / `voidMovement` / `reconcileDrawer` all reject a ctx without
  `pos.checkout.take_payment`; `getDrawer` rejects an identity-less ctx; the **OWNER role bypasses** the explicit permission.
- **Validation** — non-uuid branch → `no_branch`; negative float / non-positive movement / negative count → `bad_amount`;
  missing direction → `bad_direction`; missing movement id → `bad_request`.
- **Reconcile variance flow** — exact count → `reconciled` event and no alert; a short count and an over count both emit the
  `discrepancy` event and raise an alert worded "short"/"over" with the correct signed `varianceCents` (counted − expected, the
  same sign convention the owner cash screens use). Also asserts `open` writes its audit, emits the `opened` event, and passes
  the float through to the repo.

`cash-drawer` module: spec count 0 → **1** (19 assertions).

## Verification
Full backend: **23 harness suites passed** (was 22) + **603 vitest tests passed** (89 files, unchanged — both additions are
harness specs), `RESULT: PASS`. No production code changed.

## 3. tech-cash-handoff service — new harness, 18 assertions
The other untested cash-reconciliation service. Added `tech-cash-handoff-core.spec.ts` (same fake-repo + fake-realtime
approach), covering:
- **Technician-side guards** — `techMyHandoff` / `techSubmit` reject a non-technician account (`not_a_technician`); `techSubmit`
  blocks when there's no cash to hand off (`no_cash`); the happy path records the hand-off, writes its audit, emits
  `cash_handoff_submitted`, and returns the detail.
- **POS day board** — `posList` is view-gated, and its aggregation is checked: totals expected/counted cash (nulls as 0) and
  counts reconciled (including discrepancy) vs open across a mixed set of technicians.
- **posTechDetail / posReconcile guards** — view/permission gating, non-uuid technician → `bad_request`, negative count →
  `bad_amount`.
- **Reconcile variance flow** — exact count → `reconciled` (no alert) and also notifies the technician; short and over counts
  emit `discrepancy` plus a "short"/"over" alert with the correct signed `varianceCents`.

`tech-cash-handoff` module: spec count 0 → **1** (18 assertions). Both cash-reconciliation services (drawer + tech hand-off) are
now covered.

## Updated verification
Full backend: **24 harness suites passed** + **603 vitest tests passed**, `RESULT: PASS`. No production code changed.

## 4. skip-line-checkout (cash-to-technician) — new harness, 19 assertions
The customer-facing Skip-the-Line cash flow had **no tests** despite moving real money and closing tickets. Added
`skip-line-checkout-core.spec.ts` (fake repo + fake realtime), covering the full cash-to-technician path:
- **Account-type guards** — customer endpoints reject non-customers (`not_a_customer`); technician endpoints reject
  non-technicians (`not_a_technician`).
- **Settings gates** — `payCashToTech` is blocked when the feature is off (`feature_disabled`) or cash-to-technician is off
  (`cash_disabled`).
- **Ownership + state** — `payCashToTech` 404s with no bill, forbids paying *another* customer's bill, and rejects an
  already-paid bill; `paymentStatus` 404s on a missing intent and forbids another customer's intent; `confirmCashReceived`
  404s with no pending cash and rejects an already-paid ticket.
- **Happy paths** — customer selecting cash returns the pending intent/amount, audits, and notifies tenant + technician;
  the technician confirming closes the ticket as paid, returns the payment id, awards loyalty, and emits `cashConfirmed`.
- **Manager override** — a `pos.checkout.take_payment` holder may confirm cash on a ticket assigned to a *different*
  technician (the `not_assigned` block is bypassed); a regular tech cannot.

`skip-line-checkout` module: spec count 0 → **1** (19 assertions).

## Running total
Three money paths hardened across these passes — cash-drawer, tech-cash-handoff, and skip-line-checkout — plus the kiosk tip
math. Full backend: **25 harness suites passed** + **603 vitest tests passed**, `RESULT: PASS`. No production code changed.

## 5. customer-display service — new harness, 20 assertions
The kiosk's backend brain had **no tests**, despite owning the session token check and the money totals the iPad shows. Added
`customer-display-core.spec.ts` (fake data port + fake realtime), closing the loop on the frontend already verified in
`CUSTOMER_DISPLAY_AUDIT.md`:
- **Session public-token auth** — `getState` 404s on a missing session and forbids a wrong/missing token (constant-time
  verify); `canAccess` (used to gate the SSE stream) returns the matching boolean.
- **State derivation** — mirrors the ticket's real status: paid → `payment_success`; an elapsed session → `expired`; a failed
  state or a declined charge while processing → `payment_failed`.
- **Customer tip** — rejected once past review, on an unknown `tipType`, on a percent with no percentage, and on a custom tip
  over the max; the happy percent path selects `tip_selected`, computes 15% of the subtotal, and persists it.
- **Pay-button gate** — `requestPayment` is blocked when the display's pay button is off (the default) and marks
  `payment_processing` (recording the request) when enabled.
- **Method selection** — must be card or cash; choosing cash persists the method.
- **Device-token mode** — an unpaired device token is forbidden; a paired device shows its active session, otherwise an idle
  screen.

`customer-display` module: spec count 0 → **1** (20 assertions). The customer-display kiosk is now covered end to end —
frontend (26 tests + audit) and backend (20 assertions).

## Running total
Across these passes: three money services (cash-drawer, tech-cash-handoff, skip-line-checkout), the kiosk tip math, and the
customer-display backend — all previously untested — now have tests. Full backend: **26 harness suites passed** + **603
vitest tests passed**, `RESULT: PASS`. No production code changed.

## 6. end-of-day-followups service — new harness, 20 assertions
The post-service customer follow-up engine (tech/manager/customer surfaces) had **no tests**, despite a real task lifecycle
and per-role scoping. Added `end-of-day-followups-core.spec.ts` with a fake port backed by a *mutable* task store (so status
transitions re-read correctly through `taskById`):
- **Role resolution** — tech endpoints require a linked technician (`not_technician`); customer endpoints require a linked
  customer profile (`not_found`).
- **Task ownership / scoping** — `techGet` 404s a task from another tenant and forbids another technician's task; `customerGet`
  hides a task that hasn't been sent yet.
- **Per-status guards** — a sent follow-up can't be dismissed; editing is blocked when disabled for the branch, only allowed
  on a pending task, and rejects an empty message; only an awaiting-approval task can be approved; replies are blocked when
  disabled and can't be empty; `saveSettings` rejects a non-`HH:mm` generation time.
- **Lifecycle transitions** — `techSend` delivers to a customer with the app (→ `sent` + notification), holds for approval when
  required (→ `pending_manager_approval`), and reports honestly when there's no app account (→ `customer_not_available`);
  `techDismiss` → `dismissed`; `managerApprove` sends an awaiting-approval task and audits the approval; `customerReply` →
  `customer_replied`; a valid settings save persists and audits.

`end-of-day-followups` module: spec count 0 → **1** (20 assertions).

## Status
This closes the backend modules that carried untested business logic. Across these passes the new harnesses cover: three
money services (cash-drawer, tech-cash-handoff, skip-line-checkout), the kiosk tip math, the customer-display backend, and the
end-of-day follow-up engine. The remaining spec-less modules are thin or infrastructural (account, customer-registration, pos,
super-admin-owners; plus health/database/session/workflow) — no substantial untested logic left in the same vein. Full
backend: **27 harness suites passed** + **603 vitest tests passed**, `RESULT: PASS`. No production code changed.

## 6b. end-of-day-followups generation + scheduler + expiry — new harness, 16 assertions
The lifecycle harness above left out the engine's other half — generation, the scheduler tick, and the expiry/purge sweeps.
Added `end-of-day-followups-generation-core.spec.ts` (fake port), covering:
- **Once-per-day generation gate** — the scheduler skips a branch already generated today; a manual "Generate Now" forces past
  the gate (the unique index still prevents duplicate tasks).
- **Insert / skip accounting + failure** — all newly-completed lines become tasks; duplicates count as skipped, not created;
  techs are notified only when tasks were created and only when the branch has reminders on; a failed insert records a failed
  run and rethrows.
- **Scheduler gating** — `runDueBranches` runs an enabled, due, not-yet-run branch, and skips ones that are disabled or already
  generated; one branch throwing does not stop the others (per-branch isolation).
- **Expiry / purge windows** — stale pending tasks are expired and audited; expiry is off when the window is 0; the retention
  purge removes old rows and is disabled when retention ≤ 0.

`end-of-day-followups` now has two harnesses (lifecycle + generation), 36 assertions total — the module's business logic is
covered end to end.

## Status (updated)
Full backend: **28 harness suites passed** + **603 vitest tests passed**, `RESULT: PASS`. No production code changed. The
backend modules that carried untested business logic are now covered; the remaining spec-less modules are thin or
infrastructural.

## 7. pos-search-core — new harness, 23 assertions (correcting an earlier call)
I'd written off `pos`/`account`/`customer-registration`/`super-admin-owners` as "thin." On a closer look that was wrong:
`pos-search-core.ts` is a stack of pure, security-relevant policy functions — and its own header even claimed "pure, tested"
while no spec exercised it. Added `pos-search-core.spec.ts`:
- **Access control** — `hasPosSearchAccess`: OWNER/MANAGER/FRONT_DESK/RECEPTION in, TECHNICIAN only with `pos.access`,
  CUSTOMER/SUPER_ADMIN/unknown out. `permittedGroups`: owners/managers see all groups; a tech sees exactly the groups its
  permissions cover, including the shared `tickets.view` that unlocks both tickets and queue.
- **Query validation** — trims, requires ≥ 2 chars (`min_length`), rejects empty/undefined.
- **Limit clamping** — default 5, ceiling 10, in-range kept.
- **Result routing** — `ticketRoute` maps status → the right POS screen (unknown → checkout); `getResultRoute` routes each
  result type and honors an explicit route override for tickets/queue items.
- **Shaping** — `emptyGrouped` has every group as an empty array; `totalCount` sums across groups.

`pos` module: spec count 0 → **1** (23 assertions). The "pure, tested" header comment is now actually true.

Note: `account` (deletion-request / privacy-export auth guards), `customer-registration` (signup validation), and
`super-admin-owners` (cross-tenant branch-assignment guards) also have real, untested guard logic — they are NOT thin, and are
good next targets.

## Status (updated)
Full backend: **29 harness suites passed** + **603 vitest tests passed**, `RESULT: PASS`. No production code changed.

## 8. account service — new harness, 12 assertions
`account.service.ts` is Nest-free and port-based, so it harnesses cleanly. Added `account-core.spec.ts` covering the
deletion/deactivation + privacy-export flows (GDPR-style surface):
- **Auth guard** — both `requestDeletion` and `privacyExport` require a signed-in (uuid) user (`unauthenticated`).
- **Role branching** — a customer request is a `delete`; an owner/tech request is a `deactivate`; each audits the matching
  action and shows the correct "what we remove / what we retain (financial/audit law)" lists.
- **Idempotency** — an existing pending request is reused, not duplicated or re-audited, with the "already pending" message.
- **Input limits** — `reason` and `contactEmail` are truncated (1000 / 200).
- **Privacy export** — 404s an unknown user; a non-customer gets the account block only; a customer additionally gets their
  profile + loyalty section, and the loyalty section is omitted when there's no loyalty record.

`account` module: spec count 0 → **1** (12 assertions).

## Two modules that can't be harnessed here without a refactor (a decision for you)
While working the "thin" list I hit a structural wall on two of them:
- **super-admin-owners** — the service is written *inline in its `.module.ts`* (not a separate `.service.ts`) and talks to
  Kysely directly, and the file imports `@nestjs/common`. In this sandbox `class-transformer` isn't installed, so anything
  importing `@nestjs/common` can't be bundled or imported by a spec (no existing test touches Nest). Its guards are real and
  worth locking — especially the cross-tenant check that rejects assigning a branch from a *different* salon business — but
  testing them needs either Postgres or a small refactor extracting the service into a Nest-free `.service.ts` with a repo
  port (the pattern every other service here already follows).
- **customer-registration** — same blocker: the email/field validation lives inside the `@Injectable()` service with no pure
  DTO export, so it can't be imported standalone.

I did **not** refactor production code to force these (this whole pass has changed zero production code). If you want them
covered, the move is to extract each service's logic into a Nest-free file like the others — say the word and I'll do it.

## Status (updated)
Full backend: **30 harness suites passed** + **603 vitest tests passed**, `RESULT: PASS`. Of the previously spec-less modules,
`pos` and `account` now have harnesses; `super-admin-owners` and `customer-registration` are blocked on the structural issue
above; the rest (database/health/session/workflow) are infrastructural.

## 9. super-admin-owners — extracted to make it testable, then covered (10 assertions)
This is the **first production-code change in this entire testing pass** — and it's a behavior-preserving refactor, not a
logic change. Per the plan flagged in section 8, I moved `SuperAdminOwnersService` (plus its error class and `ACCESS_LEVELS`)
out of `super-admin-owners.module.ts` into a new Nest-free `super-admin-owners.service.ts`; the `@Controller`/`@Module`
wiring stays in the module and now imports the service. The service code is byte-identical — only relocated — so it now
matches how every other service in the codebase is structured and can be unit-tested.
- **Verification of the refactor**: `tsc --noEmit` was clean before AND after (0 diagnostics, exit 0), and the full suite
  stayed green — so the Nest module still wires and type-checks correctly; behavior is unchanged.

Then added `super-admin-owners-core.spec.ts` with a tiny Kysely-shaped fake (canned rows keyed by table), covering the
guards:
- **Owner resolution** — an unknown owner is `not_found`; an owner with no tenant is `invalid`.
- **createSalon / assignBranch / updateBranch validation** — salon name required; branchId required; unknown branch 404s;
  an invalid access level is rejected; an owner not assigned to a branch 404s on update.
- **The cross-tenant security boundary** — `assignBranch` REJECTS a branch belonging to a *different* salon business, and
  ALLOWS one within the owner's own tenant (which then completes and returns the refreshed owner view). `updateBranch`
  likewise completes on a valid access level.

`super-admin-owners` module: spec count 0 → **1** (10 assertions), and the cross-tenant rule is now regression-locked.

## Status (updated)
Full backend: **31 harness suites passed** + **603 vitest tests passed**, `RESULT: PASS`; `tsc --noEmit` clean. Remaining
spec-less-with-logic module: `customer-registration` (same extraction would make its signup validation testable —
straightforward, available on request). The rest (database/health/session/workflow) are infrastructural.

## 10. customer-registration — decorators stripped to make it testable, then covered (9 assertions)
Same idea as section 9, even smaller: the module already provides this service via a `useFactory` that passes the repo
positionally, so the `@Injectable()` / `@Inject('CustomerRegistrationDataPort')` decorators (and the `@nestjs/common`
import) were redundant. Removed them so the service is Nest-free and importable; the constructor now takes the repo plainly.
No wiring change, no logic change — `tsc --noEmit` clean before and after, full suite green.

Added `customer-registration-core.spec.ts` covering `register()`:
- **Field validation** — salon code required; first and last name required; a malformed email rejected; a password under 8
  chars rejected (each with its specific message).
- **Precedence** — with everything blank, the salon-code error surfaces first.
- **Delegation + passthrough** — a valid request is handed to the repo, and the repo's result (success or e.g. "Salon code
  not found.") is returned as-is.
- **Normalization** — fields are trimmed and the email is lowercased before the repo sees them; phone is optional.

`customer-registration` module: spec count 0 → **1** (9 assertions).

## Backend coverage — complete
Every backend module that carried real business logic now has tests. The only spec-less modules remaining are purely
infrastructural (database, health, session, workflow). Two small, behavior-preserving refactors were made to get there
(extracting `super-admin-owners`' service to its own file; dropping `customer-registration`'s redundant DI decorators), each
verified by a clean `tsc --noEmit` and a green suite. Final: **32 harness suites passed** + **603 vitest tests passed**,
`RESULT: PASS`.

## 11. workflow + session — pure logic I had wrongly dismissed as "infra" (35 assertions)
Twice now I called modules "thin/infrastructural" without reading them and was wrong. `workflow` and `session` both carry
real, pure, untested logic — including money math. Verifying instead of assuming is what caught it.

`workflow-core.spec.ts` (15) — the pure workflow helpers in `workflow.dto.ts`:
- **Queue** — `estimateWaitMinutes` (divides across techs; series fallback when none free; rounds); `rankByWait` (longest
  wait first, 1-based positions).
- **Money** — `tipAmountCents` (rounded % of taxable); `cartTotals` (subtotal − discount = taxable, floored at 0; tax + tip
  on taxable; total); `splitEqually` (exact-cent equal split with the remainder on the first parts — verified to always sum
  back to the total, incl. 100/3 → 34/33/33 and zero-ways → []); `isValidSplit` (exact-sum check, off-by-a-cent rejected);
  `centsToUsd` (USD with thousands separators).

`auto-logout-core.spec.ts` (20) — the pure auto-logout helpers in `auto-logout.dto.ts`:
- **Time** — `parseHHmm` (range-checked, rejects garbage/wrong shape); `to12Hour` (incl. noon/midnight edges);
  `buildLogoutAtIso` (deterministic UTC = local close + grace shifted by the tz offset; negative grace clamped; bad
  date/time → null); `remainingSeconds` (counts down, floors, clamps at 0, null when no logout); `pickActiveWarning`
  (smallest crossed threshold).
- **Role policy** — `isExemptFromAutoLogout` (SUPER_ADMIN always; OWNER/ADMIN only when toggled; MANAGER unless
  applyToManagers; front-of-house never) and `canExtendSession` (managers+ always; reception only when allowed; techs never)
  — the rules for who a tenant's closing time logs out and who can extend.

`workflow` and `session` modules: spec count 0 → **1** each (15 + 20 assertions).

## Backend coverage — genuinely complete (verified, not assumed)
Having now actually read every remaining module: the only spec-less ones left are `database` (a Postgres-or-null provider
factory — env wiring, no logic) and `health` (a liveness endpoint returning `{status:'ok', uptime, timestamp}`). Neither has
business logic to characterize. Everything else with real logic is covered. Final: **34 harness suites passed** + **603
vitest tests passed**, `RESULT: PASS`, `tsc --noEmit` clean.
