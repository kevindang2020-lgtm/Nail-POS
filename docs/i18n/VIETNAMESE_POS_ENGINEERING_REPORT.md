# VIETNAMESE_POS_ENGINEERING_REPORT.md — English + Vietnamese POS: final engineering report (mandate §126) and developer handoff (§127)

Mandate: `docs/mandates/2026-10-26_VIETNAMESE_POS_MANDATE.txt`. Section-by-section status: `docs/mandates/status/VIETNAMESE_POS_STATUS.md`.
Plan: `docs/mandates/status/VIETNAMESE_POS_BUILD_PLAN.md`. Review list for Kevin: `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`. Glossary:
`docs/i18n/VI_GLOSSARY.md`. Written Oct 27 2026 on branch `merge-github-main` (WP-J); product code under test `dd92f860`. Every PASS below names the test, gate or
pilot check behind it. When a result is not a full pass, it says so and says what is missing.

**In one paragraph.** The tenant POS runs in English and Vietnamese. The language comes from the user's own choice, then the salon's
default, then English. Switching is instant: no reload, no remount, and nothing in the operator's work is lost. Super Admin stays
English. Business data stays canonical: codes are stored, and words are chosen at render time. Vietnamese text keeps its exact bytes
from the API to PostgreSQL and back. Search ignores accents ("nguyen" finds "Nguyễn"), and the search boxes are safe for Telex and
VNI typing. The 9 primary modules fit one screen in both languages and in every state tested (empty, light and busy with
200 technicians), using the real Hanken Grotesk font. Three things are not finished:

- Kevin has not yet reviewed the 3,465 new or changed Vietnamese strings.
- At 1366 and 1280 px a few report-level layout issues remain, in both languages.
- AI prose written by the language model: since the open-items pass (§M, V-4) it is written in the reader's POS language; a label appears only when it differs from the screen (decision C.6 superseded).

---

## A. Existing localization code found (paths)

| Concern | Path |
|---|---|
| i18n runtime (one, shared by 5 apps) | `packages/mobile-sdk/src/i18n/i18n.ts` — `t(key, vars)`, VI → EN → key fallback, `{name}` interpolation, `setLanguage`, `useT` / `useLanguage`, DEV missing-key warning |
| Locale context / formatters | `packages/mobile-sdk/src/i18n/locale.ts` (branch time zone), `apps/pos-web/src/i18n/format.ts` (`displayLocale`, `fmtDate/fmtTime/fmtMoney` — language changes words only) |
| Language list / contract | `packages/api-contracts/src/language.ts` (`APP_LANGUAGES = ['en','vi']`, `LANGUAGE_LOCALE`, `UserLocaleContext`, `customerMessageLanguage`) |
| POS catalogues | `apps/pos-web/src/i18n/catalog.{en,vi}.ts` (generated, frozen, 8,909 keys) + namespaces `apps/pos-web/src/i18n/ns/{nav,ops,people,growth,admin,glossary,status,errors,payment,search,comms,srv,audit}.{en,vi}.ts` registered in `ns/index.ts` → `i18n/index.ts` |
| Locale provider / resolver | `apps/pos-web/src/i18n/use-pos-language.ts` (mounted in `App.tsx`), `apps/pos-web/src/i18n/pos-language.ts` (`resolvePosLanguage`: user ?? salon default ?? en) |
| User preference | `users.preferred_language` (`apps/api/db/migrations/560_user_preferred_language.sql`); `GET /pos/me/locale`, `PUT /pos/me/language` (`apps/api/src/account/language.controller.ts`) |
| Tenant settings (salon default) | `tenant_settings` `business-branch`.`defaultLanguage` — ONE authority since `695_tenant_pos_language_authority.sql` (trigger keeps `tenants.locale` and branch rows in step); Settings → Business "POS language" (`screens/POSSettingsScreen.tsx`); Super Admin `GET/PUT /super-admin/tenants/:id/pos-language` |
| Error mapping | `apps/pos-web/src/i18n/error-text.ts` (`errorText`, `apiErrorMessage`) over `ns/errors` (203 `ERROR_REGISTRY` codes, `packages/api-contracts/src/errors.ts`) |
| Status / code mapping | `apps/pos-web/src/i18n/status-label.ts` (`statusLabel(domain, code)` over `ns/status`), `components/codeLabel.ts` (`codeLabel`, `auditActionLabel`, `auditModuleLabel`), `screens/opsStatus.ts` (`opsStatusLabel`, `floorLabel`) |
| Server text as codes | `packages/api-contracts/src/text/coded-text.ts` (`CodedText {code, vars}`) → `apps/pos-web/src/i18n/coded-text.ts` (`codedText(ct, fallback)` over `ns/srv`) |
| Validation mapping | client messages are keys; server validation prose arrives as `errors.<CODE>` when coded, else as sent (see §58) |
| Language selector | `apps/pos-web/src/shell/LanguageSwitch.tsx` (top bar; English / Tiếng Việt) |
| Search fold / IME | `packages/api-contracts/src/text/vi-fold.ts` (`foldVi`, `viIncludes`), SQL `vi_fold()` (`694_vi_search_fold.sql`), `apps/pos-web/src/components/ImeSafeInput.tsx` |
| Customer Display localization | `apps/customer-display/src/i18n/messages.ts` (own `useT`; guest-chosen language; `620_customer_display_languages.sql`) |
| Communication templates | `modules/communications/src/reminders/reminder-core.ts` (`appointment_reminder.en/.vi`), `modules/checkout/src/checkout/checkout-receipt-text.ts` (`receipt_*.en/.vi`) — chosen by the CUSTOMER's language |
| Platform announcements | `696_platform_notice_vietnamese.sql`; `announcementText` (`packages/api-contracts/src/tenant/platform-announcements.ts`); `apps/pos-web/src/shell/PlatformAnnouncementBar.tsx` |
| Gates | `tooling/ci/check-i18n.mjs`, `check-pos-i18n.mjs` (+ `tooling/i18n/pos-strings.mjs`, `pos-i18n-baseline.json`), `check-vi-glossary.mjs`, `check-admin-english-only.mjs` — all in `tooling/ci/run-gates.mjs` |

## B. Hard-coded string audit

| Metric | Report |
|---|---|
| Total files / components scanned | **430** POS source files (`tooling/i18n/pos-strings.mjs` `allFiles()`: `apps/pos-web/src`, tests excluded) on every gate run; the Oct 26 audit also AST-scanned 424 files |
| Hard-coded user-facing strings found | Oct 26 audit: **788** candidate English literals in 148 files (AST heuristic) + **385** import-time `t()` calls; first tier-4 scanner run: **917** findings (label maps, tuples, helper arguments, `setX('text')`, `.replace(/_/g,' ')` enum renderers, raw status codes, import-time `t()`). Server-written English: 9 areas (turn basis / history / methodology, serving revisions, AI-scheduling explanations / conflicts / reasons, AI-queue alert reasons, Money Protection evidence, audit action names, sync indicator) |
| Migrated | tiers 1–3 (JSX text, read attributes, code contexts) **0** left; tier 4 **917 → 11**; 3,233 new keys + 232 changed values; server text → `{code, vars}` for 8 of the 9 areas (326 `srv.*` keys) + 190 audit actions / 40 modules labelled |
| Remaining in required POS scope | **0 untranslated screen text known**, apart from these documented exceptions: (1) the 11 tier-4 findings, which are not translatable text — the language name "Español", processor brand names (Fiserv, Clover, Bolt), the salon's own loyalty tier names, an advert's numeric priority, a stored receipt-channel value `'Email'`, a permission-key and an uploaded file-name humaniser, a feature-key humaniser fallback and a fixture-only insight action; (2) **AI prose written by the language model** is shown in English with the label "Giải thích do AI viết (tiếng Anh):" (decision C.6); (3) **server validation prose** without an error code is shown as sent (§58); (4) an **audit action with no label** in `ns/audit` is shown as the humanised code (the vocabulary is open-ended; every action a full pilot day writes is labelled) |

## C. Final locale architecture

1. **Resolution.** On sign-in the POS asks `GET /pos/me/locale`, which returns `{language, timeZone}`. The language is the user's
   `preferred_language`, else the salon default, else `'en'`. English is the final fallback for every key: VI → EN → the key
   itself, which never shows in practice (0 missing keys, gated). Before sign-in the POS is in English. Offline, the POS uses this
   user's last answer from the server; it never uses the browser language.
2. **Persistence.** The server is the authority: `users.preferred_language` (CHECK en/vi) and the salon-wide `business-branch`
   `defaultLanguage`. `localStorage` (`aps.pos.language.v1:<userId>`) is only a cache of the last server answer. A save the server
   refuses rolls the switch back. A save that never reached the server (offline) keeps the choice and is re-sent when the device
   is back online.
3. **Frontend provider.** There is one runtime (`packages/mobile-sdk/src/i18n/i18n.ts`). The shell and the routes subscribe
   through `useLanguage()`. A switch changes the module language, and React re-renders the mounted screen in place: there is no
   `key={language}` and no reload. Label tables are getters, and messages kept in state are stored as keys or sentinels and
   worded at render time. `document.documentElement.lang` follows the language.
4. **Resource loading.** Both catalogues are bundled. A switch fetches nothing (asserted in
   `i18n/switch-preserves-state.test.tsx`, and in pilot 13f where 20 switches sent only the 20 `PUT /pos/me/language` calls).
5. **Backend error-code mapping.** Every `ERROR_REGISTRY` code has an `errors.<CODE>` text in both languages.
   `api/client.ts` throws the cashier's-language text by code. An unknown code shows the server's message.
6. **Server-written text** travels as `{code, vars}` beside the English (additive), for example:
   - `basisText` on the turn board;
   - `textCoded` in turn history;
   - `summaryCoded` on serving revisions;
   - `reasonCodes`, `messageCoded` and `reasonCoded` in AI scheduling;
   - `reasonCoded` on AI-queue alerts;
   - `evidenceCoded`, `summaryCoded` and `disclaimerCoded` in Money Protection;
   - `syncIndicatorCoded`;
   - `roleCode` / `nameCode` on the Checkout payout preview and `code` on the Tech Queue source-mix slices (words in `ns/ops`).

   A var that starts with `@` names another catalogue phrase; `@key#p0` takes the `p0_*` vars. Old stored rows are re-coded when
   they are read. Lossless tests check that rendering the codes with the EN catalogue gives back exactly the server's English.

   **LLM prose (decided per case).** The AI gateway declares `languageBehavior: 'tenant_locale'`
   (`modules/ai/src/ai/ai-prompt-registry.ts`) but never passes a language. The two places where model prose reaches the POS are
   the AI scheduling explanation and the Money Protection explanation. In Vietnamese, both show the deterministic explanation first,
   worded from codes, followed by the model's text under "Giải thích do AI viết (tiếng Anh):" with `lang="en"`
   (`data-testid` `sched-explanation-ai-english` / `mp-explain-ai-english`). The model text is never machine-translated at runtime
   (§121). Next step if wanted: pass the user language into the prompt for `tenant_locale` prompts.
