// outbox-publisher.ts — Constitution 8, Phase 7: the publisher worker.
//
//   find due outbox rows → CLAIM a batch (FOR UPDATE SKIP LOCKED, §21) → publish via transport → mark published
//
// Safe under concurrent publishers: claims are serialized (advisory lock) and row-locked, so two instances never claim
// the same row, and an aggregate's next event is never claimed while an earlier one is in flight or backing off (§38
// per aggregate across ticks and instances — see claimBatch). A crash after
// claiming but before marking leaves rows 'claimed'; the reaper below returns stale claims to 'pending', which
// is at-least-once delivery (§22) — consumers are idempotent precisely because this can happen.
// Env-gated like every other worker in the codebase: EVENT_PUBLISHER_ENABLED=true|1|yes|on.
import { type DomainEvent, nextAttemptDelayMs } from '@aipowersalon/events';
import { Logger } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder, type SqlBool } from 'kysely';
import { randomUUID } from 'node:crypto';
import { assertTransition, canMoveToSql, workerPoolSettings, type AppDatabase, type DB } from '@aipowersalon/database';
import type { EventTransport } from './event-transport';
import { postRestoreHoldActive, POST_RESTORE_HOLD_MESSAGE, runsBackgroundJob } from '@aipowersalon/config';

// eventPublisherEnabled: ONE definition, in @aipowersalon/config (the services' delivery decision reads it too).
export { eventPublisherEnabled } from '@aipowersalon/config';
import { eventPublisherEnabled } from '@aipowersalon/config';
import { OUTBOX_EVENT } from './event-lifecycles';

export const PUBLISHER = {
  tickMs: 1_000, batch: 100, staleClaimMs: 5 * 60_000, maxPublishAttempts: 25,
  /** 200-technician M5 pilot (Oct 24 2026): a FULL batch means more is due — the next batch is claimed at once instead of
   *  after the next 1 s tick (a 3,500-booking burst left realtime 2+ minutes behind while the publisher idled between
   *  batches). Bounded so one drain never holds the event loop for long: at most this many batches back to back. */
  maxBatchesPerDrain: 20,
  /** §129: informational — the round-robin ranking below is what delivers fairness. A HARD per-tenant cap was
   *  tried and rejected: it under-fills the batch when only one tenant is due (100 → 25), trading throughput for
   *  a fairness the ranking already provides. Kept as the documented share a tenant gets under full contention. */
  fairShareHint: 25,
  /** M4 (Oct 24 2026, M5-1): a claimed batch is published in up to this many LANES at once. Events of the same aggregate
   *  (tenant + aggregate type + id) always share a lane and keep their order; different aggregates — a burst of 1,000
   *  bookings is 1,000 aggregates — no longer wait for each other's consumers one transaction at a time. §38 is now
   *  "occurred_at order PER AGGREGATE" (it was per tenant): no consumer depends on the order of two different
   *  aggregates — counters are commutative upserts on one row, notifications are inserts, realtime frames are refetch
   *  signals (a client reloads the screen; it never applies a frame as state, so a late frame cannot repaint an older
   *  one), and the two cross-aggregate couplings found in review are each serialized by their own lock: a branch's
   *  stock rows (InventoryService.lockStock, product_id order) and a ticket's loyalty netting (advisory lock, netted in
   *  payments order). Pool (Oct 26 2026): the publisher, its transport and runner run on DATABASE_WORKER when the
   *  process has one (publisherDatabase); lanes × TRANSPORT.consumerConcurrency is the DEMAND (2 × 2), and the shared
   *  ConsumerBudget (consumerBudgetFor: min(demand, poolMax − 2)) is what may actually be open at once — 3 on the
   *  default 5-connection worker pool, 4 from PG_WORKER_POOL_MAX ≥ 6. Measured (scripts/m4-outbox-burst-bench.mjs,
   *  1,000 bookings, real consumers): drain 7.5-8.7 s → 3.8 s, realtime lag p95 7.1-8.3 s → 3.6 s (2 × 2 unbounded);
   *  PERFORMANCE_REPORT.md has the bounded numbers. lanes = 1 restores per-tenant order. */
  lanes: 2,
  /** 200-technician §90 (Oct 26 2026) — the REALTIME-FIRST lane. With a transport that has a first lane (publishFirst:
   *  the realtime projection), a claimed batch's realtime frames go out right after the claim, and the batch's other
   *  consumers ("the follow pass") run behind, batch after batch in claim order, while the next batches are claimed and
   *  projected. SSE delivery no longer queues behind push / analytics / notifications: under a 3,500-booking burst the
   *  frames ran ~13 s behind the writes on this 2-core host because every frame waited for the previous batches' slow
   *  consumers. This many claimed batches may wait for their follow pass at once (the lead the realtime lane may take);
   *  at the cap the drain waits for the oldest. Claimed rows stay 'claimed' until their follow pass marks them published,
   *  so the head-of-line claim still holds back an aggregate's later events (§38 per aggregate, per consumer). */
  followLeadBatches: 40,
  /** §90: the claim size when the realtime-first lane is on. The claim reads every open row (to find each aggregate's
   *  head), so with the lane its cost is on the realtime path once per batch; 250 a claim instead of 100 cut the 3,500-
   *  booking bench's realtime p95 from 1.8–3.6 s to 1.3–1.6 s on the loaded 2-core host. The follow pass is unchanged
   *  (lanes by aggregate). Without the lane the publisher claims `batch`. */
  leadBatch: 250,
} as const;

