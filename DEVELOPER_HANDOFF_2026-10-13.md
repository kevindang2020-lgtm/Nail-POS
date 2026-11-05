# AIPowerSalon — FINAL developer hand-off (Oct 13–14 2026)

**This is the one tree.** It contains everything: the platform built through the 15-phase plan (all 13 constitutions + the 7
module specs), Kevin's Oct 12 requests, **the developer's own changes up to Oct 6 2026** (Power-Salon-main.zip), and **the other
Claude chat's Oct 12 package** (Technician Profile, booking concurrency, Tech App, owner / Super Admin features — 330 files),
ported into one module layout and then finished against Kevin's four mandates (Fair Turn Engine, Technician Profile, Payroll,
Dual-Screen). Start from this tree. **Do not continue on Power-Salon-main** — see §1.

- Get it: the full repository comes as two parts (upload size limit). Join them, then clone:
  `cat aipowersalon-full.bundle.part00 aipowersalon-full.bundle.part01 > aipowersalon-full.bundle && git clone -b work/dual-screen-display aipowersalon-full.bundle aipowersalon`
  (all history; the latest commit is named in the cover message). Anyone who has the Oct 12–13 bundle (commit `fdbc3698`) can
  instead fetch `aipowersalon-incremental-since-fdbc3698.bundle`: `git fetch aipowersalon-incremental-since-fdbc3698.bundle work/dual-screen-display`.
- Then read, in order: this file → `START-HERE.md` (build / run / test / deploy / code map) → `docs/PROGRAMME_DOD_STATUS.md`
  (every Definition-of-Done line, its status and evidence) → `docs/HOSTING_ACTIONS_FOR_KEVIN.md` (what needs accounts / servers).

---

## 1. Read first — security (do these before anything else)

1. **The developer's tree (Power-Salon-main, Oct 6 2026) still carries hidden malware, and his build now runs it.**
   - `eslint.config.mjs`, last line: obfuscated JavaScript hidden after thousands of tab characters (the same payload found and
     reported on Sep 29 — `MERGE_REPORT_2026-09.md` §1). It runs whenever ESLint loads the config (lint, an editor plugin, CI).
   - **New since then:** a root `api.js` (29 KB, obfuscated, hidden the same way), and the root `package.json` now has
     `"build": "node api.js && …"` and `"dev": "node api.js && …"` — **every `npm run build` / `npm run dev` on that tree executes it.**
   - Treat the developer's computer, GitHub, npm and cloud accounts as **compromised**: rebuild the machine; from a clean device rotate
     every credential it ever held (GitHub, npm, Railway, database, Twilio, SendGrid, Fiserv/CardPointe, Firebase, Apple/Google);
     review GitHub for unknown SSH keys, tokens, OAuth apps and pushes. Anyone else who ran npm / ESLint on that tree does the same.
   - None of these files were brought into this tree. This tree's `eslint.config.mjs` is the clean one.
   - **Removal (Oct 13):** `bash tooling/security/clean-developer-tree.sh`, run from the root of the developer's checkout on a
     clean machine BEFORE any npm / editor use, deletes `api.js`, cuts the hidden payload (and the `require` shim it added) out of
     `eslint.config.mjs`, removes `node api.js &&` from `build` / `dev`, deletes the Firebase key file, and re-scans → **CLEAN**
     (tested on a copy of the infected files). Full steps, including the account clean-up from a clean device:
     [`docs/security/DEVELOPER_MALWARE_CLEANUP.md`](docs/security/DEVELOPER_MALWARE_CLEANUP.md).
   - **It cannot come back into this tree:** new CI gate `check:supply-chain-injection` refuses hidden off-screen code,
     obfuscator identifiers, the payload's marker, root scripts run by `package.json`, install hooks, stray root-level scripts
     and editor auto-run tasks (the exact injection, re-created as a test, is refused on all five counts). Ten old harmless
     one-off scripts at the repository root were deleted so the root is clean.
   - This is the **second** time (first: Sep 29). Until the developer's machine is rebuilt, take his work only as a pull request
     into this repository — CI runs the gate on it — never as a zip or his own repository.
2. **A real Firebase service-account private key** is committed in that tree at `apps/api/firebase-admin.json`. Revoke it in the
   Firebase console (Service accounts → keys), create a new one, and put it ONLY in the `FCM_SERVICE_ACCOUNT_JSON` environment
   variable on Railway. This tree reads it from there; it never reads a file.
