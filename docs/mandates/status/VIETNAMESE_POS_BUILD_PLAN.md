# VIETNAMESE_POS_BUILD_PLAN.md — closing the PARTIAL / NOT DONE rows of `VIETNAMESE_POS_STATUS.md`

Mandate: `docs/mandates/2026-10-26_VIETNAMESE_POS_MANDATE.txt` (§1–§127). Baseline: `VIETNAMESE_POS_STATUS.md` in this
folder (audited at `ab1c628b`: 41 DONE · 41 PARTIAL · 44 NOT DONE · 1 BLOCKED_EXTERNAL).

**Principle: finish the existing system, do not add a second one.** The in-house runtime
(`packages/mobile-sdk/src/i18n/i18n.ts`), the POS catalogues, the `users.preferred_language` column, the
`tenant_settings.business-branch.defaultLanguage` default, `GET pos/me/locale` / `PUT pos/me/language`, and the two gates
(`check-i18n`, `check-pos-i18n`) all stay. No i18next, no `packages/i18n` rewrite, no re-keying of the 8,900 generated keys.

## 1. The key technical finding that shapes the plan

A language switch today **reloads the page** (`apps/pos-web/src/i18n/reload.ts`, called from `shell/LanguageSwitch.tsx:23`
and `i18n/use-pos-language.ts:19`) and **remounts the shell** (`shell/POSLayout.tsx:372` `key={language}`). That is why
§6/§7/§81/§104–§108/§116 fail. It was done because only 1 of 175 translating files subscribes to the language, and 385
`t()` calls run at module level (28 files; 208 in `shell/tenant-nav.tsx`).

The fix does **not** need a hook in 175 files. Route elements are created in `POSRoutes()` (`apps/pos-web/src/App.tsx:198`,
`<Routes>` at :203). If `POSRoutes` subscribes (`useLanguage()`), every route element is re-created on a switch → React
**updates** (not remounts) each mounted screen and its whole subtree (the app has 0 `React.memo`), so all render-time
`t()` calls re-run while `useState`, refs, realtime listeners and the SSE connection survive. What stays stale must then be
fixed file by file:
- module-level `t()` constants (385 calls / 28 files) → turn into functions or getters (`const QA = () => [...]`);
- `useMemo` bodies that call `t()` without a language dependency (3 sites);
- translated text **stored in state** (`setNote(tx(...))`, `setErr(t(...))`) → store `{ key, vars }` and translate at render
  (mandatory for the payment-safety banner; recommended for persistent banners; transient toasts may stay as strings);
- trees outside `POSRoutes` (login/`Gate`, portals mounted from `main.tsx`) → subscribe there too.

## 2. Execution order and file ownership

```
Phase 0 (serial, one agent, ~1 day) ── WP-B  runtime + stubs every other WP codes against
Phase 1 (parallel) ──────────────────── WP-A · WP-C1 · WP-C2 · WP-C3 · WP-C4 · WP-D1 · WP-D2 · WP-E · WP-F · WP-I · WP-K
Phase 2 (after Phase 1 merges) ──────── WP-G tests/certification · WP-H (optional catalog translations) · WP-J report/handoff
```

**Rules that keep Phase 1 conflict-free**
1. **Catalogue files.** `apps/pos-web/src/i18n/catalog.en.ts` is **frozen** (no new keys; do not run
   `tooling/i18n/pos-codemod.mjs --write` again). `catalog.vi.ts` has **one owner: WP-D1** (glossary value fixes). Every
   other WP adds keys only to **its own namespace files** `apps/pos-web/src/i18n/ns/<ns>.en.ts` / `<ns>.vi.ts`, created
   empty and registered by WP-B in Phase 0. Keys are semantic: `<ns>.<area>.<item>` (`ops.overview.qa.takePayment`,
   `status.ticket.READY_FOR_CHECKOUT`, `errors.APPOINTMENT_CONFLICT`, `payment.unknown.doNotPayAgain`) — closes §19 for
   everything new.
2. **Helpers are created as stubs in Phase 0** (signature + pass-through) so C-groups can call them immediately; the
   named WP then owns and fills them: `i18n/status-label.ts` + `i18n/error-text.ts` (→ WP-D1),
   `packages/api-contracts/src/text/vi-fold.ts` + `apps/pos-web/src/components/ImeSafeInput.tsx` (→ WP-E),
   `i18n/format.ts` (WP-B keeps).
