// bill-reminder.scheduler.ts — mandate §121–§124 (+ §178/§179 digests): a bill that comes due (or goes overdue) tells the owner once per rung,
// in-process like the reminder ladder: non-overlapping, unref'd, OFF by default (EXPENSE_BILL_REMINDERS_ENABLED=1 turns
// it on) so dev, test and CI never notify anyone. The sweep is idempotent per bill per day (bill_reminded_on), so a second
// replica or a restart never double-notifies.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { runsBackgroundJob } from '@aipowersalon/config';
import { ExpenseService } from './expense.service';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;   // hourly: due-soon/overdue are day-granular

export function billRemindersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.EXPENSE_BILL_REMINDERS_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class BillReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('BillReminders');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly expenses: ExpenseService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;
    if (!billRemindersEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'finance.bill_reminders', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch((e: Error) => this.log.error(`bill reminder tick failed: ${e.message}`)); }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public so ops can trigger it by hand and tests need not wait. Non-overlapping. */
  async tick(): Promise<{ sent: number; digests?: { weekly: number; monthly: number } } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const r = await this.expenses.sweepBillReminders();
      if (r.sent) this.log.log(`bill reminders: ${r.sent} sent`);
      // §178/§179 (Oct 27 2026): the weekly / monthly owner summaries ride the same hourly tick — once per completed period per
      // salon (the settings row remembers), honouring the owner's notification preferences
      let digests: { weekly: number; monthly: number } | undefined;
      try { digests = await this.expenses.sweepDigests(); if (digests.weekly || digests.monthly) this.log.log(`expense summaries: ${JSON.stringify(digests)}`); }
      catch (e) { this.log.error(`expense summary sweep failed: ${(e as Error).message}`); }
      return { ...r, digests };
    } catch (e) { this.log.error(`bill reminder sweep failed: ${(e as Error).message}`); return null; }
    finally { this.running = false; }
  }
}
