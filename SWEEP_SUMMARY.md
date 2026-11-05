# AIPowerSalon — Screen-Hardening Sweep + Preventive Typing Campaign — Consolidated Summary

A single index of the audit-first screen-hardening sweep across all six React/Vite frontends, followed by a preventive
TypeScript-typing campaign that eliminated every *consumed* `any`-typed API read surface in the monorepo. Each line item below
has a dedicated per-turn report in the repo root (filenames referenced inline).

## Final status — all green

| Surface | Tests | tsc | build |
|---|---|---|---|
| apps/api (backend) | **603** PASS | — | — |
| admin-web | **151** | clean | clean |
| pos-web | **75** | clean | clean |
| owner-web | **85** | clean | clean |
| tech-web | **74** | clean | clean |
| customer-web | **136** | clean | clean |
| customer-display | **26** | clean | clean |

Every backend test was already green before the sweep and stayed green throughout — **all ten bug fixes were client-side**.
The sweep added roughly **155 frontend tests** (incl. a from-scratch harness for customer-display) and fixed **10 real bugs**; the typing campaign is types-only plus a handful of
provable, behavior-preserving simplifications, each validated by the existing suite staying green.

## Methodology

Per screen: read the screen → its API client → the backend controller/service/repo → verify wiring field-for-field (route
paths, body keys, return shapes, camelCase/snake_case match, and whether a re-hydrating mutation returns the right shape) → fix
only real bugs → add vitest tests → re-run the app suite + build. Principles held throughout: **audit-first** (never duplicate
modules/routes/tables — scan, reuse, fix wiring), **honest verification** (real tests, never fabricated data), **no
scope-padding** (verifying-clean is a valid outcome). The recurring defect class the sweep targeted: data typed `any` + a
field-name mismatch, so a screen reads a field the backend never returns and silently gets `undefined`.

## Real bugs fixed (10) — all client-side

| # | App | Screen | Bug | Fix |
|---|---|---|---|---|
| 1 | admin-web | ApplicationsScreen | list capped at 25 | `pageSize: 100` |
| 2 | admin-web | UsersRolesScreen | list capped at 50 | `pageSize: 100` |
| 3 | admin-web | UsageLimitsScreen | **backend**: non-numeric limit → `NaN` → null → silently set 0 | reject null/'' before coercion (super-admin-platform.service.ts) + client whole-number guard |
| 4 | admin-web | BillingScreen | no-subscription select mis-render | prepend disabled "— none —" option |
| 5 | admin-web | PaymentGatewaysScreen | latent `.replace()` crash on missing status | `(g.gatewayStatus \|\| 'not_configured')` |
| 6 | admin-web | LoginScreen | empty-MFA submit + wrong-code message | guard empty + correct message |
| 7 | pos-web | POSSkillRequestsScreen | approve/reject failure written into the green note box | route to the red error box |
| 8 | owner-web | ExpensesScreen | `create` omitted `branchId` → multi-branch expense saved null-branch & vanished | `branchId: effectiveBranchId ?? null` |
| 9 | owner-web | HardwarePaymentScreen | invoice `key={i.id}` (DTO omits id) + saved-card last4 read from nonexistent `plan.savedPaymentMethodLast4` | `key` → `billingMonth`; last4 from `savedPaymentMethod.last4` |
| 10 | owner-web | BookingOverviewScreen | date label `new Date(o.dateFrom)` (full ISO instant) could render previous day west of salon | `new Date(o.dateFrom.slice(0,10)+'T00:00:00')` |
| 11 | tech-web | TicketDetailScreen | **most serious**: Edit-Live-Ticket modal read the services array with wrong field names (`serviceLineId`/`serviceName`/`serviceId`/`isAddOn` all undefined) | read `l.id`/`l.name`, exclude current service by name, type the callback |

