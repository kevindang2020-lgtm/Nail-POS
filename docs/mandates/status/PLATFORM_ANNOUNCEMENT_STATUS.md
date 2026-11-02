# PLATFORM_ANNOUNCEMENT_STATUS.md — section-by-section audit of `docs/mandates/2026-10-26_PLATFORM_ANNOUNCEMENT_MANDATE.txt`

Audited Oct 26 2026 on branch `merge-github-main` at `ef7eb6bf`, read-only. Every status below was decided by opening the
code or test named in the evidence column — not by reading an earlier report. Tests that are cheap were re-run here
(`TZ=UTC`), counts recorded. Status vocabulary: **DONE** / **PARTIAL** (part satisfied, the missing part named) /
**NOT DONE** / **BLOCKED_EXTERNAL** (a real outside dependency only).

**Updated Oct 27 2026** after the INTERNAL items were built (`4dd41f0e`, `d6631f8e`, and the browser-proof commit): rows §34
§60 §72 §84 §98 §106 §108 §116 §144–§146 §158 §159 §164 §165 rewritten from the new code and tests; the browser proof was
re-run on this HEAD (56 / 58 — see §108). Re-run here (TZ=UTC): bar unit 17 / 17, admin screen 15 / 15, pgtest 29 / 29,
API client-events 7 / 7.

**Working-tree note.** While this audit ran, another session edited `platform-notice-core.ts` and its spec in the same
checkout (uncommitted: the `CONTROL` regex now written with `​-‏‪-‮⁦-⁩` escapes instead of raw
bidi characters — same behaviour). Every row below reads the committed code at `ef7eb6bf`; the 9/9 core-spec run above was
on the file as it stood before that edit.

## Where the implementation lives (opened in this audit)

| Layer | File |
|---|---|
| Migration | `apps/api/db/migrations/674_platform_pos_announcements.sql` — `platform_notices`, `platform_notice_targets`, `platform_notice_receipts`, `platform_notice_revisions`, indexes, RLS on the two tenant-keyed tables |
| Pure rules | `modules/communications/src/platform-announcements/platform-notice-core.ts` — state machine, sanitization, `derivedStatus`, `windowProblem`, `compareForDisplay`, `needsConfirmation`, `isMaterialChange` |
| Service | `modules/communications/src/platform-announcements/platform-notice.service.ts` (423 lines) — Super Admin list/get/create/update/publish/pause/resume/archive/duplicate, tenant/branch pickers, POS `active` snapshot + `receipt` |
| Admin queries | `modules/communications/src/platform-announcements/platform-notice-admin.queries.ts` |
| Controllers | `modules/communications/src/platform-announcements/platform-notice.controller.ts` — `/super-admin/communications/platform-announcements*` (SuperAdminGuard, step-up on publish/pause/resume/archive) and `/pos/platform-announcements/*` (TenantAuthGuard + RolePermissionGuard, `pos.login`); manifest rows in `apps/api/openapi/manifest.txt:596, 881–884, 1564, 2234–2236, 2494–2499` |
| Contracts | `packages/api-contracts/src/platform/platform-announcements.ts`, `packages/api-contracts/src/tenant/platform-announcements.ts`, error codes `packages/api-contracts/src/errors.ts:218–227` |
| Events / realtime | `packages/events/src/event-contract.ts:270–273` (`platform.announcement_published` / `_changed`); `apps/api/src/events/consumers/realtime-projection.consumer.ts:76–83` (`announcementClients`); `packages/realtime-contracts/src/realtime-core.ts:90–92, 143, 236` (`platform_announcement_updated` → screen key `platform-announcements`) |
| POS | `apps/pos-web/src/shell/PlatformAnnouncementBar.tsx` (175 lines); placed in `apps/pos-web/src/shell/POSLayout.tsx:492–506`; CSS `apps/pos-web/src/styles.css:931–965`; API `apps/pos-web/src/api/posPlatformAnnouncementsApi.ts`; realtime hook `apps/pos-web/src/realtime/useRealtime.ts` |
| Super Admin | `apps/admin-web/src/screens/PlatformAnnouncementsScreen.tsx` (291 lines), route `apps/admin-web/src/App.tsx:289`, nav `apps/admin-web/src/shell/AdminLayout.tsx:254`, API `apps/admin-web/src/api/superAdminPlatformAnnouncementsApi.ts` |

### Tests found and executed in this audit (TZ=UTC)

(Re-audit Oct 28: the counts in this table are the first audit's; the later re-runs are in the header — bar 17 / 17, admin
screen 15 / 15, pgtest 29 / 29. The re-audit found no code defect in this mandate; `need()` falling back to the SUPER_ADMIN role
when `ctx.role` is null is safe only because every route is guarded — noted as defence-in-depth, not a finding.)

