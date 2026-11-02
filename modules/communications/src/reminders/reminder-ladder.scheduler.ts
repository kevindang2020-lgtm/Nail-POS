// reminder-ladder.scheduler.ts — Oct 21 2026: the reminder job ran ONLY when something outside posted
// /jobs/appointment-reminders — and nothing did (UNUSED_ROUTE_INVENTORY listed it). A reminder ladder with a 30-minute
// rung needs a run every few minutes, in-process, like the booking-hold sweep: non-overlapping, unref'd, OFF by default
// (REMINDER_CRON_ENABLED=1 turns it on) so dev, test and CI never text anyone.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { runsBackgroundJob } from '@aipowersalon/config';
import { RemindersService } from './reminders.service';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;   // every 5 minutes: a 30-minute rung with a 5-minute window lands 30–35 min before

export function reminderCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.REMINDER_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class ReminderLadderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ReminderLadder');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly reminders: RemindersService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;
    if (!reminderCronEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'communications.reminders', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public so ops can trigger it by hand and tests need not wait. Non-overlapping. */
  async tick(): Promise<{ sent: number; failed: number; blocked: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const s = await this.reminders.runDueReminders(Date.now(), 'scheduler');
      if (s.sent || s.failed) this.log.log(`reminders: sent ${s.sent}, blocked ${s.blocked}, failed ${s.failed} across ${s.tenantsProcessed} salon(s)`);
      return { sent: s.sent, failed: s.failed, blocked: s.blocked };
    } catch (e) { this.log.error(`reminder run failed: ${(e as Error).message}`); return null; }
    finally { this.running = false; }
  }
}
