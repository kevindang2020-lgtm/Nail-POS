# REALTIME_RUNBOOKS.md
### Constitution 9 §251 — operational runbooks for the realtime layer (Sep 19, 2026)

Every runbook below points at things that exist in this tree: the Super Admin **System Operations → Realtime**
endpoint (`GET /super-admin/system-status/realtime`), its tenant detail (`…/realtime/tenant/:tenantId`), the
`platform_ops_snapshot` stream, the `RealtimeMetrics` counters, and the incident thresholds in
`apps/api/src/realtime/realtime-health.ts` (`THRESHOLDS` — incident thresholds, not SLOs; tune from production).

**What "normal" looks like:** `status: OPERATIONAL`, `signals: []`, `reconnectsPerMinute` ≈ number of devices that
lost Wi-Fi in the last minute (single digits), `resyncsRequired` growing only after real disconnects,
`latencyP95Ms` under a few hundred ms, `backbonePublishFailures` flat at its last value.

---

## RB-1 · Gateway outage (one instance down)
**Detect:** connections on the instance drop to 0; other instances' `reconnectsPerMinute` spike briefly; if the
instance shut down gracefully, clients received `reconnect_requested` and spread over 2 s of jitter.
**Impact:** none to correctness — sequences are minted in Redis, so a client landing on another instance is checked
for a gap against the shared counter and told to resync if behind (tested: §236).
**Do:** confirm the surviving instances' `status` is OPERATIONAL. If `reconnectsPerMinute` ≥ 60 on one instance
(`reconnect storm` signal) it is absorbing the whole fleet — add an instance; the limiter (30 opens/min per
principal) protects the event loop meanwhile.
**Don't:** restart the surviving instances "to be safe"; that repeats the storm.
**After:** nothing to replay. Screens refetched on resync.

## RB-2 · Redis Pub/Sub outage
**Detect:** `backbonePublishFailures` climbing → `status: INCIDENT`, signal `redis backbone: N publish failures`.
Presence counts on the Super Admin page freeze or drop (Redis-backed presence).
**Impact:** delivery falls back to **local** — each instance still delivers to its own clients, but an event produced
on instance A does not reach clients on instance B. Sequences fall back to per-instance counters, so cross-instance
numbering diverges until Redis returns. **PostgreSQL state is unaffected** (§17/§237): realtime is a projection.
**Do:** restore Redis. Clients whose counter position no longer matches (behind *or* ahead) are told to resync on
their next reconnect; force it fleet-wide by rolling the gateways one at a time (graceful drain → clients reconnect
→ resync against the recovered counter).
**Don't:** flush the `aps:rt:seq:*` keys by hand; a reset counter is exactly the "ahead" case the resync handles,
but resetting under load makes every client resync at once.

## RB-3 · Reconnect storm
**Detect:** signal `reconnect storm: N/min` (≥ 60), `connectsRateLimited` climbing.
**Cause candidates:** a proxy/LB idle-timeout below the 25 s heartbeat; a bad deploy that 500s the stream; a network
event at one salon (many devices, one tenant — check `…/realtime/tenant/:tenantId` `presence.total` vs before).
**Do:** if it is one tenant, it is their network — no action beyond confirming their POS shows "Reconnecting…" and
recovers. If fleet-wide, check the LB idle timeout (must exceed 25 s + slack) and the last deploy. The client backoff
(exponential, full jitter, 30 s cap) and the per-principal limiter (429 + `retryAfterMs`) keep the gateway alive
while you look.
**Don't:** raise the limiter to "make the errors stop" — 429s are the protection working.

## RB-4 · Subscription denial spike
**Detect:** `authFailuresPerMinute` ≥ 30 → signal `auth/origin failure spike`; break it down: `originRejected`
(cross-site attempts — §196), `connectsRateLimited` (one principal looping), `authzTerminations` (permissions
changed under many streams at once — e.g. a bulk role edit).
**Do:** `originRejected` spike from one Origin = someone embedding the stream cross-site; block at the edge, the
gateway already refuses. `authzTerminations` spike after an admin action is expected and self-heals (clients
reconnect and re-authorize). `connectsRateLimited` on one `userId` = a client in a tight loop; find the device
via `…/realtime/tenant/:tenantId` and its `deviceId`.
**Cross-tenant attempt:** rooms are server-derived, so there is no client-side way to *request* another tenant's
room — a "cross-tenant subscription" can only be a server bug. Treat any tenant-A client receiving a tenant-B
event as a Sev-1: it means `req.ctx` was wrong (auth middleware), not the gateway. See RB-8.

