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
- Registry: 71 pages, 559 modules. Preservation matrix: 559 rows, 0 missing.

## Not built: the addenda's "additional recommendations"

Each addendum ends with 4–16 optional recommendations, about 190 in all (copilot R1–R10, referral liability preview,
template Smart Variable Assistant, …). Batch 2 set the rule (Kevin's "you pick best"): build one only where a wrong
number costs money and nothing else checks it.

Copilot's two P0 recommendations are already covered:

- **R1:** the activity log has pending / succeeded / failed / unknown states, and the status strip shows failed actions in the last 24 h.
- **R2:** profile menu → **Check this screen**.

The rest are listed as a decision.
- All 72 registered pages at the three SUNMI sizes, EN + VI: 432/432.
- Gates: 57 + 25 audits pass. POS suite: 386 files / 2120 tests pass. No module or API source changed in this batch
  (only screens, CSS, e2e tooling and the pilot script), so the module / API suites were not re-run; they last passed on
  `14cdcbd5`.