7. **Formatting rules** (`i18n/format.ts` header):
   - Language changes words only: month and weekday names come from `displayLocale()`.
   - Clock times use the branch time zone.
   - Money stays in the salon currency's own notation in both languages (`$1,234.56`).
   - Numbers do not depend on the locale.
   - Language never changes permissions, tenant, branch, currency, tax, payment state, queue order or appointment data.

## D. Super Admin boundary

**SUPER ADMIN LANGUAGE = ENGLISH ONLY.** Confirmed by:

- the static gate `tooling/ci/check-admin-english-only.mjs`, run in `ci:gates`: admin-web imports no i18n runtime, has no language
  switch, sets `lang="en"`, and contains no Vietnamese letters outside the reviewed announcement-authoring fields;
- pilot check **13i** in Chromium, with the salon's POS default set to Vietnamese: Dashboard, Tenants and Platform Announcements
  render `<html lang="en">` with no Vietnamese words except the language name, the reviewed announcement text and the salon's own
  guest and technician names.

Super Admin can set a salon's Default POS Language from an English UI (`GET/PUT /super-admin/tenants/:id/pos-language`, step-up,
audited) and can author bilingual announcements.

## E. Translation coverage

The mandate's namespace names (common, navigation, checkIn …) map onto this codebase as follows:

- the frozen generated catalogue holds the module text written before the mandate;
- semantic namespaces hold everything added since.

`check-i18n` fails the build on any missing VI key, empty VI value or placeholder mismatch, so **Missing = 0** for every row.
"Unused" is the `check-pos-i18n` report: keys no POS file references literally or through a known run-time prefix.

| Namespace (file) | Holds | EN keys | VI keys | Missing | Unused |
|---|---|---:|---:|---:|---:|
| `catalog` (generated, frozen) | all screens' pre-mandate text (common, navigation, checkIn, booking, techQueue, customerQueue, serving, serviceDone, checkout …) | 8,909 | 8,909 | 0 | 61 (reached through computed keys or retired; the catalogue may only shrink) |
| `nav` | navigation additions (language button) | 3 | 3 | 0 | 0 |
| `glossary` | the approved glossary (common terms, navigation, actions, booking, queue, checkout) | 95 | 95 | 0 | 67 (reference terms kept equal to `VI_GLOSSARY.md` by `check-vi-glossary`) |
| `ops` | front desk: checkIn, booking, techQueue, customerQueue, serving, serviceDone, overview, live ops, AI scheduling | 397 | 397 | 0 | 0 |
| `payment` | checkout / payment safety (UNKNOWN wording) | 68 | 68 | 0 | 3 (`payment.txType.*` reserved) |
| `status` | canonical status labels (41+ domains) | 522 | 522 | 0 | 0 |
| `errors` | `ERROR_REGISTRY` messages | 203 | 203 | 0 | 0 |
| `people` | customers, memberships, team, payroll, services, products, expenses | 284 | 284 | 0 | 0 |
| `growth` | AI, communications, deals, community | 599 | 599 | 0 | 0 |
| `admin` | settings, account, security, devices, logs, reports, help | 496 | 496 | 0 | 0 |
| `search` | top-bar search | 1 | 1 | 0 | 0 |
| `srv` | server text codes (turn, serving, sched, aiqueue, money, sync) | 326 | 326 | 0 | 0 |
| `audit` | audit-log action / module names | 230 | 230 | 0 | 0 |
| **Total (POS)** | | 12,133 | 12,133 | **0** | 131 |

Across all 11 EN/VI dictionaries in the repo (POS + owner / tech / customer / manager-pay apps, mobile common, customer display),
`check-i18n` reports 12,754 keys with Vietnamese complete and matching placeholders.

## F. Vietnamese glossary

Source: `docs/i18n/VI_GLOSSARY.md` = `ns/glossary.*`, kept equal by `check-vi-glossary`.

- **Approved by Kevin:** the existing catalogue (Oct 26) and the ruling technician = **Thợ**.
- **Proposed, awaiting Kevin's sign-off:** the alignment of other values (D1-A in the review list).

