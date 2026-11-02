# API Architecture Constitution (5) — audit on THIS tree, Oct 4 2026

Kevin's decision (Oct 3): re-apply Constitutions 1–6 to this repository; Authentication (3) is done (AUTHENTICATION_AUDIT.md).
This is Constitution 5, re-applied FROM THE SPEC (`AI_PowerSalon_API_Architecture_Constitution_5.md`, 232 sections) onto
today's code, audit-first: reuse and harden what exists, no `api_v2`. The September decisions are carried forward where
they still fit; each is marked ◆. The spec's own rule governs everything below: **no blind rewrite** — safe compatibility
adapters wherever live clients depend on today's shapes (§200).

## Measured surface

| | |
|---|---|
| Controllers / routes | 332 / 2,569 (apps/api + modules) |
| Routes with an adjacent `@RequirePermission` | 995 (the rest authorize in the domain service or are realm-gated — global guards: RolePermissionGuard, RealmGuard, PlatformDomainGuard, TenantRateLimitGuard, StepUpGuard, SuspendedAccessGuard, MfaEnrollmentGuard) |
| `@Body()` sites / typed `any` | 1,016 / 938 |
| Per-controller `ctxFrom()` helpers | 125 — thin projections of `req.ctx` (see below) |
| Handlers returning `{ ok: true }` | 93 (the rest return raw objects) |
| Tables with a `version` column / `expectedVersion` sites | 49 / 156 |
| `.offset(` sites / `nextCursor` mentions (3 hard-coded `nextCursor: null`) | 23 / 22 |
| Routes under `/api/v1` | only `/api/v1/platform/*` (Constitution 7 alias of `/super-admin/*`) |

## What exists and STAYS

| Area | Where | Verdict |
|---|---|---|
| Global exception filter: logs with route template + fingerprint, 4xx warn / 5xx error, stack never leaves the process, generic 500 message, `requestId` + `reference` on every error body | `packages/observability` `PlatformExceptionFilter` (Constitution 11) | keep — the §28 envelope is ADDED to it, not a second filter |
| Request id / correlation, async context | `RequestContextMiddleware` (Constitution 11) | keep |
| The trusted request context — ONE derivation from the authenticated session / API key / OAuth token; client tenant/branch keys stripped | `@aipowersalon/tenant-context` `contextFromSession` (Constitution 13 §72) + TenantContextMiddleware (now also integrations, Constitution 3) | keep — G1 is already a unification (◆ Sep finding); `ctxFrom()` helpers project it |
| Pagination ceiling (`MAX_PAGE_SIZE` 100, clamps) | `packages/api-contracts/pagination.ts` | keep — no endpoint returns an unbounded set |
| `/api/v1/platform/*` alias mounted on our own Express instance | `common/platform-alias.ts` (Constitution 7) | keep — the GENERAL `/api/v1` alias generalizes exactly this mechanism |
| Optimistic concurrency: `version` columns + `expectedVersion` | 49 tables, 156 sites | keep — ETag/If-Match is a thin translation over it |
| Idempotency where money moves (payment-attempt body keys, voice gateway table) | payments, ai/voice-booking | keep — the generic store GENERALIZES the voice model (◆) |
| Shared contract package | `packages/api-contracts` (Constitution 13 — tenant/platform/customer types) | keep — generated error types land here |
| Realm separation | Constitution 3 Step 1 + RealmGuard | done |

## Gaps (G-numbers as in September)

| Gap | On this tree | Plan (◆ = Sep decision carried forward) |
|---|---|---|
| **G2/G3 error envelope + error-code registry** — **DONE Oct 4** | filter emits `{...legacy, statusCode, requestId, reference}`; codes are free strings | ◆ registry `apps/api/src/api/error-registry.ts` (typed codes, status, safe default message, §221 client action); the EXISTING filter adds `error: { code, message, details }` as a SUPERSET — every top-level field a client reads today stays (◆ compatibility twins `ok`/`code`/`message`); §31 scrub of stack/SQL shaped values; ratchet gate `check:error-codes` over a frozen legacy baseline |
| **G6 /api/v1** | platform only | ◆ every route also under `/api/v1/*` on the same Express-level rewrite (url AND originalUrl — the September trap); legacy paths get `Deprecation`/`Sunset`/`Link` headers, never on probes, webhooks or media; `API_LEGACY_SUNSET` env |
| **G8 generic idempotency** | per-domain only | ◆ `api_idempotency` table (migration 502) + `@Idempotent()` interceptor: proceed / replay / conflict / inflight; `required:true` only where a client can send a key; applied to refund + void first |
| **G9 ETag / If-Match** | none | ◆ weak tags over `version`, malformed If-Match throws, failed precondition = **412** with currentVersion |
| **G10 cursor pagination** | 3 stubs | ◆ keyset helper: (sortValue, id) total order, cursor bound to its sort, malformed cursor throws, limit+1 |
| **G5 OpenAPI** — **DONE Oct 4** | none | ◆ static generator (938 `any` bodies make @nestjs/swagger emit the same empty schemas while forcing CI to boot the app); commit the MANIFEST, not the multi-MB spec; gate `check:openapi` with two jaws — route drift AND permission-key drift |
| **G4 ValidationPipe / mass assignment** — **DONE Oct 4** | none | ◆ register the pipe for future DTOs (whitelist, forbidNonWhitelisted, no implicit conversion) — honest that it protects only class-typed bodies; gate `check:mass-assignment` (a client object passed whole into an insert/update) |
| **Phase 3/19 contract tests** — **DONE Oct 4** | none | ◆ realm/permission contract tests over the manifest; unkeyed platform routes = frozen baseline that only shrinks |
| **Phase 13 client contract** — **DONE Oct 4** (reader Step 1, action Step 8) | none | ◆ error types GENERATED into packages/api-contracts; pos-web reads `error.{code,message}` first with fallback to the twins |
| **G7 success envelope** | mixed | ◆ NOT a bulk rewrite of 2,569 handlers against seven live frontends — mandatory for v1-native modules only |

