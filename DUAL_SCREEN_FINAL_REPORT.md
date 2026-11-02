# 23-Inch Dual-Screen Check-In, Checkout Display & Tenant Advertising — final report (§131)

Spec: Kevin, Oct 5 2026, §1–§131. Branch `work/dual-screen-display` (10 commits on top of master `06f2a79c`, which is
untouched). The working record — what was found, decided and proven unit by unit — is `DUAL_SCREEN_DISPLAY_AUDIT.md`
(Parts A–D); the change log is `CHANGELOG_HANDOFF.md`. This report answers §131 item by item and checks §130's
Definition of Done against evidence. Nothing below is claimed without a test or a live run that was executed.

Kevin's layout, as built: check-in stays on the left and centre; the right panel is the salon's advertising until a
checkout begins, then that customer's live ticket; after payment the completed summary for 3 seconds, every customer
field wiped, and the panel returns to advertising. The POS stays fully usable throughout.

---

### 1. Existing code discovered
Audit Part A (every row read in source on Oct 5): the customer display app (React/Vite/Capacitor — one screen at a time,
no three-column layout), `customer_display_devices` with a token in the URL, `customer_display_sessions`, the Go
Check-In module (17 routes, slug-started kiosk sessions), the checkout module and POS send-to-display flow, the realtime
registry and stream factory, `packages/media`, POS Marketing & Growth navigation. No advertising anything. Kept and
extended rather than duplicated (§128); two duplicates removed (below).

### 2. Problems found (pre-existing, all fixed; each pinned by a test that fails without the fix)
- Ten kiosks checking one appointment in at once made ten queue entries (migration 503).
- Two stations sharing a display replaced each other's customer, even mid-payment (row lock + migration 505).
- An idle display subscribed to no realtime room — it never heard a checkout start; POS tip / discount / promotion /
  deal / reward-code writes emitted nothing.
- The display kept the previous customer's totals in memory; the server re-served a paid session for 10 minutes.
- The discount-stack loader rebuilt the stack from nothing — a manual discount silently removed a promotion.
- Terminal capture charged the display session's stale copy: a gift card's share charged again, a paid ticket charged twice.
- The "MFA recovery codes generated" security event was refused by the database and dropped (migration 510).
- Six web apps did not build for production.
- A request storm (hundreds per second) on every display showing Go Check-In; the check-in vanished during checkout;
  a display could be handed another branch's kiosk — its guests landed in that branch's queue.
- The salon logo upload lived in process memory and was shown nowhere.
- The front desk was refused (403) on Send to Display; a released checkout stayed "on the display"; a cash receipt
  quoted the card total; "Test" made switched-off displays look online.
- The kiosk showed the salon's whole price list (both branches'); every technician regardless of shift or skill; one
  service of one appointment; a salon with service choice off could take no self check-in walk-ins; the queue dropped
  add-ons and price-override reasons; check-in KPIs and the wait counted the UTC day (after 8 pm in New York waiting
  guests vanished and the wait fell to zero).

### 3. Check-In code fixed (Units 1, 4, 7)
One active entry per appointment / customer; the display checks guests in with its own credential, one session per
guest; the branch's catalog and prices; working + qualified technicians (server-enforced); the visit of several
services and appointments, one "I'm Here"; the quick walk-in (first name, phone, services, add-ons with a service,
returning guest linked); the queue engine's band; walk-away clearing; the branch's day.

### 4. Checkout Display code fixed (Units 1, 2, 6)
A customer-safe projection built by the checkout module from the POS's own ticket (`CustomerDisplayCheckout`); every
number from the ticket; tip and method written to the ticket; `payment_verifying`; the receipt choice, then the 3-second
summary (no signature on the display — since Oct 6 the cardholder signs once, on the Clover terminal); release on the server; stale-version guard.

### 5. Dual-screen architecture
One POS, two screens, one backend: the display is a paired device of the branch with its own credential and channel;
the POS's Send to Display attaches a checkout to it; both read the same checkout. The Android display (Capacitor) and a
monitor on the Windows POS (the same app in a browser window) use one API, session, realtime contract and playlist
(§126–§127); they differ only in where the credential is kept.

