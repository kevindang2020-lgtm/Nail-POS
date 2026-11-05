# MULTI_INSTANCE_SCALING — running AIPowerSalon API on more than one node

Two pieces of state were process-local and had to become shared before the API can run behind a load balancer with 2+ instances. Both already had a port/interface; this adds Redis-backed implementations behind those same interfaces and selects them by env. **Single-node behavior is unchanged and is still the default** — nothing here activates unless you opt in.

## 1. Realtime push bus (SSE) — cross-node fan-out
A browser's `EventSource` is connected to exactly **one** API node. With the in-process bus, a payment or queue change handled on node A only reached SSE clients parked on node A; clients on node B never updated until they refetched.

**Now:** when `REALTIME_BUS=redis`, the emitter (`RedisRealtimeEmitter`, behind the existing `RealtimeEmitter` interface) wraps the per-node in-process bus and adds Redis pub/sub:
- `emit` → `PUBLISH {room,event,payload}` to one channel.
- every node's `SUBSCRIBE` handler → `deliverLocal(room, …)` to **its own** connected SSE clients.

Because every node — including the emitter's own — delivers only when the message comes back over the channel, each connection receives the event **exactly once** (no origin tagging or de-dup). A `PUBLISH` failure falls back to local delivery, so a Redis hiccup degrades to "this node's clients still update" instead of dropping the event. Tenant+branch room scoping is unchanged, so isolation holds across nodes.

## 2. Login brute-force lockout — shared failure history
The failed-attempt lockout (5 failures / 15 min, keyed per portal+salon+identifier+ip) stored timestamps in process memory, so attempts spread across nodes never accumulated to a lock.

**Now:** when `LOGIN_THROTTLE_STORE=redis`, `RedisLoginThrottle` (behind the existing `LoginThrottlePort`) keeps the failure timestamps in a Redis sorted set per key — `ZADD` on failure, window prune via `ZREMRANGEBYSCORE`, idle keys self-expire via `PEXPIRE`, `DEL` on a successful login. The pure lockout decision still lives in `security.rateLimitDecision`; only the timestamp store moved. Every node now sees the same recent-failure history, so a brute-forcer hitting different nodes is still locked.

## Enabling it
Set in the API environment (see `.env.production.example`):
```
REALTIME_BUS=redis
LOGIN_THROTTLE_STORE=redis
REDIS_URL=redis://<host>:6379           # shared by all nodes
# optional per-feature overrides:
# REALTIME_REDIS_URL=...  REALTIME_CHANNEL=aps:realtime
# LOGIN_THROTTLE_REDIS_URL=...  LOGIN_THROTTLE_PREFIX=aps:login:throttle:
```
`ioredis` is the client (lazy-loaded only when a feature is set to `redis`, so single-node deployments never load it). The realtime bus opens two connections (one publisher, one subscriber — a subscriber-mode client can't `PUBLISH`).

## What is and isn't covered
- **Covered + tested (no live Redis needed):** the fan-out and throttle logic are unit-tested with in-memory fakes standing in for Redis — two emitters / two throttles sharing one fake = two API nodes. Tests prove cross-node delivery, single (non-duplicated) delivery, cross-node tenant isolation, publish-failure fallback, the shared sliding window, and a cross-node `LoginService` lockout. Backend suite: **20 harness + 225 vitest, all green**; API builds and type-checks clean.
- **Not exercised here (needs infra):** the thin real-ioredis adapters (`makeRealtimePubSub`, `makeThrottleRedis`) are type-checked but not run against a live Redis in this environment — smoke them against a real Redis during the deploy dry-run.
- **Still process-local (fine, or out of scope):** the `InProcessEmitter.log` ring buffer is per-node diagnostics only. Sticky sessions are **not** required for SSE correctness with this change, but a load balancer must still allow long-lived streaming responses (no aggressive idle cutoff; the 25s heartbeat helps).
