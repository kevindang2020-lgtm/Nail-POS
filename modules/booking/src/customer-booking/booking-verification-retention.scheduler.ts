// booking-verification-retention.scheduler.ts — delete what we no longer need, and count what we do.
//
// ── Retention ───────────────────────────────────────────────────────────────────────────────────────────
//
//     "Do not retain verification codes in any form longer than necessary."
//
// We never hold a code at all — Twilio Verify keeps it, which is the whole reason it is the preferred path. So
// there is no code to delete. What DOES accumulate is the metadata around them, and it is not innocuous:
//
//   `booking_verification_sessions` holds a phone HASH, a mask, an IP and a device id, per booking attempt.
//
// That is a durable record of who tried to book where, from what network, and when. Six months of it is a
// behavioural dataset nobody asked us to keep, sitting in a salon's database, waiting to be breached or
// subpoenaed. The verification it supported is long over; the row's only remaining purpose is fraud velocity,
// which looks back ONE HOUR.
//
// So: sessions are deleted after a short window. The DURABLE facts — "this phone is verified for this tenant"
// (`booking_verified_phones`) and the aggregate usage counts — survive, because those are the things anyone
// actually needs later. The per-attempt trail does not.
//
// ── Usage ───────────────────────────────────────────────────────────────────────────────────────────────
// Each verification costs the tenant a Twilio message. They are entitled to see how many, and so are we — but a
// COUNT over a table we are about to delete is a count that quietly gets smaller every night. So the rollup runs
// BEFORE the deletion, and writes to its own table.
// CROSS-TENANT BY DESIGN: a platform retention sweep across all tenants.

import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;        // every 6h
const BATCH = 5_000;

/**
 * How long a verification session survives.
 *
 * Long enough to be useful (fraud velocity looks back an hour; a support question might arrive the next day) and
 * short enough that we are not quietly building a location-and-phone history of every customer who ever tried to
 * book. 7 days is the shortest window that still lets a human investigate a complaint on Monday about a Friday
 * booking.
 */
export function retentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.BOOKING_VERIFICATION_RETENTION_DAYS);
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.min(90, Math.round(n));                 // capped: a tenant may not choose to hoard this forever
}

export function retentionCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.BOOKING_VERIFICATION_RETENTION_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class BookingVerificationRetentionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('BookingVerificationRetention');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!retentionCronEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'booking.verification.retention', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    this.timer.unref?.();                              // never the reason a process refuses to shut down
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Public so ops can run it by hand, and so it is testable without waiting six hours. */
  async tick(): Promise<{ rolledUp: number; deleted: number }> {
    if (this.running || !this.db) return { rolledUp: 0, deleted: 0 };
    this.running = true;
    try {
      // ── 1. ROLL UP FIRST ──
      //
      // The order is not stylistic. A usage count taken AFTER the deletion is a count that shrinks every night,
      // and a tenant's monthly total would silently fall as the window rolled past it. Aggregate, then delete.
      const rolled = await this.rollUp();

      // ── 2. THEN delete ──
      const deleted = await this.purge();

      if (deleted > 0 || rolled > 0) {
        this.log.log(`rolled up ${rolled} day(s) of usage; purged ${deleted} expired verification session(s)`);
      }
      return { rolledUp: rolled, deleted };
    } catch (e: any) {
      // A failed sweep must not kill the timer. It will try again in six hours; a crashed scheduler would leave
      // the data growing forever, which is the exact outcome it exists to prevent.
      this.log.warn(`retention sweep failed: ${e?.message ?? e}`);
      return { rolledUp: 0, deleted: 0 };
    } finally {
      this.running = false;
    }
  }

  /** Daily per-tenant counts, written before the rows they are counted from are deleted. */
  private async rollUp(): Promise<number> {
    const r: any = await sql`
      INSERT INTO booking_verification_usage_daily
        (tenant_id, usage_date, sent_count, verified_count, failed_count, expired_count)
      SELECT
        tenant_id,
        created_at::date                                          AS usage_date,
        count(*) FILTER (WHERE status <> 'pending')::int           AS sent_count,
        count(*) FILTER (WHERE status = 'verified')::int           AS verified_count,
        count(*) FILTER (WHERE status IN ('failed','locked'))::int AS failed_count,
        count(*) FILTER (WHERE status = 'expired')::int            AS expired_count
      FROM booking_verification_sessions
      WHERE created_at::date < current_date            -- only COMPLETE days; today is still moving
      GROUP BY tenant_id, created_at::date
      ON CONFLICT (tenant_id, usage_date) DO UPDATE SET
        -- Recomputed, not incremented. An incremented counter double-counts on a retried sweep; a recomputed one
        -- is idempotent, which matters because this job WILL run twice one day.
        sent_count     = EXCLUDED.sent_count,
        verified_count = EXCLUDED.verified_count,
        failed_count   = EXCLUDED.failed_count,
        expired_count  = EXCLUDED.expired_count,
        updated_at     = now()
      RETURNING tenant_id`.execute(this.db as any);
    return r.rows?.length ?? 0;
  }

  /** Delete sessions past the retention window. */
  private async purge(): Promise<number> {
    const days = retentionDays();
    const r: any = await sql`
      DELETE FROM booking_verification_sessions
      WHERE id IN (
        SELECT id FROM booking_verification_sessions
        WHERE created_at < now() - (${days} || ' days')::interval
        LIMIT ${BATCH}
      )
      RETURNING id`.execute(this.db as any);
    return r.rows?.length ?? 0;
  }
}
