# Super Admin POS Top-Bar Announcements & Platform Broadcast — final engineering report (mandate §166)

Oct 22 2026. This report covers only work that was built and run. PostgreSQL holds every announcement, target, receipt and revision. Realtime is how changes reach the POS; it is not the record. When a POS starts or reconnects, it asks the server for a snapshot, and the server decides which salon and which branch see what.

---

## A. Existing code found (inspected first, §1–§12)

| Area | What exists | Decision |
|---|---|---|
| POS top bar | `apps/pos-web/src/shell/POSLayout.tsx` `<header className="topbar">`: hamburger · `LocationSelector` · `TopSearch` · (clock group: `TopClock`, `LanguageSwitch`, `NotificationBell`, `MessageControl`) · `ProfileMenu`. Below the header: `community-alert-slot` (Safety Community banner) and the screen. | Kept as is. The announcement goes **between `TopSearch` and the clock group**, as a flexible centre (§23–§24). |
| `platform_announcements` table + Super Admin "Announcements" | An **outbound send** table with its own lifecycle: email / SMS / in-app blasts to salon owners, with a send status and recipient counts. | **Not reused.** It has a different lifecycle (sent once, not displayed over a window), different columns and different consumers. Bending it to also mean "shown on every POS between two times" would have made both meanings wrong. The header of migration 674 records this. |
| `maintenance_state.announcement_banner` | A text that only the **mobile app-config** endpoint serves. | A different surface, left alone. **Overlap note:** Super Admin now has two places to put a "maintenance" message: this one for the mobile apps, and Platform Announcements (type MAINTENANCE) for the POS. |
| Safety Community banner | A per-salon, high/critical community alert in the slot under the header. | A different product. It still works and stacks below the top bar. |
| Permissions | `super_admin.communications.view` / `.manage` already existed in the platform grants. | Reused. Publish, pause, resume and archive also need a step-up (`@RequireStepUp`). |
| Events / realtime | Outbox → `realtime-projection.consumer.ts` → rooms. The POS `useRealtime(screens, load)` refetches according to `AFFECTS`. | Reused: two domain events and one client event. No new transport. |
| Audit | `AuditService.recordPlatform` | Reused. A per-version revision table holds the full history. |

## B. Problems by severity

| Severity | Problem | Resolution |
|---|---|---|
| P0 / P1 | **None found** in the existing code on this path. | — |
| P2 (found by the browser proof, new code) | On the 1366 and 1280 screens, a live announcement had only **0–52 px** of text. Search kept its full 228 px plus its button, so the centre had no room left. | While an announcement is live, Search shrinks to a usable minimum (box ≥ 200 px including its button), the salon selector ellipsizes at 160 / 150 px, and on screens ≤ 1440 px the owner's name folds into the avatar. The name is still read by screen readers and still shown in the profile menu. Result: 202 px of text at 1366 and 156 px at 1280 (two lines, then clamp + More, as in the reference layout). |
| P3 (existing, surfaced) — **B-65** | `TopSearch`'s outer wrapper had no flex rule, so it could never give up width to anything that shared the row. | It is now `top-search` with `flex: 0 1 auto; min-width: 0`. Nothing changes when there is no announcement. |
| P3 (environment, not a bug) | In **development** the outbox publisher is off by default (`EVENT_PUBLISHER_ENABLED` unset ⇒ on only in production). Local announcements then arrive through the 60-second safety sync instead of instantly. | Recorded. The browser proof turns the publisher on explicitly. Production is unaffected (on by default). |

## C. Final architecture

```
Super Admin screen ──HTTP──► SuperAdminPlatformNoticeController ──► PlatformNoticeService (Postgres transaction)
                                                                     ├─ platform_notices         (row lock + version check)
                                                                     ├─ platform_notice_targets  (server-resolved audience)
                                                                     ├─ platform_notice_revisions (one per version)
                                                                     ├─ outbox_events: one event PER TARGETED SALON (ids + version only)
                                                                     └─ AuditService.recordPlatform
outbox publisher ─► realtime-projection.consumer ─► platform_announcement_updated → that salon's owner room,
                                                    its branch-less room and the targeted branch rooms only
POS ─ useRealtime(['platform-announcements']) ─► GET /pos/platform-announcements/active (snapshot; the server re-applies
      targeting from the SESSION's tenant + branch, window on the DB clock, minus this user's dismissals)
    ─ timer at nextChangeAt (schedule start / expiry with no scheduler) ─ 60 s safety sync ─ refetch on reconnect
```

Scheduled, active and expired are **derived** from `starts_at` / `ends_at` against the database's `now()`. No job flips states (§102).

## D. Top-bar component

`apps/pos-web/src/shell/PlatformAnnouncementBar.tsx`, mounted in `POSLayout.tsx` straight after `<TopSearch />`. Styles: `.pa-*` in `apps/pos-web/src/styles.css`.