### 6. 23-inch layout
`Display23`: brand header; keypad; appointment / walk-in; result footer; right panel ~35% decided by one pure function
(`rightPanelMode`, checkout first; an ad never covers a payment). Sized from the viewport (`--u`), 44 px minimum targets,
no page scroll at any 16:9 size; a long ticket scrolls inside its list with the totals pinned.

### 7. Device / POS pairing (Unit 6)
The display shows an 8-digit code; the owner types it in POS → Devices → Customer Displays; salon and branch come from
the owner's session; the credential is minted at pickup and handed over once; only hashes stored; secure store on the
device, header-only on the wire; registers with dedicated or shared displays; heartbeat-driven ONLINE/OFFLINE and the §85
states; maintenance, refresh, revoke — all audited.

### 8. Customer Display session
`customer_display_sessions` per ticket, reserved under a row lock (DISPLAY_BUSY); Send / Switch / Cancel from the POS;
released on the server after the 3 seconds (paid and signed only); a paid session older than 2 minutes is closed on read.

### 9. Realtime
The display's own channel `customer_display:device:{id}` (§100) plus the session and ticket rooms while a checkout is
attached; ids-only events; `sessionId` + `version` on every state, stale ones dropped (§101); reconnect re-authenticates,
refetches state and playlist (§102); a 15-second visible-only safety sync (measured live: every 13–16 s on an untouched
display).

### 10. 3-second transition
Starts only on server-confirmed completion with no receipt choice pending; 3000 ms in code (pinned by
tests); measured from outside: 2.3–3.5 s across live runs (screenshot timing included).

### 11. Customer privacy cleanup
The idle state is rebuilt from nothing (never a spread of the customer state); only the salon's branding is copied, field
by field; the session is released on the server; a released session is never rendered again; typed check-in data is
cleared at confirmation; a walk-away is cleared after 90 s. §107 is checked on EVERY recorded frame in the live journeys:
from the first advertising frame no name, phone, service, price, tip, method or receipt destination; the frame before it
is the completed summary.

### 12. Advertising domain (Unit 3)
`@aipowersalon/marketing` → `display-advertising` (not checkout, §112); migration 509 (six tables, composite tenant keys,
CHECKs); statuses SCHEDULED / ACTIVE / EXPIRED worked out in the branch's time zone; version-checked edits; audited.

### 13. Advertisement upload
The owner's browser makes the 1920/1080/320 px copies and a smart-crop point; the server checks magic bytes, MIME,
extension, size, real dimensions and shape for every copy; ad-count and storage limits under a per-salon lock.

### 14. Advertisement playlist
`GET /customer-display/device/ads` — salon, branch and display from the token only; layers platform + plan → salon →
branch → display; priority then publish order; `refreshAfterSeconds` = next schedule boundary; `validUntil`;
`offReason`. The display caches pictures on the device and plays them through outages.

### 15. Branch targeting
All branches or a list; branch managers manage only ads aimed at their branch alone. Proven live (§120 below).

### 16. Media / object storage
Reuses `packages/media` (local disk or S3/CDN); the database keeps keys and metadata only; the original sits under a
random token no response carries; archive + delete removes the files.

### 17. POS Advertising Management page
Marketing & Growth → Customer Display Advertising: Advertisements (simple mode = upload + Publish now; full editor),
Playlist, Schedule, Branches, Display Preview (the real 23-inch layout with the branch's playlist), Analytics (active /
scheduled / expired, display count, displays showing ads, branches), Settings.

### 18. Permissions
`pos.customer_display_ads.*` — view, create, update, publish, pause, archive (owner manages all; a branch manager only ads aimed at their branch alone); `pos.customer_display.manage` (pair,
rename, register, maintenance, revoke — owner) and `pos.customer_display.operate` (send, switch, refresh, cancel — rides
the checkout permission, so the front desk can); display routes authenticate by device or session token, never a staff
session. Pinned by `packages/permissions` tests and the OpenAPI review record.