/** The pool the publisher, its transport, its runner and the event workers use: the WORKER pool when the process has one
 *  (its own connections and timeouts — a burst of consumer transactions never takes a connection an HTTP request needs,
 *  Constitution 1 §60–61), else the primary. `poolMax` is that pool's size, for consumerBudgetFor. */
export function publisherDatabase(primary: AppDatabase, worker: AppDatabase | null | undefined, env: NodeJS.ProcessEnv = process.env): { db: AppDatabase; pool: 'worker' | 'primary'; poolMax: number } {
  if (worker) return { db: worker, pool: 'worker', poolMax: workerPoolSettings(env)?.max ?? 5 };
  return { db: primary, pool: 'primary', poolMax: Number(env.PG_POOL_MAX) || 10 };
}

/** The ordering key a lane preserves: every event of one aggregate, in claim (occurred_at) order. */
export function laneKey(row: { tenant_id?: string | null; aggregate_type?: string | null; aggregate_id?: string | null }): string {
  return `${row.tenant_id ?? '~platform'}|${row.aggregate_type ?? ''}|${row.aggregate_id ?? ''}`;
}

export type TickResult = { claimed: number; published: number; failed: number; reclaimed: number };
type FollowResult = { published: number; failed: number };

export class OutboxPublisher {
  private readonly log = new Logger(OutboxPublisher.name);
  readonly instanceId = `pub-${randomUUID().slice(0, 8)}`;
  private timer?: ReturnType<typeof setInterval>;
  private heldLogged = false;   // mandate §212
  private running = false;

  constructor(private readonly db: Kysely<DB>, private readonly transport: EventTransport, private readonly now: () => Date = () => new Date(), private readonly lanes: number = 1) {}   // lanes: events.module passes PUBLISHER.lanes (a real pool); 1 = the serial publisher

  start(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!eventPublisherEnabled()) { this.log.log('Outbox publisher disabled (EVENT_PUBLISHER_ENABLED unset).'); return; }
    // §90: the timer does not wait for the follow passes — the next firing claims and projects the next batches while the
    // earlier batches' slow consumers still run (bounded by followLeadBatches)
    this.timer = setInterval(() => { void this.drain({ wait: false }).catch((e) => this.log.warn(`outbox drain failed (${safeCode(e)})`)); }, PUBLISHER.tickMs);
    this.log.log(`Outbox publisher ${this.instanceId} started (every ${PUBLISHER.tickMs}ms, batch ${this.claimSize}${this.leads ? ', realtime-first lane' : ''}).`);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  /** §90: the transport has a realtime-first lane (InProcessTransport with `first` consumers). */
  private get leads(): boolean { return typeof this.transport.publishFirst === 'function'; }
  /** follow passes queued or running, oldest first (each removes itself when done) */
  private readonly inFollow: Promise<FollowResult>[] = [];
  private followTail: Promise<unknown> = Promise.resolve();
  /** FIFO: a batch's follow pass starts when the previous batch's has finished — batches run their slow consumers in claim
   *  order, one batch at a time (its lanes in parallel, as before), so the oldest batch is always the next to finish. */
  private enqueueFollow(run: () => Promise<FollowResult>): Promise<FollowResult> {
    // a follow pass never rejects: an infrastructure error mid-pass is logged and its rows stay 'claimed' for the reaper
    // (at-least-once, exactly as a crashed publisher's) — so the chain, the lead cap and settle() never see a rejection
    const safe = async (): Promise<FollowResult> => {
      try { return await run(); }
      catch (e) { this.log.warn(`outbox follow pass failed; its claimed rows return to pending after staleClaimMs (${safeCode(e)})`); return { published: 0, failed: 0 }; }
    };
    const p = this.followTail.then(safe);
    this.followTail = p;
    this.inFollow.push(p);
    void p.finally(() => { const i = this.inFollow.indexOf(p); if (i >= 0) this.inFollow.splice(i, 1); });
    return p;
  }
  /** Waits until every queued follow pass has finished (tests, benches, shutdown). */
  async settle(): Promise<FollowResult> {
    let published = 0, failed = 0;
    while (this.inFollow.length) { const r = await this.inFollow[0]; published += r.published; failed += r.failed; }
    return { published, failed };
  }