| English | Vietnamese | | English | Vietnamese |
|---|---|---|---|---|
| Customer | Khách hàng | | Checkout | Thanh toán |
| Guest | Khách | | Payment | Thanh toán |
| Technician | **Thợ** (Kevin's ruling) | | Tip | Tiền tip |
| Booking | Đặt lịch | | Discount | Giảm giá |
| Appointment | Lịch hẹn | | Receipt | Hóa đơn |
| Walk-In | Khách vãng lai | | Refund | Hoàn tiền |
| Queue | Hàng chờ | | Break | Giờ nghỉ |
| Service | Dịch vụ | | Queue Hold | Tạm dừng hàng chờ |
| Serving | Đang phục vụ | | Service Done | Hoàn tất dịch vụ |

## G. One-screen test matrix (27-inch 1920 × 1080 screen, browser chrome + taskbar visible → a 1920 × 945 page; Hanken Grotesk; real Chromium)

Harness: `tooling/e2e/pos-vi-one-screen.mjs`. It runs as a CLI for the empty and light states and as pilot check **13e** for the
busy state (200 technicians, 30 waiting, 25 in service, 13 ready, one UNKNOWN card payment). The verdict uses the real scroll
owner. A module fails if:

- the page or the module scrolls;
- text is clipped;
- controls overlap;
- the Vietnamese targets are smaller than the English ones;
- Hanken Grotesk did not load with its Vietnamese glyphs;
- English is left on a Vietnamese screen.

Screenshots: `docs/pilot-runs/2026-10-27-vietnamese/` (`one-screen-empty/`, `one-screen-light/`, `shots/one-screen/` for busy).

**Update (Oct 27, second pass):** 2560 × 1440 added, visible-box overlaps, cut-off controls and §78 hit areas measured — results in §M (primary 54 / 54, other viewports 264 / 270, fit 270 / 270).

**Primary viewport.** The screen is 1920 × 1080 at 100% zoom with the browser chrome and the Windows taskbar visible. The page
therefore gets **1920 × 945**: 1080 px minus about 87 px for Chrome's tab strip and address bar, minus the 48 px Windows 11
taskbar. The harness certifies at that page size (`PRIMARY` in the harness). A full-screen 1920 × 1080 page is a report row.
Results per state at the primary viewport:

| Test | Empty | Light | Busy (200 tech) | Result |
|---|---|---|---|---|
| OVERVIEW EN | PASS | PASS | PASS | **PASS** |
| OVERVIEW VI | PASS | PASS | PASS | **PASS** |
| LIVE OPS EN | PASS | PASS | PASS | **PASS** |
| LIVE OPS VI | PASS | PASS | PASS | **PASS** |
| CHECK-IN EN | PASS | PASS | PASS | **PASS** |
| CHECK-IN VI | PASS | PASS | PASS | **PASS** |
| BOOKING EN | PASS | PASS | PASS | **PASS** |
| BOOKING VI | PASS | PASS | PASS | **PASS** |
| TECH QUEUE EN | PASS | PASS | PASS | **PASS** |
| TECH QUEUE VI | PASS | PASS | PASS | **PASS** |
| CUSTOMER QUEUE EN | PASS | PASS | PASS | **PASS** |
| CUSTOMER QUEUE VI | PASS | PASS | PASS | **PASS** |
| SERVING EN | PASS | PASS | PASS | **PASS** |
| SERVING VI | PASS | PASS | PASS | **PASS** |
| SERVICE DONE EN | PASS | PASS | PASS | **PASS** |
| SERVICE DONE VI | PASS | PASS | PASS | **PASS** |
| CHECKOUT EN | PASS | PASS | PASS | **PASS** |
| CHECKOUT VI | PASS | PASS | PASS | **PASS** |
| **Total (primary)** | 18 / 18 | 18 / 18 | 18 / 18 | **54 / 54** |

Other viewports, recorded as a report and not part of the certification (no horizontal scroll, no clipping; vertical scroll
allowed):

- 1920 × 1080 (a full-screen browser);
- 1600 × 900;
- 1366 × 768;
- 1280 × 800.

| State | Responsive checks | Not passing (both languages unless marked) |
|---|---|---|
| Empty | 72 / 72 | — |
| Light | 72 / 72 | — |
| Busy (200 tech) | 67 / 72 (full-screen 1920 × 1080: 18 / 18) | Overview at 1366 × 768 and 1280 × 800, EN and VI: "Notify" overlaps "View All"; Checkout **VI** at 1280 × 800: "Mở" / "Xem đầy đủ" overlap "Gửi tới điện thoại" (8 pairs). Seen on the 1366 screenshot as well: the Overview's Live Tech Queue / Service Flow / Today's Appointments cards clip a status pill (EN too) |

The repository keeps only the primary-viewport screenshots; every viewport's verdict (with the measured scroll, clipping, overlap and button height) is in `one-screen-<state>/one-screen-<state>.json` and, for busy, `pilot.json` → `numbers.vietnamese.oneScreen`.

## H. Persistence matrix

| Test | Result | Evidence |
|---|---|---|
| USER SWITCH EN → VI | **PASS** | `i18n/switch-preserves-state.test.tsx`; `shell/LanguageSwitch.test.tsx`; pilot 13f (10 × EN→VI through the top-bar switch) |
| USER SWITCH VI → EN | **PASS** | same (10 × VI→EN) |
| REFRESH PERSISTS LANGUAGE | **PASS** | pilot 13a: a fresh Chromium context (a full page load) opens `<html lang="vi">` with Vietnamese navigation; `i18n/pos-language.test.ts` |
| LOGOUT / LOGIN PERSISTS | **PASS** | pilot 13a: switch to vi → sign out → sign in → vi; back to en → sign out → sign in → en |
| USER OVERRIDE TENANT DEFAULT | **PASS** | pilot 13a: salon default vi, the receptionist's own en wins; `language.pgtest.vitest.spec.ts` |
| SECOND USER INDEPENDENT | **PASS** | pilot 13a: manager (no choice) vi while receptionist en; `language.pgtest` |
| TENANT DEFAULT CHANGE | **PASS** | pilot 13a: the owner sets Tiếng Việt in Settings → Business (one authority row); Super Admin change: `language.pgtest` WP-A block |
| SUPER ADMIN REMAINS ENGLISH | **PASS** | pilot 13i (Chromium) + `check-admin-english-only` |

## I. Unicode matrix

| Test | Result | Evidence |
|---|---|---|
| VIETNAMESE NAME CREATE | **PASS** | `modules/customers/src/customers/vietnamese-unicode.pgtest.vitest.spec.ts` (6 names + every vowel × tone, UTF-8 bytes equal, NFC kept); pilot 13b through the live API (hex of `full_name` equal) |
| VIETNAMESE NAME EDIT | **PASS** | pgtest edit case; pilot 13b renames two of the 200 technicians to "Trần Mỹ Linh" / "Đặng Minh Tuấn" (stored exactly) |
| VIETNAMESE NAME SEARCH | **PASS** | pgtest (accented and accent-free, whole name); `vi-search.pgtest`; pilot 13b ("nguyen" in Customers + global search; "tran" / "dang" in the 200-technician picker; "tran" in the Live Schedule); Checkout search test |
| VIETNAMESE NOTES | **PASS** | pgtest + pilot 13b ("Khách muốn sơn màu đỏ và thêm thiết kế hoa." byte-identical) |
| REALTIME VIETNAMESE TEXT | **PASS** | pilot 13d: a walk-in "Lý Thu Thảo" checked in through the API appears on the open Vietnamese Customer Queue without a reload; pgtest: the event carries the id only and the refetch reads the same bytes |
| RECEIPT PREVIEW | **PASS** | pilot 13h: SMS receipts to "Nguyễn Thị Hương" (vi) in Vietnamese and to an English customer in English, sent by a Vietnamese cashier; Customer Display receipt in the guest's language (`customer-display-layout.mjs`) |

## J. Operational preservation

| Test | Result | Evidence |
|---|---|---|
| BOOKING STATE PRESERVED | **PASS** | pilot 13f: technician page 3 of 17 + a service filter + the date kept across 20 switches; `switch-preserves-state.test.tsx` (date, search, scroll) |
| QUEUE STATE PRESERVED | **PASS** | pilot 13f: the open Manage drawer with "khách đổi ý" half typed and the queue order survive EN⇄VI ×2 with no refetch; unit test same |
| SERVING STATE PRESERVED | **PASS** | `POSServingScreen.vi.test.tsx` "Serving across language switches": the open Manage row, typed reason / minutes kept, same input node, 0 requests |
| CHECKOUT STATE PRESERVED | **PASS** | pilot 13f: the same ticket (`?ticket=`), Complete Checkout blocked, Verify available after 4 switches; `switch-preserves-state.test.tsx` |
| UNKNOWN PAYMENT PRESERVED | **PASS** | pilot 13f: the banner reads the mandate's exact EN / VI words switch after switch, 0 pay / verify requests, the one payment row still `processing`; `POSCheckoutScreen.unknown-language.test.tsx` |
| NO DUPLICATE REALTIME SUBS | **PASS** | pilot 13f: 1 EventSource created → still 1 after 20 switches (1 open); window / document listener counts unchanged; unit test (10 switches) |

Performance (§114, pilot 13f on the live 200-technician Booking board, switch until the second animation frame):

- switch-to-paint p50 149 ms, p95 191 ms;
- JS heap 10.6 → 11.2 MB;
- DOM nodes 2,979 → 2,987 (20 language saves, 0 board reads, 0 pay / verify calls).

The POS bundle is 4.8 MB (1.19 MB gzip) with both languages included. A switch downloads nothing.

## K. Build matrix

| Validation | Result | Evidence |
|---|---|---|
| POS BUILD | **PASS** | `npx vite build` in apps/pos-web (and admin / owner / tech / customer-display) rc 0; `build:packages` + `build:modules` + `build:api` rc 0 |
| TYPECHECK | **PASS** | `npm run typecheck` (API) rc 0; `tsc --noEmit` apps/pos-web rc 0; the touched modules rc 0 |
| LINT | **PASS** | `ci:gates` → `check:lint` PASS (inside **all 54 gates + 19 audits passed**, incl. `i18n`, `pos-i18n`, `vi-glossary`, `admin-english-only`) |
| I18N UNIT TESTS | **PASS** | apps/pos-web **345 files / 1,611 tests passed** (incl. `i18n/*.test.ts`, 20+ `*.vi.test.tsx`, `audit-labels`, `coded-text`, switch-preservation); packages/mobile-sdk i18n tests; 6 lossless `*-coded-text.vitest.spec.ts` |
| INTEGRATION TESTS | **PASS** | `ci:test:api` **375 files / 3,070 passed** (137 env-gated skipped); `vietnamese-unicode.pgtest` 4 / 4, `language.pgtest`, `vi-search.pgtest`; queue / booking / communications / deals / audit module suites (703 / 722 / 480 / 232 / 35 passed); owner-web 358, admin-web 1,055 passed |
| E2E ENGLISH | **PASS** | pilot day phases 0–12 + the API / PostgreSQL log checks in English on the same fresh database (210 checks) — part of **224 / 224** |
| E2E VIETNAMESE | **PASS** | pilot phase 13 (14 checks, Vietnamese POS end to end on the 200-technician salon) — part of **224 / 224** |
| VISUAL REGRESSION EN | **PASS** (layout assertions) | one-screen matrix EN 27 / 27 at the primary viewport (9 modules × empty / light / busy) with screenshots. There is no pixel-diff baseline: the harness asserts scroll / clipping / overlap / target size / font / leftover English, and the committed 1920 screenshots are the baseline for a future pixel diff |
| VISUAL REGRESSION VI | **PASS** (layout assertions) | the same, VI 27 / 27 |
| TENANT ISOLATION | **PASS** | `language.pgtest` (another salon's vi is never read), `vi-search.pgtest` (other tenant never appears), pilot 10f / 13g (an announcement reaches only its salon) |
| USER LANGUAGE PERSISTENCE | **PASS** | pilot 13a (sign-out / sign-in / new device, both directions); `pos-language.test.ts` |
| TENANT DEFAULT LANGUAGE | **PASS** | pilot 13a (owner sets vi; a user without a choice gets vi, one with a choice keeps it); `language.pgtest` |
| SUPER ADMIN ENGLISH ONLY | **PASS** | pilot 13i (Chromium, vi salon default) + `check-admin-english-only` |
| 1920x1080 VIETNAMESE FIT | **PASS** | 27 / 27 Vietnamese module views on the 1920×1080 screen with browser chrome and taskbar (a 1920×945 page) over three states, busy at 200 technicians included; also 27 / 27 full-screen 1920×1080 |
| 200-TECH VIETNAMESE TEST | **PASS** | pilot 13b–13f at 200 technicians: Booking "Trang 1 / 17", assign picker "Trang 1 / 16" (183 working) on the server, accent-free technician search, 20 switches on the live board |

## M. Open items V-2 … V-6 (Oct 27 2026, second pass)

Commits: `5b75796a` (V-2 / V-3), `a56e4026` (top bar), `46e7bcd5` (V-4), `e1e32132` (V-5). Evidence:
`docs/pilot-runs/2026-10-27-vietnamese-open/` (`one-screen-{empty,light,busy}/` — JSON with every measurement, run log, primary
screenshots; `announcement/run.log`).

**V-2 — smaller screens (§79).** Below 1700 px the Overview's free-text cells (`.t-name` / `.t-flex`) give way with an ellipsis
so the status pill, the minutes and the row action stay inside the card; below 1400 px the service, wait and requested-technician
columns hide (View All keeps them). Customer Queue / Serving / Service Done row actions wrap below 1400 px (`.pos-row-acts`).
Below 1440 px the top bar's language switch collapses to its globe (announcement readable room 209 px at 1366, 163 px at 1280 —
`pos-announcement-layout.mjs` 58 / 58). The harness now (a) compares the parts of two controls the user can SEE — the Checkout VI
1280 "overlap" was a queue row scrolled out of its list box under the section below, not a real overlap; (b) reports controls and
status pills cut off sideways by a card (a lane grid built to scroll sideways — `[data-technician-column]` / `data-hscroll` —
excepted); (c) runs 2560 × 1440.

| State | Primary 1920×945 | 2560×1440 · 1920×1080 · 1600×900 · 1366×768 · 1280×800 | Of which fit (scroll / clip / cut-off / overlap) |
|---|---|---|---|
| Empty | 18 / 18 | 90 / 90 | 90 / 90 |
| Light | 18 / 18 | 84 / 90 | 90 / 90 (the 6 are hit-area report items, §78) |
| Busy (200 tech) | 18 / 18 | 90 / 90 | 90 / 90 |
| **Total** | **54 / 54** | **264 / 270** | **270 / 270** |

**V-3 — touch targets (§78).** Kevin kept the one-screen fit, so the controls keep their size; the HIT AREA grows.
`apps/pos-web/src/shell/hitSlop.ts` (installed in `main.tsx`) measures every compact control (< 44 px) after each DOM change /
resize / scroll (coalesced, ~150 ms) and gives it a transparent `::after` (`::before` when the component uses `::after`) with
negative insets: 44 × 44 px centred on the control, the gap to a neighbour closer than that split between the two (the largest
area that does not overlap — they meet, never overlap), clamped to the scroll extent of every scrolling ancestor so it never adds a
scrollbar. Text fields / selects are obstacles. A control whose own overflow would clip the pseudo-element is skipped — the booking
appointment card's clipping moved to an inner box for that reason (same corners, same look). `<html data-hitslop="off">` switches
it off; the harness proves the layout identical with and without (every control box and every scroll size, 324 / 324 runs).

`measureHitAreas` walks out from each edge of every fully visible compact control with `document.elementFromPoint`, 1 px at a
time up to the 44 px box, then probes its corners: **full** (the whole box hits the control), **neighbour** (stopped by another
control or its hit area), **edge** (viewport, a panel's clip, a scroll extent, a pinned list header), **short** (plain content
before 44 px — a failure). Primary viewport, all 9 modules × EN / VI:

| State | Compact controls | Full 44 × 44 | Neighbour-limited | Panel edge | Short |
|---|---:|---:|---:|---:|---:|
| Empty | 250 | 230 | 6 | 14 | 0 |
| Light | 482 | 322 | 126 | 34 | 0 |
| Busy (200 tech) | 646 | 405 | 211 | 30 | 0 |

Controls closer than 44 px to a neighbour (enlarged to the maximum non-overlapping area; smallest box → smallest hit area seen):
Overview Notify / Thông báo 50×25 → 50×34 (rows 34 px apart), Assign / Phân công 46×21 → 46×27 (flow rows 27 px apart), View All
505×30 → 505×43; Check-In View / Xem 42×23 → 44×32, Check In 60×23 → 60×32; Booking lane header "View day" 45×17 → 45×27,
"⋮" 19×15 → 36×26, technician header 149×35 → 149×42; Tech Queue Details / Message icon buttons 22×22 → 34×31 / 29×31 (VI
26×36), Auto Balance Queue 100×20 → 100×37, View Suggestions / Send Alert 160×29 → 160×39; Customer Queue Assign 52×27 → 52×35;
Service Done Send / Manage 45×27 → 45×39; Checkout Open / Full View 47×27 → 47×38, Open Queue 83×27 → 83×35; Serving Review Now
71×23 → 71×43. Raising these further needs bigger gaps, i.e. a layout change Kevin ruled out.

**V-4 — language-model prose (§120).** `modules/ai/src/ai/ai-response-language.ts`: `AiPlatform.execute` takes
`responseLanguage`; left out, the reader's language (users.preferred_language → the salon's POS default → English; a job: the salon
default). A `tenant_locale` prompt gets one static line in its SYSTEM block (`RESPONSE_LANGUAGE_DIRECTIVE.vi`); English adds
nothing, so an English request renders byte for byte what it rendered before. `english` / `match_input` prompts and marketing (it
has its own `language` variable) never get it. The idempotency key is `tenant:task:LANGUAGE:key`; the result has `language`.
`queue.explain_recommendation` v2 (tenant_locale; v1 DEPRECATED, kept). `AiAssistantService.run` takes `responseLanguage`
'en' | 'vi' | 'user' — the copilot chat and AI business answers ask for the reader's; a copilot DRAFT follows the customer's own
language (WP-I) — it is written to the customer, not to the receptionist. Screens: Money Protection, the AI queue explanation and
the scheduling explanation (stored with `explanation_language`, migration 702) show the prose as is when its language matches
the screen, labelled with its language otherwise ("Giải thích do AI viết (tiếng Anh):" / "AI explanation (Vietnamese):").
Money Protection's accusation filter has a Vietnamese list. The decision of §C.6 is superseded.