## RB-5 · High event lag
**Detect:** `latencyP95Ms` ≥ 3 000 → DEGRADED, ≥ 15 000 → INCIDENT (`event lag p95`). Lag is measured from the
envelope's `updatedAt` to delivery on this instance.
**Cause candidates:** the outbox publisher behind (Constitution 8: `GET /super-admin/events/health` outbox lag);
Redis slow; an instance's event loop pegged (check `slowClientDrops` — one stuck client cannot cause this, the
gate drops rather than queues).
**Do:** check the outbox lag first — if the publisher is behind, realtime is merely reporting it honestly. Then Redis
latency. Then instance CPU.
**Don't:** confuse lag with loss. Lag is late delivery; a client sees every event eventually. Loss shows up as
`resyncsRequired`, not latency.

## RB-6 · Memory saturation on a gateway
**Detect:** RSS climbing without a matching rise in `activeConnections`.
**Bounded by construction:** per-connection write buffer is capped by the slow-client gate (256 KB → drops, 30 s →
disconnect); the emission log is 200 entries; rate buckets are 10 minutes; presence expires at 90 s; the connect
limiter's map is capped at 10 000 principals.
**Do:** compare `connectionsOpened − connectionsClosed` to `activeConnections`. If they diverge, a stream is not
tearing down — capture a heap snapshot and look for `InProcessEmitter.subs` growth. The §244 churn test proves
2 000 open/close cycles leave zero subscribers; a leak here would be new code.
**Mitigate:** graceful drain the instance (`SIGTERM` → clients move with jitter) and replace it.

## RB-7 · Too many connections
**Detect:** `activeConnections` far above the device count you expect (`connectedTenants × devices`). Compare with
the presence registry: `GET /super-admin/realtime/presence` gives `connections` and `tenants` platform-wide;
`…/realtime/tenant/:tenantId` shows `posDevices` and `technicianApps` per tenant.
**Cause candidates:** a POS with many duplicate tabs (each tab is a connection — §241; harmless but costly);
a client reopening without closing (the package client closes before reopening; a hand-rolled one might not).
**Do:** find the tenant with the highest `presence.total` relative to its branch count; a single `deviceId` with
many entries is the duplicate-tab case. The connect limiter caps each principal at 30 opens/min, so growth is
bounded by principals, not by a runaway loop.

## RB-8 · Cross-tenant subscription incident
**This should be impossible.** Rooms are derived from `req.ctx` (auth middleware, which strips client-supplied
tenant keys), the technician/customer ids are resolved from the session, and `constitution-9-named-tests` proves
tenant A receives nothing of B across every room type.
**If it happens anyway:** (1) drain and stop the affected instance immediately (graceful shutdown moves clients);
(2) preserve its logs — the auth middleware is the suspect, not the gateway; (3) confirm from the frames whether a
*payload* crossed or only an event name (technician/customer streams are event-only, so exposure may be a refetch
signal with no data); (4) rotate the affected users' sessions (session revocation ends their streams within 15 s);
(5) run the isolation suite against the build that was deployed: `npx vitest run src/realtime/constitution-9-named-tests`.
Do not resume until the test explains the failure.

---

### Quick reference
| Signal | Threshold | Runbook |
| --- | --- | --- |
| `redis backbone: N publish failures` | ≥ 5 | RB-2 |
| `reconnect storm` | ≥ 60/min | RB-3 |
| `auth/origin failure spike` | ≥ 30/min | RB-4 |
| `event lag p95` | ≥ 3 s / ≥ 15 s | RB-5 |
| `N slow client(s) disconnected` | informational | RB-6 |
