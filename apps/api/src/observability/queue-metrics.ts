// queue-metrics.ts — BUILD_PLAN Phase 14 B (Constitution 11 §45–48, §111; DoD "Queue metrics implemented").
//
// The durable queue is Postgres (jobs since BUILD_PLAN Phase 2, outbox_events + event_dead_letters since Constitution 8).
// Its state was visible on the Jobs & Dead Letters screen and the Events screen, but NOT in the registry — so /metrics
// and the process heartbeats could not alert on "the critical queue's oldest job is 10 minutes old". These gauges are
// read FROM THE QUEUE TABLES (the same numbers whichever process answers), refreshed on collect, throttled to one read per
// REFRESH_MS per process, never inside a request, a failure leaves the last values (§286):
//   aipowersalon_queue_jobs{job_class, priority, state}      state: queued | running | dead_24h (died in the last 24 h)
//   aipowersalon_queue_oldest_due_age_seconds{job_class}      age of the oldest job that is DUE (run_after <= now) — §111
//   aipowersalon_outbox_events{status}                        pending | claimed | failed (published rows are not a backlog)
//   aipowersalon_outbox_oldest_pending_age_seconds
//   aipowersalon_event_dead_letters{status}                   open | retrying (resolved / discarded are history)
// A series that disappears (a drained class) is set to 0, never left at its last value.
import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { registry } from '@aipowersalon/observability';

export const queueJobs = registry.gauge('aipowersalon_queue_jobs', 'Durable queue jobs by class, priority and state (queued | running | dead_24h)', ['job_class', 'priority', 'state']);
export const queueOldestDueAge = registry.gauge('aipowersalon_queue_oldest_due_age_seconds', 'Age of the oldest DUE queued job, by class (0 = none due)', ['job_class']);
export const outboxEvents = registry.gauge('aipowersalon_outbox_events', 'Outbox events not yet published, by status', ['status']);
export const outboxOldestPendingAge = registry.gauge('aipowersalon_outbox_oldest_pending_age_seconds', 'Age of the oldest pending outbox event (0 = none)', []);
export const eventDeadLetters = registry.gauge('aipowersalon_event_dead_letters', 'Event dead letters still needing attention, by status', ['status']);

export const REFRESH_MS = 15_000;
const DAY_MS = 86_400_000;

@Injectable()
export class QueueMetrics implements OnModuleInit {
  private lastAt = 0;
  private inflight: Promise<boolean> | null = null;
  /** Series written last time, so a series that vanished is zeroed instead of frozen. */
  private seen = { jobs: new Set<string>(), due: new Set<string>(), outbox: new Set<string>(), dlq: new Set<string>() };
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    if (!this.db) return;
    // On demand, throttled (the Redis INFO pattern): a scrape or a heartbeat read triggers at most one read per REFRESH_MS.
    registry.onCollect(() => {
      if (this.inflight || Date.now() - this.lastAt < REFRESH_MS) return;
      void this.refresh();
    });
  }

  /** Read the queue tables and set every gauge. Resolves false on failure (the gauges keep their last values). */
  refresh(now = new Date()): Promise<boolean> {
    if (this.inflight) return this.inflight;
    this.lastAt = Date.now();
    this.inflight = this.read(now).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async read(now: Date): Promise<boolean> {
    if (!this.db) return false;
    try {
      const since = new Date(now.getTime() - DAY_MS);
      const jobs = (await sql<any>`
        select job_class, priority, status, count(*)::int n,
               min(run_after) filter (where status = 'queued' and run_after <= ${now}) oldest_due
          from jobs
         where status in ('queued', 'running') or (status = 'dead' and finished_at >= ${since})
         group by job_class, priority, status`.execute(this.db)).rows;
      const outbox = (await sql<any>`
        select publish_status, count(*)::int n, min(occurred_at) filter (where publish_status = 'pending') oldest
          from outbox_events where publish_status in ('pending', 'claimed', 'failed') group by publish_status`.execute(this.db)).rows;
      const dlq = (await sql<any>`select status, count(*)::int n from event_dead_letters where status in ('open', 'retrying') group by status`.execute(this.db)).rows;

      const jobKeys = new Set<string>(); const dueKeys = new Set<string>();
      const oldestByClass = new Map<string, number>();
      for (const r of jobs) {
        const state = r.status === 'dead' ? 'dead_24h' : String(r.status);
        const labels = { job_class: String(r.job_class), priority: String(r.priority), state };
        queueJobs.set(Number(r.n), labels); jobKeys.add(JSON.stringify(labels));
        if (r.oldest_due) {
          const age = Math.max(0, Math.round((now.getTime() - new Date(r.oldest_due).getTime()) / 1000));
          oldestByClass.set(String(r.job_class), Math.max(age, oldestByClass.get(String(r.job_class)) ?? 0));
        }
      }
      for (const [cls, age] of oldestByClass) { queueOldestDueAge.set(age, { job_class: cls }); dueKeys.add(cls); }
      for (const k of this.seen.jobs) if (!jobKeys.has(k)) queueJobs.set(0, JSON.parse(k));
      for (const c of this.seen.due) if (!dueKeys.has(c)) queueOldestDueAge.set(0, { job_class: c });

      const outKeys = new Set<string>(); let oldestPending = 0;
      for (const r of outbox) {
        outboxEvents.set(Number(r.n), { status: String(r.publish_status) }); outKeys.add(String(r.publish_status));
        if (r.oldest) oldestPending = Math.max(0, Math.round((now.getTime() - new Date(r.oldest).getTime()) / 1000));
      }
      for (const s of this.seen.outbox) if (!outKeys.has(s)) outboxEvents.set(0, { status: s });
      outboxOldestPendingAge.set(oldestPending);

      const dlqKeys = new Set<string>();
      for (const r of dlq) { eventDeadLetters.set(Number(r.n), { status: String(r.status) }); dlqKeys.add(String(r.status)); }
      for (const s of this.seen.dlq) if (!dlqKeys.has(s)) eventDeadLetters.set(0, { status: s });

      this.seen = { jobs: new Set([...this.seen.jobs, ...jobKeys]), due: new Set([...this.seen.due, ...dueKeys]), outbox: new Set([...this.seen.outbox, ...outKeys]), dlq: new Set([...this.seen.dlq, ...dlqKeys]) };
      return true;
    } catch {
      return false;   // §286: the last values stay; the next collect retries
    }
  }
}