3. **The external database login** (the outside Postgres server's user + address, port 5432) is in this repository's git history: change that password and close port
   5432 to the internet. Nothing has been pushed to GitHub because of this; push only after it is done (history rewrite on request).
4. **Three Android upload keystores** (`apps/{customer,owner,tech}-web/android/*.jks` + `key.properties`) are committed: create new
   upload keys through Play App Signing, delete the files, purge them from history (one rewrite together with item 3).

Refused from the developer's tree on purpose (security): an **unauthenticated** `/public/push/register` (anyone could bind a push
token to any user and receive their tips / payments / customer names) — this tree registers devices only through the
authenticated `/push/register`; client code that sent its own tenant / role / user ids; `alert()` for foreground pushes; service
workers loading Firebase from gstatic (blocked by our CSP); customer-web `cleartext: true` / `androidScheme 'http'`. Earlier
backdoors (a universal `123456` OTP, secrets written to logs) were removed in September and are blocked by tests.

---

## 2. What is finished

| Area | Status | Where it is proven |
|---|---|---|
| 13 Architecture Constitutions | complete on the code side; every DoD line DONE / DECIDED / HOSTING (`node apps/api/scripts/programme-dod.mjs` → MET) | `docs/PROGRAMME_DOD_STATUS.md`, `PROGRAMME_FINAL_REPORT_2026-10-10.md` |
| 7 module specs (phone management, booking verification, deals, AI queue assignment, scheduling optimizer, safety community, dual-screen) | complete; open items in §3 | `BUILD_PHASES_REPORT.md` |
| **Fair Turn Engine mandate** | built into queue / tech-queue / ai-queue-assignment / workforce (no parallel queue): assignment modes (AUTOMATIC / RECOMMEND_AND_CONFIRM / MANUAL, default R&C), versioned turn policy + turn units, technician turn state + append-only turn events, skip reasons that keep position, appointment protection buffer, requested-client / appointment policies, break policy (paid / unpaid, interruption, correction trail), decline with reason, deterministic tie-breakers, starvation boost, atomic assignment with idempotency, explanations, manager reorder / override with reason, daily reset in the branch zone, fairness dashboard + turn history + simulation, Tech App rotation card with server-decided visibility. Migrations 600–603 | `live-fair-turn.mjs` 22/22; ledger `docs/queue/*`, `docs/workforce/*` |
| **Technician Profile mandate** (other chat + finish) | global identity + tenant membership, workforce state (state machine + domain event), clock with breaks / open punch, multi-branch employment, time-off workflow, exact-service eligibility (**with a back-compat mode for existing technicians — §4**), certifications + expiry reminders, revocation chain, portfolio privacy, Tech App Time Clock / Time Off / Certifications / Performance / Tips / My Clients, POS technician profile + workforce panel + lifecycle + pending time off + live schedule week, owner Live Team, Super Admin queue masking + support mode, favourite technicians first in customer booking, "Book This Look". Migrations 573–585, 599, 631 | `docs/workforce/TECHNICIAN_AUDIT.md` |
| **Payroll mandate** | on the existing compensation + payroll modules: durable service sessions, one Service Done transition, commission precedence with provenance, line allocations, refund / chargeback reversals (idempotent), paid-period lock in the database, review → approve → finalize → paid with step-up + compare-and-set + calculation hash, payouts + payout history, audited CSV / XLSX export, refund in a locked period → adjustment in the next open period, tip lock + re-split with reason, exception queue + recovery worker, pay plans (hourly / salary / commission, no overlaps), deduction types, technician pay inquiries, tech self-service pay. Migrations 586–590, 610–614 | `live-payroll-completion.mjs` 23/23; `docs/payroll/architecture.md` |
| **Dual-Screen mandate** | audited section by section (61 rows: 40 already complete, 15 built now, 6 decided): one display state model in priority order, offline check-in, the 10 standard error codes, display telemetry, owner display settings + English / Vietnamese, POS "Current mode" + Reconnect, Windows second-monitor setup + kiosk launcher. Migration 620 | display proofs (lifecycle 30/30, ads 42/42, ads page 14/14, check-in, journeys, devices, 23-inch, layout 439/439); `DUAL_SCREEN_FINAL_REPORT.md`, `docs/CUSTOMER_DISPLAY_WINDOWS_SETUP.md` |
| Kevin's Oct 12 requests | multi-technician visits (one engine, per-line technicians, commission and tips follow the line), AI receptionist + copilot booking holds, "first available" retries the next free technician, ticket status read only from the database (safe with 2+ API servers), **POS auto-lock ON by default at 60 min, enforced by the server, full sign-in after 8 h locked** | `live-multitech-queue.mjs` 21/21, `live-pos-autolock.mjs` 25/25 |
| Deep scan (Super Admin + whole repo) | every Super Admin route run in a real browser for 16 platform roles (≈ 620 console errors / 403s → 0); 17 fixes incl. 3 HIGH (POS New Booking booked "tomorrow" after 8 pm on the east coast; gift-card redemption could debit with no ledger row; commission-oversight history always empty from a SQL type error); new gate `inert controls` | `scratchpad` report summarised in §3 |

