// event-retention.ts — Constitution 8 §97–99, §162: retention classes and the cleanup job. "Do not grow outbox forever."
//
// Retention CLASSES (§97) are decided by event type prefix, not per row, so the policy is one table you can read:
//   FINANCIAL  payment.* / settlement.* / deposit.* / gift_card.* / payroll.*   — kept longest (troubleshooting + replay policy)
//   SECURITY   security.* / platform.*                                          — kept long
//   STANDARD   everything else
// Only PUBLISHED outbox rows are ever deleted (§98). pending / claimed / failed rows are never touched by retention —
// they are work, not history. processed_events is trimmed on the consumer retry/replay window (§162); the dedup
// guarantee it gives ends when the row is gone, which is why the window is ≥ the longest retry horizon and why
// critical financial uniqueness ALSO lives in domain tables (§25, §162). Dead letters: only resolved/discarded age out.
// Deletes are batched so the job never holds a long lock; it just runs again next tick.
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { eventPublisherEnabled } from './outbox-publisher';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick } from '@aipowersalon/observability';

export type RetentionClass = 'FINANCIAL' | 'SECURITY' | 'STANDARD';
export const RETENTION_DAYS: Record<RetentionClass, number> = { FINANCIAL: 400, SECURITY: 400, STANDARD: 30 };
export const PROCESSED_EVENTS_DAYS = 45;        // §162: ≥ the longest retry horizon (15 min × 12 attempts is minutes; 45d is generous for replay review)
export const DEAD_LETTER_FINAL_DAYS = 90;       // resolved / discarded only
export const RETENTION = { tickMs: 6 * 60 * 60_000, batch: 5_000 } as const;

export function retentionClassOf(eventType: string): RetentionClass {
  const d = eventType.split('.')[0];
  if (['payment', 'settlement', 'deposit', 'gift_card', 'payroll', 'checkout'].includes(d)) return 'FINANCIAL';
  if (['security', 'platform'].includes(d)) return 'SECURITY';
  return 'STANDARD';
}

export type RetentionResult = { outboxDeleted: number; processedDeleted: number; deadLettersDeleted: number };

export class EventRetentionWorker {
  private readonly log = new Logger(EventRetentionWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly db: Kysely<DB>, private readonly now: () => Date = () => new Date()) {}

  start(): void {
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!eventPublisherEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'events.retention', jobClass: 'standard', everyMs: RETENTION.tickMs }, () => this.tick()).catch(() => undefined); }, RETENTION.tickMs);
    this.log.log(`Event retention worker started (every ${RETENTION.tickMs / 3_600_000}h; outbox STANDARD ${RETENTION_DAYS.STANDARD}d / FINANCIAL+SECURITY ${RETENTION_DAYS.FINANCIAL}d; processed ${PROCESSED_EVENTS_DAYS}d).`);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  /** One batched pass. Safe to call any time; never touches unpublished outbox rows or open/retrying dead letters. */
  async tick(): Promise<RetentionResult> {
    if (this.running) return { outboxDeleted: 0, processedDeleted: 0, deadLettersDeleted: 0 };
    this.running = true;
    try {
      const at = this.now();
      const cutoff = (days: number) => new Date(at.getTime() - days * 86_400_000);
      const financialPrefixes = ['payment.%', 'settlement.%', 'deposit.%', 'gift_card.%', 'payroll.%', 'checkout.%'];
      const securityPrefixes = ['security.%', 'platform.%'];
      const longLived = [...financialPrefixes, ...securityPrefixes];

      // §98: published only, by class. STANDARD rows = not matching any long-lived prefix.
      const ob1 = await sql<any>`
        DELETE FROM outbox_events WHERE id IN (
          SELECT id FROM outbox_events
           WHERE publish_status = 'published' AND published_at < ${cutoff(RETENTION_DAYS.STANDARD)}
             AND NOT (event_type LIKE ANY(${longLived as any}))
           LIMIT ${RETENTION.batch})
        RETURNING id`.execute(this.db);
      const ob2 = await sql<any>`
        DELETE FROM outbox_events WHERE id IN (
          SELECT id FROM outbox_events
           WHERE publish_status = 'published' AND published_at < ${cutoff(RETENTION_DAYS.FINANCIAL)}
             AND (event_type LIKE ANY(${longLived as any}))
           LIMIT ${RETENTION.batch})
        RETURNING id`.execute(this.db);
      // §162: processed_events on the retry/replay window
      const pe = await sql<any>`
        DELETE FROM processed_events WHERE (consumer_name, event_id) IN (
          SELECT consumer_name, event_id FROM processed_events WHERE processed_at < ${cutoff(PROCESSED_EVENTS_DAYS)} LIMIT ${RETENTION.batch})
        RETURNING event_id`.execute(this.db);
      // dead letters: only rows a human already closed
      const dl = await sql<any>`
        DELETE FROM event_dead_letters WHERE id IN (
          SELECT id FROM event_dead_letters WHERE status IN ('resolved','discarded') AND last_failed_at < ${cutoff(DEAD_LETTER_FINAL_DAYS)} LIMIT ${RETENTION.batch})
        RETURNING id`.execute(this.db);
      const r = { outboxDeleted: ob1.rows.length + ob2.rows.length, processedDeleted: pe.rows.length, deadLettersDeleted: dl.rows.length };
      if (r.outboxDeleted || r.processedDeleted || r.deadLettersDeleted) this.log.log(`retention: outbox -${r.outboxDeleted}, processed -${r.processedDeleted}, dead letters -${r.deadLettersDeleted}`);
      return r;
    } finally { this.running = false; }
  }
}
