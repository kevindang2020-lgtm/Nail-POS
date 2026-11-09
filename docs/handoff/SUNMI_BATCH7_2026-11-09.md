# SUNMI batch 7: customers, Three Ways to Pay, approvals, community, team, AI settings (Nov 9 2026)

Kevin sent 20 PDFs on Nov 9. Each one is a SUNMI FLEX 3 (27-inch, 1920 × 1080 landscape) addendum. It sits in front of an
original guide. The rules are the same as in batch 6:

- No module is removed.
- No CSS scale, forced zoom or sideways page scroll.
- Long content scrolls vertically.
- Server truth only. Payments stay fail-closed.

The batch-7 screen harness set is `MODULE_SET=batch7`, with 19 pages.

## What was built or fixed, guide by guide

| Guide | Result |
|---|---|
| Customer_Notes_6 | **New workspace:** 4 cards, search, category and review filters, which-date plus presets and From–To, a notes table with 10 / 25 / 50 / 100 rows, a details view, Review & Accuracy for safety notes (confirm or needs-correction, keyed to the sha256 of the text read) and a Check Customer Notes System. The original search and editor are kept: the search moves to the header and the editor opens as a dialog, still with its offline DRAFT. Migration 843 adds `customer_note_reviews` and `customers.notes_updated_at`. |
| Appointment_History | **New salon-wide workspace:** 6 cards (Appointments, Upcoming, Completed, Canceled, No-shows, Rescheduled) over the table's filters; search; status; technician; which date plus presets and range; sort; pages; details; a check. The original per-customer history with money details is kept as a dialog, reached from the header search and from "Customer history" in any appointment's details. |
| Three_Ways_To_Pay | **New** `GET /pos/payment-channels` and `POST /pos/payment-channels/check`, both read-only (details below). Checkout gains a **Three Ways to Pay** button, which opens three equal channel cards. |
| Customer_Profiles | **New** browse workspace: 3 metrics (Total, Recently Active, Needs Review), view modes All / Recently Active / Newly Added / Needs Review, which date, sort, a four-across card grid and numbered pages. The **Customer 360 Quick View** has 4 equal tabs (Overview, Loyalty & Membership, Visits, Notes & Preferences) plus Message, + Booking, Full View and Close. Full View is the original profile page, unchanged. |
| Customer_Profile_Global_Loyalty_Protection | Quick View tabs are four equal touch zones. The Loyalty tab uses the protected positive-only Request Bonus Points (owner approves). No direct balance edit exists; it was removed Nov 4. |
| Customer_Timeline | The Customer 360 summary is now **4 equal cards** (Customer, Last visit, Upcoming, Benefits); every earlier fact is kept inside them. Customer matches stay beside the history (1/3 \| 2/3) after a customer opens. The empty state now has search-first guidance. Registered as a scroll page. |
| Gift_Cards | Branch Liability & Clearing **context on the page**: each branch's net position, the period and a link to the full table with From / To / Update. 5 KPIs and the tabs are unchanged. |
| Safety_Community | Verified overview cards per role: Active advisories, Following, My drafts, Awaiting approval, Private incidents. A read-only Health Check and a Refresh were added. The 6 module tabs are equal cells. The feed shows 25 per page with numbered pages. |
| Approvals_Management | **Four summary cards:** Pending Decisions, Awaiting Owner, Urgent and Completed. The definitions are below. The 5 tabs are unchanged. |
| Checkout_Upsell_Assistant_Settings | Two **equal-height** configuration cards (seven switches \| three limits). The 4 status tiles share the row. Registered as a scroll page. |
| Individual_Technician_Tipping | On the customer display, the technician tip cards are **equal-size cards in a grid** (1 → 2 → 3 across by width) that scroll inside when there are many. |
| AI_Usage_Limits | The original three labels are restored and put first: **Active AI Add-ons, Monthly AI Cost, Available**. Trials / Pending stays as the fourth card. |
| Receipt_Document_Recognition | The header's **Manual Entry** action was added. 6 KPIs and the 10 (+1) tabs were already there. |
| AI_Scheduling_Optimizer_ | **How this works** was added (5 plain steps, no data). 4 counters and 10 tabs were already there. |
| Customer_AI_Settings_6 | The strip is now **three equal status cards**. The salon switch sits with the effective state. |
| Refer_A_Friend, Technician_Profile_Team, AI_Review_and_Reputation, Review_Reputation_Settings, Churn_Watch | Checked against their guides. All required modules are present: referrals 6 KPIs, 2 equal panels and all areas reachable; team 8 KPIs and a 10-tab employee drawer; reputation 6 KPIs and 8 tabs; settings 8 settings and 3 views; churn 6 KPIs. No change needed. |

## Three Ways to Pay: safety

- **Read-only.** The endpoints never charge, authorize, ping a provider, send a prompt, save a token, enroll a merchant or
  change a surcharge.
