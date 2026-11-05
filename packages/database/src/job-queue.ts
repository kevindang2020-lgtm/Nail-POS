// job-queue.ts — the ONE durable job queue (migration 519; BUILD_PLAN Phase 2; Constitution 4 §28–36).
//
// Modules ENQUEUE here (`enqueueJob`) and register a HANDLER for their job type (`registerJobHandler`); the worker
// loop in each process that runs a job class claims due jobs with FOR UPDATE SKIP LOCKED, runs the handler, and marks
// the job succeeded — or schedules a retry with exponential backoff and jitter — or, after max_attempts, dead. A job
// whose worker died (lease lapsed) is put back in the queue by the reaper. Nothing here keeps a transaction open while
// a handler runs.
//
// Rules a handler must keep: it is IDEMPOTENT (a retry, or a reaped lease, can run it again), it takes everything it
// needs from the payload (never from the process that enqueued it), and it throws on failure (a returned value is
// success). A payload never carries a secret, a full card number or a code.
import { sql, type Kysely } from 'kysely';

export const JOB_QUEUE_CLASSES = ['critical', 'standard', 'ai', 'report', 'import', 'reconciliation'] as const;
export type JobQueueClass = (typeof JOB_QUEUE_CLASSES)[number];
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'dead' | 'canceled';

export interface EnqueueInput {
  jobClass: JobQueueClass;
  jobType: string;                      // stable dotted name, e.g. 'customer.phone.sync'
  tenantId?: string | null;
  payload?: Record<string, unknown>;
  priority?: 0 | 1 | 2 | 3;             // 0 = most urgent
  idempotencyKey?: string | null;       // the same (type, key) is enqueued once
  runAfter?: Date | null;
  maxAttempts?: number;
  /** Default: the ambient correlation id (setJobCorrelationSource) — the request / job that enqueued it (Phase 14 A, C11 §292). */
  correlationId?: string | null;
  createdBy?: string | null;
  /** W3C traceparent of the enqueuing span (migration 548). Default: the ambient span (setJobTraceparentSource). */
  traceparent?: string | null;
}

export interface JobRow {
  id: string; jobClass: JobQueueClass; jobType: string; tenantId: string | null; priority: number;
  payload: Record<string, unknown>; status: JobStatus; attempts: number; maxAttempts: number;
  runAfter: string; leaseOwner: string | null; leaseUntil: string | null; lastError: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; correlationId: string | null;
  traceparent: string | null;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());
export const toJobRow = (r: any): JobRow => ({
  id: String(r.id), jobClass: r.job_class, jobType: r.job_type, tenantId: r.tenant_id ?? null, priority: Number(r.priority),
  payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) ?? {}, status: r.status,
  attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts), runAfter: iso(r.run_after)!, leaseOwner: r.lease_owner ?? null,
  leaseUntil: iso(r.lease_until), lastError: r.last_error ?? null, createdAt: iso(r.created_at)!, startedAt: iso(r.started_at),
  finishedAt: iso(r.finished_at), correlationId: r.correlation_id ?? null, traceparent: r.traceparent ?? null,
});

const JOB_TYPE = /^[a-z][a-z0-9_.]*$/;
const SECRETISH = /(password|passcode|secret|token|api[_-]?key|authorization|card[_-]?number|\bpan\b|cvv|otp|\bcode\b)/i;

/** The delay before attempt n+1 (n = attempts so far): 2^n × base, capped, with ±50 % jitter so retries spread out. */
export function retryDelayMs(attempts: number, opts: { baseMs?: number; capMs?: number; random?: () => number } = {}): number {
  const base = opts.baseMs ?? 5_000, cap = opts.capMs ?? 30 * 60_000, rnd = opts.random ?? Math.random;
  const raw = Math.min(cap, base * 2 ** Math.max(0, attempts - 1));
  return Math.max(1_000, Math.round(raw * (0.5 + rnd())));
}

// BUILD_PLAN Phase 11: the job remembers the trace that enqueued it, so its span joins that trace when it runs. This
// package does not depend on the observability kernel; the app installs the ambient-traceparent reader at boot (as it
// installs the tick coordinator). Only a W3C-shaped value is stored — anything else is dropped, never an error.
const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
let traceparentSource: () => string | undefined | null = () => undefined;
export function setJobTraceparentSource(fn: (() => string | undefined | null) | null): void { traceparentSource = fn ?? (() => undefined); }
function traceparentFor(input: EnqueueInput): string | null {
  let v: unknown = input.traceparent;
  if (v === undefined) { try { v = traceparentSource(); } catch { v = null; } }
  return typeof v === 'string' && TRACEPARENT.test(v) ? v : null;
}