### 2a. Wave 3 (Oct 13) — Kevin's four attachments + the Fair Turn → payroll chain, audited section by section and built

| Mandate | Ledger (every numbered section) | What was built / fixed | Proof |
|---|---|---|---|
| **Owner & Manager Payment App — Tap to Pay on iPhone** (224 §) | 109 complete · 95 built · 11 decided · 9 external · 0 not done | Built ON the existing `apps/manager-pay-web` + `modules/checkout/src/mobile-checkout` (no second checkout/payment system): ONE money path for mobile captures (the old capture path never worked on Postgres — fixed), checkout version → `CHECKOUT_VERSION_CONFLICT` before any charge, device trust (pending / trusted / revoked / compromised / disabled, bound to user + tenant + branch), revoke on employment end, checkout claim + POS "Payment in progress on Kevin's iPhone" + Take Payment refused meanwhile, Send to phone, unknown-state recovery worker (no blind retry), app-relaunch recovery of the same attempt, split / partial tenders, Customer Handoff Mode with locked navigation + staff return, capability states (Ready / Setup Required / Unavailable), step-up for high-value charge, receipts through the tenant's communications (async, retrying), history + reports (gross sales ≠ processor payout), kill switches (Tap to Pay / Fiserv Tap to Pay) in Super Admin, production refuses a mock provider, English + Vietnamese, owner Payment Devices screen, Super Admin Tap to Pay screen. Migration 660 | real-Postgres race lane 8/8 (claim race, POS vs phone, 20 taps → one charge, stale amount, split, partial decline, wrong tenant / branch, revoked device, card-data scan); `docs/payments/OWNER_MANAGER_PAY_APP.md` (§224 A–Z report) |
| **Payments, Clover / Fiserv, Twilio** (191 §) | 130 complete · 47 built · 12 decided · 2 external | Branch merchant accounts + terminal registry with normalized status, REAL terminal test (the old one said "paired and responding" without contacting anything), webhook inbox retries, Twilio Messaging Service per salon, segment accounting + usage, campaign cost preview + confirm, provider-config production checks, SDK architecture gate. **P0 fixed:** the customer web Pay screen sent the typed card number as the "token" (now the salon's CardSecure hosted form; backend refuses raw card numbers); **P0 fixed:** any salon could take over another salon's SMS number. Migrations 638–641 | payments 235, communications 400, tenants 140, checkout race 12/12 (terminal busy 10→1, duplicate charge 10→1), 10 mutations killed; `docs/payments/PAYMENTS_INTEGRATIONS_WAVE3.md`, `docs/integrations/*` (8), `docs/runbooks/*` (5) |
| **Smooth Refresh, Realtime & Booking Concurrency** (123 §) | 112 complete · 7 built · 2 decided | 15 s POS sync + 20 s server reconciliation kept. Every path that puts a technician on a slot is blocked **at create AND move** inside one transaction (technician-day lock → re-read → hold check → version → EXCLUDE constraint as the last line → typed 409). Fixed: the customer app / AI receptionist ignored technician shifts, breaks and blocked time; a customer's own verification hold refused the customer; a lengthened visit could run past shift; Tech Appointments screen had no sync | real-Postgres booking race lane 39 tests incl. 10 simultaneous moves → 1 winner; `docs/booking/SMOOTH_REFRESH_WAVE3.md` |
| **Technician Profile** (183 §) | 123 complete · 16 built · 2 decided | Employment history (hired / role / branch / leave / terminated / transferred), public profile status + optional manager approval of public changes, portable career history (opt-in), transfer approval ends the old employment in the same commit and is refused mid-service, portfolio → Nail Showcase share (+ Book This Look), technician CSV import (phone/email keys, never merge by name), POS Technician Profile page (overview cards + 14 sections), 10 workforce error codes. Migrations 646–647 | workforce 883, pos-web 1,355, tech-web 180, customer-web 275; 8 mutations killed; `docs/workforce/{technician-profile,skills,transfers,commission,time-clock}.md` |
| **Fair Turn → payroll money chain** (Kevin's instruction) | 26 built · 5 complete · 1 decided | **ONE payroll calculation, enforced:** commission, tip shares, technician earnings and payroll amounts are calculated ONLY in `modules/workforce/src/compensation` + `modules/workforce/src/payroll` (plus the integer helpers `percentOfCents` / `splitByPercent` in `packages/money`). 22 places that did their own math were moved onto it (8 in the first pass, 14 more in the second: Tech App estimate fallback, POS roster "estimated commission" and payroll snapshot (today's sales × CURRENT rate, tips always 0), three formulas inside the engine itself, commission report fallback, hard-coded 15 % on Service Done / Serving, whole ticket tip credited to the primary technician in Tech Queue, owner dashboard and tip notifications, queue's own rate rules, the membership split, a POS screen computing the technician share, old script copies). No estimates, no fallbacks — a number that cannot come from payroll shows "—". New CI gate `check:one-payroll-calculation` fails the build if commission / tip / earnings math appears anywhere else (frontends included; 10 sabotage tests caught, 1 reviewed exception); legacy rotation policies mapped onto the 5 Fair Turn modes; language matching (off / soft / hard); partial refund reversal was diluted by tip + tax — fixed; Time Clock screen live | `live-money-chain.mjs` **25/25 on a booted API** (now also checks the POS roster and Tech Queue tips equal payroll): Fair Turn assign → Service Done → Checkout → Payment → Commission + Tip → Pay Period → Approve → Lock → Payout / Export → Refund after lock → reversal in the next open period, every hop linked back to the ticket and the turn history; `docs/payroll/MONEY_CHAIN.md` |

### 2b. Wave 4 (Oct 13, evening) — deep scan of every module, a full pilot day, every gap fixed

**How it was checked — by running it, not by reading it:**
- **Every route, every module** (`apps/api/scripts/live-route-sweep.mjs`, 14/14): all 2,913 manifest routes are mounted;
  1,398 live GET calls on a seeded salon → 0 server errors, all under 2 s; 1,039 "role must be refused" probes → no leak;
  1,510 write routes refuse a call with no session; and a new check reads the **PostgreSQL error log**, because the most
  common defect found was a query that fails, is swallowed by a `.catch`, and makes a screen look quietly empty.
- **Every event and background job** (`live-event-wiring.mjs`, 17/17): 10 consumers registered once, 62 background classes
  one instance each, 21 job handlers; 8 end-to-end flows re-run with the publisher on → 282 events of 48 types, every one
  handled by every subscribed consumer, nothing dead-lettered, p95 publish delay ≈ 1 s.
- **The pilot** (`live-pilot-day.mjs`, **74/74**, report `docs/PILOT_DAY_REPORT.md`): one new salon, one whole day, through the
  real API, a real database and the real built apps in Chromium (9 screenshots): Super Admin onboarding → owner setup (menu,
  tax, staff invites, technicians invite → skills → schedule → PIN, commission rules, gateway, customer display, kiosk) → PIN
  clock-in → Fair Turn recommend-and-confirm → kiosk walk-ins, online booking, AI receptionist, multi-technician visit → Service
  Done → checkout with discount, membership, gift card, tips, surcharge → customer display totals and clear → Tap to Pay with a
  phone claim and a cash + card split → refund, inventory, loyalty → end of day: **$411.25 collected = sales − discounts + tax +
  tips + surcharge + gift cards sold**; POS reports, commission report, owner finance, Tech App and payroll agree per technician
  → payroll approve → lock → export → pay → a refund after the lock becomes a next-period adjustment. The pilot also fails on
  any unexpected PostgreSQL error during its run (0).

**What was wrong and is now fixed (≈ 50 defects, each with a failing test first):**
- *Broken for every salon:* the POS AI settings screen refused everyone (owner included); the AI booking link could never verify
  a guest's phone or book; a guest's own hold blocked her verified booking; the Customer App's live stream refused every
  customer; POS Devices showed no payment terminals; the front desk got 403 on the technicians' help inbox.
- *Money:* the POS technician commission setting never reached payroll; membership and category commission rules never applied
  (lines had no category); the card surcharge was not recorded; owner finance showed $0 (final totals never stamped); POS
  Reports did not reconcile and invented a 4.8 rating and an 11 % trend; the cash drawer left out the cash part of a split;
  **the end-of-day commission report showed $0 after ~8 pm in US salons** (UTC date); owner "average ticket" mixed in tax / tips /
  gift cards.
- *Silently empty or lost:* customer Appointments and Loyalty tabs, POS Dashboard charts, "available technicians" panel, Super
  Admin active users / health; **audit records lost** (177 in one run — an empty branch id); **settings audit trail always empty**;
  "Added <service>" history lost; application-confirmation logs refused by the database.
- *Never ran:* **membership auto-renewals and renewal reminders had no scheduler** — added (needs the two env switches in §4).
- *Messaging:* the mock SMS / e-mail sender could run in production, record "sent" and charge the SMS meter — now refused in
  production ("not configured", never metered); outside production marked "simulated".
- *Onboarding / setup:* seeded Super Admin had no platform role; approving an application never changed its status (migration
  662); onboarding case not linked to its salon; the salon time zone not written to the branch; the AI receptionist used the
  wrong opening hours and the New York zone; a one-technician visit had no ticket until Service Done; "Add-ons" category refused;
  retail sold on the floor never moved stock; **owners can now invite front-desk staff and managers themselves** (managers need
  step-up).
- *Smaller:* "$-6.75" → "−$6.75" everywhere; owner date chip used the phone's date; malformed ids gave 500 instead of 400;
  Service Done / Serving guest details; checkout receipt note always said "sent"; Checkout totals had no surcharge line and
  called an unpaid total "Total Paid"; Owner payroll dates printed as "Thu Oct 15 …"; one unreachable route removed.

**Kevin's decisions (not built — each has a working default today):**
1. **Add-ons** — two models exist (`service_add_ons` table and services in an "Add-ons" category; the pilot uses the category).
   Pick one; the other is retired. (P-6)
2. **Kiosk add-ons** — the kiosk offers an add-on to any technician, but the queue only lets a technician mapped to that add-on
   take it. Pick: map add-ons to technicians, or let any technician who can do the main service do its add-ons. (P-7)
3. **Loyalty basis** — points are earned on gift-card purchases too, and not on the cash part of a split. Usual practice: no
   points for buying a gift card, points on every paid tender. Confirm. (P-14)
4. **Recipes** — product use is deducted only when recorded by hand; automatic deduction at Service Done is possible. (P-15)
5. **Super Admin scheduled reports** — two schedule stores exist and nothing runs them; pick the store, then a scheduler is
   added like the membership one. (SW-18)

Bugs found and fixed while merging (each with a failing test first): **existing salons' technicians would all have been refused
on accept / start after deploy** (in a copy of the dev database, 69 of 69 had no per-service rows) — fixed by migration 631
(category grants backfilled; unmapped technicians keep the old behaviour until a manager sets their services) and by no longer
requiring "clocked in" to start an already-assigned service; payroll periods split at UTC and dropped their last day; a
retail-commission reversal was silently dropped by a unique index; two helpers accepting one line at once failed; a technician's
first clock-in never entered the rotation; a staff phone-code screen could cover an active payment on the display; the go-check-in
settings save needed only a view permission.

---

## 3. What the developer needs to finish (code)

None of these blocks a pilot salon; each has a safe default today.

**Product decisions first (Kevin) — then small builds**
1. *(done Oct 13 — technician-authored showcase posts, migration 647)*
2. New Booking "Save Draft" (`apps/pos-web/src/screens/POSNewBookingScreen.tsx`) creates a real appointment with "[DRAFT]" in the
   notes. Choose: real drafts on `booking_holds`, or relabel / disable the button.
3. Technician realm: the other chat confined technicians to `/tech/*`; this tree lets technicians sign into the POS (kept). Decide.
4. Web push for Super Admin users (admin-web): there is no "admin" push audience on the server. Decide whether platform staff get pushes.
5. Platform role classification (`packages/permissions/src/platform-roles.ts:114`): POS Ticket Oversight sits under *support*,
   gift-card settlement under *marketing* — operations / finance roles cannot open them.

**Small code items**
6. *(done Oct 13 — technician CSV import with preview + commit)*
7. Skill review "start review / request more info" steps: the screens existed in the other chat; the backend routes do not here.
8. ~13 legacy readers still use `technician_statuses`; switch them to `technician_workforce_state`, then stop writing the compat row.
9. `technicians.service` pushes `technician_schedule_updated` directly — make it a domain event through the outbox like the rest.
10. Three PIN stores and some legacy joins (Technician Profile §29 cleanup); the kiosk PIN limiter is per-process (use the shared store).
11. Booking: per-service eligibility is enforced on accept / start / serving / open-slot booking; booking create, tech appointments and
    customer booking still use the category rule (`modules/booking`). One blocked-time writer consolidation (other chat) not done.
12. *(done Oct 13 — customer-app and AI-receptionist bookings now respect holds, shifts, breaks and blocked time under the same lock)*
12a. *(done Oct 13 — Tap to Pay app branch switch from More, refused while a payment is active on that phone)*
13. Multi-technician plans: next-appointment protection for a later "after" line is judged from now (shift end is per line); a
    "together" party only warns when moved to a shared start, it does not re-pick.
14. Fair Turn: `lateTechnicianPolicy` is stored and validated but both values behave the same; technicians already clocked in when
    this ships join the rotation at the manager's Join or the next day-start sweep; add retention-policy entries for
    `technician_turn_events` / `technician_turn_state`; language matching has no customer data to match on.
15. Payroll: time-correction concurrency (§187, in the time-clock correction path); Support-Mode payroll view returns status and
    counts only; the external payroll provider is a port with a "not configured" provider (pick a provider, then implement it).
16. Certification expiry reminders are in-app only (no durable email queue yet).
17. Outgoing partner-webhook dispatcher has no scheduler (`processDue` runs on `POST …/process`).
18. Browser (Playwright) runs of the queue-assignment, scheduling-optimizer and Fair Turn screens against the live API (today:
    jsdom screen tests + live API proofs).
19. Super Admin security overview returns raw `e.message` on a 500; four thin read controllers have no spec.
20. Legacy display URLs (`?deviceToken=`, check-in slug) stay until every display runs this build; then remove them.

21. Tip notifications: a paid, tipped ticket waits (retried) until payroll has written its tip split — the technician is
    told HER share, never an invented whole-ticket amount. If a split never lands (snapshot failure), that event goes to the
    dead-letter list in Super Admin with `tip_allocation_pending`; retry it after the compensation recovery worker has run.

**Smooth Refresh timing** — see §6.

---

## 4. Deploying this tree over a running salon (order matters)

1. Back up the production database (and test the restore — `scripts/restore-verify.ts`).
2. `MIGRATE_DATABASE_URL=<owner url> node apps/api/scripts/migrate.mjs` — migrations up to **663** (Oct 13: 638–641 payments / Twilio, 646–647 technician, 660–661 Tap to Pay, 662 application statuses, 663 simulated / blocked message statuses; all additive). 631 is the back-compat step for
   technician eligibility: without it, existing technicians are refused on accept / start. Every constraint migration has a
   pre-flight; anything it cannot apply is deferred and shown in Super Admin → Database (retry button), never a failed deploy.
3. Once: `purge-raw-card-numbers.mjs` (removes any card number the old customer web Pay screen saved as a "token"), `db-backfill-summaries.mjs`, `db-backfill-customer-identity.mjs`, and `seal-bank-webhook-secrets.mjs` if 542 deferred.
4. Environment: `docs/HOSTING_ACTIONS_FOR_KEVIN.md` + `DEPLOYMENT.md` §6 (every variable, which are secrets). New in this package:
   `FCM_SERVICE_ACCOUNT_JSON` (replaces the committed Firebase file), **`MEMBERSHIP_RENEWALS_CRON_ENABLED=1` and
   `MEMBERSHIP_AUTOBILL_ENABLED=1` (without both, memberships never auto-renew)**, never set `MESSAGING_MOCK_SENDERS` in production
   (startup refuses it), `EVENT_PUBLISHER_ENABLED=1` on any non-production server where event consumers should run, `VITE_FIREBASE_WEB_CONFIG` / `VITE_FIREBASE_VAPID_KEY` (web push;
   off until set), `CERT_EXPIRY_REMINDER_ENABLED`, `COMPENSATION_RECOVERY` (on by default), `ALERT_ACK_SECRET`, `CLAMAV_HOST`.
5. After deploy, managers should open each technician's services once (POS → Technicians) — the first explicit list switches that
   technician from the legacy category rule to exact-service eligibility.

---

## 5. Decisions taken with a default (Kevin can overrule any)

Fair Turn: default mode RECOMMEND_AND_CONFIRM; default fairness mode "traditional weighted rotation"; turn credit at Service Done,
technician moves to the back at assignment; legacy rotation policies keep their scoring. Payroll: overtime is flagged, never paid
automatically; managers get `payroll.adjust` only; large adjustments wait for approval; a refund after lock becomes a pending
next-period entry + an exception. Display: the POS register is the "POS device"; Kevin's 23-inch layout is the check-in home;
walk-in asks first name + phone only. Auto-lock: device may choose a shorter time than the salon's (1–120 min), never switch it off;
5 wrong PINs end the session. Multi-technician: one technician preferred within 15 min of a split; at most 2 technicians on one
guest at once, 3 per visit; parties never auto-assigned. Holds: placing a hold needs `pos.booking.create`. Events: `visit.started`,
`checkout.started`, `payment.authorized` retired. Full list: `docs/PROGRAMME_DOD_STATUS.md` (DECIDED rows) and the phase reports.

---

## 6. Smooth Refresh — timing kept (Kevin, Oct 13 2026)

Kevin's final decision (Oct 13): **keep the 15-second POS safety sync and the 20-second server reconciliation**, and never rely on
either to prevent double booking. `packages/realtime-client/src/sync-policy.ts` `operationalMs: 15_000` (± 2 s jitter, 60 s
while hidden); `apps/api/src/observability/sync-reconciliation.ts` `RECONCILE_EVERY_MS = 20_000` (also frees expired booking holds).
The short-lived 45 s change of Oct 12 was undone and its tests restored. Double booking is blocked by the backend/database at the
moment a booking is created or moved — see §2a (Smooth Refresh row): every create / move path takes the technician-day lock in one
transaction, re-reads, checks holds and the version, and the database EXCLUDE constraint is the last line; a loser gets 409
`APPOINTMENT_CONFLICT`, proven on real Postgres with 10 simultaneous devices. The other chat's `OPTIONAL-smooth-refresh-reverted.patch` is not applied.

---

## 7. Verification of this package

Final full run, Oct 13–14 night, after wave 4 (TZ=UTC; fresh database, 603 migrations through 663):

| Lane | Result |
|---|---|
| CI gates | **47 gates + 13 audits passed** (new this package: `check:one-payroll-calculation`, `check:supply-chain-injection`) |
| API | **2,852 passed, 0 failed** (6 shards) |
| Modules | **all suites passed** (super-admin 1,930 · workforce 915 · checkout 733 · queue 658 · booking 666 · identity 542 …) |
| Web apps | **all suites passed** (pos-web 1,365 · admin-web 1,035 · owner-web 335 · tech-web 182 · customer-web 275 · manager-pay-web 89 …) |
| Packages | 20 suites, all passed |
| Nest-free harnesses | 124 / 0 |
| Real-Postgres race lane (fresh DB) | **294 tests, 86 files, 0 failed** |
| **Pilot day** | **74/74** — one salon, onboarding to payroll lock, real API + database + built apps in Chromium, 0 unexpected database errors (`docs/PILOT_DAY_REPORT.md`) |
| **Every route / every module** | route sweep **14/14** (2,913 routes mounted; 1,398 live calls, 0 server errors; 1,039 refusals, no leak) · event wiring **17/17** (282 events, every consumer ran, nothing dead-lettered) |
| Live proofs on a booted API | money chain 25/25 · Fair Turn 22/22 · payroll 23/23 · multi-technician 21/21 · POS auto-lock 25/25 · telemetry 22/22 · cross-salon IDOR 8/8 · database 31/31 · RLS 20/20 · permissions 28/28 · native realtime 17/17 · app version 17/17 · offline 13/13 · async exports 21/21 · `/api/v1` 19/19 · deals 39/39 · phone management 48/48 · foundations 22/22 · display lifecycle 30/30 · ads 42/42 · journeys · devices · check-in · 23-inch 37/37 · ads page 14/14 · layout 439/439 · tracing 16/16 · drills Redis-loss, worker-loss, restore · refresh 10/10 · queue 33/33 · scheduling 31/31 · community 25/25 · `e2e:html` |
| Definition of Done | `programme-dod.mjs`: **MET** |

Not covered by this run: a click-through of every screen of every app in a browser (the pilot drives the key screens; the
Super Admin app was swept screen by screen in wave 2). Real-device tests (iPhone Tap to Pay, the 23-inch display, Android
kiosks) need the hardware and provider accounts in §8.

---|---|
| CI gates | **46 gates + 13 audits passed** (new: `check:one-payroll-calculation`) |
| API | **2,844 passed, 0 failed** (6 shards) |
| Modules | **27 suites, all passed** (super-admin 1,899 · checkout 726 · booking 666 · identity 542 · workforce 883 …) |
| Web apps | all suites passed (pos-web 1,355 · admin-web 1,035 · owner-web 335 · tech-web 180 · customer-web 275 · manager-pay-web 89 …) |
| Packages | 20 suites, all passed |
| Nest-free harnesses | 124 / 0 |
| Real-Postgres race lane (fresh DB) | **294 tests, 86 files, 0 failed** (incl. Tap to Pay 8, booking create/move 39, checkout payments 12) |
| Live proofs on a booted API | **money chain 25/25** (Fair Turn → Service Done → Checkout → Payment → Commission/Tip → Pay Period → Approve → Lock → Payout/Export → Refund/Reversal) · Fair Turn 22/22 · payroll 23/23 · multi-technician 21/21 · POS auto-lock 25/25 · telemetry 22/22 · cross-salon IDOR 8/8 · database 31/31 · RLS 20/20 · permissions 28/28 · native realtime 17/17 · app version 17/17 · offline 13/13 · async exports 21/21 · `/api/v1` 19/19 · deals 39/39 · display lifecycle 30/30 · ads 42/42 · journeys · devices · check-in · 23-inch 37/37 · ads page 14/14 · layout 439/439 · tracing 16/16 · drills Redis-loss 13/13, worker-loss 13/13, restore 11/11 · refresh 10/10 · queue 33/33 · scheduling 31/31 · community 25/25 · `e2e:html` |
| Definition of Done | `programme-dod.mjs`: **MET** |

---|---|
| CI gates | **45 gates + 13 audits passed** (new this package: `check:event-producers`, `check:realtime-catalog`, `check:unique-tenant-review`, `inert controls`) |
| API | **2,829 passed, 0 failed** (6 shards) |
| Modules | **27 suites, all passed** (workforce 865, queue 635, checkout 670, super-admin 1,894, ai 1,976, booking 659, identity 535 …) |
| Web apps | **8 suites, all passed** (pos-web 1,334 · admin-web 1,027 · owner-web 331 · tech-web 177 · customer-web 273 · customer-display 201 …) |
| Packages | 20 suites, all passed |
| Nest-free harnesses | 124 / 0 |
| Real-Postgres race lane (fresh DB) | **275 tests, 83 files, 0 failed** |
| Live proofs on a booted API | Fair Turn 22/22 · payroll 23/23 · multi-technician 21/21 · POS auto-lock 25/25 · telemetry 22/22 · cross-salon IDOR 8/8 · native realtime 17/17 · app version 17/17 · offline 13/13 · async exports 21/21 · `/api/v1` 19/19 · deals 39/39 · display lifecycle 30/30 · ads 42/42 · journeys · check-in · 23-inch 37/37 · ads page 14/14 · layout 439/439 · display devices (passed on its own re-run; its "≈3 s completion" check measured 2.81 s under full load — timing-sensitive) · tracing 16/16 · drills Redis-loss 13/13, worker-loss 13/13, restore 11/11 · database 31/31 · RLS 20/20 · permissions 28/28 · refresh 10/10 · queue 33/33 · scheduling 31/31 · community 25/25 · `e2e:html` |
| Definition of Done | `programme-dod.mjs`: **MET** — 303 scripted lines: 283 DONE · 18 HOSTING · 2 DECIDED · 0 PARTIAL · 0 NOT DONE |

After the run, the POS sync timing changed (later restored to 15 s, Oct 13) (re-run: realtime-client 28/28, pos-web 1,334/1,334, customer-display 201,
owner-web 331, tech-web 177, customer-web 273, gates 45 + 13).

---

## 8. What only Kevin can do

`PROGRAMME_FINAL_REPORT_2026-10-10.md` §5 (de-duplicated, "before the first paying salon" first) and
`docs/HOSTING_ACTIONS_FOR_KEVIN.md` (exact steps). Top of the list: the four security items in §1; for Tap to Pay: Apple's Tap to Pay on iPhone entitlement + App Store review, Fiserv's Tap to Pay iOS SDK + CommerceHub credentials + webhook secret, enrollment per merchant, then a $1 sale + void; for card terminals: each salon's Fiserv MID / Bolt key and a Clover Compact on that MID; Twilio A2P brand + campaign approval and a number per salon (`docs/payments/*`, `docs/integrations/*`); database backups + PITR +
a real restore test; least-privilege database logins (`db-provision-roles.mjs`); private Postgres / Redis; TLS + WAF; Twilio /
SendGrid / Fiserv credentials in Super Admin; Firebase + APNs for push; a ClamAV service; an independent penetration test; real-device
mobile testing; on-call contacts. Licensing: confirm the salon photo the developer added to the POS login screen is licensed
(`SALON_PHOTO_README.md`).
