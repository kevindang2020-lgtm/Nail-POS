# FUNCTIONAL DECISIONS AUDIT — the 38 Developer Functional Decisions vs the current build

Oct 1 2026 · tree `7fb64c7` · audit only, **no code changed**. Every verdict comes from reading the code or schema on
this tree. "Surface-checked" means the feature and its wiring were found but the detailed behaviour was not exercised.

**Context that matters:** the developer received this same decisions document before Sep 28. Their tree (merged Sep 29)
contains code written against it — some files quote decisions 19/20 verbatim, and migrations 474–478 (loyalty ledger,
skill requests + schedules, inventory branch overrides, discount snapshot, cash registers) line up with decisions 2–3,
7–8, 15–18. Their code often arrived half-wired, so each item below asks *is it connected end to end*, not *does a file
exist*.

Legend — **BUILT** · **PARTIAL** (some of the decision is missing or mis-defaulted) · **GAP** (not built) ·
**WRONG** (built against the decision).

## Summary

| # | Decision | Verdict |
|---|---|---|
| 1 | Customer profile & history | **BUILT** (Oct 1) — preferred name / language / branch are profile fields (migration 490), searchable, visible without notes permission |
| 2 | Loyalty, rewards, gift cards separate | BUILT (surface-checked) |
| 3 | Points ledger, proportional refund reversal | BUILT |
| 4 | Gift-card balance via ledger; reasoned adjustments | BUILT (surface-checked) |
| 5 | Tokenized saved cards, never CVV | BUILT (surface-checked) |
| 6 | Nail Showcase with booking context + consent | BUILT (surface-checked) |
| 7 | Skill Requests workflow | **BUILT** (Oct 1) — Start Review / Request More Info (note required) / Approve / Reject; moves checked in the transaction; eligibility only on approval |
| 8 | Schedules with breaks, split shifts, time off | BUILT (availability honours them) |
| 9 | Time clock: Technician App + POS PIN | **BUILT** (Oct 1) — Technician App clock in/out on the same timecard, server time, refused mid-service |
| 10 | Configurable commission, precedence | BUILT (Jul 2026 compensation arc) |
| 11 | Full tip to technician; salon absorbs card fees | BUILT (no fee-on-tip deduction exists) |
| 12 | Roles + scopes + custom roles | **BUILT** (Oct 1) — 10 decided roles, owner custom roles, scopes, used at sign-in, managed on "Roles & Permissions"; changing a person's BASE role stays a platform action |
| 13 | Master catalog + branch overrides | BUILT (surface-checked) |
| 14 | Add-on duration recalculates, never overlap | BUILT (Sep 30, re-checked under lock) |
| 15 | Controlled discount stacking + snapshot | **BUILT** (Oct 1–2) — every step through the one engine: membership (included services, dollar credits at their real value, best percent/fixed member discount, no double coverage) and loyalty (reward codes worth an amount or percent, reserved to one ticket, spent on payment) |
| 16 | Block sale at zero stock; negative stock opt-in | BUILT (default OFF) |
| 17 | Low-stock thresholds per product/location | BUILT (migration 476) |
| 18 | Multiple simultaneous cash drawers | BUILT (migration 478, wired) |
| 19 | Void vs refund; original tender | BUILT (surface-checked) |
| 20 | Split-payment refund allocation | **BUILT** (Oct 1–2) — proportional, in Manager Pay and (Oct 2) on the POS: Transactions → Refund; the developer's card-first allocator corrected |
| 21 | Gross-to-net settlement reconciliation | BUILT (settlements carry chargebacks, fees, expected net) |
| 22 | Terminal lost mid-transaction → unknown, query processor | **BUILT** (Oct 1) for card-not-present; the Bolt terminal path still records an unanswered charge as 'failed' (open) |
| 23 | No review gating | BUILT (no rating-based routing found) |
| 24 | Late-booking reminders skip passed windows | BUILT (window design) |
| 25 | AI receptionist: one retry, then transfer/callback | BUILT (transfer or callback; retry count lives in the voice-agent prompt) |
| 26 | Optimizer: customer moves need approval | BUILT |
| 27 | Upsell: ≤2 items, ≤30%, default $30 cap | **BUILT** (Oct 1–2) — max 2 suggestions; added value ≤ lower of $30 / 30% (tenant-editable); an add-on that would run into the technician's next appointment is not suggested and cannot be added |
| 28 | Fraud: detect/score/alert, no auto-suspend | BUILT (challenge, never suspend) |
| 29 | Duplicate profiles: manual review queue | **BUILT** (Oct 1) — Merge / Keep Separate / Not Sure; merge moves every customer-owned record in one transaction with a merge log |
| 30 | AI usage: warn 80/90, stop at 100, no surprise overage | **BUILT** (Oct 1) — warnings at 80/90, `AI_USAGE_LIMIT_REACHED` with upgrade / buy usage / enable overage options; core POS never gated |
| 31 | Gift card = tenant liability; sold-at / redeemed-at branch | **BUILT** (Oct 1) — every ledger row records its branch (migration 489); per-branch sold / redeemed / inter-branch clearing report + salon-wide liability on the Gift Cards screen |
| 32 | Queue priority, 15-min grace | BUILT (grace configurable; default value to confirm) |
| 33 | Safe degraded offline mode | **BUILT** (Oct 1–3) — offline the board, queue, live schedule and catalog show this device's last copy; every write is refused offline; customer notes saved offline become drafts that, on reconnect, are authenticated → refreshed → validated (conflicts shown) → applied or discarded by a person |
| 34 | Shared terminal, one transaction at a time | **BUILT** (Oct 1) — database lease across instances, incl. the Bolt terminal path |
| 35 | Auto-lock + quick PIN | **BUILT** (Oct 1–2; Kevin's rule Oct 12) — on by default at **60 min**, the salon's value (owner: Security → Sign-in policy) is the maximum, a device may lock sooner; the SERVER idle-locks POS sessions itself (423 until the PIN); locked > 8 h → session revoked |
| 36 | Different roles per branch | BUILT (per-branch role; merge fixed its widening bug) |
| 37 | Admin Panel testing | process — see the QA note below |
| 38 | Booking flow testing | **BUILT** (Oct 1) — ARRIVED stored (migration 488); LATE computed from the salon clock (never stored); one shared status list |

**Totals: 22 BUILT · 12 PARTIAL · 2 GAP · 1 WRONG · 1 process item.**

## The gaps, ranked (money and safety first)

1. **D22 — stuck card payments.** A gateway timeout leaves the payment "processing" forever; a retry returns
   "processing" and nothing asks the processor what happened. Needs a processor status inquiry (CardPointe inquire by
   order id / retref) behind a "Verify payment" action plus a sweep for stale attempts. *Money correctness.*
2. **D20 — split-tender refunds.** `calculateRefundAllocations` (the developer's, already correct in shape) has no
   caller; the real refund path refunds one payment at a time. Wire it into the refund flow so a $50 refund of a
   $60 card + $40 cash ticket proposes $30 card + $20 cash and never exceeds a tender. *Money correctness.*
3. **D34 — terminal lock in memory.** `terminalLocks` is a `Map` inside one API process: two instances → two POS can
   start charges on one terminal. Move it to the database (or Redis with a DB fallback) with expiry. *Money safety at
   scale.*
4. **D27 — upsell defaults.** `maxAddedValueCents: 50000` ($500) → decision default $30; add the ≤30%-of-subtotal rule.
   *Customer trust; small change.*
5. **D12 — role model.** Biggest piece of work: add the missing default roles (Tenant Admin, General vs Branch Manager,
   Accountant, Inventory Manager, Marketing Manager, Support Staff), owner-defined custom roles, and explicit scopes
   (OWN / BRANCH / SELECTED_BRANCHES / TENANT) — **extending** the existing permission catalog and the per-branch
   access table, not a second permission system.
6. **D15** route membership / loyalty / bundle discounts through the existing engine so the snapshot is complete.
7. **D30** add 80%/90% warnings and the `AI_USAGE_LIMIT_REACHED` code (keep `limit_exceeded` as an alias).
8. **D29** customer Duplicate Review Queue (side-by-side, Merge / Keep Separate / Not Sure, merge history).
9. **D7** reachable Under Review / More Information Required states in the skill-request review.
10. **D9** clock-in/out in the Technician App (server time authoritative), alongside the existing kiosk PIN clock.
11. **D38** ARRIVED and LATE booking statuses (today: booked, confirmed, checked_in, waiting, in_service, completed,
    cancelled, no_show).
12. **D31** within-tenant branch liability: sold-at / redeemed-at branch on gift-card activity + a clearing report.
13. **D35** idle timeout as a tenant/device policy with a sane default (the comment's 5 min), not a hard-coded 1 min.
14. **D33** cached read-only schedule / catalog / customer summary for viewing offline; drafts validated on reconnect.
15. **D1** preferred name and preferred language on the customer profile.

## Evidence per decision (file references)
- **1** `005_customers.sql` (avatar, birthday), `381_customer_tags.sql`, `164_nail_photo_consent.sql`,
  `165_before_after_sets.sql`; no `preferred_name` / `preferred_language` anywhere.
- **2–3** `474_loyalty_ledger.sql`; `checkout.kysely.repository.ts` `reverseLoyaltyPoints` writes a proportional
  `refund_reversal` ledger row with actor and running balance.
- **4** `033_gift_cards.sql` (issue/redeem/adjust/refund ledger), `401_gift_card_platform.sql` `gift_card_adjustments`.
  Redemption ledger balance-after fixed Sep 30 (`eb14cb2`).
- **5** `047_customer_payment_methods.sql` (brand / last4 / token); "cvv" appears only in transcription redaction.
- **6** `069`/`073`/`074_nail_showcase*.sql`.
- **7** `475_skill_request_and_schedule.sql` allows draft…rejected incl. under_review / more_information_required; the
  code only ever sets draft / submitted / pending.
- **8** `booking.dto.ts` builds windows from split `shifts` and subtracts `breaks`; `035_technician_blocked_times.sql`.
- **9** `398_technician_clock_pins.sql`, Go Check-In service; nothing in `apps/tech-web`.
- **11** no fee-on-tip logic anywhere in compensation / payroll.
- **12** `packages/permissions/src/rbac.ts` `Role` = SUPER_ADMIN | OWNER | MANAGER | FRONT_DESK | RECEPTION | TECHNICIAN |
  CUSTOMER; `068_user_branch_access.sql` (per-branch role + access level).
- **15** `checkout-discount-engine.ts` (the decision's sequence); `checkout.service.ts` routes manual (5), coupon (4),
  deal (3) through it; `tickets.discount_snapshot` (477).
- **16** `477`: `allow_negative_stock BOOLEAN DEFAULT false`; `inventory-core.ts applyMovement(…, allowNegative = false)`.
- **17** `476_inventory_branch_overrides.sql`. **18** `478_cash_drawer_registers.sql`; `cash-drawer.pos.controller.ts`
  takes `registerId`.
- **20** `refund-orchestration.ts calculateRefundAllocations` — zero callers.
- **21** `211_settlements_deposits.sql` (`chargebacks_cents`, `expected_net_cents`), Payments Verification arc.
- **22** `checkout.service.ts` card claim: "intentionally left 'processing' … that row is for reconciliation" — no
  reconciler exists.
- **24** `reminder-core.ts` fires only for appointments inside `[now+lead, now+lead+window)`.
- **25** `ai-receptionist-gateway.controller.ts` handoff → transfer, else callback follow-up.
- **26** `ai-scheduling-application.ts` refuses anything not accepted / customer-approved.
- **27** `ai-checkout-upsell-settings.ts`: `maxTotal: 2`, `maxAddedValueCents: 50000`.
- **28** `booking-verification-fraud.ts` RiskAction allow | challenge | slow | block (block only for non-customer signals).
- **30** `ai-access-gate.ts` denies `limit_exceeded` when over limit and overage is off.
- **31** `406_gift_card_clearing.sql` is cross-TENANT clearing.
- **32** `ai-queue-assignment-appointment.ts` early / on_time / late_within_grace / late_beyond_grace, tenant graceMinutes.
- **33** `useOfflineSync.ts` (online/offline only); `POSCheckoutScreen.tsx`: "Financial actions are disabled in offline
  mode."
- **34** `checkout.service.ts:47` `const terminalLocks = new Map<string, string>()`.
- **35** `POSLayout.tsx` idle lock `1 * 60 * 1000` under a "5 minutes" comment; `QuickPinScreen.tsx` →
  `POST /auth/verify-pin` (hashed, throttled, no default PIN).
- **36** `branch-access.ts` + `user_branch_access.role`. **38** `booking.dto.ts PBStatus`.

## QA note (decisions 37–38)
These are test plans, not features. Much of decision 38's list already has automated coverage (double-booking race on
real Postgres, drag/resize, conflicts, realtime reconnect, two POS devices, poor network, session expiry, phone
verification); decision 37's Admin Panel sweep (every link, permission matrix, 27-inch / laptop / tablet layouts) has
not been run as one pass. Proposal: script the permission matrix and dead-link sweep, and run the layout pass in the
real-browser harness built Sep 30.

## Rule for the build
Per the decisions document and this repository's standing rule: every fix **extends the existing module** named above
— no `*_v2`, no parallel permission or refund system — and is wired Frontend → API → Service → Repository → Database
with permissions, audit, events where required, and tests.

## Progress log (Oct 1 2026)
| Commit | Decision | What |
|---|---|---|
| `5f4e8fe` | 22 | Stuck card charges verified with the processor (approved / declined / failed / pending / unknown); never re-charged or voided |
| `195815b`, `e58051f`, `fce12df` | 20 (+10) | Proportional split refunds (developer's card-first allocator corrected); a commission-reversal bug on split tickets fixed; Manager Pay "Refund across payments"; Manager Pay's selected services were being dropped — fixed |
| `39f38b0` | 34 | Database terminal lease across API instances, incl. the physical Bolt terminal path (migration 485) |
| `87f1573` | 27 | Upsell cap min($30, 30%), tenant-editable (was $500) |
| `b1554dd`, `952bfad`, `616c09a`, `b1ef341` | 12 | Role templates (10 roles + custom), storage (migration 486), sign-in, "Roles & Permissions" screen with audit |
| `b8478fe` | 15 | Redeemed membership credits reduce the bill via the stacking engine (members were being charged full price) |
| `7a89c5c` | 30 | 80/90/100% AI usage warnings; `AI_USAGE_LIMIT_REACHED` with options |
| `c7cfcba` | 29 | Duplicate review decisions + full-record merge (written by a concurrent session; reviewed, tenant-scoped, tested here) |
| `8e55032` | 7 | Start Review / Request More Info reachable; reviewer notes saved; Team screen counted and labelled skill requests wrongly |
| `3813fc9` | 9 | Technician App clock in/out (written by a concurrent session; reviewed and finished here); evening-shift clock-out bug fixed for every clock |
| `0fe6557` | 38 | Mark Arrived; computed Late with 15-min grace; ~15 copied status lists replaced by one; booking board 'today' was the UTC day |
| `02298a7` | 38, security | Harness back to 124/0: one rule for services on bookings/check-ins/queues (unknown services were saved at $0; device durations and prices trusted); customer signup without a salon code joined another salon; avatar upload unvalidated |
| `1423761` | 31 | Gift-card ledger rows carry their branch; Branch Liability & Clearing report (GET /pos/gift-cards/liability, reports permission) |
| `0709113` | 31 | Clearing corrected to per card: a redemption at B of a card sold at A means A owes B that amount (the first version computed sold − redeemed per branch, which said A owed $100 in the decision's own example) |
| `ecef599` | 35 | Idle lock 5 min (was 1 under a "5 minutes" comment), on by default, minutes setting, lock expires to full sign-in after 8 h |
| `86f8748` | 1 | Preferred name / language / branch moved from the private-notes blob to profile columns; old values carried over |
| `1c06947` | 33 | Offline read cache (allow-listed reads, per user, 24 h) + every write refused offline at the network layer |
| `69d2f0a` | 15 | Membership step: dollar credits at their real value, percent/fixed member discounts, the double-coverage button removed (rebuild of the lost e20f370) |
| `812bbfd` | 38 | New Booking / Walk-In: the salon's real catalog only; "Edit price" only with the override permission, reason required |
| `d6cf9fc` | 35 | The session is locked on the server (423 until the PIN; revoked after 8 h) |
| `3d03588` | 20 | POS refund screen: server-split preview, required reason, per-payment result |
| `8e55032` | 7 | Reviewer steps reachable; reviewer notes no longer dropped; Team screen now counts new skill requests and labels them correctly |

## D12 design (role templates — an extension, not a second permission system)
- The seven base roles stay the authorization primitive every guard understands.
- A **role template** sits on one base role and keeps a SUBSET of that role's permissions (always intersected with
  `permissionsFor(baseRole)`) — so neither a default template nor an owner-made custom role can grant what its base
  role cannot. `packages/permissions/src/role-templates.ts`: the 10 decided roles + `validateCustomRole`.
- **Scope** maps onto the existing per-branch access (`user_branch_access`): TENANT = every branch,
  SELECTED_BRANCHES = assigned branches, BRANCH = one branch, OWN = own records (the technician model).
- Remaining steps: (2) storage — tenant custom roles + a role-template key on each staff member (migration);
  (3) sign-in — permissions = the template's subset of the base role, fail-safe to the base-role defaults, then the
  existing per-branch override; (4) owner/manager screens to assign roles and create custom roles, with audit.

## New findings during the build (not in the original audit)
- ~~**The POS has no refund screen**~~ — built Oct 2 (`3d03588`): Payments → Transactions → Refund.
- **Bolt terminal path, Decision 22:** a thrown `authCard` records the payment 'failed' though the device may have
  charged the card — needs the same processor-inquiry resolution as the card-not-present path.
- **`TerminalCaptureService` has no tests** of its own.
- **D15, bigger than audited:** redeeming an included-service membership credit consumed the credit and paid commission
  on it but never lowered the ticket total — members paid full price. Fixed in `b8478fe`.
- **D12:** owners could not manage staff roles at all — only Super Admin could. Fixed for role templates; base role
  changes remain a platform action.
- **D7:** the POS sent the reviewer's note but the controller and service dropped it; the Team screen counted only the
  pre-475 'pending' status (so new requests never showed) and labelled skill requests "Shift Swap Requests" and ticket
  change requests "Document Verification".
- **D29 merge** previously left loyalty, memberships, gift cards and saved cards on the archived profile.
- **Time clock, every channel:** `shift_date` is a UTC date, so a shift clocked in before 8 pm EDT and clocked out
  after it could not be clocked out ("not clocked in") and the punch stayed open. Fixed in `TimeClockService`, which the
  POS screen, the Go Check-In kiosk and the Technician App all use. `hoursToday` is still a UTC-day figure (display).
- **Booking board day:** `today()` was the UTC date, so after 8 pm in New Jersey the board defaulted to tomorrow and
  stopped blocking today's past slots. Fixed with the salon time zone (default America/New_York; per-branch time zones
  not wired). The POS check-in list and several reports still filter on the database's `current_date`.
- **Harness specs** (last green Sep 27, not run after the Sep 28 developer merge) exposed three real regressions from
  the developer tree, fixed Oct 1: (1) booking, check-in, queue, tech-queue and tech-appointments saved an unknown
  service id as a $0, 30-minute service, trusted the device's duration (freeing the chair for a double booking) and
  recorded any device price as an "override" with no permission check — now one shared rule
  (`@aipowersalon/appointments` resolveCatalogLines); a price change or custom service needs the checkout override
  permission (managers/owners) and a reason; (2) customer signup without a salon code joined the platform's OLDEST
  active salon, and suspended salons accepted signups; (3) the avatar upload skipped validation (any data:image/*
  stored with no size/type check; any other string written into users.avatar_url). The rest were stale tests.
- **D31:** no gift-card ledger row recorded where it happened, and redemptions were not linked to their ticket, so
  "sold at A, redeemed at B" could not be reported. Fixed with migration 489 + the report. Still open: `issueGiftCard`
  writes `gift_cards.branch_id = NULL` while physical/pending sales write the selling branch — and the gift-card list is
  scoped to "this branch or NULL", so a card sold at another branch is missing from this branch's list although it is
  redeemable here. Sold-at is now reliable in the ledger; the card list scoping is a separate fix.
- **D31 clearing:** since Oct 2 a redemption spends the card's sales first in, first out (a reload sold at another branch
  counts for that branch; value with no known seller is reported as not cleared). Report date ranges follow the requesting branch's days (since Oct 2).
- **D35, open:** the lock lives in the browser (localStorage) — clearing it, or opening a second tab, skips the PIN while
  the server session stays valid. A server-side lock (session flag checked by the API until /auth/verify-pin) is the real
  fix. Server-side policies in the decision (revoked device, suspicious activity, step-up for high-risk actions) are not
  part of this change.
- **D1 (audit correction):** the audit said preferred name / language did not exist; they did, inside the private
  notes blob (`notes_json`) — which is why only notes-editors could set them, nothing could search them and a
  notes-permission refusal hid them. Now profile columns. Not yet shown on the booking board, queue or Technician App.
- **D33, open:** draft notes taken offline and the reconnect step (authenticate → refresh → validate drafts → apply or
  reject) are not built. Reopening the app while offline still shows the sign-in screen (the principal is not cached);
  the read cache helps when the connection drops while the app is open.
- **Oct 2, consequence of the service rule (02298a7):** the New Booking and Walk-In screens started with a hard-coded
  demo catalog and showed demo add-ons to any salon without an "Add-ons" category; the developer's $0 fallback had
  silently saved them, the restored rule refused them. Demo catalog removed; the screens offer only the salon's catalog,
  "Edit price" only with the override permission, and an override needs a typed reason.
- **Oct 2, container reset:** the working tree was wiped at ~06:20; three commits and in-progress work were rebuilt from
  the session record (69d2f0a = the lost e20f370, then the screen fix, the server-side lock and the refund screen). The
  repository bundle in outputs is now refreshed after every commit.
- **Oct 2, D35 server-side lock (closes the client-side-only item above):** migration 491 `sessions.locked_at`; POST
  /auth/lock; a locked session gets 423 SESSION_LOCKED except /auth/verify-pin, /auth/me, /auth/logout, /auth/lock; a
  correct PIN unlocks; a lock older than 8 h revokes the session; the POS locks the session with the screen and locks any
  tab that receives a 423. Also fixed: a date-sensitive test (auth-session-token legacy token minted with iat = now).
- **Oct 12, D35 — Kevin: "POS auto-lock is on by default at 60 minutes, also locked on the server, with a full sign-in after
  8 hours locked."** Migration 570 (`sessions.client_app`, `last_activity_at`, `pin_failures`). A POS device session is one
  signed in by pos-web, which sends `X-Client-Type: pos` (stored on the row at sign-in; only the exact value `pos`); the mobile
  apps, native sign-in, owner/admin/tech web, scripts and the live proofs are not, and the kiosk / customer display use device
  tokens outside the session middleware. The server's idle clock moves only on sign-in, a correct PIN and
  `POST /auth/session-activity` (pos-web, at most once a minute while someone touches the screen) — never on reads, polling or
  streams. Idle ≥ the salon's minutes (tenant_settings `security.autoLockMinutes`, choices 5/10/15/30/60/120, default on/60)
  → `locked_at = last activity + minutes`; every call but `/auth/verify-pin`, `/auth/me`, `/auth/lock-status`, `/auth/lock`,
  `/auth/logout` answers 423 `SESSION_LOCKED` (with `lockedAt`); open realtime streams of a locked session end; locked > 8 h →
  revoked (401 `SESSION_LOCK_EXPIRED`). Wrong PINs are audited (`PIN_UNLOCK_FAILED`) and the 5th on a session ends it (the
  per-user Redis limiter is a no-op without Redis). Kept from Decision 35: quick 4-digit PIN, the device may choose a shorter
  time (1–120, capped by the salon), the salon may switch PIN unlock off. Rules in `packages/api-contracts/src/pos-auto-lock.ts`;
  proof `apps/api/scripts/live-pos-autolock.mjs` (clock moved by rewinding the row's clock columns).
- **Oct 2, container reset:** /home/claude was wiped at ~06:20; commits after the 91a8d31 bundle were rebuilt from the
  conversation and re-verified (69d2f0a membership step, 812bbfd catalog/override screens, this lock commit). The repo
  bundle in outputs is now refreshed after every commit.
- **Oct 2, D15 loyalty step (`73e4dbd`, `1c01411`):** rewards had only a title and a points cost, codes were never accepted
  at checkout and nothing could create a reward. Migration 492 gives rewards an amount-off / percent-off value and an
  optional validity, and every code a value snapshot and a state (issued → applied to one ticket → used | void). Owners /
  managers manage the catalog on the POS Loyalty screen; the customer app offers only rewards worth something and shows
  the value; staff apply a code on POS checkout (the customer's own, unused, unexpired), it comes off LAST, is reserved
  atomically (10-register race: one winner), and is spent only when the ticket is paid. Points are not returned on a
  refund. Untouched: free-service rewards (would need a service benefit, like memberships).
- **Oct 2, D27 schedule conflict:** the upsell engine had no schedule data. It now reads the ticket technicians' next
  chair-holding appointment today (salon time) and leaves out any add-on whose extra minutes exceed the gap; adding one
  anyway is refused (409 ADDON_SCHEDULE_CONFLICT) and the POS panel says why. Time zone = the booking default
  (America/New_York) until per-branch zones are wired.
- **Oct 2 — Kevin confirmed the three behaviour changes:** (1) a changed price or custom service on a booking / walk-in
  needs a manager and a reason; (2) POS auto-lock on by default at 5 minutes, enforced on the server, full sign-in after
  8 hours locked; (3) customer self-signup requires a salon code.
- **Oct 2, per-branch time zones (`2640df3` + this commit):** one shared lookup (`branchTimeZone`, packages/database:
  branches.timezone → America/New_York, cached). On the branch clock now: the booking board (today, current minute,
  LATE, KPIs, day grid), the add-on schedule check, the POS check-in list and the Go Check-In kiosk (its "today" and the
  start of day for "already checked in"). BUG fixed on the way: after 8 pm in New Jersey the POS check-in list and the
  kiosk used the database's UTC date — tonight's appointments disappeared from check-in. Gift-card report days now
  follow the requesting branch's zone too. Still UTC: some reports using current_date, the time clock's stored
  shift_date (by design).
- **Oct 2, Bolt kiosk path (D22 + D34):** `TerminalCaptureService` had no tests and recorded a terminal call that threw
  mid-charge as 'failed' (the card may have been charged; 'failed' invited a second charge). It is now 'processing' — the
  lost-answer state the POS resolves with "Verify with processor" (inquiry by order id = the ticket) — and the kiosk stays
  on "processing" until staff confirm. Real-Postgres tests: approved (+ duplicate tap), declined, busy terminal, thrown
  mid-charge, config failure before any charge.
- **Oct 3, D33 draft notes (written by a concurrent session, verified here):** a customer-notes save that fails because
  the device is offline is kept as a per-user draft (7 days) with the notes as they were loaded; on reconnect the POS
  shows "N notes were saved on this device while offline" → Review → each draft is checked in the decision's order
  (sign-in → fetch the current notes → compare) → "Apply" / "Apply anyway" on a conflict / "Discard". Reopening the app
  while offline is covered since Oct 3 (below).
- **Oct 2, D31 first-in-first-out clearing:** every redemption had cleared to the branch that FIRST sold the card. Now
  each redemption spends the card's oldest sold value first: $50 sold at Cherry Hill + $40 reload at Haddonfield, $60
  redeemed at Moorestown → Cherry Hill pays $50, Haddonfield pays $10. Value coming back with no known seller (refund
  reversal, positive adjustment, incoming transfer) is spent first and reported as not cleared.
- **Oct 3, the remaining UTC days:** every salon-facing "today" now uses the branch's zone (shared `branchTimeZone`).
  Time clock: shift_date is the branch's day for new shifts (an 8:30 pm New Jersey clock-in was filed under tomorrow);
  older rows keep their UTC dates and the previous-day rule covers both. Also: technician queue "today's shift" and
  today's serving sessions, owner-analytics scheduled-today, technician utilization, queue conversion today/yesterday,
  service-done rebooking, AI Center today, AI marketing "has an upcoming appointment", the owner portfolio (each salon's
  own zone, invalid zones ignored) and — a real bug — customer-app check-in, which told a customer checking in at 8:30 pm
  for tonight's appointment to come back on the day of the appointment. Deliberately still UTC: Super Admin / platform
  views (they span salons in different zones), housekeeping jobs and platform snapshots.
- **Oct 3, D33 opening the POS offline:** a reload with no connection used to land on sign-in, so the saved board / queue /
  catalog were unreachable. Now the LAST user's session opens read-only offline — only within 8 hours of their last
  confirmed online sign-in, never on a locked device (the PIN is server-checked), never after sign-out or a server-side
  revocation, never for a billing-only session; back online, /auth/me decides at once (valid → continue, else sign out).
  Nothing secret is stored (no password, PIN, token or cookie — the principal only). Banner: "Opened offline — read-only
  until the connection is back."
- **Oct 3, customer signup — choose a salon (Kevin):** instead of a required salon code the customer picks a salon (search
  by name / city / ZIP, or "Use my location" for AIPowerSalon salons within 25 miles); a code still works. Only a live,
  public location of an active salon. It becomes the default salon (migration 493 `users.customer_default_at`); sign-in
  of a person with accounts at several salons lands at the most recently chosen one (both the identity and the per-salon
  paths). Profile → My salon changes it: another location of the same salon business at once; a different business →
  their account there (created with the same name, contact details and password hash, or the existing one reused) becomes
  the default and they sign in again. BUG removed on the way: customer sign-in wrote the whole identity record —
  including its password hash — to the server log (plus a second debug line on the Super Admin path).
