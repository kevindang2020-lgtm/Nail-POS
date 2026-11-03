# Build queue — guides uploaded Nov 3 2026

Every guide Kevin uploaded on Nov 3 2026, in the order received. Status: QUEUED → AUDITED → BUILDING → BUILT (commit). A guide is BUILT only when its gaps from the audit are closed and tested; anything deliberately not built is listed under "Not built" with the reason.

## Batch A (10:33) — 20 AI guides
| # | Guide | Route | Status |
|---|---|---|---|
| A1 | AI Center (refreshed) | /tenant/ai/command-center | BUILT — P0 counts reconciled with the AI gate, honest KPIs, Check AI System (7a1cec0, 9192e30); directory in 2–3 columns, every card opens the 6-tab details overlay, Usage & history opens the activity log in place |
| A2 | AI Business Alerts (newer) | /tenant/ai/business/alerts | BUILT (core) — edit / duplicate / per-rule history, quarter & year, failed evaluations recorded, archive; incidents, scheduler and notifications listed as not built in docs/ai/AI_BUSINESS_REPORTS_AND_ALERTS.md |
| A3 | AI Branch Comparison | /tenant/ai/business/branches | BUILT (core) — see docs/ai/AI_BRANCH_COMPARISON.md (health checker, fair scorecard, AI explanation not built) |
| A4 | AI Business Assistant | /tenant/ai/business | BUILT (core) — see docs/ai/AI_BUSINESS_ASSISTANT.md (stored conversation history, extra ranges, record search not built) |
| A5 | AI Scheduling Optimizer | /tenant/ai/scheduling-optimizer | BUILT (gaps) — Yesterday / Last 7 presets, health checks branch-scoped in salon time, per-branch runs, device-day fallback; technician full-day overlay and neighbour preview still open (owner decision in SCHEDULING_OPTIMIZER.md) |
| A6 | AI Queue | /tenant/ai/queue | PARTIAL — salon-day ranges + end day (bb92dd5), free-technicians tile, kept-unassigned counted, failed reads shown, scan needs resolve_alerts; health checker, overlay tabs, search and numbered pages not built |
| A7 | AI Booking Assistant | /tenant/ai/booking | PARTIAL — invented-slots panel removed (220ee29); past usage kept and labelled after cancel; Usage & history on every AI add-on page. The operations center (requests / holds / verification KPIs, activity overlay, 12-group health check) is NOT built: there is no ai-booking backend module yet |
| A8 | AI Reception Copilot | /tenant/ai/reception-copilot | BUILT (fixes) — links, reschedule proposal, waitlist claim, midnight windows, sender check, branch scope, Yesterday, menu gating, error texts; name pickers / URL filters / health 'responsible role' still open |
| A9 | AI Receptionist Settings | /tenant/ai/receptionist/settings | BUILT (core) — versions + history + restore, stale save refused (409), effective source shown, salon fallback, no silent default overwrite, coded errors; NOT built: the live agent reading these settings (shown honestly on the page), consent-script approval, health checker |
| A10 | AI Calls | /tenant/ai/receptionist/calls | BUILT (fixes) — health never green when the receptionist checks fail, pending-code count branch-scoped and 'unknown' on error, per-branch runs, page kept from the URL, ?call= opens a call; NOT built: caller / dialed-number columns, Twilio SID search, extra date bases, call_links table, SSE |
| A11 | AI Calendar | /tenant/ai/receptionist/calendar | BUILT (fixes) — health check survives one failed read (savepoints), per-branch runs, failed-call count branch-scoped, metrics check can warn, no silent New York, overlay reports unreadable sections; open-slot hours and Booking deep-link remain owner decisions (AI_CALENDAR.md) |
| A12 | Business Setup | /tenant/ai/receptionist/business-setup | BUILT (fixes): FAQ request key reuse refused (422 IDEMPOTENCY_KEY_REUSED); technician eligibility limited to branch services; Today/Week/Month/Year presets; device-day today. Not built: FAQ overlay tabs, tags, filters, holiday exceptions, recorded health runs |
| A13 | AI Follow-Ups | /tenant/ai/receptionist/follow-ups | BUILT (fixes): edits without the row version refused (422 VERSION_REQUIRED); overdue alert keyed by due time + reopen count (a moved due time or a reopened task alerts again); Edit details (description, due time) versioned + audited. Earlier: attempts on resolved tasks, escalation per level on task branch, per-branch health reuse. Not built: missed-call / Reception Copilot sources, recommended assignee, hold expiry, notify assigned staff, health history |
| A14 | AI Front Desk | /tenant/ai/receptionist/front-desk | BUILT (fixes): each branch judged by its own latest call (one branch no longer marks others Degraded); directory + summary follow the salon selector; handoffs = real handoffs with transferred / failed split; "booked" = appointments created (holds, cancels, reschedules no longer counted), waiting-for-code shown; calendar today is the device day; dead links fixed earlier. Kept on purpose: "provider agent also linked in another salon" warning (a yes/no safety check, no other-salon data shown). Not built: assigned number / creator search, call search by customer / phone / appointment, call detail overlay, average duration |
| A15 | AI Receptionist | /tenant/ai/receptionist | BUILT (fixes) — one failed read no longer breaks the check, activity search / overlay appointments / control history branch-scoped, no silent New York time zone, voice minutes N/A without calls; NOT built: missed / in-progress statuses, agent / service / duration filters, URL filters, live updates |
| A16 | Reception Copilot (v2) | /tenant/ai/copilot | Same screen as A8 (fixes shared); tabbed workspace and Calls/SMS search scope NOT built |
| A17 | Reviews & Reputation | /tenant/marketing/reviews | BUILT (fixes): KPI strip follows the technician / source filters (scope stated); review overlay no longer shows branch "null"; moderation history staff names joined within the salon only. Not built: assign workflow, communication history tab, first/last name search split, recorded health runs |
| A18 | Referral Program | /tenant/marketing/referrals | BUILT (fixes): a reward waiting for approval shows in Needs review only (was in Qualified too); archived customers refused and staff names salon-scoped (fixed earlier). Not built: branch / eligibility / creator / reviewer filters, more fraud signals, communication tab, recorded health runs |
| A19 | Customer Retention / Win-Back | /tenant/marketing/win-back | BUILT (fixes): search by email; accent-insensitive names ("nguyen" finds "Nguyễn"); every word of a first + last name must match; % and _ are literal. Test fixture made date-proof (failed on the 1st–3rd of a month). Not built: search scopes, service category / technician / spend-band filters, "New" definition change, Add to eligible audience |
| A20 | Birthday Campaigns | /tenant/marketing/birthdays | BUILT (fixes): message / offer / visit KPIs follow the chosen range (customers whose birthday is in it) and the branch; Feb 29 birthdays sort on their celebrated day (Feb 28 / Mar 1 policy); visit association anchored on send time; history branch-scoped (earlier). Not built: more date bases, history dialog search / range / page size, activity / tier / source filters, offer status column, birthday timeline |

