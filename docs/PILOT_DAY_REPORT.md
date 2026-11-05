# Pilot Day Report — one salon, one full day, end to end

Wave 4 PILOT, 13 Oct 2026. The proof script is `apps/api/scripts/live-pilot-day.mjs`.

**Result: 73 of 73 checks pass** (re-run after the post-pilot fixes, Oct 13 2026, salon zone Etc/GMT-10; the first run was 71 of 71).

The full day ran green in a salon zone east of UTC (Etc/GMT-14, already "tomorrow" in UTC terms). It also ran green in a zone west of UTC (Etc/GMT+10): 66 of 66 checks in that run, before the screen checks were added.

The run used the real HTTP API (`dist/main.js`) on a scratch PostgreSQL database and the real built apps in Chromium. No credentials were used. Every provider call went to a loopback fake or to the "not configured" path:

| Provider | What the pilot used |
|---|---|
| Card processor | The salon's own CardPointe gateway, pointed at a loopback fake |
| Tap to Pay | A CommerceHub loopback fake, with `COMMERCEHUB_TTP_ENV=sandbox` |
| Twilio and SendGrid | Unset, so SMS and e-mail took the degrade path |

**How to run it.** Run from `apps/api`, after a build:

```
DATABASE_URL=postgres://postgres@localhost:5432/<scratch db> \
  PILOT_SHOTS=<folder> PILOT_OUT=<file.json> \
  node scripts/live-pilot-day.mjs
```

| Option | What it does |
|---|---|
| `PILOT_TZ=<zone>` | Pins the salon zone. By default the script picks a whole-hour zone where it is 10:00 now, so the whole day falls inside business hours |
| `PILOT_SCREENS=0` | Skips Chromium |
| `PILOT_STOP_AFTER=N` | Stops after phase N |

## Timeline (salon local time, compressed into one run)

| # | Phase | What happens, through which surface |
|---|---|---|
| 0 | Boot | API on PostgreSQL. Card processor and Tap to Pay point at the loopback fakes. Twilio and SendGrid are unset. |
| 1 | Onboarding | 1. The public website application gets a reference number, and a double tap gives the same reference.<br>2. The Super Admin signs in with TOTP, reviews the application, approves it, and an onboarding case opens.<br>3. The Super Admin creates the tenant: salon code, branch, invited owner, pending gateway.<br>4. The application is marked converted.<br>5. The owner gets a first-sign-in temporary password, signs in and sets her own password.<br>6. With a step-up, the salon moves ONBOARDING → PENDING_APPROVAL → ACTIVE.<br>7. The onboarding case is linked to the tenant. |
| 2 | Owner setup | 1. Business details, the salon zone (written to the branch) and NJ tax of 6.625 %.<br>2. Store hours for 7 days.<br>3. RBAC: the receptionist cannot change tax.<br>4. Receptionist and manager invited **by the owner** (POS → Team → Invite staff, `POST /pos/access/invitations`), then accepted; both invitations audited against the salon; the receptionist cannot invite (403).<br>5. Menu: Gel $45 (60 %), Pedicure $60 (50 %), Acrylic $70 (55 %), and the Nail Art add-on $15 (50 %) in "Add-ons".<br>6. Lisa, Mary and Anna hired on the POS: invite → accept → skills → services → schedule → clock PIN → Tech App sign-in.<br>7. Anna gets 65 % on Acrylic using the Super Admin's one-time code. Without the code the change is refused (403).<br>8. CardPointe gateway set up and its test connection passes.<br>9. Customer display paired.<br>10. Inventory and recipe set up.<br>11. Go Check-In kiosk provisioned and switched on. |
| 3 | Day opens | 1. Fair Turn package switched on, set to RECOMMEND_AND_CONFIRM.<br>2. Clock-in by PIN on the kiosk: a wrong PIN is refused, and the technicians join the rotation in order.<br>3. Kiosk walk-ins Jenny (gel + nail art) and Kim (pedicure).<br>4. Fair Turn recommends Lisa for Jenny and Mary for Kim, and the desk confirms each.<br>5. OTP for online booking cannot be switched on without Twilio Verify (409).<br>6. Online booking: Nina books Anna for an acrylic set; the request is idempotent.<br>7. The AI receptionist books Vera's pedicure, with times in the salon zone.<br>8. Nina's appointment is checked in.<br>9. Olivia's visit is split across two technicians.<br>10. **Screen:** POS Queue and Check-In. |
| 4 | Service + checkout | 1. Each part goes accept → start → Service Done in the Tech App. Mary adds nail art during the service.<br>2. Jenny: the receptionist's discount is refused (403) and the manager applies $6. She adds a $10 tip and buys a $50 gift card. **Screen:** POS Checkout and the customer display both show **$119.61**. She pays by card through CardPointe, once; a retry replays the same payment. The display clears (**screen**). The SMS receipt is "simulated".<br>3. Kim: a membership with 20 % off pedicures is applied automatically; she pays cash.<br>4. Olivia: a $20 tip; the $50 gift card plus a card pay the bill.<br>5. The tip split shows no lost cent. |
| 5 | Tap to Pay | 1. The Super Admin onboards Tap to Pay; the manager registers her phone and the owner approves it.<br>2. The manager claims Nina's ticket. While the phone holds the claim, the front desk cannot take cash.<br>3. A retail Cuticle Oil is added on the phone.<br>4. $20 cash plus $70.05 Tap to Pay. The capture result is posted twice but charges once. |
| 6 | Refund, inventory, loyalty | 1. The owner refunds Jenny's $15 nail art: one CardPointe refund. The receptionist's refund is refused (403).<br>2. Lisa's commission reversal is written as an adjustment.<br>3. Inventory: oil 10 → 9; polish 6 → 4 by the recipe.<br>4. Loyalty: 1 point per dollar, exactly once, net of the refund. |
| 7 | End of day | 1. Reconciliation, shown below.<br>2. Cash drawer.<br>3. Time clock: PIN clock-outs, nobody left clocked in.<br>4. Payroll: period → prepare → step-up → approve (hash) → CSV export → pay → database lock.<br>5. A refund after the lock becomes a next-period adjustment.<br>6. The Tech App and Owner app payroll match. |
| 8 | Screens at close | 1. Lisa's Tech App earnings.<br>2. Owner dashboard and the Owner Reports tab.<br>3. POS Reports. |
| 9 | API log | The API logged no unexpected errors during the day. |

