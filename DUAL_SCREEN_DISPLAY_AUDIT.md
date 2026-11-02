# 23-Inch Dual-Screen Check-In, Checkout Display & Tenant Advertising — audit and progress

Spec: *AI PowerSalon — 23-Inch Dual-Screen Customer Check-In, Checkout Display & Tenant Advertising System* (Kevin,
Oct 5 2026, §1–§131). Work branch: `work/dual-screen-display` (master untouched at `06f2a79c`). Layout as Kevin set it
out with the spec: check-in on the left and centre, a dynamic right panel (advertising ↔ the live checkout).

## Part A — what exists, classified (§1, §128)

Legend: COMPLETE · PARTIAL · BROKEN · DUPLICATE · PLACEHOLDER · NOT_WIRED · MISSING. Every row was read in source on
Oct 5 2026; BROKEN rows marked *(fixed)* were then proven live (Part B).

| Area | Status | Evidence |
|---|---|---|
| Customer display app | PARTIAL → COMPLETE for the 23-inch layout *(Unit 4)* | Was: `apps/customer-display` (React/Vite/Capacitor 8.4) DEVICE mode showed Go Check-In while idle and a full-screen checkout when a session was attached — one screen at a time, no three-column layout, no dynamic right panel. Now: Part B, Unit 4. |
| Display devices + pairing | PARTIAL → COMPLETE *(Unit 6)* | Was: `customer_display_devices` (tenant, branch, `pos_station_id`, pairing code, `device_token_hash`, revoke); the token rode in the URL, not a secure store (§12); "pairing" from Settings only flipped a column. Now the display pairs itself with a code the owner types, the credential lives in the device's secure store and travels in a header (Part B, Unit 6). The second identity is gone *(Unit 7)*: the display checks guests in with its own credential; `go_checkin_devices` is the standalone kiosk's only (Part B, Unit 7). |
| Display sessions | PARTIAL → COMPLETE *(Unit 6)* | `customer_display_sessions` per ticket; POS `send-to-customer-display`, create/patch/close. Two stations could replace each other's customer — *(fixed: DISPLAY_BUSY, migration 505)*. Which display a checkout goes to — the register's dedicated display, else a shared one, online only; Switch Display — Unit 6. |
| Display realtime | BROKEN *(fixed)* | An idle display subscribed to NO room and stayed "connected", so it never heard a checkout start; POS changes to the ticket never reached it. |
| Completion / privacy reset | BROKEN *(fixed)* | The display relabelled its state as idle but kept totals/tip in memory; the server kept returning the paid session for up to 10 minutes; the hold used a tenant setting (default 5 s), not the spec's 3000 ms. |
| Customer-safe checkout DTO | PARTIAL → COMPLETE *(Unit 2)* | Was service name + price only, money computed by the display service from the session's own copy. Now `CustomerDisplayCheckout` built by the checkout module from the POS's own ticket, totals and payments (Part B, Unit 2). |
| POS discount stacking | BROKEN *(fixed, Unit 2)* | The single-ticket loader (`_ticket`) never selected `tickets.discount_snapshot`, so every discount writer (manual, promotion, deal, membership, loyalty) rebuilt the stack from an empty list: adding a manual discount silently removed a promotion or membership credit already on the ticket. Proven live: a $3 manual discount wiped a $5 promotion. The developer's tests used only the in-memory repository, which kept the snapshot. |
| Terminal capture amount (display "Pay" in terminal mode) | BROKEN *(fixed, Unit 2)* | Charged the display SESSION's copy (subtotal + tip stored at session creation): a POS tip or discount added later never reached the charge; a gift card that had paid part was charged again in full ($55.50 asked for a $35.50 balance); a ticket already paid in full was charged a second time. Proven red on real Postgres before the fix. |
| Payment status on display | PARTIAL *(improved)* | Processing / success / failed existed; a charge whose answer was lost was not represented *(fixed: payment_verifying)*. |
| Tip on display | COMPLETE | Server-calculated (`tipForPercent`, `validateCustomTip`), provenance kept. Tenant-configurable percents exist (`defaultTipPercents`). |
| Receipt choice on display | MISSING → COMPLETE *(Unit 6)* | Was: no display route; the POS had `receipt/sms|email|app`. Now the display asks before the 3-second screen, masked, live channels only, recorded once, delivered by the POS's own Send Receipt (Part B, Unit 6). |
| Check-In backend | PARTIAL → COMPLETE *(Unit 7)* | `modules/queue/src/go-check-in` (17 routes): phone lookup (tenant first, ambiguous → front desk, rate-limited), appointment check-in, walk-in, create customer, place in line, wait estimate. Was: a session was started by the public kiosk slug only. Now a display starts its guests' sessions with its own credential, one per guest (Part B, Unit 7). |
| One active check-in | BROKEN *(fixed)* | Ten kiosks checking one appointment in at once made ten queue entries *(fixed: migration 503)*. |
| Branch pricing | BROKEN *(fixed, Unit 7)* | The kiosk listed services tenant-wide; services are rows per branch, so a two-branch salon showed both price lists (§23). Now the branch's own rows and prices — proven live, $50 vs $55. |
| Technician choice | PARTIAL → COMPLETE *(Unit 7)* | Listed every non-archived technician of the branch. Now working the rest of today (the Live Technician Schedule's sources) and qualified for every chosen service, asked again as services are picked; the server refuses anyone else (§25). |
| Appointment found | PARTIAL → COMPLETE *(Unit 7)* | Showed the first service and one technician of one appointment. Now the visit — every appointment and service of it, compact with "+ N more" — and "I'm Here" checks the whole visit in (§16–§17). |
| Salon branding | BROKEN *(fixed, Unit 4)* | Both screens showed the AI PowerSalon logo as the main brand; the Receipts & Branding "logo upload" kept a data URL in process memory (lost on restart, shown nowhere). Now the salon's stored logo, name, tagline and branch name head its display (Part B, Unit 4). |
| Go Check-In on the display | BROKEN *(fixed, Unit 4)* | Every display showing Go Check-In asked for the services and technicians in a tight loop — hundreds of requests a second — starving its own checkout requests (Part B, Unit 4). The check-in also vanished whenever a checkout began, and a display in a branch without a kiosk could be handed another branch's kiosk. |
| Advertising | MISSING → COMPLETE *(Units 3–4)* | Was: no tables, routes, screens, playlist, schedule, targeting, permissions or analytics (§47–§78, §108–§111). Server and POS: Part B, Unit 3. The display plays, caches and reports: Unit 4. |
| Media / object storage | COMPLETE (reuse) | `packages/media` (local disk + S3), image sniffers (JPEG/PNG/WebP). No image library is installed (no `sharp`) — the §71 copies are made in the owner's browser and validated on the server (Unit 3), so no native dependency is added. |
| POS display status | MISSING → COMPLETE *(Unit 6)* | Was: no "Customer Display ● Connected / Offline" indicator on Checkout (§81, §83, §123–§124). Now the Customer Display card and POS Devices → Customer Displays (Part B, Unit 6). |
| Device states / modes | MISSING → COMPLETE *(Unit 6)* | Was: no ONLINE/OFFLINE/CHECK_IN/CHECKOUT/ADVERTISEMENT/MAINTENANCE/REVOKED (§85). Now from the display's heartbeat by one rule (Part B, Unit 6). |
| POS Marketing navigation | COMPLETE (reuse) | `MARKETING & GROWTH` section in `apps/pos-web/src/shell/tenant-nav.tsx` — the advertising page belongs there (§48). |

**Must not be duplicated:** `apps/customer-display` + `GoCheckIn.tsx`, the go-check-in module, `customer_display_*`
tables, `CustomerDisplayState`, the realtime registry and stream factory, `packages/media`, the POS send-to-display flow.

## Part B — Unit 1 delivered: the display follows the checkout and forgets the customer

**Taken from the removed `spec/checkin-display-oct5` branch (only these two, because §11 and §19 require them):**
`b09b3eb1` → one active queue entry per appointment / walk-in customer (migration 503); `7d89db20` → a shared display is
reserved under a row lock, DISPLAY_BUSY for another customer (migration 505).

**Built:**
- Realtime: four registry events (`customer_display_session_started`, `_checkout_updated`, `_completed`, `_canceled`) and a
  device channel `customer_display:device:{id}`. Both emitters mirror any tenant event that names one ticket into that
  ticket's room as an ids-only `customer_display_checkout_updated`.
- Device stream rooms: always the device channel; plus the session and ticket rooms while a checkout is attached.
- `payment_verifying` after 20 s without a processor answer (checked before session expiry).
- `POST /customer-display/device/release` (device token, public like its siblings): ends a checkout only when the ticket
  is paid (no signature step since Unit 10); a stale release (next customer already attached) changes nothing; idempotent.
  A paid checkout older than 2 minutes is closed on read, so a late restart never re-shows it.
- State carries `sessionId` and `version`; the display drops older responses for the same session.
- POS checkout: Send to Display / create session announce `session_started` on the device channel and the POS room;
  a session patch announces `checkout_updated`; Cancel Display Session announces `canceled`.
- **Found by the live proof and fixed:** a POS tip, discount, promotion, deal or reward code emitted nothing — neither a
  second POS nor the display heard it. All six writes now signal `checkout_total_recalculated`.
- Display app: stream re-opened per session; silent 15 s safety sync; fixed 3000 ms hold only after confirmed completion;
  customer state rebuilt from scratch (not covered); session released; a released session is never rendered again;
  a rating or error never carries to the next customer; "Verifying payment — please do not pay again" screen.

**Caught by the checks before commit:** the new release route was session-gated (a display has no staff session — it
would have been refused); the completed-close updated by session id without the tenant; the §343 rule on direct
realtime pushes (marked exempt as screen instructions, and the rule now counts device-channel calls).

## Part B (cont.) — Unit 2 delivered: every number on the display comes from the ticket

- **One projection, owned by checkout:** `modules/checkout/src/checkout/customer-display-projection.ts` (pure) builds
  `CustomerDisplayCheckout` (wire type in `@aipowersalon/api-contracts/customer`) from the POS's own ticket lines,
  discount snapshot, `totalsForMethod` totals and payments. Explicit allowlist (§39): kind, name, first-name technician,
  quantity, charged amount, original price only when charged less; adjustments (membership, loyalty, promotion, deal,
  bundle, discount); subtotal, tax, labelled customer fee, tip, gift-card sale, total, paid, balance due, payments
  (method + amount), payment status, points earned once paid. The itemized discounts are shown only when they add up to
  the money actually taken off — otherwise one honest "Discount" line.
- `KyselyCheckoutRepository.customerDisplayCheckout(ctx, ticketId)` (+ in-memory twin); lines now carry quantity,
  catalog price and product, and are ordered by `created_at, id` so a refresh never reorders the customer's ticket.
- **Display service:** state built from the projection (`checkout` field + the legacy `ticket`/`totals` fields derived
  from it); tip percent on the EFFECTIVE subtotal (the POS's own rule) and written to the ticket; the card/cash choice
  becomes the ticket's chosen method, so the POS and the display show one total; the "Pay" event carries the balance.
- **Fixed on the way:** the discount-stack loader bug and the terminal-capture amount (both in Part A). Discount syncs
  that change the bill — even when the POS merely opens the ticket — now signal `checkout_total_recalculated`.
- **Display UI:** `apps/customer-display/src/CheckoutTicket.tsx` — greeting, lines with "with Olivia", add-ons as "+ …",
  products with ×qty, struck-through original prices, savings rows, gift-card purchase, tax, the salon's fee label only
  when a fee applies, tip, payments received + BALANCE DUE, and TOTAL DUE as the strongest element; the line list is a
  bounded, internally scrolling region with the totals pinned (§93–§95). Completed screen (§44): "Payment complete",
  "Thank you, Sophia!", "Total paid", "You earned N points." The 23-inch three-column placement is Unit 4.

## Part B (cont.) — Unit 3 delivered: the salon's own advertising (server, POS page, Super Admin)

Covers §47–§78 and §108–§114 on the server and in the POS, and the POS page planned as Unit 5 (§48–§59, §109) — built
together because the page is how the server is proven. The display starts using the playlist in Unit 4.

- **Where it lives (§112):** new domain module `@aipowersalon/marketing` (`modules/marketing/src/display-advertising`),
  not checkout. Migration 509: `display_ad_media`, `display_ads`, `display_ad_branches`, `display_ad_device_settings`,
  `display_ad_display_stats`, `display_ad_report_batches`. Composite `(tenant_id, id)` foreign keys, so an ad can only use
  its own salon's images and target its own salon's branches; CHECKs for text lengths, date order, the daily window,
  duration 5–30 s, priority 0–100, https QR links, and "a live ad has an image". Platform feature `customer_display_ads`
  (Feature Registry) with plan rows.
- **Fields (§51) and simple mode (§53):** name, image, headline, subheadline, description, call to action, QR, branches,
  start/end date, days of week, daily start/end time, duration, priority, status. An image alone is enough to publish.
- **Statuses (§64–§65):** stored draft / published / paused / archived; SCHEDULED, ACTIVE and EXPIRED are worked out in
  the branch's time zone from the salon calendar dates, the days of the week and the daily window. Publish, pause,
  archive, restore; only a draft or archived ad can be deleted.
- **Branches (§61–§63):** all branches or a chosen list. An owner manages every branch; a branch manager sees the ads that
  play at their branch and manages only ads aimed at their branch alone.
- **Upload (§68–§71):** the owner's browser decodes the picture and makes the 1920 / 1080 / 320 px copies (WebP, else
  JPEG) plus a smart-crop point of interest. The server checks every part — magic bytes, declared MIME, extension, size,
  the real dimensions from the header (JPEG SOF + EXIF orientation, PNG IHDR, WebP VP8/VP8L/VP8X) — and that each copy
  is within its size and byte limits and the same picture shape. Stored through the existing `packages/media` store
  under the sniffed type's extension; the full-size original sits under a random token that no response carries.
  Ad-count and storage limits per salon are checked under a per-salon advisory lock (two uploads at once cannot both
  squeeze under the limit — proven on real Postgres).
- **Only controlled content (§77–§78):** plain text (anything tag-like is refused, invisible characters removed), the
  image, and a QR code of a fixed kind — Book online, Customer app, Gift cards, Instagram, Membership — whose destination
  must be a public https address (no user:password, no other port; Instagram must point at instagram.com).
- **The display's playlist (§58–§59, §62, §111):** `GET /customer-display/device/ads` (device token). Salon, branch and
  display come from the token only. Layers, all of which must allow it: platform feature + plan → salon setting →
  branch setting → this display. Order: priority (highest first), then the order they were published.
  `refreshAfterSeconds` is the next schedule boundary (5–900 s), so ads start and stop on time without any nudge;
  `offReason` says which layer turned ads off. Customer-safe shape (`CustomerDisplayAdPlaylist`): no people, no internal
  fields, only the copies a display needs.
- **Live changes (§73–§74):** publish, pause, archive, restore, edit, delete and every setting change send
  `customer_display_ads_updated` (ids only, after the change is saved) to each affected display's own channel and to
  the POS screens of the affected branches.
- **Display counts (§108):** `POST /customer-display/device/ads/displays` — batches counted once, only this salon's ads,
  times within the last 24 hours, durations capped; kept as hourly totals per ad and display. Called "displays" —
  never "views" (§108).
- **Audit (§76):** create, edit, schedule change, publish, pause, archive, restore, delete, upload, settings and the
  per-display switch — who, salon, branches, action, time and ad, written in the same transaction as the change.
- **Two people editing:** every write carries the version the person saw; a stale save gets VERSION_CONFLICT and the
  editor offers to reload.
- **POS page (§48–§59, §109):** Marketing & Growth → Customer Display Advertising, tabs Advertisements (+ ADD
  ADVERTISEMENT; simple mode = upload + Publish now; full editor with Cover / Contain / Smart crop and a point-of-interest
  picker, QR, schedule, branches, a separate 1920×1080 full-screen picture), Playlist, Schedule, Branches, Display Preview
  (the 23-inch 1920×1080 layout with the Check-In area beside the ad panel, cross-fading the branch's real playlist),
  Analytics (active / scheduled / expired, display count, displays showing ads, branches) and Settings (salon on/off,
  default duration, full-screen idle ads; per-branch override; per-display switch). It refreshes itself on
  `display-ads` events.
- **Super Admin (§110):** General Settings → "Customer Display Advertising": maximum ads per salon, maximum file size,
  storage per salon, allowed file types, full-screen idle ads allowed. Switching the feature on/off for the platform, a
  plan or one salon is the existing Feature Registry (`customer_display_ads`).
- **Shared display pieces:** `packages/ui` — `DisplayAdSlide` (cover / contain / smart crop, never distorted), `AdRotator`
  (cross-fade, §60), `AdFallbackPanel` (§114) and the QR drawing (`qrcode-generator`). The POS preview uses them now; the
  display will in Unit 4.

**Found and fixed on the way:**
- **Six web apps did not build for production** (POS, admin, owner, tech, customer, manager-pay) — since the package
  steps of Oct 4–5. Vite's production build does not convert the CommonJS build of `@aipowersalon/api-contracts` when it
  is linked from the workspace. Fixed with one shared Vite plugin that reads the contracts from source
  (`tooling/vite/contracts-from-source.mjs`; the admin app also needed money/realtime from source). A new audit,
  `frontend builds`, now builds all seven apps on every gate run.
- The owner was refused (403) on the new permission keys — the coarse "marketing" mapping was missing. Found by the
  live run; pinned by a permissions test.
- The API removes `tenantId`/`branchId` from every request body and query string (by design — the session decides
  them), so a chosen branch is a path parameter everywhere in this feature.

**Decisions taken (each can be changed):**
1. Plans: switched on for every plan in the catalog. A salon on a plan that is not in the catalog (the pilot's legacy
   plan) is not restricted — the same rule plan limits follow — unless Super Admin switches it off for that salon.
2. Video (§50, §110): not built. The media table records each file's type, so video can be added later; no "Video"
   switch was added to Super Admin because it would control nothing.
3. The image copies are made in the owner's browser and validated on the server — no native image library on the server.
4. Display counts are hourly totals per ad and display (count + seconds shown), not one row per showing.
5. Malware scanning (§70: "if one exists"): the platform has no scanning service. Uploads are limited to checked
   JPEG/PNG/WebP files; an external scanner would be a separate addition.
6. Ad pictures are in the public media store, as the nail showcase is: they are shown on a customer-facing screen.
   Addresses are unguessable, and only the browser-made copies are ever handed out.

**Recorded, not fixed:** the POS branch switcher would list a branch whose `deleted_at` is set (identity's branch list
ignores the column). Nothing in the product sets `deleted_at` on a branch today — only direct SQL can — so it has no
effect yet; the live proof deletes its test branch outright.

## Part B (cont.) — Unit 4 delivered: Kevin's 23-inch layout

Kevin's decision, built as stated: **check-in stays on the left and centre; the right side is dynamic** — the salon's
advertising when there is no checkout; the moment checkout begins the ad is gone and that customer's live ticket takes
the right panel; after payment the completed summary stays 3 seconds, the customer is wiped, and the panel returns to
advertising.

- **The screen (§2–§7, §13–§28, §87–§95):** `Display23` — header with the salon's brand; column 1 the phone keypad
  (12 keys incl. Clear / Backspace) and *Find My Appointment*; column 2 *Appointment Found* + *I'm Here*, or the walk-in
  (first name, services, technician, *Check In*); footer the check-in result or the salon's idle line, and a quiet
  "Powered by AI PowerSalon"; right panel ~35%. Everything is sized from the viewport (one `--u` unit, 64-unit touch
  targets, never below 44 px), so there is no page scroll from 1366×768 to 1920×1080; a long ticket scrolls inside its
  own list with the totals pinned. A paired display on a landscape screen gets this layout; tablets keep the
  single-column screens, which now share the same pieces (`useCheckInFlow`, `CheckoutPanel`, `Branding`).
- **Right panel (§79–§80):** one pure function, `rightPanelMode` — checkout / payment status / receipt / completed /
  message / ads, checkout first. An ad never covers a payment in flight ("Verifying payment — please do not pay again").
- **Advertising on the display (§47, §58–§60, §72–§74, §108, §114):** the playlist from
  `GET /customer-display/device/ads` (the device token decides salon, branch and display), asked again when the server
  says a schedule changes, at once on `customer_display_ads_updated`, and after a reconnect — the checkout state is not
  refetched for an ad change. Pictures play only once they are on the device (Cache Storage → object URLs; a picture
  that will not load is skipped); the right-sized copy is chosen for the panel height and pixel density. The list is
  saved on the device (ad content only) and plays through a network drop — until the server's new `validUntil`, after
  which the salon's branded panel shows instead of an ad that may have ended. Each ad slot of at least a second is
  reported as a display, in batches (every 60 s and when the screen hides; a failed batch is retried under the same id;
  at most 100 per batch; nothing older than a day).
- **Full-screen idle ads (§7):** after the salon's time (at least 30 s) with nobody touching the screen, never during a
  checkout or while someone is mid-check-in; the panel stops playing underneath. A touch returns to check-in, and that
  touch is absorbed (400 ms) so it presses nothing underneath.
- **Salon branding (§13):** the server builds `CustomerDisplayBranding` for the device's branch — the salon's name, its
  stored logo (accepted only as that salon's own file, `safeSalonLogoUrl`), its tagline, the branch name when the salon
  wants it, its idle message — plain text, invisible characters removed, lengths capped. The logo is now stored for real
  (`modules/tenants/src/settings/salon-logo.ts`): PNG/JPEG/WebP checked by its bytes, kept in the public media store
  under a random key, one salon-wide row that only the logo routes write (the generic settings PATCH cannot point it
  elsewhere), the replaced file removed. POS: Settings → Customer Display (show salon logo & tagline, tagline, show
  branch name, idle message) and Settings → Receipts & Branding → Salon logo (upload — the browser shrinks it to fit
  800 px and keeps transparency — preview, replace, remove).
- **Check-in result (§26–§28):** in the footer — "You're checked in!", the estimated wait, the place in line. What the
  guest typed is cleared the moment the check-in is confirmed; the result leaves after the salon's time, held to 5–10 s.
- **Offline (§72, §113):** a network drop keeps the ad playing with no error over the screen. A display that restarts
  while its server is unreachable shows the salon (its name and branding, remembered on the device — never a customer)
  and the saved advertising, and says plainly that check-in waits for the front desk; when the server answers it
  reconnects by itself.

**Found and fixed on the way:**
- **A request storm on every display showing Go Check-In (pre-existing — the idle check-in screen has had it since it
  was built).** `useGoCheckIn` returned a new object on every render and the services/technicians effect depended on
  it: every answer re-rendered, re-ran the effect and asked again — hundreds of requests a second per display. Chromium
  refused the overflow (`ERR_INSUFFICIENT_RESOURCES`) and the display's own checkout requests queued behind it: in the
  live proof a checkout took over 20 s to appear. Found by the live browser proof (the unit tests never counted calls).
  The hook's object is now stable and the effect depends on the stable calls only; pinned by `useCheckInFlow.test.tsx`
  (one request each, however many renders) and mutation-checked.
- **The check-in disappeared whenever a checkout began.** The server sent the Go Check-In slug only with the idle
  state, so on the 23-inch screen the left side fell back to a welcome card mid-checkout and the kiosk session was torn
  down and restarted afterwards. A device's checkout states (and every state a device action returns) now carry it.
- **A display could be handed another branch's kiosk.** `slugForBranch` fell back to "any active device": in a
  multi-branch salon a display in a branch without a kiosk showed another branch's check-in, and its guests landed in
  that branch's queue. Now: the branch's own kiosk, else a salon-wide kiosk, else none (a display with no branch, in a
  salon with exactly one kiosk, uses that one).
- After the 3-second hold the cleared state dropped the salon's branding — the header flashed from the logo to a
  monogram until the server answered. The salon's branding (no customer field exists in it) is now copied field by field.
- The salon logo upload kept a data URL in process memory: lost on every restart, invisible to a second API instance,
  and shown nowhere (above).
- Two display tests used `Array.at`, which the app's TypeScript target does not have — the app's production build
  (`tsc && vite build`) would have failed; fixed.

**Decisions taken (each can be changed):**
1. Branding changes reach a display on its 15-second sync, not by a push — the POS says "within 15 seconds".
2. The check-in result stays for the salon's confirmation time held to 5–10 s (the default 12 s becomes 10 s; §28).
3. The estimated wait is shown as a range, w to w + 10 minutes, from the server's estimate (§27); moving the range to the
   server belongs with the Unit 7 check-in work.
4. The display remembers its salon (name, logo address, tagline, branch name, idle line) on the device so an offline
   restart is not a spinner; no customer data is ever stored on the device (§72).
5. Logos: PNG, JPEG or WebP, at least 32 px on the short side, at most 1 MB after the browser shrinks it; public media
   store, as advertising pictures are (shown on a customer-facing screen).

## Part B (cont.) — Unit 6 delivered: the display as a device — pairing, registers, status, receipts

Covers §8–§12, §81–§86, §97–§98 and §122–§127. Migration 511.

- **The display pairs itself (§8–§12).** An unpaired display shows an 8-digit code (`4829 1374`, valid 10 minutes) and
  nothing to type — no salon login, no salon picker. The owner types the code in POS → Devices → Customer Displays with
  a name and, optionally, a register; the salon and branch are the owner's signed session, never the request. The
  display polls with a secret only it holds, and its credential is minted at that moment and handed over once (the
  pairing is spent whatever happens). Only SHA-256 hashes of the code, the poll secret and the credential are stored
  (`customer_display_pairings`). A claimed display that never collects its credential is revoked by the next
  housekeeping; expired codes are deleted. The public start is a write anyone on the internet can reach, so it is
  limited: 6 codes a minute per network, 300 per API instance, at most 1,000 open codes.
- **The credential (§12).** Kept in the device's secure store — Keychain / Keystore in the Capacitor app
  (`capacitor-secure-storage-plugin` through `@aipowersalon/mobile-sdk`), the browser's own storage on a web display —
  and sent only in the `x-device-token` header. The live stream is now a fetch-based event stream that carries the header
  (an EventSource cannot), so the credential no longer rides in any address. An old provisioning link's `#device=`
  token is moved into the store and wiped from the address bar on first load. A display whose credential is refused
  (revoked) forgets it and shows a fresh pairing code.
- **Registers, dedicated and shared displays (§9–§11).** `pos_stations`: a branch's registers (one live name per branch,
  case and spaces ignored; retired, not deleted). A display assigned to a register is DEDICATED to it; one without is
  SHARED by the branch. A foreign key now ties a display's register to its own salon — the old station column pointed at
  nothing. Each POS computer says which register it is (remembered in that browser). **Send to Display** picks
  (`display-send-core.ts`, pure): the display already showing this customer, else the register's dedicated display,
  else the branch's shared ones — online and not in maintenance only, never another register's dedicated display. A
  shared display busy with another customer is skipped (DISPLAY_BUSY only when every one is busy; nobody is displaced).
  **Switch Display** moves the checkout and ends it on the display it was on — never while the customer is paying there.
- **Heartbeat and the §85 states.** Every 30 s, and at once when what it shows changes, the display reports its mode
  (checkout / check-in / advertisement / idle), app version, screen size, pixel ratio and profile; the server validates
  every field. Online means heard from within 75 s (two missed beats and a margin) — never a stored flag. One rule
  (`displayDeviceState`) gives the state everywhere: REVOKED → MAINTENANCE → OFFLINE → CHECKOUT (a checkout attached on
  the server outranks what the display last said) → CHECK_IN → ADVERTISEMENT → ONLINE. The POS hears a change (mode,
  version, screen, back online), not every beat.
- **POS Checkout — the Customer Display card (§81–§84, §123–§124).** Top of the right column: `Customer Display ●`
  Connected / Active / Offline / Maintenance / Pairing / No display, with what it is doing ("Showing Mia's checkout on
  Front Display #1"); *This POS is* [register]; Send to Display, Cancel Display Session, Refresh Display, Switch
  Display…, and Open on second screen while no display is connected. The card names the display Send to Display would
  use, in the server's own order. The workspace's To Display is disabled (and looks it), with the reason, when this
  register has no display online; the checkout always continues on the POS.
- **POS Devices → Customer Displays (§86).** Pair by code; a table of name, branch, register (dedicated / shared),
  state, what it is doing, last seen, app version, screen and platform; rename inline, assign or remove a register,
  maintenance on/off, refresh, revoke (after confirming — a checkout on it ends there and continues on the POS);
  registers added, renamed, removed. The front desk OPERATES the display — send, switch, refresh, cancel
  (`pos.customer_display.operate`, which rides the checkout permission); pairing and management are the owner's
  (`pos.customer_display.manage`). Every change is audited: paired, connected, renamed, register changed, maintenance
  on/off, revoked, registers created / renamed / retired.
- **Maintenance, Refresh, Revoke.** Maintenance shows a calm "This display is being serviced" screen with the salon's
  name — no check-in, no customer data; it is refused while a checkout is on the display. Refresh Display reaches the
  display on its own channel: it fetches its state and advertising again and reopens its stream, and the POS says
  whether the display is connected to hear it. Revoke destroys the credential at once and tells the display, which
  shows a new pairing code.
- **The receipt step (§97–§98).** After payment (no signature on the display since Unit 10) and before the 3-second
  screen, the display asks: *Text my receipt to (•••) •••-0142*, *Email my receipt to s•••@gmail.com*, *No receipt*.
  Destinations are masked (the screen faces the room). A channel is offered only when a real provider is configured and
  the customer has that contact, so the display never says "texted" when nothing was sent. The salon's Receipts &
  Branding default is the automatic choice, sent when the customer walks away (45 s) or when the display was offline at
  the end. The choice is recorded once — two taps, or two requests at the same moment, send one receipt (proven on
  real Postgres) — and delivered by the checkout module's own Send Receipt. The outcome line ("Receipt texted to
  (•••) •••-0142", or "We couldn't send your receipt — the front desk can send it for you.") is on the 3-second screen. The 3
  seconds wait for the choice, and the server refuses to clear the screen while the customer is still choosing. No
  question when the front desk already sent one or the salon switched the prompt off (salon, or per branch).
- **Second monitor and full screen (§122–§125).** POS → Open on second screen opens the display app in its own window
  at once (a browser blocks a window opened later). Where the browser can place windows (the Window Management API —
  Chrome and Edge, one permission) it goes to the second monitor; otherwise it opens as a window to drag there. The
  display's Full screen choice is remembered; after a restart the first touch restores it (browsers allow full screen
  only from a touch or click). The POS learns the display's address from `VITE_CUSTOMER_DISPLAY_URL` at build time.
- **One client for both kinds of hardware (§126–§127).** An Android display (the Capacitor app) and a monitor attached
  to the Windows POS (the same app in a browser window) pair the same way and use the same display API, display
  session, realtime contract, advertising playlist and customer-safe state; they differ only in where the credential is
  kept, and the platform each reports is shown in the POS.

**Removed (duplicates and fakes):**
- The staff-side pair / "Test" / status routes in Settings → Devices (`modules/tenants`): "pairing" there only flipped
  a column, and "Test" stamped `last_seen_at` on demand, so a display that was switched off looked online. The POS
  Devices page's Test button is now Refresh Display; Add Device opens the real pairing page.
- `customer-display-admin.controller.ts`, which issued a device token in a response body for building a URL, and its
  script.
- Two readers of `pos_display_devices`, a table nothing has ever written: tenant health and the Super Admin live
  queue now count the real displays (the live queue's count also ignored the salon filter every other line carries).

**Found and fixed on the way:**
- **The front desk could not send a checkout to the display.** Every display action required `settings.edit`, which
  FRONT_DESK and RECEPTION do not hold — Send to Display and Clear Display were refused (403). Now `operate` for the
  front desk; pairing and management stay the owner's.
- **A released checkout stayed "on the display".** `activeSession` skipped only disconnected sessions: a session the
  display had completed and released stayed active until it expired, so the POS kept offering Clear Display for a
  customer who had left.
- **A cash customer's receipt quoted the card total.** The SMS / email receipt priced every ticket as card — surcharge
  included — even when the customer paid cash. It now states the payments actually taken.
- **Online was a guess.** Besides the "Test" stamp, the Devices overview called a display online for 5 minutes after it
  was last heard from; it now uses the displays' own 75-second rule.

**Found by the verification lanes (fixed):** the schema guard read the row-lock clause `FOR UPDATE OF d` as a table
named "of" (the guard now strips the locking clause; a probe proved it still flags a missing table); the API's static
reviews — the public-route baseline, the tenant-isolation statement list and the secure-random sites — now record the
new public routes and the pairing statements, each with its reason; a receipt test stubbed the repository without the new
paid-amounts read (updated, with a cash case and a before-payment case added). The POS's To Display and Send to Display
buttons were disabled when no display could take the customer but did not look it — they now do.

**Decisions taken (each can be changed):**
1. The display shows the code and the owner types it (not the other way round): the display needs no keyboard and
   never sees a salon login; only the owner (`settings.edit`) can bind a display to the salon.
2. Codes are 8 digits, valid 10 minutes; the credential is 32 random bytes, stored as a hash.
3. A display without a register is shared by its branch; one register may have several dedicated displays (the first
   online one is used).
4. Receipts: the automatic choice is the salon's Receipts & Branding default (text first, then email, else none); the
   customer has 45 s to choose.
5. Maintenance outranks OFFLINE in the §85 state, so a display switched off for service reads "Maintenance", not
   "Offline".

## Part B (cont.) — Unit 7 delivered: the guest's own check-in — one device identity, the branch's menu, the visit

Covers §8, §12, §14–§28. Migration 512.

- **One device identity (§8, §12, §18).** The display checks guests in with ITS OWN credential:
  `POST /customer-display/device/check-in/session` (`x-device-token`) starts a check-in session for the display's salon
  and branch — the request names neither — and the display then uses the shared session routes. No Go Check-In kiosk has
  to exist: before, the display borrowed its branch's kiosk slug, so a branch without a kiosk had no check-in on its
  display, and the display spoke as the kiosk. A check-in session now belongs to exactly one device, a kiosk or a paired
  display of the same salon (migration 512: `device_id` nullable, `display_device_id` with a composite foreign key to
  the salon's own display, a CHECK for exactly one). Every request re-checks the display's standing — revoked, unpaired or
  in maintenance ends its check-in on the very next request (proven live: 403). The display's state says `checkIn: true`
  when check-in is on for its branch (never in maintenance). The door is rate-limited: 30 starts a minute per display,
  3,000 per API instance.
- **One session per guest.** When a guest's turn ends — the result clears, the next guest's first tap, Done, walking
  away, the technician clock closed — the session they used is completed and the next guest's started; a session nobody
  used is kept. Every guest gets the session's own allowance (8 phone lookups, 3 new profiles): with one session for the
  day, the ninth lookup of the morning was refused (proven live: 11 guests, 11 lookups, none refused — and inside one
  session the ninth is still refused). A heartbeat keeps the waiting session alive; a session the server has ended (it
  timed out while the screen slept) is replaced and the call made once more — the refusal comes before anything is
  written. A refused start (check-in switched off) backs off: 15 s, 30 s, 1 min, then every 2 min.
- **The branch's own menu and prices (§22–§23).** The display's branch's own service rows — active, not archived, with
  their categories and prices. The salon's whole list was shown before, so a two-branch salon showed both price lists.
  Proven live: the same Gel Manicure costs $50 on the proof branch's display and $55 on Main's.
- **Who may be asked for (§25).** Working the rest of today at this branch, from the same sources as the Live Technician
  Schedule — the weekly schedule (split shifts included), blocked times, an open time-clock punch (one from last night
  counts), the front desk's live status (switched off → not listed) — and qualified for EVERY chosen service (the queue's
  category skill rule; add-ons need no skill of their own). Asked again as the guest picks services; a technician no
  longer qualified goes back to "Any available"; a later shift says "From 12:00 PM"; first names only (a last initial
  where two share one). The server refuses anyone else, whatever the request says. Before: every non-archived
  technician of the branch.
- **The visit (§16–§17).** A guest's appointments today at this branch that belong together — booked for the same time,
  or starting within the hour after the first (one technician each) — are one visit: "Today at 11:00 AM" and every
  service with its technician's first name. Compact: each appointment's first service leads, then "+ 1 more" opens the
  rest inside the card — the screen never scrolls (proven at 1920×1080, 1600×900, 1366×768). An afternoon arrival gets
  the afternoon visit, never the morning's. "I'm Here" checks every appointment of the visit in, once; the server works
  the visit out again from the appointment shown, and another branch's or a forged id is simply not found.
- **The quick walk-in (§20–§24).** First name, the phone from the keypad, the services — nothing else is asked. While
  the salon lets guests choose, at least one service; add-ons only with a service, attached to it. The salon's
  "Add-ons" category, in any spelling, is ONE rule (`isAddOnCategory`) for the guest's check-in, the POS walk-in and New
  Booking. A number typed but never looked up is looked up first: a returning guest is linked to their profile, and one
  with an appointment today is shown it instead. With service choice switched off the guest joins without a service —
  before, the queue refused them, so such a salon took no self check-in walk-ins at all. The server works out how long
  the services take (§24) and refuses another branch's service, an add-on on its own, and a service sent as an add-on.
- **The wait (§26–§27).** The confirmation carries the queue engine's estimate as the band the guest sees ("25–35 min");
  the display and the kiosk show it as it came — they used to add the 10 minutes themselves. The engine now counts the
  BRANCH's day: it counted from the database's UTC midnight, so after 8 pm in New York the evening's guests dropped out
  of "waiting" and the estimate fell to zero (proven on the real schema; check-in KPIs, intake and satisfaction).
- **A guest who walks away (§28, §105, §107).** 90 s without a touch mid-check-in clears the screen — number, name,
  appointment, choices — and ends their session; longer than the 30–60 s the full-screen ads wait, so an ad never covers
  someone checking in (proven live: still there at 85 s, gone at 93 s, session completed).
- **The standalone Go Check-In kiosk** (`apps/go-check-in-kiosk`) got the same: the visit with "+ N more", the branch's
  prices, add-ons with a service, technicians for the chosen services with "From 2:00 PM", the engine's band — proven in
  Chromium (`apps/api/scripts/e2e-html-apps.mjs`).

**Found and fixed on the way:**
- **The queue dropped a check-in's add-ons and price changes.** `pos_queue_items.requested_services` kept only id, name,
  minutes and price: a guest's Nail Art add-on reached the queue as a plain service, and a POS walk-in's price override
  lost its override and reason. The in-memory repository kept them, so no test saw it; the live proof did. Now written
  and read back (real-schema test).
- **Two appointments at the same time could hide a technician.** In booking order the compact view's two rows were one
  appointment's two services and the other technician sat behind "+ 1 more". Found by the live proof; each
  appointment's first service now leads.
- **The check-in screen's KPIs and the wait counted the UTC day** (above).
- **The display's Full screen button (Unit 6) was 33 px tall** — under §89's 44 px; found by the layout regression.

**Decisions taken (each can be changed):**
1. A visit is the appointments starting within 60 minutes after the first one that is not long over (ended less than
   an hour ago).
2. A walk-away is 90 seconds untouched.
3. The phone is required for a walk-in on the display (§21's minimum: first name, phone, services).
4. A guest's chosen technician is recorded the way the POS walk-in records one — as the queue entry's technician (Part C).

## Part B (cont.) — Unit 8 delivered: the journeys end to end, isolation, recovery — and the final report

Covers §99–§107, §115, §117–§121, §130–§131. No product code changed; the final §131 report is
`DUAL_SCREEN_FINAL_REPORT.md`.

- **The two journeys, live (`apps/api/scripts/live-display-journeys-browser.mjs`, Chromium, real API + Postgres, built
  display and POS).** §117: Sophia types her phone on the display, her appointment (Gel Manicure and Nail Art with Olivia)
  is found, "I'm Here" checks her in at this branch, on this appointment, into this branch's queue; the POS Queue screen
  shows her without a reload; the front desk assigns, serves, marks done, passes quality check and sends her to checkout
  with the POS's own calls; Send to Display on the POS Checkout screen — the ad is gone and her ticket takes the right
  panel; a POS discount reaches the display; she taps 20% on the display and it lands on the POS ticket; cash at the POS;
  the receipt question; "No receipt"; payment complete; 3 s; advertising. §118: Ethan walks in — two services and an add-on,
  only Lisa offered, Lisa chosen — and goes the same way to checkout and back to advertising.
- **Every frame, not a screenshot (§107, §130).** Each display page records every frame it renders (the right panel's
  mode and text, the page's text, which screen element is mounted). From the first advertising frame after a checkout
  no frame shows the customer's name, phone digits, services, prices, tip, payment method or receipt destination, and the
  frame before it is the completed summary. One screen element from check-in through checkout, receipt, summary and ads,
  and no reload — "no full-screen refresh".
- **Recovery (§102–§104).** The display restarted mid-checkout comes back to the same checkout and never shows an ad
  first; the API stopped mid-checkout: the display keeps the checkout and, when the API returns, reconnects and hears the
  next POS change by itself; a restart with no checkout is check-in plus advertising.
- **Isolation (§100, §119–§120), in the browser.** A second display in the branch (another register) and the other
  salon's display never show either customer — including when restarted during the checkout; the other salon's display
  shows its ad and never fetches our picture; an ad for Main only plays on Main's display and never on the proof
  branch's; Main's display cannot see the proof branch's appointment or services; the other salon's check-in is its own.
  The 15-second safety sync measured on an untouched display: every 13–16 s.
- **No made-up data (§115–§116).** `apps/customer-display/src/productionData.test.ts` scans every shipped file of the
  display, the standalone kiosk, the shared ad slide, the POS display screens and the server code that feeds the display
  for the reference picture's sample customer, technicians, total, wait and services, and for mock or demo ads and
  customers. Comments may quote the picture; code may not.
- **Proofs clean up after themselves.** A soft-deleted proof branch still showed in the POS branch switcher (Part B,
  Unit 3) and its customers stayed in the salon's customer list: `apps/api/scripts/proof-cleanup.mjs` removes a proof's
  branch and every row in it (found from the catalog, foreign keys included; the audit trail is append-only and keeps
  its rows). The Unit 7 proof now uses it; the four branches and 33 customers its earlier runs left were removed.

**Found by the mutation checks:** a server that handed a display ANY active checkout survived the first journeys run — the
other displays only ask for their state on a timer, and both checkouts ended between two asks. The proof now restarts the
other displays during the checkout, so each asks at that moment; the mutation is caught.

## Part B (cont.) — Unit 9 delivered: "today" is the salon's day everywhere a salon reads it

The two bugs the final report recorded (Part C, Unit 7). Outside the display itself, but the same screens the front desk
and the owner work from all day.

- **The UTC day, found and fixed in every salon-facing count.** Postgres's `now()` / `current_date` and the server's
  `toISOString()` / `setHours(0,0,0,0)` are UTC: from 8 pm in New York (5 pm in Los Angeles) they are already tomorrow. The
  sweep found more than the 38 recorded places — `date_trunc('day', now())`, `date_trunc('month', now())`,
  `AT TIME ZONE 'UTC'`, timestamps cast with `::date`, and the server's own date — in 29 salon-facing files. Each now uses
  the branch's zone (`branches.timezone`, else New York), or the salon's main location for salon-wide counts
  (`tenantTimeZone`, new): the POS Overview (revenue, payment mix, 7-day trend, check-ins, paid tickets, top services and
  technicians, the arrivals board), the POS Dashboard, Service Done, Serving, the Tech Queue (KPIs and the hourly
  utilization chart — its shift hours were UTC hours too), Checkout (tips, paid tickets, failed payments, gift-card and
  wallet redemptions), the **cash drawer** (its default business date AND which cash payments belong to it — evening cash
  after 8 pm went to the next day's drawer, so tonight's count came up short and tomorrow's over), the technician's
  **cash hand-off**, the Technicians screen (today's sales, services completed, the shift date a clock-in is filed under),
  the live technician schedule (the board's date and its "now" for blocked / next appointment), the Tech App (today's
  schedule, next appointment, earnings and counts), the Payment App's Reports tab, the Memberships dashboard (this month,
  last month, the daily line), the Owner App's All Salons totals (this month) and Revenue Overview chart (each salon's own
  hours — a 10 am sale in New York used to sit in the "14" bucket), messaging limits (this month / today, so a salon could
  no longer start a second month's allowance at 8 pm on the 31st), the AI Center and Call Intelligence "today", the
  demand series a product forecast learns from, and the daily KPI snapshot behind every "vs yesterday" arrow (the evening
  was filed under tomorrow and overwritten next morning).
- **One way to say it.** `@aipowersalon/date-time` gained `dayStartMs(tz)` and `monthStartMs(tz)` (the instant the
  branch's day / month began); `@aipowersalon/database` gained `tenantTimeZone` and `safeZoneName` — the only zone text
  ever written into SQL (where the same expression must appear in SELECT and GROUP BY); everything else is a bound
  parameter. Each repository takes a clock (`now`) so tests can stand at 9:30 pm.
- **The Tech App's 0 minutes.** A queue line is `estimatedDurationMinutes` and a front-desk price change
  `priceOverrideCents`; the Tech App read `durationMinutes` and the list price, so an offer showed 0 minutes and the list
  price until it had a ticket — and a ticket the Tech App created from it carried 30 minutes and the list price. One
  reader (`requestedLine`) now reads the queue's fields, and older rows still read.
- **Found on the way and fixed.** The POS Dashboard counted revenue only for payments marked `completed`, `paid` or
  `captured` — checkout writes `approved`, so the Dashboard's revenue, trend, payment mix and per-branch figures missed
  every payment the POS took; it now uses the shared revenue-status list. The Overview's revenue trend returned each day
  as a JavaScript date string ("Mon Oct 05 2026 …") instead of `2026-10-05`.
- **A ratchet so it does not come back.** The architecture test measures `date_trunc(…, now())`, `current_date`,
  `now()::date`, `setHours(0,0,0,0)`, `AT TIME ZONE 'UTC'` and timestamp `::date` casts per file; a file may only go down.
  The older `toISOString().slice(0,10)` ratchet now also lets a file go down without failing.
- **Left as they are, on purpose.** Super Admin's cross-salon screens (33 files, incl. the platform messaging oversight) count the platform's day, which has
  no single salon zone; three platform jobs count per UTC day by design — the booking-verification usage roll-up, the
  help-article view de-duplication, and the once-a-day forecast run guard.

## Part B (cont.) — Unit 10 delivered: Kevin's two decisions

**1. The cardholder signs once, on the Clover terminal.** Until now the display asked every approved card payment for a
signature on the 23-inch screen, and the terminal call sent `includeSignature: "false"` — so a terminal that asked on
its own made the customer sign twice.

- **The display never asks.** The state no longer carries `signatureRequired` / `signatureCaptured`; the receipt choice
  comes straight after the payment; release and the receipt no longer wait on a signature. The signature pad, its two
  routes (`POST /customer-display/checkout/:id/signature`, `POST /customer-display/device/signature`), their sessionless
  exemptions and the repository methods are removed (OpenAPI manifest −2 routes). A display built before this change
  shows no pad either — it only ever showed one when the server said a signature was owed.
- **The Clover asks.** The display's own terminal charge (Bolt `authCard`, the Clover registered to the branch or
  register) now sends `includeSignature: "true"`. The signature the terminal returns is decoded
  (`terminalSignatureDataUrl`: CardPointe's gzip-compressed bitmap, or a plain bitmap / PNG / JPEG; anything else, or
  over 2 MB, is not kept) and stored on the approved payment, one row per payment, `captured_on = 'terminal'`
  (migration 513 allows the value; display-captured rows from before stay valid). A decline keeps none; a missing or
  unreadable signature never touches the payment.
- **The front desk.** POS Checkout → View Signature shows it as before and now says where it was taken ("Signed on the card
  terminal at payment" / "on the customer display" for older payments).
- **Not yet confirmed with a device:** that a Clover answers authCard with the signature, and its exact encoding. The
  UAT probe (`apps/api/scripts/bolt_uat_roundtrip.py --tap`) now asks for it and reports what came back. A charge rung up
  on the Clover by itself (not through the display) is signed per the Clover's own settings, outside this code.

**2. A guest's chosen technician is the ASSIGNED technician** — as it already was, and as the POS walk-in records it;
`requested_technician_id` stays empty. Now pinned by a real-schema test (a check-in choosing Lisa → assigned Lisa).

## Part B (cont.) — Unit 11 delivered: one payment per ticket, Hold / Move, terminals on registers, no database login

**1. One payment at a time per ticket.** The display's card charge and a front-desk payment each had their own guard, so
a cash payment rung up while the customer was tapping their card was recorded beside the card charge — paid twice. Now
both take the ticket's one checkout lock (`checkout_locks`, one active row per ticket, the same lock the manager's phone
already used; new source `display`):
- the display's terminal charge holds it from the moment it starts until the outcome is recorded, through the
  terminal's wait for the card (4-minute expiry, so a crash never leaves a ticket stuck). If the front desk is already
  recording a payment, the display's charge does not start: the terminal is never asked, nothing is recorded, and the
  display hears `ticketBusy`;
- every front-desk payment (cash, card, gift card, split) holds it while it records and lets go afterwards, paid or
  refused. While the display's charge holds it, the front desk gets **409 `PAYMENT_IN_PROGRESS`** — "The customer is
  paying for this ticket by card on the terminal right now. Wait for it to finish." (new registry code, retryable). The
  manager's phone keeps its own wording;
- found while testing: a ticket paid in cash first was still charged by the display for the difference between the card
  and cash totals (the card fee). The display's charge now skips a paid ticket.

**2. Hold Ticket / Move to Front Desk do what they say** (both only showed a message before).
- **Hold** sets the ticket aside (migration 514: `tickets.checkout_held_at / checkout_held_by`): status "On Hold", out of
  the ready-for-payment queue and its count, items, tip and discounts untouched; a filter shows held tickets; **Resume**
  puts it back. A held ticket can still be paid, and paying clears the hold; a paid ticket cannot be held.
- **Move to Front Desk** lists this location's registers and moves the ticket to the one chosen
  (`tickets.checkout_register_id`, and its name on the ticket). Another location's register, a retired one, and a paid
  ticket are refused.
- Routes `POST /pos/checkout/tickets/:id/hold | resume | move` (take-payment permission), each audited; every POS in the
  branch refetches. OpenAPI manifest +3.

**3. Card terminals are tied to registers.** The pairing form asked for a free-text "Station" that no charge could ever
match — with two terminals, the display's charge could not find its own. Now the register is chosen from the location's
registers when pairing, can be changed (or cleared) later from Devices (`POST
/pos/settings/payments-checkout/terminals/:id/register`, audited; manifest +1), and Devices shows the register's name.
The display's charge uses the terminal tied to its register; with no match it says why ("no terminal is tied to this
register" / "several terminals are paired and this display serves no register") instead of picking one.

**4. The outside database login is out of the repository.** 35 tracked code files carried the login or public address of
an outside Postgres server (34 connection strings, 1 HTTP call; a report also named the address) — most as the silent default when `DATABASE_URL` was unset, so a script such as
`scripts/clean-bookings.mjs` run with no environment emptied tables on that server. Every one now reads `DATABASE_URL`
and stops with "Set DATABASE_URL: this script has no default database." when it is missing (no connection is attempted).
A new audit, `db credentials` (`tooling/security/check-db-credentials.py`, in `ci:gates`), fails on that address
anywhere, on a connection string to a public IP, on a login to a real host, and on a `host` set to a public IP. Local
Docker defaults (`aps:aps@localhost`) are unchanged. **The address and login are still in the git history** — the
password must be rotated and port 5432 closed to the internet; a history rewrite is a separate, deliberate step.

## Part B (cont.) — Unit 12 delivered: the remaining code gaps — UTC, which gift card paid, the display's typefaces, shared allowances

**1. The API and the worker run in UTC, whatever the host says.** About 140 places in server code use the process's local
date methods (Part D). Production happens to run in UTC; a host on New York time shifted renewals and billing. A new first
import (`apps/api/src/common/utc-clock.ts`, in `main.ts` and `worker.ts`) sets `TZ=UTC` before anything reads the clock
and says so once if the host had another zone. Salon days are unaffected — they use each branch's zone (Unit 9). Setting
`TZ=UTC` in Railway is no longer required (still harmless).

**2. A gift-card payment says which card paid.** The redemption's ledger row had `ticket_id` / `payment_id` columns since
migration 033 that nothing wrote, and the payment did not record the card. Now the redemption writes the ticket, ties
itself to the payment it paid (in the card's own salon's ledger — the issuing salon's for a network card), and the payment
keeps the card's last four (`payments.gift_card_last4`, migration 515: four letters or digits, gift-card payments only) —
the printed number's, or the code's for a digital card (the same four the POS already shows as `GC-****-7Q2K`). Single,
split and network-card payments all do it. The customer display shows "Paid · Gift card ending 4321" on a part-paid
ticket; the POS refund screen says which card a refund goes back to. Earlier payments stay "Gift card" (nothing links
them).

**3. The display's typefaces ship with the app.** The Google Fonts link asked for "Hanken Grotesque" — a family Google
does not have (it is "Hanken Grotesk"), so the display's sans-serif face could never load, online or not. The two
typefaces are now bundled (`@fontsource/hanken-grotesk`, `@fontsource/playfair-display`, OFL), nothing is fetched from
a font CDN (the generated CSP dropped both Google hosts), and an offline restart looks the same. With the real typeface
loaded, the layout proof found what the fallback font had hidden: the add-on chips' bottoms clipped, the descenders of
"Acrylic", "Spa", "Dip", "Change" cut off in every service tile, the "y" of the salon name cut off, and a four-line
ticket 2–6 px short at 1366×768 while the customer pays — all fixed, and the layout proof now checks that the faces are
loaded from the app and that no text is cut off at the bottom. **Not fixed here:** the same misspelling is in the
platform brand tokens and in the POS, Owner, Admin, Tech, kiosk and check-in-admin apps — none of them has ever shown
Hanken Grotesk. Fixing it there changes how every screen looks, so it is a decision for Kevin (Part C).

**4. The check-in allowances are the session's, on every API instance.** A guest's session may look up 8 phones and
create 3 profiles. The counts lived in each instance's memory, so two instances (or a restart) multiplied them. They are
now counted on the session row (migration 516) with one atomic `UPDATE … RETURNING`, scoped to the salon; a session that
does not exist, or is another salon's, counts as spent.

## Part B (cont.) — Unit 13 delivered: a visit is checked in all or nothing

"I'm Here" checks in every appointment of the guest's visit (Unit 7). It did so one appointment at a time — each its own
transaction — so a failure between two left the visit half checked in (the first in the queue, the second not) until the
guest tapped again. Now `CheckInService.visitCheckIn` records the whole visit in ONE transaction
(`KyselyCheckInRepository.createVisitRecords`): every queue entry with its `queue.customer_joined` event, every
appointment's "checked in" and its change-log line commit together, or none do. Appointments already checked in come back
as duplicates, as before. If another display checks the same visit in at the same moment, the database's one-active-entry
index refuses this transaction; it rolls back whole and re-reads what the other display recorded (once) — the guest never
sees an error, and no appointment gets two entries. The change-log line stays best-effort inside a savepoint, so it can
never abort the visit. The display's check-in (`GoCheckInService.checkInAppointment`) now makes one call for the visit.

## Verification (Oct 5–6 2026, final code)

| Check | Result |
|---|---|
| Repository gates + audits | 34/34 |
| API (6 shards) | 1,702 passed / 0 failed (1,673 before; +29 new) |
| Checkout module | 448 passed (+6 new) |
| Queue module | 314 passed (+2 from migration 503's fix) |
| Real-Postgres race lane (fresh DB, 504 migrations) | 28 files, 95 tests, 0 skipped |
| Customer display app | 49 passed; production build OK |
| POS checkout screen | 17 passed |
| Live proof `apps/api/scripts/live-display-lifecycle.mjs` (real API + Postgres) | 20/20: idle display hears Send to Display in 55 ms; POS tip reaches it in 21 ms; payment in 68 ms; release → `completed` in 7 ms; unpaid release 400; forged token 403 |
| Mutation checks | device room removed, nudge removed, signature/stale guards removed, 5 s hold, cover-not-destroy, no version guard, POS emits removed, realtime gate subscriber removed — each failed its tests/gate |

**Unit 2 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 34/34 |
| API (6 shards) | 1,707 passed / 0 failed (+5) |
| Checkout module | 472 passed (+24: 17 projection, 6 real-schema, 1 sync signal) |
| Real-Postgres race lane (fresh DB) | 28 files, 98 tests, 0 skipped (+3 terminal-capture amount tests, red before the fix) |
| Core harnesses | customer-display-core 38/38 (+2), checkout-core 84/84, gift-card charge 13/13 |
| Customer display app | 56 passed (+7); production build OK; POS checkout screen 17; pos-web tsc 0 |
| Live proof (real API + Postgres) | 28/28 — the POS tip shows on the display (1,960 = 1,960); display lines and total = the POS's (12,896 = 12,896); nothing internal in the state; a $3 manual discount keeps the $5 promotion on the POS and the display; the paid display shows Cash and total paid = what the POS recorded |
| Mutation checks | snapshot not read (pgtest 3 fail; LIVE 2 fail — the promotion was wiped), full technician name, input spread into the output, fee from totals after payment, itemized-discount fallback, tip on the pre-discount subtotal, session tip copy, method not written to the ticket, client-side total, technician hidden — each failed its tests |

**Unit 3 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 35/35 (new audit: `frontend builds` — all seven web apps build for production) |
| API (6 shards) | 1,713 passed / 0 failed (+6: the display's ad routes, the public-store pin) |
| Marketing module | 88 passed — rules 55, image checks 14, real schema (PGlite, all migrations) 19 |
| Real-Postgres race lane (fresh DB, all migrations) | 29 files, 102 tests, 0 skipped (+4: two saves of one version at once → one wins, the other VERSION_CONFLICT; five creates race for the last ad slot → exactly one; three uploads race for the last of the storage limit → the limit holds; one report batch sent three times at once → counted once) |
| All module suites (`run-tests.mjs modules`) | 26 suites, 6,667 passed, 0 failed |
| All web-app suites (`run-tests.mjs apps`) | 7 suites, 2,474 passed, 0 failed — POS 897 (advertising page 10, image pipeline 12), admin 856 (settings panel), owner 264, customer 229, tech 112, manager-pay 60, display 56; shared UI 74 (ad slide / rotator 9); permissions 37 |
| Live proof `apps/api/scripts/live-display-ads.mjs` (real API + Postgres + object storage) | 42/42 — upload lands in storage (the DB holds keys only), an HTML file named .png refused; the idle display hears a publish in 19 ms and a pause in 9 ms; its playlist carries nothing internal; the other salon's display plays only its own ad; branch targeting; schedule hours; branch and display switches with the right `offReason`; display counts (a resend counted once); a stale edit → 409; forged device tokens 403; archive + delete empties storage; every action audited |
| Browser proof `apps/api/scripts/live-display-ads-browser.mjs` (Chromium, built POS) | 14/14 — owner signs in, opens the page from Marketing & Growth, uploads; the browser made WebP copies 1080×1620 / 720×1080 / 213×320 and the server accepted them; smart crop leans to the subject (0.682, 0.357); Publish now → ACTIVE and showing; the display's playlist has it; the 1920×1080 preview renders; no page errors |
| Mutation checks (28) | playlist without the salon filter; branch targeting ignored; a manager may manage any ad; daily hours ignored; edit without the version; create without the salon lock; declared MIME not compared; another salon's ad ids counted; a resent batch counted again; every display nudged; a refused upload left in storage; the display layer ignored; a legacy plan blocked; publish while unavailable; storage limit off; a manager changes salon-wide settings; markup allowed in text; copy shape unchecked; a lone ad reported once; contain drawn as cover; POS sends a wrong version; delete without asking; editor saves without the version; the display names its own branch; no ads → error instead of the branded panel; advertising keys not mapped (every owner refused); the original's address handed out; the original without its random token — each failed its tests (the first was caught only after repository-level assertions were added: the service's own filter had hidden it) |

**Unit 4 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 35/35 (29 gates + 6 audits, incl. lint ratchet and all seven production builds) |
| API (6 shards) | 1,725 passed / 0 failed (+12: display branding on real schema 6, check-in during checkout 4, the logo-store pin, the delegated settings writer) |
| All module suites (`run-tests.mjs modules`) | 26 suites, 6,678 passed, 0 failed — tenants 77 (salon logo on real schema 8), marketing 89 (`validUntil`), queue 316 (never another branch's kiosk) |
| All web-app suites (`run-tests.mjs apps`) | 7 suites, 2,545 passed, 0 failed — customer display 119 (was 56), POS 905 (logo + display branding settings 8) |
| Core harnesses (Nest-free) | 124 suites, 0 failed — settings-core 105 checks (+3: a readable JPEG labelled PNG, a fake PNG header, the receipts logo switch), check-in-core 110/110 (its data assumed the pre-Unit-1 rule; fixed) |
| Real-Postgres race lane (fresh DB, 506 migrations) | 29 files, 102 tests, 0 skipped |
| Layout in Chromium (`tooling/e2e/customer-display-layout.mjs`, built app) | 204/204 at 1920×1080, 1600×900 and 1366×768 — idle + ad, appointment found, checked in, walk-in, a §33 checkout, a 24-line checkout (scrolls inside, totals pinned), customer pays, processing, completed; full-screen idle: no page scroll, nothing clipped or overlapping, every button ≥ 44 px, pictures never distorted |
| Live browser proof `apps/api/scripts/live-display-23in-browser.mjs` (Chromium 1920×1080, real API + Postgres + object storage, built display and POS) | 37/37 — the ad plays from the device cache; the owner sets the tagline + branch name and uploads a 1200×480 transparent PNG in the POS (shrunk to 800×320 in 99 ms, transparency kept, stored salon-wide, served byte-identical) and the display shows them on its next sync; a real walk-in check-in on the display lands in the branch queue, typed data gone at once, the result gone after the hold; full-screen ad after 30 s, the ending touch presses nothing; POS Send to Display → the ticket takes the right panel in 122 ms with the ad gone and check-in still usable; a tip tapped on the display lands on the POS ticket; cash payment → "Thank you, Sophia" + the total the POS recorded in 101 ms → back to ads 3.46 s later as seen from outside (the display's own timer is 3,000 ms, pinned by its tests) with nothing of Sophia in the page or on the device; the session released on the server; 6 displays reported; API stopped → the ad keeps playing; restart with the API down → the salon and its saved ad; API back → reconnected by itself in 13 s; no page errors |
| Mutation checks (48) | 43 caught on the first run: an ad over a payment in flight; thank-you before an owed signature; the cleared state spreads the customer's; branding dropped / copied wholesale; an ad change refetches the checkout; realtime nudge ignored; offline list past `validUntil`; sub-second slots counted; a retried batch under a new id; pictures never evicted; full-screen during checkout; the ending touch falls through; result hold unclamped; typed data kept; branding switch ignored; control characters shown; branch name without the setting; idle state without branding; a foreign logo address; the old logo file kept; markup or an over-long tagline accepted; no `validUntil`; branch-name choice not saved; the receipt logo box out of step; small logos enlarged; SVG offered; the offline screen (6 ways); the request storm (3 ways); check-in dropped during checkout (3 ways); another branch's kiosk (2 ways). **5 survived and exposed weak tests**, each now caught: full-screen over someone mid-check-in (the test armed its fake clock after the render — it never ran), the declared type unchecked and the byte sniff bypassed (the test images were unreadable anyway), the logo read without its tenant filter (only one salon was read back), the uploaded logo not switched on for receipts (it already defaulted to on) |

**Unit 6 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 35/35 (29 gates + 6 audits, incl. lint ratchet, OpenAPI manifest, secrets, tenant SQL and all seven production builds) |
| API (6 shards) | 1,778 passed / 0 failed (+53: display devices + the public door 21, receipt step 14, real schema 12, sessionless display routes 6) |
| All module suites (`run-tests.mjs modules`) | 26 suites, 6,693 passed, 0 failed — checkout 487 (Send / Switch Display and the display's receipt 13; the receipt states what was charged 4, was 2) |
| All web-app suites (`run-tests.mjs apps`) | 7 suites, 2,581 passed, 0 failed — customer display 143 (was 119: credential and header stream 8, pairing 4, receipt and device 12), POS 917 (was 905: Customer Display card + page 11, To Display offline 1) |
| Packages | permissions 39 (front desk operates, owner manages), api-contracts 33 (device rules 7), shared UI 74 |
| Core harnesses (Nest-free) | 124 suites, 0 failed |
| Real-Postgres race lane (fresh DB, 507 migrations) | 30 files, 105 tests, 0 skipped (+3: eight owners from two salons type one code at once → one display, for one salon; a display polling twice at once collects its credential once; two taps on a receipt choice → one choice recorded) |
| Live browser proof `apps/api/scripts/live-display-devices-browser.mjs` (Chromium, real API + Postgres, built display and POS) | 29/29 — an unpaired display shows an 8-digit code and nothing to type; the server keeps its hash only; the owner adds a register and pairs the display to it from the POS; the display collects its credential in 1.9 s and becomes the 23-inch screen, the credential in its store and in no address; the §86 table shows its register, 23-inch landscape, 1920×1080, mode and version from its own heartbeat; the Checkout card says Connected; Send to Display uses this register's display — Mia's ticket takes the right panel in 234 ms and the card says Active "Showing Mia's checkout"; Refresh Display; cash payment → the receipt question with the phone masked and email not offered (no provider), still on screen after 4.5 s; the choice recorded once and reported honestly (a dummy SMS account: "couldn't send", never "texted"); then the 3-second screen (2.8 s seen from outside), Mia gone, ads again; maintenance on/off; the display goes quiet → Offline, To Display off, Open on second screen opens the display window; restart with the stored credential; revoke → a new pairing code; the audit trail; no page errors |
| Earlier live proofs, re-run on the final code | Unit 1 lifecycle 29/29 (the proof display now sends its heartbeat, as the app does — Send to Display never picks a display that has not reported in); Unit 3 advertising 42/42 and browser 14/14; Unit 4 23-inch browser 37/37 |
| Mutation checks (52) | 51 caught: poll secret unchecked; another branch's display; the heartbeat wakes every POS; maintenance over a checkout; the open-code ceiling off; the pairing rate limit off; heartbeat / poll routes not public; pairing by the front desk (the OpenAPI review record); a claimed code claimed again; a credential collected twice; a never-collected display kept; a receipt choice claimed twice; release while choosing; a simulated SMS offered; the phone unmasked; an un-offered channel sent; a stale checkout without its automatic receipt; the question before the signature; a second tap sending again; an offline / maintenance / other register's display picked; switching mid-payment; busy not falling through; switching leaves the old display; Send needs the owner; a cash receipt quoting the card total; a simulated provider counted live; a released session still "on the display"; every display online; the front desk unable to operate; MAINTENANCE under a checkout; the online-window boundary; masks showing more; the token left in the address; a refused stream opened; forget keeping the credential; the 3 s ignoring the receipt; a session link treated as revoked; no automatic receipt; Refresh keeping the old stream; maintenance reported as busy; a rate-limited display hammering; Offline shown as Connected; To Display / card Send while offline; the register ignored; a busy display preferred; revoke without confirming. **3 survived the first run and exposed weak tests** (now caught): an un-offered channel (the test named the case but never asserted it), a second tap at the same moment (no race at the service level), a simulated provider counted live (no test used one). 1 weak test was strengthened before the run (revoke: nothing may happen before the owner confirms). **1 equivalent survivor:** the service's own "already collected" check — the repository refuses a second pickup anyway, and that guard is the one mutation-checked above |

**Unit 7 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 35/35 (the first run failed the lint ratchet — one new hook warning in the display's session hook; restructured, 0 new warnings) |
| API (6 shards) | 1,786 passed / 0 failed (+8: the display's check-in door 7 — state flag, credential decides, serviced/forged/revoked refused, 30 a minute per display, honest 403/409; sessionless route 1) |
| All module suites (`run-tests.mjs modules`) | 26 suites, 6,728 passed, 0 failed — queue 351 (rules 10, display check-in service 15, real schema 10: migration 512's constraints, the branch catalog, technician facts incl. split shifts and last night's punch, the visit, the display end to end, the add-on and override kept by the queue, the branch's day) |
| All web-app suites (`run-tests.mjs apps`) | 7 suites, 2,597 passed, 0 failed — customer display 157 (was 143: one session per guest, a session the server ended replaced, a refused start backing off, add-ons with a service, the walk-in minimum, technicians re-asked, a returning guest looked up, walking away, the visit compact, the engine's band, the portrait screen), POS 919 (add-ons in any spelling 2) |
| Packages | permissions 39, api-contracts 33, shared UI 74 |
| Core harnesses (Nest-free) | 124 suites, 0 failed |
| Real-Postgres race lane (fresh DB, 508 migrations) | 30 files, 105 tests, 0 skipped — the first run failed one test that pinned the check-in clock's old shape (it now also carries the minute and weekday); updated, green |
| Single-file HTML apps in Chromium (`apps/api/scripts/e2e-html-apps.mjs`) | all five journeys, 47 calls verified — the kiosk now: the branch's price, an add-on only with a service, technicians asked for the chosen services, "From 2:00 PM", the engine's band, a visit with "+ 1 more" checked in by one tap. (This machine's Chromium is older than the repo's Playwright expects; the run pointed Playwright at `/opt/pw-browsers/chromium`.) |
| Layout in Chromium (`tooling/e2e/customer-display-layout.mjs`) | 222/222 at 1920×1080, 1600×900, 1366×768 — now with a visit compact and opened, and a walk-in with seven services, two add-ons and a technician. First run: the Unit 6 Full screen button was 33 px tall on every screen (§89 says 44) — fixed |
| Live browser proof `apps/api/scripts/live-display-checkin-browser.mjs` (Chromium, real API + Postgres, built display) | 39/39 — a branch with no kiosk: the display's session names the display and no kiosk, the request names no salon or branch; the same Gel Manicure $50 here and $55 on Main's display; technicians: Lisa "From 12:00 PM", Mia clocked in though off the schedule, not Ava (off today), not Nora (switched off by the front desk), narrowed to Lisa for manicure + pedicure; Sophia's visit "Today at 11:00 AM" with Olivia and Mia, "+ 1 more", no page scroll at three sizes, one "I'm Here" checks both appointments in, the engine's 0–10 min band; the next guest's tap clears Sophia and ends her session; Ethan's walk-in: the add-on waits for a service, the queue entry has the branch's prices, the add-on attached to its service, Lisa, a new profile from name + phone, 110 min worked out by the server; 11 guests, 11 lookups answered, the ninth inside one session refused; a guest walking away cleared at 90 s and their session ended; maintenance and revoke refuse the display's open session on the next request. The first runs found the queue dropping the add-on and the hidden technician (both fixed) |
| Earlier live proofs, re-run on the final code | Unit 1 lifecycle 29/29; Unit 3 advertising 42/42 and browser 14/14; Unit 4 23-inch browser 37/37 (its walk-in now on the display's own check-in); Unit 6 devices browser 29/29 |
| Mutation checks (58) | 57 caught on the first run: front desk's "off" ignored; unqualified technicians listed; add-ons needing a skill; blocked time ignored; a finished shift still working; full names shown; the visit anchored on the day's first appointment; the visit spanning the day; a 15-minute band; another branch's catalog; a retired service offered; an archived technician listed; split shifts ignored; last night's punch ignored; another branch's appointments; a technician's full name in the visit; another salon's display; a serviced display usable; the UTC day; a session while switched off; a revoked display continuing; only the tapped appointment checked in; an add-on alone; no service required; any technician accepted; the catalog unchecked; the door unlimited; a serviced display starting check-in; check-in offered in maintenance; the door behind a login; an unused session renewed; never renewed; an ended session not replaced; retries hammering; the session left open; technicians not re-asked; an unqualified choice kept; no walk-away; walk-in without looking the phone up; add-on alone on the display; add-ons outliving their service; phone not required; service not required; the visit not compact; the wait computed on the display; the add-on chip always on; a kiosk slug deciding (23-inch); the cleared screen dropping / keeping check-in; the kiosk listing all technicians, an add-on alone, its own wait, the first service only; the POS's one-spelling add-ons; visit rows in booking order; the queue dropping add-ons; the queue dropping overrides. **1 survived and exposed a weak test** (now caught): the portrait screen deciding by the kiosk slug — its test ran at jsdom's landscape size, so it exercised the 23-inch layout instead |

**Unit 8 (Oct 6 2026, final code — no product code changed since Unit 7's full lanes):**

| Check | Result |
|---|---|
| Repository gates + audits | 35/35 |
| All web-app suites | 7 suites, 2,606 passed, 0 failed — customer display 166 (+9: the production-data scan) |
| Live journeys `apps/api/scripts/live-display-journeys-browser.mjs` (Chromium, real API + Postgres, built display and POS) | 43/43 — §117 and §118 end to end; POS Queue shows the guest 0.4 s after "I'm Here"; Send to Display 0.17 s; a POS discount on the display in 0.08 s; the display's tip on the POS ticket; cash shows the cash total; 3 s → ads (2.97 s from outside); §107 frame by frame; one screen element throughout; §103 restart → the same checkout in 0.3 s, no ad first; §102 API down → checkout kept, back by itself (2.6 s); §104; §100 the branch's other display never shows a customer, even restarted mid-checkout; §119 / §120 in the browser; check-in isolation; the 15 s safety sync measured (13–16 s) |
| Unit 7 check-in proof, re-run with the new cleanup | 39/39; nothing left behind (proof branches, customers, displays, ads: 0) |
| Layout (three sizes) · single-file HTML apps in Chromium | 222/222 · all five journeys, 47 calls |
| Mutation checks (3) | a display that shows ads while it loads (caught by §103); a server that hands a display any active checkout (**survived** the first run — the other displays asked only on their timer and both checkouts ended between asks; caught once the proof restarts them mid-checkout); a planted sample name in shipped code (caught by the scan) |

**Unit 9 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 35/35 (29 gates + 6 audits; the architecture test now carries the server-UTC-day ratchet) |
| API (6 shards) | 1,786 passed / 0 failed (unchanged — the new tests sit with the repositories they test) |
| All module suites (`run-tests.mjs modules`) | 26 suites, 6,767 passed, 0 failed (+39, every one on the real migrated schema at a fixed 9:30 pm New York clock unless noted): queue +11 (Service Done, Serving, Tech Queue KPIs and hourly chart, Tech App schedule / next appointment / the queue line's minutes and price, live schedule), checkout +8 (Checkout KPIs, cash drawer date and register cash, Payment App report — pure), workforce +4 (today's sales, services done, shift date, cash hand-off), tenants +4 (owner month, chart hours, two zones), communications +2, memberships +2, ai +4, analytics +3 (Overview, arrivals, Dashboard incl. an `approved` payment), reports +1 (KPI snapshot across midnight) |
| All web-app suites (`run-tests.mjs apps`) | 7 suites, 2,606 passed, 0 failed (no app code changed) |
| Packages | date-time 10 (`dayStartMs` / `monthStartMs`: New York and Los Angeles evenings, month end, both DST changes), database 25 (`tenantTimeZone` 3, `safeZoneName` 1), permissions 39, api-contracts 33, shared UI 74 |
| Core harnesses (Nest-free) | 124 suites, 0 failed |
| Real-Postgres race lane (fresh DB, 508 migrations) | 30 files, 105 tests, 0 skipped |
| Live proof `apps/api/scripts/live-local-day.mjs` (real API + Postgres) | 13/13 — a proof branch in Pacific/Kiritimati (UTC+14: Oct 7 there, Oct 6 in UTC). Three paid, tipped tickets with cash payments: 30 min after the branch's midnight (a different UTC date), 30 min before it, and a minute ago. The owner signs in, works in the branch and reads what the POS screens read: Overview business date 2026-10-07 in the branch's zone, today's revenue $30 (not $10 — the UTC day saw only the last ticket), the trend files the $40 under Oct 6 as `YYYY-MM-DD`; Dashboard $30; Checkout tips $3 and 2 paid tickets; Service Done tips $3; Technicians' sales $30; the cash drawer opens on Oct 7 with $30 of register cash from 2 payments; no API errors; the branch and everything in it removed |
| Earlier live proofs, re-run on the final code | Unit 1 lifecycle 29/29; Unit 7 check-in browser 39/39; Unit 8 journeys browser 43/43 (proof branches removed) |
| Mutation checks (31) | 31 caught: the UTC day put back in Service Done, Serving, the Tech Queue, the Tech App, the live schedule, Checkout, the technicians' sales and shift date, the cash hand-off, messaging limits, the owner's month and chart hours, Memberships, the demand series, Call Intelligence, the AI Center, the Overview, the Dashboard, the arrivals board, the KPI snapshot and the Payment App report; the cash drawer's payment date and default date; the Tech Queue chart's hours; `dayStartMs` off by the zone; the Tech App reading `durationMinutes` only / ignoring the price change; the Dashboard without `approved`; the trend's dates as Date objects; `safeZoneName` letting text through; `tenantTimeZone` taking an invalid zone. The ratchet: a planted `date_trunc('day', now())` and a planted `paid_at::date` each failed the architecture test |

**Unit 10 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 35/35 (OpenAPI manifest: the two display signature routes removed) |
| API (6 shards) | 1,785 passed / 0 failed (−1: two removed routes out of the sessionless list, +1 terminal-signature test). The first run failed one test — the public-route baseline still listed the two removed routes; the baseline shrank, the re-run passed |
| All module suites | 26 suites, 6,771 passed, 0 failed (+4: Bolt asks for and returns the signature, the decoder takes CardPointe's format and refuses anything else or too big, the chosen technician is assigned) |
| All web-app suites | 7 suites, 2,609 passed, 0 failed — customer display 167 (a paid card checkout never shows a pad, even if an older server says one is owed), POS 921 (View Signature says where it was signed, both ways) |
| Packages · harnesses · race lane (fresh DB, 509 migrations) | 146 passed · 124 suites (customer-display-core 30/30) · 30 files, 105 tests, 0 skipped |
| API real-schema test `payment-signature.pgtest` (rewritten) | 6/6 — the terminal's signature kept as a viewable bitmap marked "terminal"; the POS reads it, another salon cannot; a second tap charges and writes nothing; none / not-an-image → payment stands, nothing stored; a decline keeps none; migration 513's CHECK and default |
| Wire-level terminal proof `apps/api/scripts/verify-terminal-capture.ts` (a real local HTTP server speaking Bolt + real Postgres) | 17/17 — authCard carries `includeSignature:"true"`; the approved charge is the ticket's card total; the signature the "terminal" returns is on the payment, marked terminal; the display asks for none; decline, cash, front-desk mode and a terminal with no HSN all honest. (It had gone stale — 10 of 17 failed on its first run; see Part B) |
| Live proofs, re-run | Unit 9 local day 13/13; Unit 1 lifecycle 29/29; Unit 6 devices browser 29/29 (the receipt step); Unit 8 journeys 43/43; layout 222/222 |
| Mutation checks (17) | 16 caught on the first run: the server asks for a signature again; release waits for one; the display shows a step for an older server; the 3 seconds wait for one; the terminal not asked; its signature dropped by the client; gzip not undone; any bytes taken as an image; the signature never stored / stored raw / kept on a decline; migration 513 without 'terminal'; the POS read loses where it was signed; the POS viewer always says "display"; the chosen technician recorded as a request. **1 survived** (the 2 MB cap on an uncompressed image — only the compressed limit was tested); a test was added and it is caught |

**Unit 11 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 36/36 (29 gates + 7 audits — new: `db credentials`). The first run failed three: `types-drift` (a comment line in `kysely.types.ts` was read as a column), the lint ratchet (+2 unused names in a new test) and the architecture test (the two Hold / Move queue signals are momentary screen signals — marked §343-exempt like their siblings); all fixed, green |
| OpenAPI manifest | 2,601 routes (+4: hold, resume, move, a terminal's register), `check:openapi` green |
| API (6 shards) | 1,790 passed / 0 failed (+5: one payment per ticket on the real schema — cash refused while the display charges, the display not starting while the front desk records, a silent terminal still letting go, cash first → nothing left to charge, several terminals → the register's own) |
| All module suites | 26 suites, 6,788 passed, 0 failed (+17: checkout 507 — one payment per ticket 7, Hold / Move on the real schema 5; tenants 86 — a terminal's register on the real schema 5) |
| All web-app suites | 7 suites, 2,614 passed, 0 failed — POS 926 (+5: Hold → Resume, Move lists the registers and moves, Devices shows and changes a terminal's register, pairing picks a register) |
| Packages · harnesses · race lane (fresh DB, 510 migrations) | 181 passed · 124 suites, 0 failed (the first run failed one: `settings-core` paired a terminal to the typed name "st1" — exactly what is now refused; it now pairs to a register and checks that a typed name and another location's register are refused, 101 checks) · 30 files, 105 tests, 0 skipped |
| Live proof `apps/api/scripts/live-checkout-one-payment.mjs` (real API + Postgres) | 26/26 — while the display's card charge holds the ticket, front-desk cash gets 409 `PAYMENT_IN_PROGRESS` with the front-desk wording and nothing is recorded; once it lets go, cash is taken once and the front desk's own hold is released; a second cash payment refused; Hold → "On Hold" with the tip kept, found by the filter, Resume → back in the queue; a paid ticket cannot be held; Move → "Back Register" on the ticket and in the list; another location's, a retired and a nonsense register refused, a paid ticket not moved; a terminal tied to "Front Desk", shown by name in Devices, another location's register refused with nothing changed, cleared; no API errors; both proof branches removed |
| Wire-level terminal proof (real local Bolt server + disposable Postgres) | 17/17 (now through the ticket lock) |
| Live proofs, re-run | Unit 9 local day 13/13; Unit 1 lifecycle 29/29; Unit 6 devices browser 29/29; Unit 8 journeys 43/43; layout 222/222 |
| Outside database login | 0 occurrences of the address in tracked files; 3 of the scripts run with no `DATABASE_URL` stop with "Set DATABASE_URL" before connecting; the new audit fails on the original files (7 hits in 4 files) and passes now; its rule cases 10/10 |
| Mutation checks (18) | 18 caught: the front desk ignoring the lock; letting go before it records; the display charging without the lock; never letting go; a paid ticket charged again; any terminal instead of the register's; a held ticket left in the ready queue; paying keeping the hold; Move accepting another location's or a retired register; Hold without the permission; a terminal's register unchecked; another location changing the terminal; Devices showing an id; the POS Hold and Move buttons doing nothing; the Devices register list not saving; the audit itself (the original files put back) |

**Unit 12 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 36/36 (29 gates + 7 audits). The tenant-scoping gate caught the first version of the allowance counter (it updated the session by id alone); it is now scoped to the salon |
| API (6 shards) | 1,793 passed / 0 failed (+3: the process on UTC — a child process, `pinUtc`, the import order) |
| All module suites | 26 suites, 6,798 passed, 0 failed (+10: checkout 515 — gift card 7 + network card 1; queue 365 — allowances 2). The first run failed one queue file: an unescaped apostrophe in a new test name stopped it compiling (and so it had also not run in the first mutation pass — the four allowance mutations were re-run after the fix and are caught) |
| All web-app suites | 7 suites, 2,615 passed, 0 failed — POS 927 (+1: the refund panel names the gift card); customer display 167. The first run failed one owner-web test (HardwarePaymentScreen, untouched by this unit) while a mutation run shared the machine; it passed alone 3/3 and the whole owner-web suite re-ran green (264) |
| Packages · harnesses · race lane (fresh DB) | 181 passed · 124 suites, 0 failed · 31 files, 106 tests, 0 skipped (+1: the allowance race) on a fresh database with all 512 migrations |
| Real-schema tests | gift card 7/7 (printed number, digital code, part-paid display label and nothing more of the card, split, refund preview, migration 515's CHECK, the helper) + the network-card case in the cross-salon suite (B's payment keeps the last four, A's ledger row names it); check-in allowances 2 (two instances share one session's 8 lookups — the ninth refused on either and after a restart; ten at once count 1…10, per kind; another salon's or a missing session counts as spent) |
| Real-Postgres race test (new, in the race lane) | twelve lookups of one session at once → counts 1…12, exactly 8 allowed |
| UTC | a child process started with `TZ=America/New_York` reads 10 pm Oct 5 there as Oct 6 02:00 once the module loads; `main.ts` and `worker.ts` import it first; live: the API started with `TZ=America/New_York` says it runs in UTC and every proof check passes |
| Live proof `live-checkout-one-payment.mjs` (real API + Postgres) | 30/30 — Unit 11's 26 plus: the UTC notice; a $10 gift card pays part of a ticket and the payment keeps "4321"; the ledger row names the ticket and the payment; the refund preview names the card and never the code |
| Layout in Chromium (built display, no internet) | 255/255 at three sizes (was 222; +3 typefaces loaded from the app with no CDN request, +30 no text cut off at the bottom). The first runs with the real typeface failed 4, then 30 — see Part B |
| Live proofs, re-run | terminal wire proof 17/17; Unit 9 local day 13/13; Unit 1 lifecycle 29/29; Unit 6 devices browser 29/29; Unit 8 journeys 43/43; Unit 7 check-in browser 39/39 (the ninth lookup in one session still refused — now counted on the session row) |
| Mutation checks (23) | 22 caught (the four allowance checks counted from their re-run — see the module row): UTC import removed from the API / the worker; `pinUtc` leaving the zone; the payment not keeping the card; the ledger row not tied / tied in the wrong salon / without the ticket; the split dropping the card; the display saying only "Gift card"; the refund preview losing the card; migration 515 accepting anything; six characters of the code; the POS refund panel; the allowance back in instance memory; a missing session counted as fresh; the count not scoped to the salon; lookups and creates sharing a count; a read-then-write count (the race test); service names squeezed; the salon name cut off; the ticket line padding back; a dropped Playfair 700 face. **1 survived** (dropping the 400 weight of the sans face — the check looked at families, not weights); the check now requires the 400 and 700 faces and it is caught. The tenant-scoping gate also caught the first version of the allowance counter (it updated the session by id alone) |

**Unit 13 (Oct 6 2026, final code):**

| Check | Result |
|---|---|
| Repository gates + audits | 36/36 (29 gates + 7 audits) |
| API (6 shards) | 1,793 passed / 0 failed (unchanged — the work is in the queue module) |
| All module suites | 26 suites, 6,802 passed, 0 failed (+4: queue 369 — the visit on the real schema) |
| All web-app suites | 7 suites, 2,615 passed, 0 failed (no app code changed) |
| Packages · harnesses · race lane (fresh DB) | 181 passed · 124 suites, 0 failed · 31 files, 108 tests, 0 skipped (+2: the visit races) on a fresh database with all 512 migrations |
| Real-schema tests (queue, PGlite) | 4 new: a two-appointment visit → two entries, both appointments checked in, two change-log lines, a second tap changes nothing; another branch's appointment in the list or no check-in right → nothing written; a failure on the second appointment → nothing left, not even the first, and the next tap records the whole visit; another device's entry landing mid-tap → this tap rolls back, re-reads, records only the rest |
| Real-Postgres race lane (2 new) | six displays tap "I'm Here" for the same two-appointment visit at once → one entry per appointment, nobody refused, exactly one tap recorded it, all six answer with the same entries; a failure on the second appointment on real Postgres (real separate connections) → no entry and both appointments still "booked" |
| Live proofs, re-run | terminal wire proof 17/17; Unit 9 local day 13/13; Unit 1 lifecycle 29/29; Unit 6 devices browser 29/29; layout 255/255; Units 11–12 30/30; Unit 7 check-in browser 39/39 — one "I'm Here" checked BOTH appointments of Sophia's visit in, now through the one-transaction path; Unit 8 journeys 43/43. The last two refuse to run after 7 pm / 9 pm New York (they need a working day ahead at the proof branch); it was 9 pm, so they ran with their proof branch in Asia/Tokyo (new `PROOF_TZ` setting — the branch, its shifts and appointments all in that zone) |
| Mutation checks (6) | 6 caught: the visit written one appointment at a time; the appointment's status written outside the transaction (**survived** the PGlite tests — PGlite has one connection, so "outside" was still inside; caught by the new real-Postgres test); no re-read after the other device won; the visit without the check-in right; an existing check-in not recognised; the display checking in one appointment per call. The mutation runner now counts a check as caught only when a test fails — not when a file fails to compile (Unit 12's lesson) |

## Part C — known gaps and build order

**Closed in Unit 2:** the Unit-1 gap (a POS tip reached the display but showed $0) — the display now reads the ticket.

**Remaining risks recorded (not fixed in Unit 2):** ~~a terminal charge from the display and a POS cash payment on the same
ticket at the same instant are not serialized by one lock (each path has its own guard)~~ — done in Unit 11 (one lock per
ticket); ~~a gift-card payment cannot show
the card's last four digits — the redemption ledger row records neither the ticket nor the payment~~ — done in Unit 12. ~~"Receipt sent
successfully" on the completed screen waits for the receipt step~~ — done in Unit 6.

1. ~~Unit 2 — customer-safe checkout DTO from the ticket~~ — DONE Oct 6 (Part B).
2. ~~Unit 3 — advertising backend (§47–§78, §110–§111)~~ — DONE Oct 6 (Part B), together with Unit 5.
3. ~~Unit 4 — the 23-inch layout (§2–§7, §13–§28, §79–§80, §87–§95), ads on the display, salon branding~~ — DONE Oct 6
   (Part B).
4. ~~Unit 5 — POS advertising page + preview + analytics (§48–§59, §109)~~ — DONE Oct 6 with Unit 3.
5. ~~Unit 6 — POS display status + actions, device states, pairing modes, receipt step (§8–§12, §81–§86, §97–§98,
   §122–§127)~~ — DONE Oct 6 (Part B).
6. ~~Unit 7 — check-in fixes: branch-scoped services, working/qualified technicians, multi-service appointments~~ —
   DONE Oct 6 (Part B), with one device identity for the display's check-in.
7. ~~Unit 8 — journeys, isolation tests, final §131 report~~ — DONE Oct 6 (Part B; `DUAL_SCREEN_FINAL_REPORT.md`).
8. ~~Unit 9 — the salon's day in every salon-facing count; the Tech App's minutes~~ — DONE Oct 6 (Part B).
9. ~~Unit 10 — Kevin's decisions: sign once on the Clover; the chosen technician is assigned~~ — DONE Oct 6 (Part B).
10. ~~Unit 11 — one payment per ticket; Hold / Move; terminals on registers; the outside database login removed~~ — DONE
    Oct 6 (Part B).
11. ~~Unit 12 — UTC in the process; which gift card paid; the display's typefaces; shared check-in allowances~~ — DONE
    Oct 6 (Part B).
12. ~~Unit 13 — a visit of several appointments checked in all or nothing~~ — DONE Oct 6 (Part B).

**Recorded in Unit 4, not fixed:** ~~the display loads its two typefaces from Google Fonts — a display that restarts with
no internet shows the system serif and sans until it is back~~ — done in Unit 12 (bundled; and the sans face had never
loaded at all: the link misspelled it). ~~The device token
rides in the stream address~~ — fixed in Unit 6 (header-only stream); the server still accepts the old `?deviceToken=`
form so a display built before Unit 6 keeps working until it is updated — remove it once every display runs this build.

**Recorded in Unit 6, not fixed:**
- ~~One physical display still has two identities~~ — done in Unit 7: the display checks guests in with its own
  credential.
- ~~Card terminals are not tied to registers yet~~ — done in Unit 11: a terminal serves one of the location's registers,
  and the display's charge uses its register's terminal.
- ~~On POS Checkout, "Hold Ticket" and "Move to Front Desk" only show a message~~ — done in Unit 11.
- Receipts on the display are offered only for channels with a real provider: text needs `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`, email needs `SENDGRID_API_KEY` in the API's variables. Without them the
  display skips the question (it never claims a receipt it cannot send).
- Placing the window on the second monitor needs the Window Management API (Chrome or Edge, one permission); other
  browsers open an ordinary window to drag there.

**Recorded in Unit 7, not fixed:**
- ~~A guest's chosen technician becomes the queue entry's ASSIGNED technician — Kevin's call~~ — **Kevin decided (Oct 6):
  assigned**, as the POS walk-in records it (`requested_technician_id` stays empty); pinned in Unit 10.
- ~~A visit of several appointments is checked in one appointment at a time~~ — done in Unit 13: all or nothing, in one
  transaction.
- ~~The 8-lookup / 3-profile allowances are counted in the API instance's memory~~ — done in Unit 12 (on the session row).
- ~~`date_trunc('day', now())` — the database's UTC day — is still used in 38 places in 14 repositories~~ — done in Unit 9,
  in every salon-facing count (29 files); Super Admin's platform-wide screens and three platform jobs keep the UTC day on
  purpose (Part B, Unit 9).
- ~~The Tech App's ticket view reads a queue line's minutes as `durationMinutes`~~ — done in Unit 9 (and the front desk's
  price change with it).
- `goCheckInSlug` is still sent in a display's state, for displays built before Unit 7 — remove it with the
  `?deviceToken=` form once every display runs this build.

**Decision for Kevin (Unit 12):** the brand typeface is misspelled platform-wide ("Hanken Grotesque" — Google's family is
"Hanken Grotesk") in `brand/brand-tokens.css`, `packages/ui` and the POS, Owner, Admin, Tech, kiosk and check-in-admin
apps, so none of them has ever shown it; they show the system sans. Correcting it (and bundling it, as the display now
does) changes how every screen looks and needs each app's screens re-checked — one unit of work when Kevin says so.

~~**Decision for Kevin:** every approved card payment asks the customer to sign on the display~~ — **Kevin decided (Oct 6):
the cardholder signs once, on the Clover terminal** (Part B, Unit 10).

## Part D — found while running every suite for Unit 3 (outside the display work; separate commit)

The module and app suites (`tooling/ci/run-tests.mjs`) were run in full for the first time on this branch, on a machine
set to New York time. Two kinds of failure, neither caused by this work:

- **A security event was being thrown away (fixed — migration 510).** Since Oct 3 (`df399e36`, MFA recovery codes) the
  code records `MFA_RECOVERY_CODES_GENERATED`, but the database CHECK on `security_events.event_type` was never given
  that value. Every "recovery codes generated" event was refused by Postgres and dropped (the recorder never fails the
  request — it logs and returns false), so the Security Center never showed one. The existing catalog-vs-database test
  caught it; nobody had run that suite. Reproduced on real Postgres (CHECK violation), migration 510 recreates the CHECK
  with the full list, the same insert then succeeds; the test passes.
- **The server's date code assumes the process runs in UTC (recorded; test runner pinned).** Seven tests failed only
  because the machine was not on UTC: membership renewal dates (`addInterval` uses local `setMonth`, so a quarter drifts
  by the daylight-saving hour), the renewal-reminder date (formatted in the machine's zone — "July 26" for July 27), the
  billing catch-up (node-postgres/PGlite read DATE columns as local midnight — 5 invoices instead of 6), a POS test's
  sample date, and an analytics test that read local getters for a UTC function (fixed in the test). About 140 places in
  server code use local-time date methods the same way. Production (Railway) and CI run in UTC, so nothing is wrong
  there today; `run-tests.mjs` now runs the suites in UTC like CI. ~~**Recommendation:** set `TZ=UTC` in the API service's
  variables~~ — done in code in Unit 12: the API and the worker put themselves on UTC at start.