## Batch B (10:35) — 18 marketing / communications guides
B1 Customer Segments · B2 Coupons & Promotions · B3 Deals & Offers · B4 Promotions · B5 Campaign Center · B6 Global Loyalty Final Completion · B7 Marketing & Growth · B8 Message Templates · B9 Notifications · B10 Phone Number Management · B11 Booking Phone Verification · B12 Text Messaging Setup · B13 End-of-Day Follow-Ups · B14 Follow-Up Queue · B15 Appointment Reminders · B16 Email · B17 LoyaltyTokens · B18 LoyaltyRules — all AUDITED (B5–B8 audit pending).

## Batch C (10:37) — 13 guides (LoyaltyTokens is an exact repeat of B17)
C1 Loyalty Complete · C2 Communications (updated) · C3 Four Modules · C4 Phone & Messaging combined · C5 Customer Retention (complete) · C6 Team Management · C7 Five Unfinished Features · C8 Technicians · C9 Tech Appointments · C10 Live Technician Schedule · C11 Tech Queue · C12 Commission Report — QUEUED (audits running).

## Batch D (10:40) — 20 guides (Commission Report is an exact repeat of C12)
D1 Team Performance · D2 Services & Products · D3 Service Categories · D4 Service Pricing · D5 Add-Ons · D6 Membership · D7 Discounts · D8 Products · D9 Inventory · D10 Suppliers · D11 Stock Alerts · D12 Stock Alerts – Technician Usage · D13 Payments & Money · D14 Transactions · D15 Cash Drawer · D16 End-of-Day Cash · D17 Refunds & Voids · D18 Split Payments · D19 Tips — QUEUED.