Already satisfied by other constitutions — not rebuilt: tenant/permission guards (8), webhook signatures + dedupe (14),
async jobs (15), realtime (16), observability (17), service and integration principals (Constitution 3).

## Build order on this tree

1. G2/G3 envelope + registry + gate (the highest-leverage fix: one shape for every error, every app)
2. G6 general `/api/v1` alias + deprecation headers
3. G8 idempotency store + interceptor (migration 502)
4. G9 ETag/If-Match, G10 cursors (helpers, then the first routes)
5. G5 OpenAPI generator + manifest + `check:openapi`
6. G4 ValidationPipe + `check:mass-assignment`
7. Phase 3/19 contract tests; Phase 13 generated error types + pos-web reader
8. §231 Definition-of-Done check and the §232 report

Each step: tests at the pure / service / real-Postgres level as fits, mutation-checked, a live run against the built API,
25 gates + audits, the API battery.

## Progress log

- **Oct 4 — Step 1 (G2/G3) error envelope + registry** — `c86fe8c`.
- **Oct 4 — Step 2 (G1) `/api/v1` alias** — every route reachable as `/api/v1/<path>` (same controller/guards/audit;
  `/api/v1/platform/*` keeps its own mapping). Legacy responses carry `Deprecation: true` + `Link: </api/v1/…>;
  rel="successor-version"`; `Sunset` only when `API_LEGACY_SUNSET` is set. Exempt: health/metrics, webhooks, inbound
  integrations, media, OAuth, the already-versioned `/api/ai-*/v1` voice APIs.
  **Carry-forward:** the `<realm>_refresh` cookie is scoped to `Path=/auth/refresh`. When an app switches its base URL to
  `/api/v1`, the refresh cookie path must change with it (or be issued for both paths) — otherwise the browser will not
  send it and sessions end at the 15-minute access-token expiry.
- **Oct 4 — Step 3 (G8) idempotency** — migration 502 `api_idempotency` + `@Idempotent()` (`@aipowersalon/database/nest`)
  on the 9 refund/void routes (POS + Manager Pay payments/tickets, gift-card voids, cash-drawer movement void). Clients
  send one key per ACTION (`createIntentKeys`): POS ticket refund; Manager Pay payment refund, ticket refund, void. CORS
  now allows `Idempotency-Key` and exposes `Idempotent-Replayed` / `Deprecation` / `Link` / `Sunset`.
  **Not yet keyed:** checkout charges (card/cash/split/gift-card pay) — card charges already carry their own processor
  idempotency (`checkout-card-idempotency`); cash/split are the next candidates. `required: true` is used nowhere yet:
  it becomes safe per route only once every client of that route sends a key.
- **Oct 4 — Step 4 (G9) edit conflicts** — §57 allows the existing resource version field, so `expectedVersion` stays the
  ONE mechanism. Every stale edit now answers 409 `VERSION_CONFLICT` (memberships sent a bare 409; customer-phone sent
  `stale_record` — POS accepts both). HTTP bridge (`version-precondition.ts`, global): a GET of one item with a whole-number
  `version`/`recordVersion` → `ETag: "N"`; `If-Match: "N"` on a write → `expectedVersion: N`; a non-version If-Match or a
  disagreeing body → 400. CORS allows If-Match, exposes ETag. Kept as designed: platform settings' batch save reports
  per-key `conflicts` in a 200; tech "accept ticket" 409 is a claim race, not a stale edit.
  **Not done:** If-None-Match/304 read caching (§80 — needs per-user cache rules first); `If-Match required` (§ appointments.cancel
  catalogue) is enforced nowhere yet — safe only after every client of a route sends it.