**V-5 — validation answers (§2 / §21 / §58).** `FieldError` gains `rule` + `params` (REQUIRED, REQUIRED_ONE_OF, TYPE, ENUM,
NOT_EMPTY, MIN_LENGTH, MAX_LENGTH, FORMAT, NUMBER, MIN, MIN_EXCLUSIVE, MAX, MIN_ITEMS, MAX_ITEMS, NOT_ALLOWED, UNKNOWN_FIELD,
SHAPE); the ValidatedBody 400 puts `field` / `rule` / `params` of the first error in `details` (additive). Customers: field + rule on
every form refusal, registry codes `CUSTOMER_POSSIBLE_DUPLICATE` / `CUSTOMER_CONTACT_IN_USE`; `PUT pos/me/language` names its
field. POS `i18n/error-text.ts` `fieldErrorText`: `errors.rule.<RULE>` with the label `errors.field.<leaf>` in both languages;
no label → today's wording (server English in English, the code's text in Vietnamese).

**V-6 — customer language picker (§55).** Already built in WP-C2 (`183f1cb2`): the edit form has an English / Tiếng Việt `select`.

Tests run for this pass (TZ=UTC, loaded 2-core host): pos-web `hitSlop.test.ts` 9, `error-text.test.ts` 16 (2 fail on
`HANDOFF_TOKEN_INVALID`, a payroll registry code with no POS text — not this work), MP / scheduling / AI-queue / booking screens 130;
`tooling/e2e/pos-vi-one-screen.test.mjs` 3 (real Chromium); modules/ai 301 + `ai-response-language` 12; packages/permissions
request-schema 16; customers `customer-validation-codes` 4 + preferences 6.

## L. Files changed

The list below is every file touched by the mandate's commits from the audit (`ab1c628b`) to this report. The 200-technician and
M7 work committed in the same period is excluded, except where a commit carried both.

Database migrations for this mandate:

- `694_vi_search_fold.sql`;
- `695_tenant_pos_language_authority.sql`;
- `696_platform_notice_vietnamese.sql`;
- `697_customer_language_normalize.sql`.

Parts 1–3 of the final mandate pass added no migration.

591 files in 75 commits (A = added, M = modified, D = deleted).

<details><summary><b>1. Frontend</b> — 295</summary>