  /** One timer firing: batches back to back while each comes back FULL (a backlog), up to maxBatchesPerDrain; a partial
   *  batch means the outbox is drained. A firing that finds a drain / tick already running does nothing (the guard).
   *  Without a first lane each batch is fully published before the next is claimed (the M4 behaviour). With one (§90),
   *  each batch is claimed and PROJECTED, its follow pass queued, and the next batch claimed at once — up to
   *  followLeadBatches waiting follow passes. `wait` (default true): resolve only when this drain's follow passes are
   *  done (tests); the timer passes false. */
  async drain(opts: { wait?: boolean } = {}): Promise<{ batches: number; published: number }> {
    if (this.running || this.held()) return { batches: 0, published: 0 };
    this.running = true;
    let batches = 0, published = 0;
    const mine: Promise<FollowResult>[] = [];
    try {
      while (batches < PUBLISHER.maxBatchesPerDrain) {
        while (this.inFollow.length >= PUBLISHER.followLeadBatches) await this.inFollow[0];   // the lead cap (a follow pass never rejects)
        const b = await this.claimAndLead();
        if (b.claimed === 0) break;                                       // nothing due — or every due row is held back
        batches++;
        if (this.leads) mine.push(b.follow); else published += (await b.follow).published;
        if (b.claimed < this.claimSize) break;                            // a partial batch: drained
      }
    } finally { this.running = false; }
    if (opts.wait !== false) for (const p of mine) published += (await p).published;
    return { batches, published };
  }

  /** One pass, fully published before it resolves. Re-entrancy guarded: a slow tick never overlaps the next. */
  async tick(): Promise<TickResult> {
    if (this.running || this.held()) return { claimed: 0, published: 0, failed: 0, reclaimed: 0 };
    this.running = true;
    try {
      const b = await this.claimAndLead();
      const f = await b.follow;
      return { claimed: b.claimed, published: f.published, failed: f.failed, reclaimed: b.reclaimed };
    } finally { this.running = false; }
  }

  /** mandate §212: a restore must not replay the outbox (receipts, SMS, push, in-app all hang off consumers) */
  private held(): boolean {
    if (postRestoreHoldActive()) { if (!this.heldLogged) { this.heldLogged = true; this.log.warn(POST_RESTORE_HOLD_MESSAGE); } return true; }
    this.heldLogged = false; return false;
  }

  /** Claim a batch; with a first lane, project it at once (§90); queue its follow pass. */
  private async claimAndLead(): Promise<{ claimed: number; reclaimed: number; follow: Promise<FollowResult> }> {
    const reclaimed = await this.reapStaleClaims();
    const rows = await this.claimBatch();
    if (!rows.length) return { claimed: 0, reclaimed, follow: Promise.resolve({ published: 0, failed: 0 }) };
    let first = new Set<string>();
    if (this.transport.publishFirst) {
      // a failed first lane is not fatal: those events run every consumer (the realtime projection included) in the follow pass
      try { first = await this.transport.publishFirst(rows.map(rowToEvent)); }
      catch (e) { this.log.warn(`realtime-first lane failed for a batch of ${rows.length}; the follow pass runs every consumer (${safeCode(e)})`); }
    }
    return { claimed: rows.length, reclaimed, follow: this.enqueueFollow(() => this.followPass(rows, first)) };
  }