### 19. Audit
Ads (create, edit, schedule, publish, pause, archive, restore, delete, upload, settings, per-display switch) and devices
(paired, connected, renamed, register changed, maintenance on/off, revoked; registers created / renamed / retired), each
in the change's transaction. Check-in sessions log display / kiosk identity.

### 20. Database migrations
503 one active check-in · 505 one active display session · 509 display advertising · 510 security event CHECK ·
511 display pairing, registers, heartbeat · 512 check-in sessions belong to exactly one device (kiosk or display) ·
513 a payment signature taken on the terminal (Unit 10) · 514 Hold Ticket and a ticket's register (Unit 11) ·
515 which gift card paid · 516 a check-in session's allowances on its row (Unit 12).
(504 and 506–508 were reserved by the removed `spec/checkin-display-oct5` branch and are unused.)

### 21. API routes
Display (public, device or session token): `GET customer-display/device/ads`, `POST device/ads/displays`,
`device/heartbeat`, `device/receipt`, `device/release`, `device/check-in/session`, `checkout/:id/receipt`, `pairing`,
`pairing/:id/poll`. POS (session): `pos/customer-displays` (+ `pair`, `stations`, `:id` PATCH, `refresh`, `revoke`),
`pos/marketing/display-ads` (state, CRUD, media, publish / pause / archive / restore, settings, branch and device
settings, analytics, branch playlist preview), `pos/settings/receipts-branding/logo`. Removed: the staff-side pairing /
test / status routes and the token-issuing admin route. The full list with realm, auth and permission is the reviewed
manifest `apps/api/openapi/manifest.txt` (2,601 routes after Unit 11, `check:openapi` green).

### 22. Realtime contracts
`customer_display_session_started`, `_checkout_updated`, `_completed`, `_canceled`, `_ads_updated`,
`_device_updated`, `_refresh_requested`; room `customer_display:device:{id}`; ids-only payloads.

### 23. Files created · 24. Files changed
240 files: 116 created (66 of them shipped code, migrations and build tooling; the rest tests, proofs and docs), 122 changed, 2 deleted
(`customer-display-admin.controller.ts`, `verify-device-pairing-db.ts`). Full list:
`git diff --name-status 06f2a79c..work/dual-screen-display`. Main new code: `apps/customer-display/src/{Display23,
CheckIn23,CheckoutPanel,CheckoutTicket,DeviceScreens,Branding}.tsx`, its hooks (`useCheckInFlow`, `useGoCheckIn`,
`useAdPlaylist`, `useCredentials`, `useHeartbeat`, `usePairing`, `useIdle`, `useViewport`), `deviceCredential.ts`,
`headerEventSource.ts`, `adAssets.ts`; `apps/api/src/customer-display/display-devices.*`, `display-pairing.repository.ts`,
`customer-display-branding.ts`; `modules/marketing/src/display-advertising/*`; `modules/checkout/src/checkout/
{customer-display-projection,display-send-core}.ts`; `modules/queue/src/go-check-in/go-check-in-rules.ts`;
`modules/tenants/src/settings/salon-logo.ts`; POS `CustomerDisplayCard`, `POSCustomerDisplaysScreen`,
`POSDisplayAdsScreen` + `display-ads/*`, `SalonLogoSetting`; contracts in `packages/api-contracts`; `DisplayAdSlide` in
`packages/ui`.

