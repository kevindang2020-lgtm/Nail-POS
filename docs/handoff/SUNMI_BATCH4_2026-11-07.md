# SUNMI batch 4: AI, marketing, notifications, phone numbers, top bar, large salon (Nov 7 2026)

Kevin sent 20 PDFs. Each is a SUNMI FLEX 3 addendum (19–26 pages) placed in front of an original guide. The original
guides were built Oct 29 – Nov 3. Their P0 items are already in the code, and I re-checked each one this session:

- AI Center: the 0 Active / 11 Trial / 11 Running count is reconciled, and ended trials can no longer run.
- Birthdays: month / day matching through birthday-core.
- Notifications: failed sends get a diagnosis.
- Retention: Never Visited is its own group, separate from At Risk.
- Deals: the technician discount cap and approvals.
- Templates: legacy variables still work.
- Referral: the liability note.

Every addendum allows the page to scroll down and forbids sideways scroll, CSS scale, forced zoom and removing modules.

## Pages certified (module registry, `scroll: 'page'`)

| Key | Route | Guide |
|---|---|---|
| command-center | /tenant/ai/command-center | AI_Command_Center (8 KPIs, 15 assistants, P0 reconcile panel) |
| ai-receptionist | /tenant/ai/receptionist | AI_Receptionist (5 KPIs, 8-step checklist, provider readiness) |
| ai-front-desk | /tenant/ai/receptionist/front-desk | AI_Front_Desk (All/Draft/Paused/Archived, Create Agent wizard, Live Routing Monitor) |
| copilot | /tenant/ai/copilot | Reception_Copilot (lookup, openings, conflicts, cancel / text / book / reschedule, workspace) |
| reviews | /tenant/marketing/reviews | Reviews__Reputation |
| referrals | /tenant/marketing/referrals | Referral_Program |
| win-back | /tenant/marketing/win-back | Customer_Retention__Win-Back (same screen as /tenant/customers/retention) |
| birthdays | /tenant/marketing/birthdays | BIRTHDAY_CAMPAIGNS |
| segments | /tenant/marketing/segments | Customer_Segments |
| coupons | /tenant/marketing/coupons | Coupons__Promotions (6 KPIs, Library / Redemptions / Health) |
| deals | /tenant/marketing/deals | Deals__Offers (6 tabs) |
| promotions | /tenant/marketing/promotions | Promotions_Management (5 KPIs, 5 tabs) |
| campaigns | /tenant/marketing/campaigns (+ /sms) | Campaign_Center (7 quick actions) |
| marketing | /tenant/marketing | Marketing_Growth (5 quick actions) |
| templates | /tenant/communications/templates | MESSAGE_TEMPLATES__AUTOMATION |
| notifications | /tenant/communications/notifications | Customer_Notifications |
| phone-management | /tenant/customers/phone-management | PHONE_NUMBER_MANAGEMENT_4 |

- **Global Loyalty Rewards:** this is the `loyalty-network` page from batch 3, re-checked.
- **POS Top-Bar Announcements:** this is the shared header. Its e2e (`tooling/e2e/pos-announcement-layout.mjs`) now also runs at the SUNMI sizes 1920×1032 / 952 / 945.
- **200-Technician Large Salon:** the Booking board proof inside the pilot day now runs at 1920×945. The size can be changed with `PILOT_BOARD_VIEWPORT=WxH`, for example to a device's reported size.

## Fixes found by this batch

1. **Retention & Win-Back broke at the smaller sizes (1536 → 1280).**
   - Cause:
     - The Contacted / Delivered strip was a seventh child of the page's grid, but the grid had only six rows. The table's flexible row landed on the period toolbar, so the segment chips sat in a tall empty band.
     - Nine header actions squeezed the title to nothing, so it overlapped the buttons.
   - Fix (CSS only, scoped to `.rt2`): one grid row per child; the header wraps; segment chips wrap at ≤ 1700 px.
   - Result: 28/28 at 1920×945 / 952 / 1032 and 1536×864 / 1440×900 / 1366×768 / 1280×720, in EN + VI.
2. **The pilot day could no longer take a card payment.**
   - Cause: since the Fiserv host guard (§5.3), a sandbox merchant may only name a UAT-marked host. The pilot's loopback host `pilot-loopback.cardconnect.com` read as a production host, so phase 2 refused it. 22 card and money checks then failed in a chain.
   - Fix: the host is now `pilot-loopback-uat.cardconnect.com`. The guard itself is correct and unchanged.
   - Result: phases 0–10 pass 104/104; phase 11 (large salon) passes 79/79.
3. **Test ids added (no change to behaviour)**, so the registry can count and find each module:
   - AI Center: 13 sections and buttons.
   - Copilot: 7 sections.
   - Coupons / Deals: tab strips.

## Verification (this session)

- Batch 4 at 1920×945 / 952 / 1032, EN + VI: 102/102.
- Batch 4 at 1536×864, 1440×900, 1366×768, 1280×720: 136/136 after the retention fix.
- Top-bar announcement e2e: 76/76, including the three SUNMI sizes.
- Pilot day (fresh PG16 database, 779 migrations):
  - phases 0–10: 104/104;
  - large salon: 79/79, including the SUNMI FIT check — the board at 1920×945 with 200 technicians, no sideways scroll, 12 columns of at least 170 px, page strip, Add Walk-In and New Booking in view.
