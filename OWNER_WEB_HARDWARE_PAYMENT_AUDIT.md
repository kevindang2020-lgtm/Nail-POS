# owner-web hardening — HardwarePaymentScreen (two wiring bugs fixed)

Continued the owner-web money sweep with the Hardware Payment Recovery screen (build doc §15) — the owner-side counterpart
to the Super Admin hardware system. It shows the salon's hardware plan + monthly statements and offers self-service autopay
(save a tokenized card, then authorize shortfall auto-charge). It had no test and two real bugs, both caused by the screen
typing its `plan`/`invoices` as `any` (so the compiler couldn't catch field-name drift against the real owner DTOs).

## Backend verified first
All four client calls map to the dedicated owner controller `@Controller('owner/hardware-payment')`: `plan` → `ownerPlan`,
`invoices` → `ownerInvoices`, `payment-method` → `addPaymentMethod`, `autopay-consent` → `recordAutopayConsent`
(`settings.view` / `settings.edit` — matching the screen's 403 handling). The DTOs are correctly owner-safe: `ownerInvoices`
explicitly strips the Fiserv/platform figures (net margin, platform share, Fiserv share), and the plan carries no platform
economics. Field names on the returned plan/invoice are camelCase and match what the screen reads.

## Bug 1 — invoices rendered with broken React keys
`ownerInvoices` returns owner-safe invoice rows **without an `id`**, but the screen used `key={i.id}` — so every statement
row got `key={undefined}`, defeating React's list reconciliation (duplicate-key warning; rows can mis-update when statuses
change after an autopay run). **Fix:** key on the natural unique key that the DTO does return, `key={i.id ?? i.billingMonth}`
(one invoice per billing month per plan).

## Bug 2 — saved-card last4 never displayed
`ownerPlan` returns the card details in a separate `savedPaymentMethod: { brand, last4, status }` field, but the screen read
`plan.savedPaymentMethodLast4` (which doesn't exist) — so the "A card is on file ending ••••" line silently dropped the
digits the API was already sending. **Fix:** capture `savedPaymentMethod.last4` from the response into state and display it,
so the owner can confirm *which* card is on file for auto-charges. (Card-on-file detection itself, `plan.savedPaymentMethodId`,
was already correct.)

## Verified clean (no change)
`load` uses `Promise.allSettled` so a failing invoices call can't blank the plan; `arr()` tolerates array/`{invoices}`/`{rows}`/
`{items}` shapes; the authorize flow guards token + consent and surfaces an owner-appropriate 403; `money()` is null-safe.

## Tests added (7)
Plan summary; **last4 now shows from `savedPaymentMethod` (Bug 2)**; authorize saves the card then records consent;
authorize is blocked without a token or without the consent box; **owner-safe invoices render with no React key warning
(Bug 1)**; the no-plan state; a friendly 403.

## Verification
owner-web `tsc` clean, **47 tests pass** (11 files), `vite build` clean. (admin-web 151 / clean and backend 603 / PASS
unchanged — both fixes were client-side.)

## Remaining in owner-web
Last money screen: **FinanceReportsScreen**. Then OwnerHomeScreen, BookingOverviewScreen, StaffPerformanceScreen,
BranchPerformanceScreen, AlertsScreen, AuditScreen, TechnicianDetailScreen, MoreScreen, LoginScreen, and the static
Privacy/Terms/Delete-account screens.
