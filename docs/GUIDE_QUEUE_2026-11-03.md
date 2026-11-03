# Build queue — guides uploaded Nov 3 2026

Every guide Kevin uploaded on Nov 3 2026, in the order received. Status: QUEUED → AUDITED → BUILDING → BUILT (commit). A guide is BUILT only when its gaps from the audit are closed and tested; anything deliberately not built is listed under "Not built" with the reason.

## Batch A (10:33) — 20 AI guides
| # | Guide | Route | Status |
|---|---|---|---|
| A1 | AI Center (refreshed) | /tenant/ai/command-center | BUILDING |
| A2 | AI Business Alerts (newer) | /tenant/ai/business/alerts | AUDITED |
| A3 | AI Branch Comparison | /tenant/ai/business/branches | AUDITED |
| A4 | AI Business Assistant | /tenant/ai/business | AUDITED |
| A5 | AI Scheduling Optimizer | /tenant/ai/scheduling-optimizer | AUDITED |
| A6 | AI Queue | /tenant/ai/queue | AUDITED |
| A7 | AI Booking Assistant | /tenant/ai/booking | AUDITED |
| A8 | AI Reception Copilot | /tenant/ai/reception-copilot | AUDITED |
| A9 | AI Receptionist Settings | /tenant/ai/receptionist/settings | AUDITED |
| A10 | AI Calls | /tenant/ai/receptionist/calls | AUDITED |
| A11 | AI Calendar | /tenant/ai/receptionist/calendar | AUDITED |
| A12 | Business Setup | /tenant/ai/receptionist/business-setup | AUDITED |
| A13 | AI Follow-Ups | /tenant/ai/receptionist/follow-ups | AUDITED |
| A14 | AI Front Desk | /tenant/ai/receptionist/front-desk | AUDITED |
| A15 | AI Receptionist | /tenant/ai/receptionist | AUDITED |
| A16 | Reception Copilot (v2) | /tenant/ai/copilot | AUDITED |
| A17 | Reviews & Reputation | /tenant/marketing/reviews | AUDITED |
| A18 | Referral Program | /tenant/marketing/referrals | AUDITED |
| A19 | Customer Retention / Win-Back | /tenant/marketing/win-back | AUDITED |
| A20 | Birthday Campaigns | /tenant/marketing/birthdays | AUDITED |

## Batch B (10:35) — 18 marketing / communications guides
B1 Customer Segments · B2 Coupons & Promotions · B3 Deals & Offers · B4 Promotions · B5 Campaign Center · B6 Global Loyalty Final Completion · B7 Marketing & Growth · B8 Message Templates · B9 Notifications · B10 Phone Number Management · B11 Booking Phone Verification · B12 Text Messaging Setup · B13 End-of-Day Follow-Ups · B14 Follow-Up Queue · B15 Appointment Reminders · B16 Email · B17 LoyaltyTokens · B18 LoyaltyRules — all AUDITED (B5–B8 audit pending).

## Batch C (10:37) — 13 guides (LoyaltyTokens is an exact repeat of B17)
C1 Loyalty Complete · C2 Communications (updated) · C3 Four Modules · C4 Phone & Messaging combined · C5 Customer Retention (complete) · C6 Team Management · C7 Five Unfinished Features · C8 Technicians · C9 Tech Appointments · C10 Live Technician Schedule · C11 Tech Queue · C12 Commission Report — QUEUED (audits running).

## Batch D (10:40) — 20 guides (Commission Report is an exact repeat of C12)
D1 Team Performance · D2 Services & Products · D3 Service Categories · D4 Service Pricing · D5 Add-Ons · D6 Membership · D7 Discounts · D8 Products · D9 Inventory · D10 Suppliers · D11 Stock Alerts · D12 Stock Alerts – Technician Usage · D13 Payments & Money · D14 Transactions · D15 Cash Drawer · D16 End-of-Day Cash · D17 Refunds & Voids · D18 Split Payments · D19 Tips — QUEUED.

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