3. **Screen files are owned by exactly one C/D group** (table in §3). The owner also converts that file's module-level
   `t()`, replaces its `.replace(/_/g,' ')` enum renderers with `statusLabel()`, adopts `foldVi()` in its client-side
   filters and `ImeSafeInput` in its search fields. Unlisted `apps/pos-web/src` files default to **WP-C4**.
4. **Shared generated / ledger files** — `apps/api/openapi/manifest.txt`, `tooling/ci/run-gates.mjs`,
   `packages/api-contracts/src/index.ts`: single owners (WP-J at merge, WP-K, WP-E respectively); other WPs list the lines
   they need in their PR description.
5. **Migration numbers reserved** (last on disk: `692_security_event_network_policy.sql`; the lead confirms or renumbers at
   merge): **693** WP-A, **694** WP-E, **695** WP-F, **696** WP-H, **697** WP-I.

## 3. Work packages

### WP-B — POS runtime: instant switch, no reload, no remount (Phase 0)
Closes §5, §6, §7 (mechanism), §8 (client order), §15, §18 (partly), §43, §47 (helper), §65, §81, §100, §104 (unit), §115 (mechanism), §116.
- `apps/pos-web/src/App.tsx` — `POSRoutes()` and `Gate`/login tree call `useLanguage()` (re-creates route elements; no `key`).
- `apps/pos-web/src/shell/POSLayout.tsx` — remove `key={language}` (:372); keep `usePosLanguage`.
- `apps/pos-web/src/i18n/reload.ts` — **delete**; `apps/pos-web/src/i18n/use-pos-language.ts` — apply the server answer
  with `setLanguage` (no reload, no sessionStorage guard); POS order becomes server(user ?? salon default) ?? **cached last
  server answer** ?? `'en'` — the browser-language layer is dropped **for the POS only** (the four mobile apps keep
  `initLanguage` unchanged; conflict 4 in the status file).
- `apps/pos-web/src/shell/LanguageSwitch.tsx` (+ `.test.tsx`) — no reload; label "English / Tiếng Việt" with a globe
  icon (keep 40 px+ target, `aria-pressed`/menu semantics), persist via `PUT /pos/me/language`; on success re-read nothing.
- `apps/pos-web/src/i18n/index.ts` — register `ns/*.ts` files: `nav, ops, people, growth, admin, glossary, status,
  errors, payment, search, comms` (empty `{}` stubs created here); on every language change set
  `document.documentElement.lang` (§65).
- `apps/pos-web/src/i18n/format.ts` (new) — `fmtMoney` (branch currency, value-preserving), `fmtDate/fmtTime` (branch zone
  + `currentLocale()` so month names follow the language) — C-groups replace their `toLocaleString('en-US')` with it.
- `apps/pos-web/src/shell/tenant-nav.tsx` — 208 module-level `t()` → functions; `apps/pos-web/src/screens/LoginScreen.tsx`
  (7), `apps/pos-web/src/api/offline-read-cache.ts` (1) likewise.
- `packages/mobile-sdk/src/i18n/i18n.ts` — **additive only** (shared with 4 mobile apps): `import.meta.env.DEV` console
  warning once per missing key (§100); export `onLanguageChange(fn)` for non-React code.
- `apps/pos-web/index.html` — request the Vietnamese subset explicitly for Hanken Grotesque / Playfair Display (`&subset`
  is implicit in css2 via unicode-range; verify, else self-host) (§43).
- Stubs (ownership transfers in Phase 1): `i18n/status-label.ts` (`statusLabel(domain, code)`), `i18n/error-text.ts`
  (`errorText(code, details, fallback)`), `packages/api-contracts/src/text/vi-fold.ts` (`foldVi(s)`),
  `components/ImeSafeInput.tsx`.
- Tests: rewrite `shell/LanguageSwitch.test.tsx` (no reload; a mounted stateful probe keeps its state and re-renders in VI);
  new `apps/pos-web/src/i18n/runtime.test.tsx` (switch EN→VI→EN keeps a `useState` counter, an open modal and a route;
  `document.documentElement.lang` follows; module-level-free nav renders VI); `packages/mobile-sdk/src/i18n/i18n.test.tsx`
  +1 case (dev warning, prod silent).
- Effort: **1–1.5 agent-days.**

### WP-A — Backend locale authority + Super Admin control (Phase 1)
Closes §8 (server side kept), §13 (conflict cleanup), §93, §102 (server half), feeds §103.
- `apps/api/db/migrations/693_tenant_pos_language_authority.sql` — retire the competing representation: either drop the
  read of `tenants.locale` (preferred: leave the column, stop reading it) or backfill it from
  `tenant_settings.defaultLanguage`; add nothing to `users` (column 560 already right).