Batch D was sent again at 11:09 (same 20 files; Commission Report again a repeat). Nothing new to queue.

## Build order
1. Wrong-number and money bugs found by the audits (they affect live salons now).
2. Guides in batch order, one at a time; each gets a commit.

## Wrong-number / money / scope bugs found by the audits (fix first)
1. ✅ FIXED — Appointment reminders skip `confirmed` appointments (only `booked` eligible).
2. ✅ FIXED — Loyalty: token purchase reversed/charged back after funding leaves tokens spendable; books check accepts it. (Also: a locked/suspended wallet is reported as a policy block, not "Buy Tokens".)
3. ✅ FIXED — Loyalty: refunds of tip/tax take back points (refund total vs eligible cents); a refund settled before the earning is no longer earned on.
4. ✅ FIXED — `'\D'` inside `sql` templates becomes `D` — phone search in phone center, inbox, templates.
5. ✅ FIXED — Email Delivery Rate drops bounced (failed) emails from the denominator.
6. ✅ FIXED — AI Business "why did revenue change" compares this month with this month.
7. ✅ FIXED — Business alerts: pause/delete not branch-scoped; evaluate uses caller's branch; min sample 0 allowed.
8. ✅ FIXED — Receptionist settings: failed read then save overwrites stored settings with defaults.
9. ✅ FIXED — EOD follow-ups: tech message edit bypasses "Allow tech to edit message = Off".
10. ✅ FIXED — Follow-up queue / EOD "Rebooked" counts cancelled and no-show appointments.
11. ✅ FIXED — Dead links to /tenant/booking, /tenant/queue, /tenant/ai/calls, /tenant/customers/:id fall to /overview.
12. ✅ FIXED — English catalog shows literal … / →.
13. ✅ FIXED — AI Queue decision history drops the whole "to" day.
14. ✅ FIXED — Notification retry: after_fix failures outside SMS skip the fixed-since check.
15. ✅ FIXED — Booking screen help panel asks the model for slots with no schedule data (invented availability).
16. ✅ FIXED — Health-check 30-second reuse shared across branches (calendar, scheduling, copilot, follow-ups, calls).
17. ✅ FIXED — Coupon assistant counts removed tickets; promotion trends count removed lines.
18. ✅ FIXED — Deal approvals show "within policy" with active-deal count forced to 0.
19. ✅ FIXED — Referral check ignores archived customers.
20. ✅ FIXED — Birthday history not branch-scoped.
21. ✅ FIXED — AI follow-ups: attempts recorded on resolved tasks; escalation alert uses caller's branch.

## Progress — Nov 3 afternoon
All 21 wrong-number / money / scope bugs above are fixed, each with a test (commits d197392 … 023d92a), plus four test files that were
failing before this work (front desk tab, notifications Nov-1 case, coupon slow-day case on Tuesdays, voice holds, forecast history).
Next: the guide gaps in batch order — A1 directory, A2–A20, then B, C, D. The audit tables for A and B are in
GUIDE_AUDIT_FINDINGS_2026-11-03.md; batch C/D audits have not been run yet.