- **Oct 4 — Step 5a (G10) cursor pagination infrastructure** — `e759889`. In-memory keyset helper `paginate()` (orders by
  (sortKey, id), answers hasMore with limit+1, no COUNT) and the v3 offset cursor. **Correction (Step 5b):** 5a's
  `paginate()` accepted a sort whitelist and then ignored it, and its test only asserted "returned something" — the
  parameter is removed and the test now pins the order. The helper has no production callers; real keyset paging is
  done in SQL per repository (first: voice transcripts, below).
- **Oct 4 — Step 5b (G10) cursors on every offset list** — one edge bridge instead of per-site edits.
  - The ONE codec moved to `@aipowersalon/api-contracts` (`cursor.ts`): v2 keyset `{v:2,s,id}`, v3 offset
    `{v:3,offset,limit,sort,dir,k}`; browser-safe base64url, byte-identical to Node's (cursors minted by 5a decode).
    A v3 cursor that is out of range or misaligned (offset not a multiple of limit) is `invalid`, never "page 1".
  - `OffsetCursorInterceptor` (global, `app.module.ts`), same pattern as the ETag bridge: GET `?cursor=` → `page` +
    `pageSize|limit` (+ sort/dir); a response carrying an offset page (`pagination:{page,pageSize|limit,totalPages}` or
    flat `{items|rows|data, page, pageSize|limit, total|totalItems}`) and no `nextCursor` of its own gets `nextCursor`
    (null on the last page). Tampered cursor, or cursor + a different `?page=` → 400 `VALIDATION_FAILED`; a re-sent
    larger size is overridden by the cursor's (the size actually served); another endpoint's own cursor is untouched.
  - Voice transcripts: the `nextCursor: null` stub is now real keyset on (created_at, id), cursor carries Postgres text
    timestamps (microseconds) so same-millisecond rows are neither skipped nor repeated; unreadable cursor refused.
  - Tenant health: private `{o}` cursor → shared v3 codec; pre-Oct `{o}` cursors still decode; junk is refused.
  - No `nextCursor: null` stubs remain (the one literal left is the "no database configured" empty answer).
  - Superseded: a per-site attempt (`0e9609cf`, communications only) minted `{v:3,page,pageSize}`, which the shared
    decoder rejects; it was reverted (`398bae41`). The "deferred pending decision" note (`973e839d`) and the Phase-1
    checkpoint section (`da9a10c5`) are replaced by this entry.
  - Verified: 38 unit + 11 real-Postgres tests; 7/7 mutations caught (page/cursor disagreement, last-page cursor,
    overwriting an endpoint's own cursor, refusing foreign cursors, misaligned offset, base64url padding, cursor size
    not applied). Live on Palace customers (7 rows, pageSize 2) via `/api/v1`: 4 pages, 7 rows, 0 duplicates, same
    order as one big page, null on the last; tampered and conflicting-page cursors 400. 31 gates + audits; 6 API shards
    1,637 passed / 0 failed.
  - **Not done:** repositories still run OFFSET underneath (deep pages stay O(offset)); each moves to SQL keyset as it
    gets hot, returning its own v2 `nextCursor`, and the bridge steps aside automatically. Apps do not yet send `cursor`
    (they keep `page`); infinite-scroll screens adopt it as they are touched.