- `apps/api/src/account/language.controller.ts` — unchanged contract; export `LanguageService.salonDefault` for reuse.
- `modules/super-admin/src/super-admin-tenants/` — new `tenant-pos-language.ts` + route
  `GET/PUT /super-admin/tenants/:tenantId/pos-language` (`super_admin.tenants.edit`, step-up as for other tenant config,
  writes `tenant_settings` business-branch salon-wide row through the same validation, `settings_audit_logs` row with actor,
  old/new, timestamp — §94 parity).
- `modules/super-admin/src/super-admin-settings/platform-settings.repository.ts` + `super-admin-settings.service.ts` —
  "Localization Distribution" counts `defaultLanguage` (en / vi / not set), not `tenants.locale`.
- `apps/api/src/pos-account/pos-account-overview.core.ts:48` — `language` from the salon default.
- `packages/api-contracts/src/language.ts` — `TenantPosLanguage` DTO.
- `apps/admin-web/src/screens/TenantsScreen.tsx` (+ `.test.tsx`), `apps/admin-web/src/api/superAdminApi.ts` — English-only
  control "Default POS Language: English / Vietnamese" in the tenant detail.
- Tests: extend `apps/api/src/account/language.pgtest.vitest.spec.ts` (SA sets vi → POS user without choice gets vi; user
  with en keeps en; new user inherits; another tenant untouched; audit row written; invalid `fr` → 400);
  `TenantsScreen.test.tsx` (control renders English, PUT body).
- Effort: **1–1.5 agent-days.**

