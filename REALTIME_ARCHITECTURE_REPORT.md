# REALTIME_ARCHITECTURE_REPORT.md
### Constitution 9 — §255 Final Report (Sep 19, 2026)

Base tree: the July snapshot, not `Power-Salon-main` (same caveat as Constitutions 8). Everything below is in
patch 15 and the bundle; `REALTIME_ARCHITECTURE_AUDIT.md` holds Phases 1–3 with the corrections made mid-build.

---

## 1. Existing Realtime Discovery
| | Found |
| --- | --- |
| WebSocket / Socket.IO | None, anywhere. |
| SSE | **Seven** hand-rolled endpoints across six files: `/realtime/stream` (POS), `/owner/stream`, `/tech/stream`, `/customer/stream`, and the customer-display checkout + device streams. My first pass found one; the duplicate checker found the last two — see Problems. |
| Polling | POS hook polled every 45 s **while connected**; owner hook every 60 s while connected; tech hook started polling on the first error and never stopped. |
| Redis Pub/Sub | `realtime-bus.ts` — `RedisRealtimeEmitter` wrapping the per-node `InProcessEmitter`; in-memory fake for tests. Sound. |
| Frontend clients | Five: `pos-web/src/realtime/` (best — reconnect-reconcile, jittered backoff, wake, dedupe, version guard), `owner-web/src/api/useOwnerStream.ts`, `tech-web/src/lib/useTechStream.ts`, `customer-web/src/api/useCustomerStream.ts`, `customer-display/src/useDisplay.ts` (polled every 4 s unconditionally). None had sequence numbers. `admin-web` had none. |
| Mobile clients | Not in this tree (Capacitor apps live in the mobile-constitution arc's tree). |
| Super Admin realtime | None. Request/response only. |

## 2. Problems Found
- **Duplicate connections / clients:** four server stream loops, four client implementations, one event registry copied into the POS client and **27 events behind the server** (49 vs 22) — every one of those would have arrived unroutable.
- **Cross-tenant risk:** rooms were already server-derived (§13 held). No cross-tenant delivery found, then or now.
- **Missing authorization on open streams:** role/branch came from the JWT; a demotion or removed branch access was invisible to an open stream until token expiry.
- **Missing reconnect:** tech and customer hooks relied on the browser's fixed-interval retry (herd-prone).
- **Missing resync:** no sequence numbers anywhere — a lost frame was invisible on every stream.
- **Stale-state risks:** none of the four gateways compared `Last-Event-ID` to anything.
- **Local-only fan-out:** no — Redis fan-out existed. But the per-room sequence had to be minted *before* the fan-out to be consistent across instances, and a restarted gateway had to consult the shared counter rather than its empty memory.
- **Polling overload:** three of four hooks polled while connected.
- **Memory leaks:** the only leak found was one I introduced (fallback poller's grace timer surviving unmount) — caught by pos-web's suite, fixed, pinned.
- **Harness blind spots:** `di-check` failed with a bare exit code and no message (Nest calls `process.exit` before the script's catch); fixed and mutation-tested.

## 3. Final Realtime Diagram
```
Domain event (outbox, Constitution 8)
      ↓
RealtimeProjectionConsumer   (Constitution 8 — 4 scopes: tenant / ticket / technician / customer)
PlatformLiveOpsConsumer      (counts only → 10 s aggregate snapshot)
      ↓
RedisRealtimeEmitter.fanout  → seq minted ONCE per room (Redis INCR) → publish
      ↓                                                    ↓
InProcessEmitter (node A)                        InProcessEmitter (node B)
      ↓                                                    ↓
RealtimeStreamFactory.open()  — origin ✓ limiter ✓ presence ✓ seq/vector-id ✓ slow-client ✓ session ✓ authz ✓
      ↓
/realtime/stream  /owner/stream  /tech/stream  /customer/stream  /super-admin/stream
      ↓
@aipowersalon/realtime-client — reconnect+reconcile, jittered backoff, per-slot SequenceTracker,
                                dedupe, version guard, presence reports, FallbackPoller
      ↓
POS · Owner · Technician · Customer · Super Admin apps (thin adapters; screens unchanged)
```

## 4. Transport Strategy
**SSE everywhere; WebSocket nowhere.** §6 prefers WebSocket, §252 Phase 3 allows *preserve*. Reasons, from the
constitution itself: §4 requires mutations over HTTP and forbids a second business API; §94–95 allow socket
commands only when genuinely required; none of the 50 client events needs client→server traffic on the stream.
WebSocket's one advantage is the property the constitution says not to exploit. The revisit trigger is the first
realtime *command* §95 would justify. Everything built (sequencing, presence, revalidation, SDK) is transport-independent.

## 5. Gateway Architecture
One factory, `RealtimeStreamFactory.open(req, resolveRooms, { frame })`, opens every stream on every endpoint.
Instances are stateless with respect to correctness: the per-room sequence is a Redis `INCR`, the reconnect check
reads the Redis counter (so a **freshly restarted gateway** still catches a client's gap — tested), presence lives
in Redis with PX expiry, fan-out is Redis pub/sub. Scale by adding instances behind sticky-less HTTP; nothing pins
a client to a node.

## 6. Channel Registry
Server rooms (`rooms.*`, never named by a client): `tenantBranch(t,b)`, `ownerTenant(t)`, `technician(id)`,
`ticket(id)`, `customer(id)`, `customerDisplay(sid)`, `platform()`.
Client channel vocabulary (§175, `CHANNELS` in the package): `branch.queue`, `branch.booking`, `branch.serving`,
`branch.checkout`, `technician.me`, `owner.dashboard`, `customer.me` — each mapped to registry event names only (tested).

## 7. Authorization
Guards decide who may *open* (TenantAuthGuard + `pos.login`; SuperAdminGuard). Rooms are derived from `req.ctx`
only — query/body `tenantId`, `branchId`, `role`, `room`, `channel` are never read (tested). Technician and customer
ids are resolved from the session by the realm repository. After open: session revocation (15 s poll) and
authorization-version revalidation (same poll) end the stream on change.

## 8–11. Isolation (tenant / branch / customer / technician)
Proven in `constitution-9-named-tests.vitest.spec.ts` against the real factory: Tenant A's stream receives nothing
of B across tenant, branch, queue, appointments, technicians, owner, checkout rooms; Branch A1 does not receive
A2 of the same tenant; Customer A never subscribes Customer B's room even when the request names it; a technician
gets their own room + branch, and their frames carry **no payload** (`frame: 'event-only'`, §22) — a test greps
the delivered frames for a customer name and phone and finds none.

## 12. Super Admin
`/super-admin/stream` subscribes to the platform room only and receives one event, `platform_ops_snapshot`, every
10 s while listening — active tenants, connections, payments/queue-joins/bookings per minute, gateway health.
Tests assert no identity of any kind in the serialized snapshot and that a branch/owner event never reaches a Super
Admin. **Support Mode (§225): BUILT, September 20.** The earlier note here said no support-session concept
existed in this tree. **That was wrong** — `super_admin_support_sessions` (`tenant_id`, `expires_at`,
`ended_at`) and `SupportSessionsService` already existed, so both named tests were buildable against the real
model. `support-session-realtime.ts` adds only the realtime half. Scope is checked at subscribe (a live session
for Tenant A refuses Tenant B, and throws rather than returning false, so a refusal is not mistakable for an
empty stream). Expiry rides the EXISTING authorization-version poll rather than a second timer — expiring,
ending or extending a session all change the version, and the 15 s revalidation terminates the open stream.
The source fails CLOSED, unlike that poll: a lookup error must not disconnect a salon of ordinary staff, but
"I could not check" is no reason to let a super admin into a tenant's data.

## 13. Event Contracts
`apps/api/src/realtime/realtime-core.ts` `EVENTS` — 77 names — is the registry; `packages/realtime-client/src/core.ts`
carries it verbatim and a parity test fails on any byte of drift.

## 14. Event Versioning
`EVENT_VERSIONS` (§27) — every registry event has a version (all 1 today); every frame carries `v`. Bump only on
an incompatible change; additive fields never need one (§245 tested, including the legacy numeric `Last-Event-ID`).
`check:realtime-contract` fails on an event without a version, a stale version, a duplicate name, an unrouted event,
or a client copy that differs by a byte.

## 15. Domain Event Projection
Constitution 8's `RealtimeProjectionConsumer` was already the projection layer (§3/§9). Phase 20 adds
`PlatformLiveOpsConsumer` (REPLAY_SAFE, reads nothing from payloads). Domain events never reach clients raw.

## 16. Redis / 17. Durability
`RealtimePubSub` port: `publish/subscribe/nextSeq/currentSeq`. Pub/sub is a delivery mechanism, not a store (§10):
nothing is replayed from it; a missed message is detected by sequence and recovered by snapshot (§11). Publish
failure → local delivery + `backbonePublishFailures` (feeds the health verdict as INCIDENT at ≥5).

## 18–19. Snapshot Recovery and the Race
Snapshot APIs are the existing screen endpoints (the client refetches by `screens`). Race solution: the client
baselines its sequence from the `connected` hello (`seqs` per slot) *then* refetches; any frame after the hello
with a gap forces another refetch. Subscribe-then-snapshot, never the reverse.

## 20. Resource Versioning
`EventTracker.shouldApply` — envelope `version` per `(resourceType, resourceId)`; older versions dropped (§229 tested: 9 then 8 → stays 9).

## 21–22. Sequence Numbers and Gap Detection
Every room, every stream. Minted once at the origin (Redis `INCR`); frames carry `seq` + `stream` slot; SSE `id` is
the vector `r0:42|r1:7`. Client: one `SequenceTracker` per slot; gap → `reconcile('sequence_gap')`; duplicate → dropped.
Server: reconnect compares every slot to the shared counter — behind **or ahead** ⇒ `resync_required` (ahead means
the counter was reset under the client, §237).

## 23. Reconnect
Client-owned: `reconnectDelayMs` exponential with full jitter, cap 30 s; native EventSource retry not used. Reopen
→ `reconcile('reconnected')` always (§34).

## 24. Session Revocation / 25. Permission Changes
`untilSessionRevoked` (existing) and `untilAuthzChanged` (new) on the same 15 s poll; version = sha256 of role,
home branch, user/tenant/branch status, sorted branch-access set. Proven on real Postgres.

## 26. Presence
Ephemeral registry (in-memory or Redis PX), TTL 90 s refreshed by the 25 s heartbeat write, states
ONLINE/AWAY/BACKGROUND, reports throttled to 1/10 s, own connection only. **Not a time clock (§49) — enforced by a
test that greps the presence sources for clock-in/shift/attendance/punch.**

## 27–31. App Wiring
- **POS:** `useRealtime(screen)` unchanged for 17 screens (booking board, customer queue, tech queue, serving, checkout all route by `screensToRefetch`); fallback poll now conditional.
- **Technician:** `useTechStream` adapter; assignment/help/follow-up/earnings via the technician room, event-only frames.
- **Owner:** `useOwnerStream` adapter; dashboard/alerts/payroll via the owner room + branch room.
- **Customer:** `useCustomerStream` adapter; self room + checked-in branch.
- **Super Admin:** `useSuperAdminStream`; Live Operations block on System Status with the §192 state line.

## 32. Mobile Background
Not in this tree. The client honours `visibilitychange` (AWAY report, reconcile on ≥30 s hidden) which is the web
half; the Capacitor half belongs to the mobile arc.

## 33. Fallback Polling
`FallbackPoller`: starts only after 15 s unavailable, interval ≥5 s (500 ms refused at construction), stops the
instant the stream is CONNECTED, reports state for the §192 line. Replaces three always-on polls.

## 34. Backpressure / 35. Rate Limits / 36. Security
`SlowClientGate` on `res.writableLength`: drop over 256 KB, one `resync_required{slow_client}` on drain, cut after
30 s over. `ConnectLimiter` 30 opens/min per principal → 429 + `retryAfterMs`. Origin allow-list shared with CORS,
enforced **before** the stream opens (403). Presence reports throttled server-side.

## 37. Observability
`RealtimeMetrics.snapshot()`: active connections, events/min, latency p50/p95/p99, reconnects/min, resyncs,
authz terminations, slow-client drops/resyncs/disconnects, origin rejections, connect rate-limits, backbone publish
failures, auth-failures/min. `evaluateRealtimeHealth` → OPERATIONAL/IDLE/DEGRADED/INCIDENT with signals; on the
Super Admin System Operations → Realtime endpoint and in every `platform_ops_snapshot`.

## 38–42. Test Results (all on this run)
| Suite | Result |
| --- | --- |
| Failure tests (§236 fresh gateway, §237 counter reset, §237 backbone down, §233 slow client, §208-style poison N/A) | pass |
| Cross-tenant / branch / customer / technician / platform isolation | pass (11 named tests) |
| Out-of-order (§229) / duplicate (§228) / gap (§230) | pass |
| Reconnect (client fake-EventSource: drop, backoff, reopen-reconcile; server: vector Last-Event-ID) | pass |
| Load: 2,000 principals open+close → 0 subscribers, 0 presence entries, < 5 s; one branch event → 1,000 devices / 50 branches, only the 20 on that branch, < 50 ms in-process | pass |
| realtime module 101 · package 11 · owner 262 · tech 117 · customer 267 · admin-web 782 · pos-web 736 | pass |
| **Full API battery, all 8 shards, after the factory refactor** | **6,306 passed, 0 failed** (880 · 764 · 779 · 762 · 766 · 811 · 845 · 699) |
| Migrations on real Postgres · `check:sql-identifiers` 0 unknown · `check:realtime-pushes` 37/4 · 13/13 gates | pass |
| Typecheck: api + five web apps + package | 0 errors |
| `e2e:html` 5 apps / 38 calls in real Chromium | green 2/2 |

One pre-existing test failed on the full battery and was updated, not deleted: `cors-native-origins` asserted that
`main.ts` builds the CORS list inline with `nativeOrigins()`. The list now has one source (`common/allowed-origins.ts`)
shared with the gateway's pre-open origin check; the test now guards *that* — `nativeOrigins()` feeds the shared
list, `main.ts` consumes it, and `main.ts` contains no second copy.

## 43. Capacity — measured (§242/§243)
`npm run measure:realtime-capacity` (`--n=` to vary) against the real factory in a real Node process, after
`npm run build`. Two runs on this machine:

| | 2,000 streams | 5,000 streams |
| --- | --- | --- |
| Open (incl. room resolution + presence registration) | 334 ms | 554 ms |
| Heap growth | 7.3 → 22.6 MB | 7.3 → 45.3 MB |
| **Per connection** | **7.8 KB** | **7.8 KB** |
| Close all | 240 ms | 276 ms |
| Retained after close | 665 B/conn | 507 B/conn |
| Subscribers / presence entries after close | 0 / 0 | 0 / 0 |
| Fan-out, steady state | p50 11 µs to 10 subs (1.1 µs each) | p50 21 µs to 25 subs (0.8 µs each) |

Per-connection cost is flat from 2 k to 5 k and fan-out is linear in subscribers, so the gateway's own overhead is
not the limit. **Caveats, stated rather than implied:** (1) this measures the gateway's structures, not an SSE
socket — a real connection also holds an OS socket and Node's HTTP response buffer, so 7.8 KB is a floor, not a
capacity plan; (2) the residue after close (~0.5 KB × N) is V8 not having collected everything at that instant,
not a leak — subscribers and presence entries are both exactly 0; (3) numbers are machine-specific.

**A measurement error worth keeping:** the first fan-out reading was 1,314 µs for 25 subscribers. That was JIT
warm-up — after 50 warm-up calls the steady-state p50 is 21 µs, sixty times faster. The script now warms up and
takes 200 samples. A single timed call would have been published as the real cost.

## 44. Files Changed (17)
realtime.gateway.ts · realtime-bus.ts · realtime-core.ts · realtime.controller.ts · realtime.module.ts ·
owner-realtime.controller.ts · tech-realtime.controller.ts · customer-realtime.controller.ts ·
customer-realtime.vitest.spec.ts · super-admin-system-status.module.ts · main.ts · di-check.mjs ·
consumers.module.ts · pos-web realtime-core.ts / realtime-client.ts / useRealtime.ts / useRealtime.test.tsx /
realtime-resilience.test.tsx · useOwnerStream.ts · useTechStream.ts · useCustomerStream.ts · SystemStatusScreen.tsx/.test.tsx ·
tsconfig/vite/vitest of five apps.

## 45. Files Created (19)
realtime-stream.ts · authz-revalidation.ts (+2 specs) · presence.ts · presence.controller.ts · platform-live-ops.ts ·
realtime-health.ts · allowed-origins.ts · super-admin-realtime.controller.ts · useSuperAdminStream.ts ·
packages/realtime-client (package.json, tsconfig, vitest.config, src/core.ts, client.ts, react.ts, index.ts, client.test.ts) ·
specs: realtime-sequence, realtime-resync, slow-client, gateway-security, realtime-health, realtime-stream,
platform-live-ops, constitution-9-named-tests.

## 46. Infrastructure Changes
None required to run. Optional: `REALTIME_REDIS_URL` (or `REDIS_URL`) switches presence to Redis; the fan-out was
already Redis-optional. No migrations. No new tables (§111).

## 46a. §246 CI contract · §247/§248 catalog · §251 runbooks (added after the first draft)
`npm run check:realtime-contract` (14th gate) — mutation-tested against all four fault classes. Its first run
found **17 registry events with no screen routing**: they reached the POS with an empty `screens` list and
refetched nothing (`ticket_service_line_*`, `ticket_total_recalculated`, `service_paused/resumed`,
`ticket_change_request_*`, membership and rating events, `tenant_status_updated`,
`customer_display_signature_captured`). All routed now. `npm run docs:realtime-catalog` generates
`REALTIME_EVENT_CATALOG.md` (50 events × name/version/source/audience/permission/recovery/sensitivity; 8 channels
× type/actors/permission/scope/room/events/snapshot API). `REALTIME_RUNBOOKS.md` holds the eight §251 runbooks,
each tied to real signals and endpoints.

## 46b. Off-registry emissions (found by extending the gate)
Cross-checking the server's screen vocabulary against `useRealtime('…')` in pos-web showed two POS screens —
`cash-drawer`, `cash-handoffs` — subscribed to names **no event routed to**. The cause was worse than a missing
route: four modules (`cash-drawer`, `tech-cash-handoff`, `skip-line-checkout`, `ai-queue-assignment`) were pushing
**27 event names that were not in the registry at all**, through private wrappers typed `event: string` with
`event as any` at the call site — the `EventName` type existed and was being cast around. Every one of those
frames reached clients with an empty `screens` list and refetched nothing: a cash drawer opened on one POS never
updated another; an AI queue alert never refreshed the screen built to show it. The registry is now 77 events, the
four wrappers are typed (`EventName`, no casts; the AI adapter maps its domain-style port names to wire names), the
POS AI-queue screen subscribes, and `check:realtime-contract` fault class 5 — any `*_EVENTS` value, emitter literal
or `event as any` outside the registry — keeps it that way.

## 46c. The merge tooling found a fifth client and a sixth/seventh endpoint
`npm run check:realtime-infra-duplicates` (15th gate; `--root=` runs it on any tree) counts *definitions* of every
realtime concept against what this arc legitimately left, so a merged tree shows exactly what to reuse or replace.
Its control run here found what three discovery passes had missed: `apps/customer-display` had its own
`EventSource` client (polling every 4 s unconditionally, reloading on every heartbeat) and two SSE endpoints
(checkout session, mounted device) not on the factory. Both endpoints now open through `RealtimeStreamFactory`
— which learned a `forbidden` outcome for a resolver that refuses a session token — and the display hook is an
adapter over the package (fallback at §191's 5 s floor, only while unavailable). `REALTIME_MERGE_GUIDE.md` holds
the per-concept decision table and the surprises this arc hit that the merge will hit too.

## 46d. The other direction: registry events with no producer
Having fixed events emitted under unregistered names, the mirror question — registry names nothing emits — found
seven. `owner_alert_created` was the real one: `owner_alert_updated` fires on status change (`owner.service.ts`),
but the three places that actually INSERT an owner alert (cash-drawer, tech-cash-handoff and skip-line-checkout
repositories, all cash discrepancies) wrote the row silently, so a new cash alert never reached an open Owner App
— the owner saw it only on their next manual refresh. Each service now emits `owner_alert_created` beside the row
write, and the gate confirms the name left the list.

Then I checked whether the remaining six were really "product work" or just unexamined. Four had exactly one
unambiguous site and no decision to make, and each was a real staleness bug:

| Event | Producer added | What was stale |
| --- | --- | --- |
| `checkout_total_recalculated` | `CheckoutService.recalculate()` | a tip or discount applied on one POS never reached a second POS open on the same ticket |
| `payment_processing_started` | the claim-first in-flight row in `payCard()` | other devices on that ticket showed a stale total instead of "processing" during a card attempt |
| `receipt_sent` | all three success paths in `sendOne()` (sms / email / app) | nothing told the checkout screen a receipt had gone out |
| `tenant_status_updated` | `SuperAdminTenantsService.changeStatus()` | a tenant paused or reactivated by Super Admin left every open POS and Owner App on the old state (§43 already *ends* streams on a non-active tenant; this covers reactivation) |

Each new producer has a test that fails when the emit is removed (mutation-checked, all three: recalculate,
receipt send, tenant status). The receipt pair is the one worth noting — a receipt that **sends** emits, a receipt
that returns `not_configured` emits **nothing**: an event claiming a receipt went out when none did would be worse
than silence. The `tenant_status_updated` payload carries the *persisted* status, not the requested target
('paused' is a Super Admin verb that stores as 'suspended') — the test asserts the stored truth, which is what a
refetching client should see.

**Two remain and stay unwired deliberately:** `technician_earnings_updated` (earnings are recomputed in several
modules — tech, payroll, membership compensation — with no single "earnings changed" moment) and `settings_updated`
(a dozen settings screens across as many modules). Both need a product decision about where the fact occurs, not a
guess from me. The gate keeps listing them as NO PRODUCER so they stay visible.

Also wired this pass: `POSCustomersReportScreen` and `POSCustomerProfileScreen` now subscribe to the `customers`
screen name — `ticket_paid`, `customer_profile_updated` and `loyalty_points_added` route there, and an open
customer profile used to show whatever was fetched when it was opened.

## 46e. The client side of the same question
Server vocabulary is now gated in both directions (emitted-but-unregistered, registered-but-unemitted). The
client side asks it a third way: does an app compare an incoming event against a name the server never sends?
A first sweep over every snake_case comparison returned 162 hits and was useless — status enums, modes and
error codes all look like event names. Scoping the scan to the **callbacks of the realtime hooks** returned two,
and both were real: three Owner App cash screens tested `ev === 'fallback'`, a signal neither the old hook nor
the new one has ever emitted (the fallback path has always reported `'reconcile'`). Harmless, but it implies a
contract that does not exist, so it is removed.

`check:realtime-contract` fault class 7 now fails on any realtime-callback comparison against a literal that is
neither a registry event nor one of the client control signals. Mutation-checked with a plausible typo
(`cash_drawer_openned`), which it reports by name and file.

## 46f. A whole room with no subscriber
Fourth direction: does anything publish to a room no stream joins? **`rooms.ticket()` had two publishers and zero
subscribers.** Constitution 8's projection consumer has been fanning `ticket_service_line_added/updated/removed`
to the ticket room specifically for the Customer App — and no stream ever subscribed to it, so every one of those
frames was delivered to nobody. The Customer App's `VisitScreen`, where a customer watches their own service,
polled every 15 seconds instead.

The customer stream now resolves the customer's **active ticket** from the session (like every other room, §13)
and subscribes to it; `VisitScreen` listens for the service-line and service-status events and its unconditional
poll is replaced by the shared client's fallback. A customer with no visit in progress simply gets two rooms.

`check:realtime-contract` fault class 8 compares publishers against subscribers per room type. **It took three
tries to make it non-vacuous, and only mutation testing caught that:** publishers call `toTicket(...)` not
`rooms.ticket(...)`, so the first version saw no publishers; the second rejected the consumer file because a
guard looking backwards for the word "interface" matched the port declaration above the call; the third still
passed because a *comment* in the controller mentioning `rooms.ticket(id)` made the file look like a subscriber.
It now strips comments and matches calls by leading dot. A check that cannot fail is worse than no check.

## 47. Remaining Risks / 48. Next Phases
See the DoD below. In order of value: (1) land on `Power-Salon-main` and re-run `check:event-infra-duplicates` —
the Permissions Constitution may already have an authorization version there, in which case `authz-revalidation.ts`
should read it instead of deriving one; (2) — Support Mode (§225) is now built, see above; (3) the
Capacitor apps adopt `@aipowersalon/realtime-client` (Phases 17/19 mobile halves); (4) per-event `version` (§27);
(5) a real-instance soak under a real HTTP server with real sockets — §43 measures the gateway's own overhead, not the socket's.

Added after the report was first written: graceful drain (above). Not a process-level test — a real SIGTERM
against a running instance with connected browsers is the environment-bound half.

---

## §254 Definition of Done — honest pass/fail

| Item | | Note |
| --- | --- | --- |
| Existing realtime fully inspected | ✅ | after two corrections (four gateways; three more clients) |
| Duplicate realtime clients identified | ✅ | four → one package |
| Realtime Gateway standardized | ✅ | `RealtimeStreamFactory` |
| Transport strategy documented | ✅ | SSE preserved, revisit trigger named |
| WebSocket operational transport works | ❌ | deliberately not built (§4/§94–95); SSE covers every current need |
| SSE used only where appropriate | ✅ | everywhere, by decision |
| Horizontally scalable / Redis fan-out | ✅ | seq via Redis INCR; reconnect reads the shared counter |
| Tenant / branch / user / customer / platform channels standardized | ✅ | `rooms.*` + `CHANNELS` |
| Every subscription authorized; tenant/branch/customer-SELF/technician-ASSIGNED enforced | ✅ | named tests |
| Support Mode realtime scoped | ❌ | no support-session concept in this tree |
| Domain events separated; projection layer; typed registry | ✅ | Constitution 8 + parity test |
| Realtime event versioning | ✅ | `EVENT_VERSIONS` + `v` on every frame; gated |
| Payload schema validation | ⚠️ | forbidden-key stripping + 32 KB cap exist; no per-event schema |
| Resource versions; sequence/gap detection | ✅ | |
| Snapshot APIs; snapshot+stream race solved | ✅ | existing screen endpoints; baseline-then-refetch |
| Reconnect / backoff / jitter / storm protection | ✅ | |
| Session revocation; permission change; tenant suspension | ✅ | branch deactivation too |
| Branch switching / tenant switching handled | ⚠️ | a switch is a new session ⇒ new stream; no in-stream switch |
| Presence implemented safely; TTL works | ✅ | Redis store untested in sandbox |
| Mobile background; push/realtime interaction | ❌ | not in this tree |
| Fallback polling works / stops after reconnect | ✅ | |
| Backpressure; slow-client; coalescing; connection limits; noisy-neighbour | ✅ | message size cap from Constitution 8 |
| Graceful gateway shutdown | ✅ | `RealtimeStreamFactory.drain()` on `OnApplicationShutdown` (hooks enabled in `main.ts`): every live client gets `reconnect_requested{jitterMs}` and its stream completes; late opens are redirected with a finite stream; the client reopens within the jitter window, not the backoff ladder |
| Autoscaling metrics defined; structured logging; correlation IDs | ⚠️ | metrics yes; realtime frames carry no correlation id |
| Realtime monitoring; Super Admin Realtime Status | ✅ | |
| Cross-tenant / branch / customer / revocation / duplicate / out-of-order / gap / gateway-failure / Redis-failure / storm / slow-client / load tests | ✅ | in-process; §236/§237 modelled with a shared counter, not real infrastructure |
| Build / typecheck / lint pass | ✅ | api, five web apps, package |

## Capacitor app adoption of `@aipowersalon/realtime-client` (§174) — closed, September 20

Five of the six Capacitor apps use the shared client: customer-display, customer-web, owner-web, tech-web and
(as of today) manager-pay-web. They resolve it through a vite alias plus tsconfig `paths` to
`packages/realtime-client/src` — note that **vitest does not inherit the vite config**, so the alias has to be
declared in all three files or tests fail to resolve the import while the app builds fine.

**manager-pay-web** was the real gap. `CheckoutQueueScreen` loaded once on mount and never refreshed, so a
manager could tap a ticket the front desk had already taken payment for. It now rides `/realtime/stream` — the
**existing** POS stream, not a seventh SSE endpoint — because the only roles that reach that app, OWNER and
MANAGER, resolve to `pos.login` as well as `mobile_checkout.login`. (A raw grep of `ROLE_PERMISSIONS` says
otherwise; the permissions arrive via spread constants, so the resolved list is what counts.)

**go-check-in-kiosk needs no adoption, and that is the finding — not an omission.** It is a Capacitor shell
around a single static page running a linear, write-oriented flow: look up a phone, check in, choose services,
choose a technician, done. Its only `setInterval` is a session heartbeat. Nothing stays on screen long enough
for another device to invalidate it, so a stream there would be machinery nothing reads.