- `M` `apps/admin-web/index.html`
- `M` `apps/admin-web/src/api/superAdminApi.ts`
- `M` `apps/admin-web/src/screens/PlatformAnnouncementsScreen.tsx`
- `M` `apps/admin-web/src/screens/TenantsScreen.tsx`
- `M` `apps/admin-web/src/styles.css`
- `M` `apps/customer-display/src/main.tsx`
- `M` `apps/customer-web/index.html`
- `M` `apps/customer-web/src/styles.css`
- `M` `apps/go-check-in-kiosk/index.html`
- `M` `apps/go-check-in-kiosk/www/index.html`
- `M` `apps/manager-pay-web/index.html`
- `M` `apps/manager-pay-web/src/styles.css`
- `M` `apps/owner-web/index.html`
- `M` `apps/owner-web/src/api/ownerApi.ts`
- `M` `apps/owner-web/src/screens/LiveOperationsScreen.tsx`
- `M` `apps/owner-web/src/styles.css`
- `M` `apps/pos-web/index.html`
- `M` `apps/pos-web/src/App.tsx`
- `M` `apps/pos-web/src/api/client.ts`
- `M` `apps/pos-web/src/api/offline-read-cache.ts`
- `M` `apps/pos-web/src/api/posAIQueueAssignmentApi.ts`
- `M` `apps/pos-web/src/api/posApprovalsApi.ts`
- `M` `apps/pos-web/src/api/posBookingApi.ts`
- `M` `apps/pos-web/src/api/posTimeClockApi.ts`
- `M` `apps/pos-web/src/components/AiAssistantPanel.tsx`
- `M` `apps/pos-web/src/components/AppointmentDetailInner.tsx`
- `M` `apps/pos-web/src/components/AssignTechSheet.tsx`
- `M` `apps/pos-web/src/components/AuthSecurityPanels.tsx`
- `M` `apps/pos-web/src/components/BookingSharedComponents.tsx`
- `M` `apps/pos-web/src/components/CheckoutDealsPanel.tsx`
- `M` `apps/pos-web/src/components/CheckoutTicketInner.tsx`
- `M` `apps/pos-web/src/components/CustomerDetailInner.tsx`
- `M` `apps/pos-web/src/components/FollowUpQueuePanel.tsx`
- `M` `apps/pos-web/src/components/FollowUpTaskTable.tsx`
- `A` `apps/pos-web/src/components/ImeSafeInput.tsx`
- `M` `apps/pos-web/src/components/MoveAppointmentModal.tsx`
- `M` `apps/pos-web/src/components/PartyPlanPanel.tsx`
- `M` `apps/pos-web/src/components/PaymentGatewayStatusCard.tsx`
- `M` `apps/pos-web/src/components/PendingTimeOffPanel.tsx`
- `M` `apps/pos-web/src/components/ProfileChangeRequestsPanel.tsx`
- `M` `apps/pos-web/src/components/QueueItemInner.tsx`
- `M` `apps/pos-web/src/components/QuickCheckInPanel.tsx`
- `M` `apps/pos-web/src/components/SkipLineDrawer.tsx`
- `M` `apps/pos-web/src/components/TapToPayDevicesPanel.tsx`
- `M` `apps/pos-web/src/components/TechnicianAccessPanel.tsx`
- `M` `apps/pos-web/src/components/TechnicianImportPanel.tsx`
- `M` `apps/pos-web/src/components/TechnicianPicker.tsx`
- `M` `apps/pos-web/src/components/TechnicianSchedulePreview.tsx`
- `M` `apps/pos-web/src/components/TechnicianWorkforcePanel.tsx`
- `M` `apps/pos-web/src/components/TicketRefundPanel.tsx`
- `M` `apps/pos-web/src/components/VisitPlanPanel.tsx`
- `A` `apps/pos-web/src/components/codeLabel.ts`
- `A` `apps/pos-web/src/components/customerLanguage.ts`
- `M` `apps/pos-web/src/components/ipad-modules.tsx`
- `A` `apps/pos-web/src/components/peopleLabels.ts`
- `A` `apps/pos-web/src/components/uiText.ts`
- `M` `apps/pos-web/src/lib/queueConflict.ts`
- `M` `apps/pos-web/src/main.tsx`
- `M` `apps/pos-web/src/realtime/RealtimeStatusPill.tsx`
- `M` `apps/pos-web/src/screens/AICheckoutUpsellPanel.tsx`
- `M` `apps/pos-web/src/screens/AICheckoutUpsellSettingsScreen.tsx`
- `M` `apps/pos-web/src/screens/AICustomerProfilePanel.tsx`
- `M` `apps/pos-web/src/screens/AcceptInviteScreen.tsx`
- `M` `apps/pos-web/src/screens/AccessRequestPanel.tsx`
- `M` `apps/pos-web/src/screens/CustomerDisplayCard.tsx`
- `M` `apps/pos-web/src/screens/EndOfDayFollowUpSettings.tsx`
- `M` `apps/pos-web/src/screens/LoginScreen.tsx`
- `M` `apps/pos-web/src/screens/MembershipBadge.tsx`
- `M` `apps/pos-web/src/screens/MembershipChip.tsx`
- `M` `apps/pos-web/src/screens/MembershipCoveragePanel.tsx`
- `M` `apps/pos-web/src/screens/MembershipEnrollModal.tsx`
- `M` `apps/pos-web/src/screens/MembershipManageModal.tsx`
- `M` `apps/pos-web/src/screens/MembershipPlanBuilder.tsx`
- `M` `apps/pos-web/src/screens/MembershipRedeemPanel.tsx`
- `M` `apps/pos-web/src/screens/OAuthConsentScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIAudienceBuilderScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIBusinessSetupScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICalendarScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICampaignBuilderScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICampaignResultsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICenterScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICustomerDuplicateReviewScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICustomerProfileOverviewScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICustomerRebookingScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICustomerRecommendationsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICustomerSettingsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAICustomerTimelineScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIFollowUpsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIFrontDeskScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIMarketingScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIMessageStudioScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIMoneyProtectionAlertsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIMoneyProtectionInvestigationsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIMoneyProtectionRulesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIMoneyProtectionScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIMoneyProtectionSettingsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIOcrReceiptScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIQueueAssignmentScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIReceptionistScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIReviewReputationScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAISchedulingOptimizerScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIVoiceTranscriptionDetailScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIVoiceTranscriptionHistoryScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIVoiceTranscriptionScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIVoiceTranscriptionSearchScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIVoiceTranscriptionSettingsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAIVoiceTranscriptionUnresolvedScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAccountInvoicesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAccountScreen.tsx`
- `M` `apps/pos-web/src/screens/POSActivityLogsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiAlertsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiAnalyticsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiBranchCompareScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiBusinessScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiForecastingScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiGovernanceScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiInventoryScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiPackageScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiReportsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAiUsageScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAppointmentHistoryScreen.tsx`
- `M` `apps/pos-web/src/screens/POSAppointmentsReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSBirthdaysScreen.tsx`
- `M` `apps/pos-web/src/screens/POSBookingScreen.tsx`
- `M` `apps/pos-web/src/screens/POSBookingVerificationScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCampaignCenterScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCashDrawerScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCashHandoffScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCheckInScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCheckoutScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCommissionReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCommunicationsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCustomerDisplaysScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCustomerNotesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCustomerPhoneEditor.tsx`
- `M` `apps/pos-web/src/screens/POSCustomerPhoneSettingsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCustomerProfileScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCustomersReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSCustomersScreen.tsx`
- `M` `apps/pos-web/src/screens/POSDashboardScreen.tsx`
- `M` `apps/pos-web/src/screens/POSDealsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSDepositReconPanels.tsx`
- `M` `apps/pos-web/src/screens/POSDepositReconScreen.tsx`
- `M` `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx`
- `M` `apps/pos-web/src/screens/POSDevicesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSDiscountsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSDisplayAdsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSEmailScreen.tsx`
- `M` `apps/pos-web/src/screens/POSExpensesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSFeaturesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSGiftCardLookupScreen.tsx`
- `M` `apps/pos-web/src/screens/POSGiftCardStockScreen.tsx`
- `M` `apps/pos-web/src/screens/POSGiftCardsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSHelpCenterScreen.tsx`
- `M` `apps/pos-web/src/screens/POSIntegrationsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSInventoryAlertsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSInventoryReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSInvoicesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSLiveTechnicianScheduleScreen.tsx`
- `M` `apps/pos-web/src/screens/POSLoyaltyScreen.tsx`
- `M` `apps/pos-web/src/screens/POSManagementScreen.tsx`
- `M` `apps/pos-web/src/screens/POSMarketingReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSMembershipsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSMessageTemplatesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSMessagesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSMultiLocationScreen.tsx`
- `M` `apps/pos-web/src/screens/POSNailShowcaseModerationScreen.tsx`
- `M` `apps/pos-web/src/screens/POSNewBookingScreen.tsx`
- `M` `apps/pos-web/src/screens/POSNotificationsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSOverviewScreen.tsx`
- `M` `apps/pos-web/src/screens/POSPaycheckTab.tsx`
- `M` `apps/pos-web/src/screens/POSPaymentGatewayScreen.tsx`
- `M` `apps/pos-web/src/screens/POSPaymentTerminalsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSPaymentsOverviewScreen.tsx`
- `M` `apps/pos-web/src/screens/POSPaymentsReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSPayrollScreen.tsx`
- `M` `apps/pos-web/src/screens/POSPhoneScreen.tsx`
- `M` `apps/pos-web/src/screens/POSProductsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSPromotionsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSPurchaseOrdersScreen.tsx`
- `M` `apps/pos-web/src/screens/POSQueueScreen.tsx`
- `M` `apps/pos-web/src/screens/POSReceptionCopilotScreen.tsx`
- `M` `apps/pos-web/src/screens/POSReferralsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSRefundsVoidsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSRemindersScreen.tsx`
- `M` `apps/pos-web/src/screens/POSReportsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSRetentionScreen.tsx`
- `M` `apps/pos-web/src/screens/POSReviewsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSalesReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSavedCardsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSecurityScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSegmentsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSServiceAddOnsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSServiceCategoriesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSServiceDoneScreen.tsx`
- `M` `apps/pos-web/src/screens/POSServicePricingScreen.tsx`
- `M` `apps/pos-web/src/screens/POSServicesReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSServicesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSServingScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSettingsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSkillRequestsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSocialScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSplitPaymentsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSSubscriptionScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTaxReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTeamPermissionsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTeamProfilesScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTeamScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTechAppointmentsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTechQueueScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTechnicianProfileScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTechniciansReportScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTechniciansScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTimeClockScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTransactionsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSTurnQueueScreen.tsx`
- `M` `apps/pos-web/src/screens/POSUsageLimitsScreen.tsx`
- `M` `apps/pos-web/src/screens/POSWalkInScreen.tsx`
- `M` `apps/pos-web/src/screens/SecurityNotMeScreen.tsx`
- `M` `apps/pos-web/src/screens/SourceBadge.tsx`
- `M` `apps/pos-web/src/screens/TenantApiWebhooksScreen.tsx`
- `M` `apps/pos-web/src/screens/TenantInventoryScreen.tsx`
- `M` `apps/pos-web/src/screens/TenantLocationsScreen.tsx`
- `M` `apps/pos-web/src/screens/TenantLogsScreen.tsx`
- `M` `apps/pos-web/src/screens/TenantSuppliersScreen.tsx`
- `M` `apps/pos-web/src/screens/access/POSAccessGovernanceScreen.tsx`
- `M` `apps/pos-web/src/screens/access/POSMemberAccessScreen.tsx`
- `M` `apps/pos-web/src/screens/access/accessUi.tsx`
- `M` `apps/pos-web/src/screens/ai-queue/AIQueueAlertsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-queue/AIQueueAnalyticsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-queue/AIQueueAutoCard.tsx`
- `M` `apps/pos-web/src/screens/ai-queue/AIQueueCustomerPanel.tsx`
- `M` `apps/pos-web/src/screens/ai-queue/AIQueueRotationCard.tsx`
- `M` `apps/pos-web/src/screens/ai-queue/AIQueueSettingsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-queue/aiQueueUi.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedFindTimeCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedInputsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedInsightsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedOverviewCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedProposalsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedRecommendationDetail.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedRecommendationsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedRunsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedSettingsCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/SchedUsageCard.tsx`
- `M` `apps/pos-web/src/screens/ai-scheduling/schedUi.tsx`
- `M` `apps/pos-web/src/screens/aiCustomerProfileCommon.tsx`
- `M` `apps/pos-web/src/screens/approvals/POSApprovalsScreen.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityAdvisoryEditor.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityApprovalsScreen.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityComments.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityDraftsScreen.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityEvidence.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityFeedScreen.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityIncidentsScreen.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityPostScreen.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityRules.tsx`
- `M` `apps/pos-web/src/screens/community/CommunitySettingsScreen.tsx`
- `M` `apps/pos-web/src/screens/community/communityUi.tsx`
- `M` `apps/pos-web/src/screens/deals/DealCouponsPanel.tsx`
- `M` `apps/pos-web/src/screens/deals/DealWizard.tsx`
- `M` `apps/pos-web/src/screens/deals/DealsDashboard.tsx`
- `M` `apps/pos-web/src/screens/deals/DealsSettingsPanel.tsx`
- `M` `apps/pos-web/src/screens/display-ads/AdEditor.tsx`
- `M` `apps/pos-web/src/screens/display-ads/adImagePipeline.ts`
- `M` `apps/pos-web/src/screens/display-settings/DisplaySettingsCard.tsx`
- `A` `apps/pos-web/src/screens/growthLabels.ts`
- `M` `apps/pos-web/src/screens/locations/SalonLocationMapEditor.tsx`
- `A` `apps/pos-web/src/screens/opsClock.ts`
- `A` `apps/pos-web/src/screens/opsStatus.ts`
- `M` `apps/pos-web/src/screens/reportsCommon.tsx`
- `M` `apps/pos-web/src/screens/techQueueDnd.ts`
- `M` `apps/pos-web/src/shell/LanguageSwitch.tsx`
- `M` `apps/pos-web/src/shell/POSLayout.tsx`
- `M` `apps/pos-web/src/shell/POSSecuritySettingsModal.tsx`
- `M` `apps/pos-web/src/shell/PlatformAnnouncementBar.tsx`
- `M` `apps/pos-web/src/shell/ProfileMenu.tsx`
- `M` `apps/pos-web/src/shell/TopSearch.tsx`
- `M` `apps/pos-web/src/shell/tenant-access.ts`
- `M` `apps/pos-web/src/shell/tenant-nav.tsx`
- `M` `apps/pos-web/src/styles.css`
- `M` `apps/pos-web/src/test/setup.ts`
- `M` `apps/pos-web/story/check-in.html`
- `M` `apps/pos-web/story/checkout.html`
- `M` `apps/pos-web/story/customer-queue.html`
- `M` `apps/pos-web/story/customers.html`
- `M` `apps/pos-web/story/dashboard.html`
- `M` `apps/pos-web/story/index.html`
- `M` `apps/pos-web/story/overview.html`
- `M` `apps/pos-web/story/service-done.html`
- `M` `apps/pos-web/story/serving.html`
- `M` `apps/pos-web/story/team.html`
- `M` `apps/pos-web/story/tech-queue.html`
- `M` `apps/tech-web/index.html`
- `M` `apps/tech-web/src/styles.css`

</details>

<details><summary><b>2. Translation files</b> — 43</summary>

- `M` `apps/pos-web/src/i18n/catalog.vi.ts`
- `A` `apps/pos-web/src/i18n/coded-text.ts`
- `A` `apps/pos-web/src/i18n/error-text.ts`
- `A` `apps/pos-web/src/i18n/format.ts`
- `M` `apps/pos-web/src/i18n/index.ts`
- `A` `apps/pos-web/src/i18n/notice.ts`
- `A` `apps/pos-web/src/i18n/ns/admin.en.ts`
- `A` `apps/pos-web/src/i18n/ns/admin.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/audit.en.ts`
- `A` `apps/pos-web/src/i18n/ns/audit.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/comms.en.ts`
- `A` `apps/pos-web/src/i18n/ns/comms.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/errors.en.ts`
- `A` `apps/pos-web/src/i18n/ns/errors.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/glossary.en.ts`
- `A` `apps/pos-web/src/i18n/ns/glossary.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/growth.en.ts`
- `A` `apps/pos-web/src/i18n/ns/growth.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/index.ts`
- `A` `apps/pos-web/src/i18n/ns/nav.en.ts`
- `A` `apps/pos-web/src/i18n/ns/nav.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/ops.en.ts`
- `A` `apps/pos-web/src/i18n/ns/ops.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/payment.en.ts`
- `A` `apps/pos-web/src/i18n/ns/payment.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/people.en.ts`
- `A` `apps/pos-web/src/i18n/ns/people.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/search.en.ts`
- `A` `apps/pos-web/src/i18n/ns/search.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/srv.en.ts`
- `A` `apps/pos-web/src/i18n/ns/srv.vi.ts`
- `A` `apps/pos-web/src/i18n/ns/status.en.ts`
- `A` `apps/pos-web/src/i18n/ns/status.vi.ts`
- `A` `apps/pos-web/src/i18n/pos-language.ts`
- `D` `apps/pos-web/src/i18n/reload.ts`
- `A` `apps/pos-web/src/i18n/status-label.ts`
- `M` `apps/pos-web/src/i18n/use-pos-language.ts`
- `A` `docs/i18n/VI_GLOSSARY.md`
- `A` `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`
- `A` `modules/checkout/src/checkout/checkout-receipt-text.ts`
- `M` `modules/communications/src/reminders/reminder-core.ts`
- `M` `packages/mobile-sdk/src/i18n/i18n.ts`
- `M` `packages/mobile-sdk/src/i18n/index.ts`

