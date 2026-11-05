# ARCHITECTURE AUDIT — before the "Smooth Refresh, Realtime Sync & Booking Concurrency" build

Sep 30 2026 · repository tip `74bd76f` (merged tree: Constitutions 1–13 + the developer's Sep 28 tree) · every claim
below was checked by reading or grepping this tree today; deeper per-area audits are linked rather than repeated.

Spec under audit: *AI PowerSalon — Smooth Refresh, Realtime Synchronization & Booking Concurrency Architecture*
(123 sections + Final Principle). Part B maps every section onto existing code. Part C is the build order.

---

## Part A — the repository as it stands

| Area | What exists (file evidence) | Deeper audit |
|---|---|---|
| **Backend framework** | NestJS 10 + Kysely on PostgreSQL 16, `apps/api` (app entry) with business code in `modules/*` (22 modules) and shared code in `packages/*` (api-contracts, database, ui, mobile-sdk, realtime-client, media…). CommonJS. | `REPOSITORY_ARCHITECTURE_AUDIT.md` |
| **Mobile framework** | Capacitor 6 wrappers around the React apps: `owner-web`, `tech-web`, `customer-web`, `manager-pay-web` (+ `customer-display`, `go-check-in-*` kiosk shells). Native Face ID/Keychain via `packages/mobile-sdk`. | `MOBILE_*` reports, `REALTIME_ARCHITECTURE_REPORT.md` §174 |
| **Admin framework** | `apps/admin-web` (React 18 + Vite), Super Admin; 148+ screens; permission-aware nav. | `CONTROL_PLANE_AUDIT.md` |
| **Database** | PostgreSQL 16, **481 migrations** in `apps/api/db/migrations/`, 649 tables; `packages/database/src/kysely.types.ts` is generated and drift-gated. Verified Sep 30: fresh apply + no-op re-run + types match. | `DB_INDEX_AUDIT.md`, `RLS_READINESS.md` |
| **Current schema (this spec's tables)** | `pos_tech_appointments` (appt_date TEXT date + 'HH:MM' start/end; **no `version` column**), `booking_holds` (372: expires_at, released_at, converted_appointment_id, gist EXCLUDE on live holds), `pos_queue_items` (155 `tech_queue_version`), `tickets` (167 `version` + `ticket_revisions`), `customers` (**no version column**), `payments` (claim-first rows), `loyalty_point_earnings` (UNIQUE tenant+payment), `outbox_events`/`processed_events`/`event_dead_letters` (433-435). | — |
| **Authentication** | Cookie session, four login portals (`/auth/login` tenant/owner/customer/super-admin), session middleware with revocation, step-up for sensitive ops, MFA for Super Admin, Face ID = revocable session token (fixed Sep 29). | `AUTHENTICATION_AUDIT.md` (developer tree) |
| **Permissions** | `ROLE_PERMISSIONS` (evaluate, do not grep — spread constants) + `@RequirePermission` guard; `check:perms` gate; branch scope server-derived; Constitution "Permissions" (154 sections) built. | `PERMISSION_AUDIT.md` |
| **API structure** | Nest controllers per module, DTOs in `packages/api-contracts`; ~1,900 routes; `/super-admin/*`, `/tenant/*`, `/pos/*`, `/tech/*`, `/owner/*`, `/customer/*`; crosswire gate proves every frontend call has a route. | `REPOSITORY_ARCHITECTURE_AUDIT.md` |
| **Video / media storage** | Only nail-showcase photos+video and avatars/docs: `packages/media/src/media-storage.ts` (S3-compatible via `S3_BUCKET/S3_ENDPOINT/S3_PREFIX…`, local fallback), bytes sniffed (`sniffShowcaseMedia`: JPEG/PNG/WebP, MP4/MOV ftyp, WebM EBML), CSPRNG key suffixes (Sep 29). Playback = signed/static URL; no transcoding. Not in scope of this spec. | `MERGE_REPORT_2026-09.md` §2 |
| **Caching** | Redis optional: `cache-redis.ts`, `tenant-rate-limit.ts`, `login-throttle-redis.ts`, realtime bus. PostgreSQL always authoritative (§65/§66 already true). | `INFRASTRUCTURE_*` |
| **Queues / jobs** | No BullMQ. Transactional **outbox** (`apps/api/src/events/`: OutboxWriter, OutboxPublisher with `FOR UPDATE SKIP LOCKED` + per-tenant fair ranking, ConsumerRunner, DLQ, replay, retention) + **worker process** `apps/api/src/worker.ts` (`PROCESS_ROLE` / `WORKER_JOB_CLASSES`; 9 `*_ENABLED` env-gated tick schedulers). | `EVENT_ARCHITECTURE_AUDIT.md` |
| **Realtime** | **SSE** (deliberate, Constitution 9): one `RealtimeStreamFactory` (`apps/api/src/realtime/realtime-stream.ts`) behind 7 endpoints; Redis pub/sub fan-out (`realtime-bus.ts`); per-room **sequence numbers**, `resync_required` on gap, Last-Event-ID; slow-client gate; presence; authz revalidation; 77-event registry with versions; `check:realtime-contract` + `check:realtime-infra-duplicates` gates; **domain → client projection consumer** (`events/consumers/realtime-projection.consumer.ts`). Client: `packages/realtime-client` (reconnect with jittered backoff 1s→30s, dedupe, version-regression drop, sequence gap → reconcile, visibility/online wake, `FallbackPoller`). 21 realtime spec files in the API. | `REALTIME_ARCHITECTURE_AUDIT.md`, `REALTIME_EVENT_CATALOG.md` |
| **Deployment** | Developer-run: frontends as static bundles (`dist-frontends/*` with `_redirects` SPA fallback, `config.js` API base), API at `app.aipowersalon.com:8082`; Railway notes in `DEPLOY_RAILWAY.md`. Not verifiable from here. | `DEPLOY_RAILWAY.md` |
| **Secrets** | Env + Super Admin encrypted gateway settings; `check:secrets` gate (it caught the Sep 29 malware); `SECURITY_SECRETS.md`. | `SECURITY_AUDIT.md` |
| **Observability** | Constitution 11: request/DB/realtime metrics, `super-admin/system-status/*` (realtime health verdict, presence, counters), runbooks. Client: `apps/pos-web/src/api/apiPerf.ts` ring-buffer latency (`window.__apsApiPerf`). **No client sync-duration / payload-size / render-duration telemetry** (spec §100). | `OBSERVABILITY_AUDIT.md` |
| **Tests** | API 1,587 (6 shards) + module suites (thousands) + 7 app suites, 25 gates + 3 audits, CI security lane, real-PG16 migration check. Concurrency proofs already present: appointment race pgtest (426), control-plane races, event failure modes. | `MERGE_REPORT_2026-09.md` §7 |
| **Duplicated architecture** | None for this spec's concerns: ONE realtime stream factory, ONE client SDK, ONE outbox, ONE event registry (both duplicate-detector gates pass). The developer's tree added **no** second sync stack — only ad-hoc polls (below). | — |
| **Broken architecture (found today, this spec's scope)** | 1) `KyselyBookingRepository.reschedule()` runs its transaction with `.catch(() => undefined)` and then `return true` → when the DB exclusion constraint (426) rejects a move onto an occupied slot, **the API reports success** and the board silently snaps back (spec §12/§75). It also takes no advisory lock and does no in-transaction re-check (create does both). 2) Nine live screens do `if (error) return <error page>` on **any** failed background refetch — one transient network error replaces the whole board (spec §20/§42). 3) The shell's developer-added inbox polls `/tech/manager-messages` every 15 s unconditionally (hidden tab included) and `useSidebarBadges` every 30 s — timers outside the sync layer (spec §40/§95). | — |
| **Technical debt that would block the plan** | No `version` on `pos_tech_appointments` or `customers` (spec §14–§16, §59); no delta endpoint or cursor (§25/§26); no `serverTime` in POS state responses (§91); reports refetch with `setLoading(true)` gating the render (blank on each cadence); `FallbackPoller` only runs while the stream is *down* — there is no always-on 15 s safety revalidation while connected (§4/§19/§82). | — |

**Rule applied throughout Part B: reuse and harden.** No `sync_v2`, no second realtime client, no new query library (Part B §46), no new job framework.

---

## Part B — the spec, section by section, mapped onto existing code

Legend: **EXISTS** (already satisfies the section) · **HARDEN** (exists, must be changed) · **BUILD** (missing).

### §1–§6 Operating design and timing
| § | Status | Evidence / what changes |
|---|---|---|
| 1 No visible refresh; no reload/flash/reset | HARDEN | Core POS screens (Booking, Check-In, Queue, Serving, Service Done, Checkout, Tech Queue, Dashboard, Overview, Cash) already keep data on screen and replace state in place (`setS(d)` — no nulling, no loading gate; verified by scan of all 150 screen/component files). **Only one `window.location.reload()` exists in POS: branch switch** (deliberate). The visible failures come from the three "broken" items in Part A. |
| 2 Three layers | HARDEN | Realtime push EXISTS (events → projection → SSE). 15 s POS safety sync: **BUILD** (today: coalesced event refetch + poller only while stream down, 10 s). 20 s server reconciliation: **BUILD** (worker job class, scoped). |
| 3 Realtime 0–1 s | EXISTS | Projection consumer + `OutboxPublisher` tick; `appointment.created/rescheduled/canceled`, `queue.*`, `service.*`, `checkout.*`, `customer.updated` all produced. Latency is *measured* in `RealtimeMetrics` (envelope `updatedAt` → delivered); the publisher's tick interval bounds it — measure and report, never assume. |
| 4 15 000 ms background revalidation | BUILD | Central sync manager (Part C, P2). |
| 5 20 s reconciliation; writes immediate | HARDEN/BUILD | Writes are immediate today. Reconciliation job: BUILD on `worker.ts` job classes (`SYNC_RECON_WORKER_ENABLED`). |
| 6 Timing table | BUILD | Cadences become constants in one file (`packages/realtime-client/src/sync-policy.ts`) shared by all apps. |

### §7–§13 Double-booking protection
| § | Status | Evidence / what changes |
|---|---|---|
| 7/8 Server authoritative, immediate rejection | EXISTS (create) / HARDEN (reschedule) | `create`: `pg_advisory_xact_lock(tenant|tech|date)` + in-transaction re-check + migration **426 gist EXCLUDE** (the last line of defense, proven by a race pgtest) → `BookingConflictRace` → 409. `reschedule`: see Part A "broken" #1 — must take the same lock, re-check, and map 23P01 → 409. |
| 9 Atomic transaction; version; outbox event | HARDEN | Transaction + outbox event exist for create/reschedule/setStatus. Version increment: BUILD (new `version` column). |
| 10 Narrow lock scope | EXISTS | Lock key is tenant + technician + date (not tenant, not table). Keep. |
| 11 overbookingPolicy BLOCK / WARN_REQUIRE_CONFIRMATION / ALLOW_AUTHORIZED_ROLE | BUILD | Today a manager override exists for conflicts ("manager override audited" in booking.service) but no named policy. Add tenant booking setting with default BLOCK; intentional double booking = permission + confirmation + reason + audit (reuse the existing override audit path). |
| 12 409 + `APPOINTMENT_CONFLICT` + UI message + targeted refresh | HARDEN | Code exists in `booking.dto.ts`/`ai-booking` mapping; POS shows 409 messages (`POSBookingScreen` 947/1004, `MoveAppointmentModal` 67) but generic text. Standardise the code on POS routes, the message per spec, and refresh only the affected technician/day. |
| 13 Temporary holds 2–5 min | EXISTS | `booking_holds` (372) with `expires_at`, released/converted flags, gist EXCLUDE on live holds; used by customer booking / AI booking. Verify TTL and expiry sweep in P4. |

### §14–§16 Optimistic concurrency
| § | Status | Evidence / what changes |
|---|---|---|
| 14 Customers `expectedVersion` → `VERSION_CONFLICT` | BUILD | `customers` has no version column; one `expectedVersion` reference in customers is not on the profile edit. Migration + repo check + 409 `VERSION_CONFLICT` + POS edit form sends version. |
| 15 Versioning across Customer, Appointment, Queue Entry, Tech Schedule, Checkout Session, Inventory Item, Membership | PARTIAL | EXISTS: tickets (167), tech queue (155), memberships (4 refs), queue (6 refs), super-admin. BUILD: appointments, customers. Inventory uses claim-first `FOR UPDATE SKIP LOCKED` (ledger), acceptable per §78. |
| 16 No blind last-write-wins | HARDEN | Same as §14/§15. |

### §17–§19 Realtime as primary
| § | Status | Evidence |
|---|---|---|
| 17 Event list | EXISTS | Registry has appointment_*/queue_*/technician_status/service_*/checkout_*/customer_profile_updated (77 events, versioned, gated). |
| 18 Flow POS A → API → DB → event → branch channel → POS B | EXISTS | Outbox → projection consumer → `rooms.tenantBranch` → SSE. |
| 19 15 s = safety net only | BUILD | See §4. |

### §20–§23 Stale-while-revalidate and loading states
| § | Status | Evidence / what changes |
|---|---|---|
| 20 Never clear data during background revalidation | HARDEN | Core screens comply; **`if (error) return` gate breaks it** (9 screens: Booking, Check-In, Queue, Serving, Service Done, Checkout, Tech Queue, +2 report-style). Fix: keep last good state, show the small error/reconnecting indicator. |
| 21 Separate isInitialLoading / isFetching / isRefreshing / isMutating | BUILD | One shared hook (`useLiveQuery`) exposing those four flags; screens keep their own state shapes. |
| 22 Skeleton only on first load | EXISTS (core) / HARDEN (reports) | Report screens (`useReportCadence`) call `setLoading(true)` on every cadence refetch and gate the render → blank every 2 min. Make them stale-while-revalidate. |
| 23 Small Live/Syncing/Offline indicator | EXISTS | `RealtimeStatusPill` (invisible when CONNECTED; RECONNECTING/OFFLINE/DEGRADED). Add "last synced" time (BUILD, small). |

### §24–§27 Booking board refresh, deltas, cursor, snapshot
| § | Status | Evidence / what changes |
|---|---|---|
| 24 Fetch only branch + date + visible techs + changed records | HARDEN | Refetch today = full `state(filters)` + `dayGrid(date)` + waitlist (3 requests) — already branch+date scoped, not delta. |
| 25 `GET /booking/changes?since=` | BUILD | New POS route returning changed/deleted appointments + changed schedules + cursor, built on `pos_tech_appointments.updated_at` + a tombstone for deletes (cancelled rows already stay). |
| 26 syncCursor; `RESYNC_REQUIRED` | BUILD (HTTP) / EXISTS (SSE) | SSE already has `resync_required`. HTTP delta endpoint returns the same code for an invalid cursor. |
| 27 Snapshot fallback | EXISTS | Reconcile path = full state fetch; keep as the fallback for RESYNC_REQUIRED. |

### §28–§33 Customers, queue, serving, checkout refresh
| § | Status | Evidence |
|---|---|---|
| 28/29 Customers on demand, no global refresh | EXISTS | Customer search is server-side paginated; `customer_profile_updated` refreshes only the open profile (`POSCustomerProfileScreen`). |
| 30/31 Queue/Serving realtime first | EXISTS | Both subscribed; 15 s validation joins via the sync manager. |
| 32/33 Checkout not polled; provider-authoritative | EXISTS | Payment is `claimPayment` claim-first + processor call + webhooks; `checkout` screen refreshes on events, no per-second poll. |

### §34–§39 20-second server reconciliation
| § | Status | Evidence / what changes |
|---|---|---|
| 34–36 Targeted reconciliation, event-driven first | BUILD | New `SyncReconciliationWorker` (job class) every ~20 s: active scopes only — branches with presence entries or events in the last 5 min (both already tracked: `PresenceService.tenantView`, `RateBuckets`) — verifies expired `booking_holds` are released, outbox lag, projection/sequence state; repairs = release expired holds, re-emit a `resync_required` per stale room. |
| 37 ±2 s jitter on 15 s | BUILD | In `sync-policy.ts`. |
| 38/39 Dedicated scheduler, no per-API-server cron | EXISTS (mechanism) | `worker.ts` + `PROCESS_ROLE` already separate schedulers from API nodes; the new job runs there. Single-flight across workers via `pg_advisory_lock` (§103). |

### §40–§45 Hidden tabs, focus, reconnect, backoff, single-flight, dedupe
| § | Status | Evidence / what changes |
|---|---|---|
| 40/41 Hidden → 30–60 s or suspend; focus → immediate | PARTIAL | Client: visibility wake ≥30 s hidden → reconcile (EXISTS). Polls: `useRealtime` fallback skips when hidden (EXISTS); shell polls do not (HARDEN). Hidden cadence for the 15 s sync: BUILD (60 s). |
| 42/43 Reconnect → immediate sync; backoff 1,2,5,10,30 | EXISTS | `ConnectionStateMachine` full-jitter backoff capped 30 s; `online` listener reopens; reconcile on reopen. |
| 44 No overlap / single-flight | BUILD | `RefetchCoalescer` coalesces bursts (250 ms) but does not stop overlapping in-flight loads. Add in-flight guard to the sync manager. |
| 45 Request dedupe across components | BUILD | Same manager: one in-flight promise per (screen, key). |

### §46–§47 Query library, the shading rule
| § | Status | Evidence |
|---|---|---|
| 46 TanStack Query | N/A — **not used**, and not needed | No `@tanstack/*` in any app. The existing `useRealtime` + per-screen `load()` is the query layer; §46's settings (short stale time, 15 s active refetch, refetchOnWindowFocus, refetchOnReconnect, keepPreviousData) are implemented by the sync manager. Introducing a library would be a second stack (§94). |
| 47 `if (isLoading \|\| isFetching) return` | **Not present** | Scan of all POS files: zero library-style gates. The equivalent faults are the `if (error) return` gate and the reports' `setLoading(true)`; see §20/§22. **Honest statement for the final report (§123): from source alone the "screen shades every 15 s" cannot be reproduced on the operational screens; the only 15 s timer is the shell inbox poll (Part A). If the deployed build still shades, it needs a screenshot/HAR from the live POS — not guessed.** |

### §48–§56 Interaction, forms, drag, scroll, modals, rendering
| § | Status | Evidence / what changes |
|---|---|---|
| 48/49 Don't interrupt typing; separate draft state | EXISTS (mostly) | Search inputs are local state; Add Walk-in / New Booking are full pages with local form state (booking-upgrade arc). Pin with tests (P3). |
| 50 Drag protection; submit expectedVersion | HARDEN | Board drag uses pointer events and a `drag` overlay state; refetch replaces `s` underneath. Freeze the dragged card's source row during drag; send `expectedVersion` on drop after §15. |
| 51 Scroll/date/filter/zoom preservation | EXISTS | Board keeps `calDate`, filters, `openId` in state; the grid is not remounted on refetch (no `key` churn). Pin with a test. |
| 52 Modals stay open | EXISTS | `openId`/`MoveAppointmentModal` state independent of `s`. Pin. |
| 53/54 Selective render, memoization | HARDEN | Booking columns are not memoised; measure with React Profiler in P6 before memoising (spec: "where profiling confirms"). |
| 55 Virtualise large lists | EXISTS | Customers list is paginated server-side. |
| 56 Load visible date/tech range only | EXISTS | `state({date, technicianId})` + `dayGrid(date)`. |

### §57–§58 Query optimisation
| § | Status | Evidence |
|---|---|---|
| 57 Indexes on tenant/branch/tech/date/status | VERIFY in P4 | `DB_INDEX_AUDIT.md` exists; run EXPLAIN on the delta query before adding any index. |
| 58 Customer search indexes | EXISTS | `pg_trgm` indexes on customer search fields (customer-identity arc). |

### §59–§67 Versions, sequences, customer sync, canonical data, Redis
| § | Status | Evidence |
|---|---|---|
| 59/60 Events carry resourceVersion; drop stale | EXISTS (mechanism) | `EventTracker` drops stale `version`/dup `eventId`; appointments will carry a real version once §15 lands. |
| 61 Sequence gap → resync | EXISTS | Per-room seq + `resync_required`. |
| 62/63 customer.updated fan-out; server canonical | EXISTS | `customer.updated` → `customer_profile_updated` to POS; owner/customer apps by room. |
| 64–67 Cache strategy; Redis non-authoritative; event invalidation | EXISTS | Redis only caches/fans out; PostgreSQL authoritative; projection consumer invalidates on events. |

### §68–§80 Conflict rules and money/queue concurrency
| § | Status | Evidence / what changes |
|---|---|---|
| 68 Duration overlap not equal starts | EXISTS | `pbDetectTechnicianConflict` is range-based; 426 uses half-open int4range. |
| 69 Add-on duration re-validation | HARDEN | `update()` changing services/duration must re-run conflict check inside the tx (same fix class as reschedule). |
| 70 Multi-technician segments | VERIFY | Party bookings (booking-upgrade H7) — check each segment is validated. |
| 71/72 Breaks and working hours | EXISTS | `pbWithinStoreHours`, `techSchedules`, `blockedTimes` in the create/reschedule pre-check (manager override audited). Move into the transaction with §9. |
| 73 Holds count as unavailable | EXISTS | 372 EXCLUDE on live holds. Confirm POS availability includes holds (P4). |
| 74 Cancel frees slot + event | EXISTS | Status change emits `appointment.canceled`; 426 predicate excludes cancelled rows. |
| 75 Atomic reschedule | HARDEN | Part A "broken" #1. |
| 76 Checkout lock `CHECKOUT_ALREADY_IN_PROGRESS` | HARDEN | `claimPayment` prevents double *payment*; ticket `version` (167) exists; add the named code on the checkout-session claim. |
| 77 Queue version | EXISTS | 155 `tech_queue_version` + `expectedVersion` in queue service. |
| 78 Inventory ledger | EXISTS | `FOR UPDATE SKIP LOCKED` claim-first movements (inventory.service 686–952). |
| 79 Gift card transactional | VERIFY | `modules/gift-cards` — redemption path to be read in P4 (no `FOR UPDATE` found by grep). |
| 80 Loyalty idempotent | EXISTS (earn) / VERIFY (redeem) | `loyalty_point_earnings` UNIQUE; redemption in `loyalty.kysely.repository.ts` has no lock — P4. |

### §81–§99 Polling classes, defaults, scheduler, fairness
| § | Status |
|---|---|
| 81 Polling classes table | BUILD — encoded in `sync-policy.ts` (operational 15 s ±2; detail 30–60 s; reports manual/2 min (exists); settings on event/focus). |
| 82/83 Defaults | BUILD (client 15 s) / BUILD (server 20 s). |
| 84/85 Coincidence acceptable | EXISTS by design once single-flight + jitter land. |
| 86/87 Reconciliation in workers | EXISTS (worker process) — the new job goes there. |
| 88/89/90 Compression, deltas, ETag | Compression: verify Nest `compression` in `main.ts` (P4); deltas §25; ETag: BUILD only for settings/services (`If-None-Match` → 304) — nothing today. |
| 91 `serverTime` + `syncCursor` | BUILD (1 reference to `serverTime` in the tree). |
| 92/93 Indicator, no global spinner | EXISTS / see §47. |
| 94/95 Central sync manager, no per-screen intervals | HARDEN — `useRealtime` becomes the manager; retire the shell's 15 s and 30 s intervals and `SkipLineDrawer`'s 5 s poll (drawer open only — review). |
| 96 Adaptive sync | BUILD. |
| 97–99 Scheduler → active scopes → small jobs; fairness at 10k tenants | BUILD on presence + rate buckets; bounded concurrency; per-tenant batching pattern already used by the outbox publisher. |

### §100–§103 Observability and alerts
| § | Status |
|---|---|
| 100 Metrics list | PARTIAL — server: realtime latency P50/P95/P99, reconnects, publish failures EXIST; **BUILD**: client sync duration/payload size/records changed (extend `apiPerf`), booking-conflict and version-conflict counters, reconciliation duration. |
| 101/102 Targets + alert when behind | BUILD — thresholds in `realtime-health.ts` (incident thresholds, not SLOs — Constitution 9 §141 rule). |
| 103 No overlapping reconciliation | BUILD — `pg_try_advisory_lock` per job partition. |

### §104–§119 Required tests
| § | Status |
|---|---|
| 104 10-device booking race | PARTIAL — 426 race pgtest (2 writers) EXISTS on real PG; extend to 10 writers, create AND reschedule. |
| 105 Customer version conflict | BUILD (after §14). |
| 106 Queue reorder race | VERIFY existing queue version tests; add the concurrent case. |
| 107 Double checkout | EXISTS partially (claim-first payment tests) — add named-code test. |
| 108/109 Gift card / loyalty double spend | BUILD (after §79/§80 review). |
| 110–112 Realtime off / polling off / Redis off | PARTIAL — hook tests cover "no EventSource → poller"; backbone-down covered in Constitution 9 named tests; add polling-off (events alone) and Redis-off end-to-end at the hook level. |
| 113 Browser sleep | EXISTS (`shouldRefreshOnVisible` ≥30 s → reconcile + reopen; tested) — add the "no reload" assertion. |
| 114 Poor network | BUILD (single-flight + no pile-up test). |
| 115–119 UI preservation (scroll, Add Walk-In, New Booking, drag, search) | BUILD — screen tests that fire a background refetch mid-interaction. |

### §120–§123 Final architecture, rules, DoD, report
All covered by the above; §123's report is written at the end with **measured** numbers from the sandbox (latency of the local loop, payload sizes, request counts) and a clear "not measured here" list for production values.

---

## Part C — build order (each phase: audit-verified → build → tests incl. a mutation check per guard → battery → commit)

| Phase | Scope | Sections |
|---|---|---|
| **P1 — stop the visible damage** | Remove the `if (error) return` blanking on the 9 live screens (keep last state + inline indicator); reports stale-while-revalidate; shell inbox + badges onto the sync layer (visible-gated, event-driven, no raw intervals). | 1, 20, 22, 40, 47, 93, 95 |
| **P2 — the sync layer** | `sync-policy.ts` (15 s ±2 s active, 60 s hidden, focus/reconnect immediate); `useRealtime` gains always-on jittered safety revalidation, single-flight, request dedupe, `isInitialLoading/isFetching/isRefreshing` flags, last-synced time on the pill. Owner/Tech/Customer adapters inherit via the package. | 2, 4, 6, 19, 21, 23, 37, 40–46, 81, 82, 92, 96 |
| **P3 — booking concurrency (server)** | `reschedule`/`update` inside lock + in-tx re-check + 23P01 → 409 `APPOINTMENT_CONFLICT` (the Part A defect); `overbookingPolicy` (BLOCK default) with permission+confirmation+reason+audit; appointment `version` column + `expectedVersion` on drag/drop; `serverTime` in POS state; 10-writer race pgtest for create and reschedule. | 7–13, 59, 68–75, 91, 104 |
| **P4 — versioning + money/queue concurrency** | `customers.version` + `VERSION_CONFLICT` + POS edit form; `CHECKOUT_ALREADY_IN_PROGRESS`; gift-card and loyalty redemption transactions reviewed/locked; queue race test; holds TTL check; compression check; ETag on services/settings. | 14–16, 76–80, 88, 90, 105–109 |
| **P5 — delta sync + reconciliation** | `GET /pos/booking/changes?since=` + cursor + `RESYNC_REQUIRED`; board applies deltas per technician/day; `SyncReconciliationWorker` (20 s, active scopes, advisory-lock single-flight, fairness). | 24–27, 34–36, 38, 39, 83, 86, 87, 89, 97–99, 103 |
| **P6 — UI preservation + rendering** | Tests: scroll/date/filters, Add Walk-In, New Booking, drag, search-typing survive a background refetch; profile the 12-technician board and memoise only what profiling shows. | 48–56, 115–119 |
| **P7 — telemetry, failure tests, report** | Client sync metrics + conflict counters + reconciliation duration + alerts; realtime-off / polling-off / Redis-off / sleep / poor-network tests; the §123 report. | 100–102, 110–114, 122, 123 |