- Registry: 71 pages, 560 modules (incl. the referral liability strip). Preservation matrix: 560 rows, 0 missing.
- All 72 registered pages at the three SUNMI sizes, EN + VI: 432/432.
- Gates: 57 + 25 audits pass. POS suite: see the commit. Customers module referral tests: 34 pass. The only server change
  is the referral summary's read-only `liability` block (run on real PG16 through the live screen check).

## The addenda's "additional recommendations": triage (Nov 7, Kevin: "continue")

The addenda end with 4–16 optional recommendations each, about 190 in all. I used the batch-2 rule (Kevin's "you pick
best"): build a recommendation only where a wrong number costs money, or safety is at stake, and nothing already checks
it. Here is every money / safety recommendation and where it stands:

| Recommendation (guide) | Status |
|---|---|
| **Referral P0 Financial Liability Preview** | **BUILT.** `GET /pos/referral-program/summary` now returns `liability`, read from the reward and voucher rows. It covers: points approved or waiting but not issued; cash rewards not paid (blocked = owed, because no payout provider is approved); vouchers issued but not redeemed, plus those expiring within 30 days; and vouchers that open after the friend's paid first visit. A "Still owed" strip sits above the KPIs. pgtest T11 / T15 assertions; a screen test; real PG16 run on the live stack (6/6 + 8/8). VI text marked DRAFT. |
| Referral P0 Integrity & Duplicate Reward Checker | Already built. Referral health covers duplicate codes, orphan codes, referred twice, self-referral, a reward not matching the ledger, ticket linkage and failed issuance. |
| AI Center Critical 1 / 2: entitlement auditor, cost-to-outcome | Already built: the P0 reconcile panel, the gate check (Check AI System) and AI Usage cost lines. |
| Coupons 03 / Deals 04: discount exposure | Already built: coupon exposure (max discount if repeated) and deal exposure (per use / max total) on approvals. |
| Coupons 04 / Deals 05: duplicate redemption | Already built: idempotent checkout redemption and the deal / coupon health checks. |
| Large salon 14: payroll accuracy checker | Already built: payroll validation (reconciliation drift, duplicate snapshot keys, deduction over cap, missing rules, open time entries), the per-technician evidence and the preparation report. |
| Copilot R1 (P0): action accuracy | Already built: activity states pending / succeeded / failed / unknown, and failed actions in the last 24 h on the status strip. |
| Copilot R2 (P0) and every "layout / screen-fit checker" | Already built: profile menu → **Check this screen** on every page. |
| Phone Number 1: verification health checker | Already built: Booking Phone Verification → Check Verification System. |
| Reviews 1 / Marketing 2: accuracy dashboards | Already built: the Reviews and Marketing health checks. |

The rest are product features with no money or safety risk: saved audiences, heatmaps, comparisons, sandboxes, ROI
reports, presets and so on. They stay unbuilt and are listed for Kevin. Nothing in them is required by the guides, which
call them "additive recommendations".

## Found while re-running the suites after midnight (Nov 8, 00:30 New York)

Four workforce pgtests failed in the window between local midnight and about 2 AM:

- Live Technician Schedule activity;
- Team Management profile tabs;
- Team Performance D1;
- Tech Queue LIVE / HISTORY.

Their fixtures put events "1–2 hours ago" and then asserted **today**, so before 2 AM those events fell on yesterday.
The product code is right: periods are salon-local days. The fixtures are now pinned to the local day:

- `greatest(now() − interval, start of the local day + n s)`, which keeps the order;
- Tech Queue runs in an `Etc/GMT±N` zone where it is about noon.

Verified now (00:30 local) and with the clock shifted +7 h / +12 h / +15 h / +19 h (a test-only Date shim); the
workforce suite passes 1302/1302.

The API suite (run after midnight) had one more date failure, and this one was a **product bug**. Backup Center's
`midnightCheckpointStatus(now)` measured its 3-day window from the database's `now()` instead of the `now` it was asked
about, so it reported a missed midnight checkpoint for a past time once the real date moved on. The window is now
measured from `now` (real PG16 query run). Backup Center tests pass 32/32; the rest of that API run passed: 3278 tests,
1 failure (this one, fixed and re-run on its own).


### Full re-run at HEAD in the overnight window (Nov 8, 01:20–02:40 New York)

- API suite: 3279 / 3279 pass, including the Backup Center fix.
- Module suites: every suite passed except two more clock-window fixtures, both now fixed:
  - **Deals Discounts screen:** redemptions "2 h / 1 h / 10 min ago" were asserted as today. They are now pinned to the local day.
  - **Customer Timeline SD-02:** this test was already pinned to "service done + 1 min". But "completed" is dated by the payment, 10 minutes later, so at about 2 AM the pin and the event fell on different days. It now pins to exactly the later of the two. Checked at 06:59:50Z, 06:59:59Z, 07:00:00Z and 07:00:30Z (the midnight crossing), and at 12:00Z and 20:00Z.
- Customers suite: 500 pass. Workforce: 1302 pass. Gates: 57 + 25 audits.