## The numbers (one run; every figure is cross-checked)

| What | Value | Equal to |
|---|---|---|
| Collected: card + cash + gift card | **$411.25** | Payments report mix; Owner app "Today's revenue" |
| Gross sales: services $310.00 + retail $12.00 | $322.00 | — |
| Discounts | $18.00 | Manager's $6.00 + membership $12.00 |
| Tax (6.625 %) | $20.14 | — |
| Tips | $30.00 | Snapshot $30.00 = tips report = commission report |
| Card surcharge | $7.11 | Sum of `payments.surcharge_cents` |
| Gift cards sold | $50.00 | — |

**Identity check:** 322.00 − 18.00 + 20.14 + 30.00 + 7.11 + 50.00 = **411.25**, which equals the amount collected.

**Payroll basis:** report service sales $310.00 equals the compensation snapshot gross of $310.00.

**Commission:**

| Technician | Commission | Tips | Tech App |
|---|---|---|---|
| Lisa | $58.05 − $6.75 refund reversal = $51.30 | $20.00 | $71.30 |
| Mary | $61.50 | $10.00 | Same |
| Anna | $45.50 (65 % Acrylic rule) | — | Same |
| **Total commission** | **$158.30** | | Owner finance $158.30 |

**Cash drawer:** expected $87.17. That is Kim's $67.17 plus the $20.00 cash in Nina's Tap to Pay split; the split's cash status is "partial".

**Payroll period (paid and locked):**

| Technician | Payable |
|---|---|
| Mary | $71.50 |
| Lisa | $71.30, including the −$6.75 adjustment |
| Anna | $45.50 |
| **Total** | **$188.30** — Owner app $188.30; Mary's Tech App shows paid $71.50 with $0 outstanding |

**Refund after the lock:** Kim's $12.00 refund creates a −$6.30 adjustment for Mary in the **next** period, linked to the locked one. The locked lines are byte-for-byte unchanged.

## Screenshots (Chromium; real built apps; session cookies from the same sessions that did the work)

Saved as `pilot-NN-*.png` in `PILOT_SHOTS`. They are not committed; they are regenerated by each run.

| # | Name | Content |
|---|---|---|
| 01 | pos-queue | Receptionist's queue with Jenny and Kim |
| 02 | pos-check-in | Check-In screen |
| 03 | pos-checkout-jenny | Jenny's checkout workspace, Total Due $119.61 |
| 04 | customer-display-totals | 23-inch display, "Hi Jenny" with the line items, TOTAL DUE $119.61 and the tip prompt |
| 05 | customer-display-cleared | Display back to the check-in screen |
| 06 | tech-app-earnings-lisa | Phone-sized Tech App: $71.30; Services $58.05; Tips $20.00; Adjustments −$6.75 (now written sign-first by the shared formatter) |
| 07 | owner-app-dashboard | Today's Revenue $411.25; 4 services |
| 08 | owner-app-reports | Owner app Reports tab, total revenue $411 |
| 09 | pos-reports | Gross $322.00; Net $304.00; Tax $20.14; Surcharge $7.11; Refunds $27.00; Average rating "—" |