- **No message:** an empty `pa-slot` that takes the free space the header always had. Nothing is drawn and no "Loading…" text appears (§112–§113).
- **Order:** CRITICAL > HIGH > NORMAL > LOW, then most recently published, then id (`compareForDisplay`, the same on every client). When there are several, `More (n)` lists them all. Normal and low items of equal priority rotate every 8 s; rotation pauses on hover, on focus and while the panel is open. There is no marquee.
- **Tone:** info / update use gold, maintenance / warning use amber, urgent or critical use a strong red accent, plus an icon. Colour is never the only signal.
- **Accessibility:** `role="region"` with a label, and a polite `aria-live` that announces only newly arrived HIGH / CRITICAL items. Escape closes the panel and returns focus to More. Reduced-motion is honoured.
- **Failure:** fetch and receipt errors are logged with `console.warn` and never thrown. The proof checked this with the API answering 500: the header and the screen still work.

## E. Long-message behaviour (§27–§34, §109–§110)

| Message | 1920 × 1080 | 1366 × 768 / 1280 × 800 |
|---|---|---|
| Short (≈ 50 chars) | one line | one line |
| ≈ 150 chars | **two lines, no clamp** | two lines, clamp + More |
| 300–500 chars | **two lines, clamped, More** → panel with the full text (`white-space: pre-wrap`; line breaks kept) | the same |

These are measured in the real browser, not estimated. See §J.

## F. Targeting (§45–§55, §67–§69)

- **All tenants:** every salon. The realtime fan-out goes to every active salon with its active branches.
- **Selected tenants:** the chosen salons (all their branches, and branch-less sessions).
- **Selected branches:** only those branches. The branch's **own** salon is read from the branch row; a request can never say which salon a branch belongs to. A branch smuggled under a different salon is refused (`INVALID_AUDIENCE`). A branch-less session does not see branch notices.
- The POS never filters for security. `active()` matches on the session's `tenant_id` / `branch_id` in SQL, and targets and receipts carry RLS `tenant_isolation`.
- An edit that changes the audience notifies the **union** of the old and new audiences, so a salon that was removed hears that the notice is gone.

## G. Super Admin workflow

Super Admin › Communications › **Platform Announcements** (`apps/admin-web/src/screens/PlatformAnnouncementsScreen.tsx`):