- **The three cards are always returned and always shown.** States: ready (UAT is shown as a **test lane, never
  "certified"**), setup_required, provider_pending, blocked or unavailable. Each comes with a reason code and remediation
  text.
- **No new money path.** The pay actions are the existing ones:
  - "Use Clover Compact" hands back to the workspace's existing card button (same terminal flow, locks, attempt key and
    verify-on-unknown).
  - "Send to <phone>" is the existing send-to-device push.
  - "Send to / Verify Customer App" is the existing send-app-payment / verify-app-payment.
- **Cross-channel holds.** The open ticket's status comes from the canonical ledger: payments, payment_attempts,
  checkout_locks and payment_intents. While a payment is moving, unknown or settled, every channel's action is held
  (`payment_in_progress` / `verify_first` / `ticket_paid`). The server's locks and idempotency refuse a second tender
  anyway. A paid ticket owes 0, and the card-fee remainder is never shown as due.
- **No card entry in the Web POS.** A test asserts there is no card-number or CVV field.
- **Native iPhone code untouched.** A read-only audit found the historical `sbx_tap_*` fake approval already removed from
  `apps/manager-pay-web/src/native/tapToPay.ts` (Nov 4). The 9-prefixed fake token is already gone from
  `customer-web PaymentMethodsScreen`, which now uses a hosted iFrame only.
- **Check Three Payment Channels** reports Passed, Warning, Failed, Insufficient Data, Unavailable or Provider Approval
  Pending. It covers: unknown or stuck payments, app payments to verify, each lane, the terminal ping on record, the live
  mode (`PRODUCTION_PAYMENTS_DISABLED` until Fiserv certification) and the surcharge policy (surcharge on without provider
  enrollment → Warning). The screen-fit line is measured on the device. It never shows a generic "all working".

## Definitions (Approvals cards)

| Card | Definition |
|---|---|
| Pending Decisions | The server's pending total for this person. |
| Awaiting Owner | Pending requests this person cannot decide because they need a higher approver (`whyNot` = over_your_limit or missing_permission). |
| Urgent | Pending requests that expire within 24 hours. |
| Completed | Executed requests. |

Awaiting Owner and Urgent are counted over the newest 100 pending (the server's page cap). A "+" is shown when there are
more.

## Pages certified (module registry)

| Key | Route | Status |
|---|---|---|
| cust-notes | /tenant/customers/notes | Registered |
| appt-history | /tenant/customers/appointment-history | Registered |
| cust-profiles | /tenant/customers/profiles | Registered |
| cust-timeline | /tenant/ai/customer-profile/timeline | Registered |
| upsell-settings | /tenant/ai/checkout-upsell/settings | Registered |
| community | /community | Registered |
| approvals | /approvals | Registered |
| checkout | /checkout | Gained `checkout-three-ways` |
| gift-cards | /tenant/customers/gift-cards | Gained `gc-clearing` |

## Verification (all run in this session)

| Check | Result |
|---|---|
| Screen harness, `MODULE_SET=batch7` | 114/114 |
| Screen harness, `MODULE_SET=all` (batches 2–7) | 726/726 (primary 242/242) |
| POS vitest | 390 files, 2148 tests |
| Module suites | All pass (checkout 1071, customers 514, …) |
| API | 3279 tests (the role matrix was regenerated for the 11 new routes) |
| New pgtests | Payment channels 9, customer notes 7, appointment history 6 |
| Gates | All 57 gates + 25 audits pass |
| Lint | 0 / 0 |
| Typecheck | Clean |
| `security-audit --full` | 32 passed, 0 failed, 4 not verified (processor credentials, production infra, Twilio live, physical devices — unchanged) |
| Live pilot day on a freshly migrated DB | 242/242 |
| Customer display vitest | 205 |

Gate fixes along the way:

- **Saved-card count read.** It moved from raw SQL to the query builder. The SQL column checker does not see migration 837's `revoked_at`, and a pgtest now covers the count.
- **Provider names.** No provider host-like strings remain in the new code (the architecture gate). The device surface names now come from `@aipowersalon/payments`.
- **Regenerated:** route domains, return types, the OpenAPI manifest, the strict-bodies typeproof, the attack surface, the role matrix, the db-ownership registry, the VI sheet and the preservation matrix.

## Decisions for Kevin

1. **Customer App channel = Skip-the-Line checkout.** The "Customer App — Saved card / Pay Now" card reads the existing
   Skip-the-Line settings and hosted tokenizer. If Skip-the-Line is off, the card shows "Setup needed" with the reason.
2. **"Needs Review" on Customer Profiles = shared phone or email** (the Duplicate Review signal from Customer Search).
   There is no other verified "needs review" definition in the data.
3. **Message in the Quick View opens Messages.** That screen has no per-customer deep link yet.
4. **Vietnamese:** every new VI string is marked DRAFT in `docs/handoff/VI_DRAFT_REVIEW.md` for your review, including the
   three renamed AI Usage labels.