</details>

<details><summary><b>3. Backend (API, modules, shared packages)</b> — 118</summary>

- `M` `apps/admin-web/public/brand/brand-tokens.css`
- `M` `apps/api/openapi/manifest.txt`
- `M` `apps/api/src/account/language.controller.ts`
- `M` `apps/api/src/pos-account/pos-account-overview.core.ts`
- `M` `apps/api/src/pos-account/pos-account.service.ts`
- `M` `apps/api/src/pos/pos-search.kysely.repository.ts`
- `M` `apps/customer-display/public/brand/brand-tokens.css`
- `M` `apps/customer-web/public/brand/brand-tokens.css`
- `M` `apps/go-check-in-kiosk/public/brand/brand-tokens.css`
- `M` `apps/owner-web/public/brand/brand-tokens.css`
- `M` `apps/pos-web/public/brand/brand-tokens.css`
- `M` `apps/tech-web/public/brand/brand-tokens.css`
- `M` `modules/ai/src/ai-money-protection/ai-money-protection-explain.service.ts`
- `M` `modules/ai/src/ai-money-protection/ai-money-protection.service.ts`
- `M` `modules/ai/src/ai-queue-assignment/ai-queue-assignment-alerts.service.ts`
- `M` `modules/ai/src/ai-queue-assignment/ai-queue-assignment.service.ts`
- `M` `modules/ai/src/ai-queue-assignment/fair-turn-engine.ts`
- `M` `modules/ai/src/ai-scheduling-optimizer/ai-scheduling-constraints.ts`
- `M` `modules/ai/src/ai-scheduling-optimizer/ai-scheduling-day.ts`
- `M` `modules/ai/src/ai-scheduling-optimizer/ai-scheduling-insights.ts`
- `M` `modules/ai/src/ai-scheduling-optimizer/ai-scheduling.kysely.repository.ts`
- `M` `modules/ai/src/ai-scheduling-optimizer/ai-scheduling.memory.repository.ts`
- `M` `modules/ai/src/voice-booking/voice-gateway-core.ts`
- `M` `modules/analytics/src/dashboard/dashboard.dto.ts`
- `M` `modules/analytics/src/dashboard/dashboard.kysely.repository.ts`
- `M` `modules/analytics/src/owner/owner.controller.ts`
- `M` `modules/analytics/src/owner/owner.dto.ts`
- `M` `modules/analytics/src/owner/owner.kysely.repository.ts`
- `M` `modules/analytics/src/owner/owner.list-queries.ts`
- `M` `modules/analytics/src/owner/owner.repository.ts`
- `M` `modules/analytics/src/owner/owner.service.ts`
- `M` `modules/audit/src/audit.dto.ts`
- `M` `modules/booking/src/booking/booking.kysely.repository.ts`
- `M` `modules/booking/src/booking/booking.repository.ts`
- `M` `modules/booking/src/booking/booking.service.ts`
- `M` `modules/catalog/src/services/services.kysely.repository.ts`
- `M` `modules/catalog/src/services/services.repository.ts`
- `M` `modules/checkout/src/checkout/checkout.dto.ts`
- `M` `modules/checkout/src/checkout/checkout.kysely.repository.ts`
- `M` `modules/checkout/src/checkout/checkout.repository.ts`
- `M` `modules/checkout/src/checkout/checkout.service.ts`
- `M` `modules/communications/src/campaigns/campaigns.dto.ts`
- `M` `modules/communications/src/campaigns/campaigns.service.ts`
- `M` `modules/communications/src/communications/communications.dto.ts`
- `M` `modules/communications/src/platform-announcements/platform-notice-core.ts`
- `M` `modules/communications/src/platform-announcements/platform-notice.service.ts`
- `M` `modules/communications/src/reminders/reminders.kysely.repository.ts`
- `M` `modules/communications/src/reminders/reminders.repository.ts`
- `M` `modules/communications/src/reminders/reminders.service.ts`
- `M` `modules/communications/src/request-schemas.ts`
- `M` `modules/customers/src/customers/customers.dto.ts`
- `M` `modules/customers/src/customers/customers.kysely.repository.ts`
- `M` `modules/customers/src/customers/customers.repository.ts`
- `M` `modules/customers/src/customers/customers.service.ts`
- `M` `modules/customers/src/request-schemas.ts`
- `M` `modules/deals/src/bundles/bundles.kysely.repository.ts`
- `M` `modules/deals/src/bundles/bundles.repository.ts`
- `M` `modules/queue/src/check-in/check-in.controller.ts`
- `M` `modules/queue/src/check-in/check-in.dto.ts`
- `M` `modules/queue/src/check-in/check-in.list-queries.ts`
- `M` `modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts`
- `M` `modules/queue/src/live-technician-schedule/live-technician-schedule.dto.ts`
- `M` `modules/queue/src/live-technician-schedule/live-technician-schedule.kysely.repository.ts`
- `M` `modules/queue/src/live-technician-schedule/live-technician-schedule.list-queries.ts`
- `M` `modules/queue/src/live-technician-schedule/live-technician-schedule.service.ts`
- `M` `modules/queue/src/queue/queue.dto.ts`
- `M` `modules/queue/src/queue/queue.kysely.repository.ts`
- `M` `modules/queue/src/queue/queue.repository.ts`
- `M` `modules/queue/src/service-done/service-done.dto.ts`
- `M` `modules/queue/src/service-done/service-done.kysely.repository.ts`
- `M` `modules/queue/src/service-done/service-done.repository.ts`
- `M` `modules/queue/src/serving/serving.dto.ts`
- `M` `modules/queue/src/serving/serving.kysely.repository.ts`
- `M` `modules/queue/src/serving/serving.service.ts`
- `M` `modules/queue/src/tech-queue/tech-queue.controller.ts`
- `M` `modules/queue/src/tech-queue/tech-queue.dto.ts`
- `M` `modules/queue/src/tech-queue/tech-queue.kysely.repository.ts`
- `M` `modules/queue/src/tech-queue/tech-queue.list-queries.ts`
- `M` `modules/super-admin/src/index.ts`
- `M` `modules/super-admin/src/super-admin-settings/platform-settings.repository.ts`
- `M` `modules/super-admin/src/super-admin-settings/super-admin-settings.service.ts`
- `M` `modules/super-admin/src/super-admin-tenants/request-schemas-tenants.ts`
- `M` `modules/super-admin/src/super-admin-tenants/super-admin-tenants-core.ts`
- `M` `modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts`
- `M` `modules/super-admin/src/super-admin-tenants/super-admin-tenants.module.ts`
- `A` `modules/super-admin/src/super-admin-tenants/tenant-pos-language.ts`
- `M` `modules/workforce/src/technicians/technicians.kysely.repository.ts`
- `M` `modules/workforce/src/technicians/technicians.repository.ts`
- `M` `modules/workforce/src/time-clock/time-clock.controller.ts`
- `M` `modules/workforce/src/time-clock/time-clock.dto.ts`
- `A` `modules/workforce/src/time-clock/time-clock.list-queries.ts`
- `M` `modules/workforce/src/time-clock/time-clock.service.ts`
- `M` `modules/workforce/src/turn-queue/turn-core.ts`
- `M` `modules/workforce/src/turn-queue/turn-fairness.ts`
- `M` `modules/workforce/src/turn-queue/turn-queue.service.ts`
- `M` `packages/api-contracts/src/errors.ts`
- `M` `packages/api-contracts/src/index.ts`
- `M` `packages/api-contracts/src/language.ts`
- `M` `packages/api-contracts/src/platform/platform-announcements.ts`
- `M` `packages/api-contracts/src/tenant/ai-scheduling.ts`
- `M` `packages/api-contracts/src/tenant/ai.ts`
- `M` `packages/api-contracts/src/tenant/index.ts`
- `A` `packages/api-contracts/src/tenant/money-protection-text.ts`
- `M` `packages/api-contracts/src/tenant/owner.ts`
- `M` `packages/api-contracts/src/tenant/platform-announcements.ts`
- `M` `packages/api-contracts/src/tenant/pos-account.ts`
- `A` `packages/api-contracts/src/tenant/queue-alert-text.ts`
- `M` `packages/api-contracts/src/tenant/queue.ts`
- `M` `packages/api-contracts/src/tenant/turn-queue.ts`
- `M` `packages/api-contracts/src/tenant/workforce.ts`
- `A` `packages/api-contracts/src/text/coded-text.ts`
- `A` `packages/api-contracts/src/text/vi-fold.ts`
- `M` `packages/database/src/kysely.types.ts`
- `M` `packages/realtime-client/src/sync-policy.ts`
- `M` `packages/ui/src/ProfileAvatarWithPreview.tsx`
- `M` `packages/ui/src/brand/platform-brand.ts`
- `M` `packages/ui/src/index.ts`
- `M` `packages/ui/src/tokens.css`

</details>

<details><summary><b>4. Migrations</b> — 4</summary>

- `A` `apps/api/db/migrations/694_vi_search_fold.sql`
- `A` `apps/api/db/migrations/695_tenant_pos_language_authority.sql`
- `A` `apps/api/db/migrations/696_platform_notice_vietnamese.sql`
- `A` `apps/api/db/migrations/697_customer_language_normalize.sql`

</details>

<details><summary><b>5. Tests, harnesses and pilot</b> — 114</summary>

