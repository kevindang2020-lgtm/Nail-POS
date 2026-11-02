# Scaling Roadmap — Phase 3 (cont.): async customer-import worker (2026-07-03)

_The roadmap's Phase 3 second half: "Give heavy async work (bulk customer import, exports, report generation) its own
job queue + worker so long jobs never block interactive requests." Bulk customer import is the most scale-relevant of
these at 200k+ customers — so that's what this ticket makes truly async, reusing the codebase's existing job-worker
pattern rather than inventing new infrastructure._

## The problem
Customer import already had a proper job lifecycle (stage → approve → import → retry, with a jobs table, statuses, and
audit). But `approveJob` performed the **actual row import synchronously inside the approve request**
(`await repo.importRows(...)`). Approving a large import — tens of thousands of customers in one job at scale — would
block that request until every row was written, risking timeouts and tying up a worker thread that should be serving
interactive traffic. That's exactly the "long jobs blocking interactive requests" failure the roadmap calls out.

## The fix — enqueue on approve, import in a background worker
Reused the established `BillingExportScheduler` pattern (env-gated in-process worker + pure, unit-tested tick body),
so this is consistent with how the codebase already does async work — no new dependency, no external queue.

- **`approveJob` now enqueues only:** it gates as before, sets the job to the (previously-unused) **`approved`** status,
  writes the audit, and **returns immediately**. No synchronous row-writing.
- **`processPendingImportJobs(batch)`** is the worker entry point: it picks up `approved` jobs, marks each
  `processing`, imports the valid/failed rows, marks `completed`, and audits. It's **idempotent** (the repo never
  re-imports an already-imported row) and **fail-safe per job** (a bad job leaves itself `processing` for the next
  tick's safe re-run; it never throws or stops the batch).
- **`CustomerImportScheduler`** (env-gated `CUSTOMER_IMPORT_WORKER_ENABLED`, off by default) runs the tick every 15s,
  `unref()`'d so it never holds the process open, non-overlapping.
- **Manual ops trigger:** `POST /super-admin/customer-data-oversight/imports/process` drains the queue on demand
  (mirrors the billing-export manual trigger), for ops who don't want to wait for the tick.

Status flow is now: `pending → approved (queued) → processing → completed` (or `failed`/`rejected`), with the import
work living entirely off the request path.

## Why this is safe
- **Off by default = no behavior change** unless `CUSTOMER_IMPORT_WORKER_ENABLED` is set; the manual endpoint and
  `processPendingImportJobs` still work for tests/ops regardless.
- **Idempotent import** means a crash mid-job, a double-tick, or a manual + scheduled overlap all converge correctly —
  no duplicate customers.
- **Same lifecycle, same audit events** (plus a new `customer_import_processed` event); the only externally-visible
  change is that `approve` returns `approved` instead of `completed`, and completion happens moments later via the
  worker.

## Verification (fresh runs, this tree)
- **Typecheck:** api `tsc` **0 errors**.
- **New tests:** `customer-import.scheduler.vitest.spec.ts` **3/3** — enable gate off by default; tick processes queued
  jobs; tick swallows errors (a bad job never crashes the worker). Updated the import-service and oversight tests to
  the async flow (approve → process → assert), all green.
- **Full customer-data suite:** **69/69**.
- **Full api suite:** **2572/2572 across 409 files** (was 2571; net +1 after the async-flow test updates).
- **Build:** api production build **clean**; changed files lint **0/0**.

## How to turn it on (ops)
Set `CUSTOMER_IMPORT_WORKER_ENABLED=true` on at least one API instance (or run a dedicated worker instance with it
set). Approvals return instantly; imports drain every 15s. Or leave it off and call the process endpoint from a cron.

## Roadmap status
- Phase 1.2 read/write split ✅ · 1.3 index profiling ✅ (real data, 2 fixes shipped) · 1.4 pagination caps ✅
- Phase 2 read-through cache ✅ (dashboard/overview/categories) · 2.3 HTTP cache headers ✅
- **Phase 3 per-tenant rate limiting ✅ + async job worker ✅ (this ticket)** — both halves now done.
- Remaining: infra only (PgBouncer, replica, Redis, CDN) + Phase 4/5 (deferred). The same worker pattern is ready to
  apply to the other heavy async paths the roadmap names (exports, report generation) if/when they need it.