  /** The batch's consumers (all of them, or all but the first lane's for the events it finished), lanes by aggregate. */
  private async followPass(rows: any[], first: Set<string>): Promise<FollowResult> {
    let published = 0, failed = 0;
    /** true when the event is out; false when it went back to pending (its lane must stop: see below). */
    const publishRow = async (row: any): Promise<boolean> => {
      const event = rowToEvent(row);
      try {
        await this.transport.publish(event, first.has(row.id) ? { skipFirst: true } : undefined);
        await this.db.updateTable('outbox_events').set({ publish_status: 'published', published_at: this.now() as any, claimed_by: null, claimed_at: null })
          .where('id', '=', row.id).where(canMoveToSql(OUTBOX_EVENT, 'published') as RawBuilder<SqlBool>).execute();
        published++;
        return true;
      } catch (e) {
        // Infrastructure failure only (consumer failures are recorded per consumer inside the transport).
        const attempts = (row.attempt_count ?? 0) + 1;
        const exhausted = attempts >= PUBLISHER.maxPublishAttempts;
        await this.db.updateTable('outbox_events').set({
          publish_status: exhausted ? 'failed' : 'pending', attempt_count: attempts, claimed_by: null, claimed_at: null,
          next_attempt_at: new Date(this.now().getTime() + nextAttemptDelayMs(attempts)) as any,
          last_error_code: safeCode(e),
        }).where('id', '=', row.id).where(canMoveToSql(OUTBOX_EVENT, exhausted ? 'failed' : 'pending') as RawBuilder<SqlBool>).execute();
        failed++;
        return exhausted;   // a dead ('failed') event no longer holds its aggregate back; a retrying one does
      }
    };
    /** §38 per aggregate (Oct 26 2026): the rest of a lane whose event went back to pending is RELEASED unpublished — not
     *  published past it. Before this, the lane carried on with event k+1 while k waited out its backoff, and k reached
     *  every consumer that had not finished it AFTER k+1 (outbox-lanes race spec, 'one a0': [1, 2, …, 0, …]). Released rows
     *  are plain pending again (no attempt counted: they never ran) and claimBatch will not take them until k is out. */
    const release = async (rest: Array<{ id: string }>) => {
      if (!rest.length) return;
      await this.db.updateTable('outbox_events').set({ publish_status: 'pending', claimed_by: null, claimed_at: null })
        .where('id', 'in', rest.map((r) => r.id)).where('claimed_by', '=', this.instanceId).where(canMoveToSql(OUTBOX_EVENT, 'pending') as RawBuilder<SqlBool>).execute();
    };
    // Lanes (M4): rows grouped by aggregate in claim order — one lane publishes its aggregate's events one after
    // another, exactly as the single loop did; up to `lanes` aggregates are in flight at once. claimBatch returns the
    // rows sorted by claim rank (never trust UPDATE … RETURNING order — it is the join's, not the ORDER BY's).
    const byLane = new Map<string, any[]>();
    for (const row of rows) { const k = laneKey(row); const l = byLane.get(k); if (l) l.push(row); else byLane.set(k, [row]); }
    const queue = [...byLane.values()];
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const lane = queue[next++];
        for (let i = 0; i < lane.length; i++) if (!(await publishRow(lane[i]))) { await release(lane.slice(i + 1)); break; }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(Math.floor(this.lanes) || 1, queue.length)) }, worker));
    return { published, failed };
  }

  /** §21 + §38: claim atomically, and only an aggregate's HEAD events.
   *
   *  Oct 26 2026 (outbox-lanes race flake): the order guarantee is per aggregate ACROSS ticks and instances, so the claim
   *  enforces it, not the batch:
   *   • HEAD-OF-LINE — a pending row is claimable only when no earlier row of its aggregate (laneKey; occurred_at,
   *     created_at, id order) is still in flight ('claimed', by any instance) or waiting out a backoff ('pending', not
   *     due). Event k+1 is never handed out while k is unpublished; a dead ('failed') row no longer holds it back.
   *   • ONE CLAIMER AT A TIME — the claim runs under a transaction-scoped advisory lock, so a second instance's claim
   *     statement starts after the first's commit and SEES its claims (row locks alone cannot do this: SKIP LOCKED
   *     would let instance B take e2 of an aggregate whose e1 A is claiming at that very moment). The claim is one
   *     short statement; publishing happens outside the lock.
   *   • REAL ROW LOCKS — FOR UPDATE OF o on the table itself. It used to sit on a reference to the `ranked` CTE, where
   *     PostgreSQL silently ignores a locking clause (no LockRows node in the plan): two instances could claim — and
   *     publish — the same row. The UPDATE also re-checks 'pending'.
   *  Rows come back sorted by claim rank (row_number below), which is per-aggregate order. */
  private get claimSize(): number { return this.leads ? PUBLISHER.leadBatch : PUBLISHER.batch; }
  private async claimBatch(): Promise<any[]> {
    const now = this.now();
    // §129 FAIR SCHEDULING. Plain FIFO (ORDER BY occurred_at) lets one tenant starve every other: the
    // constitution's own example is tenant A generating 100k analytics events while tenant B's critical event
    // waits. So rank each tenant's due events independently and take rank 1 from every tenant before rank 2
    // from anyone — a round-robin interleave. Within a tenant, order is still occurred_at (§38): fairness BETWEEN
    // tenants never reorders events WITHIN one. Platform events (tenant_id NULL) are ranked as their own group.
    assertTransition(OUTBOX_EVENT, 'pending', 'claimed');   // the move this statement makes; the CTE takes only rows the machine lets become 'claimed'
    const rows = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('aipowersalon:outbox.claim', 0))`.execute(trx);
      const r = await sql<any>`
        WITH open AS (
          -- every unpublished row, with how many EARLIER rows of its aggregate are in flight or backing off
          SELECT id, tenant_id, occurred_at, created_at, publish_status, next_attempt_at,
                 count(*) FILTER (WHERE publish_status = 'claimed' OR next_attempt_at > ${now}) OVER (
                   PARTITION BY COALESCE(tenant_id::text, '~platform'), aggregate_type, aggregate_id
                   ORDER BY occurred_at ASC, created_at ASC, id ASC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS blocked_by
            FROM outbox_events
           WHERE publish_status IN ('pending', 'claimed')
        ), ranked AS (
          SELECT id, row_number() OVER (PARTITION BY COALESCE(tenant_id::text, '~platform')
                                        ORDER BY occurred_at ASC, created_at ASC, id ASC) AS tenant_rank
            FROM open
           WHERE publish_status = 'pending' AND next_attempt_at <= ${now} AND blocked_by = 0
        ), top AS (
          -- Take rank 1 from every tenant, then rank 2 from every tenant, and so on. Under contention that is a
          -- round-robin interleave; with a single tenant due it degrades to plain FIFO and still fills the batch.
          -- Ranks rise with occurred_at inside a tenant, so the LIMIT keeps a PREFIX of every aggregate's due events.
          -- §90 (Oct 26 2026): the batch is chosen HERE, before the join back to the table. Joining the whole ranked set
          -- first let the planner — whose statistics still said "nothing pending" right after a burst landed — pick a
          -- nested loop with the join as a filter: 3,500 × 3,500 comparisons, a 2.5–4.6 s claim (EXPLAIN ANALYZE on the
          -- bench copy). Now the join is at most one batch of primary-key lookups.
          SELECT id, tenant_rank FROM ranked ORDER BY tenant_rank ASC, id ASC LIMIT ${this.claimSize}
        ), due AS (
          -- a row locked by someone else (never another claimer: the advisory lock) is skipped — the batch comes back
          -- short and the next drain takes it
          SELECT o.id, top.tenant_rank FROM top JOIN outbox_events o ON o.id = top.id
           WHERE ${canMoveToSql(OUTBOX_EVENT, 'claimed', 'o')}
           FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE outbox_events o SET publish_status = 'claimed', claimed_by = ${this.instanceId}, claimed_at = ${now}
          FROM due WHERE o.id = due.id AND ${canMoveToSql(OUTBOX_EVENT, 'claimed', 'o')}
        RETURNING o.*, due.tenant_rank::int AS claim_rank`.execute(trx);
      return r.rows;
    });
    return rows.sort((a: any, b: any) => (a.claim_rank - b.claim_rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** A publisher that died mid-batch leaves 'claimed' rows; after staleClaimMs they go back to 'pending'. */
  private async reapStaleClaims(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - PUBLISHER.staleClaimMs);
    const r = await sql<any>`UPDATE outbox_events SET publish_status = 'pending', claimed_by = NULL, claimed_at = NULL
                             WHERE publish_status = 'claimed' AND ${canMoveToSql(OUTBOX_EVENT, 'pending')} AND claimed_at < ${cutoff}
                               AND (claimed_by IS DISTINCT FROM ${this.instanceId} OR ${this.inFollow.length === 0}) RETURNING id`.execute(this.db);   // §90: this instance's own claims are queued for its follow pass, not stale — unless nothing is queued (a pass that failed left them)
    return r.rows.length;
  }
}

export function rowToEvent(row: any): DomainEvent<any> {
  const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
  return {
    eventId: row.id, eventType: row.event_type, eventVersion: Number(row.event_version), occurredAt: new Date(row.occurred_at).toISOString(),
    tenantId: row.tenant_id ?? undefined, branchId: row.branch_id ?? undefined, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version ?? undefined, actorId: row.actor_id ?? undefined, actorType: row.actor_type ?? undefined,
    requestId: row.request_id ?? undefined, correlationId: row.correlation_id, causationId: row.causation_id ?? undefined,
    ...(row.traceparent ? { traceparent: row.traceparent } : {}), payload,
  };
}
/** §197: never persist a raw error string — a code only. */
function safeCode(e: unknown): string { const c = String((e as any)?.code ?? ''); return c ? `err_${c.toLowerCase()}`.slice(0, 40) : 'publish_failed'; }