- `M` `apps/admin-web/src/screens/PlatformAnnouncementsScreen.test.tsx`
- `M` `apps/admin-web/src/screens/TenantsScreen.test.tsx`
- `A` `apps/api/scripts/lib/pilot-vietnamese.mjs`
- `M` `apps/api/scripts/live-pilot-day.mjs`
- `M` `apps/api/src/account/language.pgtest.vitest.spec.ts`
- `M` `apps/api/src/pos-account/pos-account-overview.vitest.spec.ts`
- `A` `apps/api/src/pos/vi-search.pgtest.vitest.spec.ts`
- `M` `apps/owner-web/src/screens/LiveOperationsScreen.test.tsx`
- `M` `apps/pos-web/src/api/offline-read-cache.test.ts`
- `A` `apps/pos-web/src/components/CheckoutTicketInner.vi.test.tsx`
- `A` `apps/pos-web/src/components/ImeSafeInput.test.tsx`
- `M` `apps/pos-web/src/components/PaymentGatewayStatusCard.test.tsx`
- `M` `apps/pos-web/src/components/TapToPayDevicesPanel.test.tsx`
- `M` `apps/pos-web/src/components/TechnicianSchedulePreview.test.tsx`
- `A` `apps/pos-web/src/i18n/audit-labels.test.ts`
- `A` `apps/pos-web/src/i18n/coded-text.test.ts`
- `A` `apps/pos-web/src/i18n/error-text.test.ts`
- `A` `apps/pos-web/src/i18n/format.test.ts`
- `A` `apps/pos-web/src/i18n/glossary.test.ts`
- `A` `apps/pos-web/src/i18n/pos-language.test.ts`
- `A` `apps/pos-web/src/i18n/status-label.test.ts`
- `A` `apps/pos-web/src/i18n/switch-preserves-state.test.tsx`
- `A` `apps/pos-web/src/realtime/RealtimeStatusPill.test.tsx`
- `M` `apps/pos-web/src/screens/AccessRequestPanel.test.tsx`
- `A` `apps/pos-web/src/screens/AdminScreens.vi.test.tsx`
- `A` `apps/pos-web/src/screens/POSAICenterScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSAIFrontDeskScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSAIMoneyProtectionAlertsScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSAIMoneyProtectionRulesScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSAIMoneyProtectionScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSAIQueueAssignmentScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSAIQueueAssignmentScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSAISchedulingOptimizerScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSAIVoiceTranscription.test.tsx`
- `M` `apps/pos-web/src/screens/POSAiBusinessScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSAiForecastingScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSAiReportsScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSBookingScreen.sync-preservation.test.tsx`
- `A` `apps/pos-web/src/screens/POSBookingScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSBookingVerificationScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSBookingVerificationScreen.vi.test.tsx`
- `A` `apps/pos-web/src/screens/POSCheckInScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSCheckoutScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSCheckoutScreen.unknown-language.test.tsx`
- `M` `apps/pos-web/src/screens/POSCustomersScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSCustomersScreen.vi.test.tsx`
- `A` `apps/pos-web/src/screens/POSDealsScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSDisplayAdsScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSExpensesScreen.vi.test.tsx`
- `A` `apps/pos-web/src/screens/POSHelpCenterScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSLiveTechnicianScheduleScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSMessagesScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSNailShowcaseModerationScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSOverviewScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSOverviewScreen.vi.test.tsx`
- `A` `apps/pos-web/src/screens/POSPayrollScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSQueueScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSQueueScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSServiceDoneScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSServingScreen.vi.test.tsx`
- `A` `apps/pos-web/src/screens/POSTechAppointmentsScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/POSTechQueueScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSTechnicianProfileScreen.test.tsx`
- `M` `apps/pos-web/src/screens/POSTurnQueueScreen.test.tsx`
- `A` `apps/pos-web/src/screens/POSTurnQueueScreen.vi.test.tsx`
- `A` `apps/pos-web/src/screens/POSUsageLimitsScreen.vi.test.tsx`
- `A` `apps/pos-web/src/screens/POSWalkInScreen.vi.test.tsx`
- `A` `apps/pos-web/src/screens/PeopleScreens.vi.test.tsx`
- `M` `apps/pos-web/src/screens/SourceBadge.test.tsx`
- `M` `apps/pos-web/src/screens/access/accessUi.test.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityAdvisoryEditor.test.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityApprovalsScreen.test.tsx`
- `M` `apps/pos-web/src/screens/community/CommunityDraftsIncidents.test.tsx`
- `A` `apps/pos-web/src/screens/community/CommunityFeedScreen.vi.test.tsx`
- `M` `apps/pos-web/src/screens/roster-1000.test.tsx`
- `A` `apps/pos-web/src/screens/viScan.testkit.ts`
- `M` `apps/pos-web/src/shell/LanguageSwitch.test.tsx`
- `M` `apps/pos-web/src/shell/PlatformAnnouncementBar.test.tsx`
- `A` `apps/pos-web/src/shell/TopSearch.test.tsx`
- `A` `modules/ai/src/ai-money-protection/money-protection-coded-text.vitest.spec.ts`
- `M` `modules/ai/src/ai-queue-assignment/ai-queue-assignment-settings.pgtest.vitest.spec.ts`
- `M` `modules/ai/src/ai-queue-assignment/fair-turn-engine.vitest.spec.ts`
- `A` `modules/ai/src/ai-queue-assignment/queue-alert-coded-text.vitest.spec.ts`
- `A` `modules/ai/src/ai-scheduling-optimizer/ai-scheduling-coded-text.vitest.spec.ts`
- `M` `modules/ai/src/voice-booking/ai-receptionist-gateway.vitest.spec.ts`
- `M` `modules/analytics/src/owner/owner-live-ops-queries.pgtest.vitest.spec.ts`
- `M` `modules/booking/src/booking/booking-200-technicians.vitest.spec.ts`
- `M` `modules/checkout/src/checkout/checkout-commission-preview.vitest.spec.ts`
- `A` `modules/checkout/src/checkout/checkout-receipt-language.vitest.spec.ts`
- `M` `modules/communications/src/platform-announcements/platform-notice-core.vitest.spec.ts`
- `M` `modules/communications/src/platform-announcements/platform-notice.pgtest.vitest.spec.ts`
- `A` `modules/communications/src/reminders/reminder-language.vitest.spec.ts`
- `A` `modules/customers/src/customers/customer-language.pgtest.vitest.spec.ts`
- `M` `modules/customers/src/customers/customer-preferences.postgres.vitest.spec.ts`
- `M` `modules/customers/src/customers/customer-preferences.vitest.spec.ts`
- `A` `modules/customers/src/customers/customers-vi-search.vitest.spec.ts`
- `A` `modules/customers/src/customers/vietnamese-unicode.pgtest.vitest.spec.ts`
- `A` `modules/queue/src/check-in/check-in-roster-1000.vitest.spec.ts`
- `A` `modules/queue/src/live-technician-schedule/live-schedule-lanes.vitest.spec.ts`
- `A` `modules/queue/src/queue/queue-vi-search.vitest.spec.ts`
- `A` `modules/queue/src/serving/serving-revision-coded.vitest.spec.ts`
- `M` `modules/queue/src/tech-queue/tech-queue-analytics.vitest.spec.ts`
- `A` `modules/queue/src/tech-queue/tech-queue-lanes-1000.pgtest.vitest.spec.ts`
- `M` `modules/super-admin/src/super-admin-settings/super-admin-settings.vitest.spec.ts`
- `A` `modules/super-admin/src/super-admin-tenants/tenant-pos-language.vitest.spec.ts`
- `A` `modules/workforce/src/time-clock/time-clock-roster-1000.vitest.spec.ts`
- `A` `modules/workforce/src/turn-queue/turn-coded-text.vitest.spec.ts`
- `A` `packages/api-contracts/src/customer-language.test.ts`
- `A` `packages/api-contracts/src/text/vi-fold.test.ts`
- `M` `packages/mobile-sdk/src/i18n/i18n.test.tsx`
- `M` `packages/realtime-client/src/sync-policy.test.ts`
- `M` `tooling/e2e/pos-announcement-layout.mjs`
- `A` `tooling/e2e/pos-vi-one-screen.mjs`
- `A` `tooling/i18n/pos-strings.test.mjs`

</details>

<details><summary><b>6. Gates, scanners and configuration</b> — 11</summary>

- `M` `apps/api/security/role-matrix.snapshot.json`
- `A` `tooling/ci/check-admin-english-only.mjs`
- `M` `tooling/ci/check-i18n.mjs`
- `M` `tooling/ci/check-pos-i18n.mjs`
- `A` `tooling/ci/check-vi-glossary.mjs`
- `M` `tooling/ci/run-gates.mjs`
- `A` `tooling/i18n/__fixtures__/tier4-caught.tsx`
- `A` `tooling/i18n/__fixtures__/tier4-clean.tsx`
- `M` `tooling/i18n/pos-codemod.mjs`
- `A` `tooling/i18n/pos-i18n-baseline.json`
- `M` `tooling/i18n/pos-strings.mjs`

</details>

<details><summary><b>7. Documentation</b> — 6</summary>

- `M` `PERFORMANCE_REPORT.md`
- `M` `docs/mandates/status/200_TECHNICIAN_STATUS.md`
- `A` `docs/mandates/status/VIETNAMESE_POS_BUILD_PLAN.md`
- `A` `docs/mandates/status/VIETNAMESE_POS_STATUS.md`
- `M` `docs/security/SECURITY_ATTACK_SURFACE.md`
- `M` `docs/security/attack-surface-routes.csv`

</details>

The WP-J documentation commit adds: `docs/i18n/VIETNAMESE_POS_ENGINEERING_REPORT.md` (new), `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`, `docs/mandates/status/VIETNAMESE_POS_STATUS.md`, `DEVELOPER_HANDOFF.md`, `NEXT_STEPS.md`, `TEST_REPORT.md`, `docs/FINAL_ACCEPTANCE_MATRIX.md`, `docs/MANDATE_COMPLETION_MATRIX.md` and the evidence folder `docs/pilot-runs/2026-10-27-vietnamese/` (`pilot.log`, `pilot.json`, `shots/`, `one-screen-empty/`, `one-screen-light/`).

---

# Developer handoff (§127)

**Localization architecture and library.** There is one in-house runtime, `packages/mobile-sdk/src/i18n/i18n.ts`, with flat
dictionaries per language. There is no i18next and no second system. Read section C above first.

**Super Admin is English only.** Never import `@aipowersalon/mobile-sdk/i18n` in `apps/admin-web`. Never add a language control
there. `check-admin-english-only` fails the build if either happens.

**Tenant default vs user preference.** The user's choice wins, then the salon default, then English:

- the salon default is the `business-branch` `defaultLanguage` (one authority; migration 695);
- the user's choice is `users.preferred_language`;
- the API is `GET /pos/me/locale` and `PUT /pos/me/language`;
- the salon default is set with `PATCH /pos/settings/business-branch`, or by Super Admin with `PUT /super-admin/tenants/:id/pos-language`.

**How to add a string.**