// BUILD_PLAN Phase 14 A (Constitution 11 §292): likewise the job inherits the enqueuing request's / job's correlation id, so
// correlation search finds the request AND the work it started. An explicit correlationId (even null) wins.
const CORRELATION = /^[A-Za-z0-9._:-]{1,128}$/;
let correlationSource: () => string | undefined | null = () => undefined;
export function setJobCorrelationSource(fn: (() => string | undefined | null) | null): void { correlationSource = fn ?? (() => undefined); }
function correlationFor(input: EnqueueInput): string | null {
  if (input.correlationId !== undefined) return input.correlationId;
  let v: unknown; try { v = correlationSource(); } catch { v = null; }
  return typeof v === 'string' && CORRELATION.test(v) ? v : null;
}

export class JobQueueError extends Error { constructor(msg: string) { super(msg); this.name = 'JobQueueError'; } }

/** Enqueue a job. With an idempotency key, a second enqueue of the same (type, key) returns the FIRST job. */
export async function enqueueJob(db: Kysely<any>, input: EnqueueInput): Promise<{ id: string; duplicate: boolean }> {
  if (!(JOB_QUEUE_CLASSES as readonly string[]).includes(input.jobClass)) throw new JobQueueError(`unknown job class "${input.jobClass}"`);
  if (!JOB_TYPE.test(input.jobType)) throw new JobQueueError(`job type must be a dotted lower-case name (got "${input.jobType}")`);
  const payload = input.payload ?? {};
  for (const k of Object.keys(payload)) if (SECRETISH.test(k)) throw new JobQueueError(`a job payload never carries "${k}" — pass a reference, not the secret`);
  const r = await sql<{ id: string; inserted: boolean }>`
    INSERT INTO jobs (job_class, job_type, tenant_id, priority, payload, idempotency_key, run_after, max_attempts, correlation_id, created_by, traceparent)
    VALUES (${input.jobClass}, ${input.jobType}, ${input.tenantId ?? null}, ${input.priority ?? 2}, ${JSON.stringify(payload)}::jsonb,
            ${input.idempotencyKey ?? null}, ${input.runAfter ?? sql`now()`}, ${input.maxAttempts ?? 5}, ${correlationFor(input)}, ${input.createdBy ?? null}, ${traceparentFor(input)})
    ON CONFLICT (job_type, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id, true AS inserted`.execute(db);
  if (r.rows[0]) return { id: String(r.rows[0].id), duplicate: false };
  const existing = await sql<{ id: string }>`SELECT id FROM jobs WHERE job_type = ${input.jobType} AND idempotency_key = ${input.idempotencyKey ?? null}`.execute(db);
  if (!existing.rows[0]) throw new JobQueueError('enqueue lost a race with a delete; retry');
  return { id: String(existing.rows[0].id), duplicate: true };
}

/**
 * Claim up to `limit` due jobs of one class for `owner`. FOR UPDATE SKIP LOCKED: two workers never claim the same job.
 * A tenant already running its cap of jobs of this class is skipped this round (noisy-neighbour control, §35). The cap is
 * the tenant's `jobs_in_flight` quota (tenant_quotas → plan_quota_defaults, migration 552; QuotaService.limitFor reads
 * the same rows), else `perTenantCap` (env JOBS_PER_TENANT_CAP).
 */
export async function claimJobs(db: Kysely<any>, jobClass: JobQueueClass, owner: string, opts: { limit?: number; leaseMs?: number; perTenantCap?: number } = {}): Promise<JobRow[]> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 1));
  const leaseMs = Math.max(1_000, opts.leaseMs ?? 5 * 60_000);
  const cap = Math.max(1, opts.perTenantCap ?? 3);
  const r = await sql<any>`
    UPDATE jobs SET status = 'running', lease_owner = ${owner}, lease_until = now() + ${`${leaseMs} milliseconds`}::interval,
                    attempts = attempts + 1, started_at = now(), updated_at = now()
    WHERE id IN (
      SELECT j.id FROM jobs j
      WHERE j.job_class = ${jobClass} AND j.status = 'queued' AND j.run_after <= now()
        AND (j.tenant_id IS NULL OR (SELECT count(*) FROM jobs r WHERE r.status = 'running' AND r.job_class = j.job_class AND r.tenant_id = j.tenant_id) < coalesce(
              (SELECT q.jobs_in_flight FROM tenant_quotas q WHERE q.tenant_id = j.tenant_id),
              (SELECT d.jobs_in_flight FROM tenant_subscriptions s
                 JOIN subscription_plans p ON lower(p.code) = lower(s.plan) OR lower(p.name) = lower(s.plan)
                 JOIN plan_quota_defaults d ON d.plan_id = p.id
                WHERE s.tenant_id = j.tenant_id AND lower(s.status) = 'active' ORDER BY s.current_period_end DESC NULLS LAST LIMIT 1),
              ${cap}))
      ORDER BY j.priority, j.run_after
      LIMIT ${limit}
      FOR UPDATE OF j SKIP LOCKED)
    RETURNING *`.execute(db);
  return r.rows.map(toJobRow);
}

