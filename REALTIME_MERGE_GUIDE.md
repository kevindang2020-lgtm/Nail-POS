# REALTIME_MERGE_GUIDE.md
### Landing Constitution 9 (patch 15) on `Power-Salon-main` — Sep 19, 2026

This arc was built on the July snapshot. `Power-Salon-main` has moved since (four constitutions landed there from
other sessions). **Run the checker in that tree first; every ⚠ is a decision, and "keep both" is never one of them.**

```
cd Power-Salon-main
node <this-arc>/apps/api/scripts/audit-realtime-infra-duplicates.mjs --root=$(pwd)
```

## Decision table — what to do per concept

| Concept | If `Power-Salon-main` already has one | If it does not |
| --- | --- | --- |
| **Authorization version** (`authz_version`, `permissions_version`, a column or service) | **Reuse theirs.** The Permissions Constitution (Sep 7) very likely added a real version column or bump-on-change. Replace `KyselyAuthzVersionSource.facts()` with a read of that value; keep `untilAuthzChanged` and its tests as they are (the operator takes any string). Do not derive a hash next to a maintained column. | Keep `authz-revalidation.ts` as shipped — derived from `users`/`tenants`/`branches`/`user_branch_access`. |
| **SSE endpoints** (`@Sse`) | Expect the same four realm streams + display + super-admin. A stream that does not construct through `RealtimeStreamFactory` is a hand-rolled loop: migrate it (20 lines, see any of the five controllers). | — |
| **WebSocket / Socket.IO** | Stop and read `REALTIME_ARCHITECTURE_AUDIT.md` Phase 3. If a later arc added WebSocket for a §95 command, keep it for that command only and route its *push* side through the factory's room model; do not run two push transports (§6). | Nothing to do — SSE is the transport. |
| **Event registry** (`export const EVENTS`) | Exactly two are expected: the server's and the package copy. A third means a realm app kept its own vocabulary — delete it and point the app at `@aipowersalon/realtime-client/core`. Then run `check:realtime-contract`; it will list every name the other tree emits that the merged registry lacks — add them, never cast. | — |
| **Screen routing** (`const AFFECTS`) | Merge their entries into the server registry (theirs may route events this arc did not know); regenerate the package copy; the parity test enforces byte-identity. | — |
| **Sequence counter** (`aps:rt:seq:`) | Two key schemes = two numberings = false gaps everywhere. Keep one key format; if theirs differs, change the constant in `realtime-bus.ts` **and** the `decodeSeqVector` legacy branch, and note that clients must resync once (the "ahead/behind ⇒ resync" rule handles it). | — |
| **Presence** | If a presence store exists, reuse its storage but keep the §49 invariant test (`presence.vitest.spec.ts` greps for clock-in vocabulary) — a presence table that joins to the time clock is the thing §49 forbids. | Keep `presence.ts` (in-memory / Redis PX). |
| **Origin allow-list** | One `computeAllowedOrigins` only. A second inline `allowedOrigins = [` in `main.ts` is the drift the `cors-native-origins` test guards; delete the copy. | — |
| **Connect limiter / slow-client gate** | Reuse whichever exists; the classes are self-contained. | — |
| **Shared client package** | If a `packages/realtime-client` exists with a different `createRealtimeClient`, diff the two: the one shipped here carries per-slot `SequenceTracker`, `reconnect_requested` jitter, `resync_required` reasons, and the fake-EventSource test suite. Prefer the one with the tests. | Copy `packages/realtime-client` in and add the alias to each app's `tsconfig`/`vite`/`vitest` (see any app's diff in patch 15). |
| **Hand-rolled EventSource clients** | Expected **zero** outside the package. Each one found: replace with a 20-line adapter (see `useOwnerStream.ts`) — contract `onEvent(name)` + `'reconcile'` is preserved, screens do not change. | — |
| **Fallback polling** (`setInterval(load…)`) | Any unconditional poll in an app is a §191 violation; wrap it in `FallbackPoller` (starts after grace, stops on CONNECTED). Watch for tests that encoded the old cadence — update them to the policy, do not delete them. | — |
| **Platform live-ops** | If a Super Admin stream exists, it must carry aggregates only (§60 test: serialize the snapshot and grep for names/emails/tenant ids). | Keep `platform-live-ops.ts`. |
| **CI contract gate** | Add `check:realtime-contract` and `check:realtime-infra-duplicates` to their gate list. The first run in the merged tree **will** find off-registry emissions — that is the point. | — |

## Migrations
None. Constitution 9 adds no tables or columns (§111). If the other tree's authz version is a column, that column is
theirs and stays.

## Post-merge checks, in order
1. `node scripts/audit-realtime-infra-duplicates.mjs` — must print OK (every concept at or under expected).
2. `npm run check:realtime-contract` — fix every OFF-REGISTRY EMISSION it lists (register + route, or map in the
   adapter as `ai-queue-assignment.adapters.ts` does); never `event as any`.
3. `npx vitest run src/realtime/` — 102 tests; the isolation suite must be green before anything ships.
4. `node scripts/di-check.mjs` — with `abortOnError:false` it prints the real message; a bare exit code means the
   patch to `di-check.mjs` was not applied.
5. Each web app's suite: the realm adapters keep `onEvent(name)`, so screen tests should not change.
6. `npm run docs:realtime-catalog` — commit the regenerated `REALTIME_EVENT_CATALOG.md`; an `UNCLASSIFIED` line means
   the other tree emits a domain this arc never saw — add a `DOMAINS` row.

## Surprises this arc hit that the merge will hit too
- **`di-check` failed silently.** Nest calls `process.exit(1)` before the script's catch; the patched script passes
  `abortOnError:false`. Apply that before trusting any boot check.
- **Four modules emitted 27 event names outside the registry** through `event: string` wrappers with `event as any`.
  The other tree may have more; the gate finds them by name.
- **Three hooks polled while connected** (POS 45 s, owner 60 s, display 4 s). Expect the same in any app added since.
- **Two tests encoded the old polling cadence** and one encoded the inline CORS list; each was updated to the
  constitution's policy, not deleted. Do the same.
- **Every module-level import in the chain can succeed and boot can still fail** — an exported-but-not-provided
  Nest provider only fails at `NestFactory.create`. Bisect with the boot check, not with `import()`.