- **Oct 4 — Step 6 (G5) OpenAPI** — static generator `apps/api/scripts/openapi.mjs` (no Nest boot, per the Sep decision).
  Every fact comes from the code that enforces it: routes/decorators/params from `scripts/audit-routes.js` (the ONE
  collector), realm from `@aipowersalon/permissions` `canAccessRoutePrefix` (RealmGuard), public from the session
  middleware `.exclude()` list in `app.module.ts`, `/api/v1` from `common/api-version.ts`, error codes from
  `ERROR_REGISTRY`. Output: `openapi/manifest.txt` COMMITTED (one line per route: realm, auth, permission, integration
  scope, step-up, idempotency, guards, unversioned) and `openapi/openapi.json` on demand (gitignored, ~2.5 MB, 3.1.0,
  2,574 operations / 2,322 paths, ?cursor= on GET lists, Idempotency-Key on keyed routes, ErrorEnvelope with the code
  enum). Gate `check:openapi` (in run-gates): fails on any added/removed route or changed security line until the
  manifest is regenerated and committed, and on a structurally invalid spec (undeclared path params, duplicate
  operationIds/parameters, two handlers on one METHOD + path with param names erased).
  - **Collector defects found and fixed** (they affected crosswire/unreached/nav/dead-client too): (1) `@Sse` routes were
    not collected — 7 realtime streams invisible; `frontend-calls.js` now recognises `createRealtimeClient({ streamPath })`
    so `/owner/stream` and `/tech/stream` are not falsely "dead". (2) A trailing `// comment` between `@Controller` and
    `class` hid the controller: 11 voice routes absent, and the transcription provider webhook was filed under the
    Super Admin controller as a non-existent `POST /super-admin/voice-transcription/webhook`. (3) A trailing comment on a
    decorator hid the decorators above it (step-up read 13 of 21; API-key guard labels lost). Route table 2,556 → 2,574.
    Per-file reconciliation (source decorators vs table, incl. `@UseGuards`, controllers found = `@Controller` count):
    0 mismatches. The collector's per-file parse is now an exported, unit-tested `routesInSource()`.
  - Verified: 14 tests (fixtures for each defect above + generator facts + the real tree), mutations 12/12 (first run
    11/12 — a comment on the `@Controller` line itself had no fixture; added). Drift drills: changed permission and added
    route both fail the gate with readable diffs. Live, unauthenticated, every route: 2,468 session + 14 api_key routes
    refuse (401); no public GET demands a session — 0 label mismatches. Redocly lint: valid OpenAPI 3.1.
    32 gates + audits; 6 API shards 1,651 passed / 0 failed.
  - **Probe incident (local only):** the first live probe mis-parsed the label on lines ending in `auth=public` and sent
    `{}` POSTs to ~30 public routes (mostly /auth). Effect on the local DB: one failed login attempt, one auth event, and
    a system-health "API degraded" alert from a burst of 503s — removed; no accounts, tokens, messages or payments touched.
    The corrected probe sends only GETs to public routes.
  - **Not done / noted:** bodies are honestly untyped (`type: object`, ~940 `any` handlers) — typing comes per module
    with G4 DTOs. Redocly reports 8 theoretically ambiguous path pairs (e.g. `/pos/services/{serviceId}/add-ons` vs
    `/pos/services/categories/{categoryId}`); each collides only on an ID equal to the literal segment, impossible with
    UUIDs — no route changed. `check:public` still parses the exclude list itself (same regex) — fold onto the
    generator's `PUBLIC_RULES` when that gate is next touched.
- **Oct 4 — Step 7 (G4) ValidationPipe + mass assignment** — measured first: booting the compiled app and applying
  ValidationPipe's own skip rule to every handler's `design:paramtypes` — 2,574 handlers (= the Step 6 route table),
  2,859 @Body/@Query/@Param arguments, **zero class-typed** (1,016 bodies + 392 query objects are interfaces/`any`, the
  rest strings). So the global pipe changes nothing for any existing route; it is the enforcement point for every class
  DTO from here on. (Turning it on blind would have been unsafe: a class body without decorators is refused outright.)
  - `common/validation.ts` — `createValidationPipe()` registered as `APP_PIPE`: whitelist + forbidNonWhitelisted (an
    unknown field is a 400, not silently dropped), transform:false (no implicit conversion), forbidUnknownValues,
    validationError target/value off. 400s arrive as `VALIDATION_FAILED` with the messages in details.
  - `class-transformer@0.5.1` added (pinned) — ValidationPipe calls `process.exit(1)` at construction without it.
  - Gate `check:mass-assignment` (run-gates): every Kysely `insertInto…values(X)` / `updateTable…set(X)` where X (or a
    spread inside X) is a whole object — a row built field by field passes; spread/alias of input, `req.body`, and
    all-keys copies without an allow-list fail; an object received as a parameter fails until its callers are traced
    and recorded in `scripts/mass-assignment.reviewed.json` (key = file|method|variable; stale entries fail too).
    **Tree today: 93 whole-object writes, 0 mass assignment** — 83 explicit, 10 parameter-passed, each caller traced to
    an explicit allow-list (plans `normalizePlanDetailsPatch`, hardware `allowed`, tech-queue literals, super-admin
    platform builders, ai-marketing status literals).
  - Verified: 13 tests (pipe over real HTTP through PlatformExceptionFilter; classifier fixtures; the real tree).
    vitest's esbuild emits no `design:paramtypes`, so the spec declares it as tsc does — a mutation deleting it proves
    the DTO tests are not vacuous. Mutations 11/11 (first run 10/11: value-echo is unobservable over HTTP with Nest's
    default exceptionFactory, so the option is now pinned directly). Compiled pipe on a tsc-compiled DTO: valid passes,
    extra `role` 400, "1" for an int 400, untyped body untouched. Live: clean boot; login with an extra field SUCCESS;
    customer PATCH carrying an injected `tenantId` → 200 with the tenant unchanged in the database; cursor paging intact.
    33 gates + audits; 6 API shards 1,664 passed / 0 failed.
  - **Not done:** no route has a class DTO yet — bodies stay untyped until modules adopt DTOs (each adoption is then
    enforced automatically). The classifier treats a mapper call (`this.values(e)`) as explicit without reading the
    mapper; a mapper that spreads its input would pass — note for review.
