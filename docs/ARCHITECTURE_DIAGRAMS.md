# ARCHITECTURE_DIAGRAMS.md — runtime topology, request path, job/event path, data stores, trust boundaries

Constitution 4 §191 (BUILD_PLAN Phase 11). Drawn October 8, 2026 from the tree; each diagram lists the files it was
drawn from. Railway is the host of record (`railway.json`, `railway.worker.json`); boxes marked *(hosting)* are settings
outside this repository, and dashed boxes are optional (off until their env var is set). Diagrams render on GitHub
(Mermaid).

## 1. Runtime topology

Sources: `railway.json`, `railway.worker.json`, `Dockerfile`, `apps/api/src/main.ts`, `apps/api/src/worker.ts`,
`packages/config/src/process-role.ts`, `packages/database/src/kysely.provider.ts`.

```mermaid
flowchart LR
  subgraph clients[Clients]
    pos[POS / Owner / Tech / Admin web apps<br/>static builds of apps/*-web]
    kiosk[Go Check-In kiosk + customer display<br/>single-file HTML apps]
    native[Capacitor shells<br/>customer / tech / owner / manager-pay]
    providers_in[Provider webhooks<br/>CardPointe, Twilio, bank, Retell]
  end
  edge["Railway edge: TLS, *.up.railway.app / custom domain<br/>(hosting) — optional Cloudflare WAF/CDN in front"]
  subgraph railway[Railway project — host of record]
    subgraph web["API service (railway.json) — image: Dockerfile, USER node"]
      api1["node dist/main.js<br/>PROCESS_ROLE=all today (HTTP + every job)<br/>numReplicas: 1"]
    end
    subgraph wk["Worker service (railway.worker.json) — same image, not deployed yet"]
      w1["node dist/worker.js<br/>PROCESS_ROLE=worker, WORKER_JOB_CLASSES"]
    end
    pre["pre-deploy: db-preflight.mjs && migrate.mjs<br/>(once per release, advisory lock)"]
    pg[("PostgreSQL 16<br/>DATABASE_URL (pooled)")]
    rd[("Redis — optional<br/>REDIS_URL")]
  end
  s3[("S3-compatible storage<br/>MEDIA_S3_BUCKET, EVIDENCE_S3_BUCKET")]
  ext["External providers<br/>(docs/DEPENDENCY_INVENTORY.md)"]
  otel["OTLP collector / Prometheus — optional"]
  clients --> edge --> api1
  pre --> pg
  api1 --> pg
  w1 --> pg
  api1 -.-> rd
  w1 -.-> rd
  api1 --> s3
  api1 --> ext
  w1 --> ext
  api1 -.-> otel
  w1 -.-> otel
  classDef opt stroke-dasharray: 5 5
  class rd,wk,otel opt
```

Today one API replica runs everything (`PROCESS_ROLE` unset = `all`). The split — worker service first, then the web
service to `PROCESS_ROLE=api` — is `RUNBOOKS.md` → `worker-split`. More than one API replica needs `REDIS_URL`
(`apps/api/src/common/production-config.ts` refuses `API_REPLICAS > 1` / `MULTI_INSTANCE=1` without it).

## 2. Request path (one HTTP request)

Sources: `apps/api/src/main.ts` (CORS, `breakGlassMiddleware`), `apps/api/src/app.module.ts` `configure()` and the
`APP_GUARD` list, `packages/observability/src/request-context.ts`, `packages/database/src/kysely.provider.ts`.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant BG as breakGlassMiddleware<br/>(env only, no DB)
  participant RC as RequestContextMiddleware<br/>(AsyncLocalStorage: request id,<br/>traceparent in/out, server span)
  participant MW as SecurityHeaders → TenantContext<br/>(session, tenant, branch) → Maintenance (DB-backed)
  participant G as Guards: TenantRateLimit → Realm → RolePermission<br/>→ PlatformDomain → StepUp → Suspended → MfaEnrollment → StorageQuota
  participant H as Controller → service → repository
  participant DB as Kysely → pg Pool (role timeouts)<br/>DB span per query (shape only)
  participant P as instrumentedFetch → provider<br/>(timeout, breaker, client span)
  C->>BG: HTTPS (CORS checked first)
  alt MAINTENANCE_BREAK_GLASS = read_only (non-GET) / full
    BG-->>C: 503 MAINTENANCE_* (health stays open)
  end
  BG->>RC: next
  RC->>MW: context established
  MW->>G: principal + tenant resolved
  G-->>C: 401 / 403 / 429 (Retry-After) when refused
  G->>H: @RequirePermission passed (default deny)
  H->>DB: queries (statement timeout 30 s on PROCESS_ROLE=api)
  H->>P: provider call when needed
  H-->>C: response + traceparent header