### WP-C — Hard-coded string migration, one agent per screen group (Phase 1)
Closes §2, §25, §58–§64, §27 (tenant display), §38 (surfaces), §120 (C3), plus the per-file adoption of §40/§41/§47.
Each group, per owned file: (a) every remaining English literal → `t('<ns>.…')` in its own `ns` file with Vietnamese
(glossary terms from WP-D1's `docs/i18n/VI_GLOSSARY.md`); (b) module-level `t()` → functions; (c) enum "pretty" renderers →
`statusLabel()`; (d) translated text kept in state → `{key, vars}`; (e) `toLocaleString('en-US')` dates → `i18n/format.ts`;
(f) `toLowerCase().includes` name filters → `foldVi()`; (g) search inputs → `ImeSafeInput`; (h) VI-length layout fixes
(clamp/ellipsis, flexible widths, never smaller fonts or < 44 px targets — §76–§78). Starting list = the AST residual scan
(788 candidates / 148 files; rerun with WP-K's tier-4 scanner).

| WP | Owned files (`apps/pos-web/src/…`) | ns | Effort |
|---|---|---|---|
| **C1 Front-desk operations** | `screens/POSOverviewScreen.tsx` (Quick Actions :172-176, links :460-477), `POSDashboardScreen.tsx` (Live Ops), `POSCheckInScreen.tsx`, `POSWalkInScreen.tsx`, `POSNewBookingScreen.tsx`, `POSBookingScreen.tsx`, `POSBookingVerificationScreen.tsx`, `POSQueueScreen.tsx`, `POSTechQueueScreen.tsx`, `POSTurnQueueScreen.tsx`, `POSServingScreen.tsx`, `POSServiceDoneScreen.tsx`, `POSLiveTechnicianScheduleScreen.tsx`, `SourceBadge.tsx`; `components/QuickCheckInPanel.tsx`, `QueueItemInner.tsx`, `AppointmentDetailInner.tsx`, `AssignTechSheet.tsx`, `MoveAppointmentModal.tsx`, `BookingSharedComponents.tsx`, `TechnicianSchedulePreview.tsx`; `api/posBookingApi.ts` | `ops` | 2–2.5 d |
| **C2 People & catalogue** | `screens/POSCustomers*.tsx`, `POSCustomerNotesScreen.tsx`, `POSCustomerPhone*.tsx`, `POSMemberships*.tsx`, `MembershipPlanBuilder.tsx`, `POSTechnicians*.tsx`, `POSTeamPermissionsScreen.tsx`, `POSPayroll*.tsx`, `POSPaycheckTab.tsx`, `POSServices*.tsx`, `POSServiceAddOnsScreen.tsx`, `POSProducts*.tsx`, `POSExpensesScreen.tsx`; `components/CustomerDetailInner.tsx`, `ProfileChangeRequestsPanel.tsx`, `TechnicianAccessPanel.tsx` | `people` | 1.5–2 d |
| **C3 Growth, comms & AI** | `screens/POSAI*.tsx`, `POSAi*.tsx`, `ai-queue/**`, `ai-scheduling/**`, `aiCustomerProfileCommon.tsx`, `AICheckoutUpsell*.tsx`, `POSReceptionCopilotScreen.tsx`, `POSPhoneScreen.tsx`, `POSMessages*.tsx`, `POSSegmentsScreen.tsx`, `POSNailShowcaseModerationScreen.tsx`, `POSUsageLimitsScreen.tsx`, `deals/**`, `community/**`; `components/AiAssistantPanel.tsx`. AI reason codes rendered via `statusLabel('aiReason', code)` (§120) | `growth` | 2 d |
| **C4 Management, devices, account, settings** | `screens/POSSettingsScreen.tsx`, `POSAccountScreen.tsx`, `access/**`, `approvals/**`, `POSDevicesScreen.tsx`, `POSCustomerDisplaysScreen.tsx`, `display-settings/**`, `display-ads/**`, `TenantLocationsScreen.tsx`, `TenantLogsScreen.tsx`, `POSHelpCenterScreen.tsx`, `POSSystemStatusScreen.tsx`, `POSSalesReportScreen.tsx` and other report screens, `POSManagementScreen.tsx`, `POSUsageLimits` excluded (C3); `components/AuthSecurityPanels.tsx`; `shell/*` **except** `POSLayout.tsx`, `LanguageSwitch.tsx`, `tenant-nav.tsx` (WP-B), `TopSearch.tsx` (WP-E), `PlatformAnnouncementBar.tsx` (WP-F); **every file not listed elsewhere** | `admin` | 1.5–2 d |

Tests per group: for each primary screen it owns, one RTL test `…/<Screen>.vi.test.tsx` rendering with `setLanguage('vi')`
asserting no string from a deny-list of the screen's English labels remains and key VI labels appear; existing screen tests
must stay green in EN.

### WP-D1 — Glossary, canonical status labels, error-code messages (Phase 1)
Closes §19 (new keys), §21, §22, §28, §29, §30, §31–§34 (terms), §36 (prepares review), §37, §62 (helper), §122.
- `docs/i18n/VI_GLOSSARY.md` (new, version-controlled; the mandate requires it) — every §28–§34 term + §37 list, approved
  VI, forbidden variants (e.g. "thợ", "KTV", "Dịch vụ xong" unless Kevin approves), reviewer + date column.
- `apps/pos-web/src/i18n/catalog.vi.ts` — **sole owner**: apply the glossary to existing values (≈ 255 "thợ", nav/actions/
  booking/queue/checkout deviations listed in the status file §28–§34; fix fragment entries like `pos.tax` → standalone
  labels in `ns/glossary`).
- `apps/pos-web/src/i18n/ns/glossary.{en,vi}.ts`, `ns/status.{en,vi}.ts` (canonical enums: ticket, appointment, queue item,
  payment/tender, terminal, payroll exception, AI reason, audit action), `ns/errors.{en,vi}.ts` (**all 187**
  `ERROR_REGISTRY` codes, EN = registry message).
- `apps/pos-web/src/i18n/status-label.ts`, `apps/pos-web/src/i18n/error-text.ts` (fill the stubs).
- `apps/pos-web/src/api/client.ts` — `PosHttpError` carries `code`; displayed message = `errorText(code, details,
  body.message)`; the two fallbacks at :100/:111 become keys.
- `apps/pos-web/src/i18n/server-labels.ts` — shrink as server labels gain codes (keep as bridge).
- `tooling/ci/check-vi-glossary.mjs` (new; registered by WP-K) — fails on forbidden VI variants in any POS catalogue.
- Tests: `apps/pos-web/src/i18n/error-text.test.ts` (every registry code has EN+VI; unknown code → server message; VI for
  `APPOINTMENT_CONFLICT` = mandate text), `status-label.test.ts` (unknown code → humanized canonical, never blank/raw key),
  `glossary.test.ts` (each glossary entry resolves to the approved VI).
- External: native Vietnamese salon-operations review of `VI_GLOSSARY.md` + the diff of `catalog.vi.ts` (§36,
  BLOCKED_EXTERNAL) — ship with the mandate defaults, review after.
- Effort: **2 agent-days** (+ external review).

### WP-D2 — Checkout, payments and UNKNOWN-payment safety strings (Phase 1)
Closes §34 (screens), §35, §75 (strings part), §105/§108 (state shape), part of §25/§62 for payment files.
- Owned files: `screens/POSCheckoutScreen.tsx` (status chips :289, ATT_TONE keys :292 — keep English keys as **codes**,
  translate only labels; verify results :363-369; `note`/`verifyFor` banner state → `{key, vars}`), `POSSplitPaymentsScreen.tsx`,
  `POSCashDrawerScreen.tsx`, `POSCashHandoffScreen.tsx`, `POSDepositRecon*.tsx`, `POSPaymentTerminalsScreen.tsx`,
  `POSPaymentsOverviewScreen.tsx`; `components/CheckoutTicketInner.tsx` (:93-97), `CheckoutDealsPanel.tsx`,
  `SkipLineDrawer.tsx`, `TapToPayDevicesPanel.tsx`, `PaymentGatewayStatusCard.tsx`.
- `apps/pos-web/src/i18n/ns/payment.{en,vi}.ts` — the exact §35 text:
  EN "Payment status is uncertain. / Do not pay again. / Verify the transaction first." —
  VI "Trạng thái thanh toán chưa xác định. / Không thanh toán lại. / Hãy kiểm tra giao dịch trước."; §34 labels incl.
  Balance Due, Payment Complete, Payment Declined, Verify Payment.
- Selected ticket survives the switch already once WP-B lands (state is kept); additionally put `selId` in the URL
  (`?ticket=`) so a crash/reload also restores it (§105).
- Tests: `screens/POSCheckoutScreen.unknown-language.test.tsx` — UNKNOWN banner shown; switch EN→VI→EN: banner text changes
  language, `verifyFor` stays, tender buttons stay disabled, Verify stays enabled, **0** extra `pay`/`verify` API calls
  (spy), amount/balance unchanged (§108); `CheckoutTicketInner.vi.test.tsx` totals labels in VI.
- Effort: **1.5 agent-days.**

### WP-E — Accent-insensitive Vietnamese search + IME (Phase 1)
Closes §40, §41, §42 (kept), §110 (enables).
- `apps/api/db/migrations/694_vi_search_fold.sql` — `CREATE FUNCTION vi_fold(text) RETURNS text IMMUTABLE` =
  `lower(translate(…))` mapping every Vietnamese vowel with tone/hat to its base letter **and `đ/Đ → d`** (NFD/`unaccent`
  alone leave "đ"; `unaccent()` is not IMMUTABLE so it cannot back an index); generated columns
  `customers.full_name_fold`, `technicians.full_name_fold`, `services.name_fold` (+ products) `GENERATED ALWAYS AS
  (vi_fold(...)) STORED`; trigram GIN indexes on them. Stored names are never changed (§42).
- `apps/api/src/pos/pos-search.kysely.repository.ts:39-73`, the customer list search in
  `modules/customers/src/customers/customers.kysely.repository.ts`, the technician and service list searches (their
  kysely repositories in `modules/workforce/src` and `modules/catalog/src`) — match `*_fold ILIKE vi_fold(:q)` OR the raw
  column (so exact-accent queries still rank first).
- `packages/api-contracts/src/text/vi-fold.ts` (+ export in `packages/api-contracts/src/index.ts`, WP-E sole owner) — the
  same fold in TS for client filters; property test: `foldVi(s) === SQL vi_fold(s)` over the §38 alphabet.
- `apps/pos-web/src/components/ImeSafeInput.tsx` — fires `onChange`/search only when `!e.nativeEvent.isComposing`,
  commits on `compositionend`; `apps/pos-web/src/shell/TopSearch.tsx` adopts it (screen fields adopted by C-groups).
- Tests: `apps/api/src/pos/vi-search.pgtest.vitest.spec.ts` (PGlite, all migrations: "nguyen" finds "Nguyễn Thị Hương",
  "dang" finds "Đặng Minh Tuấn", stored value byte-identical, tenant isolation kept); `vi-fold.test.ts`;
  `components/ImeSafeInput.test.tsx` (composition events: no search mid-composition, one on end).
- Risk: generated-column + index build on large `customers` — run the index `CONCURRENTLY` if the migration runner allows a
  non-transactional step, else schedule in a quiet window.
- Effort: **1.5 agent-days.**

### WP-F — Platform announcement EN / VI variants (Phase 1)
Closes §56, §57.
- `apps/api/db/migrations/695_platform_notice_vietnamese.sql` — `platform_notices.title_vi`, `body_vi` (nullable, same
  length/sanitize limits as EN), `vi_reviewed_by`, `vi_reviewed_at`; add to `platform_notice_revisions`.
- `modules/communications/src/platform-announcements/platform-notice-core.ts` (sanitize both; **critical types
  `maintenance`/`warning`/`urgent` with a VI body require `vi_reviewed_*`** or an explicit "English only" flag — no runtime
  machine translation), `platform-notice.service.ts`, `platform-notice-admin.queries.ts`, `platform-notice.controller.ts`.
- `packages/api-contracts/src/platform/platform-announcements.ts`, `packages/api-contracts/src/tenant/platform-announcements.ts`.
- `apps/admin-web/src/screens/PlatformAnnouncementsScreen.tsx` (+ test), `apps/admin-web/src/api/superAdminPlatformAnnouncementsApi.ts`
  — English UI with "Vietnamese title / message (optional)" and "Vietnamese reviewed" checkbox.
- `apps/pos-web/src/shell/PlatformAnnouncementBar.tsx` (+ test; also its 5 module-level `t()`), `apps/pos-web/src/api/posPlatformAnnouncementsApi.ts`
  — show VI when language = vi and VI present, else EN; switch re-renders without refetch.
- Tests: extend `platform-notice.pgtest.vitest.spec.ts` (VI stored/sanitized, critical-without-review refused, POS snapshot
  carries both), `platform-notice-core.vitest.spec.ts`, `PlatformAnnouncementBar.test.tsx` (vi → VI body; vi + no VI → EN;
  switch flips without a network call), `PlatformAnnouncementsScreen.test.tsx`.
- Effort: **1 agent-day.**

### WP-I — Customer communication language (Phase 1)
Closes §54, §55, §118, §119.
- `apps/api/db/migrations/697_customer_language_normalize.sql` — map `customers.preferred_language` free text ("Vietnamese",
  "Tiếng Việt", "vi-VN" → `vi`; English variants → `en`; else NULL), then `CHECK (preferred_language IS NULL OR IN ('en','vi'))`
  `NOT VALID` + `VALIDATE`.
- `modules/customers/src/request-schemas.ts`, `modules/customers/src/customers/customers.dto.ts` — enum en/vi.
- Template variants `<template>.en` / `<template>.vi` in `modules/communications/src/reminders/*` and the confirmation /
  wait-alert / review-request senders in `packages/notifications/src/*`; language = customer preference ?? salon
  customer-communication default (new setting key in `tenant_checkin_settings` next to `display_languages`) ?? en — never
  the employee's POS language. Receipt delivery (SMS/email) uses the same resolver.
- Tests: resolver unit test (Vietnamese receptionist, English customer → EN SMS), pgtest for the normalization.
- Effort: **1.5 agent-days.** (Can slip to after the POS DoD; it is customer-facing, not POS UI.)

### WP-K — Gates and scanners (Phase 1)
Closes §24, §99, §123; registers WP-D1's glossary gate and WP-G's admin gate.
- `tooling/i18n/pos-strings.mjs` — tier 4: string values of `Record<string,string>` label maps and tuple arrays that are
  rendered, first args of local helpers whose result lands in JSX (`line('Tax', …)`, `chip('VIP', …)`), and
  `.replace(/_/g,' ')` enum renderers (report as `kind: 'enum'`); module-level `t()` calls (`kind: 'module'`).
- `tooling/ci/check-pos-i18n.mjs` — fail on the new kinds with a **ratchet** (baseline file
  `tooling/i18n/pos-i18n-baseline.json`, may only go down → 0); report unused keys (literal + known dynamic prefixes) and
  duplicate EN values per namespace (warn).
- `tooling/ci/check-i18n.mjs` — include `apps/pos-web/src/i18n/ns/*.{en,vi}.ts` in `SOURCES`.
- `tooling/ci/check-admin-english-only.mjs` (new) — admin-web must not import `@aipowersalon/mobile-sdk/i18n`, must not
  contain a language switch, `index.html` `lang="en"`.
- `tooling/ci/run-gates.mjs` — register `pos-i18n` (extended), `vi-glossary`, `admin-english-only` (sole owner).
- `tooling/i18n/pos-codemod.mjs` — add a header refusing `--write` (catalogue frozen; new keys go to `ns/`).
- Tests: fixtures under `tooling/i18n/__fixtures__/` + `tooling/i18n/pos-strings.test.mjs` proving each new kind is caught
  (the Overview Quick Actions tuple, the Checkout status map, `line('Tax')`).
- Effort: **1 agent-day.**

### WP-G — Certification tests: one-screen EN/VI, busy, 200-tech, preservation, Unicode (Phase 2)
Closes §38, §39, §66–§80, §101–§103, §104–§115, §109–§113, §114. New files only, except the one call line in the pilot.
- `tooling/e2e/pos-vi-one-screen.mjs` (new; same harness style as `tooling/e2e/ui-sweep.mjs` /
  `pos-announcement-layout.mjs`) — for the 9 primary routes (`/overview`, `/live-operations`, `/check-in`, `/booking`,
  `/tech-queue`, `/queue`, `/serving`, `/service-done`, `/checkout`) × {en, vi} × {empty, busy seed} at **1920×1080**
  (required) and 2560×1440 / 1600×900 / 1366×768 (report): `document.scrollingElement.scrollHeight ≤ innerHeight` and
  `scrollWidth ≤ innerWidth` on the main page, no element text overflow (`scrollWidth > clientWidth` without ellipsis) in
  KPI cards/buttons/pills, every primary button ≥ 44×44 (40 for topbar icons), screenshots EN+VI → the §126 G matrix.
  Busy seed: 30 waiting guests, 25 serving, 12 ready for checkout, an UNKNOWN card payment, Vietnamese names
  ("Nguyễn Thị Hương", "Trần Mỹ Linh", note "Khách muốn sơn màu đỏ và thêm thiết kế hoa.").
- `apps/api/scripts/lib/pilot-vietnamese.mjs` (new) + one call in `apps/api/scripts/live-pilot-day.mjs` — 200-technician salon
  in VI: Booking board 17 pages, Tech Queue, Customer Queue, Serving, Service Done, Checkout (§113); repeated EN↔VI switch
  ×20 on Booking: `window.__apsSync` listener counts and SSE `EventSource` count constant, heap delta bounded, switch-to-paint
  time p95 recorded (§114, §115).
- `apps/pos-web/src/i18n/switch-preserves-state.test.tsx` (new, RTL + mocked API) — Booking date/tech page/service filter
  (§106), Customer Queue selected Visit + order (§107), Serving selection, Checkout ticket/amount/balance (§105); asserts
  no refetch storm (API spy counts unchanged by the switch).
- `apps/pos-web/src/realtime/language-switch-subscriptions.test.tsx` (new) — EN→VI→EN→VI: `REALTIME_EVENT` listener count and
  `ensureRealtimeConnected` calls unchanged (§115).
- `apps/api/src/common/vietnamese-unicode.pgtest.vitest.spec.ts` (new) — create/edit/read customer, technician, note with
  the §39/§109 strings; byte-identical round trip; realtime projection payload keeps them (§39, §109).
- `apps/admin-web/src/english-only.test.tsx` (new) — tenant default vi in fixtures → every admin route renders with no
  Vietnamese diacritics and `lang="en"` (§103).
- Integration (§102): `tooling/e2e/pos-language-persistence.mjs` (new) — login with salon default vi → VI; user switches to
  en → refresh → en; logout/login → en; second user still vi; owner changes default → new user inherits.
- External: sign-off on a **real 27-inch 1920×1080 touchscreen** with browser chrome + Windows taskbar visible is
  BLOCKED_EXTERNAL (Kevin's hardware); the emulated run above is the gate.
- Prerequisite: a local PostgreSQL with seed credentials (the Oct 26 announcement audit could not log in to `psql` in this
  sandbox) and built `apps/api` + `apps/pos-web`.
- Effort: **2.5–3 agent-days.**

### WP-H — Optional bilingual service / product names (Phase 2, needs Kevin's go-ahead)
Closes §50, §52, §53 (§51 already holds).
- `apps/api/db/migrations/696_catalog_translations.sql` — `service_translations(service_id, tenant_id, locale CHECK en/vi,
  name, description, PK(service_id, locale))`, same for products/categories, RLS like `services`.
- Catalog repositories/DTOs in `modules/catalog/src` (+ contracts) — read `name_vi ?? name`; `apps/pos-web/src/components/CatalogTranslationsEditor.tsx`
  (new); one mount line each in `POSServicesScreen.tsx` / `POSProductsScreen.tsx` **after WP-C2 merges**.
- Tests: pgtest fallback (no VI → EN name, item never hidden), one service id per item.
- Effort: **1.5 agent-days.**

### WP-J — Report, handoff, merge bookkeeping (Phase 2, last)
Closes §1 (classification recorded), §125, §126, §127.
- `docs/VIETNAMESE_POS_FINAL_REPORT.md` — sections A–L of §126 with real numbers from WP-G/WP-K runs.
- `docs/handoff/PROJECT_HANDOFF.md` — "Localization" section (architecture, Super Admin English-only, default vs user
  order, `ns/` convention, frozen generated catalogue, glossary + review, gates, migrations 693–697, tests, remaining gaps).
- `apps/api/openapi/manifest.txt` — regenerate once for WP-A / WP-F routes; confirm migration numbers.
- Refresh `docs/mandates/status/VIETNAMESE_POS_STATUS.md`.
- Effort: **0.5 agent-day.**

## 4. Section → work package map (every PARTIAL / NOT DONE row)

| WP | Mandate sections |
|---|---|
| WP-B | 5, 6, 7, 8 (client), 18, 43, 47 (helper), 65, 81, 100, 104, 115 (mechanism), 116 |
| WP-A | 8 (server), 13-conflict, 93, 102 (server) |
| WP-C1–C4 | 2, 25, 27, 38 (surfaces), 47 (adoption), 58, 59, 60, 61, 62 (adoption), 63, 64, 76, 77, 78, 120 |
| WP-D1 | 19, 21, 22, 28, 29, 30, 31-34 (terms), 36 (review packet), 37, 62 (helper), 122 |
| WP-D2 | 34 (screens), 35, 105, 108 |
| WP-E | 40, 41, 110 (enables) |
| WP-F | 56, 57 |
| WP-I | 54, 55, 118, 119 |
| WP-K | 24, 99, 123 |
| WP-G | 38, 39, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 79, 80, 101, 102, 103, 106, 107, 109, 110, 111, 112, 113, 114, 115 |
| WP-H | 50, 52, 53 |
| WP-J | 1, 125, 126, 127 |
| External | 36 (native reviewer), real 27" hardware sign-off for 66–75 |

Effort total ≈ **20–23 agent-days**; with Phase 1 run as 11 parallel agents, wall-clock ≈ **5–6 days** (Phase 0 ≈ 1 d,
Phase 1 ≈ 2–2.5 d, Phase 2 ≈ 2–3 d).

## 5. Conflicts with existing decisions (defaults chosen; Kevin may overrule)

1. **Reload/remount on switch** (Oct 21 decision) → removed (mandate §6/§116 wins).
2. **Glossary**: existing "thợ" / "Check-in" / "Dịch vụ xong" vs mandate "Kỹ thuật viên" / "Tiếp nhận khách" / "Hoàn tất
   dịch vụ" → mandate default; "thợ" only if Kevin explicitly approves it for the POS audience (§30 allows that).
3. **Tenant language authority**: `tenant_settings.defaultLanguage` stays; `tenants.locale` (207) and the platform
   `localization.default_language = 'en-US'` stop driving any tenant/POS display.
4. **Browser-language layer** removed for the POS only; the four mobile apps keep their order.
5. **Keys**: generated English-slug keys frozen, not re-keyed; all new keys semantic in `ns/`.
6. Super Admin stays English; it gains exactly two tenant-language features (default POS language control, VI announcement
   fields) — both in English UI.

## 6. Biggest risks

1. **Stale text after an instant switch** — module-level constants, `useMemo`, and translated text stored in state will
   silently stay in the old language; the WP-K ratchet (module-level) and the "store `{key, vars}`" rule are the guards.
2. **Payment safety** — the Verify results and parts of the UNKNOWN flow are English today; any refactor of
   `POSCheckoutScreen.tsx` must keep `verifyFor`/tender blocking intact (WP-D2 test asserts 0 extra pay/verify calls).
3. **Vietnamese length on dense one-screen layouts** (Overview, Checkout, Booking at 1920×1080) may need layout work, not
   only strings; fonts/targets must not shrink.
4. **Glossary churn** — ~300 VI values change; needs a native reviewer (external) and Kevin's ruling on "thợ".
5. **Search migration** on large tables (generated columns + GIN) — lock/time on production-sized data.
6. **Browser certification infrastructure** — needs local PostgreSQL + built apps; not runnable in every sandbox.
7. **Merge collisions** — migration numbers, `openapi/manifest.txt`, `run-gates.mjs`, `catalog.vi.ts`: single owners above.
8. **Shared runtime** — `packages/mobile-sdk/src/i18n/i18n.ts` is used by four mobile apps; WP-B changes must be additive.

## Kevin's rulings (Oct 26 2026)
- **Technician term:** keep **"Thợ"** in the Vietnamese POS. The glossary (WP-D1) records "Thợ" as the canonical term for
  technician; the mandate's "Kỹ thuật viên" is NOT applied. Other glossary entries follow the mandate.
- **Bilingual service / product names (WP-H): not now.** One name per service / product, as the salon types it. WP-H is
  dropped from this build; the related mandate sections stay PARTIAL with this decision recorded.
- **Native review:** Kevin is a native Vietnamese speaker; on Oct 26 2026 he reviewed the existing Vietnamese translations and approved them. New Vietnamese strings from this build are collected into one review list (WP-J) for his sign-off.