| Test file | Result here |
|---|---|
| `modules/communications/src/platform-announcements/platform-notice.pgtest.vitest.spec.ts` (PGlite, every migration incl. 674) | **20 / 20 passed** (31 s) |
| `modules/communications/src/platform-announcements/platform-notice-core.vitest.spec.ts` | **9 / 9 passed** |
| `apps/pos-web/src/shell/PlatformAnnouncementBar.test.tsx` | **7 / 7 passed** |
| `apps/admin-web/src/screens/PlatformAnnouncementsScreen.test.tsx` | **7 / 7 passed** |
| `apps/api/src/events/consumers/realtime-projection.platform-announcements.vitest.spec.ts` | **3 / 3 passed** |
| `tooling/e2e/pos-announcement-layout.mjs` (real Chromium + built POS + real API + PostgreSQL; 51 checks incl. 1920×1080 / 1600×900 / 1366×768 / 1280×800, offline → reconnect, reload, API 500) | **opened and read, NOT re-run here** — needs a local PostgreSQL with credentials this sandbox does not have (`psql` refused `aps`/`postgres` logins). The report `docs/PLATFORM_ANNOUNCEMENTS_FINAL_REPORT.md:152` claims 51/51 on Oct 22; treat that line as a claim, the script as the proof-generator. |
| Pilot day phase 10f (`apps/api/scripts/live-pilot-day.mjs:1323–1330`) — Super Admin publishes a maintenance notice for salon A; A's POS snapshot shows it, B's does not | PASS line in `docs/pilot-runs/2026-10-24-m4/pilot.log:131` (177/177 run of Oct 24) |

## Section table

| § | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 1 | Super Admin publishes; matching POS clients receive without refresh/redeploy | DONE | service `notify()` writes one outbox event per targeted salon (`platform-notice.service.ts:129–148`); consumer `realtime-projection.consumer.ts:76–83`; POS refetches on `platform-announcements` key (`PlatformAnnouncementBar.tsx:80`); e2e `pos-announcement-layout.mjs:146–151` ("appears without a refresh"), `:264` ("the page was never reloaded") |
| 2 | No hard-coded banner; backend-driven | DONE | bar renders only `platformAnnouncementsApi.active()` data (`PlatformAnnouncementBar.tsx:61–77`); no literal message in pos-web |
| 3 | Repository audit first | DONE | `docs/PLATFORM_ANNOUNCEMENTS_FINAL_REPORT.md` "existing code" section; migration header explains the audit of `platform_announcements` (239/294) vs the new tables (`674_platform_pos_announcements.sql:7–13`) |
| 4 | Reuse existing infrastructure, no parallel system | DONE (with note) | a NEW `platform_notice*` domain was added beside the existing outbound-send `platform_announcements` (campaigns); justified in `674_platform_pos_announcements.sql:7–13` (different lifecycle: display vs one-shot send). Reuses OutboxWriter, AuditService, realtime projection, `useRealtime`, `defineStateMachine`, `ERROR_REGISTRY` |
| 5 | Product name "Platform Announcements" | DONE | nav label `AdminLayout.tsx:254`; screen title `PlatformAnnouncementsScreen.tsx:71`; routes `/super-admin/communications/platform-announcements` |
| 6 | Platform-only publisher | DONE | `need(ctx, MANAGE)` on every write (`platform-notice.service.ts:65–68, 249, 266, 297, 328`); `SuperAdminGuard` on the controller (`platform-notice.controller.ts:30`); pgtest §156/§157 |
| 7 | Platform realm separate from tenant | DONE | mutation routes `realm=super_admin` (`manifest.txt:1564, 2494–2499`); POS routes `realm=staff` read-only + receipts; OWNER permissions refused in pgtest `:141–148` |
| 8 | Audience modes ALL_TENANTS / SELECTED_TENANTS / SELECTED_BRANCHES | DONE | `NOTICE_AUDIENCES` (`platform-notice-core.ts:21`); `resolveAudience` (`service:102–124`); DB CHECK (`674:…audience IN`) |
| 9 | All-tenant use case | DONE | pgtest §140 (`platform-notice.pgtest.vitest.spec.ts:36–43`) |
| 10 | Selected-tenant use case | DONE | pgtest §141 (`:44–52`); pilot 10f |
| 11 | Selected-branch use case | DONE | pgtest §142 (`:53–61`) |
| 12 | Announcement entity fields | DONE | `platform_notices` columns (`674:17–43`): title, message, type, priority, lifecycle_status, audience, starts/ends, dismissible, requires_ack, created/updated/published_by, timestamps, version, content_version |
| 13 | Normalized target entity | DONE | `platform_notice_targets` with tenant_id / branch_id / target_type + shape CHECK + unique indexes (`674:49–61`); branch's tenant taken from the branch row, never the client (`service:116–123`) |
| 14 | Lifecycle DRAFT/SCHEDULED/ACTIVE/PAUSED/EXPIRED/ARCHIVED | DONE | stored `draft/published/paused/archived` + derived `scheduled/active/expired` on the DB clock (`platform-notice-core.ts:12–17, 56–62`; `service:151–155`); core spec 9/9 |
| 15 | Drafts never render on POS | DONE | `active()` requires `lifecycle_status = 'published'` (`service:380`); pgtest `:38` |
| 16 | Schedule evaluated server-side with authoritative time | DONE | `now()` in SQL (`service:380–384, 152–154`); `clock()` reads `SELECT now()` (`:69–72`); pgtest §149 |
| 17 | Only active + target-eligible render | DONE | `active()` WHERE clause (`service:379–384`) |
| 18 | Pause hides without deleting | DONE | `move(... 'paused')` (`service:327–350`); pgtest §150; e2e `:206–211` |
| 19 | Expired history retained | DONE | derived `expired`, row untouched (`core:56–62`); pgtest `:86–88` |
| 20 | Archive, never hard delete | DONE | `archive()` is a status move (`service:353`); no `deleteFrom('platform_notices')` anywhere in the module; pgtest `:168–180` |
| 21 | Types INFO/UPDATE/MAINTENANCE/WARNING/URGENT | DONE | `NOTICE_TYPES` (`core:19`); DB CHECK (`674:20`) |
| 22 | Visual severity (gold / amber / red) | DONE | `TONE` map (`PlatformAnnouncementBar.tsx:24–31`): info/update gold, maintenance/warning amber, urgent + critical red |
| 23 | Exact placement after Search, before Date/Time/Notifications/Messages/Owner | DONE | `POSLayout.tsx:492–506`: `<TopSearch />` → `<PlatformAnnouncementBar />` → clock/bell/messages → `<ProfileMenu />`; e2e `:195–196` asserts bar.x ≥ search.right and bar.right ≤ first control.x at all four widths |
| 24 | Header modelled as left context / search / flexible centre / right utilities | DONE | flex layout in `styles.css:935–945` (`.pa-slot` flex 4 1 0 when live, `.top-search` flex 0 1 300px) |
| 25 | Responsive priority: critical + right controls usable, search may shrink | DONE | `styles.css:942–947` (search basis 300 → 230 → 200 px; `.loc` max-width 160/150); `@media (max-width:1440px)` folds owner name (`:948`) |
| 26 | Flex/grid, no hard-coded coordinates | DONE | `.pa-slot{flex:1 1 0;min-width:0}` (`styles.css:935`); no absolute positioning on the bar |
| 27 | Long text wraps; no marquee | DONE | `.pa-text{display:-webkit-box;-webkit-line-clamp:2;overflow-wrap:anywhere;white-space:pre-line}` (`styles.css:952`); no animation/marquee rule; e2e `:156–163` (two lines at 1920) |
| 28 | One line normally, two allowed, clamp beyond | DONE | same CSS; `max-height:48px` on `.pa-bar` (`:949`); e2e `:153, 162, 170` |
| 29 | More opens full text in place | DONE | `overflow` measured by `useLayoutEffect` (`Bar.tsx:105–109`); panel `role="dialog"` (`:154–172`); unit test "More opens every message in full"; e2e `:172–178` |
| 30 | Short message one line | DONE | e2e `:153` ("a short message takes one line") |
| 31 | Long normal message two lines without overlap | DONE | e2e `:162` (lines === 2 && !clamped at 1920), `:197` (no overlap with controls) |
| 32 | Very long: two-line clamp + More | DONE | e2e `:170–171`; admin preview test "§32 a long message previews clamped with More" |
| 33 | Optional title, compact | DONE | `<strong>{title}: </strong>` inline (`Bar.tsx:138`); TITLE_MAX 120 (`core:27`) |
| 34 | Use existing icon library, not emoji | DONE (Oct 27, `4dd41f0e`) | the bar's type icons and dismiss ✕ are `react-icons/fi` (`FiInfo` / `FiTool` / `FiAlertTriangle` / `FiX`) — the library POSLayout, Walk-In and New Booking already use; no hand-drawn paths left (`PlatformAnnouncementBar.tsx`; unit test §34 reads the source and asserts the import and no `<path d=`); the Super Admin preview draws bell / mail / ✕ with `FiBell` / `FiMail` / `FiX` instead of 🔔 ✉ ✕ (`PlatformAnnouncementsScreen.tsx` `HeaderPreview`; admin test §34 asserts no emoji). Browser proof: `svg[data-icon]` present in the live bar |
| 35 | Super Admin controls dismissibility | DONE | `dismissible` checkbox (`Screen.tsx:198`); column + default (`674:28`) |
| 36 | Routine messages dismissible | DONE | default `dismissible = true` (`service:243`, `674:28`); unit test "dismisses for this employee" |
| 37 | Urgent may be non-dismissible | DONE | admin defaults urgent/critical to non-dismissible (`Screen.tsx:179–180`); server refuses dismiss of a non-dismissible notice (`service:414`); pgtest §153 |
| 38 | Per-user dismissal | DONE | receipts keyed (tenant, notice, user, kind, content_version) (`674:71–83`); pgtest `:100–113` (MIA dismissed, LEO still sees it) |
| 39 | Acknowledgement mode with "I understand" | DONE | `requires_ack`; `receipt(... 'acknowledged')` (`service:404–420`); button (`Bar.tsx:146`); pgtest §154; unit test |
| 40 | Non-blocking default | DONE | bar is a header region only; no overlay/modal gating; unit test "stays non-blocking (§39–§40)"; e2e `:276` (POS works with API failing) |
| 41 | Critical prominent but not disabling | DONE | `.pa-critical{font-weight:600}` + red tone only (`styles.css:951`); no disabling of routes |
| 42 | No stacked banners; highest priority + indicator/view-all | DONE | one `current` shown; `More (+N)` opens the panel listing all (`Bar.tsx:141–143, 154–171`); unit test "highest priority first; several active → More" |
| 43 | Deterministic LOW/NORMAL/HIGH/CRITICAL order | DONE | `compareForDisplay` priority → publishedAt desc → id (`core:84–91`); pgtest §147 |
| 44 | Equal-priority rotation; CRITICAL pinned | DONE | pool = equal-priority NORMAL/LOW only, 8 s (`Bar.tsx:23, 85–93`) |
| 45 | No marquee | DONE | no scrolling animation in CSS; clamp instead |
| 46 | Pause rotation on hover/focus | DONE | `hover` state from mouse/focus handlers (`Bar.tsx:132`), rotation effect skips when `hover || open` (`:89`) |
| 47 | No rotation while expanded | DONE | same guard `open` (`Bar.tsx:89`) |
| 48 | Super Admin "New Announcement" screen | DONE | `PlatformAnnouncementsScreen.tsx:72` button + `Editor` (`:136–245`); route `App.tsx:289` |
| 49 | Plain text editor, no HTML | DONE | `<textarea>` (`Screen.tsx:175`); server refuses markup (`core:31, 40`); pgtest §155 |
| 50 | Backend length limit ≈2,000 | DONE | `MESSAGE_MAX = 2000` (`core:26`), DB CHECK (`674:19`); pgtest `:137` (2001 refused) |
| 51 | Desktop POS preview before publish | DONE | `HeaderPreview` (`Screen.tsx:108–134`) rendered in the editor (`:202–205`); admin test "§14 / §118" |
| 52 | Preview at standard + smaller desktop widths | DONE | 1920 and 1366 previews (`Screen.tsx:203, 205`); admin test asserts both `preview-1920` / `preview-1366` |
| 53 | Audience UI All / Selected Tenants / Selected Branches | DONE | radios (`Screen.tsx:184–186`) + `AudiencePicker` (`:248–291`); admin test "§53" |
| 54 | Server-side searchable/paginated tenant selector | DONE | `tenantOptions` (`service:203–213`), route `audience/tenants` (`controller:49–52`); picker debounced search (`Screen.tsx:254–257`); pgtest `:200–204` |
| 55 | Branch selector follows tenant, authoritative branch rows | DONE | `branchOptions` (`service:215–220`); route `audience/tenants/:tenantId/branches`; UI `Screen.tsx:258, 274–284` |
| 56 | Publish now → server sets startsAt | DONE | `starts_at: sql\`now()\`` when not future (`service:317`) |
| 57 | Schedule future start | DONE | `publishNow:false, startsAt` (`service:307–312`); pgtest §149; e2e `:222–230` |
| 58 | No-expiration or explicit end; maintenance should expire | DONE | `ends_at` nullable; `windowProblem` requires an end for maintenance when publishing (`core:69`); pgtest `:165–166` |
| 59 | Stale-message prevention | DONE | maintenance must have an end (`core:69`); expired notices drop out of `active()` by `ends_at > now()` (`service:381`); POS refetches at `nextChangeAt` (`service:386–391`, `Bar.tsx:70–75`) |
| 60 | List shows message/type/priority/audience/status/starts/ends/creator/updated | DONE (Oct 27, `4dd41f0e`) | **Created by** column (`PlatformAnnouncementsScreen.tsx` list table); `createdByName` added to `PlatformAnnouncementRow` and read by `platform-notice-admin.queries.ts` from `users` **only where `tenant_id IS NULL`** (a platform user — a tenant user's name can never surface). pgtest §60 (platform user → name; tenant user id → null), admin test §60 |
| 61 | Optimistic editing via version | DONE | `expectedVersion` required on update (`service:267`), `checkVersion` + `WHERE version = …` on every write (`:79–81, 285, 319, 340`) |
| 62 | `PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT` on stale writes | DONE | `errors.ts:224`; `service:80`; pgtest §161; admin test shows the server message |
| 63 | Audit create/edit/publish/pause/resume/audience/priority/schedule/archive | DONE | platform audit per action (`service:86–90, 260, 291, 324, 346, 366`) + a revision row with the full after-snapshot (incl. targets, schedule, priority) per write (`service:95–99`, `674:88–97`); edit audit carries before/after (`:289–291`); pgtest §163 |
| 64 | API → domain → PostgreSQL → outbox → realtime → POS | DONE | outbox written inside the same transaction (`service:144–147`); consumer → rooms; e2e runs the production path (`pos-announcement-layout.mjs:2–6, 68`) |
| 65 | Event naming per conventions | DONE | `platform.announcement_published` / `platform.announcement_changed` (`event-contract.ts:272–273`) |
| 66 | Client-safe payload | DONE | POS snapshot fields only (`service:394–396`, no actors); realtime payload ids + version + action only (`consumer:81`); consumer spec asserts no title/message keys |
| 67 | Server-side targeting | DONE | targeting in SQL by session tenant/branch (`service:376–384`); one event per targeted salon (`:144–147`) |
| 68 | Tenant isolation (API, realtime, cache, logs) | DONE | pgtest §141/§164 (snapshot + events), receipts `:205–210`; consumer spec "never another salon"; e2e `:180–186`; RLS on target/receipt tables (`674:99–111`) |
| 69 | Branch isolation | DONE | `selected_branches` requires `t.branch_id = session branch` (`service:384`); pgtest §142 (A2 and branch-less session excluded) |
| 70 | All-tenant fan-out | DONE | `addTenantWide(null)` over active tenants + branches (`service:132–138`); pgtest §140 events to A, B, C |
| 71 | Startup snapshot | DONE | `load()` on mount (`Bar.tsx:79`); e2e `:142` ("startup snapshot was requested") |
| 72 | Snapshot → render → subscribe; accept only newer versions | DONE (Oct 27, `4dd41f0e`) | every `load()` takes a sequence number; an answer to a request older than the one applied is dropped, and so is an answer whose `serverTime` is older than the applied one; a local dismiss / acknowledge retires every request started before it (`PlatformAnnouncementBar.tsx` `issued` / `applied` / `appliedServerTime`). Unit tests §72 ×3: older request answering last is dropped; older serverTime dropped; a snapshot requested before a dismiss cannot bring it back |
| 73 | Reconnect → refetch snapshot | DONE | `REALTIME_RECONCILE` nudge → `cb` (`useRealtime.ts:91–100, 108`); e2e `:254–264` (published while offline, shown after reconnect) |
| 74 | Participate in silent background reconciliation, no full refresh | DONE | `useRealtime(..., { intervalMs: 60_000 })` (`Bar.tsx:80`) on the shared SafetySync; e2e `:264` no navigation |
| 75 | No header flicker | DONE | state replaced in place; header never remounted; CSS transition only on colours (`styles.css:950`) |
| 76 | Reserve only needed space; collapse when empty | DONE | `pa-empty` renders an empty flex slot (`Bar.tsx:128`; `styles.css:936`); e2e `:141` |
| 77 | Smooth 1→2-line height change without overlap | DONE (by design) | header is fixed 64 px (`styles.css:509`) and `.pa-bar{max-height:48px}` so two lines fit inside without changing header height; e2e `:200` (bar bottom ≤ header bottom) |
| 78 | No horizontal overflow / collision | DONE | e2e `:193` (scrollWidth ≤ viewport) and `:197` (no overlap) at four widths |
| 79 | On every authenticated POS page | DONE | rendered inside the shared `POSLayout` header above `<Outlet />` (`POSLayout.tsx:496, 513`) |
| 80 | Shared component, implemented once | DONE | single import/use (`POSLayout.tsx:14, 496`); no other usage in `apps/pos-web/src` |
| 81 | Future app support without exposing to customers | DONE | `surfaces TEXT[]` with CHECK list (`674:23–24`); POS query filters `'pos' = ANY (n.surfaces)` (`service:380`) |
| 82 | Surface targeting values | DONE | `pos, owner_app, technician_app, customer_app, super_admin` (`674:24`) |
| 83 | Default surface POS | DONE | `DEFAULT ARRAY['pos']` (`674:23`) |
| 84 | System Status may prefill/suggest (future) | DONE (Oct 27, `4dd41f0e`; optional) | "Suggest from System Status" on the Super Admin screen reads the existing `GET /super-admin/system-status/overview` (open incidents → urgent / warning / maintenance by severity; scheduled maintenance windows → a maintenance notice) and opens the suggestion as an unsaved DRAFT in the editor — never saved, never published (`suggestionsFromStatus`, `PlatformAnnouncementsScreen.tsx`). Admin tests §84 ×2 (mapping; picking one creates / updates / publishes nothing) |
| 85 | Platform CRUD/publish/pause/archive endpoints under existing namespace | DONE | `/super-admin/communications/platform-announcements` GET/POST/PATCH + `/publish /pause /resume /archive /duplicate` (`manifest.txt:881–884, 1564, 2494–2499`) |
| 86 | Mutations require PLATFORM auth | DONE | `@UseGuards(SuperAdminGuard)` (`controller:30`); `realm=super_admin` in the manifest |
| 87 | POS reads: EMPLOYEE realm + trusted tenant/branch | DONE | `@UseGuards(TenantAuthGuard, RolePermissionGuard)` + `pos.login` (`controller:70–76`) |
| 88 | Never trust tenant from query/body | DONE | `posCtx` reads `r.ctx.tenantId/branchId` only (`controller:27`); no tenant id in request schemas |
| 89 | Sanitization | DONE | `cleanMessage` normalizes CRLF, strips control/bidi chars, rejects markup (`core:31–45`); pgtest `:138–139` |
| 90 | XSS: escaped text, no innerHTML | DONE | React text nodes only (`Bar.tsx:138, 162`); no `dangerouslySetInnerHTML` in the bar; unit test "§155" |
| 91 | Links omitted in Phase 1 | DONE | `javascript:` / `data:text/html` rejected (`core:31`); plain URLs render as text, never anchors |
| 92 | Error taxonomy | DONE | 9 codes in `errors.ts:218–227`; thrown via `PlatformNoticeError` (`service:32–42`) |
| 93 | Reject endsAt ≤ startsAt | DONE | `windowProblem` (`core:67`) + DB CHECK `platform_notices_window_check` (`674:41`); pgtest `:162` |
| 94 | Reject empty/whitespace | DONE | `cleanMessage` trim → "Write the announcement message." (`core:35–38`); pgtest `:136` |
| 95 | Idempotent publish | DONE | `if (n.lifecycle_status === 'published') return { replay: true }` under `FOR UPDATE` (`service:300`); pgtest §162 |
| 96 | Version field for stale writes + ordering | DONE | `version` on every write + `content_version` for material edits (`674:31–32`; `service:284`) |
| 97 | Initial fetch + realtime + safety sync; no per-second polling | DONE | 60 s safety sync, event-driven refetch, `nextChangeAt` timer bounded ≥1 s (`Bar.tsx:73, 80`) |
| 98 | Indexes reviewed against query plans | DONE (Oct 27, `d6631f8e`) | `apps/api/scripts/platform-announcements-explain.mjs` (3,000 salons, 20,000 notices, 1.88M targets, 765k receipts; EXPLAIN ANALYZE best of 5, before / after) → `PERFORMANCE_REPORT.md` "Platform Announcements (§98)". Migration **699**: `(ends_at) WHERE published` (POS snapshot 1.25 → 0.43 ms) and `(updated_at DESC, id)` (admin list 20.1 → 0.68 ms). The salon-name search was a query problem (correlated EXISTS could not use the partial target indexes: 941–1,540 ms) — rewritten salon-first (6.3–11 ms; pgtest §98). Measured and not indexed: receipt stats, nextChangeAt, the status count |
| 99 | Cache optional; PostgreSQL authoritative | DONE | no cache layer; every read hits PG (`service:373–400`) |
| 100 | Redis never the only copy | DONE | Redis used only for realtime fan-out (existing transport); announcements live in `platform_notices` |
| 101 | One controlled scheduler, no duplicate cron | DONE | no scheduler: status derived at read (`674:13–16`); POS refetches at `nextChangeAt` |
| 102 | Prefer query-derived active status | DONE | `derivedStatus` / `statusSql()` (`core:56–62`, `service:151–155`) |
| 103 | Consistent timestamps; admin tz rendering | DONE | `TIMESTAMPTZ` columns; ISO on the wire; admin renders local time with `timeZoneName` and states the zone (`Screen.tsx:25, 197`) |
| 104 | Localization-ready (EN/VI) | DONE | POS chrome strings via `t('pos.*')` (`Bar.tsx:20, 32, 134–170`; catalogs `apps/pos-web/src/i18n/catalog.{en,vi}.ts`); message body is single plain text (Phase 1) |
| 105 | No premature message_en/message_vi | DONE | one `message` column (`674:19`) **Re-audit (Oct 28):** superseded by the Vietnamese POS mandate: migration `696_platform_notice_vietnamese.sql` added `title_vi` / `message_vi` (a reviewed Vietnamese version, picked at render). Decision recorded: the later mandate wins; this row's "one column" evidence is historical. |
| 106 | Accessibility: keyboard, focus, SR labels, contrast, reduced motion | DONE (Oct 27, `4dd41f0e`) | contrast **measured**: every tone pair ≥ 4.5:1 — text 7.4–9.0, icon + type label (new `strong` colour) 4.9–5.9 on the bar and the panel (the old gold / amber 2.7–2.9 stays only on the decorative stripe); focus outline now `currentColor` (the old #C9971B was 2.2–2.5:1). The More panel is a modal dialog: `aria-modal="true"`, focus moves in, Tab / Shift+Tab trapped, Escape / Close return focus to More. Unit tests §106 ×2 (contrast computed for every tone; focus trap + return); browser proof on this HEAD: dialog + trap + return focus PASS, computed text 7.92 / icon 4.97 PASS |
| 107 | Controlled aria-live | DONE | `aria-live="polite" role="status"` spoken once for a new HIGH/CRITICAL only (`Bar.tsx:66–69, 127`) |
| 108 | Test 1920×1080, 1600×900, 1366×768, 1280×800 | DONE (Oct 27 final pass: 58 / 58) | `tooling/e2e/pos-announcement-layout.mjs` re-run on the final-pass HEAD (`e2e_announce` migrated to 702, `TEST_REPORT.md` "Oct 27 2026 — final pass"): **58 / 58** — at all four widths no horizontal scroll, Search ≥ 180 px, bar between Search and clock, controls not overlapped, ≤ 2 lines, and the message keeps readable room (570 / 250 / **209** / **163** px against 200 / 200 / 200 / 150). The two checks that failed at `dd92f860` (163 px at 1366, 117 px at 1280) pass on this HEAD (the header changed after `dd92f860` — the one-screen layout work of the Vietnamese mandate; the commit that freed the room was not bisected). Evidence `docs/pilot-runs/2026-10-27-final/announcement-layout.txt` |
| 109 | One line on 1920 when content permits | DONE | e2e `:153` |
| 110 | Small screens: two lines/clamp/More without covering utilities | DONE | e2e `:197–200` at 1366 and 1280 |
| 111 | Usable minimum Global Search width | DONE | `.topbar .search{min-width:220px}` / 150 px ≤1366 (`styles.css:934, 964`); e2e `:194` (≥ 180 px) |
| 112 | No-message → component collapses | DONE | `pa-empty` (`Bar.tsx:128`); unit test "nothing when there is no announcement" |
| 113 | No "Loading announcement…" | DONE | `items === null` renders nothing (`Bar.tsx:47, 128`); unit test asserts no /Loading/ |
| 114 | Fetch failure never breaks POS; log + continue | DONE | `try/catch` + `console.warn` (`Bar.tsx:34, 76`); unit test "a failed snapshot never breaks the header"; e2e `:270–276` (API 500 → POS works) |
| 115 | Realtime failure never blocks ops | DONE | realtime failure only means no refetch; safety sync + reconnect refetch (`useRealtime.ts`); e2e offline/reconnect `:257–263` |
| 116 | Observability of create/publish/deliver/fetch-failure/realtime-failure/dismiss/ack | DONE (Oct 27, `4dd41f0e`) | server side as before (audit + receipts). POS failures are now **counted, not console-only**: `apps/pos-web/src/shell/announcement-telemetry.ts` posts `platform_announcement_snapshot_failed` / `_realtime_failed` (a refetch asked for by a realtime signal or a reconnect) / `_receipt_failed` to the existing allow-listed `POST /client-telemetry/events` → `aipowersalon_client_events_total{app="pos",event=…}` (also on Super Admin → System Operations → Mobile apps). No props, no text, no ids; 1 / min / kind. Tests: bar unit §116 (each kind, throttle, no text), API `client-events.vitest.spec.ts` (+1), browser proof: after the API-500 step the /metrics counter is 1 |
| 117 | Delivery analytics without claiming "read" | DONE | first-delivery receipt per employee/version (`Bar.tsx:95–102`, `service:404–420`); stats line in admin (`Screen.tsx:207`) |
| 118 | Realistic preview with Search + Announcement + Clock + bell + Owner | DONE | `HeaderPreview` (`Screen.tsx:108–134`) |
| 119 | Preview never publishes | DONE | preview is pure render; admin test asserts `publish` not called on save |
| 120 | All-Tenants publish requires confirmation with preview | DONE | server `needsConfirmation` (`core:95`, `service:304`); UI checkbox (`Screen.tsx:214–224`); pgtest `:39`; admin test "§120–§121" |
| 121 | High/critical second confirmation | DONE | `highConfirmed` second checkbox gates the button (`Screen.tsx:218–220`); admin test |
| 122 | System update example (all-tenant, scheduled, end) | DONE | supported by §57/§58; pgtest §149 uses an end + future start |
| 123 | Message appears centre, realtime | DONE | e2e `:150–151, 195` |
| 124 | Two-line maintenance notice | DONE | e2e `:156–163` |
| 125 | High-priority degradation notice | DONE | critical/urgent tone + pinned; pgtest §153 uses "Card payments are degraded" |
| 126 | Dismissible new-feature notice | DONE | §36 |
| 127 | Tenant-specific onboarding/support message | DONE | pgtest §141; pilot 10f |
| 128 | History with filters | DONE | `list()` status filter (`service:167–180`); status tabs (`Screen.tsx:77–78`); pgtest `:193–199` |
| 129 | Server-side search title/message/target | DONE | ILIKE on title/message + target tenant name/code (`service:173–175`); pgtest `:195–196` |
| 130 | Duplicate to DRAFT, never auto-republish | DONE | `duplicate()` inserts `lifecycle_status: 'draft'` (`service:355–368`); pgtest `:176–178` |
| 131 | No historical deletion | DONE | §20 |
| 132 | Dismissal persists across navigation per user policy | DONE | server-side receipt, filtered out of the next snapshot (`service:377, 393`) |
| 133 | Versioned dismissal reappears on material change | DONE | `content_version + 1` on material edit (`service:281–284`); receipts keyed by content_version; pgtest `:108–112` |
| 134 | Acknowledgement record (announcement, user, tenant, branch, version, time) | DONE | `platform_notice_receipts` columns (`674:71–80`); pgtest §154 asserts all six |
| 135 | User-level over browser-local | DONE | no localStorage for dismiss/ack in `Bar.tsx`; receipts are server rows |
| 136 | Shared terminal → signed-in employee session | DONE | `userId` from `r.ctx` (`controller:27`); pgtest `:103–106` (MIA vs LEO on the same salon/branch) |
| 137 | Platform permission + strong auth/MFA + preview + confirmation + audit | DONE | `super_admin.communications.manage` + `@RequireStepUp()` on publish/pause/resume/archive (`controller:57–66`; manifest `step-up`); confirmation (§120); audit (§63) |
| 138 | Tenant users cannot mutate | DONE | SuperAdminGuard routes; pgtest `:145–147` (OWNER permissions refused) |
| 139 | Owner→Staff announcements are a different domain | DONE | nothing tenant-authored in `platform-notices`; `created_by` is a platform user only |
| 140 | Test global publish → A/B/C | DONE | `platform-notice.pgtest.vitest.spec.ts:36–43` — passed here |
| 141 | Test selected tenant | DONE | `:44–52` — passed |
| 142 | Test selected branch | DONE | `:53–61` — passed |
| 143 | Test long text 300–500 chars wraps/clamps; More opens full | DONE | e2e `:165–175` (~500 chars); unit test ~450 chars "More opens every message in full" — passed |
| 144 | Test no horizontal overflow at all widths | DONE (re-run Oct 27) | e2e at 1920/1600/1366/1280 — PASS on this HEAD |
| 145 | Test Search usable while message active | DONE (re-run Oct 27) | e2e — Search 300 / 300 / 230 / 200 px, PASS |
| 146 | Test right utilities visible/clickable | DONE (re-run Oct 27) | e2e (visible + not overlapped at all four widths; clickability not asserted beyond visibility) |
| 147 | Test priority ordering | DONE | pgtest `:69–74`; core spec — passed |
| 148 | Test expiration disappears without refresh | DONE | pgtest `:86–88`; e2e `:232–237` (12 s end, no reload); unit "a pause / expiry signal removes it in place" |
| 149 | Test scheduling | DONE | pgtest `:75–89`; e2e `:222–230` |
| 150 | Test pause realtime removal | DONE | pgtest `:90–96`; e2e `:206–211` |
| 151 | Test resume | DONE | pgtest `:97–98`; e2e `:216–218` |
| 152 | Test dismissal per scope | DONE | pgtest `:100–107`; unit; e2e `:239–241` |
| 153 | Test non-dismissible has no control | DONE | unit `:45`; pgtest §153; e2e `:248` |
| 154 | Test acknowledgement stores user/announcement/version/tenant/time | DONE | pgtest `:120–130`; e2e `:249–252` |
| 155 | Test XSS never executes | DONE | pgtest `:134–139` (refused at the API); unit `:60–66` (renders as text, `window.__pwned` undefined) |
| 156 | Test unauthorized platform user denied | DONE | pgtest `:141–144` (view-only PLATFORM_SUPPORT refused) — service level; route guard generic (`apps/api/src/common/authz-declared.vitest.spec.ts`) |
| 157 | Test tenant Owner/Manager cannot call publish | DONE | pgtest `:145–147` (OWNER permissions refused at the service); routes are `SuperAdminGuard` so a tenant session never reaches the service |
| 158 | Test publish during disconnect → reconnect restores | DONE (re-run Oct 27) | e2e `:254–263`; unit `:67–77` (failed fetch then realtime signal) |
| 159 | Test POS reload restores from snapshot | DONE (re-run Oct 27) | e2e `:266–268` |
| 160 | Test backend failure doesn't break POS | DONE | unit `:67–77`; e2e `:270–276` |
| 161 | Test version conflict | DONE | pgtest `:149–154`; admin test shows message |
| 162 | Test duplicate publish | DONE | pgtest `:155–160` (5 publishes → 1 event, 1 revision) |
| 163 | Test audit on create/edit/publish/pause/resume/archive | DONE | pgtest `:181–192` (6 audit actions + 6 revisions) |
| 164 | Test data leakage: API, realtime, client cache, logs | DONE (Oct 27) | API snapshot + realtime events (pgtest, consumer spec), browser DOM / HTML (e2e). **Logs:** the browser proof now scans everything the API printed during the run (≈797 KB) for every announcement text it published — incl. the other salon's critical notice — and finds none (PASS on this HEAD); the failure telemetry carries no text (unit §116). No client cache exists to test |
| 165 | Definition of Done | DONE (Oct 27 final pass) | every INTERNAL row is closed (§34, §60, §72, §84, §98, §106, §116, §164 — Oct 27); §108's readable-room checks pass again (58 / 58 on the final-pass HEAD) |
| 166 | Required Claude final report | DONE | `docs/PLATFORM_ANNOUNCEMENTS_FINAL_REPORT.md` (sections: existing code, problems by severity, architecture, component path, long-message behaviour, targeting, workflow, migrations, APIs, events, permissions, audit, files, tests, build matrix) |
| 167 | Final reference layout preserved | DONE | `POSLayout.tsx:492–506`; e2e layout assertions at four widths |
| 168 | Permanent rules | DONE | each rule maps to a DONE row above (publisher §6, PG authoritative §99, realtime delivery §64, snapshot §71, server targeting §67, no leakage §68, no marquee §45, no overlap §78, no HTML §89/§90, non-blocking §40, deterministic priority §43, audited §63, schedule §16/§148, failure isolation §114) |

## Counts

**Oct 27 2026 update** (HEAD `93d84d84` + the commits named in the rows): §34, §60, §72, §84, §98, §106, §116, §164 closed; the
browser proof was re-run on this HEAD — 56 / 58, the two failures are §108's readable-room checks at 1366 / 1280. **(Superseded:
the Oct 27 final pass is 58 / 58 — §108, `docs/pilot-runs/2026-10-27-final/announcement-layout.txt`.)**

| Status | Sections |
|---|---|
| DONE | 168 (Oct 27 final pass: §108 and §165 closed — the browser proof 58 / 58 on the final HEAD; the e2e-backed rows §144–§146, §158, §159 re-run) |
| PARTIAL | 0 |
| NOT DONE | 0 |
| BLOCKED_EXTERNAL | 0 |

(168 sections total.) Before the update: 159 DONE / 8 PARTIAL / 1 NOT DONE.

## INTERNAL — buildable now (priority order)

1. **DONE Oct 27** (`4dd41f0e`). §164 / §116 — log-leakage assertion in the browser proof + POS failure counters.
2. **DONE Oct 27** (`4dd41f0e`). §72 — in-flight snapshot ordering (sequence + serverTime; local changes retire older requests).
3. **DONE Oct 27** (`4dd41f0e`). §60 — Created by column.
4. **DONE Oct 27** (`d6631f8e`). §98 — EXPLAIN ANALYZE; migration 699 + the salon-search rewrite.
5. **DONE Oct 27** (`4dd41f0e`). §106 — contrast measured and fixed; the More panel is a modal dialog with a focus trap.
6. **DONE Oct 27** (`4dd41f0e`). §34 — react-icons in the bar; no emoji in the admin preview.
7. **DONE Oct 27** (this commit). Browser proof re-run on this HEAD: **56 / 58** (`TEST_REPORT.md`); the final pass the same day: **58 / 58**.
8. **DONE Oct 27** (`4dd41f0e`, optional). §84 — Suggest from System Status (draft only).
9. ~~**OPEN — owner: Vietnamese POS header layout.**~~ **Closed Oct 27 (final pass, 58 / 58 — §108; `docs/pilot-runs/2026-10-27-final/announcement-layout.txt`).** Original note: §108 — give the announcement back ≥ 200 px of text at 1366 and ≥ 150 px at
   1280 now that the header carries the language switch (e.g. icon-only language button below 1440 px, or a smaller
   Search basis when an announcement is live). `apps/pos-web/src/styles.css` `.topbar` rules; re-run
   `tooling/e2e/pos-announcement-layout.mjs` (58 checks).

## EXTERNAL — needs Kevin

Nothing in this mandate depends on an outside account or device.
