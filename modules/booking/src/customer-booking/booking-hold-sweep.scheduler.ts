// booking-hold-sweep.scheduler.ts — hands lapsed slot reservations back to the calendar.
//
// ── Why this must exist, and must run OFTEN ─────────────────────────────────────────────────────────────
// A hold takes a slot off the market while the customer verifies their phone. If the customer walks away — or
// their browser crashes, or they never receive the SMS — that slot stays reserved until something releases it.
//
// Every unswept hold is a bookable slot the salon cannot sell. Enough of them and it is a **denial-of-service on
// the salon's own diary**, arriving quietly: nothing errors, nothing alerts, the calendar just looks full.
//
// So this runs every MINUTE, not daily like the retention sweeps. A hold lives 2–15 minutes; a daily sweep would
// leave abandoned holds parked for most of a day, which is worse than having no holds at all.
//
// Mirrors the platform's existing scheduler convention (ai-voice-transcription-retention.scheduler): in-process,
// no external dependency, non-overlapping, unref'd so it never holds the process open, and OFF by default so dev,
// test and CI never sweep.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { BookingHoldService } from './booking-hold.kysely';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 60 * 1000;              // every minute — a hold only lives 2–15
const BATCH = 500;

export function holdSweepCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.BOOKING_HOLD_SWEEP_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class BookingHoldSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('BookingHoldSweep');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly holds: BookingHoldService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!holdSweepCronEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'booking.hold', jobClass: 'critical', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    // Unref'd: a sweep timer must never be the reason a process refuses to shut down.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Public so ops can trigger it by hand, and so it is testable without waiting a minute. */
  async tick(): Promise<number> {
    // Non-overlapping. A slow sweep must not stack up behind itself and multiply the load it is already
    // struggling with.
    if (this.running) return 0;
    this.running = true;
    try {
      const n = await this.holds.sweep(Date.now(), BATCH);
      // Logged only when it did something — a per-minute "swept 0" line is noise that hides the real ones.
      if (n > 0) this.log.log(`released ${n} expired booking hold(s)`);
      return n;
    } catch (e: any) {
      // A failed sweep must not kill the timer. It will try again in a minute; a crashed scheduler would leave
      // every future hold parked forever, which is the exact failure it exists to prevent.
      this.log.warn(`sweep failed: ${e?.message ?? e}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