(Eleven rows; #9 is two related fixes in one screen.)

## Preventive typing campaign — eliminated every consumed `any` read surface

Types-only and behavior-preserving (validated by existing suites). Three of these passes specifically **regression-guard the
exact screens where this sweep found bugs**, so a future backend field rename now breaks the build instead of silently breaking
the screen again.

**customer-web** (reports: `CUSTOMER_WEB_PUBLIC_TECH_CARD_TYPING`, `_TECH_PROFILE_TYPING`, `_BOOKING_FAVORITES_TYPING`)
- `PublicTechCard` + `NearbyTechCard` → typed `salonTechnicians`, `techsNearby`.
- `PublicTechProfile` (+ photo/review/bucket/service/salon sub-types) → typed `techProfile`.
- `BookingServiceTech` (nullable public-only fields) → typed `bookingServiceTechnicians`; `techFavorites` → `PublicTechCard[]`.
  Surfaced 3 nullable reads in BookScreen, fixed behavior-preservingly.
- `MyTechRating` (discriminated union) → typed `myTechRating`; RateTechScreen `existing` typed to the `exists:true` variant.
- → **All customer-web tech/rating returns typed.**

**tech-web** (reports: `TECH_WEB_EDIT_OPTIONS_TYPING`, and the public-preview pass)
- `TechEditOptions` (+ service/change-request sub-types) → typed `editOptions`. **Locks the TicketDetail fix (#11).** Incidentally
  confirmed pending-change-request rows are camelCase end-to-end (no latent bug).
- `TechPublicPreview` → typed `publicPreview`.

**owner-web** (report: `OWNER_WEB_HARDWARE_PAYMENT_TYPING`)
- Corrected **stale, wrong** types: the old `OwnerHwInvoice` claimed `id` + `cardVolumeCents` that the owner DTO strips. Replaced
  with the real six-field shape; added the real `{ plan, savedPaymentMethod }` envelope. **Locks the two HardwarePayment fixes
  (#9).**

**admin-web** (reports: `ADMIN_WEB_HW_REPORTS_TYPING`, `_HW_PAYMENTS_TYPING`, `_ALERTS_TYPING`)
- `HwReportRow` → typed `hwReports`.
- `HwPlan`/`HwPlanResponse`, `HwSplitSettings`/`HwTenantSettingsResponse`, `HwInvoice`, `HwLedgerRow` → typed `hwPlan`,
  `hwTenantSettings`, `hwInvoices`, `hwLedger`. (Admin plan endpoint reuses `ownerPlan` — same envelope.)
- `SaAlert`/`SaAlertDetail`/`SaAlertsSummary`/`SaAlertNote` (mirror `alerts-core`) → typed `alerts`, `alertsSummary`, `alert`,
  `alertsRecent`, `alertStatus`.
- → **The entire Super Admin client is typed.**

Across all six apps, the only remaining `api.get<any>` is `hwGlobalSettings` (admin) — an **unused** method with no read
surface. Mutation-response `any` (addServiceLine, changeService, addMethod, etc.) are intentionally left: those screens refetch
and never read the mutation body.

## Screens verified clean + test-locked (no bug found; tests added)

Each verified field-for-field against the backend and locked with tests. Per-screen reports in repo root.

- **admin-web:** HardwarePaymentsScreen, HardwarePaymentReportsScreen, SystemHealthScreen, AuditLogsScreen, ProjectStatusScreen.
- **pos-web:** EndOfDayFollowUpSettings.
- **owner-web:** OwnerCashDrawerScreen, OwnerCashSummaryScreen (variance sign: counted − expected), FinanceReportsScreen,
  OwnerHomeScreen, BranchPerformanceScreen, BookingOverviewScreen (Module 3), AlertsScreen (ack/resolve/dismiss funnel through
  `transitionAlert`), StaffPerformanceScreen, TechnicianDetailScreen.
- **tech-web:** TechEarningsScreen, QueueScreen, TechProfileScreen, NotificationsScreen, SettingsScreen, TechScheduleScreen
  (Mon-first week, lunch banner).
- **customer-web:** RateTechScreen, CustomerEditSocialProfileScreen, NailShowcaseCreatePostScreen, CustomerTechProfileScreen,
  FindTechsScreen, VisitScreen, NailShowcasePostDetailScreen, SalonTechsScreen.

## What's left (honest)

- `hwGlobalSettings` (admin) — dead `any` method, no consumer; not worth typing until something uses it.
- Untested low-logic screens remain across the apps (Login/More pages, static Privacy/Terms/Delete-account, the flat
  customer-display app). These are genuinely marginal — minimal branching, nothing that reads a drifting backend field.

All eight frontend apps in the tree are now audited (the six React/Vite apps plus the two vanilla-JS Go Check-In apps, the latter verified field-for-field against the backend — see GO_CHECK_IN_WIRING_AUDIT.md). The high-value work — 10 bugs, ~155 tests, and a typing campaign that cleared every consumed `any` read surface (including
regression-guarding all three places this sweep found bugs and correcting one set of actively-wrong stale types) — is complete.