1. History: status tabs (All / Active / Scheduled / Draft / Paused / Expired / Archived), a server-side search over message, title and target salon name or code, and paging.
2. New announcement: title (≤ 120), message (≤ 2,000, live counter), type, priority (urgent or critical defaults to non-dismissible), audience radios with a searchable salon picker and branches per chosen salon, Publish now or Schedule (datetime in the admin's time zone, shown), end time (required for maintenance), "Staff may dismiss it", and "Require *I understand*".
3. **Preview:** the real header layout at **1920** and **1366** widths: salon, search, the announcement, clock, bell, mail and owner.
4. Save draft (nothing shows), then Publish / Schedule. An every-salon message needs a confirmation checkbox, and a high or critical one needs a second checkbox (§120–§121). The server enforces the same rule (`CONFIRMATION_REQUIRED`).
5. Live: Pause → Resume, Archive (kept in history, never deleted), Duplicate to draft. Version history and delivery stats (delivered / dismissed / acknowledged employees and salons reached; this measures delivery, not reading, §117).

## H. Database / migration

`apps/api/db/migrations/674_platform_pos_announcements.sql`:

| Table | Purpose |
|---|---|
| `platform_notices` | id, title, message, type, priority, audience, `surfaces text[]` (default `{pos}`), `lifecycle_status` draft / published / paused / archived (state machine `PLATFORM_NOTICE`), starts / ends (CHECK end > start), dismissible, requires_ack, **`content_version`** (bumped by a material edit, so a dismissed notice comes back), **`version`** (optimistic lock), duplicated_from, created / updated / published_by, published / paused / archived_at. Indexes for the live lookup and the admin list. |
| `platform_notice_targets` | notice → tenant (+ branch), target_type tenant / branch, shape CHECK, unique per notice. A trigger checks that a branch belongs to its tenant. RLS. |
| `platform_notice_receipts` | tenant, notice, user, branch, kind delivered / dismissed / acknowledged, content_version. Unique per (tenant, notice, user, kind, content_version), so a repeat is one record. RLS. |
| `platform_notice_revisions` | One row per version: action (created / edited / published / paused / resumed / archived / duplicated), actor, full JSON snapshot. Unique (notice, version). |

Types are in `packages/database/src/kysely.types.ts`; `check:types-drift` passes (767 tables).

## I. APIs

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/super-admin/communications/platform-announcements` | `communications.view` | `?status=&q=&page=&pageSize=` (declared `@ListQuery`; bad status → 400) |
| GET | `…/{id}` | view | Includes targets, revisions and stats |
| GET | `…/audience/tenants` · `…/audience/tenants/{tenantId}/branches` | view | Picker |
| POST | `…` | `communications.manage` | Always creates a **draft** |
| PATCH | `…/{id}` | manage | `expectedVersion` required → `VERSION_CONFLICT` 409 |
| POST | `…/{id}/publish` | manage + step-up | `{expectedVersion, publishNow, startsAt, confirm}`. A repeat is an idempotent replay (one publication, one event set). |
| POST | `…/{id}/pause` · `/resume` · `/archive` | manage + step-up | A repeat is a no-op. Archived → `ALREADY_ARCHIVED`. |
| POST | `…/{id}/duplicate` | manage | New draft |
| GET | `/pos/platform-announcements/active` | `pos.login` | Snapshot `{announcements, serverTime, nextChangeAt}` |
| POST | `/pos/platform-announcements/{id}/dismiss` · `/acknowledge` · `/delivered` | `pos.login` | `{contentVersion}`. Only for a notice this session can see; dismiss requires dismissible; acknowledge requires requires_ack. |

The mandate's `/api/v1/platform/announcements` sketch was adapted to the repository's real conventions (`/super-admin/...` for the platform realm, `/pos/...` for staff), as its "adapt routes" note asks. Error codes (`packages/api-contracts/src/errors.ts`): `PLATFORM_ANNOUNCEMENT_NOT_FOUND` 404, `ACCESS_DENIED` 403, `INVALID_AUDIENCE` 422, `INVALID_SCHEDULE` 422, `INVALID_MESSAGE` 422, `VERSION_CONFLICT` 409, `ALREADY_ARCHIVED` 409, `INVALID_STATE` 409, `CONFIRMATION_REQUIRED` 422. Contracts are in `packages/api-contracts/src/{platform,tenant}/platform-announcements.ts`.

## J. Events / realtime

- Domain events: `platform.announcement_published` and `platform.announcement_changed` (edit / pause / resume / archive). There is **one per targeted salon**, with payload `{announcementId, version, action, branchIds}`. The text never travels.
- Projection → client event `platform_announcement_updated` (v1, `AFFECTS ['platform-announcements']`) in the salon scope: owner room, branch-less room and the listed branch rooms. A salon's rooms never receive another salon's event (`realtime-projection.platform-announcements.vitest.spec.ts`; pgtest §164).
- POS recovery: snapshot on start, refetch on every event, a timer at `nextChangeAt`, a 60 s safety sync, and a refetch on reconnect. Catalogued in `REALTIME_EVENT_CATALOG.md` and `docs/EVENT_CATALOG.md`.

## K. Permissions

- Authoring: `super_admin.communications.view` (read) and `.manage` (write), checked in the service as well as at the route. `SuperAdminGuard` on the controller. Publish, pause, resume and archive need a step-up.
- POS: `pos.login`. Tenant owners and managers have no route to the authoring API. The platform realm is refused to tenant sessions, and the service also refuses a context without the platform permission (pgtest: owner / viewer denied).
- The authoring queries that span salons live in `platform-notice-admin.queries.ts` (declared cross-tenant by design). The POS queries stay in the service, where `check:tenant` / `check:tenant-builder` still check every statement.

## L. Audit and history

Every create, edit, publish / schedule, pause, resume, archive and duplicate writes a **revision row in the same transaction** (the full snapshot) and a platform audit record (`platform_announcements` module, high severity for publish / pause / resume). The pgtest checks the audit order and the revision chain.

## M. Files changed

44 files, +2,326 / −13. The new work:

- `modules/communications/src/platform-announcements/` — core, service, admin queries, controller, module, pgtest, core spec
- `apps/api/db/migrations/674_platform_pos_announcements.sql`
- `apps/pos-web/src/shell/PlatformAnnouncementBar.tsx` (+ test), `apps/pos-web/src/api/posPlatformAnnouncementsApi.ts`; `POSLayout.tsx`, `TopSearch.tsx`, `styles.css`, the EN / VI catalogs
- `apps/admin-web/src/screens/PlatformAnnouncementsScreen.tsx` (+ test), `apps/admin-web/src/api/superAdminPlatformAnnouncementsApi.ts`; `App.tsx` route, `AdminLayout.tsx` nav
- `packages/api-contracts` (contracts, error codes), `packages/events` (2 events), `packages/realtime-contracts` (1 client event), `packages/database` (types, actor columns)
- `apps/api/src/events/consumers/realtime-projection.consumer.ts` (+ spec), `apps/api/src/app.module.ts`
- `tooling/e2e/pos-announcement-layout.mjs` — the real-browser proof
- Regenerated records: ownership registry, state vocabularies, OpenAPI manifest, route domains, role matrix, realtime / event catalogs

## N. Tests

| Suite | Result | Covers (mandate §) |
|---|---|---|
| `platform-notice.pgtest` (every migration, real schema) | **20 / 20** | 140 global, 141 selected tenant, 142 selected branch + smuggled branch, 147 order, 148 / 149 schedule, expiry, `nextChangeAt`, 150 / 151 pause / resume, 152 per-user dismissal + material edit returns, 153 non-dismissible, 154 acknowledgement record, 155 XSS refused, 156 / 157 unauthorised denied, 161 version conflict, 162 duplicate publish = 1 event, schedule validation, 20 / 130 archive / duplicate, 163 audit + revisions, history search, tenant picker, 164 cross-salon receipt / snapshot / event |
| `platform-notice-core` | **9 / 9** | Sanitising (control / bidi characters, markup refused), window rules, order, confirmation rule, material change |
| `PlatformAnnouncementBar.test` | **7 / 7** | Empty, one line / More, rotation, dismiss, acknowledge, failure is silent, aria-live |
| `PlatformAnnouncementsScreen.test` | **7 / 7** | History filter / search, draft save, preview 1920 / 1366 + More, double confirmation, salon picker, version conflict message, pause / archive / duplicate with version, stats + history |
| `realtime-projection.platform-announcements` | **3 / 3** | Targeted salon rooms only, ids only, POS refetch |
| **Real browser** `tooling/e2e/pos-announcement-layout.mjs` (built POS + real API + Postgres + outbox → SSE; owner signed in to PILOT01) | **51 / 51** | 112 empty, startup snapshot, 26 / 140 appears with no refresh, 63 live edit, 30 / 31 / 32 one line → two lines → clamp + More → full text, Escape, 164 another salon's critical notice never shown, **144–146 at 1920 / 1600 / 1366 / 1280: no horizontal scroll, Search ≥ 200 px box, bar strictly between Search and the clock, clock / bell / mail / profile visible and not overlapped, ≤ 2 lines inside the header, readable text width**, 150 pause, 151 resume, 20 archive, 149 scheduled: not early, then appears, 148 expires by itself, 152 dismiss, 153 no ✕ on non-dismissible, 154 acknowledgement row, **158 published while offline → shown after reconnect**, page never reloaded, **159 reload restores it from the snapshot**, **160 announcement API answering 500 → POS header and screen still work**, no page errors |

Screenshots from the proof, at each width plus the empty, two-line, More-open, paused and API-failing states, are in the run's `SHOTS` folder.

## O. Build matrix

| Component | Result | Evidence |
|---|---|---|
| API | **PASS** | `tsc -p tsconfig.build.json` rc 0; API lane 3 shards: 1,050 + 915 + 938 passed, 0 failed (138 env-gated skips, pre-existing) |
| POS | **PASS** | `vite build` ok; POS lane 2 shards: 763 + 636 passed, 0 failed |
| Super Admin | **PASS** | admin-web lane 1,048 / 1,048; typecheck clean |
| Realtime | **PASS** | projection spec 3 / 3; browser: publish / edit / pause / resume / archive arrive with no reload |
| Database migrations | **PASS** | 674 applied (PGlite pgtests run every migration; `fr_live` migrated); `check:types-drift`, `check:db-ownership`, `check:actor-stamp` pass |
| Unit tests | **PASS** | core 9, bar 7, screen 7, projection 3; communications lane 449 / 449 |
| Integration tests | **PASS** | pgtest 20 / 20; browser 51 / 51 |
| Security tests | **PASS** | XSS refused (server) and escaped (React text only, never innerHTML); platform-only publishing; step-up; `ci:gates` **51 gates + 16 audits all pass** |
| Tenant isolation | **PASS** | pgtest §141 / §142 / §164 (snapshot, events, receipts); browser: other salon's critical notice not shown; RLS on targets / receipts; `check:tenant` + `check:tenant-builder` pass |
| Responsive UI tests | **PASS** | browser at 1920 × 1080, 1600 × 900, 1366 × 768, 1280 × 800 (measured, not eyeballed) |

## P. Not built / limits (stated plainly)

- **POS only.** `surfaces` defaults to `{pos}`. The Owner, Tech and Customer apps do not show these notices yet. The column is there for when they should.
- Schedules are entered in the Super Admin's own time zone (the screen shows which). The server stores UTC and decides on its own clock.
- The mobile `maintenance_state.announcement_banner` and the outbound `platform_announcements` sends are separate tools (§A); they were not merged.
- Analytics are delivery counts (delivered / dismissed / acknowledged per employee and salons reached). They do not claim that anyone read the message (§117).