- **Oct 4 — Step 8 (Phase 3/19 + Phase 13) the realm × permission contract and the client error contract.**
  - **Production bug found and fixed:** `GET /super-admin/stream` (the admin app's SSE stream) was missing from
    `PLATFORM_PATH_DOMAIN`, so `PlatformDomainGuard` answered 403 "not classified — denied by default" to EVERY Super
    Admin (confirmed live with a real platform session). Classified `'stream': 'system'` — the domain of the System
    Status screen, whose aggregated live-ops snapshot is the only thing the stream carries. Live after: 200
    text/event-stream with the snapshot; an owner session still refused.
  - **Why nothing caught it:** `platform-domain-coverage.vitest.spec.ts` exists for exactly this, but carried its own
    route scan (GET/POST/PUT/PATCH/DELETE only — no @Sse) and counted a route as keyed if any `Require…Permission` was
    within 300 characters. Rebuilt on the ONE collector with handler-level keys (what the guards read); removing the
    stream classification now fails it. It then surfaced `POST /auth/super-admin/forgot-password` (the path-key
    function matches `super-admin` anywhere) — public, so no session ever reaches the guard; excluded for that reason.
  - **Manifest records the effective key:** `derived=<key>` on 913 /super-admin routes without a declared key (or
    `derived=UNCLASSIFIED`), so a PLATFORM_PATH_DOMAIN change is a reviewed diff. Permissions are read HANDLER-level only,
    as RolePermissionGuard and PlatformDomainGuard do.
  - **Gate `check:api-contract`** (run-gates), roles and grants read from @aipowersalon/permissions and the session
    realm rule from identity `realmForPath`: (1) every effective key is held by a role whose session the path accepts
    AND RealmGuard admits — 1,016 declared + 913 derived, 0 unreachable; (2) no unclassified /super-admin path — 0;
    (3) staff routes without a key only from the frozen baseline (`openapi/api-contract.unkeyed.baseline.txt`, 363,
    only shrinks); (4) no class-level @RequirePermission (never enforced) — 0. A fixture caught a gap in my first model:
    RealmGuard alone admits SUPER_ADMIN to /pos, but the session layer refuses that token first — the model now uses both.
  - **Live cross-realm:** owner session × every super_admin/customer GET, Super Admin session × every staff/customer GET
    — 1,172/1,172 refused, all at the session layer (a token from another realm is "No session", cookie or bearer);
    RealmGuard is defence in depth behind it.
  - **Phase 13:** the reader (envelope first, legacy twins after) shipped in Step 1. Added: `NormalizedError.action`
    (typed `ClientAction`) — the server's `error.action` when it is a known action, else derived from the registry, and
    for a legacy unregistered code from the HTTP status (a 401 "UNAUTHENTICATED" → REAUTHENTICATE). One list:
    `CLIENT_ACTIONS` in api-contracts, used by the normaliser, the registry type and the OpenAPI enum. The registry is
    one TypeScript source shared by server and apps — no generated copy needed.
  - Verified: contract 9 tests, coverage 3, normaliser +5, permissions +1; mutations 11/11 non-equivalent (first run 9/12
    — derived-key and server-action gaps closed; "drop RealmGuard from the model" is equivalent, as the session rule
    already excludes the same tokens on every path). Six frontends type-check (0 errors) and pass 2,391 tests;
    architecture: no regression; 34 gates + audits; 6 API shards 1,673 passed / 0 failed.
- **Oct 4 — Gift-card and split double settlement (found while working DoD item 25)** — the DoD said a double-tapped
  CASH checkout could record twice; wrong: cash already priced on paid-so-far and wrote under the visit lock
  (`recordPaymentIfUnchanged`). The real holes were next to it, both **reproduced live** through the API on Postgres 16:
  - **Gift card**: the card debit and the payment row were separate statements with no paid-amount check; the debit's
    only guard is `balance >= amount`. Two simultaneous taps with a $200 card on a $53.88 ticket → two approved
    payments, **$107.76 debited** (3/3 runs).
  - **Split**: one transaction, but no visit lock or paid-amount check → a double-tapped gift $20 + cash $33.88 split
    recorded **every segment twice**, card debited twice (2/2 runs on the pre-fix build).
  - **Fix** (`modules/checkout`): `lockTicketAndCheckPaid` (visit row FOR UPDATE + paid-so-far compare) shared by cash,
    the new `redeemGiftAndRecordIfUnchanged` (debit + payment row in ONE transaction — a refused tap's debit rolls back),
    and `recordSplitAtomic({ expectedPaidCents })` (a refused duplicate takes the existing compensation path, which voids
    any card portion captured). Service passes the paid amount it PRICED on. In-memory repository mirrors both.
  - **Verified**: real-Postgres deterministic race (share-lock gate, 10 stations) added to
    `checkout-concurrency.postgres-race` — fixed: 1 payment / 1 debit for gift and split; **pre-fix logic: 10/10 succeed**.
    Rollback pgtest (5) — a refused tap leaves one redeem and one payment; service tests (3) with a competing payment
    landing right after the pricing read. Mutations 9/9 (first service run missed "re-read paid at write time": the
    simulated collision landed too late; moved to the real window). Live after: gift 3/3 and split 3/3 → one payment +
    409 CHECKOUT_ALREADY_IN_PROGRESS. Checkout suite 442 passed; 34 gates; 6 API shards 1,673 passed / 0 failed. Race
    artefacts removed from the dev database.
  - **Open risk:** CI has no Postgres service, so NO `*.postgres-race` test runs in CI (these and the existing cash /
    refund / terminal-lease / gift-card-branch ones). They run only with `PG_RACE_URL` set. Adding a Postgres service +
    migration step to `.github/workflows/security.yml` is the follow-up (not done blind — it cannot be executed here).
- **Oct 4 — Payment replay keys (DoD 25 → DONE)** — `@Idempotent()` on `pay/cash`, `pay/gift-card`, `pay/split` (optional
  mode, as refund/void: a key is honoured when sent; a failed attempt releases it). POS: `posCheckoutApi` sends the key;
  `POSCheckoutScreen` keeps one key per payment intent (ticket + method + exact body) and releases it on success.
  Live: cash retry → 201 with the SAME payment + change and `Idempotent-Replayed: true`; same key + different amount →
  422 IDEMPOTENCY_KEY_REUSED; gift and split retries replayed (card debited once, 2 split rows); concurrent same key →
  one 201 + 409 IDEMPOTENCY_IN_PROGRESS, one payment. (My first gift/split live run used keys under the server's
  8-character minimum and got VALIDATION_FAILED — a script error; the app's keys are UUID-length.) Tests: 3 client
  tests; the screen test asserts the cash payment carries a valid key and fails when the screen stops sending it.
  Manifest regenerated (three routes now `idempotency=optional`). 34 gates; pos-web 874 passed; 6 API shards 1,673
  passed / 0 failed. Probes removed from the dev database.
- **Oct 4 — Load tests (DoD 53, §232.40 measured results)** — environment: this sandbox, **1 CPU core** shared by the API
  (one Node process), Postgres 16 and the load generator; dev salon PALACE has 1 ticket / 7 customers.
  - **HTTP API** (`scripts/api-load-test.mjs`, new — the older harnesses drive services, none measured the API a client
    calls): real owner session, 5 hot endpoints round-robin via `/api/v1` (customers page, customer by id, checkout
    state, appointments, health).
    | clients | throughput | p50 | p95 | p99 | errors |
    |---|---|---|---|---|---|
    | 1 | 73.1 req/s | 13 ms | 28 ms | 42 ms | 0 |
    | 10 | 73.3 req/s | 114 ms | 310 ms | 397 ms | 0 |
    | 50 | 77.1 req/s | 576 ms | 1,585 ms | 1,686 ms | 0 |
    Throughput is FLAT from 1 to 50 clients: one client already saturates the single core, so added concurrency only
    queues (latency grows, nothing fails — 0 5xx, 0 network errors, no 429s). Slowest endpoint: checkout state (p95
    34 ms unloaded, 391 ms at 10). These numbers bound THIS box, not production.
  - **Service harnesses** at 150 tenants: AI booking 900 events p50 15 / p95 35 / p99 144 ms, 0 cross-tenant leaks;
    Reception Copilot 1,650 ops p50 16 / p95 32 / p99 141 ms, 0 leaks. Both were **broken** — imports of
    `apps/api/dist/ai-center/*` (moved to `modules/ai` in Constitution 13) and a hard-coded `/tmp:5433` `aps` database no
    environment has — so they had not been runnable since the restructure; repaired (DATABASE_URL, module paths).
  - **Booking verification** concurrency harness: all serialisation invariants hold; it documents a known gap (two
    customers can both be told a slot is held; the double BOOKING is still prevented at conversion) — needs a btree_gist
    exclusion constraint.
  - **Outstanding:** run `api-load-test.mjs` on target infrastructure with production-sized data (multi-core, separate
    database, thousands of tickets/customers per salon) and set the p95 budget from that.
- **Oct 4 — Real-Postgres race tests run in CI** (closes the open risk recorded with the gift-card/split fix). New job
  `race` in `.github/workflows/security.yml`: a `postgres:16` service, `npm run db:migrate` onto the empty database,
  then `npm run ci:test:race` → `tooling/ci/run-race-tests.mjs`, which discovers every `*.postgres-race.vitest.spec.ts`
  under apps/api and modules/* and FAILS on a missing `PG_RACE_URL`, any skipped test, or an empty discovery — the lane
  cannot pass by skipping. Replayed locally against freshly created empty Postgres 16 databases: migrate 502/502 in 4 s;
  **26 files / 90 tests pass, 0 skipped, ~100 s** (none had ever run in CI; none had rotted). The lane catches a
  reintroduced race: with the gift-card visit lock removed it fails naming the test (10 payments, expected 1).
  - **Incident (working copy only):** my own mutation check aborted on a shell syntax error before its restore line, so
    the gift-card guard stayed deleted in the working copy; the next lane run on a second fresh database caught it
    (89/90). Restored from git, checkout `dist` rebuilt, lane re-run on a third fresh database: 90/90. The committed
    fix (`9db638b4`) was never affected. Lesson recorded: restore with `git checkout --`, and verify the restore in a
    separate command, not inside the same script as the mutation.
  - Not covered by this lane: `refund-race.realpg` (embedded-Postgres harness, ~40 MB binary download — separate opt-in).
  - The YAML itself cannot be executed here; every step it runs was replayed locally except `build:modules`, which the
    existing `tests` job already runs on every push.
- **Oct 4 — Unkeyed staff routes audit, batch 1 (DoD 57)** — method: sign in as FRONT_DESK (the least-privileged staff
  role available) and call every GET among the 363 routes with no route-level key. 178 GETs: 100 already refuse it
  (their services/controllers check role or a key — e.g. compensation's `gate()`), 3 → 404, 75 answer 200. Most of the
  75 are legitimately readable (own profile/sessions/prefs under `pos/me`, help articles, navigation, the AI copilot
  queue front desk works from, masked messaging status). **Five were real exposures**, now keyed
  `owner.dashboard.view` (OWNER + MANAGER, as every OwnerService read):
  - `GET /owner/stream` — the owner room carries alerts, payroll and report events in FULL frames; any staff session
    could subscribe.
  - `GET /owner/cash-summary`, `/owner/cash-drawer`, `/owner/cash-handoffs` — the owner's salon-wide cash close-out
    (expected vs counted, variances); `GET /owner/memberships/overview` — membership revenue. They called the
    cash/drawer/memberships services directly, which accept the front desk's own POS grants.
  Live: OWNER 200 on all five, FRONT_DESK 403; front desk's own `/pos/cash-drawer` unchanged; only owner-web calls them.
  Unkeyed baseline 363 → 358 (the gate failed until the five were removed). (A first live check wrongly showed 200: an
  orphaned API process from an earlier step held the port; killed, re-run on the new build.) 34 gates; 6 API shards
  1,673 passed / 0 failed. **Remaining:** technician probe; unkeyed WRITE routes checked from source; tenant/ai (67),
  tenant/help (30), tech self-service.
- **Oct 4 — Unkeyed staff routes audit, batch 2 (technician probe)** — signed in as a TECHNICIAN (dedicated dev account
  `tech.audit@palace.test`) and called every unkeyed GET: 173 probed, 103 refuse, 68 answer. Two real exposures:
  - **23 `/tenant/ai/*` reads** (call intelligence, receptionist calls/settings/FAQs/follow-ups, the reception copilot
    queue, customer duplicates and waitlist, AI usage/plans/packages/subscriptions/revenue, workflow runs) were gated
    only by `AiEntitlementGuard` (does the salon have an AI subscription) — not by role; technicians do not hold
    `ai.use`. Keyed `ai.use` (OWNER, MANAGER, FRONT_DESK, RECEPTION). Callers: pos-web and owner-web only; tech-web none.
  - **4 salon-wide cash reads** (`/pos/cash-drawer`, `/pos/cash-drawer/movements`, `/pos/cash-handoffs`,
    `/pos/cash-handoffs/{technicianId}`): the writes check `pos.checkout.take_payment` in the service, the reads checked
    nothing — a technician could read the register and every technician's hand-offs. Keyed `pos.checkout.view` (as the
    POS checkout reads). Technicians read their own via `/tech/me/cash-handoff` / `cash-pending`.
  Live (one API process confirmed): OWNER 200 / FRONT_DESK 200 / TECHNICIAN 403 on all 27. Unkeyed baseline 358 → 331.
  Verified: 34 gates; 6 API shards 1,673 passed; module suites super-admin 1,403, ai 1,414, checkout 442, workforce
  410 — 0 failed.
  - **Limit:** the audit technician has a login but no technician profile, so `/tech/*` self-service routes answered
    "Not a technician account" (a correct self-scope check) and were NOT really exercised — redo with a profiled account.
  - **Dev-data incident:** to sign in as a technician I first set a known password on the existing dev account
    `tj6141@tech.test` (active row) and later cleared it — the ORIGINAL password hash was overwritten without a copy and
    cannot be restored; that dev account cannot sign in with its old password. Nothing else was touched. Dedicated audit
    accounts are used from now on and removed when the audit ends.
- **Oct 4 — Unkeyed staff routes audit, batch 3 (the 185 unkeyed WRITE routes, from source — never fired blind)** — a
  classifier found a check in the handler (31) or one hop into the service (56); the other 98 were read by hand where
  risky (payroll, expenses, AI plan/subscription cancel, AI control modes, app payments, help-ticket assignment). Almost
  all ARE guarded (`payrollTransition` → owner.finance.view + fresh PIN; `requireManage`; owner role or
  `ai.control.manage`; `pos.checkout.take_payment`; `canTriageTickets`). Three real problems:
  - **Technicians could send SMS/email to ANY recipient** from the salon's sender (`POST /pos/notifications/send`) and
    change customers' messaging consent (opt-in / opt-out): the service refused only CUSTOMER / display / SUPER_ADMIN.
    Writes keyed `communications.manage`, reads (`/pos/notifications`, `/opt-outs`) `communications.view` (OWNER,
    MANAGER, FRONT_DESK, RECEPTION). pos-web is the only caller; technicians message clients via `/tech/follow-ups`.
  - **Approve / lock / reopen payroll was gated on a VIEW key** (`owner.finance.view`). Same holders today (OWNER,
    MANAGER), but a custom role template granting finance visibility could approve or reopen payroll. Now also
    requires `payroll.manage` — nobody locked out; new test (a view-only role is refused on all three), mutation-checked.
  - **Notification validation errors answered 500** "Something went wrong" — the controller did not map the service's
    `ValidationError` / `ForbiddenError`. Mapped as in `communications.controller` → 400 with the reason.
  Live: TECHNICIAN 403 on all five notification routes; FRONT_DESK reads and sends, and an invalid send now returns
  400 "Channel must be 'sms' or 'email'". Unkeyed baseline 331 → 326. 34 gates; 6 API shards 1,673 passed;
  analytics 238, communications 290 — 0 failed.
- **Oct 4 — Unkeyed staff routes audit, batch 4 (technician ownership: can technician A act on B's ticket?)** — dedicated
  fixture: two technicians WITH profiles, a ticket + queue ticket + service line assigned to B. (First fixture was a bare
  `tickets` row — B himself got 404, so A's 404s proved nothing; technician tickets live in `pos_tech_queue_tickets`.
  With the right fixture the control holds: B 200, A 403 "This ticket is not assigned to you.")
  - A tried 18 ticket routes against B's ticket by queue id AND real id (view, edit options, change requests, price
    change, add/delete service line, add-on, notes, service done, pause, resume, cancel request, decline, cash
    confirm/report): **32/36 refused; B's ticket, lines and payments byte-for-byte unchanged.**
  - `GET /tech/earnings/receipt/:ticketId` answers A but is SCOPED (`getByTicketForTechnician(…, callerTechnicianId)`
    → null for another's ticket). Safe.
  - **`GET /tech/tickets/:id/membership` — two bugs, fixed:** (1) exposure: ticket id → customer → membership with no
    assignment check — any technician could read any client's membership (plan, status, benefits, credits) by passing a
    real ticket id; (2) broken feature: the tech app passes the QUEUE ticket id, the lookup reads the real `tickets`
    table, and the two ids never match (0 of the linked queue rows) — so the panel could never show a membership. Fix:
    `TechService.ownedRealTicketId()` resolves the caller's OWN queue ticket (403 otherwise) to its real ticket id, then
    the membership lookup. Live: B 200; A with B's queue id 403; A with B's real id 404. Tests +4 (mutation: skipping the
    ownership check fails 2). A positive membership could not be shown live — the dev salon has no membership plans; the
    queue → real id path is unit-tested. Queue module 312 passed; 34 gates; 6 API shards 1,673 passed / 0 failed.
- **Oct 5 — Unkeyed staff routes audit, batch 5 (technician ownership, continued)** — the remaining 28 technician routes
  that take an id were traced handler → service: follow-ups (`ownTechTask`), deals (`techOwn`), help requests,
  compensation acknowledgement, skill change requests and the profile routes all fetch the object together with the
  caller's own technician/profile id. One did not: **`GET /tech/manager-messages` + `PATCH …/:id/resolve`** were scoped
  to the tenant only, so any technician could read every colleague's message to management and mark it resolved. The
  only caller is pos-web's POS shell (the manager / front-desk inbox); tech-web never calls them. Keyed
  `pos.technicians.view` (owner, manager, front desk, reception). Live: technician 403 on list and on resolving
  another's message (status stays unread); front desk lists and resolves (200). (A first probe message failed to insert
  — `'open'` is not an allowed status — so those first resolve results were discarded.) Unkeyed baseline 326 → 324.
  34 gates; 6 API shards 1,673 passed / 0 failed.

