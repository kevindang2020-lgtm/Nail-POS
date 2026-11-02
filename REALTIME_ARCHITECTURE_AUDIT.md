# REALTIME_ARCHITECTURE_AUDIT.md
### Constitution 9 — Phases 1–3: Discovery, Inventory, Transport Decision (Sep 19, 2026)

> **Status — BUILD_PLAN Phase 15 (Oct 10 2026): Constitution 9 COMPLETE.** `check:realtime-contract`: 102 events, all
> versioned, routed and **produced**. NO PRODUCER is now a gate FAILURE (it was report-only). Its last entry,
> `settings_updated`, was a blind spot of the gate, not a missing producer: the canonical tenant settings save
> (`PosSettingsService.patchCategory`) and six other `tenant_settings` writers emit it through `notifySettingsChanged`
> (`packages/realtime-contracts/src/settings-changed.ts`), a package the producer scan never read. The gate now counts a
> server call to a package helper that emits. Delivery: the saving tenant's OWNER room, which the Owner App stream
> (`/owner/stream`, `owner.dashboard` channel) subscribes to. `REALTIME_EVENT_CATALOG.md` regenerated (it still said 79 events).

Same base-tree caveat as Constitution 8: built on the July snapshot, not `Power-Salon-main`. The realtime
layer here is the one Constitution 8's projection consumer feeds, so the two arcs land together.

---

## Phase 1 — Discovery (every line grep-verified)

| Constitution asks about | What exists |
| --- | --- |
| WebSockets / Socket.IO | **None.** Zero usage in `src/`. |
| SSE | **Yes — the transport.** `realtime.controller.ts` serves `text/event-stream`; chosen deliberately (comment in file): server→client only, rides the existing HTTP/Vite proxy, browser `EventSource` reconnects natively. |
| Polling | Not the primary mechanism; `pos-web` refetches *on reconnect* (a snapshot pull, not a poll loop). |
| Redis Pub/Sub | **Yes.** `realtime-bus.ts` wraps the per-node `InProcessEmitter` with Redis publish/subscribe so an emission on node A reaches subscribers parked on node B (§9). In-memory fake bus for tests; optional by flag. |
| Frontend hooks | `pos-web/src/realtime/` — `realtime-client.ts` (103 lines), `useRealtime.ts`, `RealtimeStatusPill.tsx`. **Correction (found during Phase 15):** `owner-web/src/api/useOwnerStream.ts` (85 lines), `tech-web/src/lib/useTechStream.ts` (35), `customer-web/src/api/useCustomerStream.ts` also existed — three more hand-rolled clients of differing quality, none with sequence numbers. `admin-web` has none. |
| Mobile realtime | Not present in this tree (the Capacitor apps live under the mobile constitution arc, built elsewhere). |
| Super Admin realtime | None — Super Admin screens are request/response. **Correction:** the SERVER had four SSE endpoints (`/realtime/stream`, `/owner/stream`, `/tech/stream`, `/customer/stream`), each hand-rolling its own frame loop; my first pass searched only `src/realtime/` and found one. §7 was violated by construction — four gateways, one of them hardened. |

### The one-line diagnosis
The gateway, backbone, rooms, envelope and a resilient POS client **already exist and are sound**. What is
missing is what lets a client *know it has the truth*: no sequence numbers, so a missed emission is
invisible (the client dedupes and guards version regression already, but cannot see an absence); no presence; no permission-change
revalidation while a stream is open; no shared client, so three of four web apps have no realtime at all.

---

## Phase 2 — Inventory