## Batch B progress (Nov 3 evening)
- B1 Segments — FIXED: `%` / `_` in e-mail search were wildcards ("%" matched everyone); discard / link-to-campaign audit now in the same transaction as the change; dollar inputs parsed exactly (no float × 100).
- B2 Coupons — FIXED: Check-coupon spend parsed exactly; ticket-number lookup was already branch-scoped; assistant stats / removed tickets fixed earlier. NOT fixed: the assistant's draft deal and its provenance row are two writes (DealsService.createDeal has no transaction hook — needs a repository-port change).
- B3 Deals — FIXED: "technician deals within rules" health check now applies all six rules (min price, redemption cap, new-customer, duration added); approvals active-deal count fixed earlier.
- B4 Promotions — removed lines fixed earlier. NOT built (B1–B4): health-run history tables, coupon branch filter / Open Ticket / export / created-finalized basis / configurable expiring window, deals branch filter / Open Ticket / approvals search, promotions export / View Receipt.
- B9 Notifications — FIXED: at most two resends per original (a resend of a resend was unlimited; new code NOTIFICATION_RETRY_LIMIT); "accepted by provider" no longer shows the creation time as the acceptance time. Earlier: after_fix evidence for every channel.
- B11 Booking Phone Verification — FIXED: the overlay offers Resend only when the number on record matches (same rule as the resend itself); "latest provider outcome" uses the same rule as the error count; a page past the end shows the last page.
- B16 Email — FIXED: a masked viewer cannot search by the e-mail address they are not allowed to see. ("auth_failed → down" reviewed: correct, the issue code keeps the difference.) Earlier: bounced in the delivery denominator, no resend of bounces.
- B13 End-of-Day Follow-Ups — FIXED: a missed 8 PM run (server down) is caught up the next day before 8 PM (only the last missed day, only for a branch that ran the day before). Earlier: tech edit with editing Off, Rebooked excluding cancellations. Found: the old tsx-run "generation-core" harness resolves @aipowersalon/date-time to its .d.ts (two of its cases fail in that runner only); the new behaviour is tested in eod-catch-up.vitest.spec.ts.
- B15 Appointment Reminders — FIXED: a page past the end showed "0 total" (count over() only on returned rows) — now the last real page with the real total. Earlier: confirmed appointments get reminders.
- B17/B18 Loyalty Tokens / Rules — FIXED: the rewards-liability journal lines are platform-level on earn too (earn tagged them to the salon, redeem did not). Earlier: reversed / charged-back purchases, refund eligibility, refund-before-earn, locked wallet message. The 3–4 PGlite race cases in global-rewards fail before and after (known).
- B5–B8 (Campaign Center, Global Loyalty Final Completion, Marketing & Growth, Message Templates): audit still to run.

## Batch D audit bugs (fixing before the D guides — they move stock and money)
- D13–D19 Payments & Money: the P0/P1 list in GUIDE_AUDIT_FINDINGS was already fixed in 6a69195 (net sales counted once, exact balance due, webhook dollars, refunds keep the sale, cash drawer / EOD cash never $0 on failure).
- D9 Inventory — FIXED: Add Stock is one transaction under the stock lock, and a purchase-order id on a manual add is refused (PO_RECEIVE_FROM_PO); the same Service Done line delivered twice at once deducted twice (check and write not under one lock → per-line transaction lock; real-Postgres race test); an expired bottle was used on a client like any other (now never, soonest-expiring first); audit insert failures inside a transaction were swallowed (aborted transaction hidden) → rethrown; report approval swallowed every error → only 4xx refusals. NOT fixed yet: recipe quantities are whole bottles (needs the unit-conversion build), expired bottles still counted in on-hand, branch thresholds, multi-step stock writes not in one transaction, PO receiving / units per purchase unit.
- D1 Team Performance — FIXED: tier filter used the raw average while the row showed the rounded score (4.45 showed "4.5 Excellent" but filtered as Very good); with a branch selected a technician's reviews / services were her whole salon's; the overall score counted archived technicians; search by customer name / phone without customers.view. Test fixture made date-proof (previous-period review fell two months back on the 1st–9th).
- D6 Membership renewals (auto-billing is OFF unless MEMBERSHIP_AUTOBILL_ENABLED) — FIXED: the sweep always charged as attempt 1 (dunning days never grew; the attempt number is now counted per cycle); each cycle is anchored on its original due date (a retry moved the paid period to the retry date and minted a new key every sweep); a charge already recorded under the cycle's key is never sent to the card again; one member's error no longer stops the sweep. NOT fixed yet: credits on renewal, first-period charge, dollar-credit redeem, credit balance math, redeem/reserve race, month-end drift, member-number collisions, demo-data migration 193.
- D2–D8 Catalog / Add-Ons / Discounts — FIXED: catalog sales figures, customer history and add-on usage were the whole salon's for a branch user (now the selected branch's tickets); a 4+ digit ticket number was searched only as phone digits; an unknown add-on key crashed the usage list (the '\u0000' placeholder) — now an empty list; discount redemptions were filtered by the deal's branch instead of where they were used. NOT fixed yet: service tax setTax persistence, category review / history branch scope + duplicate names, Edit Service price path reason / conflict check, legacy add-on route, discount KPI counter vs ledger, export filters.
- B5 Campaign Center — audited: built Oct 31 and the screenshot's "50 reached / 0 sent" case is honest (each count from its own source). FIXED: creator / approver / audit actor names are looked up within the salon only.
