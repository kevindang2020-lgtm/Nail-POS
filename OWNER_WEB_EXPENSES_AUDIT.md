# owner-web hardening — ExpensesScreen (multi-branch expense bug fixed)

Started the owner-web sweep (the owner phone app) at its highest-consequence cluster: the money screens. First target was
`ExpensesScreen` — record/list/delete operating costs that feed real net profit (revenue − commission − expenses). It had
no test and a real multi-branch correctness bug.

## Bug: a new expense ignored the branch the owner was viewing
The screen scopes the list and summary by `effectiveBranchId` (the branch selected in the owner's branch switcher), but the
**create** call omitted `branchId` entirely. Tracing the backend:
- `OwnerService.createExpense` → `ensureBranch(ctx, input.branchId ?? undefined)`. For a multi-branch owner, when no
  branchId is supplied, `ensureBranch` returns **null** (repository stores `branch_id = null`).
- `listExpenses` / `expenseSummary` apply `bScope(..., branchId)`, so a single-branch view filters to that branch.

Net effect: a multi-branch owner viewing **Branch B** who added an expense had it saved as a **null-branch** row — which then
**vanished from Branch B's list and total** on the post-save reload (and was excluded from that branch's net-profit math). A
branch-restricted owner (e.g. a manager) was unaffected, because `ensureBranch` pins them to their assigned branch regardless.

**Fix (client-side, one line):** the screen now passes `branchId: effectiveBranchId ?? null` on create — so the expense
attaches to the branch being viewed in single-branch mode, and remains a tenant-level (null) expense in "all branches" mode,
exactly matching how the list/summary already scope. The backend already validates the supplied branch and still pins a
restricted owner to their branch, so this is safe in every access case.

## Verified clean (no change)
- Amount handling is the *correct* pattern: `parseFloat` → `Number.isNaN(cents) || cents < 0` rejects bad/negative input
  before any API call (this is the safe counterpart to the Usage Limits NaN bug). Dollars are converted to integer cents.
- Date input is `type="date"` and re-validated against `^\d{4}-\d{2}-\d{2}$`.
- 403s on load/create surface friendly, role-appropriate messages.
- (Noted, not changed: a failed delete silently reloads rather than surfacing an error — the row simply remains, which is the
  safe outcome; left as-is to avoid scope-padding.)

## Tests added (6)
Renders total + rows; **save sends cents + the viewed branch id (the fix)**; all-branches mode saves a null branch; an
invalid amount is rejected without calling the API; a 403 shows the friendly message; delete calls the real endpoint.

## Verification
owner-web `tsc` clean, **29 tests pass** (8 files), `vite build` clean. (admin-web 151 / clean and backend 603 / PASS are
unchanged — the only fix was client-side.)

## Remaining in owner-web (untested)
Money screens still to sweep: HardwarePaymentScreen, FinanceReportsScreen, OwnerCashDrawerScreen, OwnerCashSummaryScreen;
plus OwnerHomeScreen, BookingOverviewScreen, StaffPerformanceScreen, BranchPerformanceScreen, AlertsScreen, AuditScreen,
TechnicianDetailScreen, MoreScreen, LoginScreen, and the static Privacy/Terms/Delete-account screens.