## Findings and fixes

Each fix has a test that failed before it and passes after it, and the pilot check is now green. Severity runs from P0 (highest) to P3.

| ID | Sev | Where | Found by | Fix and test |
|---|---|---|---|---|
| P-1 | P1 | `apps/api/scripts/seed.ts` | Onboarding: the Super Admin had no platform role, so the Super Admin APIs refused it | Seed sets PLATFORM_SUPER_ADMIN and repairs a NULL role |
| P-2 | P1 | `tenant_applications` CHECK; super-admin repository | Approve "succeeded", but the status never changed: the CHECK was too narrow and the error was swallowed | Migration `662_tenant_applications_lifecycle_statuses.sql`; no more swallowed error. `application-status-check.pgtest` (20 tests) |
| P-3 | P2 | super-admin onboarding | The onboarding case was never linked to the tenant it produced | `OnboardingService.linkTenant`, called from `markApplicationConverted`. +1 lifecycle test |
| P-4 | P2 | tenants settings | The business-branch zone was saved but never written to `branches.timezone` | Write-through, IANA validation, cache cleared. `business-branch-timezone.pgtest` (2 tests) |
| P-5 | P1 money | workforce technicians | The POS technician commission edit spent the Super Admin code, answered 200, and payroll ignored it | The edit now authors the engine's Technician / Technician+Service / Technician+Category rules. `technician-commission-rules.pgtest` (6 tests) |
| P-8 | P1 | ai voice-booking | The AI receptionist read the wrong settings category, so it used default hours and the New York zone; booked times were off by the zone difference | Reads the saved store hours and the branch zone. `voice-branch-info.pgtest` (3 tests) |
| P-9 | P1 | queue tech | A one-technician visit had no ticket until Service Done, so the Tech App could not add an add-on during the service | The ticket is created at start. +1 shared-visit pgtest |
| P-10 | P2 | queue serving | Literal "Add-on" checks rejected an "Add-ons" category | `isAddOnCategory`. `serving-addon-category` (4 tests) |
| P-11 | P2 | pos-web Checkout | The receipt note always said "sent" | Honest per-channel note. +1 POSCheckoutScreen test |
| P-12 | P1 money | queue visit-ticket | Lines had a NULL category, so membership benefits and category rules never applied | `category_snapshot` is set and passed to the resolver. `visit-ticket-category.pgtest` |
| P-13 | P2 | queue `ServingModule` | Retail sold on the floor never moved stock (inventory port missing) | Imports `InventoryModule`. `serving-module-inventory` test |
| P-16 | P1 | checkout | The live card path recorded no surcharge on the payment | `claimPayment` carries `surchargeCents`. `checkout-card-surcharge-recorded` test |
| P-17 | P1 | checkout | Owner finance showed $0 revenue because ticket final totals were never stamped | `setFinalTotals` in `afterPaid`. `checkout-final-totals` test |
| P-18 | P1 | reports | POS Reports did not reconcile (tax, tips, surcharge, products wrong) and showed invented rates and statuses | Real ticket figures, snapshot tips, tenant rates, gateway status. `reports-reconcile.pgtest` |
| P-19 | P2 | checkout cash drawer | The register's expected cash excluded "partial" cash, such as the cash part of a Tap to Pay split | Uses `REVENUE_BEARING_STATUSES`. `cash-drawer-split-cash.pgtest` |
| P-20 | P2 | analytics owner | Owner app payroll dates came back as "Thu Oct 15 2026 00:00:00 GMT…" | `ymdOfDate`. `owner-payroll-dates` (2 tests) |
| P-21 | P1 | workforce commission-report | "Today" and "Month" used the UTC date. A salon east of UTC — or any US salon after about 8 pm — saw $0 at close while payroll and the Tech App showed the day | The salon's business date (`salonToday`). `commission-report-salon-day` (3 tests) |
| P-22 | P2 | pos-web Checkout | The totals panel left out the card surcharge, so its lines did not add up, and an unpaid total read "Total Paid" | Surcharge line added; "Total Due" until paid. +1 POSCheckoutScreen test |
| P-23 | P2 | reports | POS Reports showed "Average rating 4.8" with no reviews, a +11 % trend against an invented previous period, and 1/1 bookings per chart day | Removed; the screen shows "—". `reports-reconcile` test extended |
| P-11b | P2 | communications / notifications (sender selection) | The mock SMS / e-mail senders ran in any `NODE_ENV`; the ledger said "sent" and the SMS meter was charged | One selection (`packages/notifications` `smsSenderFromEnv` / `messagingEmailSenderFromEnv`) used by all 7 factories: production never takes a mock — an unconfigured channel is refused as `blocked / not_configured`, never sent, never metered; a forced mock (`MESSAGING_MOCK_SENDERS`) is a production startup refusal; outside production the mock's rows are `simulated` (migration 663), unmetered and not usage. `sender-selection.test` (4), `sender-not-configured.vitest` (3), checkout receipt (+2), production-config (+1) |
| P-24 | P3 | tech-web (and every `centsToUsd` user) | The Tech App showed "$-6.75" | The shared formatter writes negatives sign-first, "−$6.75"; pos-web / admin-web membership money helpers moved onto it. `tech-money.test` (1), money display rules updated |
| P-25 | P3 | tenants settings | `saveCategory` swallowed a failed write and the save answered 200 | The write error propagates; the POS Settings screen shows it and no audit row claims it. +1 `business-branch-timezone.pgtest` |
| P-26 | P3 | analytics owner | The Owner app's date chip showed the UTC date of the salon's start-of-day (a day behind east of UTC) | The dashboard's `date` is the salon's business date; the booking overview carries `businessDateFrom` for its chip. `owner-dashboard-business-date` (3) |
| P-27 | P3 | identity / super-admin invitation path, pos-web Team | Only the Super Admin could invite front-desk staff | The salon invites RECEPTION / FRONT_DESK / MANAGER itself through the same invitation (`roles.manage`, own salon only, never above the inviter's own permissions, audited against the salon); POS Team → Invite staff. `salon-staff-invite.vitest` (6), POSTeamPermissionsScreen (+2), pilot check |
| P-28 | P3 | analytics overview / dashboard | `completedServices` counted completed appointments | Counts service lines completed on the salon's day (add-ons count, removed lines do not). +1 `analytics-local-day.pgtest` |
| P-29 | P3 | analytics owner | Owner "average ticket" divided everything collected (tax, tips, gift cards); POS reports divide sales | Sales ÷ paid tickets on the dashboard, branch list, branch detail and finance, labelled "(sales)". `owner-financial-kpis` (+1, 2 re-pinned); pilot check: owner $80.50 = POS $80.50 |
| SW-04 | P3 | workforce compensation | `GET /owner/compensation/reports/platform` was reachable by no role and called by nothing | Route, its gate, service method, port method and repository query removed; generators re-run |
| SW-19 | P3 | queue check-in | Every walk-in looked its temporary `ci_<n>` id up in a uuid column (swallowed error) | Only a uuid is looked up. `check-in-temp-id.vitest` (2) |
| SW-21 | P3 | workforce tech-profile, queue technician help, super-admin transfer preflight | A missing query id reached PostgreSQL as `''` | Checked first (`requireUuidId` / `isUuidId` in `packages/observability`): same 400 INVALID_ID / 404; the sweep's allow-list for it is gone. 3 tests (4 cases) |

**Not fixed — decisions for Kevin**

- **P-6 (P2):** two add-on models exist: the `service_add_ons` table and services in an "Add-ons" category. The pilot uses the category model.
- **P-7 (P2):** the kiosk offers an add-on to any technician, but queue eligibility needs the technician to be mapped to the add-on service. An attempt to align the two was reverted because it contradicted the eligibility authority.
- **P-14 (P2):** loyalty points also count gift-card value. Loyalty ignores "partial" cash.
- **P-15 (P3):** recipes are consumed only when someone records them; there is no automatic deduction at Service Done.
- **SW-18 (P2, sweep):** two Super Admin scheduled-report stores; which one is canonical decides how they are scheduled.

## Generators and gates (post-pilot fix run, Oct 13 2026)

- Run: `openapi.mjs --manifest`, `openapi.mjs`, `role-matrix.mjs --write`, `generate-api-inventory.mjs`, `check-api-contract.mjs --write-types-baseline`, `audit-state-transitions.mjs --write-vocab` (migration 663), `audit-unreached-routes.js --update` (SW-04 and five other routes came off the ledger).
- `node tooling/ci/run-gates.mjs`: all 47 gates + 13 audits pass.
- Still for the lead: the database docs / migration inventory for migrations 662–663.
- Leads seen in the PostgreSQL log during the re-run (pre-existing, not fixed here): `settings_audit_logs.entity_id` NULL on settings saves (the settings audit row is lost, swallowed), a `notification_delivery_logs` status CHECK violation, a `line_8001` id reaching a uuid column, and `clock_out_at` (a column that does not exist).