### 25. Tests
Final full lanes (Unit 7 code; Units 9–11 re-ran every lane — see the audit's verification tables): API 1,786 passed / 0 failed (6 shards); modules 6,728 / 0; web apps
2,597 / 0 (+9 in Unit 8 — 2,606); packages 146 / 0; Nest-free harnesses 124 / 0; real-Postgres race lane 30 files, 105
tests, 0 skipped on a fresh database with every migration; 35/35 gates. Live proofs (real API + Postgres + Chromium):
lifecycle 29/29, advertising 42/42 + browser 14/14, 23-inch 37/37, devices 29/29, check-in 39/39, journeys 43/43.
Mutation checks (break the code, run the tests, restore and verify by sha256): Unit 3 28, Unit 4 48, Unit 6 52, Unit 7
58, Unit 8 3 (plus Units 1–2's lists in the audit) — all caught except one equivalent survivor in Unit 6 (a service check
the repository enforces anyway); 11 were caught only after the weak test each exposed was strengthened.

### 26–28. Layout at 1920×1080 · 1600×900 · 1366×768
`tooling/e2e/customer-display-layout.mjs` against the built app, measured (not eyeballed): 222/222 — at each size: idle
+ ad, a visit found (compact and opened), checked in, a walk-in with seven services, two add-ons and a technician, the
spec's checkout, a 24-line checkout (scrolls inside, totals pinned), customer pays, processing, completed; plus
full-screen idle. No page scroll, no clipped control, no overlap, every button ≥ 44 px, number pad and tip buttons
usable, ads never distorted. The live check-in proof measured the same at the three sizes on the real stack.

### 29. Tenant isolation tests
Unit 3 API proof (the other salon's display plays only its own ad; its ad id is "not found" from our POS; its image cannot
be used); Unit 8 journeys in the browser (§119): the other salon's display shows its ad, never fetches our picture, never
shows our headline; restarted during our customer's checkout it shows its own screen; its check-in is its own (switched
off → 403). Code level: `display-devices`, `go-check-in` real-schema tests (composite foreign keys, a display of another
salon is "not found"), the tenant-isolation statement allowlist, `tenant-isolation.pgtest`.

### 30. Branch isolation tests
§120 live: an ad for Main only — Main's display plays it, the proof branch's display never does; a display's check-in
shows only its branch's services, appointments and technicians (Main's display finds no appointment of the proof
branch); Send to Display never uses another register's display; the branch's other display never shows the checkout
(§100), even when restarted mid-checkout.

### 31. Reconnect tests
Unit tests (stream re-opened per session, resync on reconnect, fallback poller, version guard); live: the API stopped
mid-checkout — the display keeps the checkout with no blank or ad, reconnects by itself when the API returns and hears
the next POS change (2.6 s); idle: the ad keeps playing while the API is down and the display reconnects in ~13 s
(Unit 4).

### 32. Checkout recovery tests
§103 live: the display restarted mid-checkout comes back to the same customer's checkout in ~0.3 s — every recorded
frame checked: no advertising frame before it (mutation-checked: a display that shows ads while loading is caught);
§104: a restart with no checkout is check-in + ads; a paid checkout restarted after 2 minutes is never shown again.

### 33. Advertising cache tests
`ads.test.ts`, `useAdPlaylist.test.tsx` (pictures play only once cached; eviction; offline list until `validUntil`;
report batches retried under the same id); live: API down → the ad keeps playing; restart with the API down → the salon
and its saved ad (Unit 4).

### 34. Build · 35. Typecheck · 36. Lint
All seven web apps build for production (gate `frontend builds`); the API and every module build; `tsc` clean in the
API, queue, display and POS; lint 0 errors and no new warnings (the ratchet gate — it caught one new hook warning in
Unit 7, fixed).