/** Extend a running job's lease (long handlers). False when the lease was lost (reaped) — stop working on it. */
export async function renewJobLease(db: Kysely<any>, id: string, owner: string, leaseMs = 5 * 60_000): Promise<boolean> {
  const r = await sql`UPDATE jobs SET lease_until = now() + ${`${leaseMs} milliseconds`}::interval, updated_at = now()
                      WHERE id = ${id} AND status = 'running' AND lease_owner = ${owner} RETURNING id`.execute(db);
  return r.rows.length === 1;
}

/** Keeps a running job's lease alive while its handler works (every third of the lease). Returns the stop function.
 *  A lease heartbeat, not a scheduled tick: it lives here, beside the lease it renews. */
export function startLeaseHeartbeat(db: Kysely<any>, id: string, owner: string, leaseMs = 5 * 60_000): () => void {
  const t = setInterval(() => { void renewJobLease(db, id, owner, leaseMs).catch(() => undefined); }, Math.max(50, Math.floor(leaseMs / 3)));
  (t as any).unref?.();
  return () => clearInterval(t);
}

export async function completeJob(db: Kysely<any>, id: string, owner: string, result?: unknown): Promise<boolean> {
  const r = await sql`UPDATE jobs SET status = 'succeeded', lease_owner = NULL, lease_until = NULL, finished_at = now(), updated_at = now(),
                        last_error = NULL, result = ${result === undefined ? null : JSON.stringify(result)}::jsonb
                      WHERE id = ${id} AND status = 'running' AND lease_owner = ${owner} RETURNING id`.execute(db);
  return r.rows.length === 1;
}

/** A failed attempt: retry later (backoff) or, out of attempts / not retryable, dead. */
export async function failJob(db: Kysely<any>, id: string, owner: string, error: string, opts: { retryable?: boolean; random?: () => number } = {}): Promise<'retrying' | 'dead' | 'lost'> {
  const cur = await sql<any>`SELECT attempts, max_attempts FROM jobs WHERE id = ${id} AND status = 'running' AND lease_owner = ${owner}`.execute(db);
  const row = cur.rows[0]; if (!row) return 'lost';
  const dead = opts.retryable === false || Number(row.attempts) >= Number(row.max_attempts);
  const delay = retryDelayMs(Number(row.attempts), { random: opts.random });
  const r = await sql`UPDATE jobs SET status = ${dead ? 'dead' : 'queued'}, lease_owner = NULL, lease_until = NULL, updated_at = now(),
                        last_error = ${String(error).slice(0, 1000)},
                        run_after = CASE WHEN ${dead} THEN run_after ELSE now() + ${`${delay} milliseconds`}::interval END,
                        finished_at = CASE WHEN ${dead} THEN now() ELSE NULL END
                      WHERE id = ${id} AND status = 'running' AND lease_owner = ${owner} RETURNING id`.execute(db);
  return r.rows.length === 1 ? (dead ? 'dead' : 'retrying') : 'lost';
}

/** Put jobs whose worker died back in the queue (or dead, when that was the last attempt). Returns how many. */
export async function reapExpiredLeases(db: Kysely<any>, jobClass?: JobQueueClass): Promise<{ requeued: number; dead: number }> {
  const r = await sql<{ status: string }>`
    UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
                    finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
                    last_error = coalesce(last_error, '') || CASE WHEN last_error IS NULL THEN '' ELSE ' | ' END || 'worker lease expired',
                    lease_owner = NULL, lease_until = NULL, updated_at = now()
    WHERE status = 'running' AND lease_until < now() ${jobClass ? sql`AND job_class = ${jobClass}` : sql``}
    RETURNING status`.execute(db);
  return { requeued: r.rows.filter((x) => x.status === 'queued').length, dead: r.rows.filter((x) => x.status === 'dead').length };
}