### Server (`apps/api/src/realtime/`)
| Piece | State | Constitution |
| --- | --- | --- |
| `InProcessEmitter` rooms: `tenantBranch`, `technician`, `ticket`, `customerDisplay`, `owner`, `customer` | ✅ | §12–18 (channel architecture, per-audience rooms) |
| Room names are **server-derived** from the authenticated context; the client never names a room | ✅ | §13 (never trust client channel names) |
| `makeEnvelope`: `eventType, tenantId, branchId, resourceType, resourceId, updatedAt, version, data` | ✅ partial | §20 envelope; §29 `version` present but not consistently populated by producers |
| `FORBIDDEN_PAYLOAD_KEYS` + `payloadViolations` (pan/cvv/password…) | ✅ | §22, §253 |
| 44 client event names + `screensToRefetch` map | ✅ | §25–26 registry — **no per-event version (§27)** |
| Session revocation terminates a live stream within ~15 s (`sse-session-guard.ts`) | ✅ | §41 |
| Heartbeat stream merged into every connection | ✅ | §53 |
| `Last-Event-ID` on reconnect | ⚠️ | §36 — treated as "this is a reconnect", **not used for replay** |
| Bounded 200-entry emission log | ⚠️ | tests/diagnostics only — **not a replay window (§11)** |
| Redis pub/sub backbone with per-connection exactly-once local delivery | ✅ | §9, §89 |
| Constitution 8 projection consumer → this emitter (4 scopes) | ✅ | §3, §9 Phase 9 "consume domain events through projection layer" — **already done** |
| Tenant isolation + envelope tests | ✅ | §220 partial |

### Client (`apps/pos-web/src/realtime/`)
| Piece | State | Constitution |
| --- | --- | --- |
| Reconnect → dispatch `reconcile` → screens refetch | ✅ | §34–36 snapshot + stream |
| Exponential backoff **with jitter**, owned client-side (native EventSource retry is fixed-interval, herd-prone) | ✅ | §37–38 |
| `visibilitychange` / `online` wake; refetch after ≥30 s hidden | ✅ | §163 |
| Burst coalescing to one refetch per screen | ✅ | §99 |
| Shared across apps | ❌ | §174 |
| Sequence gap detection → resync | ❌ | §31–33 |
| Resource-version regression guard (`EventTracker.shouldApply`, envelope `version`) | ✅ | §29–30 — *my first pass marked this missing; it exists* |
| Duplicate-event dedupe by envelope `eventId`, bounded LRU | ✅ | §182–183 — *same correction* |

### Gaps, server side
§27 event versioning · §31–33 sequence numbers + gap detection + `RESYNC_REQUIRED` · §42/§128 permission
revalidation on open streams · §48–53 presence with TTL · §98/§102 slow-client cap · §113 connection registry ·
§140–145 metrics and health · §149–150 connect rate limiting · §196 origin validation.

---

## Phase 3 — Transport Decision: **preserve SSE**

§6 states a preference for WebSocket for tenant operational realtime. This audit preserves SSE, which §252
Phase 3 explicitly allows ("choose/**preserve** per use case"), for reasons the constitution itself supplies:

1. **§4 requires business mutations to go through authenticated HTTP anyway**, and warns against making socket
   handlers "a second parallel business API". §94–95 allow socket commands only when a specific realtime
   command *genuinely* requires one. Nothing in the 44 client events needs client→server traffic on the
   stream — every one is a server→client refresh signal.
2. **Bidirectionality is WebSocket's only advantage here**, and the constitution says not to use it for the
   thing it would be used for.
3. The existing SSE gateway is **working, tested, multi-instance-safe and session-revocation-aware**.
   Migrating means rewriting it and every frontend for a property the design forbids exploiting.
4. §6 itself: "Do not maintain multiple competing transports for the same operational feature." Adding
   WebSocket alongside SSE would violate that; replacing SSE would discard a sound implementation.

**Revisit trigger:** the first realtime *command* that §95 would justify (e.g. a presence heartbeat that must
carry client state, or an interactive ack). Until then, SSE is the transport, and the constitution's
sequencing, presence, revalidation and client-SDK requirements are transport-independent and are built next.

---

## Phase 4 — one gateway (done after the correction above)
`RealtimeStreamFactory.open(req, resolveRooms, { frame })` now opens every stream. A controller says only WHICH
rooms its principal gets (server-derived, §13); sequence numbers, vector `Last-Event-ID`, resync, slow-client
gate, origin check, connect limit, presence, session revocation and authorization revalidation apply to all
four. Realm frames are event-only (§22); the POS and Owner frames carry payload.

## What Phases 4–23 will and will not do
The gateway (Phase 4), Redis backbone (10), snapshot recovery (11), reconnect (13) and event-architecture
integration (9) **exist** and are hardened, not rebuilt. The build concentrates on the correctness gaps:
sequence/version handling (12), presence (14), the shared client SDK (15), permission revalidation, the
slow-client cap, rate limiting, origin validation, observability (22) and the named tests (23).