### 37. Remaining external dependencies
- SMS / email receipts need real providers: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`; `SENDGRID_API_KEY`
  (without them the display skips the question — it never claims a receipt it cannot send).
- Second-monitor placement needs the Window Management API (Chrome / Edge, one permission); other browsers open a window
  to drag.
- The POS needs `VITE_CUSTOMER_DISPLAY_URL` at build time for "Open on second screen".
- Object storage: S3-compatible bucket / CDN in production (`packages/media`), local disk otherwise.
- ~~The display loads its two typefaces from Google Fonts~~ — bundled with the app in Unit 12 (the link had misspelled the
  sans face, so it had never loaded).
- No malware scanner exists on the platform (uploads are limited to checked JPEG/PNG/WebP). *Superseded Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep): since Phase 14 every upload through the shared policy is scanned by ClamAV when `CLAMAV_HOST` is set (`packages/media/src/clamav-scanner.ts`; `CLAMAV_REQUIRED=1` refuses uploads while it is down); running the clamd service is `docs/HOSTING_ACTIONS_FOR_KEVIN.md` D2.*

### 38. Remaining risks (recorded, not fixed)
- ~~`date_trunc('day', now())` (the database's UTC day) in 38 places in 14 repositories outside check-in~~ — fixed after
  this report (Unit 9): every salon-facing count uses the branch's day (29 files, incl. the cash drawer and the Owner App);
  Super Admin's platform-wide screens and three platform jobs keep the UTC day on purpose; a ratchet stops new ones.
- ~~A guest's chosen technician: assigned or requested — Kevin's call~~ — **decided (Oct 6): assigned**, as the POS walk-in
  records it; pinned by a real-schema test.
- ~~The 8-lookup / 3-profile allowances are counted per API instance~~ — on the session row since Unit 12.
- ~~A visit of several appointments is checked in one appointment at a time~~ — all or nothing, in one transaction, since
  Unit 13.
- ~~A terminal charge from the display and a POS cash payment at the same instant are not serialized by one lock~~ —
  fixed in Unit 11: both take the ticket's one checkout lock; the front desk gets `PAYMENT_IN_PROGRESS` while the
  customer pays on the terminal, and the display's charge does not start while the front desk records one. (Found with
  it: a ticket paid in cash was still charged the card-fee difference by the display — fixed.)
- ~~Card terminals are not tied to registers; Hold Ticket / Move to Front Desk on POS Checkout only show a message~~ —
  fixed in Unit 11: a terminal serves one of the location's registers (chosen in Devices) and the display's charge uses
  its register's terminal; Hold / Resume and Move to a register are real (migration 514).
- ~~35 committed files carried an outside database server's login~~ — removed in Unit 11; every script requires
  `DATABASE_URL` and the `db credentials` audit keeps it out. **The login is still in the git history: rotate that
  password and close port 5432 to the internet.**
- ~~A gift-card payment cannot show the card's last four digits~~ — fixed in Unit 12 (the payment keeps them; the ledger row
  names the ticket and the payment).
- ~~Every approved card payment asks for a signature on the display~~ — **decided (Oct 6): the cardholder signs once, on
  the Clover terminal.** The display no longer asks; the display's terminal charge asks the Clover for the signature and
  keeps it on the payment (Unit 10). Still to confirm on a powered-on Clover: that authCard returns the signature and in
  which encoding (`apps/api/scripts/bolt_uat_roundtrip.py --tap` now reports it).
- `goCheckInSlug` and `?deviceToken=` are still accepted for displays built before these units — remove once every
  display runs this build.
- About 140 places in server code use local-time date methods — ~~recommend `TZ=UTC`~~ the API and the worker now put
  themselves on UTC at start (Unit 12).
- The brand typeface is misspelled platform-wide ("Hanken Grotesque"), so the other apps show the system sans — a
  decision for Kevin (audit Part C).
- ~~The Tech App reads a queue line's minutes from a field the queue does not write~~ — fixed in Unit 9, with the front
  desk's price change.

---

## §130 Definition of Done — checked

| Item | Evidence |
|---|---|
| 23-inch layout fits correctly | layout 222/222 at three sizes; live check-in proof at three sizes |
| Check-In works · appointment lookup · walk-in · multiple services · wait time | journeys §117/§118 live; check-in proof 39/39; queue 351 tests |
| Correct tenant binding · correct branch binding | §119/§120 live; real-schema tests (migration 512 composite keys); check-in isolation live |
| POS pairing works | devices proof 29/29 (code typed in the POS, credential collected once) |
| Realtime works | POS Queue shows the guest 0.4 s after "I'm Here"; Send to Display 0.17 s; a POS discount on the display in 0.08 s |
| Checkout automatically takes over the ad panel | journeys: the ad is gone (not covered) the moment Send to Display lands |
| Completed services · technician names · products · discounts · membership · loyalty · gift card · subtotal · tax | projection tests (17 + 6 real-schema), Unit 2 live 28/28, layout's §33 ticket; journeys show services, add-on, first names, discount |
| Customer fees only when applicable | projection tests; journeys: cash shows no card fee, the total paid equals the POS's payment |
| Tip selection works | journeys: 20% tapped on the display lands on the POS ticket (20% of the discounted subtotal) |
| Total Due · payment status · Payment Complete | journeys; Unit 1 lifecycle proof; `payment_verifying` tests |
| Receipt flow works | devices proof (masked, recorded once, honest outcome); journeys (asked, "No receipt") |
| 3-second timer · customer state clears · advertising returns | journeys: 2.97 s from outside, every later frame clean, same screen throughout |
| Owner can add / edit / publish / pause / schedule / target ads; multiple ads rotate; images fit; preview works | advertising proofs 42/42 + 14/14; journeys publish two ads from the POS; Unit 4 rotation and fit tests |
| Tenant A never sees Tenant B ads · Branch A targeting works | §119/§120 live in the browser |
| Cached ads work during temporary outage | Unit 4 live (API down: ad keeps playing; offline restart) |
| Display restart recovers active checkout | §103 live, frame-checked, mutation-checked |
| POS continues if display goes offline | devices proof: Offline card, To Display disabled, checkout continues |
| No production mock data remains | `productionData.test.ts` scans every shipped display, kiosk, POS-display and server file (mutation-checked) |
| No full-screen refresh / shading | journeys: one screen element from check-in through checkout, receipt, summary and ads; no reload |
| Build · typecheck · lint · tests pass | 35/35 gates; all suites above |

---

## Re-verified on Oct 8 2026 (after Build Phases 1–11)

Kevin asked whether this system is 100% finished. Rather than trust the report above, every proof was re-run on today's
tree (`a48bc1f1` + this change) — after eleven build phases had changed permissions (default deny), rate limiting (per-salon
limiter ON), storage (no hard-coded bucket, env/tenant key prefixes), checkout (the board bounded to today), the deals
engine and the database (constraints, RLS plumbing, actor stamps):

| Proof | Result today |
|---|---|
| `live-display-lifecycle.mjs` (API + PostgreSQL: Send to Display, live tip, discount stack, payment, release, 3-second clear) | **30/30** — after one fixture update (below) |
| `live-display-ads.mjs` (upload to object storage, publish → SSE, schedule, pause, isolation) | **42/42** |
| `live-display-23in-browser.mjs` (Chromium 1920×1080: idle layout, branding from the POS, full-screen idle ads, checkout takes the panel, summary, return to ads, offline restart) | **37/37** |
| `live-display-ads-browser.mjs` (the POS advertising page, browser-made derivatives, preview) | **14/14** |
| `live-display-checkin-browser.mjs` (device identity, branch catalog + prices, appointment and walk-in check-in, wait time) | **39/39** |
| `live-display-devices-browser.mjs` (pairing code, credential, heartbeat, offline card, second screen, revoke, audit) | **29/29** |
| `live-display-journeys-browser.mjs` (§117 appointment journey, §118 walk-in journey, §119/§120 isolation, reconnect / restart / cleanup) | **43/43** |
| `tooling/e2e/customer-display-layout.mjs` (§121 measured at 1920×1080, 1600×900, 1366×768) | **255/255** |
| customer-display app tests (incl. the production-data scan and the ad cache) · API display suites · ads module · projection | 173/173 · 111/111 · 89/89 · 23/23; `tsc` clean |

**One stale fixture, not a product defect:** the lifecycle proof seeded a "$5 promotion" directly into the ticket's
discount snapshot. Since Build Phase 5 a coupon lives in the deals ledger with its locked terms and every re-pricing reads
the ledger, so a snapshot entry alone is no longer a promotion — the manual discount correctly re-priced the ticket
without it. The proof now creates a real $5 coupon through the POS deals API, publishes it, redeems it on the ticket, then
adds the manual discount: both survive (`coupon:500, manual:300`, $8 off) and the display lists both ("Coupon: Promo:
FALL5 −$5", "Discount −$3"). Also noted while running: the browser proofs need `CHROMIUM_PATH` pointed at the installed
Chromium when Playwright's own download is absent, the check-in proof needs a working day ahead at the branch
(`PROOF_TZ`), and the POS must be built with `VITE_CUSTOMER_DISPLAY_URL` for "Open on second screen" — all documented in
the scripts' headers.

Every §130 line above holds on today's tree. Nothing in this system was changed except the proof fixture.

---

## Oct 12 2026 — the Dual-Screen Completion Mandate (§1–§121), audited line by line and completed

Kevin's second dual-screen mandate (one POS computer, two screens, one backend) was checked section by section against
this tree; most of it was already built and proven above. What it found missing, and what was built (each with tests that
fail without it, and mutation checks):

- **§11–§12 one display state model.** `packages/api-contracts/src/display-mode.ts` — `customerDisplayMode()`: CHECKOUT ·
  PAYMENT_PROCESSING · PAYMENT_VERIFYING · PAYMENT_COMPLETE · CHECK_IN · CHECK_IN_LOOKUP · APPOINTMENT_FOUND · WALK_IN ·
  CHECK_IN_SUCCESS · PHONE_VERIFICATION · MAINTENANCE · OFFLINE · ADVERTISEMENT, in the mandate's priority. The display
  renders every screen from it (no competing booleans) and its heartbeat reports it. Found: a staff-requested phone code
  covered an active payment — now it can sit only on that customer's own checkout, never on a payment.
- **§81 offline check-in.** The display now knows when the server stops answering: with nobody at checkout the check-in
  says "We’re temporarily offline. Please see the receptionist.", what was typed is dropped, the cached ads keep playing;
  a checkout on screen stays. (Before, only a display that STARTED offline said so.)
- **§104 standard error codes.** All ten registered (`ERROR_REGISTRY`) and thrown where they apply: Send to Display
  (NOT_CONFIGURED, OFFLINE, CONTEXT_MISMATCH, SESSION_NOT_FOUND), the display API (SESSION_NOT_FOUND 404, SESSION_EXPIRED
  410), check-in (CHECKIN_ALREADY_EXISTS 409, CHECKIN_APPOINTMENT_NOT_FOUND 404, CHECKIN_BRANCH_MISMATCH 403); the stream's
  `resync_required` frame is REALTIME_RESYNC_REQUIRED.
- **§107–§108 logging and metrics.** `aipowersalon_customer_display_events_total` (check-ins, failures, display sessions,
  DISPLAY_BUSY, reconnects, ad impressions, playlist failures), `aipowersalon_customer_display_state_seconds`, and one
  `customer_display.operation` log line (device, operation, mode, duration — no customer field); device requests carry
  their salon and branch in the request context.
- **§118–§119 owner settings and languages.** Migration 620 (`tenant_checkin_settings.display_languages`, English /
  Vietnamese, default first). Every customer-facing word on the display now comes from `apps/customer-display/src/i18n`
  (complete Vietnamese); a guest switches for their own visit and the next guest starts in the salon's default. POS →
  Devices → Customer Displays → **Customer display settings** (appointment / walk-in / new guests / services /
  technician / estimated wait / languages). Fixed with it: saving the salon's check-in settings needed only
  `settings.view` — it now needs `settings.edit`.
- **§83–§84** the POS card shows the display's current mode and offers **Reconnect**.
- **§2, §16 Windows** `docs/CUSTOMER_DISPLAY_WINDOWS_SETUP.md` (Extend, Display 2 on the right, touch mapping, taskbar,
  sleep) and `apps/customer-display/kiosk/launch-customer-display.{ps1,cmd}` (Chrome/Edge kiosk on the non-main monitor
  with its own browser profile; refuses Duplicate mode).
- **§14/§94** the layout proof now measures 1280×800 too, and Vietnamese at every size: 439/439.

Decided (not built): the session vocabulary keeps its names (mapped 1:1 to §33's); the walk-in asks first name + phone
only (§25's optional fields stay with the front desk / Customer App); the master check-in switch stays the platform's;
staff-only screens (pairing, the technician clock) stay English. The section-by-section ledger is the wave-2 record.