1. Pick the namespace that owns the screen:
   - `ops` — front desk;
   - `people`;
   - `growth`;
   - `admin`;
   - `payment`;
   - `status` — a canonical code's label;
   - `errors` — an `ERROR_REGISTRY` code;
   - `srv` — server text codes;
   - `audit`.
2. Add the same key to `apps/pos-web/src/i18n/ns/<ns>.en.ts` **and** `<ns>.vi.ts`. Keys are semantic: `<ns>.<area>.<item>`.
   Placeholders are `{name}` and must match in EN and VI.
3. Render it with `t('<key>', vars)` inside the component, never at module level. A table of labels is a getter or a function.
   Text kept in state is a key or a sentinel, worded at render time.
4. Codes have their own helpers:
   - a status or code: `statusLabel(domain, code)` / `codeLabel(prefix, code)` / `opsStatusLabel` / `floorLabel`;
   - server text: `codedText(ct, fallback)`;
   - dates: `displayLocale()` / `i18n/format.ts`;
   - a search box: `ImeSafeInput`;
   - a client filter: `viIncludes`.
5. Add the Vietnamese to `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` for Kevin.
6. A Vietnamese render test uses `screens/viScan.testkit.ts` (`leftoverEnglish`). Wrap the screen as
   `function Live(){ useLanguage(); return <Screen/> }` when the test switches language.
7. **Never** add keys to `catalog.en.ts`. It is frozen; the key count may only fall, and the codemod refuses `--write`.

**How to add a namespace.**

1. Create `ns/<name>.en.ts` and `ns/<name>.vi.ts`.
2. Register both in `ns/index.ts`.
3. `check-i18n` picks them up automatically.
4. If keys are built at run time from codes, use a literal prefix: `` `x.${code}` ``, `'x.' + code` or `codeLabel('x', code)`.
   The unused-key report recognises these forms.

**How to add a language.** Add it in all of these places:

1. `APP_LANGUAGES` (`packages/api-contracts/src/language.ts`) and `LANGUAGE_LOCALE`.
2. A migration that widens the CHECKs on `users.preferred_language`, `customers.preferred_language` and the `defaultLanguage`
   enum (`modules/tenants/src/request-schemas.ts`).
3. `catalog.<lang>.ts` and `ns/*.<lang>.ts`, registered in `i18n/index.ts` / `ns/index.ts`.
4. An entry in `LanguageSwitch.tsx`.
5. `check-i18n` for the new pair.
6. The customer-message templates (`.en` / `.vi` keys).

Use `Intl.PluralRules` where the new language needs plural forms.

**Server text.** New server-written sentences must also send `{code, vars}` (`coded()` from `@aipowersalon/api-contracts`), with
EN templates in `ns/srv.en.ts` equal to the server's English. Add a lossless test, following the existing `*-coded-text.vitest.spec.ts`.
Edit `ns/srv.en.ts` and `ns/srv.vi.ts` together; the EN text must stay equal to the server's English (the lossless tests fail otherwise).

**Gates** (`npm run ci:gates`):

- `i18n` — parity, empty values, placeholders.
- `pos-i18n` — tiers 1–3 must be 0, and tier 4 ratchets per file against `tooling/i18n/pos-i18n-baseline.json`. The baseline may
  only go down: `--update` lowers it. Reports unused and duplicate keys. Refuses new frozen-catalogue keys.
- `vi-glossary` — the glossary doc equals `ns/glossary`, and forbidden variants such as "Kỹ thuật viên", "hàng đợi" and
  "biên nhận" are refused.
- `admin-english-only`.

**Migrations and APIs.**

| Migration | What it adds |
|---|---|
| 694 | `vi_fold()` and trigram expression indexes |
| 695 | one POS-language authority + trigger |
| 696 | announcement `title_vi` / `message_vi` / review stamps |
| 697 | customer language normalised to en / vi + CHECK |

APIs added:

- `GET /pos/me/locale`, `PUT /pos/me/language`;
- `GET/PUT /super-admin/tenants/:id/pos-language`;
- additive `*Coded` fields on the turn, serving, AI-scheduling, AI-queue alert and Money Protection responses;
- `lanePage` / `lanePageSize` / `laneSearch` / `roster` on the Live Technician Schedule;
- `search` on `GET /pos/booking/technicians`, now accent-insensitive.

**Tests and screenshots.**

- Pilot day phase 13 (`apps/api/scripts/lib/pilot-vietnamese.mjs`): run `node apps/api/scripts/live-pilot-day.mjs`; skip the
  phase with `PILOT_SKIP=13`.
- The one-screen CLI (`tooling/e2e/pos-vi-one-screen.mjs`): `DATABASE_URL=… STATE=empty|light SHOTS=… node tooling/e2e/pos-vi-one-screen.mjs`.
- Vietnamese render tests: `apps/pos-web/src/screens/*.vi.test.tsx`.
- `i18n/*.test.ts`.
- `vietnamese-unicode.pgtest`, `vi-search.pgtest`, `language.pgtest`.
- Evidence of the final run: `docs/pilot-runs/2026-10-27-vietnamese/`.

**Remaining gaps and the exact next action** (updated Oct 27 2026 after the open items V-2 … V-6 — see §M).

1. **Kevin's review.** 3,640 rows in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (the WP-J 3,465 + paycheck 71 + receipt 47 + V-OPEN 57), none reviewed yet.
   Next: Kevin marks OK or corrects; a developer applies the corrections; re-run `check-i18n` and `check-vi-glossary`.
2. **Service validation prose (§58).** Schema-level 400s and the customer form are coded and worded by the POS; about 500
   free-text `ValidationError` throw sites in 25 module services are not (booking, checkout "This ticket is already paid.",
   deals refusal reasons shown as "Chưa áp dụng ưu đãi đã đặt: {reason}", queue, communications …). Next: pass
   `{ field, rule, params }` or a registry code the way `customers.service.ts` does, screen by screen.
3. **Hit-area report items (§78, not certified viewports).** On the light state: the booking "+ 25 min open" gap slot at
   2560 and full-screen 1920×1080 (a decoration painted over it), the Live Ops VI report links (41 px) at 1920×1080, and the
   Tech Queue VI "View suggestions" / "Send alert" at 1280. Next: make the grid decorations `pointer-events: none` and re-run.

Never put secrets or credentials in these documents. The pilot creates its own accounts with random passwords for each run.

## N. V-5 all modules — every server refusal as a registry code (Oct 27 2026, final)

**Mechanism.** `withCode(err, CODE, params)` (`packages/api-contracts/src/coded-error.ts`) attaches `apiCode` / `apiParams` to any
error without changing its class, English sentence or the status its controller maps it to (own property names — many classes
already use `code` for their kind, e.g. `TechError('not_found', …)`). The platform exception filter (`@aipowersalon/observability`
request-telemetry `withRequestCode`) answers the code: from the exception itself, or — when a controller re-threw only the sentence
(`new HttpException(e.message, 400)`, the commonest mapping) — from the coded errors THIS request threw with the same sentence
(request-scoped, at most 8; no cross-request leak — tested). The registry code always rides in `details.messageCode` (+ the params);
it also becomes `code` when the route sent none or the status's generic one. A code a controller chose — registered, or a legacy
kind a screen branches on (`stale_record`, `invalid_pin`, `not_pending` …) — is never replaced, and no status changes.

**Apps.** POS `apiErrorMessage` words `details.messageCode` first (`i18n/error-text.ts`); the Owner App and the Tech App now localize
server refusals in the ONE mobile transport (`packages/mobile-sdk/src/i18n/error-message.ts`): Vietnamese → `errors.<messageCode|code>`
from each app's generated catalogue (`apps/{owner,tech}-web/src/i18n/errors.generated.ts`, written from the POS `ns/errors` by
`tooling/i18n/sync-app-error-catalogs.mjs`; `--check` runs in the gate), English → the server's sentence. `code`, `details` and
`serverMessage` stay on the error.

**Counts.** Free-text throws of a literal sentence (TypeScript-parser scan, `apps/api/scripts/lib/throw-sites.mjs`; the 500 path and
403 classes excluded — their registry codes already word them): 3,308 before (all audiences). Reachable from a POS / Owner / Tech
screen: ~2,480 sites / 1,770 distinct sentences — every one classified: **1,476 converted** (21 modules + apps/api; checkout /
booking / queue / deals — the 264 left after `2fa57469` — included), the rest reviewed as internal-only. **681 new registry codes**
(229 → 910), grouped by meaning (`TICKET_NOT_FOUND`, `SERVICE_NOT_FOUND`, `OWNER_ONLY_ACTION`, `FEATURE_NOT_AVAILABLE` …; params
where the Vietnamese needs them: `{count}`, `{max}`, `{min}`, `{rows}`, `{field}`), EN = the registry sentence, VI in `ns/errors.vi.ts`,
681 review rows (V5M-1 … V5M-681) in `VI_NEW_STRINGS_FOR_REVIEW.md`.

**Still English on purpose** (`tooling/ci/error-text.baseline.json`, 1,242 throws / 241 files, reason + sentences per file):
Super Admin / platform consoles (English-only by design, §103) ≈ 789; client / device contracts (a field the screen always sends or
a value it can only pick from a list — the request-schema layer words a real form error) ≈ 188; customer app / public booking /
kiosk / customer display device ≈ 117 (not POS / Owner / Tech screens); background jobs, event consumers, internal assertions ≈ 76;
machine callers and provider transport (OAuth, webhooks, voice provider, card processor HTTP) ≈ 61; dev / test builds without a
database ≈ 11. Pending (user-facing, not converted): 0.

**Gate.** `check:error-text` (`apps/api/scripts/check-error-text.mjs`, in `tooling/ci/run-gates.mjs`): a file with a NEW free-text
refusal fails (wrap it in withCode, add the code + EN / VI); a file with fewer fails until `--update` shrinks the baseline; the Owner /
Tech catalogues must match the POS.

**Tests.** `packages/observability/src/coded-refusal.test.ts` (filter: coded HttpException, re-thrown sentence, no cross-request leak,
legacy code kept + messageCode); per module `v5-coded-refusals.vitest.spec.ts` in catalog, deals/bundles, memberships, communications/
campaigns, workforce/technicians, customers/pos-referrals, booking (code + params on the real service methods); POS
`i18n/v5-coded-refusals.vi.test.tsx` (a converted refusal renders in Vietnamese; legacy code kept while messageCode words it; every
registry code has EN = registry sentence and VI with the same placeholders) + `error-text.test.ts`; `packages/mobile-sdk/src/i18n/
error-message.test.ts`; `apps/tech-web/src/i18n/errors-vi.test.ts` (through the real transport). Also: `checkout.service.ts`
`as any` 43 → 2 (one typed `permCtx` cast for the permission check; the audit-log casts were never needed).