/** An operator retries a dead (or canceled) job: back to the queue now, attempts reset. */
export async function retryJob(db: Kysely<any>, id: string): Promise<boolean> {
  const r = await sql`UPDATE jobs SET status = 'queued', attempts = 0, run_after = now(), finished_at = NULL, updated_at = now()
                      WHERE id = ${id} AND status IN ('dead', 'canceled') RETURNING id`.execute(db);
  return r.rows.length === 1;
}

/** An operator cancels a job that has not started (or a dead one, to stop it being retried). */
export async function cancelJob(db: Kysely<any>, id: string): Promise<boolean> {
  const r = await sql`UPDATE jobs SET status = 'canceled', finished_at = now(), updated_at = now()
                      WHERE id = ${id} AND status IN ('queued', 'dead') RETURNING id`.execute(db);
  return r.rows.length === 1;
}

export interface JobStats { jobClass: string; queued: number; running: number; dead: number; succeededLastHour: number; oldestQueuedSeconds: number | null }
export async function jobStats(db: Kysely<any>): Promise<JobStats[]> {
  const r = await sql<any>`
    SELECT c.job_class,
      (SELECT count(*) FROM jobs j WHERE j.job_class = c.job_class AND j.status = 'queued')::int AS queued,
      (SELECT count(*) FROM jobs j WHERE j.job_class = c.job_class AND j.status = 'running')::int AS running,
      (SELECT count(*) FROM jobs j WHERE j.job_class = c.job_class AND j.status = 'dead')::int AS dead,
      (SELECT count(*) FROM jobs j WHERE j.job_class = c.job_class AND j.status = 'succeeded' AND j.finished_at > now() - interval '1 hour')::int AS succeeded_last_hour,
      (SELECT extract(epoch FROM now() - min(j.run_after)) FROM jobs j WHERE j.job_class = c.job_class AND j.status = 'queued' AND j.run_after <= now()) AS oldest
    FROM unnest(${sql.raw(`ARRAY['${JOB_QUEUE_CLASSES.join("','")}']`)}::text[]) AS c(job_class)`.execute(db);
  return r.rows.map((x) => ({ jobClass: x.job_class, queued: x.queued, running: x.running, dead: x.dead, succeededLastHour: x.succeeded_last_hour, oldestQueuedSeconds: x.oldest == null ? null : Math.round(Number(x.oldest)) }));
}

export async function listJobs(db: Kysely<any>, f: { status?: JobStatus; jobClass?: JobQueueClass; jobType?: string; tenantId?: string; limit?: number } = {}): Promise<JobRow[]> {
  const r = await sql<any>`
    SELECT * FROM jobs WHERE true
      ${f.status ? sql`AND status = ${f.status}` : sql``}
      ${f.jobClass ? sql`AND job_class = ${f.jobClass}` : sql``}
      ${f.jobType ? sql`AND job_type = ${f.jobType}` : sql``}
      ${f.tenantId ? sql`AND tenant_id = ${f.tenantId}` : sql``}
    ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(200, f.limit ?? 50))}`.execute(db);
  return r.rows.map(toJobRow);
}

// ── handlers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface JobContext { jobId: string; tenantId: string | null; attempt: number; correlationId: string | null; renewLease(): Promise<boolean> }
export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;
/** Throw this from a handler when retrying cannot help (bad payload, the thing it works on is gone): the job goes dead now. */
export class PermanentJobError extends Error { constructor(msg: string) { super(msg); this.name = 'PermanentJobError'; } }

const handlers = new Map<string, JobHandler>();
/** A module registers the handler for its job type once (in its onModuleInit). Registering a type twice is a mistake. */
export function registerJobHandler(jobType: string, handler: JobHandler): void {
  if (!JOB_TYPE.test(jobType)) throw new JobQueueError(`job type must be a dotted lower-case name (got "${jobType}")`);
  if (handlers.has(jobType) && handlers.get(jobType) !== handler) throw new JobQueueError(`a handler for "${jobType}" is already registered`);
  handlers.set(jobType, handler);
}
export function jobHandlerFor(jobType: string): JobHandler | undefined { return handlers.get(jobType); }
export function registeredJobTypes(): string[] { return [...handlers.keys()].sort(); }
/** Tests only. */
export function resetJobHandlers(): void { handlers.clear(); }