```

## 3. Job and event path

Sources: `packages/database/src/job-queue.ts`, `apps/api/src/jobs/job-worker.ts`, `packages/observability/src/scheduler-coordination.ts`,
`packages/database/src/scheduler-runs.ts` (migration 518), the outbox (`packages/events`, `apps/api/src/events`).

```mermaid
flowchart TB
  subgraph write[Inside a request or job transaction]
    biz[business write] --> ob[(outbox_events)]
    biz --> enq["enqueueJob(class, type, tenant, idempotencyKey)"] --> jobs[(jobs<br/>P0–P3, run_after)]
  end
  subgraph sched[Every process that runs the class]
    tick["setInterval → runTick(jobType, everyMs)"] --> lease{"scheduler_runs lease<br/>won?"}
    lease -- no --> skip[heartbeat + skip]
    lease -- yes --> run[tick body]
  end
  subgraph worker[JobClassLoop per class — PROCESS_ROLE / WORKER_JOB_CLASSES]
    claim["claimJobs: FOR UPDATE SKIP LOCKED<br/>per-tenant cap (JOBS_PER_TENANT_CAP)"] --> handler[registered handler<br/>lease heartbeat every lease/3]
    handler -- ok --> done[succeeded]
    handler -- error --> retry["retry: backoff 2^n × 5 s ±50 %"]
    retry -- attempts ≥ max --> dead[(dead — Super Admin → Jobs)]
    reaper["reaper tick every 60 s (critical, single-owner):<br/>lease expired → queued again"] --> claim
  end
  jobs --> claim
  ob --> pub[outbox publisher → consumers<br/>processed_events dedup] --> rt[realtime fan-out<br/>in-process or Redis bus]
  pub --> dlq[(event_dead_letters)]
```

Exactly-once *completion* comes from the lease owner check on `completeJob`; a handler may *run* twice only when its
worker died mid-run, so handlers are idempotent (rule in `job-queue.ts`). Proven by `drill-worker-loss.mjs`.

## 4. Data stores

```mermaid
flowchart LR
  subgraph pgbox["PostgreSQL 16 — system of record: backed up, PITR = hosting"]
    t1[tenants, branches, users, sessions]
    t2[customers, appointments, tickets, queue]
    t3[payments, payment_attempts, ledgers, cash]
    t4[audit / security logs — append-only]
    t5[jobs, outbox_events, processed_events, event_dead_letters, scheduler_runs]
    t6["encrypted credentials (ciphertext; keys in Railway variables)"]
    t7[schema_migrations ledger + checksums]
  end
  subgraph redis["Redis — optional, nothing to restore"]
    r1[tenant cache] 
    r2[rate-limit + login-throttle windows]
    r3[realtime bus + presence]
  end
  subgraph obj["Object storage"]
    o1["media bucket: <env>/<tenantId>/… (MEDIA_STORE=s3)"]
    o2[evidence bucket — private, scan-tagged]
  end
  disk["container disk — media when MEDIA_STORE unset<br/>(lost on every deploy)"]
  keys["encryption keys — Railway variables<br/>+ off-Railway copy (hosting)"]
  keys -. opens .-> t6
```

Retention per class: `apps/api/db/retention-policy.json`; RPO/RTO per class: `DISASTER_RECOVERY.md` §1.

## 5. Trust boundaries

Sources: `apps/api/src/app.module.ts` (public-route allowlist, guards), `apps/api/src/common/security-headers.middleware.ts`,
`apps/api/src/health/metrics.controller.ts`, the webhook controllers, `packages/database/src/tenant-session.ts`.

```mermaid
flowchart TB
  subgraph internet[Untrusted: the internet]
    anon[anonymous browsers / kiosks]
    users[signed-in staff, owners, customers]
    hooks[provider webhooks]
    scraper[metrics scraper]
  end
  subgraph edgeb["Boundary 1 — TLS edge: Railway, optional Cloudflare WAF (hosting)"]
  end
  subgraph apib[Boundary 2 — the API process]
    pub["public by design: /health/*, /metrics (METRICS_TOKEN bearer; 404 in prod without one),<br/>public booking / display endpoints (allowlisted in app.module.ts)"]
    auth["session or bearer → realm → @RequirePermission (default deny) → tenant context"]
    wh["/webhooks/*: provider signature verified before any write"]
    sa["Super Admin (platform realm, MFA, step-up for dangerous actions)"]
  end
  subgraph datab[Boundary 3 — data]
    tenantdata["tenant rows: every query scoped by tenant_id (RLS optional: DB_TENANT_RLS=1)"]
    secrets["secrets: env only; tenant credentials encrypted per purpose key"]
  end
  subgraph egress[Boundary 4 — egress to providers]
    prov["instrumentedFetch: timeout, breaker, traceparent; no PII in span attributes"]
  end
  anon --> edgeb --> pub
  users --> edgeb --> auth
  hooks --> edgeb --> wh
  scraper --> edgeb --> pub
  auth --> tenantdata
  sa --> tenantdata
  wh --> tenantdata
  auth --> prov
  secrets -.-> prov
```

What crosses each boundary is logged with a request id and (when tracing is on) a trace id; tenant ids are span
attributes, personal data never is (`packages/observability/src/tracing/`).
